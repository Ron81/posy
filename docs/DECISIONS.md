# Design decisions

Significant, hard-to-reverse protocol decisions, newest first. Each entry records the
context, the decision, the alternatives rejected, and the consequences — the reasoning
that commit messages and the spec text do not keep in one place.

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
  in-1.x path that reused a field, but ambiguous and deferred rather than adopted; recorded
  in §11 as a possible future option, not part of 1.1.0.

### Consequences

- Full-body crouch, kneel, cross-legged, and feet-off-floor poses render correctly without
  a receiver IK solver.
- One more field for every sender that sets `HAS_ROOT`; senders without legs send a
  constant 32768.
- The grounding burden sits with the sender, which is where the ground-truth already is.
- Open, deferred past 1.1.0: a sender with no floor reference (both feet up, no seat
  height known) — Appendix D gives an informative lowest-contact estimate with its known
  failure case, but no normative way to learn the seat height.
