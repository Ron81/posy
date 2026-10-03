// Bone bit indices we actually drive (from spec §4 / BONE_NAMES order).
// Kept as named constants so the animator and avatars agree on the wire meaning.
export const BIT = {
  hips: 0,
  spine: 1,
  chest: 2,
  neck: 4,
  head: 5,
  leftUpperLeg: 9,
  leftLowerLeg: 10,
  leftFoot: 11,
  leftToes: 12,
  rightUpperLeg: 13,
  rightLowerLeg: 14,
  rightFoot: 15,
  rightToes: 16,
  leftShoulder: 17,
  leftUpperArm: 18,
  leftLowerArm: 19,
  leftHand: 20,
  rightShoulder: 21,
  rightUpperArm: 22,
  rightLowerArm: 23,
  rightHand: 24,
} as const;

// Standard-Sync expression slots this demo uses (spec §5.6).
export const BLINK_LEFT_INDEX = 0; // blinkLeft
export const BLINK_RIGHT_INDEX = 1; // blinkRight
export const TONGUE_OUT_INDEX = 13; // tongueOut, u8
export const TONGUE_X_INDEX = 14; // tongueX, i8
