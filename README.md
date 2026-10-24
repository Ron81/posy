# Posy

**Stream avatar poses over WebRTC — body, fingers and face in about 116 bytes per frame.**

[![CI](https://github.com/Ron81/posy/actions/workflows/ci.yml/badge.svg)](https://github.com/Ron81/posy/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/posy-protocol.svg)](https://www.npmjs.com/package/posy-protocol)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](https://www.npmjs.com/package/posy-protocol?activeTab=dependencies)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Spec: 1.4.6](https://img.shields.io/badge/spec-1.4.6-brightgreen.svg)

Posy (**Po**se **Sy**nchronization) is an open, compact protocol for syncing humanoid avatar poses
between lots of people in real time. It runs over WebRTC data channels for direct and
browser-to-browser links, and over a reliable WebSocket for server-relay setups. A typical
upper-body frame with fingers and face is ~116 bytes — about 25–35× smaller than the same pose over
VMC — so a whole room can move at once without anybody's upload crying. Zero runtime dependencies,
Apache-2.0, and contributions are very welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

> 🧪 **Play with it on the [interactive site](https://ron81.github.io/posy/)** — build a frame byte
> by byte, run the [bandwidth calculator](https://ron81.github.io/posy/#bandwidth), or watch the
> [loopback demo](https://ron81.github.io/posy/demo/) survive a bad connection.

## Is this for me?

- ✅ You build multi-user VTuber/avatar apps in the browser or over WebRTC
- ✅ You need many participants on normal internet connections
- ✅ You just want to hang out with a few friends — one of you hosts the room from home
- ❌ You need lossless studio mocap recording → use VMC/BVH instead
- ❌ You need a fully serverless P2P mesh → Posy routes through one peer (which can just be you)

## How it works

```text
 Sender ────── pose frames ──────▶ Routing peer ────── drops / forwards ──────▶ Receivers
 (captures, encodes)               (your PC, a VPS,                             (interpolate, render)
                                    or a hosted SFU)
```

- Pose rides an **unordered, zero-retransmit** data channel (label `avatar-pose`, protocol
  `posy/1`). A late frame is a useless frame, so nothing is ever resent.
- Every frame is **self-contained** — losing one is fine, and dropping one to save bandwidth is
  always safe.
- Rotations are quaternions in Posy avatar space (the VRM 1.0 normalized rig), packed
  **smallest-three into 4 bytes** each.
- The routing peer only forwards or drops frames — it never rewrites bytes, which is what keeps
  hosting light enough to run from home.
- Voice is plain WebRTC Opus; Posy doesn't touch audio.

### What's in a frame

| Part | Size | Notes |
|---|---|---|
| Header + `bone_mask` | 16 B | version, flags, sequence number, timestamp, 64-bit bone mask |
| Bone rotations | 4 B × N | 13 bones for a typical upper body = 52 B |
| Root position + hips height | 8 B | optional (`HAS_ROOT`) |
| Fingers | 24 B | optional (`HAS_FINGERS`) — curl + splay per finger, both hands |
| Face | 15 B / 54 B | optional (`HAS_EXPRESSIONS`) — 13 VRM expressions, or all 52 ARKit blendshapes with `PERFECT_SYNC`; plus 2 gaze bytes |
| **Typical total** | **115 B** | **154 B** with Perfect-Sync |

The face doesn't travel as bones — blinks, mouth shapes, emotions and eye direction all live in the
expression block. The eye/jaw bone bits are only a fallback for literally bone-driven rigs.

## Bandwidth

Each person uploads one small stream of their own pose, and that **never grows with room size**:

| Your tracking (at 30 Hz) | Your upload |
|---|---|
| Face only | ≈ 20 kbit/s |
| Upper body + fingers + face | ≈ 40 kbit/s |
| Full body | ≈ 48 kbit/s |

That's smaller than the voice call riding alongside it; drop to 15 Hz and it roughly halves. The
part that scales with the crowd is what the host forwards back out — a friends-sized room is
nothing, a real crowd wants a proper uplink. Dial your own numbers in the
[bandwidth calculator](https://ron81.github.io/posy/#bandwidth) (same maths as spec §6).

## What's next

1.x is in a short window where the last breaking tidy-ups land, after which the core locks for a
long, calm, additive-only run. The full plan, the release sequence, and the real-use gate before
1.5.0 are in [`ROADMAP.md`](ROADMAP.md). 2.0 is deliberately far off — 1.x is where the work is.

## But why?

For most things you can reach for VMC and call it a day — it's great at what it was built for. But
the open options (VMC, VRChat's OSC) are local-machine protocols at heart, and the tools that
actually stream poses to a bunch of people over the internet (VRChat's own sync, Vup, …) are
closed. What I kept wanting was something just as light that survives the trip over the internet to
more than one person — and open. So here we are.
