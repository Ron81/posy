# Posy roadmap: the road to 1.5

Where 1.x is going. A plan, not a promise of dates.

Until 1.5.0 the packet format (§5) and signaling (§2) may still change in a 1.x release, and
every change needs a stated justification (§9). The breaking changes that were left are made in
this window, each as its own reviewed change, instead of one per release over months. 1.5.0
closes it: from then on 1.x only adds, so that anyone who builds on Posy after 1.5.0 can treat
the wire as stable.

The version byte on the wire is the minor revision (§9). Every release of the window writes the
same byte; the numbers below are release labels, not wire versions.

## The sequence

| Step | What | Wire? |
|---|---|---|
| **1.3.2** *(done)* | `session.multiplexed`: a receiver knows from the handshake whether a connection carries the §1.3 multi-sender `uid` prefix. | No, signaling only. |
| **1.4.0** *(done)* | Per-joint fingers (`finger_bones`): full finger rotations as a declared alternative to the compact block (§5.5), for hand shapes the block cannot express (a claw). On reserved `bone_mask` bits, mutually exclusive with `fingers`. With it, one grant check over the whole mask; relays reject bits that belong to no type. | **Yes.** |
| **1.4.1** *(done)* | Directional tongue moves into declared extras, the expression tiers are renamed, a size estimate is corrected. | Mixed. |
| **1.4.5** *(done)* | A tested PMX / MMD driver and normative per-type driver sections (§3.2), checked against the pose vectors in an MMD runtime; a hips-height landmark per avatar type. | **Yes.** |
| **1.4.6** *(done)* | The session layer reviewed by real use (one clock sync at join, `rate` 0 pauses a sender nobody wants, `IDLE` removed), a long unexplained silence freezes instead of easing to an idle pose (§8.3), and a `silence` message by which a connected sender says why its frames stopped (§2.8). | No frame changes size or layout. |
| *(free)* | 1.4.2–1.4.4 and 1.4.7–1.4.9 are kept free, so that a fix does not wait for the next planned step. | |
| **1.5.0** *(done)* | The window closes. From here 1.x only adds. | Locks it. |

## The gate before 1.5.0

1.5.0 is cut after the whole window has been used for real: real people, live tracking, a real
relay, mixed avatar types in one room, every new wire feature used at least once. A fault found
there is fixed on a free number, and the window stays open until the run is clean.

## After 1.5.0

Additive only: new optional data types and extras, new profiles, ports to other languages.
Nothing that breaks a 1.5 implementation. Most new needs are a declared extra (§5.8), not a
format change. 2.0 is the place for a change that cannot be additive; none is planned.

---

*Change history is in [`CHANGELOG.md`]; the reasoning behind the harder decisions is in
[`docs/DECISIONS.md`]. Spec changes start with an issue, see [`CONTRIBUTING.md`].*

[`CHANGELOG.md`]: CHANGELOG.md
[`docs/DECISIONS.md`]: docs/DECISIONS.md
[`CONTRIBUTING.md`]: CONTRIBUTING.md
