# Contributing

Thanks for poking at Posy. Short version:

- **Issues are for the protocol** (spec bugs, ambiguities, conformance problems). **Discussions are for everything else** — "how do I do rooms in mediasoup?" belongs there.
- **Spec changes need an issue first.** Say what's wrong or unclear and we agree on the fix before anyone writes text.
- **The packet format and signaling are soft-locked.** Byte layout, bit meanings, the bone/blendshape tables and the §2 messages can still change while no implementation has shipped, but every such change needs a stated justification: what it solves, what it costs, what was rejected. Once the format is declared frozen, these changes need a major version (`posy/2`).
- **One normative source:** if the spec, the reference code and the test vectors disagree, the spec wins and the others get fixed. (The one exception is a spec that is plainly wrong — say so in the issue.)
- **Behaviour changes touch all three together:** spec text, reference implementation and test vectors, in the same PR, with `npm test` green (run it in `reference/js`).
- **Generated files stay generated:** don't hand-edit `spec/blendshape-order.json`, `spec/bone-index-table.md` or `reference/js/src/tables.generated.ts` — change `scripts/generate-spec-tables.mjs` and re-run it.
- Implementations in other languages are welcome! Please open a PR adding a link to the README.
- Informal is fine. Be kind, be specific.
