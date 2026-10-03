// Leg poses for the sender, read straight from the conformance pose vectors
// (testvectors/poses, spec §3.4) so the demo shows exactly what the vectors define.
import * as THREE from 'three';
import type { Quat } from 'posy';

interface PoseVector {
  name: string;
  description: string;
  bones: Array<{ bit: number; quat: [number, number, number, number] }>;
  h: number;
}

const files = import.meta.glob<PoseVector>('../../../testvectors/poses/p*.json', { eager: true, import: 'default' });

const STAND: PoseVector = { name: 'stand', description: 'legs in the T-pose', bones: [], h: 0x8000 };
export const POSES: PoseVector[] = [STAND, ...Object.keys(files).sort().map((k) => files[k])];

const LEG_BITS = [9, 10, 11, 12, 13, 14, 15, 16];
const HOLD_SEC = 2.5;
const BLEND_SEC = 1;

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();

function boneQuat(pose: PoseVector, bit: number, out: THREE.Quaternion): THREE.Quaternion {
  const b = pose.bones.find((x) => x.bit === bit);
  return b ? out.set(...b.quat) : out.identity(); // a bone the pose does not list is identity
}

export interface LegPose {
  bones: Map<number, Quat>;
  h: number;
  /** Index into POSES of the pose being shown (the blend target while blending). */
  index: number;
}

/** `held` = index into POSES to stay on, or null to cycle through all of them. */
export function legPoseAt(tSec: number, held: number | null): LegPose {
  let from = held ?? 0;
  let to = from;
  let k = 0;
  if (held === null) {
    const step = HOLD_SEC + BLEND_SEC;
    from = Math.floor(tSec / step) % POSES.length;
    to = (from + 1) % POSES.length;
    const u = (tSec % step) - HOLD_SEC;
    if (u > 0) {
      const x = u / BLEND_SEC;
      k = x * x * (3 - 2 * x); // ease in and out
    }
  }
  const bones = new Map<number, Quat>();
  for (const bit of LEG_BITS) {
    const q = boneQuat(POSES[from], bit, _a).slerp(boneQuat(POSES[to], bit, _b), k);
    bones.set(bit, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
  return {
    bones,
    h: Math.round(POSES[from].h + (POSES[to].h - POSES[from].h) * k),
    index: k > 0.5 ? to : from,
  };
}
