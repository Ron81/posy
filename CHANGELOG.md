# Changelog

All notable changes to the Posy spec, reference implementation and test vectors. 
The spec follows the versioning rules in §9 (major version = channel protocol string `posy/N`).

## [Unreleased]

### Added
- `scripts/generate-spec-tables.mjs` also owns the 16 Standard-Sync slot names (§5.6), the
  fields of the finger block (§5.5) and the error codes (§2.5). The codec exports them as
  `STANDARD_SYNC_NAMES`, `FINGER_BLOCK_FIELDS` and `ERROR_CODES`.
- `test/docs-site.test.mjs` compares the hand-written copies of those three lists on the
  site with the exports, and the exports with the tables in the spec text. No change to
  the packet format, the signaling or the site.

## [1.1.0] - 2026-10-03

Full-body support: per-sender declaration, legs and toes as declared types, hips height
on the wire, tongue tracking. Transport wording reframed. The 1.x freeze is replaced by
a soft lock, and this revision **changes the packet format and the signaling**; each
change is listed with its reason.

### Changed — wire format (§5)
- **Root block 6 B → 8 B.** New `u16 h`: hips height in units of 1/32768 of the avatar's
  standing hip height (§5.4, §8.5). Length formula uses `8*b1`. Typical frame 116 → 118 B,
  Perfect-Sync 152 → 154 B, largest v1 frame 200 → 202 B.
  Reason: leg rotations do not determine hips height. Deriving it on the receiver from
  the lowest foot fails when both feet are off the floor (seated) and for jumps.
- **Standard-Sync slots 13–15 are tongue** (previously reserved): `tongueOut` (`u8`),
  `tongueX`, `tongueY` (`i8`, 0 = centre).
  Reason for `i8`: a sender without tongue tracking sends 0, which must mean "centred".

### Changed — signaling (§2)
- **`hello.caps.sends`**: the sender declares every data type it will transmit — what its
  capture delivers and its avatar can show. Replaces `caps.perfect_sync` and
  `caps.fingers`. An empty list is a watcher.
- **`session.allowed`** is the grant for that client, a subset of `caps.sends`.
- **`peers.add[].sends`**: each peer's granted set.
- **New message `caps`** to re-declare after an avatar or capture change.
- **New types** `"legs"` (bits 9–11, 13–15), `"toes"` (bits 12, 16), `"tongue"`.
  `"bones"` now covers bits 0–8 and 17–24 only.
  Reason: a room-level grant does not tell relays or receivers what a given sender
  transmits. With a declaration the relay check is one mask comparison and receivers
  can prepare the avatar before the first frame.

### Changed — rules and wording
- The packet format and signaling are **soft-locked**, not frozen: changes are allowed
  in 1.x with a stated justification. No implementation has shipped yet.
- §0: avatar model stated — a sender's stream drives that sender's own avatar on every
  receiver; no retargeting onto another avatar.
- §1.1: transport wording is role-based. SCTP for direct links, WebSocket for
  server-relay deployments; neither is called a fallback.
- §1.2: a relay MAY validate frames from the header alone (version, length, finger bits,
  granted set). It MUST NOT reject reserved flag or bone bits.
- §2.1: the handshake MAY be embedded in an integrator's existing join message.
- §2.4: per-subscriber rate tiering is OPTIONAL for a relay; `OFF` must still be honoured.
- §3.2: VRM 0.x thumb joint naming noted for senders deriving the finger block.
- §3.3: a bone the avatar lacks is treated like an unsolved bone.
- §5.3: worst-case quaternion round-trip error stated as ≈ 0.25° (0.14° is the identity
  case only).
- §5.5: note that reducing per-joint finger rotations to curl/splay is sender-side work.
- §8.5: hips height rules for sender and receiver. Appendix D: an estimate for senders
  without a floor reference.
- §9: expression slots 13–15 removed from the extension points.
- §11: "leg / full-body tracking as a mandatory profile" removed (now specified);
  tongue direction in Perfect-Sync added.

### Test vectors
- `002-fullbody-standard`: mask fixed from `0x00fffe3f` to `0x01fffe3f` (bit 24,
  `rightHand`, was missing); now 154 B.
- `003-perfectsync`: 154 B (root block).
- New `007-fullbody-legs`: non-identity leg and toe rotations, lowered `h`, tongue slots.

## [1.0.5] - 2026-10-02

Adds a WebSocket fallback transport. No change to the binary packet format (§5) — pose frames
are byte-for-byte identical on either lane — so the `posy-protocol` codec is unchanged; the
version bump signals that the package tracks the spec.

### Added
- Spec §1.1: a reliable-WebSocket fallback transport for pose frames, for server-relay
  deployments where native server-side WebRTC is unavailable. The SCTP data channel remains
  the primary lane (SHOULD); the WebSocket lane is a documented fallback (MAY).
- Spec §2.1 and `schemas/signaling.schema.json`: an optional `transport` field
  (`"sctp"` | `"websocket"`) on `hello` and `session`, so the negotiated lane is explicit on
  both sides. It is backward-compatible — a message that omits it is read as `"sctp"`, the
  1.0.0 default.

### Changed
- Spec §1.1 relaxes "pose data MUST use a WebRTC (SCTP) data channel" to SHOULD, with the
  WebSocket lane as the sanctioned alternative. Reconciles the reliable/ordered WebSocket with
  the loss-tolerant pose stream: "MUST NOT retransmit" is clarified as a Posy-layer rule, and
  the sender SHOULD drop (not enqueue) frames while the WebSocket send buffer is backed up.
- Spec §9 notes that the major version travels in the `hello` handshake on the WebSocket lane,
  which has no `RTCDataChannel` protocol-string negotiation.
- README: trimmed one entry from the acknowledgments section.

## [1.0.0] - 2026-09-30

First released version. Packet format (§5) and signaling (§2) are frozen for the 1.x line.

### Added
- Specification (`spec/Posy.md`): transport, session layer, coordinate system, bone table, packet format, sizing, sender/receiver behaviour, versioning, conformance.
- `spec/blendshape-order.json` and `spec/bone-index-table.md`, generated by `scripts/generate-spec-tables.mjs`.
- `schemas/signaling.schema.json` — JSON Schema for the §2 messages.
- `reference/js/` — zero-dependency TypeScript reference encoder/decoder.
- `testvectors/` — binary frames and quaternions with expected results, hand-verified against the spec.
- `examples/loopback-demo/` — in-browser encode → lossy channel → decode → render demo.
- `FAQ.md`, `CONTRIBUTING.md`, issue templates.

### Fixed
- Resolved the late-frame contradiction between §5.7 and §8.1: §5.7 now discards only frames older than the newest frame already released for playout, leaving in-buffer reordering (§8.1) intact.
