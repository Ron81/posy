# Posy roadmap — the road to 1.5

This is where 1.x is going. It is a plan, not a promise of dates. The guiding rule is the one in
§9: Posy is **soft-locked**, not frozen — the packet format (§5) and signaling (§2) may still change
in a 1.x revision, but every change needs a stated justification, and once a real implementation
ships on a given shape, that shape is settled.

We are in a deliberate, time-boxed window where the last few **breaking** tidy-ups land together, as
a sequence of small reviewed changes, and then the core locks down for a long, calm, **additive-only**
1.x. The intent is simple: anyone building on Posy after 1.5.0 should be able to treat the wire as
stable for a long time.

## Why a window, and why now

Earlier releases left a handful of changes that are each small but each break the wire or the
signaling layer: a mask-width question, a couple of naming cleanups, and a new finger-fidelity option
that needs real estate in the bone mask. Dribbling them out one per release would mean many breaking
1.x bumps spread over months. Instead they land close together, each on its own reviewed branch, and
**1.5.0 is the line** past which the core is treated as locked.

The version byte on the wire is the **minor** revision (§9), so every step in this window writes the
same byte until 1.5.0; the sub-numbers below are release labels, not wire versions.

## The sequence

| Step | What | Wire? |
|---|---|---|
| **1.3.2** *(done)* | `session.multiplexed` handshake field, so a receiver knows up front whether a connection carries the §1.3 multi-sender `uid` prefix. | No — signaling only. |
| **1.4.0** *(done)* | A per-joint **`finger_bones`** type: full per-joint finger rotations as a declared alternative to the compact one-curl-per-finger block (§5.5), for rigs and poses the compact block can't express (e.g. a claw). Carried on reserved `bone_mask` bits, mutually exclusive with the existing `fingers` type. Folds in the long-planned mask-check tidy-up (one unified grant check over the whole mask; bits that belong to no type are rejected by relays). | **Yes.** |
| **1.4.1** | Small spec cleanups batched together: directional tongue moves into declared extras, the expression tiers are renamed, and a size estimate is corrected. | Mixed. |
| **1.4.5** | A tested **PMX / MMD driver** and normative per-type driver sections (§3.2), verified against the pose vectors in a real MMD runtime, plus pinning a single hips-height landmark across avatar types. | **Yes.** |
| *(free gaps)* | The numbers between the planned steps (1.4.2–1.4.4, 1.4.6–1.4.9) are kept free, so a surprise fix never has to wait for the next planned step. | — |
| **1.5.0** | The window closes. The core is locked for a long additive-only 1.x. | Locks it. |

## The gate before 1.5.0

1.5.0 is not cut on a checklist alone. Once the last step above is in, the whole window is exercised
in **real use** — real people, live tracking, a real relay, mixed avatar types in one room, every new
wire feature used at least once — and 1.5.0 ships on the strength of that run. If something breaks, it
comes back as a fix on one of the free numbers, and the window stays open until the real-use pass is
clean.

## After 1.5.0

A long, calm run of **additive-only** 1.x: new optional data types and extras, new profiles, more
language ports — nothing that breaks a 1.5+ implementation. The extras mechanism (§5.8) is what makes
this possible: most new needs are a declared extra, not a format change.

**2.0 is deliberately far off.** It is the rare, last-resort home for a change that genuinely cannot
be additive — not where routine work goes. The honest summary: after 1.5.0, if you ship against Posy,
you should be able to stop watching for breaking changes.

---

*Change history is in [`CHANGELOG.md`]; the reasoning behind the harder calls is in
[`docs/DECISIONS.md`]. Spec changes start with an issue — see [`CONTRIBUTING.md`].*

[`CHANGELOG.md`]: CHANGELOG.md
[`docs/DECISIONS.md`]: docs/DECISIONS.md
[`CONTRIBUTING.md`]: CONTRIBUTING.md
