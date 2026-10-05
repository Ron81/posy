# Changelog

All notable changes to the Posy spec, reference implementation and test vectors. 
The spec follows the versioning rules in §9 (major version = channel protocol string `posy/N`).

## [Unreleased] - proposed as 1.2.0

Leg rotation conventions, VRM 0.x conversion, finger signs. **No change to the packet
layout or the signaling.** The `version` byte now writes 2, and the meaning of
`thumb_curl` changes (see Changed).

### Added
- Spec §3.1 items 5 and 6: rotation composition order (`q_parent · q_bone`) and the local
  axes of a bone (+X left, +Y up, +Z forward, right-hand rule). Both followed from the
  existing text but were not written down.
- Spec §3.4: rotation sense of `upperLeg`, `lowerLeg`, `foot` and `toes`, per motion and
  per side.
- Spec §10 item 8: implementations that send or render leg bones reproduce the pose
  vectors.
- Spec §10 item 9: implementations that render fingers reproduce the finger pose vectors.
  §5.5 now points at them.
- `testvectors/poses/`: a reference skeleton and nine poses with expected joint
  positions. Five pin the §3.4 table; four are the seated and kneeling poses a full-body
  sender must be able to express.
- `testvectors/poses/hand-skeleton.json` and `f01`–`f07`: finger poses that carry the
  curl / splay / opposition bytes and every joint position a §5.5 receiver must
  synthesise. They catch a wrong thumb axis, a flipped sign or the wrong product order,
  none of which the frame vectors can. `f07` is half curled with splay on the same bones
  and a thumb splay; without it the product order, the thumb splay and the linearity of
  the curl byte were not pinned. `reference/js/scripts/finger-fk.mjs` holds the synthesis
  and FK; five negative controls are in `test/poses.test.mjs`.
- §5.5: splay is on the proximal bone, which for the thumb is `thumbProximal`. The text
  said "proximal joint" and left the thumb open.
- `reference/js`: `scripts/pose-fk.mjs` (forward kinematics used by the generator and the
  tests) and `test/poses.test.mjs`.
- Loopback demo: drives legs, toes and hips height `h`; tracker selector showing what the
  tracker delivers, what the avatar can show and what is therefore declared and
  transmitted (§2.1); the receiving view frames the declared region; a dropdown of
  whole-body poses (standing, moving, seated) plus the pose vectors; `h` estimated with
  the Appendix D method; all controls visible without scrolling. `?tracker=&pose=` links.
  Fingers are synthesised from the finger block as §5.5 requires of a receiver, and the
  face is driven from the expression block (§5.6): lids, mouth shapes, moods, gaze. The
  stick figure has a part for every data type, including one toe piece per foot and a
  tongue that shows direction. Hands and face fit each pose instead of running a fixed
  wave. Three poses for the small parts (counting on the fingers, toes, face) with a
  close-up view of hands, feet or face on both sides.
- `reference/js`: `estimateHipsHeight` in `scripts/pose-fk.mjs`, and a test that the
  Appendix D estimate gives the stated hips height for `p01`–`p08` and misses it for `p09`.
- §8.2: a receiver MAY apply a light low-pass filter (e.g. One-Euro) to the interpolated
  output; stated as optional and weak, and not a substitute for sender-side filtering
  (§7). Clarifies the split: the sender denoises before encoding, the receiver
  reconstructs. No wire change.

### Changed
- §3.2: the MMD conversion is marked untested. It was never checked on an MMD/PMX model
  and assumes a per-bone rest rotation that PMX bones do not carry. A tested PMX driver
  is planned for 1.4.
- §1.1: the largest v1 frame is 238 bytes, not 202. The length formula counts a
  quaternion for each of the reserved `bone_mask` bits 55–63, and a relay passes them.
  Behaviour is unchanged; only the stated figure was wrong.
- §5.1, §9: the `version` byte is the minor revision of the spec release; 1.2 writes 2.
  The spec described the byte three ways ("= 1", "the minor revision", "major v1"), and
  1.1.0 still wrote 1. Decoders are unaffected: any value 0–15 was and is accepted. Every
  frame vector changes in byte 0 and nowhere else. The codec exports `VERSION`.
  `DECISIONS.md` 0003.
- §5.5: the thumb flexes about **Y**, toward the fingers (positive on the left hand,
  negative on the right). It was about Z like the other fingers, which bends the thumb
  away from the palm. `docs/DECISIONS.md` 0002.
- §5.5: signs stated per hand for splay (−Y left, +Y right) and for thumb opposition
  (+X on both hands), and the order on the proximal joint (`q_splay · q_curl`). These
  were prose only.

### Fixed
- §3.2 said a runtime's normalized rig of a VRM 0.x model already faces +Z. three-vrm
  leaves it facing −Z, where X and Z rotations are inverted. §3.2 now says: the wire is
  in avatar space for every avatar; adapting to a rig that is not is the job of the
  avatar driver on both ends; for a −Z-facing VRM 0.x rig that is `(−x, y, −z, w)`.
- Loopback demo showed VRM 0.x models from behind and applied X and Z rotations to them
  inverted. It now turns them and converts.
- Appendix D put the hips 3 cm too high when kneeling with the insteps on the floor: it
  used the ankle's T-pose clearance, which holds only with the sole down. A foot whose
  sole faces up now gets the shin radius. Informative text; no change on the wire.
- `docs/DECISIONS.md` 0001: alternative D was described as still listed in §11; it was
  removed in 1.1.0.
- Vector 007 generator comment described bit 9 as "turned out"; by §3.4 it swings across
  the body. Bytes unchanged.
- Loopback demo wrote the blink weight to Standard-Sync slots 8 and 9 (`angry`, `sad`);
  §5.6 puts `blinkLeft` / `blinkRight` in slots 0 and 1.

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
- §3.2: the MMD conversion is marked untested. It was never checked on an MMD/PMX model
  and assumes a per-bone rest rotation that PMX bones do not carry. A tested PMX driver
  is planned for 1.4.
- §1.1: the largest v1 frame is 238 bytes, not 202. The length formula counts a
  quaternion for each of the reserved `bone_mask` bits 55–63, and a relay passes them.
  Behaviour is unchanged; only the stated figure was wrong.
- §5.1, §9: the `version` byte is the minor revision of the spec release; 1.2 writes 2.
  The spec described the byte three ways ("= 1", "the minor revision", "major v1"), and
  1.1.0 still wrote 1. Decoders are unaffected: any value 0–15 was and is accepted. Every
  frame vector changes in byte 0 and nowhere else. The codec exports `VERSION`.
  `DECISIONS.md` 0003.
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
