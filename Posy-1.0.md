# POSY — Pose Synchronization
**Version:** 1.0 (draft)
**Status:** Implementable draft
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

**Non-goals for v1:** delta/keyframe encoding, server-side field stripping,
physics, props, scene state.

---

## 1. Transport

### 1.1 Media and data
- Voice MUST use standard WebRTC Opus audio tracks. Posy does not define audio.
- Pose data MUST use a WebRTC (SCTP) data channel configured as:

```js
pc.createDataChannel("avatar-pose", {
  ordered: false,
  maxRetransmits: 0,
  protocol: "posy/1"
});
```

- A lost pose frame MUST NOT be retransmitted. Late frames are useless by definition.
- Every pose frame MUST fit in a single datagram. Implementations MUST NOT emit a
  pose frame larger than 1100 bytes. v1 frames are ≤ 152 bytes, so fragmentation
  never occurs.

### 1.2 Topology
The topology is **client–server**, never peer-to-peer mesh. All pose frames travel
sender → server → receiver. The server MAY drop, filter or refuse frames. The server
MUST NOT modify the byte content of a forwarded frame in v1 (this is what makes
rate-tiering a pure frame-drop operation).

### 1.3 Signaling channel
A separate **reliable, ordered** channel (WebSocket or a reliable data channel) MUST
exist for session control. All control messages in §2 travel there as UTF-8 JSON.

---

## 2. Session Layer

### 2.1 Join

Client → Server:
```json
{ "t": "hello",
  "uid": "u_8f31",
  "token": "<opaque auth token>",
  "protocol": "posy/1",
  "caps": { "perfect_sync": true, "max_rate_hz": 30, "fingers": true } }
```

Server → Client:
```json
{ "t": "session",
  "session_id": "r_412",
  "epoch_unix_ms": 1730900000000,
  "playspace": { "w": 1920, "h": 1080 },
  "allowed": ["bones", "fingers", "expressions", "root", "perfect_sync"],
  "tiers": { "FULL": 30, "NORMAL": 15, "MINIMAL": 5 },
  "default_tier": "NORMAL" }
```

- `allowed` is the authoritative list of permitted data types. A client MUST NOT set
  a flag bit for a type not present in `allowed`.
- The server MAY re-send `session` at any time to change authorization or playspace.
  Clients MUST apply it immediately and SHOULD inform the user when a previously
  active data type is revoked.

### 2.2 Clock synchronisation

The server defines the session epoch. The server MUST NOT rewrite timestamps in
forwarded packets.

Client → Server: `{ "t": "ping", "t1": <client_monotonic_ms> }`
Server → Client: `{ "t": "pong", "t1": <echo>, "ts": <server_ms_since_epoch> }`

The client MUST perform at least 5 exchanges at join, compute per-sample
`offset = ts + rtt/2 - t1`, and take the **median** as its session offset. The client
SHOULD repeat this every 30 s and apply the new offset with a slew of ≤ 5 ms/s to
avoid pose discontinuities.

All `timestamp_ms` values written into packets MUST be
`capture_monotonic_ms + offset`.

### 2.3 Peer directory and identity

Identity is carried by the **channel**, not by the packet. The server MUST announce
the mapping once per peer over signaling:

```json
{ "t": "peers", "add": [ { "uid": "u_8f31", "consumer_id": "c_77a2" } ],
                "remove": [ "u_1100" ] }
```

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

### 2.5 Errors

```json
{ "t": "error", "code": "MALFORMED_THRESHOLD", "detail": "34 invalid frames / 10s",
  "action": "POSE_MUTED" }
```

| Code | Meaning | Server action |
|---|---|---|
| `BAD_VERSION` | Major version mismatch | Reject at channel open |
| `UNAUTHORIZED_TYPE` | Flag set for a type not in `allowed` | Drop frame, count |
| `MALFORMED_THRESHOLD` | > 30 invalid frames in 10 s | Stop forwarding until reconnect |
| `RATE_EXCEEDED` | Sender > granted hz for > 5 s | Drop excess frames |

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

### 3.2 Conversion is the sender's job, never the receiver's

A receiver MUST apply incoming quaternions directly to its own normalized humanoid
rig. It MUST NOT need to know the sender's avatar type, skeleton or tracker.

| Sender avatar | Sender obligation |
|---|---|
| **VRM 1.0** | None. Normalized bones are native. Read and send. |
| **VRM 0.x** | Read from the normalized humanoid rig exposed by the runtime (e.g. three-vrm), which already resolves the 0.x −Z facing to +Z. MUST NOT read the raw glTF node rotations. |
| **MMD** | Map MMD bones to humanoid semantics, then send `q_wire = inverse(q_rest) · q_current` per bone in the parent-relative frame, where `q_rest` is that bone's rotation in the model's own rest (A- or T-) pose. `inverse(q_rest)` MUST be precomputed once at model load. |

Receiver side:
- VRM 0.x / 1.0: apply `q_wire` to the normalized rig directly.
- MMD: `q_local = q_rest · q_wire`, with `q_rest` precomputed at load.

### 3.3 Missing bones

A sender that cannot solve a bone (e.g. an MMD model without `upperChest`) MUST clear
that bone's bit in `bone_mask` and omit its quaternion. Receivers MUST treat an absent
bone as "hold identity relative to T-pose", not as "hold last value", except during
the packet-loss concealment window defined in §8.3.

---

## 4. Bone Index Table (Normative)

`bone_mask` is a `u64`. Bit *n* set ⇒ the quaternion for bone *n* is present.
Quaternions appear in the payload in **ascending bit order**.

| Bit | Bone | Bit | Bone |
|---|---|---|---|
| 0 | hips | 28 | leftIndexDistal |
| 1 | spine | 29 | leftMiddleProximal |
| 2 | chest | 30 | leftMiddleIntermediate |
| 3 | upperChest | 31 | leftMiddleDistal |
| 4 | neck | 32 | leftRingProximal |
| 5 | head | 33 | leftRingIntermediate |
| 6 | leftEye | 34 | leftRingDistal |
| 7 | rightEye | 35 | leftLittleProximal |
| 8 | jaw | 36 | leftLittleIntermediate |
| 9 | leftUpperLeg | 37 | leftLittleDistal |
| 10 | leftLowerLeg | 38 | rightThumbMetacarpal |
| 11 | leftFoot | 39 | rightThumbProximal |
| 12 | leftToes | 40 | rightThumbDistal |
| 13 | rightUpperLeg | 41 | rightIndexProximal |
| 14 | rightLowerLeg | 42 | rightIndexIntermediate |
| 15 | rightFoot | 43 | rightIndexDistal |
| 16 | rightToes | 44 | rightMiddleProximal |
| 17 | leftShoulder | 45 | rightMiddleIntermediate |
| 18 | leftUpperArm | 46 | rightMiddleDistal |
| 19 | leftLowerArm | 47 | rightRingProximal |
| 20 | leftHand | 48 | rightRingIntermediate |
| 21 | rightShoulder | 49 | rightRingDistal |
| 22 | rightUpperArm | 50 | rightLittleProximal |
| 23 | rightLowerArm | 51 | rightLittleIntermediate |
| 24 | rightHand | 52 | rightLittleDistal |
| 25 | leftThumbMetacarpal | 53 | *reserved* |
| 26 | leftThumbProximal | 54 | *reserved* |
| 27 | leftThumbDistal | 55–63 | *reserved, MUST be 0* |

**v1 constraint:** bits **25–52** (all finger bones) MUST be 0. Fingers are carried by
the compact finger block (§5.5). Bits 9–16 (legs/feet) MAY be used but are OPTIONAL;
receivers MUST handle their absence.

**Typical v1 upper-body mask** = bits 0,1,2,4,5,17,18,19,20,21,22,23,24 → 13 bones.

---

## 5. Packet Format (Bit-Level, Normative)

**All multi-byte integers are little-endian.**

### 5.1 Layout

```
Offset  Size  Field
------  ----  ---------------------------------------------
  0      1    u8   version          (= 1)
  1      1    u8   flags
  2      2    u16  seq
  4      4    u32  timestamp_ms     (ms since session epoch)
  8      8    u64  bone_mask
 16     4*N   u32  quaternions[N]   N = popcount(bone_mask)
  +      6    root block            if flags bit 1
  +     24    finger block          if flags bit 2
  +   18|54   expression block      if flags bit 3
```

Total length MUST equal:
`16 + 4*popcount(bone_mask) + 6*b1 + 24*b2 + (b3 ? (b0 ? 54 : 18) : 0)`

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

Worst-case angular error of this encoding is ≈ 0.1°, well below tracker noise.

### 5.4 Root position block (6 B)

```
0  2  u16  x    playspace-normalised, 0 = left edge, 65535 = right edge
2  2  u16  y    playspace-normalised, 0 = top edge,  65535 = bottom edge
4  2  i16  z    depth in millimetres, 0 if unused
```

Coordinates are normalised against the `playspace` announced in `session`, so the
server can resize the playspace without a format change. Receivers MUST clamp to
range. If `HAS_ROOT` is clear, the receiver MUST keep the avatar's last known position.

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

- **Flexion axis:** in the VRM 1.0 normalized T-pose, rotation about the bone's local
  axis aligned with **world +Z**, signed so that fingertips move toward **−Y** (into
  the palm) on both hands. (Concretely: negative Z-rotation on the left hand, positive
  on the right.)

- **Splay** (`−127` … `+127` → `−15°` … `+15°`) is applied to the **proximal joint
  only**, about the bone's local axis aligned with world **+Y** in T-pose. Positive =
  abduction toward the thumb side.

- **Thumb opposition** (`0` … `255` → `0°` … `60°`) rotates `thumbMetacarpal` about the
  world-**X**-aligned axis, bringing the thumb across the palm.

Receivers MUST synthesise the 30 finger bone rotations from this block. Senders MUST
NOT also send finger bones via `bone_mask` in v1.

### 5.6 Expression block

#### Standard-Sync (18 B) — `PERFECT_SYNC` = 0

`u8[16]` expression weights (`0`=0.0, `255`=1.0), then `i8` gaze yaw, `i8` gaze pitch.

| Idx | Expression | Idx | Expression |
|---|---|---|---|
| 0 | blinkLeft | 8 | angry |
| 1 | blinkRight | 9 | sad |
| 2 | aa | 10 | relaxed |
| 3 | ih | 11 | surprised |
| 4 | ou | 12 | neutral |
| 5 | ee | 13 | *reserved (MUST be 0)* |
| 6 | oh | 14 | *reserved (MUST be 0)* |
| 7 | happy | 15 | *reserved (MUST be 0)* |

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

Frames older than the newest received frame MUST be discarded. `timestamp_ms` wraps at
~49.7 days and MUST be compared the same way as `int32_t`.

---

## 6. Sizing and Bandwidth (Informative)

Typical Standard-Sync upper-body frame:

```
header + mask        16 B
13 quaternions       52 B
root                  6 B
fingers              24 B
expressions          18 B
                 = 116 B payload
```

Perfect-Sync frame = 152 B. Add ~50 B UDP+DTLS+SCTP overhead ⇒ ~166 B / ~202 B on wire.

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
- Blendshapes, finger curls/splays, gaze and root position: **linear interpolation**,
  same timing.
- Playout time MUST be derived from the audio clock of the same peer so that lips and
  voice remain aligned.

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

---

## 9. Versioning and Extensibility

- The **major** version lives in the channel `protocol` string (`posy/1`). Incompatible
  versions therefore fail at channel negotiation, not at packet parse time.
- The `version` byte carries the **minor** revision within a major version. Receivers
  MUST accept any minor version with `version >> 4 == 0` for v1.x and MUST ignore
  unknown flag bits and unknown `bone_mask` bits.
- Extension mechanism: reserved flag bits 5–7, reserved bone bits 53–63, reserved
  expression indices 13–15, and the reserved finger byte.

---

## 10. Conformance

An implementation is conformant if it:
1. Uses the exact packet layout of §5 with little-endian ordering.
2. Emits and consumes rotations in VRM 1.0 normalized space per §3.
3. Renormalises reconstructed quaternions.
4. Uses the bone index table of §4 without modification.
5. Never retransmits pose frames.
6. Honours server `allowed`, `rate` and `error` messages.

---

## 11. Deferred to v2 (Informative)

Explicitly out of scope for v1, listed so v1 does not accidentally block them:
- **Keyframe + delta encoding** (full frame every 1 s, changed bones in between).
  Requires reliable resync logic; the bandwidth saving is not worth it at 116 B.
- **Server-side field stripping** as a congestion path (drop fingers → hands → body).
  Requires the server to re-encode packets, which v1 forbids. v1 degrades by rate only.
- **Leg / full-body tracking** as a mandatory profile.
- **Props, scene state, 3D playspaces.**

---

## Appendix A — Perfect-Sync Blendshape Order (Normative)

Indices 0–51, ARKit canonical alphabetical order:

```
 0 browDownLeft        13 eyeLookInRight     26 mouthClose          39 mouthRight
 1 browDownRight       14 eyeLookOutLeft     27 mouthDimpleLeft     40 mouthRollLower
 2 browInnerUp         15 eyeLookOutRight    28 mouthDimpleRight    41 mouthRollUpper
 3 browOuterUpLeft     16 eyeLookUpLeft      29 mouthFrownLeft      42 mouthShrugLower
 4 browOuterUpRight    17 eyeLookUpRight     30 mouthFrownRight     43 mouthShrugUpper
 5 cheekPuff           18 eyeSquintLeft      31 mouthFunnel         44 mouthSmileLeft
 6 cheekSquintLeft     19 eyeSquintRight     32 mouthLeft           45 mouthSmileRight
 7 cheekSquintRight    20 eyeWideLeft        33 mouthLowerDownLeft  46 mouthStretchLeft
 8 eyeBlinkLeft        21 eyeWideRight       34 mouthLowerDownRight 47 mouthStretchRight
 9 eyeBlinkRight       22 jawForward         35 mouthPressLeft      48 mouthUpperUpLeft
10 eyeLookDownLeft     23 jawLeft            36 mouthPressRight     49 mouthUpperUpRight
11 eyeLookDownRight    24 jawOpen            37 mouthPucker         50 noseSneerLeft
12 eyeLookInLeft       25 jawRight           38 mouthRight*         51 noseSneerRight
```
*index 38 is `mouthPucker`-adjacent; the authoritative list is the 52 ARKit
`ARFaceAnchor.BlendShapeLocation` names sorted alphabetically. Implementations MUST
generate this table programmatically from that sorted list rather than transcribing it.

Index 52 (`tongueOut`) completes the ARKit set; it occupies the last byte of the 52-byte
block.

---

## Appendix B — Reference Decode Pseudocode (Informative)

```c
bool posy_decode(const uint8_t *p, size_t len, Frame *out) {
    if (len < 16) return false;
    out->version   = p[0];
    if ((out->version >> 4) != 0) return false;   // major v1 only
    out->flags     = p[1];
    out->seq       = rd_u16(p + 2);
    out->timestamp = rd_u32(p + 4);
    out->bone_mask = rd_u64(p + 8);

    int b0 = out->flags & 1, b1 = (out->flags >> 1) & 1,
        b2 = (out->flags >> 2) & 1, b3 = (out->flags >> 3) & 1;
    int n  = popcount64(out->bone_mask);
    size_t need = 16 + 4*n + 6*b1 + 24*b2 + (b3 ? (b0 ? 54 : 18) : 0);
    if (len != need) return false;                // malformed

    const uint8_t *q = p + 16;
    int k = 0;
    for (int bit = 0; bit < 64; ++bit)
        if (out->bone_mask & (1ull << bit))
            out->rot[bit] = unpack_smallest3(rd_u32(q + 4 * (k++)));
    q += 4 * n;

    if (b1) { out->root_x = rd_u16(q); out->root_y = rd_u16(q+2);
              out->root_z = (int16_t)rd_u16(q+4); q += 6; }
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
forwarding, per-subscriber frame dropping, and the signaling messages of §2. 
mediasoup satisfies this natively; the protocol does not depend on it.