# Posy

**A compact protocol for streaming avatar poses: body, fingers and face in about 115 bytes per frame.**

[![CI](https://github.com/Ron81/posy/actions/workflows/ci.yml/badge.svg)](https://github.com/Ron81/posy/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/posy-protocol.svg)](https://www.npmjs.com/package/posy-protocol)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](https://www.npmjs.com/package/posy-protocol?activeTab=dependencies)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Spec: 1.4.6](https://img.shields.io/badge/spec-1.4.6-brightgreen.svg)

Posy (**Po**se **Sy**nchronization) carries humanoid avatar poses between many participants in
real time. Each sender streams its own pose, and every receiver applies it to its copy of that
sender's avatar. Frames travel over a WebRTC data channel on direct links, or over a WebSocket
when a server relays them.

- **Small.** A typical upper-body frame with fingers and face is 115 bytes, about 25–35× smaller
  than the same pose over VMC (arithmetic in spec §6).
- **Loss-tolerant.** Every frame stands alone. A lost frame is never resent, and dropping one to
  save bandwidth is always safe.
- **Light on the server.** The routing peer forwards or drops whole frames. It never rewrites
  them and need not decode the rotations.
- **One wire for every avatar format.** VRM 1.0, VRM 0.x and PMX avatars are driven from the same
  frames. Tails, ears, further limbs and an avatar's own expressions travel as declared extras,
  under the names the avatar file uses.

The specification is [`spec/Posy.md`](spec/Posy.md). The reference codec is on npm as
[`posy-protocol`](https://www.npmjs.com/package/posy-protocol): TypeScript, no runtime
dependencies. Everything is Apache-2.0.

To try it: the [interactive site](https://ron81.github.io/posy/) builds a frame byte by byte and
calculates bandwidth, and the [loopback demo](https://ron81.github.io/posy/demo/) sends an avatar
through a lossy channel.

## Is it for you?

- **Yes** if you build multi-user avatar applications for ordinary internet connections. A small
  group can be hosted from one member's home connection.
- **No** if you need lossless motion-capture recording: use VMC or BVH.
- **No** if you need a peer-to-peer mesh without a routing peer. Posy always routes through one
  peer, which can be a participant's own machine.

## How it works

```text
 Sender ────── pose frames ──────▶ Routing peer ────── drops / forwards ──────▶ Receivers
 (captures, encodes)               (your PC, a VPS,                             (interpolate, render)
                                    or a hosted SFU)
```

- A sender declares up front which data types it will transmit: what its tracker delivers and
  its avatar can show. The server grants that set or a part of it.
- Rotations are quaternions in Posy avatar space (it coincides with the normalized rig of VRM 1.0
  runtimes), packed smallest-three into 4 bytes each.
- On a data channel (label `avatar-pose`, protocol `posy/1`) frames are unordered and never
  retransmitted. On a WebSocket each frame is one binary message.
- A receiver interpolates between frames and conceals short gaps.

### What is in a frame

| Part | Size | Notes |
|---|---|---|
| Header + `bone_mask` | 16 B | version, flags, sequence number, timestamp, 64-bit bone mask |
| Bone rotations | 4 B × N | 13 bones for a typical upper body = 52 B |
| Root position + hips height | 8 B | optional (`HAS_ROOT`) |
| Fingers | 24 B | optional (`HAS_FINGERS`): curl and splay per finger, both hands |
| Face | 15 B / 54 B | optional (`HAS_EXPRESSIONS`): 13 VRM expressions, or all 52 ARKit blendshapes with `PERFECT_SYNC`; both with 2 gaze bytes |
| **Typical total** | **115 B** | **154 B** with Perfect-Sync |

Two further options: per-joint finger rotations (`finger_bones`, 4 B per joint) replace the
finger block for hand shapes it cannot express, and declared extras add 4 B per bone and 1 B per
value.

The face does not travel as bones. Lids, mouth shapes, moods and the line of sight are in the
expression block; the eye and jaw bone bits are a fallback for rigs driven by bone rotation.

## Bandwidth

Each sender uploads one stream of its own pose. Its size does not depend on the room:

| Tracking, at 30 Hz | Upload |
|---|---|
| Face only | ≈ 20 kbit/s |
| Upper body + fingers + face | ≈ 40 kbit/s |
| Full body with toes | ≈ 47 kbit/s |

At 15 Hz it is half of that. What grows with the room is what the routing peer sends back out:
little for a group of friends, a datacentre uplink for a crowd. The
[bandwidth calculator](https://ron81.github.io/posy/#bandwidth) uses the method of spec §6.

## Status

Until 1.5.0 the packet format and the signaling may still change, each change with a stated
justification. 1.5.0 closes that: from then on 1.x releases only add. The plan and its state are
in [`ROADMAP.md`](ROADMAP.md), the changes in [`CHANGELOG.md`](CHANGELOG.md), the reasons behind
the harder decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md) and the common questions in
[`FAQ.md`](FAQ.md). Contributions are welcome: [`CONTRIBUTING.md`](CONTRIBUTING.md).
