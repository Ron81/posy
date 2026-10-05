# POSY — Pose Synchronization
**Version:** 1.1.0
**Status:** Released — packet format (§5) and signaling (§2) are soft-locked: they may change in a 1.x revision, and every change needs a stated justification
**Channel label:** `avatar-pose`
**Channel protocol string:** `posy/1`

---

## 0. Scope and Conventions

Posy is a lightweight, server-authoritative protocol for streaming humanoid avatar
pose, finger and facial-expression data between many participants in real time,
alongside ordinary WebRTC Opus voice.

**Key words** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are to be interpreted as in
RFC 2119.

**Roles**
- **Sender** — a client producing pose frames.
- **Server** — authoritative router. Owns the session clock, room membership,
  the playspace, authorization, validation and per-subscriber rate control.
- **Receiver** — a client consuming pose frames.

**Avatar model.** A sender's stream drives that sender's own avatar, which every
receiver renders as a local instance. Posy does not retarget one sender's motion onto a
different avatar. The sender therefore knows the rig its data lands on, and transmits
only what its capture pipeline delivers **and** its avatar can show (§2.1). How avatars
are distributed to receivers is out of scope.

**Non-goals for v1:** delta/keyframe encoding, server-side field stripping,
physics, props, scene state.

---

## 1. Transport

### 1.1 Media and data
- Voice MUST use standard WebRTC Opus audio tracks. Posy does not define audio.
- Pose data MAY be carried on either of two transport lanes, depending on deployment:

  **SCTP data channel** — the lane for direct and browser-to-browser links:
  ```js
  pc.createDataChannel("avatar-pose", {
    ordered: false,
    maxRetransmits: 0,
    protocol: "posy/1"
  });
  ```
  Its unordered, zero-retransmit delivery matches the protocol's premise that a late
  pose frame is useless.

  **WebSocket** — the lane for server-relay deployments. Where a deployment relays pose
  frames over WebSocket (for example because native server-side WebRTC is unavailable),
  pose frames MAY be carried over a reliable WebSocket instead. Each frame is carried as
  a single binary WebSocket message. The negotiated lane is declared in the
  `hello`/`session` handshake (§2.1).

  Neither lane is a "fallback" for the other — each is primary in its deployment context.

- A lost pose frame MUST NOT be retransmitted. Late frames are useless by definition.
- Every pose frame MUST fit in a single datagram (SCTP) or single WebSocket message (WS).
  Implementations MUST NOT emit a pose frame larger than 1100 bytes. v1 frames are
  ≤ 202 bytes, so fragmentation never occurs.

#### Reconciling WebSocket with the loss-tolerant design

A WebSocket is reliable and ordered. "MUST NOT retransmit" (above) is a **Posy-layer**
rule: Posy never retransmits a pose frame. It does not require the transport to be lossy.
The mismatch is reconciled as follows:

- **Sender.** On the WebSocket lane the sender SHOULD bound its send buffer and **drop**
  (not enqueue) a new pose frame while the socket's `bufferedAmount` exceeds a small
  threshold of roughly one to two frames. This re-creates zero-retransmit semantics at the
  application layer and keeps TCP from backing up a queue of stale frames.
- **Receiver.** Stale frames are discarded exactly as on the SCTP lane: a frame older than
  the newest already released for playout is dropped (§5.7), and the jitter buffer (§8.1)
  handles the rest. No receiver change is needed.
- **Cost.** TCP head-of-line blocking can still delay a fresh frame behind an older one in
  flight; the receiver drops the stale frame but the fresh one may arrive late. This is the
  accepted cost of the WebSocket lane — latency-critical paths SHOULD use the SCTP lane.

### 1.2 Topology
The topology is **client–server**, never peer-to-peer mesh. All pose frames travel
sender → server → receiver. The server MAY drop, filter or refuse frames. The server
MUST NOT modify the byte content of a forwarded frame in v1 (this is what makes
rate-tiering a pure frame-drop operation).

A relay MAY validate a frame structurally using only the §5.1 header — without decoding
the quaternion payload — by checking:
1. `version` byte: `version >> 4 == 0` (a 1.x frame; the value is the minor revision, §9).
2. Frame length exactly equals `16 + 4·popcount(bone_mask) + 8·b1 + 24·b2 + (b3 ? (b0 ? 54 : 18) : 0)`.
3. `bone_mask` bits 25–54 (finger bones) are 0 (§4).
4. The frame stays within the sender's granted set (§2.1): none of flag bits 0–3 is set
   for a type that was not granted, and `bone_mask & 0x01FFFFFF & ~granted_mask == 0`,
   where `granted_mask` is the OR of the bone masks of the granted types.

A relay MUST NOT reject a frame because reserved flag bits 5–7 or reserved `bone_mask`
bits 55–63 are set. Those bits are the extension mechanism (§9) and are ignored on
receive (§5.2); the length check already accounts for a quaternion per set mask bit.

A frame failing check 1, 2 or 3 is invalid: the relay drops it and counts it toward
`MALFORMED_THRESHOLD` (§2.5), which is reported once the threshold is crossed, not per
frame. A frame failing check 4 is dropped and counted as `UNAUTHORIZED_TYPE`. The relay
still MUST NOT modify the byte content of frames it does forward.

### 1.3 Signaling channel
A separate **reliable, ordered** channel (WebSocket or a reliable data channel) MUST
exist for session control. All control messages in §2 travel there as UTF-8 JSON. When
the WebSocket lane (§1.1) is in use, pose frames and this signaling channel MAY share
the same WebSocket connection — distinguished by frame type (binary pose frames vs.
UTF-8 JSON control messages) — or use separate WebSocket connections; both are conformant.

---

## 2. Session Layer

> **Soft-locked.** §2 was frozen at 1.0.0. The freeze is lifted until the full-body
> work is settled: no implementation has shipped, so there is nothing to stay compatible
> with. Messages and fields may change in a 1.x revision; each change needs a stated
> justification in the changelog.

### 2.1 Join

Client → Server:
```json
{ "t": "hello",
  "uid": "u_8f31",
  "token": "<opaque auth token>",
  "protocol": "posy/1",
  "transport": "sctp",
  "caps": { "sends": ["bones", "legs", "root", "fingers", "expressions"],
            "max_rate_hz": 30 } }
```

Server → Client:
```json
{ "t": "session",
  "session_id": "r_412",
  "epoch_unix_ms": 1730900000000,
  "transport": "sctp",
  "playspace": { "w": 1920, "h": 1080 },
  "allowed": ["bones", "legs", "root", "fingers", "expressions"],
  "tiers": { "FULL": 30, "NORMAL": 15, "MINIMAL": 5 },
  "default_tier": "NORMAL" }
```

- `transport` (optional, added in 1.0.5) is the pose-frame transport lane:
  `"sctp"` | `"websocket"`. The client states the lane it is using in `hello`; the server
  confirms the lane it accepted in `session`. Transport is a connection property, kept
  separate from `caps` (which describes producer capabilities). When absent on a message,
  that message's lane is `"sctp"` — the 1.0.0 default — so pre-1.0.5 peers interoperate
  unchanged. Because a WebSocket has no `protocol`-string negotiation, this handshake is where
  the WebSocket lane is agreed. The `transport` value the server returns in `session` is
  **authoritative**: the client MUST use the confirmed lane. If the server cannot provide the
  requested lane, it either confirms a lane it does support in `session` (which the client
  then uses) or, if none is available, rejects the join with an `UNSUPPORTED_TRANSPORT` error
  (§2.5).
- `caps.sends` is the sender's **declaration**: the complete list of data types it will
  transmit. It MUST be the intersection of what the sender's capture pipeline delivers and
  what its current avatar can show. A type the avatar cannot show (no toe bones, no tongue
  or ARKit blendshapes) MUST NOT be declared even if the tracker delivers it. An empty
  list declares a watcher: the client transmits no pose frames and the server allocates
  no pose producer for it.
- `allowed` is the server's **grant** for this client: `caps.sends` reduced by server
  policy, so `allowed` ⊆ `caps.sends`. It is authoritative. A client MUST NOT set a flag
  bit or a `bone_mask` bit that belongs to a type absent from `allowed`.

  | Type | Carries | Checked in the frame header as |
  |---|---|---|
  | `"bones"` | upper-body bones (§4) | `bone_mask` bits 0–8, 17–24 — mask `0x01FE01FF` |
  | `"legs"` | upper leg, lower leg, foot, both sides (§4) | `bone_mask` bits 9–11, 13–15 — mask `0x0000EE00` |
  | `"toes"` | toes, both sides (§4) | `bone_mask` bits 12, 16 — mask `0x00011000` |
  | `"root"` | root block (§5.4) | flag `HAS_ROOT` |
  | `"fingers"` | finger block (§5.5) | flag `HAS_FINGERS` |
  | `"expressions"` | expression block (§5.6) | flag `HAS_EXPRESSIONS` |
  | `"perfect_sync"` | 52-slot ARKit mode (§5.6) | flag `PERFECT_SYNC` |
  | `"tongue"` | tongue values (§5.6) | not visible in the header; the sender sends 0 when not granted |

  `"legs"` requires `"bones"`; `"toes"` requires `"legs"`; `"perfect_sync"` and
  `"tongue"` require `"expressions"`. A declaration that violates this is rejected with
  `UNAUTHORIZED_TYPE`.

  Leg and toe bits follow the per-side order of §4 (left chain 9–12, right chain 13–16),
  which is why the two masks interleave.
- The server MAY re-send `session` at any time to change authorization or playspace.
  Clients MUST apply it immediately and SHOULD inform the user when a previously
  active data type is revoked.
- **Changing the declaration.** When the avatar or the capture pipeline changes
  mid-session, the client re-declares:

  ```json
  { "t": "caps", "sends": ["bones", "root", "expressions"] }
  ```

  The server answers with a new `session` and re-announces the peer (§2.3). The client
  MUST NOT transmit a newly declared type before that `session` arrives, and MUST stop
  transmitting a withdrawn type immediately.
- **Handshake embedding.** The `hello`/`session` exchange MAY be embedded inside
  an integrator's existing join message rather than sent as a standalone first frame. The
  `transport` and `allowed` fields carry their Posy semantics regardless of the enclosing
  envelope. Integrators with a pre-existing join step SHOULD fold these fields into that
  step rather than adding a redundant standalone handshake.

### 2.2 Clock synchronisation

The server defines the session epoch. The server MUST NOT rewrite timestamps in
forwarded packets.

Client → Server: `{ "t": "ping", "t1": <client_monotonic_ms> }`
Server → Client: `{ "t": "pong", "t1": <echo>, "ts": <server_ms_since_epoch> }`

The client MUST perform at least 5 exchanges at join. For each sample, with `t1` the
client's send time, `t2` its receive time and `rtt = t2 - t1`, compute
`offset = ts + rtt/2 - t2` (equivalently `ts - t1 - rtt/2`), and take the **median** as its
session offset, so that `session_time = capture_monotonic_ms + offset`. The client
SHOULD repeat this every 30 s and apply the new offset with a slew of ≤ 5 ms/s to
avoid pose discontinuities.

All `timestamp_ms` values written into packets MUST be
`capture_monotonic_ms + offset`.

### 2.3 Peer directory and identity

Identity is carried by the **channel**, not by the packet. The server MUST announce
the mapping once per peer over signaling:

```json
{ "t": "peers", "add": [ { "uid": "u_8f31", "consumer_id": "c_77a2",
                           "sends": ["bones", "legs", "root", "fingers", "expressions"] } ],
                "remove": [ "u_1100" ] }
```

`sends` is that peer's granted set (its `allowed`). Receivers use it to prepare the
peer's avatar before the first frame arrives; a type absent from it never arrives, and
the receiver leaves that part of the avatar in its rest state. An `add` for a `uid`
already known replaces the earlier entry. A peer whose granted set is empty has no pose
producer and is not listed; if its set becomes empty it is removed.

Receivers MUST associate an inbound data consumer with the `uid` given here. No UID
bytes appear in the pose frame. Clients MUST send their UID only in `hello`; the
server MUST reject frames arriving on an unauthenticated producer.

### 2.4 Subscription and rate tiers

One message covers active-speaker rates, grid-thumbnail rates **and** congestion
fallback:

```json
{ "t": "subscribe", "peer_uid": "u_8f31", "tier": "FULL" }
```

`tier` ∈ `FULL` | `NORMAL` | `MINIMAL` | `OFF`.

- Default tier for every peer is `default_tier` from `session`.
- The server enforces a tier by forwarding only every *N*-th frame. Because v1 sends
  full independent frames, dropping any frame is always safe.
- A receiver under load MUST reduce its own subscriptions rather than expecting the
  sender to adapt. It MAY re-upgrade at any time with no handshake.

The server MUST inform each sender of the highest tier currently demanded by any of
its subscribers, so the sender can throttle capture:

```json
{ "t": "rate", "hz": 15 }
```

Senders MUST NOT exceed the granted `hz` (tolerance +10%).

Per-subscriber rate tiering is OPTIONAL for a relay. A relay without it forwards every
accepted frame to every subscriber whose tier is not `OFF`, treats `FULL`, `NORMAL` and
`MINIMAL` alike, and bounds load through the sender `rate` grant alone. It MUST still
honour `OFF`, which needs no per-frame state.

### 2.5 Errors

```json
{ "t": "error", "code": "MALFORMED_THRESHOLD", "detail": "34 invalid frames / 10s",
  "action": "POSE_MUTED" }
```

| Code | Meaning | Server action |
|---|---|---|
| `BAD_VERSION` | Major version mismatch | Reject at channel open |
| `UNAUTHORIZED_TYPE` | Flag or bone bit set for a type not in `allowed`; invalid declaration | Drop frame, count |
| `MALFORMED_THRESHOLD` | > 30 invalid frames in 10 s | Stop forwarding until reconnect |
| `RATE_EXCEEDED` | Sender > granted hz for > 5 s | Drop excess frames |
| `UNSUPPORTED_TRANSPORT` | Requested `transport` lane not available and no alternative offered | Reject at join |

Error handling is **server-enforced, not sender-negotiated**. Receivers MUST NOT
validate packets beyond a length check — they only ever see server-validated frames.

---

## 3. Coordinate System and Retargeting (Normative)

This section is the interoperability core. Any implementation that deviates here is
non-conformant regardless of byte-level correctness.

### 3.1 The wire speaks VRM 1.0 normalized space — always

1. Coordinate system: **right-handed, Y-up, model faces +Z**, metres.
2. Every humanoid bone has **identity rotation in the T-pose**.
3. Each transmitted quaternion is the bone's **local (parent-relative) rotation delta
   from the T-pose**.
4. The hips bone additionally carries the root position block (§5.4).
5. Rotations compose from the hips outward: a bone's rotation in avatar space is its
   parent's rotation in avatar space times the bone's own quaternion,
   `q_avatar(bone) = q_avatar(parent) · q_bone` (Hamilton product; a vector is rotated as
   `q · v · q⁻¹`).
6. It follows from 2 and 3 that while a bone's parent chain is in the T-pose, the bone's
   local axes coincide with the avatar axes: **+X = the avatar's left, +Y = up,
   +Z = forward**. A positive angle about an axis is counter-clockwise when looking from
   the tip of that axis toward the origin (right-hand rule).

### 3.2 Conversion from the capture is the sender's job, never the receiver's

A receiver MUST apply incoming quaternions directly to the normalized humanoid rig of
its local instance of the sender's avatar (§0), taken in the avatar space of §3.1. It
MUST NOT need to know the sender's tracker or how the sender produced the rotations.

| Sender avatar | Sender obligation |
|---|---|
| **VRM 1.0** | None. Normalized bones are native. Read and send. |
| **VRM 0.x** | Send rotations in the avatar space of §3.1, exactly as for a VRM 1.0 avatar. If they are read from the runtime's normalized humanoid rig, convert them where that rig is not in avatar space (see below). MUST NOT read the raw glTF node rotations. VRM 0.x names the thumb joints one step further out: 0.x `ThumbProximal` / `ThumbIntermediate` are 1.0 `ThumbMetacarpal` / `ThumbProximal`. §5.5 uses the 1.0 names; a sender that derives the finger block from 0.x bone names MUST apply this mapping. |
| **MMD** | Map MMD bones to humanoid semantics, then send `q_wire = inverse(q_rest) · q_current` per bone in the parent-relative frame, where `q_rest` is that bone's rotation in the model's own rest (A- or T-) pose. `inverse(q_rest)` MUST be precomputed once at model load. |

**The wire is always in avatar space; the avatar driver adapts the rig.** Rotations on
the wire are in the avatar space of §3.1 for every avatar, whatever its file format. A
sender MUST NOT transmit rotations in the space of its own rig when that differs, and a
receiver MUST NOT expect them so.

The *avatar driver* is the code that sets rotations on a loaded model's rig, or reads
them from it. Both ends have one, since both display the sender's avatar. Where the
runtime exposes a rig that is not in avatar space, converting between the two is the
driver's job, on both ends alike:

```
sender:    capture → avatar-space rotation ─┬→ encode → wire
                                            └→ avatar driver → rig
receiver:  wire → decode → avatar-space rotation → avatar driver → rig
```

A sender that takes its rotations before the driver step needs no conversion for Posy.
A sender that reads them back from the rig MUST apply the driver's conversion in reverse
before encoding.

**VRM 0.x rigs that face −Z.** This is the known case. A VRM 0.x model faces −Z, and a
runtime may expose its normalized rig in that space without turning it; three-vrm does
(checked with 3.5.5). On such a rig the avatar's left is −X and its forward is −Z: the
rig's axes are the avatar axes turned half a turn about Y. A rotation converts between
the two by negating two components, the same in both directions:

```
q_rig = (−x, y, −z, w)   for   q_avatar = (x, y, z, w)
```

The driver for such a rig MUST apply this to every bone rotation, including the finger
rotations a receiver synthesises (§5.5), and turns the model half a turn about Y so that
it faces +Z (three-vrm: `VRMUtils.rotateVRM0`). Without it every X and Z rotation is
inverted: lowered arms are raised, knees bend forward, fingers curl upward.

Whether a driver needs the conversion depends only on the avatar file and the runtime
and is known at load. It can be checked with pose vector `p02` (§10 item 8): the shin
must point toward the avatar's back.

Receiver side: decode `q_wire` to the avatar-space rotation of §3.1, then hand it to the
avatar driver, which adapts it to the rig as above (the mirror of the sender's path).
- VRM 1.0: the rig is in avatar space; the driver applies `q_wire` directly.
- VRM 0.x facing −Z: the driver applies `q_rig = (−x, y, −z, w)` before setting the bone.
- MMD: `q_local = q_rest · q_wire`, with `q_rest` precomputed at load.

### 3.3 Missing bones

A sender that cannot solve a bone, or whose avatar lacks it (e.g. an MMD model without
`upperChest`), MUST clear that bone's bit in `bone_mask` and omit its quaternion. Receivers MUST treat an absent
bone as "hold identity relative to T-pose" — that is, apply the identity quaternion (no
rotation delta from T-pose), not "hold last value" — except during the packet-loss
concealment window defined in §8.3.

### 3.4 Rotation sense of the leg bones (Normative)

§3.1 already determines what every leg quaternion means. This section writes the result
out, so that it does not have to be derived and so that it can be tested. It adds no rule
that §3.1 does not imply; if the two ever disagree, §3.1 wins.

**T-pose of the legs.** Legs straight and vertical, feet parallel, toes pointing +Z, soles
flat on the floor.

Each row is a rotation of that bone alone about one axis, starting from the T-pose:

| Bone | Motion | Left | Right |
|---|---|---|---|
| `upperLeg` | flexion — thigh swings forward | −X | −X |
| `upperLeg` | extension — thigh swings back | +X | +X |
| `upperLeg` | abduction — leg moves away from the midline | +Z | −Z |
| `upperLeg` | external rotation — knee and toes turn outward | +Y | −Y |
| `lowerLeg` | knee flexion — heel moves toward the buttock | +X | +X |
| `foot` | dorsiflexion — toes lift toward the shin | −X | −X |
| `foot` | plantarflexion — toes point down | +X | +X |
| `foot` | toe-out — foot turns outward about the vertical axis | +Y | −Y |
| `foot` | eversion — outer edge of the foot lifts | +Z | −Z |
| `toes` | extension — toes bend upward | −X | −X |
| `toes` | flexion — toes curl downward | +X | +X |

Motions about X have the same sign on both sides. Motions about Y and Z are mirrored,
because "outward" is +X for the left leg and −X for the right.

- A motion that combines several rows is still **one quaternion per bone**. Posy defines
  no Euler order. A sender that starts from anatomical angles composes them itself and
  transmits the result; the receiver applies the quaternion as is (§3.2).
- The wire does not restrict a bone to anatomically possible rotations. A knee is a hinge
  on a human; `lowerLeg` may still carry any rotation.
- The hips quaternion (bit 0) rotates both leg chains with it (§3.1 item 5). Where the
  hips sit above the floor is carried separately as `h` (§5.4, §8.5).

`testvectors/poses/` holds one pose per table group and the seated and kneeling poses
that a full-body sender must be able to express, each with the joint positions the
quaternions produce on a reference skeleton. A wrong axis, sign, side or product order
moves a joint by tens of centimetres there, which the frame vectors cannot detect.

---

## 4. Bone Index Table (Normative)

`bone_mask` is a `u64`. Bit *n* set ⇒ the quaternion for bone *n* is present.
Quaternions appear in the payload in **ascending bit order**.

| Bit | Bone | Bit | Bone |
|---|---|---|---|
| 0 | hips | 28 | leftIndexProximal |
| 1 | spine | 29 | leftIndexIntermediate |
| 2 | chest | 30 | leftIndexDistal |
| 3 | upperChest | 31 | leftMiddleProximal |
| 4 | neck | 32 | leftMiddleIntermediate |
| 5 | head | 33 | leftMiddleDistal |
| 6 | leftEye | 34 | leftRingProximal |
| 7 | rightEye | 35 | leftRingIntermediate |
| 8 | jaw | 36 | leftRingDistal |
| 9 | leftUpperLeg | 37 | leftLittleProximal |
| 10 | leftLowerLeg | 38 | leftLittleIntermediate |
| 11 | leftFoot | 39 | leftLittleDistal |
| 12 | leftToes | 40 | rightThumbMetacarpal |
| 13 | rightUpperLeg | 41 | rightThumbProximal |
| 14 | rightLowerLeg | 42 | rightThumbDistal |
| 15 | rightFoot | 43 | rightIndexProximal |
| 16 | rightToes | 44 | rightIndexIntermediate |
| 17 | leftShoulder | 45 | rightIndexDistal |
| 18 | leftUpperArm | 46 | rightMiddleProximal |
| 19 | leftLowerArm | 47 | rightMiddleIntermediate |
| 20 | leftHand | 48 | rightMiddleDistal |
| 21 | rightShoulder | 49 | rightRingProximal |
| 22 | rightUpperArm | 50 | rightRingIntermediate |
| 23 | rightLowerArm | 51 | rightRingDistal |
| 24 | rightHand | 52 | rightLittleProximal |
| 25 | leftThumbMetacarpal | 53 | rightLittleIntermediate |
| 26 | leftThumbProximal | 54 | rightLittleDistal |
| 27 | leftThumbDistal | 55–63 | *reserved, MUST be 0* |

**v1 constraint:** bits **25–54** (all finger bones) MUST be 0. Fingers are carried by
the compact finger block (§5.5).

**Bone bits by declared type (Normative).** A sender sets only bits of types it was
granted (§2.1):

| Type | Bits | Bones | Mask |
|---|---|---|---|
| `bones` | 0–8, 17–24 | spine, head, eyes, jaw, arms | `0x01FE01FF` |
| `legs` | 9, 10, 11, 13, 14, 15 | leftUpperLeg, leftLowerLeg, leftFoot, rightUpperLeg, rightLowerLeg, rightFoot | `0x0000EE00` |
| `toes` | 12, 16 | leftToes, rightToes | `0x00011000` |

A sender granted `legs` sends all six leg bones; one granted `toes` also sends both toe
bones. §3.3 still applies per frame: a bone that cannot be solved in a given frame has
its bit cleared in that frame, and the receiver treats it as identity. A receiver MUST
decode every valid frame, whichever of the peer's types it chooses to render.

**Typical v1 upper-body mask** = bits 0,1,2,4,5,17,18,19,20,21,22,23,24 → 13 bones.

---

## 5. Packet Format (Bit-Level, Normative)

**All multi-byte integers are little-endian.**

### 5.1 Layout

```
Offset  Size  Field
------  ----  ---------------------------------------------
  0      1    u8   version          (= 2 in 1.2; the minor revision, §9)
  1      1    u8   flags
  2      2    u16  seq
  4      4    u32  timestamp_ms     (ms since session epoch)
  8      8    u64  bone_mask
 16     4*N   u32  quaternions[N]   N = popcount(bone_mask)
  +      8    root block            if flags bit 1
  +     24    finger block          if flags bit 2
  +   18|54   expression block      if flags bit 3
```

Total length MUST equal:
`16 + 4*popcount(bone_mask) + 8*b1 + 24*b2 + (b3 ? (b0 ? 54 : 18) : 0)`

A frame whose actual length differs MUST be treated as malformed.

### 5.2 Flags

| Bit | Name | Meaning |
|---|---|---|
| 0 | `PERFECT_SYNC` | 0 = Standard-Sync (16 expressions), 1 = Perfect-Sync (52 ARKit) |
| 1 | `HAS_ROOT` | Root position block present |
| 2 | `HAS_FINGERS` | Finger block present |
| 3 | `HAS_EXPRESSIONS` | Expression block present |
| 4 | `IDLE` | Sender is idle/AFK; receiver MAY skip interpolation work |
| 5–7 | reserved | MUST be 0, MUST be ignored on receive |

### 5.3 Quaternion encoding — smallest-three

Sender:
1. Normalise `q`.
2. Let `i` = index of the component with the largest absolute value (0=x,1=y,2=z,3=w).
3. If `q[i] < 0`, negate all four components (q and −q are the same rotation). The
   dropped component is therefore always ≥ 0.
4. Take the three remaining components in **ascending original index order** → `a,b,c`.
   Each lies in `[−1/√2, +1/√2]`.
5. Quantise: `e = round((v + 0.70710678) / 1.41421356 * 1023)`, clamped to `[0,1023]`.
6. Pack into a `u32`:

```
bit 31..30 : i          (2 bits)
bit 29..20 : a_enc      (10 bits)
bit 19..10 : b_enc      (10 bits)
bit  9..0  : c_enc      (10 bits)
```

Receiver:
1. Unpack; `v = e / 1023 * 1.41421356 - 0.70710678` for each of a,b,c.
2. `dropped = sqrt(max(0, 1 - a² - b² - c²))`, inserted at index `i`.
3. **The receiver MUST renormalise the reconstructed quaternion.** Quantisation error
   guarantees it is not exactly unit length.

Worst-case angular error of this encoding is ≈ 0.25°, well below tracker noise.
(The identity quaternion reconstructs with ~0.14° error; the worst case over a large
sample is ~0.25°.)

### 5.4 Root block (8 B)

```
0  2  u16  x    playspace-normalised, 0 = left edge, 65535 = right edge
2  2  u16  y    playspace-normalised, 0 = top edge,  65535 = bottom edge
4  2  i16  z    depth in millimetres, 0 if unused
6  2  u16  h    hips height, in units of 1/32768 of the standing hip height
```

`x`, `y` and `z` place the avatar in the room. Coordinates are normalised against the
`playspace` announced in `session`, so the server can resize the playspace without a
format change. Receivers MUST clamp to range.

`h` places the hips relative to the avatar's own floor line and does not move the avatar
in the room. `h / 32768` is the height of the hips above the floor as a fraction of the
**standing hip height** `H`: the height of the hips bone above the lowest point of the
feet in the avatar's T-pose. `32768` = standing, `0` = hips on the floor, values above
`32768` (up to ≈ 2.0) = raised, e.g. a jump. Sender rules are in §8.5.

If `HAS_ROOT` is clear, the receiver MUST keep the avatar's last known position and
hips height.

### 5.5 Finger block (24 B)

Left hand first (12 B), then right hand (12 B). Per hand:

```
0  1  u8   thumb_curl
1  1  i8   thumb_splay
2  1  u8   index_curl
3  1  i8   index_splay
4  1  u8   middle_curl
5  1  i8   middle_splay
6  1  u8   ring_curl
7  1  i8   ring_splay
8  1  u8   little_curl
9  1  i8   little_splay
10 1  u8   thumb_opposition
11 1  u8   reserved (MUST be 0)
```

**Semantics.** Rationale: one byte gives 256 levels — far more precision than hand
tracking delivers. What a single curl byte lacks is *degrees of freedom*, which is
why splay and thumb opposition are added rather than more curl bits.

- **Curl** (`0` = fully extended … `255` = fully curled) drives all three joints of the
  finger with a fixed distribution. Maximum flexion angles at curl `255`:

  | Joint | Max flexion |
  |---|---|
  | Proximal | 90° |
  | Intermediate | 110° |
  | Distal | 70° |

  For the thumb, curl drives `thumbProximal` (60°) and `thumbDistal` (80°) only.
  Flexion is linear in the curl byte.

All axes below are the bone's local axes in the VRM 1.0 normalized T-pose, where they
coincide with the avatar axes (§3.1 item 6). Angles follow the right-hand rule.

- **Flexion axis, index to little finger:** **Z**, signed so that fingertips move toward
  **−Y** (into the palm): negative Z-rotation on the left hand, positive on the right.

- **Flexion axis, thumb:** **Y**, signed so that the thumb tip moves toward the fingers,
  across the palm: positive Y-rotation on the left hand, negative on the right. The thumb
  lies in the plane of the palm in the T-pose and points forward and outward; about Z it
  would bend down and back toward the wrist, away from the palm.

- **Splay** (`−127` … `+127` → `−15°` … `+15°`) is applied to the **proximal bone
  only** (`thumbProximal` for the thumb, not `thumbMetacarpal`), about **Y**. Positive = abduction toward the thumb side: negative Y-rotation
  on the left hand, positive on the right. For the thumb this is the axis of its flexion,
  in the opposite sense: positive thumb splay opens the thumb away from the fingers.

- **Order on the proximal bone**, which carries both: `q = q_splay · q_curl` (§3.1
  item 5: the finger curls in the plane it was splayed into).

- **Thumb opposition** (`0` … `255` → `0°` … `60°`) rotates `thumbMetacarpal` about
  **X**, positive on both hands: the thumb moves toward −Y and under the palm.

Receivers MUST synthesise the 30 finger bone rotations from this block. Senders MUST
NOT also send finger bones via `bone_mask` in v1.

`testvectors/poses/hand-skeleton.json` plus `f01`–`f07` pin this synthesis: each carries the
curl / splay / opposition bytes and the joint positions they produce on a reference hand.
A wrong flexion axis (the thumb about Z rather than Y), a flipped sign, or the wrong product
order on a proximal bone moves a joint by a centimetre or more there, which the frame
vectors cannot detect (§10 item 9).

**Integration note.** The reduction from per-joint bone rotations to the curl/splay/
opposition parameterisation is integration-layer work (sender-side). Posy intentionally
keeps individual finger joint rotations off-wire; senders that operate on per-joint
rotations (e.g. a full-skeleton IK solver) reduce them to the five-finger model before
encoding.

### 5.6 Expression block

#### Standard-Sync (18 B) — `PERFECT_SYNC` = 0

16 one-byte expression slots, then `i8` gaze yaw, `i8` gaze pitch.

| Slot | Name | Type | Value |
|---|---|---|---|
| 0 | `blinkLeft` | `u8` | `v / 255` → 0.0 … 1.0 |
| 1 | `blinkRight` | `u8` | `v / 255` |
| 2 | `aa` | `u8` | `v / 255` |
| 3 | `ih` | `u8` | `v / 255` |
| 4 | `ou` | `u8` | `v / 255` |
| 5 | `ee` | `u8` | `v / 255` |
| 6 | `oh` | `u8` | `v / 255` |
| 7 | `happy` | `u8` | `v / 255` |
| 8 | `angry` | `u8` | `v / 255` |
| 9 | `sad` | `u8` | `v / 255` |
| 10 | `relaxed` | `u8` | `v / 255` |
| 11 | `surprised` | `u8` | `v / 255` |
| 12 | `neutral` | `u8` | `v / 255` |
| 13 | `tongueOut` | `u8` | `v / 255` — protrusion |
| 14 | `tongueX` | `i8` | `v / 127` → −1.0 … +1.0, positive = toward the avatar's own left |
| 15 | `tongueY` | `i8` | `v / 127` → −1.0 … +1.0, positive = upward |

Slots 14 and 15 are two's-complement `i8`, like gaze and finger splay: `0` is the
centred tongue. `−128` MUST NOT be sent; receivers clamp it to `−127`.

**Tongue rules.**
- A sender not granted `"tongue"` (§2.1) MUST send 0 in slots 13–15.
- `tongueX` / `tongueY` apply only while `tongueOut` > 0; receivers MUST ignore them
  when `tongueOut` is 0. A sender that tracks protrusion but not direction sends 0 in
  both.
- In Perfect-Sync, protrusion is ARKit index 51 (`tongueOut`, Appendix A), likewise 0
  without the `"tongue"` grant. Perfect-Sync carries no tongue direction (§11).

#### Perfect-Sync (54 B) — `PERFECT_SYNC` = 1

`u8[52]` ARKit blendshape weights in the canonical order of Appendix A, then the same
two gaze bytes.

A sender MUST NOT set `PERFECT_SYNC` unless `"perfect_sync"` is in `allowed`.

#### Gaze

`i8` values, `−127 … +127` mapped linearly to `−45° … +45°`.
- **yaw:** positive = toward the avatar's own left.
- **pitch:** positive = upward.

Receivers SHOULD drive `leftEye`/`rightEye` from gaze rather than from bone bits 6–7;
if both are present, the gaze bytes take precedence.

### 5.7 Sequence numbers

`seq` increments by 1 per emitted frame and wraps modulo 2¹⁶ (~36 min at 30 Hz).
Receivers MUST compare using modular arithmetic:

```
is_newer(a, b) = (int16_t)(a - b) > 0
```

Frames older than the newest frame already **released for playout** MUST be discarded;
frames that arrive out of order while still inside the jitter buffer are reordered by `seq`
(§8.1). `timestamp_ms` wraps at ~49.7 days and MUST be compared the same way as `int32_t`.

---

## 6. Sizing and Bandwidth (Informative)

Typical Standard-Sync upper-body frame:

```
header + mask        16 B
13 quaternions       52 B
root                  8 B
fingers              24 B
expressions          18 B
                 = 118 B payload
```

Perfect-Sync frame = 154 B. Add ~50 B UDP+DTLS+SCTP overhead ⇒ ~168 B / ~204 B on wire.
A full-body sender adds 24 B (`legs`) or 32 B (`legs` + `toes`).
On the WebSocket lane (§1.1) the per-frame overhead differs — a WebSocket binary
frame adds a small header (2–14 B) over TCP/TLS rather than UDP/DTLS/SCTP — but the figures
below are the right order of magnitude for either lane.

| Tier | Hz | On-wire per stream |
|---|---|---|
| FULL | 30 | ~40 kbit/s |
| NORMAL | 15 | ~20 kbit/s |
| MINIMAL | 5 | ~6.6 kbit/s |

Pose data is smaller than the accompanying Opus stream and roughly 70× smaller than
raw VMC.

**50-person room, realistic tiering** (1 speaker FULL, 49 peers MINIMAL):
- Per client downstream: ~358 kbit/s (~45 KB/s) — trivial.
- **Server upstream: ~18 Mbit/s.** Feasible on fibre, not on typical consumer upload.

**50-person room, all NORMAL (15 Hz):** server upstream ≈ **49 Mbit/s**.
**All FULL (30 Hz):** ≈ **98 Mbit/s**.

The per-client cost is negligible; the SFU's *upload* is the scaling limit. A
"50-person VTuber rave" is comfortable for every participant, but the server needs a
datacentre or fibre-grade uplink, not a home connection.

---

## 7. Sender Behaviour

- Senders SHOULD apply One-Euro filtering (or equivalent) before quantisation. This is
  what allows low send rates to look smooth.
- Default send rate is `NORMAL` (15 Hz). With client-side One-Euro smoothing and
  receiver-side slerp, 15 Hz is visually sufficient for body motion. `FULL` (30 Hz)
  SHOULD be used only for the active speaker and for Perfect-Sync faces, where fast
  hand and mouth motion is visible.
- Senders MUST honour the `rate` message (§2.4).
- Senders SHOULD set `IDLE` when no significant motion has occurred for 2 s and drop to
  `MINIMAL` until motion resumes.

---

## 8. Receiver Behaviour (Normative)

### 8.1 Jitter buffer
- Target depth: 2 frames, clamped to **50–100 ms**.
- Frames arriving after their playout deadline MUST be discarded, not played late.
- Reordered frames MUST be reordered by `seq` inside the buffer; duplicates dropped.

### 8.2 Interpolation
- Rotations: **slerp** between the two newest buffered frames, parameterised by
  `timestamp_ms`.
- Blendshapes, finger curls/splays, gaze, root position and hips height: **linear
  interpolation**, same timing.
- Playout time MUST be derived from the audio clock of the same peer so that lips and
  voice remain aligned.
- Receivers MAY apply a light low-pass filter (e.g. One-Euro) to the interpolated output
  to round off the velocity discontinuities at frame boundaries. This is not a substitute
  for sender-side filtering (§7): it cannot recover detail lost to downsampling, and it
  adds latency on top of the jitter buffer (§8.1), so it SHOULD be weak and MUST be
  optional.

### 8.3 Packet-loss concealment
1. **0 – 250 ms gap:** continue the last motion with decaying angular velocity
   (exponential decay, ~150 ms half-life).
2. **250 ms – 1 s:** hold the last received pose.
3. **> 1 s:** ease to the avatar's idle pose over 500 ms.
4. On resumption, blend back in over 200 ms to avoid a visible snap.

### 8.4 Audio-driven mouth shapes (Optional)
Receivers MAY synthesise `aa/ih/ou/ee/oh` from the incoming Opus stream instead of
using the transmitted viseme weights. This guarantees lip-sync alignment and saves
bytes, **but it only works for speech** — laughing, humming, coughing and background
noise produce wrong mouth shapes. Implementations offering this MUST make it a
user-visible option and MUST fall back to transmitted weights when the sender's audio
track is muted or absent.

### 8.5 Hips height (Normative)

Leg rotations alone do not say where the hips are: a crouch, a seat, a kneel and a jump
can all carry similar leg angles. The sender therefore transmits the hips height `h`
(§5.4), and the receiver applies it.

**Sender.**
1. `h` is the height of the hips above the floor divided by the standing hip height
   `H` of the sender's avatar, for the pose as the sender's own avatar shows it.
2. A sender with a floor reference (calibrated trackers) derives `h` from the tracked
   hips height, scaled by the performer's standing hips height from calibration.
3. A sender without a floor reference (e.g. a single camera) estimates `h` from the
   solved pose; Appendix D gives one method.
4. A sender that was not granted `legs` sends `h = 32768`.
5. `h` SHOULD be filtered like any other tracked value (§7).

**Receiver.**
1. Place the hips of the sender's avatar at `h / 32768 × H` above that avatar's floor
   line, with `H` taken from the receiver's local instance of the avatar.
2. Interpolate `h` per §8.2.
3. The receiver performs no forward kinematics, grounding or clamping of its own. The
   sender renders the same avatar and is responsible for a plausible result.

This covers standing, crouching, sitting with one or both feet off the floor, crossed
legs, kneeling, lying down and jumping without any pose-specific rule on the receiver.
`z` keeps its depth meaning; senders MUST NOT encode height in `z`.

---

## 9. Versioning and Extensibility

- The **major** version lives in the channel `protocol` string (`posy/1`). Incompatible
  versions therefore fail at channel negotiation, not at packet parse time. On the WebSocket
  lane (§1.1), which has no `RTCDataChannel`-style `protocol` string, the major
  version is carried by `protocol` in the `hello` handshake (§2.1) instead, and a mismatch is
  answered with a `BAD_VERSION` error.
- The `version` byte carries the **minor** revision of the spec release the sender
  implements: a 1.y sender writes y. 1.2 writes 2. (1.0 and 1.1 both wrote 1.) The value
  is 0–15 for every 1.x release, which is all that `version >> 4 == 0` tests; it does not
  encode the major version, which is in the `protocol` string. Receivers MUST accept any
  value 0–15 and MUST ignore unknown flag bits and unknown `bone_mask` bits. A receiver
  MAY use the value to tell which revision's layout a frame follows while the soft lock
  allows layout changes. If a minor revision above 15 were ever needed, releases continue
  as patch releases of 1.15 and the byte stays 15.
- **Soft lock.** While the format is soft-locked (see Status), a justified layout or
  signaling change ships as a 1.x revision under `posy/1`. Once the maintainers declare
  the format frozen, any such change requires `posy/2`.
- Extension mechanism: reserved flag bits 5–7, reserved bone bits 55–63,
  and the reserved finger byte.

---

## 10. Conformance

An implementation is conformant if it:
1. Uses the exact packet layout of §5 with little-endian ordering.
2. Emits and consumes rotations in VRM 1.0 normalized space per §3.
3. Renormalises reconstructed quaternions.
4. Uses the bone index table of §4 without modification.
5. Never retransmits pose frames.
6. Declares what it transmits (§2.1) and stays within the granted set.
7. Honours server `allowed`, `rate` and `error` messages.
8. If it sends or renders leg bones: reproduces the joint positions of the pose vectors
   in `testvectors/poses/` within their tolerance (§3.4).
9. If it renders fingers: synthesises the finger-bone rotations from the §5.5 block so that
   the joint positions of the finger pose vectors (`testvectors/poses/f*.json`) are
   reproduced within their tolerance (§5.5).

---

## 11. Deferred to v2 (Informative)

Explicitly out of scope for v1, listed so v1 does not accidentally block them:
- **Keyframe + delta encoding** (full frame every 1 s, changed bones in between).
  Requires reliable resync logic; the bandwidth saving is not worth it at 118 B.
- **Server-side field stripping** as a congestion path (drop fingers → hands → body).
  Requires the server to re-encode packets, which v1 forbids. v1 degrades by rate only.
- **Props, scene state, 3D playspaces.**
- **Tongue direction in Perfect-Sync.** The 52 ARKit slots have no direction values;
  adding them means growing the 54 B block by two bytes. Not justified yet: a sender
  that needs tongue direction can use Standard-Sync.

---

## Appendix A — Perfect-Sync Blendshape Order (Normative)

Indices 0–51, the 52 ARKit `ARFaceAnchor.BlendShapeLocation` names sorted ascending by
code unit. Implementations MUST generate this table programmatically from that sorted
list rather than transcribing it.

| Idx | Blendshape | Idx | Blendshape | Idx | Blendshape | Idx | Blendshape |
|---:|---|---:|---|---:|---|---:|---|
| 0 | `browDownLeft` | 13 | `eyeLookInRight` | 26 | `mouthClose` | 39 | `mouthRollLower` |
| 1 | `browDownRight` | 14 | `eyeLookOutLeft` | 27 | `mouthDimpleLeft` | 40 | `mouthRollUpper` |
| 2 | `browInnerUp` | 15 | `eyeLookOutRight` | 28 | `mouthDimpleRight` | 41 | `mouthShrugLower` |
| 3 | `browOuterUpLeft` | 16 | `eyeLookUpLeft` | 29 | `mouthFrownLeft` | 42 | `mouthShrugUpper` |
| 4 | `browOuterUpRight` | 17 | `eyeLookUpRight` | 30 | `mouthFrownRight` | 43 | `mouthSmileLeft` |
| 5 | `cheekPuff` | 18 | `eyeSquintLeft` | 31 | `mouthFunnel` | 44 | `mouthSmileRight` |
| 6 | `cheekSquintLeft` | 19 | `eyeSquintRight` | 32 | `mouthLeft` | 45 | `mouthStretchLeft` |
| 7 | `cheekSquintRight` | 20 | `eyeWideLeft` | 33 | `mouthLowerDownLeft` | 46 | `mouthStretchRight` |
| 8 | `eyeBlinkLeft` | 21 | `eyeWideRight` | 34 | `mouthLowerDownRight` | 47 | `mouthUpperUpLeft` |
| 9 | `eyeBlinkRight` | 22 | `jawForward` | 35 | `mouthPressLeft` | 48 | `mouthUpperUpRight` |
| 10 | `eyeLookDownLeft` | 23 | `jawLeft` | 36 | `mouthPressRight` | 49 | `noseSneerLeft` |
| 11 | `eyeLookDownRight` | 24 | `jawOpen` | 37 | `mouthPucker` | 50 | `noseSneerRight` |
| 12 | `eyeLookInLeft` | 25 | `jawRight` | 38 | `mouthRight` | 51 | `tongueOut` |

`tongueOut` is index 51 (the last of the 52 names); the block is 52 bytes. The machine-readable
form of this table is `spec/blendshape-order.json`, generated by `scripts/generate-spec-tables.mjs`.

---

## Appendix B — Reference Decode Pseudocode (Informative)

```c
bool posy_decode(const uint8_t *p, size_t len, Frame *out) {
    if (len < 16) return false;
    out->version   = p[0];
    if ((out->version >> 4) != 0) return false;   // 1.x only: minor revision 0–15 (§9)
    out->flags     = p[1];
    out->seq       = rd_u16(p + 2);
    out->timestamp = rd_u32(p + 4);
    out->bone_mask = rd_u64(p + 8);

    int b0 = out->flags & 1, b1 = (out->flags >> 1) & 1,
        b2 = (out->flags >> 2) & 1, b3 = (out->flags >> 3) & 1;
    int n  = popcount64(out->bone_mask);
    size_t need = 16 + 4*n + 8*b1 + 24*b2 + (b3 ? (b0 ? 54 : 18) : 0);
    if (len != need) return false;                // malformed

    const uint8_t *q = p + 16;
    int k = 0;
    for (int bit = 0; bit < 64; ++bit)
        if (out->bone_mask & (1ull << bit))
            out->rot[bit] = unpack_smallest3(rd_u32(q + 4 * (k++)));
    q += 4 * n;

    if (b1) { out->root_x = rd_u16(q); out->root_y = rd_u16(q+2);
              out->root_z = (int16_t)rd_u16(q+4);
              out->root_h = rd_u16(q+6); q += 8; }
    if (b2) { memcpy(out->fingers, q, 24); q += 24; }
    if (b3) { int m = b0 ? 52 : 16;
              memcpy(out->expr, q, m); q += m;
              out->gaze_yaw = (int8_t)q[0]; out->gaze_pitch = (int8_t)q[1]; }
    return true;
}

Quat unpack_smallest3(uint32_t w) {
    int i = w >> 30;
    float v[3];
    v[0] = ((w >> 20) & 0x3FF) / 1023.0f * 1.41421356f - 0.70710678f;
    v[1] = ((w >> 10) & 0x3FF) / 1023.0f * 1.41421356f - 0.70710678f;
    v[2] = ( w        & 0x3FF) / 1023.0f * 1.41421356f - 0.70710678f;
    float s = 1.0f - v[0]*v[0] - v[1]*v[1] - v[2]*v[2];
    float d = sqrtf(s > 0.0f ? s : 0.0f);
    float c[4]; int j = 0;
    for (int n2 = 0; n2 < 4; ++n2) c[n2] = (n2 == i) ? d : v[j++];
    return quat_normalize((Quat){c[0], c[1], c[2], c[3]});  // MUST renormalise
}
```

---

## Appendix C — Integration Notes (Informative)

**Dependency risk.** Posy is deliberately **solver-agnostic**: nothing in §3–§5 
references MediaPipe or Kalidokit, so any source that can produce VRM 1.0 
normalized rotations (OpenXR body tracking, VMC bridge, IK from controllers, 
a canned animation) is a valid sender.

**SFU requirements.** Any SFU may be used. It MUST support per-producer data-channel
forwarding and the signaling messages of §2; per-subscriber frame dropping is needed only
for rate tiering, which is optional (§2.4).
mediasoup satisfies this natively; the protocol does not depend on it. A server-relay
deployment that cannot provide native server-side WebRTC MAY instead relay pose frames over
the WebSocket lane (§1.1); the same forwarding and dropping rules apply, and the server still MUST NOT modify forwarded frame bytes (§1.2).

---

## Appendix D — Estimating hips height without a floor reference (Informative)

For senders whose capture gives joint rotations but no height above the floor (§8.5,
sender rule 3). It assumes that whatever part of the legs is lowest rests on the floor.

Per avatar, once, in the T-pose: for each contact point `c` — both feet (ankle), both
toes if the avatar has them, both knees — record its clearance `clear[c]`, the height of
that bone's origin above the floor line. For the knees use the shin radius `r_shin`
instead, since a knee only touches the floor when kneeling.

Per frame, with the solved rotations applied and the hips at the origin:

```
h_est = 0
for c in contacts:
    y = world_y(c)                 // ≤ 0 when the point is below the hips
    k = clear[c]
    if c is a foot and its local +Y axis points below the horizontal:
        k = r_shin                 // sole up: the foot rests on its instep
    h_est = max(h_est, k - y)
h = round(h_est / H * 32768)       // clamp to 0..65535
```

In the T-pose this yields exactly `H`, so `h = 32768`. The sole-up case is the kneeling
pose with the insteps on the floor: the ankle then lies as low as the shin, and its T-pose
clearance would put the hips too high by the difference.

The estimate is wrong whenever nothing in the contact set touches the floor: both feet
off the floor on a seat, or a jump. A sender that knows the performer is seated SHOULD
hold `h` at the seat height instead (a user setting, or the last value before both feet
lifted) rather than let the avatar drop.
