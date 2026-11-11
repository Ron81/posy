// The 30 finger bones of both hands (spec §5.5), for either avatar and for both ways the
// wire carries fingers: the compact block, or one rotation per joint (`finger_bones`).
//
// The synthesis itself is not written again here. It is the reference implementation's
// `finger-fk.mjs`, the code the finger pose vectors (testvectors/poses/f*, g*) are tested
// against.
import { BONE_NAMES, FINGER_BIT_HIGH, FINGER_BIT_LOW, type Frame, type Quat } from 'posy';
import { fingerPose, thumbRestTurn, REST_HAND } from '../../../reference/js/scripts/finger-fk.mjs';

export type Fingers = NonNullable<Frame['fingers']>;
type Side = 'left' | 'right';
type Vec3 = [number, number, number];

/** `T0` of each hand: the turn from the avatar's resting thumb onto the reference thumb. */
export interface ThumbRest {
  left: Quat;
  right: Quat;
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** A hand whose thumbs rest like the reference hand's: the stick figure. */
export const REFERENCE_THUMBS: ThumbRest = { left: IDENTITY, right: IDENTITY };

/**
 * The axes rule: measured once at load, from the direction metacarpal joint → distal joint
 * of each thumb in the T-pose, in avatar space. A hand without thumb bones keeps identity.
 */
export function measureThumbs(resting: (side: Side) => Vec3 | null): ThumbRest {
  const turn = (side: Side) => {
    const d = resting(side);
    return d && Math.hypot(...d) > 0 ? (thumbRestTurn(side, d) as Quat) : IDENTITY;
  };
  return { left: turn('left'), right: turn('right') };
}

/** Bone name → rotation for all 30 finger bones, from the block; no block → the rest hand. */
export function fromBlock(fingers: Fingers | undefined, rest: ThumbRest): Map<string, Quat> {
  const out = new Map<string, Quat>();
  for (const side of ['left', 'right'] as const) {
    const hand = fingers?.[side];
    const bytes = hand ? { curl: hand.curl, splay: hand.splay, opposition: hand.thumbOpposition } : REST_HAND;
    for (const [bone, q] of Object.entries(fingerPose(side, bytes, rest[side]))) out.set(bone, q as Quat);
  }
  return out;
}

/**
 * What a receiver shows: the block if the frame has one; otherwise the finger bones of the
 * frame, and for every joint whose bit is clear its rest-hand rotation (§3.3, §5.5).
 */
export function handJoints(frame: Frame, rest: ThumbRest): Map<string, Quat> {
  const joints = fromBlock(frame.fingers, rest);
  if (frame.fingers) return joints;
  for (let bit = FINGER_BIT_LOW; bit <= FINGER_BIT_HIGH; bit++) {
    const q = frame.bones.get(bit);
    if (q) joints.set(BONE_NAMES[bit], q);
  }
  return joints;
}

/** The same joints keyed by `bone_mask` bit, as a `finger_bones` sender transmits them. */
export function toFingerBones(joints: Map<string, Quat>): Map<number, Quat> {
  const out = new Map<number, Quat>();
  for (let bit = FINGER_BIT_LOW; bit <= FINGER_BIT_HIGH; bit++) {
    const q = joints.get(BONE_NAMES[bit]);
    if (q) out.set(bit, q);
  }
  return out;
}
