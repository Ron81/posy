# Posy

**Stream a whole room of avatars — body, fingers, face — in about 115 bytes a frame.**

[![CI](https://github.com/Ron81/posy/actions/workflows/ci.yml/badge.svg)](https://github.com/Ron81/posy/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/posy-protocol.svg)](https://www.npmjs.com/package/posy-protocol)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](https://www.npmjs.com/package/posy-protocol?activeTab=dependencies)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Spec: 1.5.0](https://img.shields.io/badge/spec-1.5.0-brightgreen.svg)

Posy (**Po**se **Sy**nchronization) moves humanoid avatar poses between a lot of people at once, live. Everyone streams their own pose; everyone else applies it to their own copy of your avatar. Frames ride a WebRTC data channel on a direct link, or a WebSocket when a server sits in the middle.

This README is the quick pitch — the full, exact rules live in [`spec/Posy.md`](spec/Posy.md).

- **Small.** A typical upper-body frame, fingers and face included, is 115 bytes — roughly 25–35× smaller than the same pose over VMC.
- **Shrugs off packet loss.** Every frame stands on its own. A lost one is simply gone, never resent, and dropping one to save bandwidth is always safe.
- **Easy on the server.** It forwards or bins whole frames and never rewrites them — it doesn't even have to decode the rotations.
- **All avatar formats.** Posy is built to be avatar-format-agnostic: every avatar runs off the exact same frames on the wire, and it's already confirmed working with VRM, MMD and even PNGTuber+ avatars in one room over a real relay. Cat ears, wings, tails, extra limbs and an avatar's own expressions ride along as declared extras, by whatever names the avatar file uses.

The reference codec is on npm as [`posy-protocol`](https://www.npmjs.com/package/posy-protocol): TypeScript, zero runtime dependencies. All of it is Apache-2.0.

Have a look at the [interactive site](https://ron81.github.io/posy/): build a frame byte by byte, rotate a bone and watch its data change, and work out the bandwidth for a room — then the [loopback demo](https://ron81.github.io/posy/demo/) runs a live avatar through a lossy channel, right in your browser.

## Is it for you?

- **Yes** if you're building something where lots of avatars move together.
- **Yes** if you want that motion online *fast* and on very little bandwidth.
- **No** if you want a lossless mocap recording — grab VMC or BVH instead.

## How it works

```text
 Sender ────── pose frames ──────▶   Server   ────── drops / forwards ──────▶ Receivers
 (captures, encodes)                (your PC, a VPS,                           (interpolate, render)
                                     or a hosted SFU)
```

- The sender says up front what it'll send — what its tracker produces and its avatar can show. The server grants that, or part of it, and holds the sender to it.
- Rotations are quaternions in Posy avatar space (which is just the normalized VRM 1.0 rig), squeezed smallest-three into 4 bytes each.
- On a data channel (label `avatar-pose`, protocol `posy/1`) frames arrive unordered and are never resent. On a WebSocket each frame is one binary message.
- The receiver smooths between frames and papers over short gaps.

### What's in a frame

| Part | Size | Notes |
|---|---|---|
| Header + `bone_mask` | 16 B | version, flags, sequence number, timestamp, 64-bit bone mask |
| Bone rotations | 4 B × N | 13 bones for a typical upper body = 52 B |
| Root position + hips height | 8 B | optional (`HAS_ROOT`) |
| Fingers | 24 B | optional (`HAS_FINGERS`): curl and splay per finger, both hands |
| Face | 15 B / 54 B | optional (`HAS_EXPRESSIONS`): 13 VRM expressions, or all 52 ARKit blendshapes with `PERFECT_SYNC`; both with 2 gaze bytes |
| **Typical total** | **115 B** | **154 B** with Perfect-Sync |

Two more options when you need them: per-joint finger rotations (`finger_bones`, 4 B per joint) swap in for the finger block when a hand shape won't fit it, and declared extras cost 4 B per bone and 1 B per value.

The face doesn't travel as bones. Lids, mouth shapes, moods and the line of sight live in the expression block; the eye and jaw bone bits are just a fallback for rigs that are driven by bone rotation.

## Bandwidth

Each sender uploads one stream of its own pose, and that size doesn't care how big the room is:

| Tracking, at 30 Hz | Upload |
|---|---|
| Face only | ≈ 20 kbit/s |
| Upper body + fingers + face | ≈ 40 kbit/s |
| Full body with toes | ≈ 47 kbit/s |

Halve it at 15 Hz. What *does* grow with the room is what the server sends back out — trivial for a handful of friends, a datacentre uplink for a crowd. The [bandwidth calculator](https://ron81.github.io/posy/#bandwidth) does the sums.

## Status

The packet format and the signaling have been frozen since 1.5.0: a 1.x release only ever adds (§9), and anything that would change or remove what's already there means `posy/2`. The full picture: the posture in [`ROADMAP.md`](ROADMAP.md), the changes in [`CHANGELOG.md`](CHANGELOG.md), the reasoning behind the hard calls in [`docs/DECISIONS.md`](docs/DECISIONS.md), and the usual questions in [`FAQ.md`](FAQ.md). Contributions welcome — start at [`CONTRIBUTING.md`](CONTRIBUTING.md).
