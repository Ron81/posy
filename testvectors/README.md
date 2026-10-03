# Test vectors

**How to check an implementation:** decode each `.bin` in `frames/`, compare the result with the matching `.json`, and *reject* the ones marked `"expect": "reject"`. Then check `quaternions.csv`. All green = conformant. That's it.

If a vector ever disagrees with `spec/Posy-1.0.md`, the **spec wins** and the vector gets fixed (open an issue).

## `frames/`

Each vector is a pair: `NNN-name.bin` (the exact bytes) and `NNN-name.json` (what a correct receiver must produce).

| Vector | What it tests |
|---|---|
| `001-minimal` | Smallest useful frame — header plus one bone. Good first target. |
| `002-fullbody-standard` | Full-body mask, root, fingers, Standard-Sync face + gaze |
| `003-perfectsync` | 52-blendshape face block (`PERFECT_SYNC`) |
| `004-malformed-length` | Length doesn't match the flags → **must be rejected** |
| `005-quat-edgecases` | Components near ±1/√2, sign flips, ties between equally large components |

### JSON format

```jsonc
{
  "name": "001-minimal",
  "description": "one bone (hips, identity), nothing else",
  "expect": "accept",                       // or "reject"
  "bytes_hex": "01 00 01 00 00 00 00 00 01 00 00 00 00 00 00 00 00 02 08 E0",
  "frame": {                                // absent when expect = "reject"
    "version": 1,
    "flags": 0,
    "seq": 1,
    "timestamp_ms": 0,
    "bone_mask": "0x0000000000000001",      // string: u64 doesn't fit a JSON number
    "bones": [
      { "bit": 0, "name": "hips", "u32": "0xE0080200", "quat": [0.0, 0.0, 0.0, 1.0] }
    ],
    "root": null,                           // or { "x": u16, "y": u16, "z": i16, "h": u16 }
    "fingers": null,                        // or { "left": [12 bytes], "right": [12 bytes] } as integers (splay bytes signed)
    "expressions": null                     // or { "perfect_sync": bool, "weights": [...], "gaze_yaw": i8, "gaze_pitch": i8 }
  }
}
```

For `reject` vectors, `frame` is replaced by `"reason"` (a short human-readable explanation). Which exact error you report is up to you — the test is only that the frame is refused.

### Comparison rules

- **Integers and `u32` values must match exactly.**
- Quaternion floats (`quat`) are the result of dequantising *and renormalising* (spec §5.3) — compare with a tolerance of `1e-5` per component, so float32 and float64 implementations both pass.
- Round-trip check: encoding `frame` must produce exactly `bytes_hex` (when your encoder follows the tie-break rule in §5.3).

## `quaternions.csv`

```
id,x,y,z,w,expected_u32,largest_index,note
```

Input quaternion → expected packed `u32`. Normalise the input first (§5.3 step 1). `largest_index` is 0=x, 1=y, 2=z, 3=w. A few things this file exists to catch:

- `q` and `−q` must give the **same** `u32` (sign flip, §5.3 step 3).
- Ties: when two components have equal magnitude, the **lowest index** is the dropped one.
- A zero component quantises to `512` (`0x200`) — 1023 is odd, so the true value is 511.5 and rounds half **up**. Decoding it back gives ≈ 0.0007, so an identity rotation comes back ≈ 0.14° off. That's expected.
- Use the spec's literal constants `0.70710678` and `1.41421356`, not `Math.SQRT1_2` — otherwise a few rows will differ in the last bit.

## Adding vectors

New vectors are welcome, but they must be checked against the spec text, not just against the reference implementation — see the verification notes in `VERIFICATION.md`.
