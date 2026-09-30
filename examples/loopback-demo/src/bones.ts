// Bone bit indices we actually drive (from spec §4 / BONE_NAMES order).
// Kept as named constants so the animator and avatars agree on the wire meaning.
export const BIT = {
  hips: 0,
  spine: 1,
  chest: 2,
  neck: 4,
  head: 5,
  leftShoulder: 17,
  leftUpperArm: 18,
  leftLowerArm: 19,
  leftHand: 20,
  rightShoulder: 21,
  rightUpperArm: 22,
  rightLowerArm: 23,
  rightHand: 24,
} as const;

// Standard-Sync expression block order (spec Appendix A, first 16 of the sorted
// ARKit list). We only need the eye-blink pair for this demo.
export const STANDARD_BLENDSHAPES = [
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
] as const;

export const BLINK_LEFT_INDEX = 8; // eyeBlinkLeft
export const BLINK_RIGHT_INDEX = 9; // eyeBlinkRight
