# Verification log

The reference implementation generated these vectors, so on its own it proves nothing: a bug in the encoder would silently produce a "correct" vector. To stop the code from becoming the spec, at least **3–4 vectors were re-derived by hand, byte by byte, from the spec text** — without importing the reference implementation.

| Vector | What was checked | How | Verified by | Date | Result |
|---|---|---|---|---|---|
| `001-minimal` | every byte (header, mask, one quaternion) | independent script from §5.1 + §5.3 | Ron81 | 2026-09-29 | ✅ |
| `002-fullbody-standard` | every byte: header, mask `0x01fffe3f`, 22 identity quaternions, 8 B root block, both hands, expression block, total length (154 B) | independent script from §5.1 + §5.3–§5.6 | RaelRotschwinge | 2026-10-03 | ✅ (re-verified after the mask fix and the 8 B root block, see Notes) |
| `004-malformed-length` | length formula (§5.1) says reject (001 minus its last byte) | by hand | Ron81 | 2026-09-29 | ✅ |
| `005-quat-edgecases` | 3 quaternions: negated identity, tie `(0,s,0,s)`, 90° about X | independent script from §5.3 | Ron81 | 2026-09-29 | ✅ |
| `007-fullbody-legs` | every byte: header, mask `0x01fffe37`, 21 quaternions built from the axis-angle values in the generator comment, root block with `h` = 18022, both hands, expression block with signed tongue slots, total length (150 B) | independent script from §5.1 + §5.3–§5.6 | RaelRotschwinge | 2026-10-03 | ✅ |

**Rules**

- "Independent script" means a throwaway script written from the spec text alone (not derived from `reference/js`), or a spreadsheet/calculator.
- If a hand-derived value disagrees with a vector: the **spec text wins**. Fix the reference implementation and regenerate — unless the spec itself is plainly wrong, in which case open an issue and fix the spec first.
- Record disagreements here, even after they're fixed. They're the most useful part of this file.

## Notes

- `001-minimal` reproduces byte-for-byte: `01 00 01 00 00 00 00 00 01 00 00 00 00 00 00 00 00 02 08 E0`. The hips identity quaternion packs to `0xE0080200` (little-endian `00 02 08 E0`), matching Appendix A.
- `005` tie case `(0, s, 0, s)` with `s = 0.70710678`: `y` and `w` are equal-magnitude, so the **lowest index** (`y`, index 1) is dropped → `0x600803FF`. This matches the Appendix A anchor table, derived independently of the reference code.
- A decoded quaternion re-encoded is **angle-stable but not always byte-stable** for exact ties: reconstructing the dropped component can tip a tie the other way. This is inherent to smallest-three and expected; conformance compares decoded quaternion floats with a `1e-5` tolerance rather than requiring a byte-identical re-encode for the edge-case vector.
- **Disagreement, fixed (1.1.0):** `002-fullbody-standard` is described as spine/head + legs + arms, but its mask was `0x00fffe3f`, which omits bit 24 (`rightHand`) while including bit 20 (`leftHand`). The generator's bit list ended at 23. The vector decoded correctly, so no test caught it; it was a wrong reference for a full-body mask. Fixed to `0x01fffe3f` (22 bones).
- `002` and `003` changed length in 1.1.0 because the root block grew from 6 B to 8 B (§5.4, hips height `h`): 148 → 154 B (including the added bone) and 152 → 154 B.
- `007` is the first vector with non-identity leg and toe quaternions; before it, a decoder that swapped or misaligned leg bones would have passed every vector, because 002 carries identity in all of them. Its tongue slots check the `i8` reading of slots 14 and 15: bytes `c8 c0 20` are `tongueOut` = 200, `tongueX` = −64, `tongueY` = 32.
