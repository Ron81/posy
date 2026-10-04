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

// Standard-Sync expression slots by name (spec §5.6).
export const SLOT = {
  blinkLeft: 0,
  blinkRight: 1,
  aa: 2,
  ih: 3,
  ou: 4,
  ee: 5,
  oh: 6,
  happy: 7,
  angry: 8,
  sad: 9,
  relaxed: 10,
  surprised: 11,
  neutral: 12,
  tongueOut: 13, // u8
  tongueX: 14, // i8, positive = toward the avatar's own left
  tongueY: 15, // i8, positive = upward
} as const;
