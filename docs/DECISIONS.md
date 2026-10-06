# Design decisions

Significant, hard-to-reverse protocol decisions, newest first. Each entry records the
context, the decision, the alternatives rejected, and the consequences — the reasoning
that commit messages and the spec text do not keep in one place.

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
