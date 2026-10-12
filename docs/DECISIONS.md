# Design decisions

Significant, hard-to-reverse protocol decisions, newest first. Each entry records the
context, the decision, the alternatives rejected, and the consequences — the reasoning
that commit messages and the spec text do not keep in one place.

---

## 0009 — Two face tiers and nothing between them: `tongueOut` and the `"tongue"` type leave

**Date:** 2026-10-12 · **Status:** Proposed · **Affects:** §1.2, §2.1, §2.6, §5.1, §5.2, §5.6, §6, Appendix B, schema, codec, vectors 002/007/008/009

### Context

0008 moved the tongue direction into declared extras and kept two things: slot 13 `tongueOut`
in the VRM-Sync block, and the `"tongue"` type that gated it (and ARKit index 51 in
Perfect-Sync). Both stood apart from the rest of the format:

- **The type could not be checked.** Every other type is a flag bit or a set of mask bits, and a
  relay checks it in the frame header (§1.2). `"tongue"` was "not visible in the header; the
  sender sends 0 when not granted". A relay that does not read the payload could not tell a
  granted sender from an ungranted one, so `UNAUTHORIZED_TYPE` could not be raised for it, and
  a receiver had no rule for a non-zero byte from a peer whose `sends` lacks the type.
- **The slot was not a VRM preset.** The other 13 slots are the VRM expression presets, which
  every VRM avatar has. A tongue on a VRM avatar is an expression of that one file, which is what
  §2.6 defines as an extra.
- **Few senders can fill it.** The tongue was a permission of its own for one byte. A camera face
  model such as MediaPipe Face Landmarker outputs 52 scores: `_neutral` and 51 of the ARKit
  shapes, with no tongue. The senders that track the tongue use an ARKit-class tracker and
  declare Perfect-Sync, where `tongueOut` is one of the 52 weights.

### Decision

- **The face has two tiers.** VRM-Sync is the VRM presets: 13 slots and the two gaze bytes, 15 B.
  Perfect-Sync is the 52 ARKit weights, unchanged, 54 B. Everything else about a face is a
  declared extra value (§2.6).
- **Slot 13 `tongueOut` leaves the VRM-Sync block.** A VRM-Sync sender whose avatar file defines
  a tongue expression declares it as an extra value under the file's name.
- **The `"tongue"` type is removed.** In Perfect-Sync, `tongueOut` stays weight 51 and is granted
  with `"perfect_sync"` like the other 51. Every remaining type is visible in the frame header.

The version byte stays 4.

### Alternatives rejected

- **Keep slot 13 and the type (0008).** Keeps the one grant a relay cannot enforce, and a byte in
  the preset block that is not a preset. 0008 kept it so that both tiers carry protrusion in the
  block; the tiers are now told apart by what they are (VRM presets, ARKit weights), not by
  carrying the same things.
- **Keep the slot, drop the type** (the byte granted with `"expressions"`). Removes the
  unenforceable grant, but leaves a slot most VRM avatars have no expression for.
- **Take `tongueOut` out of Perfect-Sync as well.** The 52 weights are a list shared by trackers
  and avatars in its fixed order (Appendix A); a 51-weight block would be a list of Posy's own.
- **A permission per extra**, so that a server could admit a tongue and refuse other values. The
  names are the sender's and opaque to the server (§2.6); a permission on a name the sender chose
  controls nothing. What a server can judge is the count, which `extra_max` gives it, per kind.

### Consequences

- The VRM-Sync frame of §6 is 115 B (was 116); Perfect-Sync is unchanged at 154 B.
- Breaking at the block layout and the type list, inside the window. A 1.4.1 encoder writes a
  16 B block; mixed with this layout, every frame with a VRM-Sync block fails the length check.
- A VRM-Sync sender needs the `"extra"` grant to show a tongue; a Perfect-Sync sender does not.
  A server that grants no extra values (`extra_max`) therefore admits no tongue from VRM-Sync
  senders.
- Vectors `002`, `007`, `008` and `009` are one byte shorter and were re-derived independently
  (`testvectors/VERIFICATION.md`). The site and the loopback demo, frozen for their rework, still
  show the older blocks.

---

## 0008 — Directional tongue leaves the block; "VRM-Sync"; richer face sets ride as extras

**Date:** 2026-10-12 · **Status:** Accepted · **Affects:** §2.1, §2.6, §5.1, §5.6, §6, §11, schema, codec

### Context

1.1 added an **interim** directional tongue in three reserved Standard-Sync slots (13
`tongueOut`, 14 `tongueX`, 15 `tongueY`), signed `i8` on 14/15, as a no-wire-change stop-gap. It
had two problems. It spent fixed core bytes on a channel most senders never use, and because it
lived only in the Standard-Sync block it could not coexist with Perfect-Sync (the 52 ARKit slots
have no direction). Separately, the tier names overclaimed in one direction and under-claimed in
the other: a check of the VTuber ecosystem found that **"Perfect Sync" is the established name for
the 52 ARKit blendshapes mapped 1:1** (VMagicMirror, VSeeFace, Vear, Luppet), while Posy's
"Standard-Sync" names the ~16 VRM expression presets — and "standard" is exactly the word the
community attaches to the ARKit-level set, so the name collided. A third item (S10) was an
unsourced "~70× smaller than raw VMC" in §6.

The declared-extras mechanism (ADR 0005) already carries any named scalar an avatar file defines,
plus `app:` names, with no format change. That is the natural home for anything richer than the
core face.

### Decision

- **Directional tongue becomes a declared extra `value`.** Remove slots 14/15; the expression
  block goes 18 B → 16 B. Keep `tongueOut` (slot 13), which matches ARKit index 51 in Perfect-Sync.
  Left/right, up/down, roll and curl are declared `values` (§2.6) by the sender's own names and
  compose with `tongueOut`. This needs no format change to grow and works alongside Perfect-Sync.
- **Rename the compact tier `Standard-Sync` → `VRM-Sync`.** Keep `Perfect-Sync`, the `PERFECT_SYNC`
  flag and the `perfect_sync` grant exactly as they are — they are the recognised community names.
  Only the colliding name changes. The `"tongue"` grant now gates just `tongueOut`.
- **Do not define a Posy face-shape vocabulary.** A one-sentence, non-normative note in §2.6 points
  at the community sets (ARKit extras, VRCFaceTracking Unified Expressions, MMD morphs) as examples
  carried by their own names; no list is blessed as canonical. The mechanism is the standard.
- **Restate the VMC figure (S10)** with arithmetic: ~25–35× (≈28× for the 116 B body+fingers
  example, ≈36× for a ~55-bone humanoid), replacing the bare 70×.

The version byte stays 4: 1.4.1 is still minor revision 4 (§9).

### Alternatives rejected

- **The 2.0-candidates 3-tier rename** (Standard→Basic, Perfect→Standard, add Extended). It shifts
  the referents of existing names — "Standard" would mean 16 VRM in old docs and 52 ARKit in new
  ones — which is the worst outcome for an interop spec, and it discards the recognised "Perfect
  Sync" name. Rejected in favour of renaming only the colliding tier.
- **Keep directional tongue as core slots.** Spends fixed bytes on an uncommon channel and cannot
  coexist with Perfect-Sync; the extras mechanism already covers it for free.
- **Bless Unified Expressions (or any list) as the Posy extra-shape vocabulary.** Nobody has
  requested it; naming a list implies the unnamed ones are second-class and creates a maintenance
  burden against an evolving external standard. The by-name mechanism stays agnostic.
- **Move all of the tongue (incl. protrusion) to extras.** Would split protrusion from where ARKit
  and Perfect-Sync carry it; keeping `tongueOut` inline keeps the two tiers consistent.

### Consequences

- The VRM-Sync frame is 116 B (was 118); Perfect-Sync is unchanged at 154 B. Senders that used the
  interim directional slots re-declare that tongue as extras.
- Richer face tracking — Unified-Expressions-grade tongue, cheek, jaw, lip detail — needs no future
  format change; it is a declaration, which is the whole point of the extras keystone (ADR 0005).
- Breaking at the block layout and the tier vocabulary, hence the window. Test vectors `002`/`007`/
  `008`/`009` were re-encoded (quaternion/root/finger/extras bytes unchanged). The interactive site,
  frozen for its 1.5.0 rework, still shows the old 16-slot block; its drift tests are skipped with a
  note until then.

---

## 0007 — Per-joint finger bones, and one grant check over the whole mask

**Date:** 2026-10-12 · **Status:** Accepted · **Affects:** §1.2, §2.1, §4, §5.5, §6, §9, schema

### Context

Fingers ship as a compact block (§5.5): one curl byte per finger drives all three of its joints
on a fixed distribution, plus splay and thumb opposition. A same-rig test (sender driving its own
avatar, no cross-rig retarget) found one shape the model cannot reach: a claw, where the base
joints stay straight and only the outer joints bend. One curl byte cannot hold "straight, then
bent." Widening the block (a second curl byte, per-joint bytes) would grow the light default for a
case most senders never hit.

Separately, bits 25–54 of `bone_mask` were reserved for finger bones but banned in v1 (check 3),
and a known defect (S6) let reserved bits 55–63 escape the grant check — the fix had been parked
behind a planned shrink of the mask to `u32`.

### Decision

Add a declared `finger_bones` type: the 30 finger bones carried as ordinary quaternions in bits
25–54, parent-relative in the sender's own rest frame, exactly like every other bone. No new flag
and no new block — they ride in `quaternions[N]`, so the frame-length formula does not change. It
is the declared option for a hand the compact block cannot express; the compact block stays the
light default. The two are **mutually exclusive**: a declaration carries one or the other, and a
frame MUST NOT set `HAS_FINGERS` and any of bits 25–54 at once. A finger bit left clear relaxes to
the §5.5 rest hand for that joint, so an untracked hand behaves as it does under the compact block.

Because finger bones now occupy bits 25–54, the mask stays `u64` and the planned `u32` shrink is
dropped. The S6 fix therefore lands here, as a simplification: §1.2's three mask-related rules
become one check over all 64 bits, `bone_mask & ~granted_mask == 0`. Reserved bits 55–63 belong to
no granted type and so are rejected — as `MALFORMED`, since they can never be legitimate. This is a
**relay** check; a **receiver** still ignores unknown mask bits (§9), so the extension mechanism and
vector `006-reserved-bits` are unchanged.

### Alternatives rejected

- **Widen the compact block** (a second curl byte, or per-joint curl bytes). Grows the default
  frame for every finger sender to serve the uncommon case; the claw still is not a curl.
- **Carry finger bones as declared extras (§5.8).** Rejected: §2.6 bans finger bones from extras,
  and the bits already exist in `bone_mask` with names — a spare-bits home is cleaner than a named
  payload for a fixed, standard set of bones.
- **Keep the `u32` shrink and relocate finger bones.** The shrink saved 4 B per frame and cost the
  30 finger bits their natural home; keeping `u64` and rejecting 55–63 at the relay is the smaller,
  clearer rule. (The two cannot both hold — fingers want bits 25–54, the shrink removes them.)
- **A "full fingers" flag + fixed 120 B block.** Spends one of the two remaining flag bits, cannot
  omit an unsolved joint (§3.3), and saves nothing over per-bit quaternions.

### Consequences

- A claw and other base-straight/outer-bent shapes are expressible, per-joint, at 4 B per sent
  joint; a sender sends only the joints it solves and clears the rest to the rest hand.
- §1.2 is shorter: one grant check instead of three rules. Reserved bits 55–63 are now rejected by
  a relay (previously passed) — the one breaking change, hence the window.
- The largest defined-block frame grows to 298 B (still far under the 1100 B / single-datagram
  ceiling). The compact-block path is unchanged at 202 B.
- The decoder does not change: it already consumes a quaternion for every set bit and stores it by
  bit number, finger and reserved bits included.

---

## 0006 — The multi-sender `uid` prefix is declared at the handshake, not inferred per message

**Date:** 2026-10-12 · **Status:** Accepted · **Affects:** §1.3, §2.1 (`session.multiplexed`), schema

### Context

1.3.1 made a server that multiplexes several senders onto one WebSocket prefix each
forwarded binary pose message with a routing header: a 1-byte length `L` (1–255), `L` bytes
of the sender's `uid`, then the unmodified frame (§1.3). The clarification was sound but
underspecified the receiver side: it said the prefix "appears only on a shared multi-sender
socket" without giving the receiver any way to know whether a given connection is one. A
receiver cannot tell a prefixed message from a bare frame by inspection — byte 0 of a frame
is `version` (0–15, §5.1) and byte 0 of a prefix is `L` (1–255), so a `uid` of 15 bytes or
fewer makes the two indistinguishable (the spec's own example `u_8f31` gives `L = 6`). A
server that began prefixing only once a second sender joined would also change the stream
format mid-session. Two independent implementations would interoperate only by out-of-band
agreement — a real gap in released text.

### Decision

The server declares it once, at the handshake, in the `session` message (§2.1): an optional
boolean `multiplexed` (absent ⇒ `false`). When `true`, **every** forwarded binary pose
message on that connection carries the `uid` prefix — including while only one sender is in
the room — so the stream format is fixed for the life of the connection and the receiver
parses the prefix unconditionally. When `false` or absent, no message is prefixed and byte 0
is always `version`. A server that may ever multiplex MUST set it `true` from the first
`session`. It is a connection property alongside `transport`, independent of `allowed`. No
change to the pose frame, the codec, or any test vector.

### Alternatives rejected

- **Self-describing first byte** (e.g. a length byte with the high bit set to mark a prefix).
  Needs no handshake field, but it is a decode trick a reader has to be told about, and
  stating connection properties up front at the handshake is how `transport` and the rest of
  the protocol already work.
- **Infer from room state** (prefix only while >1 sender present). Changes the stream format
  mid-session and still leaves a lone-sender message ambiguous. Rejected.
- **A new per-frame sender tag.** Rejected in 1.3.1 already; the `uid` prefix reuses an
  existing identifier and this ADR only fixes how the receiver learns to expect it.

### Consequences

- A receiver knows from `session` whether to strip a prefix; the byte-0 ambiguity never
  arises.
- One optional boolean on `session`; direct, one-sender-per-socket and single-client-loop
  deployments leave it `false` and are unaffected.
- Editorial, additive to the signaling layer — no wire or codec change, so 1.3.0/1.3.1
  frames and the published package behave identically.

---

## 0005 — Declared extras for everything beyond the humanoid core

**Date:** 2026-10-06 · **Status:** Proposed · **Affects:** §2.1, §2.3, §2.6, §5.1, §5.2, §5.8, §1.2, §9 (flag bit 5, signaling)

### Context

Avatars with a tail, animal ears, wings, four arms or single toes are a requirement, and
so are MMD/PMX avatars. No humanoid standard with wide use defines any of these parts;
production rigs that have them each use their own names. In avatar files they are bones:
passive motion comes from secondary motion on the receiver (VRM spring bones, MMD rigid
bodies), deliberate motion from an animation or mechanism on the sender, or from a
control the file defines (an expression, an MMD bone morph).

### Decision

The humanoid core stays fixed. Everything else is declared by the sender, by the names
in its own avatar file, as two lists: bones (a rotation each) and values (a byte each).
One block at the end of the frame carries them in declaration order, behind flag bit 5.

- Both lanes are required from the first release. A values-only first step has no path
  for a sender-driven tail or ear.
- The block carries neither counts nor an identifier. The declaration has both, and it
  states the session time from which it applies; the frame's timestamp selects it.
- One grant, `"extra"`, all or nothing, with server-stated limits for the two lists. The
  server reads two numbers at the handshake and no names.
- A name must be unique in the avatar file. No index fallback.
- A declared extra bone is driven by the sender and leaves receiver physics.
- The `app:` prefix is reserved for values that are not avatar data.

### Alternatives rejected

- **Fixed blocks per body part** (five toes, a tail chain, ears). Any list is wrong for
  the next avatar, and there is no standard to copy.
- **Values first, bones later.** It was argued that no tracker delivers extra bones.
  Animations and sender-side mechanisms do, and they are the common case for ears and
  tails.
- **Counts and an identifier in every frame** (3 bytes). Self-describing frames, but the
  bytes repeat the declaration, and the relay already keeps state per sender.
- **An identifier only** (1 byte). Removes the avatar-switch ambiguity; `since` does the
  same with no bytes per frame.
- **A fixed limit in the spec instead of a grant.** Realistic extras add 6 to 20 kbit/s
  per sender, which does not need a limit; a room should still be able to state one.
- **Two grants**, one per lane. A limit of 0 does the same.

### Consequences

- A frame with extras cannot be sized from its header alone. A relay needs the declared
  counts, a recording needs the declaration.
- Flag bit 5 is spent. Flag-bit extensions are not transparent to relays; §9 says so now.
- "Play animation X" can later be a value, once a way exists for both ends to hold X.
- Tongue direction and further expressions can move into values in the release that
  closes the soft lock.

---

## 0004 — Rest rotation of absent arm bones and the rest hand

**Date:** 2026-10-05 · **Status:** Proposed · **Affects:** §3.3, §5.5, §2.3, §7 (receiver behaviour; nothing on the wire)

### Context

§3.3 had one rule: an absent bone holds the identity quaternion, the T-pose. For spine,
head and legs that is upright standing. For the arms it is arms held out sideways, and a
missing finger block gave flat hands. Senders without arm tracking are a large group:
face tracking with head rotation declares `"bones"` and sends only neck and head. The
loopback demo showed them as scarecrows.

### Decision

An absent bone holds its rest rotation. That is the identity for every bone except
`upperArm` (70° down) and `lowerArm` (10° forward) on both sides, given as literal
quaternions in §3.3. A frame without a finger block is rendered with a fixed relaxed hand
(§5.5). The rule is per bone and independent of the declaration. Idle poses and idle
animations are transmitted by the sender as ordinary bones (§7).

### Alternatives rejected

- **The sender always transmits hanging arms.** No spec change, but 32 bytes per frame
  for a constant, and every sending application has to know to do it.
- **A rest pose only for a type the peer did not declare.** It misses the main case:
  a face tracker with head rotation declares `"bones"`.
- **A receiver-chosen idle pose.** Two receivers would show the same sender differently.
- **An idle pose or a "play animation X" command in signaling.** Animations are not part
  of VRM or PMX avatar files, so it needs file distribution, a format per avatar type,
  timing and blending rules. Recorded as a possible later use of declared extras.

### Consequences

- A sender that wants the T-pose or flat hands has to send it; absence no longer means it.
- A tracker that loses an arm sees it sink to the side after the concealment window
  (§8.3) instead of snapping outward.
- The angles are a choice, not derived. They were set on the loopback demo; other avatar
  types may want different ones.

---

## 0003 — The version byte is the minor revision

**Date:** 2026-10-05 · **Status:** Proposed · **Affects:** §5.1, §9, §1.2 (byte 0 of every frame)

### Context

The spec described byte 0 three ways: §5.1 `version (= 1)`, §9 "carries the minor
revision", and §1.2 / Appendix B `version >> 4 == 0` commented as "major v1". 1.0 and 1.1
both wrote 1, so the byte matched the minor revision in 1.1 only by coincidence, and no
single reading satisfied all three sentences.

### Decision

The byte is the minor revision of the spec release the sender implements. 1.2 writes 2,
1.3 writes 3. The value is 0–15 for every 1.x release; `version >> 4 == 0` tests exactly
that and says nothing about the major version, which stays in the `protocol` string. If a
minor revision above 15 were needed, releases continue as patch releases of 1.15.

### Alternatives rejected

- **A layout counter** that rises only when the frame layout changes. Frame vectors would
  not change with every release, but the number would no longer say which spec text a
  sender follows, and a reader would need a table to map it to a release.
- **Two nibbles, `(major << 4) | minor`, with major stored as 0 for v1.** It explains the
  existing check, but "v1 is stored as 0" is a trap, and the major version already has a
  place.

### Consequences

- Byte 0 of every frame vector changes with each minor release, and only there.
- Decoders do not change: any value 0–15 was and is accepted.
- A receiver can tell which revision's layout a frame follows, which matters while the
  soft lock allows layout changes.

---

## 0002 — Thumb flexion axis, and stated signs for splay and opposition

**Date:** 2026-10-04 · **Status:** Proposed · **Affects:** §5.5 (finger block)

### Context

§5.5 gave one flexion axis for all five fingers: Z, fingertips toward −Y. For splay and
thumb opposition it gave an axis and a description ("toward the thumb side", "across the
palm") but no sign per hand, and it did not say in which order curl and splay combine on
the proximal joint.

The first receiver written from that text (loopback demo, on VRM 1.0 and VRM 0.x models
through three-vrm 3.5.5) showed two things:

- The four fingers curl into the palm as described.
- The thumb does not. In the T-pose the thumb lies in the plane of the palm and points
  forward and outward. A rotation about Z bends it down and, at full curl, back toward
  the wrist. Measured on one model: the thumb tip moves from 7.2 cm to 9.4 cm from the
  base of the index finger. A closing hand showed the thumb sticking out.

### Decision

- Thumb flexion (`thumbProximal`, `thumbDistal`) is about Y: positive on the left hand,
  negative on the right. Same model, same curl: the thumb tip ends 2.6 cm from the base
  of the index finger, and a full curl with half opposition gives a closed fist.
- Splay sign: negative Y on the left hand, positive on the right.
- Opposition sign: positive X on both hands.
- Proximal joint: `q = q_splay · q_curl`.

No byte changes. The meaning of `thumb_curl` changes.

### Alternatives rejected

- **Leave the thumb on Z.** One rule for five fingers is simpler to state, but no hand
  closes that way, and every sender would have to distort its thumb values to
  compensate.
- **Leave the signs as prose.** Two receivers can read "toward the thumb side"
  differently and both conform; the frame vectors compare bytes and cannot tell.
- **A per-avatar thumb axis taken from the model's rest pose.** More faithful on models
  whose thumb is not in the palm plane, but the receiver would have to derive an axis per
  model, and sender and receiver would have to derive the same one.

### Consequences

- A fist, a pinch and a thumbs-up can be expressed with curl and opposition alone.
- Thumb splay and thumb curl share an axis on `thumbProximal`, in opposite senses. They
  stay distinguishable: curl also drives `thumbDistal`, splay does not.
- On a model whose T-pose thumb is rotated out of the palm plane (seen on one VRM 0.x
  model) the thumb closes less cleanly. Accepted.
- Not yet pinned by a test vector. A finger pose vector in the manner of
  `testvectors/poses/` is the open follow-up.

---

## 0001 — Hips height on the wire (full-body grounding)

**Date:** 2026-10-03 · **Status:** Accepted · **Affects:** §5.4 (root block), §8.5
(grounding), §11 (deferred)

### Context

Leg and foot bone rotations do not determine where the hips sit in space. A full-body
avatar that crouches, kneels, or lifts both feet onto a seat needs a vertical hip
placement that the leg rotations alone cannot give. The 1.1.0 draft tried to recover this
on the receiver by forward kinematics from the lowest heel (draft §8.5), with lower and
upper clamps.

That procedure could not work as written:

- The lower clamp ("MUST NOT lower the hips below the T-pose baseline") forbids the crouch
  the procedure exists for — the T-pose hip height is the maximum, so clamping to it rules
  out lowering the hips at all.
- Lowest-contact FK is only correct while some part of a leg touches the floor. It fails
  for both feet up on a seat (a common seated streaming pose), where the avatar drops to
  the floor the instant the second foot lifts, and for a jump.
- "One rig-height unit" (upper clamp) was undefined, and an airborne state cannot be
  detected from hips-relative FK.

Repairing the clamps does not rescue the approach; the failure is in using lowest-contact
FK at all.

### Decision

Carry hips height explicitly on the wire. The root block grows from 6 to 8 bytes with a
`u16 h`: hips height in units of 1/32768 of the avatar's standing hip height (32768 =
standing, 0 = on the floor, up to ~2.0 for a jump). It is a **ratio**, not millimetres, so
it is independent of avatar size and still usable when a receiver shows a placeholder
avatar. `h` is present whenever `HAS_ROOT` is set — not tied to the `legs` grant — so the
frame length stays computable from the header alone; senders without legs send 32768.

The **sender owns the value**. A Posy stream drives the sender's own avatar, rendered by
every receiver, so the sender already sees the grounded result and can transmit it.
Receivers apply and interpolate `h` with no FK, no clamps, and no pose-specific rules.
`z` keeps its depth-in-millimetres meaning; `x`/`y` keep the 2D playspace position.

Length impact: typical frame 116 → 118 B, Perfect-Sync 152 → 154 B, largest v1 frame
200 → 202 B.

### Alternatives rejected

- **A — reinterpret `z` as height.** The target room is 2D: moving away from the camera
  shrinks the avatar (`z` = depth, drives scale); it does not change layer. Depth is not
  height without camera elevation and pitch, which the protocol never carries. Reusing `z`
  would be a semantic break for zero gain.
- **B — receiver-side FK only (the 1.1.0 draft), zero bytes.** Unworkable for the reasons
  in Context: forbids its own crouch, and breaks for feet-up and airborne poses.
- **C — contact flags plus receiver-side leg IK.** Most accurate, but puts an IK solver in
  every receiver. Rejected as too heavy for a protocol whose model is "render the sender's
  avatar as the sender grounded it."
- **D — profile-conditional `z` (z means height only in the full-body profile).** The only
  in-1.x path that reused a field, but ambiguous: the same bytes would mean depth or height
  depending on session state. Rejected. The 1.1.0 draft listed it in §11 as a future
  option; it was removed from §11 together with `root_height_mm` when `h` was adopted.

### Consequences

- Full-body crouch, kneel, cross-legged, and feet-off-floor poses render correctly without
  a receiver IK solver.
- One more field for every sender that sets `HAS_ROOT`; senders without legs send a
  constant 32768.
- The grounding burden sits with the sender, which is where the ground-truth already is.
- Open, deferred past 1.1.0: a sender with no floor reference (both feet up, no seat
  height known) — Appendix D gives an informative lowest-contact estimate with its known
  failure case, but no normative way to learn the seat height.
