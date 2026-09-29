---
name: Proposal — change the protocol
about: Propose a new feature or a change to the packet format / signaling
title: "[proposal] "
labels: proposal
---

**What problem are you trying to solve?** (a concrete use case, not just "it'd be nice")

**Proposed change**

**Does it change the packet layout, bit meanings, or the bone/blendshape tables?**
- [ ] No — additive, fits the existing extension points (reserved flag bits 5–7, reserved bone bits, reserved expression indices, the reserved finger byte)
- [ ] Yes — this is a breaking change and would need a new major version (`posy/2`)

**Cost** — extra bytes per frame, extra work for the routing peer, extra work for receivers:

**Alternatives you considered:**

<!--
Packet-format changes need a major version (posy/2). v1 frames are meant to stay boring and stable.
If your idea is already listed in spec §11 (deferred to v2), please add to that discussion instead of opening a duplicate.
-->
