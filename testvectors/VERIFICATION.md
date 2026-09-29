# Verification log

The reference implementation generated these vectors, so on its own it proves nothing: a bug in the encoder would silently produce a "correct" vector. To stop the code from becoming the spec, at least **3–4 vectors were re-derived by hand, byte by byte, from the spec text** — without importing the reference implementation.

| Vector | What was checked | How | Verified by | Date | Result |
|---|---|---|---|---|---|
| `001-minimal` | every byte (header, mask, one quaternion) | independent script from §5.1 + §5.3 | Ron81 | 2026-09-29 | ✅ |
| `002-fullbody-standard` | identity bones u32, root block bytes, first 2 finger bytes, total length (148 B) | independent script from §5.1 + §5.4 + §5.5 | Ron81 | 2026-09-29 | ✅ |
| `004-malformed-length` | length formula (§5.1) says reject (001 minus its last byte) | by hand | Ron81 | 2026-09-29 | ✅ |
| `005-quat-edgecases` | 3 quaternions: negated identity, tie `(0,s,0,s)`, 90° about X | independent script from §5.3 | Ron81 | 2026-09-29 | ✅ |

**Rules**

- "Independent script" means a throwaway script written from the spec text alone (not derived from `reference/js`), or a spreadsheet/calculator.
- If a hand-derived value disagrees with a vector: the **spec text wins**. Fix the reference implementation and regenerate — unless the spec itself is plainly wrong, in which case open an issue and fix the spec first.
- Record disagreements here, even after they're fixed. They're the most useful part of this file.

## Notes

- `001-minimal` reproduces byte-for-byte: `01 00 01 00 00 00 00 00 01 00 00 00 00 00 00 00 00 02 08 E0`. The hips identity quaternion packs to `0xE0080200` (little-endian `00 02 08 E0`), matching Appendix A.
- `005` tie case `(0, s, 0, s)` with `s = 0.70710678`: `y` and `w` are equal-magnitude, so the **lowest index** (`y`, index 1) is dropped → `0x600803FF`. This matches the Appendix A anchor table, derived independently of the reference code.
- A decoded quaternion re-encoded is **angle-stable but not always byte-stable** for exact ties: reconstructing the dropped component can tip a tie the other way. This is inherent to smallest-three and expected; conformance compares decoded quaternion floats with a `1e-5` tolerance rather than requiring a byte-identical re-encode for the edge-case vector.

