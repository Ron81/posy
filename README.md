# Posy

**Stream avatar poses over WebRTC — body, fingers and face in about 118 bytes per frame.**

[![CI](https://github.com/Ron81/posy/actions/workflows/ci.yml/badge.svg)](https://github.com/Ron81/posy/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Spec: 1.1.0](https://img.shields.io/badge/spec-1.1.0-brightgreen.svg)

Posy (**Po**se **Sy**nchronization) is an open, compact protocol for syncing humanoid avatar poses between lots of people in real time. It works over WebRTC data channels for direct and browser-to-browser links, and over a reliable WebSocket for server-relay deployments — each transport is the right tool for its deployment context, not a fallback for the other. A typical upper-body frame with fingers and face is ~118 bytes — roughly 70× smaller than VMC — so a whole room can move at once without anybody's upload crying.

---> 🧪 **Try out the [interactive site](https://ron81.github.io/posy/)** <---
It lets you build a frame byte by byte, play with the **[bandwidth calculator](https://ron81.github.io/posy/#bandwidth)** and browse the tables. Or try the **[loopback demo](https://ron81.github.io/posy/demo/)** to watch how an avatar looks on different connections from premium Fibre to the last copper cable, in a cave, at the end of the world.

## Is this for me?

- ✅ You build multi-user VTuber/avatar apps in the browser or with WebRTC
- ✅ You need many participants over normal internet connections
- ✅ You just want to hang out with a few friends — one of you hosts the room from home
- ❌ You need lossless studio mocap recording → use VMC/BVH instead
- ❌ You need a fully serverless peer-to-peer mesh → Posy routes through one peer (which can simply be you)

## The 60-second tour

```text
 Sender ────── pose frames ──────▶ Routing peer ────── drops / forwards ──────▶ Receivers
 (captures, encodes)               (your PC, a VPS,                             (interpolate, render)
                                    or a hosted SFU)
```

- Pose rides an **unordered, zero-retransmit** data channel — label `avatar-pose`, protocol `posy/1`. A late frame is a useless frame, so nothing is ever resent. (A reliable WebSocket can stand in where server-side WebRTC isn't available — same frames, same "drop don't resend" rule, see spec §1.1.)
- Every frame is **self-contained**. Losing one is fine; dropping one to save bandwidth is always safe.
- Rotations are VRM 1.0 normalized-space quaternions, packed **smallest-three into 4 bytes** each.
- The routing peer only forwards or drops frames — it never rewrites bytes. That's what keeps the job light enough to run at home.
- Voice is plain WebRTC Opus. Posy doesn't touch audio.

### What's in a frame

| Part | Size | Notes |
|---|---|---|
| Header + `bone_mask` | 16 B | version, flags, sequence number, timestamp, 64-bit bone mask |
| Bone rotations | 4 B × N | 13 bones for a typical upper body = 52 B |
| Root position + hips height | 8 B | optional (`HAS_ROOT`) |
| Fingers | 24 B | optional (`HAS_FINGERS`) — curl + splay per finger, both hands |
| Face | 18 B / 54 B | optional (`HAS_EXPRESSIONS`) — 16 VRM expressions, or all 52 ARKit blendshapes with `PERFECT_SYNC`; plus 2 gaze bytes |
| **Typical total** | **118 B** | **154 B** with Perfect-Sync |

One thing that trips people up: **the face doesn't travel as bones.** Blinks, mouth shapes, emotions and eye direction all live in the expression block (`HAS_EXPRESSIONS`). The eye/jaw bone bits are only a fallback for rigs that are literally bone-driven — and if both are present, the gaze bytes win.

## How much bandwidth does it eat?

**Almost nothing on your end — and that never changes with room size.** Each person uploads exactly one small stream of their own pose, no matter how many people are in the room:

| Your tracking (at 30 Hz) | Your upload |
|---|---|
| Face only | ≈ 20 kbit/s |
| Upper body + fingers + face | ≈ 40 kbit/s |
| Full body | ≈ 48 kbit/s |

That's smaller than the voice call riding alongside it. Drop to 15 Hz and it roughly halves.

The part that actually grows with the crowd is what the **routing peer** (the host) has to forward back out to everyone. A few real rooms:

| Room | What the host forwards |
|---|---|
| **Classic 1:1** — two VTubers, upper-body tracking | ≈ 0.08 Mbit/s |
| **Round of 8 friends** — 2 full-body, 4 upper-body, 2 face-only | ≈ 2 Mbit/s |
| **Big party** — 5 full-body, 20 upper-body, 25 just watching | ≈ 51 Mbit/s |

So a friends-sized room is nothing — any home connection hosts it. Only once you get to a real crowd does the host want a proper uplink; viewers who only watch cost almost nothing, since they never send.

Want your own numbers? The [interactive bandwidth calculator](https://ron81.github.io/posy/#bandwidth) lets you dial the room size and rate tiers and watch the totals move. (Same maths as spec §6.)

## Host it yourself

"Server" is a role, not a product. For a group of friends, one of you runs the routing peer on your own machine — same idea as hosting a game server — and everyone else connects to you. A handful of people is comfortable on ordinary home fibre. If upload is the tight spot:

- drop everyone to 15 Hz (`NORMAL`) or 5 Hz (`MINIMAL`) — 15 Hz already looks fine with smoothing,
- let non-performers join as receive-only viewers,
- or hand the routing role to whoever has the best upstream.

Bigger rooms want a cheap VPS, and public ones a hosted SFU (mediasoup does data-channel forwarding natively). A ready-made example server is planned as a separate repo.

## Try it in 2 minutes

A no-server loopback demo lives in [`examples/loopback-demo`]. It animates a pose, `encode()`s it to Posy bytes, sends it through a fake channel with packet-loss and jitter sliders, `decode()`s it and drives two avatars side by side — the sender and what actually survived the trip. All local, all in the browser.

The quickest look is the [hosted version](https://ron81.github.io/posy/demo/) — nothing to install. To run or hack on it yourself:

```sh
cd examples/loopback-demo
npm install
npm start
```

A stick figure works out of the box; you can also load your own `.vrm`. Nothing is uploaded anywhere.

## Implement it

1. Read [`spec/Posy-1.0.md`] — §3 (coordinates), §4 (bones) and §5 (packets) are the normative core.
2. Validate against [`testvectors/`] — if those pass, you're conformant.
3. Grab code from [`reference/js/`] freely — or use it as a cross-check for your own.

If the spec, the reference code and the test vectors ever disagree, **the spec wins** and the other two get fixed. Please report the problem, so i actually know about it.

## What's where

| Path | What it is |
|---|---|
| [`spec/`] | The spec, plus the generated bone and blendshape tables |
| [`schemas/`]| JSON Schema for the signaling messages (§2) |
| [`scripts/`]| Generator for the spec's lookup tables |
| [`reference/js/`] | TypeScript reference encoder/decoder |
| [`testvectors/`] | Binary frames and quaternions with expected results — the most valuable folder here |
| [`docs/`] | The interactive site (static, no build step) |
| [`FAQ.md`] | Why things are the way they are |
| [`CHANGELOG.md`] | What changed |
| [`examples/`] | Runnable demos — start with the loopback demo |

## Status

**1.1.0 — released.** The packet format (§5) and signaling (§2) are soft-locked rather than frozen: no implementation has shipped yet, so they can still change in a 1.x revision, but every change needs a stated justification. 1.1.0 adds the full-body profile, a per-sender declaration of what is transmitted, hips height and tongue tracking.
Other-language implementations (Rust, C#, Python, …) are very welcome — please open a PR adding a link here.

## Thanks — standing on a lot of shoulders

Posy is small on purpose. I didn't reinvent anything I could just borrow, so honestly this whole thing only exists because other people did the hard work first and shared it openly.

Huge thank you to:

- **[VRM](https://vrm.dev/) (@pixiv & the VRM Consortium)** — for making and keeping humanoid avatars an actually open standard. Posy's bones and expressions just speak VRM 1.0 natively, no translation needed. The fact that avatars *can* be open like this is a big reason any of this works.

- **ARKit blendshapes** — for that 52-name facial vocabulary everyone uses now. I reused it verbatim for the Perfect-Sync face block, so it just drops straight in. Boring in the best way.

- **The folks behind the [VMC protocol](https://protocol.vmc.info/)** — you already nailed local pose streaming. Posy is really just asking "what if we did that VMC thing, but with a bunch of friends over the internet?" Thanks for the blueprint and the inspiration — hope you don't mind me borrowing your idea ;)

- **WebRTC** — for unordered, zero-retransmit data channels. Which turns out to be *exactly* what you want when a late mocap frame is a useless mocap frame. Thanks to everyone who builds and maintains that unglamorous plumbing.

## But why?

That VMC nod above deserves the full story. I love the VMC protocol, its awesome for its intended use, but it's fundamentally a local-machine protocol. 
What I needed / wanted was lightweight pose sync over the internet that doesn't break with multiple users. 
The ones that already do this or lets say most likely do have a own protocol (e.g Vupechat or VRChat) are closed source.
So here we are...

## Contributing

Issues are for the protocol, [Discussions] are for everything else. 
Spec changes need an issue first. Details in [`CONTRIBUTING.md`].

## License
[Apache-2.0](LICENSE)
