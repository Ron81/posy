# Contributing

Thanks for poking at Posy. Short version:

- **Issues are for the protocol** (spec bugs, ambiguities, conformance problems). **Discussions are for everything else** — "how do I do rooms in mediasoup?" belongs there.
- **Spec changes need an issue first.** Say what's wrong or unclear and we agree on the fix before anyone writes text.
- **Packet-format changes need a major version** (`posy/2`). Anything that changes byte layout, bit meanings, or the bone/blendshape tables is a v2 conversation, not a patch.
- **One normative source:** if the spec, the reference code and the test vectors disagree, the spec wins and the others get fixed. (The one exception is a spec that is plainly wrong — say so in the issue.)
- **Behaviour changes touch all three together:** spec text, reference implementation and test vectors, in the same PR, with `npm test` green (run it in `reference/js`).
- **Generated files stay generated:** don't hand-edit `spec/blendshape-order.json`, `spec/bone-index-table.md` or `reference/js/src/tables.generated.ts` — change `scripts/generate-spec-tables.mjs` and re-run it.
- Implementations in other languages are welcome! Please open a PR adding a link to the README.
- Informal is fine. Be kind, be specific.
