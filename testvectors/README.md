# Test vectors

**How to check an implementation:** decode each `.bin` in `frames/`, compare the result with the matching `.json`, and *reject* the ones marked `"expect": "reject"`. Then check `quaternions.csv`. All green = conformant. That's it.

If a vector ever disagrees with `spec/Posy.md`, the **spec wins** and the vector gets fixed (open an issue).

## `frames/`

Each vector is a pair: `NNN-name.bin` (the exact bytes) and `NNN-name.json` (what a correct receiver must produce).

| Vector | What it tests |
|---|---|
| `001-minimal` | Smallest useful frame — header plus one bone. Good first target. |
| `002-fullbody-standard` | Full-body mask, root, fingers, Standard-Sync face + gaze |
| `003-perfectsync` | 52-blendshape face block (`PERFECT_SYNC`) |
| `004-malformed-length` | Length doesn't match the flags → **must be rejected** |
| `005-quat-edgecases` | Components near ±1/√2, sign flips, ties between equally large components |
| `006-reserved-bits` | A reserved bone bit is set — the frame **must be accepted** and the extra quaternion skipped |
| `007-fullbody-legs` | Distinct non-identity leg and toe rotations, lowered hips height `h`, signed tongue slots |
| `008-extras` | The extras block (§5.8) of a declaration with 2 bones and 3 values. Its size is not in the frame: the JSON carries `extra_counts`, which stands for the declaration |
| `009-extras-wrong-counts` | The bytes of 008 under a declaration of 3 bones and 3 values → **must be rejected** |

### JSON format

```jsonc
{
  "name": "001-minimal",
  "description": "one bone (hips, identity), nothing else",
  "expect": "accept",                       // or "reject"
  "bytes_hex": "03 00 01 00 00 00 00 00 01 00 00 00 00 00 00 00 00 02 08 E0",
  "frame": {                                // absent when expect = "reject"
    "version": 3,
    "flags": 0,
    "seq": 1,
    "timestamp_ms": 0,
    "bone_mask": "0x0000000000000001",      // string: u64 doesn't fit a JSON number
    "bones": [
      { "bit": 0, "name": "hips", "u32": "0xE0080200", "quat": [0.0, 0.0, 0.0, 1.0] }
    ],
    "root": null,                           // or { "x": u16, "y": u16, "z": i16, "h": u16 }
    "fingers": null,                        // or { "left": [12 bytes], "right": [12 bytes] } as integers (splay bytes signed)
    "expressions": null                     // or { "perfect_sync": bool, "weights": [raw bytes 0..255], "gaze_yaw": i8, "gaze_pitch": i8 }
    // only when the frame has an extras block (§5.8):
    // "extra_counts": { "bones": B, "values": V },   the list lengths of the declaration; give them to your decoder
    // "extra": { "bones": [ { "u32": "0x…" } ], "values": [raw bytes 0..255] }
  }
}
```

For `reject` vectors, `frame` is replaced by `"reason"` (a short human-readable explanation). A reject vector with a top-level `"extra_counts"` is malformed under that declaration. Which exact error you report is up to you — the test is only that the frame is refused.

### Comparison rules

- **Integers and `u32` values must match exactly.**
- Quaternion floats (`quat`) are the result of dequantising *and renormalising* (spec §5.3) — compare with a tolerance of `1e-5` per component, so float32 and float64 implementations both pass.
- Round-trip check: encoding `frame` must produce exactly `bytes_hex` (when your encoder follows the tie-break rule in §5.3).

## `poses/`

The frame vectors check bytes. They cannot tell whether a knee bends the right way: a decoder that negates an axis still decodes every frame. The pose vectors check **meaning** (spec §3.1, §3.4).

`skeleton.json` is a small reference skeleton: hips and both leg chains, each joint with its parent and its T-pose offset in metres (left = +X, up = +Y, forward = +Z). Each `pNN-name.json` is one pose:

```jsonc
{
  "name": "p02-knee-flexion",
  "description": "left knee bent 90 deg, shin pointing back (leftLowerLeg +X)",
  "bones": [                                // parent-relative quaternions [x, y, z, w]; bones not listed are identity
    { "bit": 10, "name": "leftLowerLeg", "quat": [0.707107, 0, 0, 0.707107] }
  ],
  "hips_height": 0.93,                      // hips above the floor, metres
  "h": 32768,                               // the same as the root-block value: round(hips_height / standing_hip_height * 32768)
  "expect": {                               // joint positions relative to the hips, metres
    "leftFoot": [0.1, -0.45, -0.4]
    // ... every joint of the skeleton
  }
}
```

**How to check:** apply the quaternions to the skeleton by forward kinematics — a joint's position is its parent's position plus the parent's avatar-space rotation applied to the joint's offset; a bone's avatar-space rotation is its parent's times its own quaternion — and compare every joint with `expect`.

- Tolerance **1e-4 m** when the quaternions are used as given.
- Tolerance **1 cm** when they have been through the wire encoding (§5.3) first.

| Vectors | What they pin |
|---|---|
| `p01` … `p05` | one group of the §3.4 table each: hip flexion, knee flexion, hip abduction, hip external rotation, ankle and toes — left and right where the sign is mirrored |
| `p06-seated-crossed-legs` | one thigh crossed over the other knee |
| `p07-seated-ankle-on-knee` | ankle resting on the opposite knee; a three-rotation upper leg, so product order matters |
| `p08-kneeling` | knees, shins and insteps on the floor |
| `p09-seated-feet-off-floor` | both feet clear of the floor; `h` cannot be derived from the legs here |

`h` is checked against `hips_height` only. For `p01`–`p08` it equals the lowest-contact estimate of spec Appendix D to within 1 mm (ankle 0.08 m and toes 0.01 m above the floor in the T-pose, shin radius 0.05 m); for `p09` it does not, which is the reason `h` is transmitted rather than derived.

### Finger poses (`hand-skeleton.json`, `f01`–`f07`)

The frame vectors pin the bytes of the finger block (§5.5); they cannot tell whether the receiver *synthesises* the right rotations from them — a decoder that curls the thumb about the wrong axis still decodes every frame. The finger pose vectors check that synthesis.

`hand-skeleton.json` is a reference hand (both hands) in the T-pose: palm down, index–little along ±X, the thumb forward and outward in the palm plane; `Tip` joints are end points, not bones. Each `fNN-name.json` carries the input **bytes**, not quaternions, because the receiver builds the rotations:

```jsonc
{
  "name": "f02-thumb-curl",
  "description": "...",
  "bytes": {                                 // one hand each; curl/splay are [thumb, index, middle, ring, little]
    "left":  { "curl": [255,0,0,0,0], "splay": [0,0,0,0,0], "opposition": 0 },
    "right": { "curl": [255,0,0,0,0], "splay": [0,0,0,0,0], "opposition": 0 }
  },
  "expect": {                                // joint positions relative to the wrist, metres
    "leftThumbTip": [0.064426, 0, 0.025958]
    // ... every joint of the hand skeleton
  }
}
```

**How to check:** synthesise the finger-bone rotations from `bytes` by §5.5, apply them to the hand by the same forward kinematics as the leg poses, and compare every joint with `expect`. Tolerance **1e-4 m**. The synthesis is spec text, not a wire format, so there is no wire-encoding tolerance here.

| Vectors | What they pin |
|---|---|
| `f01-four-fingers-curl` | index–little flexion about Z, mirrored sign (−Z left, +Z right) |
| `f02-thumb-curl` | thumb flexion about **Y**, not Z — the fingertip stays in the palm plane (`y = 0`), which a Z-axis synthesis would violate |
| `f03-index-splay` | splay about Y on the proximal only, mirrored sign |
| `f04-thumb-opposition` | opposition about X on the metacarpal, positive on both hands |
| `f05-fist` | every flexion axis and the opposition at once |
| `f06-count-two` | an asymmetric pose: the right hand is not a copy of the left |
| `f07-half-curl-splay` | the product order `q_splay · q_curl` on the proximal bone; the thumb splay sign and that it sits on `thumbProximal`; flexion linear in the curl byte. The only pose with curl and splay on one bone and with a curl byte other than 0 or 255 |

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
