# POSY — Pose Synchronization
**Version:** 1.4.5
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

  > **A note on privacy (informational).** Posy does not mind how you move its frames,
  > and this spec ties it to no single topology. One thing is worth keeping in mind: a
  > direct peer-to-peer link reveals each participant's IP address to the others — WebRTC
  > signals the public address in its ICE candidates. Among people who already know and
  > trust each other that is usually fine; in a room that strangers can join it is an easy
  > thing to misuse. A server-relay deployment handles this for you, since peers only ever
  > see the server. If you stay peer-to-peer in a space open to strangers, consider forcing
  > a TURN relay so no one's address is on display. Pose frames are small, so relaying them
  > through a server costs very little — which often makes it the simplest *and* the kindest
  > choice for public, multi-user rooms.

- A lost pose frame MUST NOT be retransmitted. Late frames are useless by definition.
- Every pose frame MUST fit in a single datagram (SCTP) or single WebSocket message (WS).
  Implementations MUST NOT emit a pose frame larger than 1100 bytes. v1 frames with the
  defined bones and blocks are ≤ 298 bytes: 202 bytes with the compact finger block and every
  other block, or 298 bytes when fingers are carried per-joint (`finger_bones`, §4) instead of
  the compact block — the two are mutually exclusive. Declared extras (§5.8) add their declared
  size on top. Fragmentation never occurs at these sizes. Reserved `bone_mask` bits 55–63 add
  nothing: a relay rejects a frame that sets one (§1.2).

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

A relay MAY validate a frame structurally without decoding the quaternion payload. It
needs the §5.1 header and, for a sender that was granted `"extra"`, the two list lengths
of its declaration (§2.6), which it has from the handshake. It checks:
1. `version` byte: `version >> 4 == 0` (a 1.x frame; the value is the minor revision, §9).
2. Frame length exactly equals `16 + 4·popcount(bone_mask) + 8·b1 + 24·b2 + (b3 ? (b0 ? 54 : 15) : 0) + (b5 ? 4·B + V : 0)`,
   with `B` and `V` from the declaration that applies at the frame's `timestamp_ms`. A
   relay MAY instead use the sender's **current** declaration and need not retain superseded
   ones; the two differ only for frames in flight across a re-declaration, which the sender
   avoids by holding new extras until peers hold the new lists (§2.6).
3. The frame stays within the sender's granted set (§2.1). Over the whole 64-bit mask,
   `bone_mask & ~granted_mask == 0`, where `granted_mask` is the OR of the bone masks of the
   granted types (§4). A bit set outside `granted_mask` fails this check — whether it is a
   bone bit of an ungranted type, or one of the reserved bits 55–63, which belong to no type
   and so are never granted. For the flag-driven blocks, none of flag bits 0–3 and 5 is set
   for a type that was not granted. A frame with `HAS_FINGERS` set and any of bits 25–54 also
   set is malformed (the two finger carriages are mutually exclusive, §4, §5.5).

A frame failing check 1, 2 or 3 is dropped. A violation of the frame-structure rules
(a bad version, a length mismatch, a reserved bit 55–63 set, or both finger carriages at
once) counts toward `MALFORMED_THRESHOLD` (§2.5), reported once the threshold is crossed, not
per frame. A bone or flag bit set for a type the sender was not granted is counted as
`UNAUTHORIZED_TYPE` instead. Reserved flag bits 6–7 MUST NOT cause rejection: they are
reserved for extensions (§9) and ignored on receive (§5.2). The relay's length check stays
exact all the same: a frame that carries a block the relay does not know behind one of
these bits fails check 2. A receiver likewise still
decodes a frame whose mask carries an unknown bit (§5.2, §9) — the grant check above is the
relay's, not the receiver's. The relay still MUST NOT modify the byte content of frames it
does forward.

### 1.3 Signaling channel
A separate **reliable, ordered** channel (WebSocket or a reliable data channel) MUST
exist for session control. All control messages in §2 travel there as UTF-8 JSON. When
the WebSocket lane (§1.1) is in use, pose frames and this signaling channel MAY share
the same WebSocket connection — distinguished by frame type (binary pose frames vs.
UTF-8 JSON control messages) — or use separate WebSocket connections; both are conformant.

A single WebSocket MAY also carry pose frames from **more than one sender** toward a
receiver — a server multiplexing a room onto one connection. The default is one sender
per connection, where the connection itself identifies the sender (§2.3) and nothing extra
is needed. When a server does multiplex several senders onto one socket, the receiver can
no longer tell them apart by connection, so the server MUST prefix each forwarded binary
pose message with the sender's `uid` (§2.3) as a routing header **outside** the Posy frame:
one byte unsigned length `L` (1–255), then `L` bytes of the `uid` as UTF-8, then the
unmodified frame. The frame bytes are untouched — the header is transport envelope, not
frame content, so §1.2 still holds — and the receiver strips the header, matches the `uid`
to the peer it announced in `peers` (§2.3), and decodes the frame as usual.

Whether a connection carries this prefix is declared **once at the handshake**, not inferred
per message. The receiver cannot tell a prefixed message from a bare frame by inspection — a
short `uid` makes the length byte `L` fall in the `version` range (0–15, §5.1), so the two are
indistinguishable byte-for-byte. The server therefore states it in `session` (§2.1): the
boolean field **`multiplexed`** (added in 1.3.2; absent ⇒ `false`). When `multiplexed` is
`true`, **every** forwarded binary pose message on that connection carries the `uid` prefix —
including while only one sender is in the room — so the stream format never changes
mid-session as peers come and go. When it is `false` or absent, no message carries a prefix
and byte 0 is always `version`. A server that may ever multiplex MUST set `multiplexed: true`
from the start; a server that never does leaves it `false`. This header therefore appears
**only** on a connection the server declared `multiplexed`; a direct SCTP consumer, a
one-sender-per-socket WebSocket and a single-client loop (where the receiver is the sender)
leave `multiplexed` unset and never carry it. How much a receiver may trust the `uid` is a
property of the deployment, not of this format: a server that stamps it from the sender's
authenticated session (§2.3, "the server MUST reject frames arriving on an unauthenticated
producer") makes it unforgeable, which is why no separate per-frame sender tag is defined here.

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
- `multiplexed` (optional boolean, added in 1.3.2; absent ⇒ `false`) declares whether this
  connection carries the §1.3 `uid` routing prefix on its forwarded binary pose messages. When
  `true`, **every** such message is prefixed, for the whole connection, so the receiver parses a
  prefix unconditionally and never has to guess from byte 0 (which a short `uid` would make
  ambiguous). A server that may ever multiplex more than one sender onto this socket MUST set it
  `true` from the first `session`; a direct link, a one-sender-per-socket WebSocket and a
  single-client loop leave it `false`. It is a connection property, like `transport`, and is
  independent of `allowed`.
- `caps.sends` is the sender's **declaration**: the complete list of data types it will
  transmit. It MUST be the intersection of what the sender's capture pipeline delivers and
  what its current avatar can show. A type the avatar cannot show (no toe bones, no ARKit
  blendshapes) MUST NOT be declared even if the tracker delivers it. An empty
  list declares a watcher: the client transmits no pose frames and the server allocates
  no pose producer for it.
- `caps.body` (optional) declares the measurements of the captured person, for consumers
  without the avatar file (§2.8). It is not a data type.
- `allowed` is the server's **grant** for this client: `caps.sends` reduced by server
  policy, so `allowed` ⊆ `caps.sends`. It is authoritative. A client MUST NOT set a flag
  bit or a `bone_mask` bit that belongs to a type absent from `allowed`.

  | Type | Carries | Checked in the frame header as |
  |---|---|---|
  | `"bones"` | upper-body bones (§4) | `bone_mask` bits 0–8, 17–24 — mask `0x01FE01FF` |
  | `"legs"` | upper leg, lower leg, foot, both sides (§4) | `bone_mask` bits 9–11, 13–15 — mask `0x0000EE00` |
  | `"toes"` | toes, both sides (§4) | `bone_mask` bits 12, 16 — mask `0x00011000` |
  | `"root"` | root block (§5.4) | flag `HAS_ROOT` |
  | `"fingers"` | compact finger block (§5.5) | flag `HAS_FINGERS` |
  | `"finger_bones"` | per-joint finger bones (§4, §5.5) | `bone_mask` bits 25–54 — mask `0x007FFFFFFE000000` |
  | `"expressions"` | expression block (§5.6) | flag `HAS_EXPRESSIONS` |
  | `"perfect_sync"` | 52-slot ARKit mode (§5.6) | flag `PERFECT_SYNC` |
  | `"extra"` | declared extras: avatar-specific bones and values (§2.6, §5.8) | flag `HAS_EXTRA` |

  Every type is visible in the frame header, so a relay can check each one (§1.2).

  `"legs"` requires `"bones"`; `"toes"` requires `"legs"`; `"finger_bones"` requires
  `"bones"` (the hands anchor the finger chains); `"perfect_sync"` requires
  `"expressions"`. `"finger_bones"` and `"fingers"` are **mutually exclusive** — a
  declaration carries one or the other, never both. A declaration that violates any of these
  is rejected with `UNAUTHORIZED_TYPE`. A type the server does not know is no violation: it
  is left out of `allowed` (§2.7).

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
the receiver leaves that part of the avatar in its rest state (§3.3, §5.5). An `add` for a `uid`
already known replaces the earlier entry. The entry of a peer that was granted `"extra"`
also carries its `extra` object (§2.6). The entry of a peer that declared `body` carries it
for the receivers the server's policy names (§2.8). A peer whose granted set is empty has no pose
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

### 2.6 Declared extras

The humanoid bones of §4 and the blocks of §5.4–§5.6 are fixed. Everything else an avatar
has — a tail, animal ears, wings, further limbs, single toes, expressions of its own — is
an **extra**. The sender declares each extra by the name it has in the sender's own avatar
file and transmits it in the extras block (§5.8). Posy defines the mechanism and no names:
no humanoid standard agrees on any of these parts, and every receiver holds the sender's
avatar file (§0).

A sender that declares `"extra"` adds an `extra` object beside `sends` (in `caps` of
`hello`, and in a `caps` message):

```json
{ "t": "caps", "sends": ["bones", "expressions", "extra"],
  "extra": { "bones":  ["ear.L", "ear.R", "tail.001", "tail.002"],
             "values": ["tailWag", "blush", "app:confidence"],
             "since":  734500 } }
```

- `bones` — up to 255 names. Each names one bone of the avatar file that is neither a
  humanoid bone of §4 nor a finger bone (VRM: the glTF node name; PMX: the bone's first
  name field). It is transmitted as a rotation.
- `values` — up to 255 names. Each names one scalar control the avatar file defines
  (VRM: an expression that the sender's own expression block does not carry — beyond the
  13 presets for a VRM-Sync sender, beyond the 52 weights for a Perfect-Sync sender, §5.6;
  PMX: a morph, including bone and group morphs, by its first name field). It is
  transmitted as one byte. This
  is how richer face sets ride without any change to Posy: the tongue of a VRM-Sync
  sender, directional or curled tongue, ARKit shapes beyond the Perfect-Sync 52, or a
  community superset such as VRCFaceTracking Unified Expressions, are each carried by the
  names the sender's avatar file uses. Posy blesses no such list as canonical — the
  mechanism is the standard, the names are the sender's.
- A name MUST be unique in the avatar file among the items of its kind. An item without a
  unique name cannot be declared; that is a fault of the file and is not worked around.
- A PMX bone or morph has two name fields. The name is always the **first** one, the
  format's own primary identifier, even where the second is filled. The second field is
  often empty or repeated, so it cannot keep names unique. The name is an opaque key:
  sender and receiver hold the same file (§0) and match the name exactly, and Posy never
  interprets it.
- A name in `values` that begins with `app:` is not resolved against the avatar. Its
  meaning is agreed between applications and is outside Posy; a receiver that does not
  know it ignores the byte.
- The order of the two lists is the order in the block.
- `since` — the session time (§2.2) in milliseconds from which this declaration applies.
  It MAY be omitted in `hello`, where it defaults to 0.
- Either list MAY be empty; a sender with both empty MUST NOT declare `"extra"`.

**What to declare.** As for every type (§2.1): only what the sender will drive and its
current avatar has. Three cases:

| Motion | On the wire |
|---|---|
| Passive swing of hair, ears, a tail, clothing | nothing: the receiver's own secondary motion moves it (VRM spring bones, MMD rigid bodies) |
| A motion the avatar file itself defines (an expression, an MMD bone morph) | a **value** |
| A motion it does not define (a sender-side animation, a mechanism that steers a tail, a tracked further limb) | a **bone** |

**Grant.** `"extra"` is granted as a whole or not at all. A server MAY state its limits in
`session`:

```json
{ "t": "session", "allowed": ["bones", "expressions"], "extra_max": { "bones": 32, "values": 64 } }
```

A declaration that exceeds either limit is not granted: `"extra"` is absent from
`allowed`, and the client MAY declare again within the limits. Without `extra_max` the
limits are 255 and 255. `extra_max` states both limits, and either MAY be 0: the server
then grants no extra of that kind, so `"bones": 0` admits a declaration of values only.
The server reads the two list lengths and nothing else; it MUST
NOT edit the lists, and the names are opaque to it. The frame size limit of §1.1 applies
unchanged: a sender MUST NOT declare extras that could make one of its frames exceed it.

*Advice to server implementations (non-normative):* make the limits configurable, and
choose the default so that the largest frame a granted sender can produce still fits one
network packet. 64 bones and 64 values add 320 bytes.

**Peers.** The `peers` entry (§2.3) of a sender that was granted `"extra"` carries its
`extra` object unchanged, so a client that joins later learns the lists from the server.

**Changing the declaration.** When the avatar changes, the client sends `caps` with the
new lists and a new `since`. The extras block carries no identifier, so the frame's
`timestamp_ms` decides which declaration it follows:

- A frame with `timestamp_ms` earlier than `since` follows the previous declaration; a
  frame at or after `since` follows the new one (compared as in §5.7).
- The sender SHOULD choose `since` at least 500 ms ahead of its current session time, so
  that peers hold the new lists before the first frame that uses them.
- The sender MUST NOT send an extras block of the previous declaration in a frame at or
  after `since`, and MUST NOT send one of the new declaration before the `session` that
  grants it has arrived (§2.1). Frames in between carry no extras block.
- Server and receivers keep the previous declaration until `since` has passed and the
  frames before it have left the jitter buffer.
- A receiver that holds no declaration for a frame's `timestamp_ms` MUST ignore that
  frame's extras block and use the rest of the frame.

### 2.7 What a recipient does not know

Signaling carries the major version only (§9), so a recipient meets the additions of a
later 1.x revision without notice. It handles them as follows, and no addition may rely
on anything else:

- **Message.** A message whose `t` the recipient does not know MUST be ignored. It is not
  an error, and the connection stays open.
- **Field.** A field the recipient does not know MUST be ignored. The rest of the message
  is processed as if the field were absent.
- **Data type.** A type in `caps.sends` that the server does not know is not granted: the
  server leaves it out of `allowed` and treats the rest of the declaration as if the type
  were absent. Since a client sets no flag bit and no mask bit of a type absent from
  `allowed` (§2.1), a relay never receives a block it cannot size. A client ignores a
  type it does not know in a peer's `sends` (§2.3); what that peer's frames may then carry
  is in §9.
- **Error code.** A client that receives an `error` with a `code` it does not know treats
  it as an error of unknown kind: it MAY show `detail`, and it MUST NOT close the
  connection on that account.

`schemas/signaling.schema.json` describes what an implementation of this revision
**sends**: it is closed, and a message with a further field fails it. A recipient MUST NOT
use it to refuse a message.

### 2.8 Declared body

A receiver that holds the sender's avatar file takes the body's lengths from it (§0). For a
consumer without that file, a sender MAY declare the measurements of the person it captures,
beside `sends` (in `caps` of `hello`, and in a `caps` message):

```json
{ "t": "caps", "sends": ["bones", "legs"],
  "body": { "hips":         [0,      0.95, 0],
            "leftUpperLeg": [0.085, -0.06, 0],
            "leftLowerLeg": [0,     -0.44, 0] } }
```

- Each entry is a bone of §4 and the offset in metres from its parent to where it begins, in
  the T-pose, in avatar space (§3.1). The parent is the nearest ancestor in the VRM 1.0
  humanoid hierarchy that `body` contains; `hips` is measured from the floor beneath it.
  A bone that is absent is unknown.
- `body` describes the person, not the avatar. How it is measured is the sender's business.
- It is not a data type, needs no grant and adds nothing to frames. A `caps` without `body`
  withdraws it.
- It describes a person: a sender declares it only where an application needs it. The
  server forwards it unchanged in the sender's `peers` entry (§2.3), to the receivers its
  policy names.

`body` is where a sender puts the measurements it has of the person, so that a consumer
without the avatar file finds them in Posy. What the consumer does with them is its own
business. Posy has no such implementation yet: if you build one, please tell us how you use
`body`, what you are missing and what you never need, so that the definition can be adjusted
to fit a wide range of applications.

---

## 3. Coordinate System and Retargeting (Normative)

This section is the interoperability core. Any implementation that deviates here is
non-conformant regardless of byte-level correctness.

### 3.1 The wire speaks Posy avatar space — always

Posy avatar space is defined by the six items below and by nothing else. It coincides
with the normalized humanoid rig that VRM 1.0 runtimes (three-vrm, UniVRM) expose, which
is why earlier revisions called it "VRM 1.0 normalized space"; that is a runtime
construct, not a term of the VRM specification.

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

A receiver MUST apply incoming quaternions to its local instance of the sender's avatar
(§0), in the avatar space of §3.1, through its avatar driver (below). It
MUST NOT need to know the sender's tracker or how the sender produced the rotations.

| Sender avatar | Sender obligation |
|---|---|
| **VRM 1.0** | None. Normalized bones are native. Read and send. |
| **VRM 0.x** | Send rotations in the avatar space of §3.1, exactly as for a VRM 1.0 avatar. If they are read from the runtime's normalized humanoid rig, convert them where that rig is not in avatar space (see below). MUST NOT read the raw glTF node rotations. VRM 0.x names the thumb joints one step further out: 0.x `ThumbProximal` / `ThumbIntermediate` are 1.0 `ThumbMetacarpal` / `ThumbProximal`. §4 and §5.5 use the 1.0 names; a sender that derives the finger block, or the thumb bones of the `finger_bones` type (bits 25–27 and 40–42), from 0.x bone names MUST apply this mapping. |
| **PMX** | Send rotations in the avatar space of §3.1, exactly as for a VRM 1.0 avatar. The rig is not in avatar space and has no rest rotations; its driver converts as given under "PMX avatars" below. |

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

**PMX avatars.** A PMX file has no normalized rig: a bone has a position and a parent but
no rest rotation, and the file's rest pose usually has the arms lowered. What follows is the PMX
avatar driver's obligation, on the sending and the receiving end alike. It is worked out
from the avatar file at load and applied to each frame; nothing of it is carried on the
wire, by a relay or by the server.

- **Bones.** The driver maps the model's bones to §4 by the MMD semi-standard bone names.
- **Space.** The file is left-handed, its left arm at +X and its face toward −Z. A
  position converts to avatar space by negating z, a rotation by
  `(x, y, z, w) → (−x, −y, z, w)`.
- **T-pose.** In the file's rest pose every bone is at identity in the model's axes. The
  driver makes the T-pose with one rigid turn per arm: `T` is the shortest rotation that
  turns the direction from the upper-arm joint to the wrist joint in the file's rest pose
  onto the avatar's
  +X (left arm) or −X (right arm). `T` applies to the upper arm and every bone below it,
  and is identity for every other bone. The file's own elbow bend and wrist angle are
  kept.
- **Rotation.** For every bone `b` of §4 that the model has, in avatar space:

  ```
  A(b) = A(posy_parent(b)) · q_wire(b)        A(hips) = q_wire(hips)
  r(b) = R(rig_parent(b))⁻¹ · A(b) · T(b)     the rotation the driver sets on b
  ```

  `A` is the bone's rotation against the T-pose; `posy_parent` is its parent in §4.
  `R(x)` is the accumulated (model-space) rotation that rig bone `x` actually has once
  every bone above it is worked out, including a rotation it takes from another bone (as the deform copies of the
  leg bones in many models take the leg bone's rotation). `R` is identity only for a
  bone that neither the driver nor another bone turns. Bones are worked out in the file's
  own order: by deform level, then as listed.
- Where the rig and §4 give a bone the same parent, this comes to: `r = q_wire` for legs,
  chest, upperChest, shoulders, neck and head; `r = q_wire · T` for the upper arm; `r = T⁻¹ · q_wire · T` for the
  forearm, the hand and the fingers. Where the model's lower and upper body are siblings,
  the lower body gets `q_hips` and the upper body `q_hips · q_spine`.
- **IK.** The leg and toe IK chains are off; the leg bones are set from the frame, or at
  rest (§3.3). Every other IK chain, one that no bone set from the frame belongs to (a
  skirt, an eye limiter, hair, a tail), is solved for each frame in the file's
  order, within its links' limits. Without it such a chain stays where it was while the
  bones around it move.
- Helper bones between two mapped bones (twist and cancel bones) stay at identity.
  Whether a twist is spread onto them for better skinning is the driver's choice.
- A declared extra bone (§2.6) is taken from the model's physics and IK while it is
  declared. Its rest is the T-pose made above, so below an arm the rule of §5.8 comes to
  `r = T⁻¹ · q · T` with that arm's turn, and elsewhere to `r = q`.

Receiver side: decode `q_wire` to the avatar-space rotation of §3.1, then hand it to the
avatar driver, which adapts it to the rig as above (the mirror of the sender's path).
- VRM 1.0: the rig is in avatar space; the driver applies `q_wire` directly.
- VRM 0.x facing −Z: the driver applies `q_rig = (−x, y, −z, w)` before setting the bone.
- PMX: the driver sets `r(b)` as above, converted into the file's space.

### 3.3 Missing bones

A sender that cannot solve a bone, or whose avatar lacks it (e.g. an MMD model without
`upperChest`), MUST clear that bone's bit in `bone_mask` and omit its quaternion. Receivers MUST treat an absent
bone as holding its **rest rotation**, not "hold last value", except during the
packet-loss concealment window defined in §8.3 and as allowed below for an upper arm.

The rest rotation is the identity quaternion (no rotation delta from the T-pose) for
every bone except the four below. Those rest with the arm hanging at the side:

| Bone | Rest rotation `(x, y, z, w)` | That is |
|---|---|---|
| `leftUpperArm` | `(0, 0, −0.573576, 0.819152)` | 70° about −Z: the arm points down and slightly outward |
| `rightUpperArm` | `(0, 0, 0.573576, 0.819152)` | 70° about +Z |
| `leftLowerArm` | `(0, −0.087156, 0, 0.996195)` | 10° about −Y: the forearm bends slightly forward |
| `rightLowerArm` | `(0, 0.087156, 0, 0.996195)` | 10° about +Y |

Shoulders and hands rest at identity, so a hand hangs in line with its forearm. The rule
is per bone and does not depend on the declaration: it applies to a sender that declared
no `"bones"` at all and to one that sends `"bones"` without the arms (face tracking with
head rotation). Without it both are rendered with the arms held out sideways. A sender
that wants an arm in the T-pose sends the identity quaternion for it.

The rest rotation is local to the shoulder, so while the trunk bends the arm leans with
it: a sender that leans forward without sending arms is shown with the arms rising in
front. For an absent upper arm, a receiver MAY show the arm differently, for example
hanging by gravity. The rest rotation stays the default; the concealment window of §8.3
is unaffected.

A frame with no finger data at all — no compact block and no finger bones — is rendered
with the rest hand of §5.5. Under `finger_bones`, a single finger bone whose bit is clear
takes its rest-hand value for that joint (§5.5), consistent with this rule.

### 3.4 Rotation sense of the leg bones (Normative)

§3.1 already determines what every leg quaternion means. This section writes the result
out, so that it does not have to be derived and so that it can be tested. It adds no rule
that §3.1 does not imply; if the two ever disagree, §3.1 wins.

**T-pose of the legs.** Legs straight and vertical, feet parallel, toes pointing +Z, soles
flat on the floor.

**Toes.** A `toes` rotation is the turn from the toe bone's own rest in the avatar file.
A model whose toe bone rests at an angle is driven from that angle, not from a flat toe.

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

**Finger bones (bits 25–54).** These are the 30 per-joint finger bones. A sender carries
fingers in **one** of two ways, never both (§2.1, §5.5):
- the compact finger block (§5.5), flag `HAS_FINGERS` — curl/splay/opposition parameters a
  receiver expands to the 30 bones; or
- the `finger_bones` type (added in 1.4.0) — the per-joint rotations themselves, set directly
  in `bone_mask` bits 25–54 like any other bone, for rigs and poses the compact block cannot
  express (a claw, an independent middle joint). A frame MUST NOT set `HAS_FINGERS` and any of
  bits 25–54 at once.

A sender that uses neither leaves bits 25–54 clear and `HAS_FINGERS` unset; receivers then
synthesise the rest hand (§5.5).

**Bone bits by declared type (Normative).** A sender sets only bits of types it was
granted (§2.1):

| Type | Bits | Bones | Mask |
|---|---|---|---|
| `bones` | 0–8, 17–24 | spine, head, eyes, jaw, arms | `0x0000000001FE01FF` |
| `legs` | 9, 10, 11, 13, 14, 15 | leftUpperLeg, leftLowerLeg, leftFoot, rightUpperLeg, rightLowerLeg, rightFoot | `0x000000000000EE00` |
| `toes` | 12, 16 | leftToes, rightToes | `0x0000000000011000` |
| `finger_bones` | 25–54 | all 30 finger bones (both hands) | `0x007FFFFFFE000000` |

A sender granted `legs` sends all six leg bones; one granted `toes` also sends both toe
bones. §3.3 still applies per frame: a bone that cannot be solved in a given frame has
its bit cleared in that frame, and the receiver treats it as its rest rotation (§3.3; a
finger bone as the rest hand, §5.5). A receiver MUST
decode every valid frame, whichever of the peer's types it chooses to render.

**Typical v1 upper-body mask** = bits 0,1,2,4,5,17,18,19,20,21,22,23,24 → 13 bones.

---

## 5. Packet Format (Bit-Level, Normative)

**All multi-byte integers are little-endian.**

### 5.1 Layout

```
Offset  Size  Field
------  ----  ---------------------------------------------
  0      1    u8   version          (= 4 in 1.4; the minor revision, §9)
  1      1    u8   flags
  2      2    u16  seq
  4      4    u32  timestamp_ms     (ms since session epoch)
  8      8    u64  bone_mask
 16     4*N   u32  quaternions[N]   N = popcount(bone_mask)
  +      8    root block            if flags bit 1
  +     24    finger block          if flags bit 2
  +   15|54   expression block      if flags bit 3
  +  4*B+V    extras block          if flags bit 5 (B, V from the declaration, §5.8)
```

Total length MUST equal:
`16 + 4*popcount(bone_mask) + 8*b1 + 24*b2 + (b3 ? (b0 ? 54 : 15) : 0) + (b5 ? 4*B + V : 0)`

A frame whose actual length differs MUST be treated as malformed. One exception, for
receivers only: a frame with flag bit 6 or 7 set MAY be longer (§9).

### 5.2 Flags

| Bit | Name | Meaning |
|---|---|---|
| 0 | `PERFECT_SYNC` | 0 = VRM-Sync (13 expressions), 1 = Perfect-Sync (52 ARKit) |
| 1 | `HAS_ROOT` | Root position block present |
| 2 | `HAS_FINGERS` | Finger block present |
| 3 | `HAS_EXPRESSIONS` | Expression block present |
| 4 | `IDLE` | Sender is idle/AFK; receiver MAY skip interpolation work |
| 5 | `HAS_EXTRA` | Extras block present (§5.8) |
| 6–7 | reserved | MUST be 0 in this revision. A receiver ignores the bit, and the bytes after the blocks it knows (§9) |

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

On a PMX avatar, `h` and `H` are both measured at the midpoint between the two leg roots
(the upper-leg joints): the **hips landmark** of a PMX avatar. On every other avatar the
landmark is the hips bone. Each avatar type keeps its own: on VRM avatars the hips bone
sits 4.5–9.8 % of `H` above the leg-root midpoint (eleven models), so the PMX landmark is
about 5 % lower. A sender and its receivers measure on the same avatar, so they agree.

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
  Flexion is linear in the curl byte, and so are splay and opposition in theirs.

All axes below are the bone's local axes in the T-pose of Posy avatar space, where they
coincide with the avatar axes (§3.1 item 6). Angles follow the right-hand rule.

- **Flexion axis, index to little finger:** **Z**, signed so that fingertips move toward
  **−Y** (into the palm): negative Z-rotation on the left hand, positive on the right.

- **Flexion axis, thumb:** **Y**, signed so that the thumb tip moves toward the fingers,
  across the palm: positive Y-rotation on the left hand, negative on the right. The thumb
  lies in the plane of the palm in the T-pose and points forward and outward; about Z it
  would bend down and back toward the wrist, away from the palm.

- **Splay, index to little finger** (`−127` … `+127` → `−30°` … `+30°`) is applied to
  the **proximal bone only**, about **Y**. Positive = abduction toward the thumb side:
  negative Y-rotation on the left hand, positive on the right.

- **Order on the proximal bone**, which carries both: `q = q_splay · q_curl` (§3.1
  item 5: the finger curls in the plane it was splayed into).

**The thumb.** Its three bytes drive its three bones together. On the left hand, with
`s` = thumb splay in degrees (`−127` … `+127` → `−90°` … `+90°`), `o` = thumb opposition
in degrees (`0` … `255` → `0°` … `60°`) and `c` = thumb curl / 255:

- **Splay** turns the thumb in the palm's plane about **Y**; positive opens it away from
  the fingers (outward), negative lays it toward and across the palm (inward). An
  outward splay is spread over the three bones, `0.30 : 0.45 : 0.25` from
  `thumbMetacarpal` to `thumbDistal`, as a real thumb bends at its knuckle when it opens.
  An inward splay is wholly on `thumbMetacarpal`; inward, the outer joints move as curl,
  which curl already carries.
- **Opposition** turns `thumbMetacarpal` toward the palm side, by `+o` about
  `(1, 0, −1)/√2`, and rolls it by `−o` about the thumb's own resting axis, `(1, 0, 1)/√2`
  (left hand), so that the pad turns toward the fingers.
- **Curl** bends `thumbProximal` by 60° and `thumbDistal` by 80° about **Y**, toward the
  fingers.

| Bone (left hand) | Rotation on the reference hand |
|---|---|
| `thumbMetacarpal` | `q_splay · q_opposition · q_roll`: about Y by `−s_m`, about `(1, 0, −1)/√2` by `+o`, about `(1, 0, 1)/√2` by `−o` |
| `thumbProximal` | about Y by `60c − s_p` |
| `thumbDistal` | about Y by `80c − s_d` |

with `(s_m, s_p, s_d) = (0.30 s, 0.45 s, 0.25 s)` for `s > 0` and `(s, 0, 0)` for `s ≤ 0`.
The right hand is the mirror of the left: each rotation `(x, y, z, w)` becomes
`(x, −y, −z, w)`. In code, in the style of `reference/js/scripts/finger-fk.mjs`
(`mul(a, b)` applies `b` first; `aa(axis, deg)` turns by `deg` about the normalised axis):

```js
const s = splay / 127 * 90, o = opposition / 255 * 60, c = curl / 255;   // left hand
const [sm, sp, sd] = s > 0 ? [0.30 * s, 0.45 * s, 0.25 * s] : [s, 0, 0];
const meta = mul(mul(aa([0, 1, 0], -sm), aa([1, 0, -1], o)), aa([1, 0, 1], -o));
const prox = aa([0, 1, 0], 60 * c - sp), dist = aa([0, 1, 0], 80 * c - sd);
```

**The thumb's rest: the axes rule.** The rotations above are on the reference hand, whose
thumb rests in the palm's plane at 45° between the arm's axis and forward: from the
metacarpal joint to the distal joint, `(1, 0, 1)/√2` on the left hand and `(−1, 0, 1)/√2`
on the right. Avatars rest their thumbs differently, so the same rotations would turn each
thumb from a different start. The driver of the compact block therefore measures, once at
load and on each end alike, how its avatar's thumb rests:

- `T0` is the shortest rotation that turns the avatar's resting thumb direction (metacarpal
  joint to distal joint, in the T-pose, in avatar space) onto the reference direction.
- The receiver sets `thumbMetacarpal = meta · T0`, `thumbProximal = T0⁻¹ · prox · T0` and
  `thumbDistal = T0⁻¹ · dist · T0`.
- The sender inverts it before it reduces a thumb to the three bytes:
  `meta = thumbMetacarpal · T0⁻¹`, `prox = T0 · thumbProximal · T0⁻¹`, and so for `dist`.

On the reference hand `T0` is the identity. Nothing of it is on the wire or at a relay or a
server; it is the block driver's job, like the arm turn of a PMX driver (§3.2). Joint
rotations sent as `finger_bones` are the avatar's own and take no `T0`.

*Example.* An avatar whose left thumb rests at `(0.832134, −0.238844, 0.500506)`, 31.0°
from the arm's axis in the palm's plane and 13.8° below it, has
`T0 = (−0.085689, −0.118976, 0.085689, 0.985474)`, a turn of 19.6°. Its right thumb,
resting at the mirror `(−0.832134, −0.238844, 0.500506)`, has the mirror
`T0 = (−0.085689, 0.118976, −0.085689, 0.985474)`.

*Shapes on the reference hand (informative).* Twelve bytes of one hand in block order; the
figures hold for either hand. The distance is that of the thumb tip from its target; "over
the middle phalanges" is the midpoint between the middles of the index's and the middle
finger's intermediate segments. A tip segment's angle is measured from the hand's axis,
±X.

| Shape | Bytes | On the reference hand |
|---|---|---|
| OK, pinch | `84, −39, 160, 0, 0, 0, 0, 0, 0, 0, 152, 0` | 0.06 cm from the index tip |
| Pinch, index more curled | `227, 22, 192, 0, 0, 0, 0, 0, 0, 0, 135, 0` | 0.07 cm from the index tip |
| Thumb across the palm | `72, −87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0` | 0.07 cm from the ring finger's base |
| Thumb to the little fingertip | `40, −127, 0, 0, 0, 0, 0, 0, 192, 0, 84, 0` | 0.14 cm from the little fingertip |
| Fist | `164, −27, 255, 0, 255, 0, 255, 0, 255, 0, 100, 0` | 0.10 cm from over the middle phalanges of index and middle finger |
| Thumbs-up | `4, 21, 255, 0, 255, 0, 255, 0, 255, 0, 0, 0` | the tip segment 58° from the hand's axis |
| Counting, thumb out ("L") | `4, 36, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0` | the tip segment 68° from the hand's axis |

Shape bytes made on one hand do not make the fingertips of a hand with other proportions
meet; a sender measures its bytes on its own avatar.

Receivers MUST synthesise the 30 finger bone rotations from this block. A sender carries
fingers through this compact block **or** through the per-joint `finger_bones` type (§4),
never both: the compact block is the light default, and `finger_bones` is the declared
option for a hand shape the five-finger model cannot reach (a claw, where the base joints
stay straight while the outer joints bend). A frame MUST NOT set `HAS_FINGERS` and any of
`bone_mask` bits 25–54 at once.

**Per-joint finger bones (`finger_bones`).** When a sender declares `finger_bones`, each
finger bone it can solve is sent as an ordinary quaternion in `bone_mask` bits 25–54, with
the meaning of every other bone (§3.1, §3.3): the bone's local rotation delta from its rest
pose, composed parent first, identity at rest. The rotations are in the sender's own avatar
rest frame; there is no cross-rig retargeting. A finger bone whose bit is **clear** in a
given frame is not at identity but takes the rest-hand value below for that joint — the hand
relaxes exactly as an untracked hand does under the compact block, rather than snapping flat.
A receiver that does not render `finger_bones` still decodes the frame and MAY ignore those
bits.

**Rest hand.** When a frame carries neither the compact block nor any finger bone, receivers
MUST synthesise both hands from these values: curl `40, 50, 60, 70, 80` (thumb to little
finger), all splay `0`, thumb opposition `40`. That is a relaxed hand, a little more closed
toward the little finger. The same values give the per-joint rest fall-back above, joint by
joint, for a `finger_bones` sender's cleared bits: the rest bytes through this synthesis,
the axes rule included. A sender that wants flat hands sends a compact finger block of
zeros, or `finger_bones` with the relevant bits set to identity.

`testvectors/poses/hand-skeleton.json` plus `f01`–`f09` pin this synthesis: each carries the
curl / splay / opposition bytes and the joint positions they produce on a reference hand.
`g02` pins the rest fall-back of cleared `finger_bones` bits. A wrong flexion axis (the
thumb about Z rather than Y), a flipped sign, the opposition without its roll, the wrong
split of a thumb splay, or the wrong product order on a proximal bone moves a joint by a
centimetre or more there, which the frame vectors cannot detect (§10 item 9).

**Integration note.** The reduction from per-joint bone rotations to the curl/splay/
opposition parameterisation is integration-layer work (sender-side). Posy intentionally
keeps individual finger joint rotations off-wire; senders that operate on per-joint
rotations (e.g. a full-skeleton IK solver) reduce them to the five-finger model before
encoding.

### 5.6 Expression block

#### VRM-Sync (15 B) — `PERFECT_SYNC` = 0

13 one-byte expression slots, then `i8` gaze yaw, `i8` gaze pitch. The 13 slots are the
VRM standard expression presets (emotions, the five visemes, blink, neutral) and nothing
else.

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

**Avatars without the presets.** A slot means its expression at that weight. The PMX
format defines no moods, and files name their face morphs differently, so Posy names no
morph for a mood: a receiver shows a mood as well as its avatar can, and ignores a slot it
cannot bind. A
sender that wants its exact face on such an avatar sends the morphs as extra `values`
(§2.6). For the visemes and the lids, MMD faces share these morph names:

| Slots | PMX morph |
|---|---|
| `aa`, `ih`, `ou`, `ee`, `oh` | `あ`, `い`, `う`, `え`, `お` |
| `blinkLeft` and `blinkRight` together | `まばたき` |
| `blinkLeft`, `blinkRight` alone | `ウィンク２`, `ｳｨﾝｸ２右` |

How a receiver composes the two lid slots from these morphs is its choice. A file whose
morphs are named otherwise is the implementation's to map.

**Tongue.** The tongue is not a VRM preset. The VRM-Sync block has no slot for it, and
there is no tongue type.
- A VRM-Sync sender whose avatar file defines a tongue expression declares it as extra
  `values` (§2.6, §5.8) by the names the file uses: protrusion, and direction, roll or
  curl where the file has them. It needs the `"extra"` grant, like every other extra.
- In Perfect-Sync, protrusion is ARKit index 51 (`tongueOut`, Appendix A): one of the 52
  weights, granted with `"perfect_sync"` like the other 51.
- **Directional and other richer tongue** (left/right, up/down, roll, curl) is extra
  `values` for a Perfect-Sync sender too, and composes with weight 51. See §11.

Slot 13 `tongueOut` and the `"tongue"` type of 1.1–1.4.1 are removed: the type could not
be checked in the frame header, and the slot was the one byte of the block that is not a
VRM preset.

#### Perfect-Sync (54 B) — `PERFECT_SYNC` = 1

`u8[52]` ARKit blendshape weights in the canonical order of Appendix A, then the same
two gaze bytes.

A sender MUST NOT set `PERFECT_SYNC` unless `"perfect_sync"` is in `allowed`.

#### Gaze

`i8` values, `−127 … +127` mapped linearly to `−45° … +45°`.
- **yaw:** positive = toward the avatar's own left.
- **pitch:** positive = upward.

The two bytes are the **line of sight**: where the person looks, in real degrees, measured
from the head. They are not the angle of any bone. Zero is the sender's calibrated
straight-ahead; what the sender calibrates against is its own choice. A receiver shows
zero as eyes centred.

Each receiver maps the line of sight onto what its avatar can show; the mapping is the
implementation's. Two things to watch:
- **VRM:** a look-at range map applied one to one moves the eyes of many avatars by a
  small part of the look. VRoid Studio writes 90° in, 10° out for every direction, so a
  look of 30° turns the eyes about 3° of their 10°.
- **PMX:** the angle applied one to one to the eye bones (`両目`, or an eye IK chain)
  overshoots what the eyes of some models can show.

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

### 5.8 Extras block

Present when flag bit 5 (`HAS_EXTRA`) is set. It is the last block of the frame.

```
4*B   u32  bones[B]     smallest-three (§5.3), in the order of the declaration
V     u8   values[V]    in the order of the declaration
```

`B` and `V` are the lengths of the `bones` and `values` lists of the declaration that
applies at the frame's `timestamp_ms` (§2.6). The block carries neither the counts nor an
identifier: both ends know them from the declaration.

- A frame carries the whole block or none of it. A sender that declared extras MAY omit
  the block in any frame.
- **Extra bone.** The quaternion has the meaning of every other bone (§3.1 items 3, 5
  and 6): the bone's local rotation delta from its rest pose in the avatar file (on PMX,
  the T-pose the driver makes, §3.2), in avatar axes, composed parent first. In the rest
  pose it is the identity. The avatar driver (§3.2) turns it into the node's own local
  rotation: `q_node = q_rest · W⁻¹ · q · W`, where `q_rest` is the node's local rotation
  at rest and `W` its rotation in avatar space at rest, with the avatar facing +Z. A
  driver whose rig is not in avatar space converts `q` first, as for the humanoid bones
  (§3.2): `(−x, y, −z, w)` on a VRM 0.x rig that faces −Z, `(−x, −y, z, w)` on PMX.
- **Value.** `0` … `255` is the weight `0.0` … `1.0`, linear. For an `app:` name the byte
  is not interpreted by Posy.
- **A declared extra bone is driven by the sender.** A receiver MUST set it from the frame
  and MUST NOT apply its own secondary motion (spring bones, physics) to it. Bones that
  are not declared, including descendants of a declared one, stay with the receiver's
  secondary motion. A sender that steers a chain (an ear of two bones, a tail of six)
  therefore declares every bone of it: an undeclared descendant keeps following the
  receiver's secondary motion and cancels most of the movement.
- A frame without the block leaves every declared extra bone at its rest rotation and
  every value at 0, as §3.3 does for an absent bone.
- Interpolation and loss concealment (§8.2, §8.3) treat extra bones like bones and values
  like expression weights.

---

## 6. Sizing and Bandwidth (Informative)

Typical VRM-Sync upper-body frame:

```
header + mask        16 B
13 quaternions       52 B
root                  8 B
fingers              24 B
expressions          15 B
                 = 115 B payload
```

Perfect-Sync frame = 154 B. Add ~50 B UDP+DTLS+SCTP overhead ⇒ ~165 B / ~204 B on wire.
A full-body sender adds 24 B (`legs`) or 32 B (`legs` + `toes`).
Per-joint fingers (`finger_bones`, §4) replace the 24 B compact block with up to 30
quaternions — 120 B for both full hands, so an all-blocks Perfect-Sync frame reaches 298 B;
in practice a sender sends only the joints it solves, and clears the rest to the rest hand.
Declared extras (§5.8) add 4 B per bone and 1 B per value: two ears of two bones each and
three values are 19 B.
On the WebSocket lane (§1.1) the per-frame overhead differs — a WebSocket binary
frame adds a small header (2–14 B) over TCP/TLS rather than UDP/DTLS/SCTP — but the figures
below are the right order of magnitude for either lane.

| Tier | Hz | On-wire per stream |
|---|---|---|
| FULL | 30 | ~40 kbit/s |
| NORMAL | 15 | ~20 kbit/s |
| MINIMAL | 5 | ~6.6 kbit/s |

Pose data is smaller than the accompanying Opus stream, and about **25–35× smaller than
the same pose over raw VMC**. VMC sends one OSC message per bone — address
`/VMC/Ext/Bone/Pos` (20 B padded) + type tags (12 B) + the bone-name string (~16 B padded)
+ 7 floats of position and rotation (28 B) ≈ **76 B per bone**. The pose in the 115 B frame
above (13 body bones with the hands as a 24 B finger block) is, in VMC, those 13 bones plus
30 individual finger bones at 76 B each ≈ 3.3 KB — about **28×**. A full ~55-bone humanoid
is ≈ 4.2 KB, about **36×**. The win comes from the smallest-three quaternion (4 B vs 28 B
per bone), the compact finger block, and sending no bone names on the wire; the exact factor
depends on the bone count and on whether a VMC sender bundles its messages.

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
- A sender without tracking for a body part MAY transmit a pose or an animation of its
  own choosing for it (seated, leaning, an idle loop) as ordinary bones and blocks of the
  types it declared. To a receiver this is indistinguishable from tracked motion. A part
  it does not transmit is shown in its rest state (§3.3).

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
Concealment is **required behaviour at working frame rates, not optional polish**: at
12–15 Hz the §8.1 jitter buffer leaves only 20–33 ms of margin, so a single late or lost
frame is visible as a freeze-and-jump unless step 1 carries the motion across the gap. A
receiver that renders at these rates MUST implement at least step 1.
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
1. `h` is the height of the hips landmark (§5.4) above the floor divided by the standing
   hip height `H` of the sender's avatar, for the pose as the sender's own avatar shows it.
2. A sender with a floor reference (calibrated trackers) derives `h` from the tracked
   hips height, scaled by the performer's standing hips height from calibration.
3. A sender without a floor reference (e.g. a single camera) estimates `h` from the
   solved pose; Appendix D gives one method.
4. A sender that was not granted `legs` sends `h = 32768`.
5. `h` SHOULD be filtered like any other tracked value (§7).

**Receiver.**
1. Place the hips landmark (§5.4) of the sender's avatar at `h / 32768 × H` above that
   avatar's floor line, with `H` taken from the receiver's local instance of the avatar.
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
  implements: a 1.y sender writes y. 1.4 writes 4. (1.0 and 1.1 both wrote 1.) The value
  is 0–15 for every 1.x release, which is all that `version >> 4 == 0` tests; it does not
  encode the major version, which is in the `protocol` string. Receivers MUST accept any
  value 0–15 and MUST ignore unknown flag bits and unknown `bone_mask` bits. A receiver
  MAY use the value to tell which revision's layout a frame follows while the soft lock
  allows layout changes. If a minor revision above 15 were ever needed, releases continue
  as patch releases of 1.15 and the byte stays 15.
- **Soft lock.** While the format is soft-locked (see Status), a justified layout or
  signaling change ships as a 1.x revision under `posy/1`. Once the maintainers declare
  the format frozen, any such change requires `posy/2`.
- Extension mechanism: avatar-specific data travels as declared extras (§2.6), which
  need no further change to the format. Reserved for other extensions: flag bits 6–7,
  bone bits 55–63 and the reserved finger byte. A relay rejects a frame that sets a reserved
  bone bit 55–63 (§1.2), since those bits belong to no granted type; a **receiver** still
  ignores an unknown mask bit so a future minor can define one without breaking older
  receivers. A block placed behind a flag bit changes the frame length, so a relay that
  checks lengths (§1.2) has to know it: such an extension is not transparent to relays.
  `HAS_EXTRA` (1.3) is the first.
- **A frame of a later revision at an older receiver (Normative).** A later 1.x revision
  places a new block behind flag bit 6 or 7 and **after every block of this revision**,
  the extras block included; two such blocks follow each other in the order of their flag
  bits. A receiver that finds bit 6 or 7 set therefore accepts a frame that is longer
  than the §5.1 formula gives, reads the blocks it knows and ignores the bytes after them.
  A frame with one of these bits set that is shorter than the formula is malformed. With
  both bits clear the length MUST be exact. The reserved byte of the finger block (§5.5)
  is ignored on receive.
- **The same frame at a relay.** Nothing changes: the relay's length check is exact
  (§1.2), so it forwards a block only if it knows it. A later revision therefore gives
  every new block a data type (§2.1). A server that does not know the type does not grant
  it (§2.7), the sender does not send the block, and its relay never has to size it.
- **Additive.** Once the format is frozen, a 1.x revision makes only changes that a peer
  of an earlier 1.x revision survives by the rules above and those of §2.7: a new message,
  field, data type or error code; a block behind flag bit 6 or 7; a bone on bits 55–63; a
  meaning for a reserved byte. Everything else requires `posy/2`: changing or removing
  what exists, a block in front of an existing one, and any addition an older peer has to
  understand for the session to work.

---

## 10. Conformance

An implementation is conformant if it:
1. Uses the exact packet layout of §5 with little-endian ordering.
2. Emits and consumes rotations in Posy avatar space as defined in §3.1.
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
10. If it declares or renders extras: follows §2.6 and §5.8, sets a declared extra bone
    from the frame only, and takes the block's size from the declaration that applies at
    the frame's `timestamp_ms`.
11. If it sends or renders per-joint finger bones (`finger_bones`): applies them as ordinary
    bone rotations, and a cleared finger bit as the rest hand, so that the joint positions
    of the per-joint finger pose vectors (`testvectors/poses/g*.json`) are reproduced within
    their tolerance (§4, §5.5).
12. Ignores the signaling messages, fields, data types and error codes it does not know
    (§2.7), and as a receiver accepts a frame with flag bit 6 or 7 set that is longer than
    §5.1 gives, using the part it knows (§9).

---

## 11. Deferred to v2 (Informative)

Explicitly out of scope for v1, listed so v1 does not accidentally block them:
- **Keyframe + delta encoding** (full frame every 1 s, changed bones in between).
  Requires reliable resync logic; the bandwidth saving is not worth it at ~115 B.
- **Server-side field stripping** as a congestion path (drop fingers → hands → body).
  Requires the server to re-encode packets, which v1 forbids. v1 degrades by rate only.
- **Props, scene state, 3D playspaces.**
- **Tongue direction as a core slot.** Neither the VRM-Sync block nor the 52 ARKit slots
  carries left/right or up/down tongue. Rather than grow a core block, directional and
  curled tongue is carried as declared extra `values` (§2.6, §5.8) — so it needs no format
  change and coexists with Perfect-Sync. A built-in directional slot is not planned.

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
// B, V: the list lengths of the declaration that applies to this frame (§2.6); 0, 0 for a
// sender without extras.
bool posy_decode(const uint8_t *p, size_t len, int B, int V, Frame *out) {
    if (len < 16) return false;
    out->version   = p[0];
    if ((out->version >> 4) != 0) return false;   // 1.x only: minor revision 0–15 (§9)
    out->flags     = p[1];
    out->seq       = rd_u16(p + 2);
    out->timestamp = rd_u32(p + 4);
    out->bone_mask = rd_u64(p + 8);

    int b0 = out->flags & 1, b1 = (out->flags >> 1) & 1,
        b2 = (out->flags >> 2) & 1, b3 = (out->flags >> 3) & 1,
        b5 = (out->flags >> 5) & 1;
    int n  = popcount64(out->bone_mask);
    size_t need = 16 + 4*n + 8*b1 + 24*b2 + (b3 ? (b0 ? 54 : 15) : 0) + (b5 ? 4*B + V : 0);
    if (len < need) return false;                 // malformed
    if (len > need && !(out->flags & 0xC0))       // longer only with flag bit 6 or 7: the
        return false;                             // block of a later revision follows (§9)

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
    if (b3) { int m = b0 ? 52 : 13;
              memcpy(out->expr, q, m); q += m;
              out->gaze_yaw = (int8_t)q[0]; out->gaze_pitch = (int8_t)q[1]; q += 2; }
    if (b5) { for (int i = 0; i < B; ++i)
                  out->extra_rot[i] = unpack_smallest3(rd_u32(q + 4 * i));
              q += 4 * B;
              memcpy(out->extra_val, q, V); q += V; }
    // Bytes from q on, if any, belong to a later revision and are not read.
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

Per frame, with the solved rotations applied and the hips landmark (§5.4) at the origin:

```
h_est = 0
for c in contacts:
    y = world_y(c)                 // ≤ 0 when the point is below the landmark
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
