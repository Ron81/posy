---
name: Proposal — change the protocol
about: Propose a new feature or a change to the packet format / signaling
title: "[proposal] "
labels: proposal
---

**What problem are you trying to solve?** (a concrete use case, not just "it'd be nice")

**Proposed change**

**Does it change the packet layout, bit meanings, or the bone/blendshape tables?**
- [ ] No — additive: a new message, field, data type or error code, or one of the reserved places (flag bit 4, flag bits 6–7, bone bits 55–63, the reserved finger byte; spec §9)
- [ ] Yes — this changes or removes something that exists. The format is frozen since 1.5.0, so it needs `posy/2`; state the justification below

**Cost** — extra bytes per frame, extra work for the routing peer, extra work for receivers:

**Alternatives you considered:**

<!--
The packet format and signaling are frozen since 1.5.0: a 1.x revision only adds (spec §9). An addition needs a justification (what it solves, cost, rejected alternatives).
If your idea is already listed in spec §11 (deferred to v2), please add to that discussion instead of opening a duplicate.
-->
