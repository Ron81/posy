// What the performer does: a small set of whole-body poses, written as joint angles
// in the conventions of spec §3.1 / §3.4, plus the conformance pose vectors
// (testvectors/poses) so those stay one click away.
//
// Hips height is not authored per pose. Like a webcam sender, the demo estimates it
// from the solved legs with the lowest-contact method of spec Appendix D, and only the
// poses where that method is known to fail carry an explicit height.
import * as THREE from 'three';
import type { Quat } from 'posy';
import { BIT } from './bones.ts';

type BoneName = keyof typeof BIT;
type Axis = 'x' | 'y' | 'z';
/** One rotation about an avatar axis, in degrees. */
type Rot = [Axis, number];
type Quat4 = [number, number, number, number];
/** Per bone: rotations composed left to right (leftmost is outermost), or a ready quaternion. */
type Bones = Partial<Record<BoneName, Rot[] | Quat4>>;

interface Shape {
  bones: Bones;
  /** Hips above the floor in metres on the reference skeleton; omit to estimate it. */
  hips?: number;
}

export interface Pose {
  id: string;
  label: string;
  group: string;
  at(tSec: number): Shape;
}

interface Joint {
  name: string;
  parent: string | null;
  offset: [number, number, number];
}
interface Skeleton {
  standing_hip_height: number;
  joints: Joint[];
}
interface PoseVector {
  name: string;
  description: string;
  bones: Array<{ name: BoneName; quat: Quat4 }>;
  hips_height: number;
}

const skeleton = Object.values(
  import.meta.glob<Skeleton>('../../../testvectors/poses/skeleton.json', { eager: true, import: 'default' }),
)[0];
const vectors = import.meta.glob<PoseVector>('../../../testvectors/poses/p*.json', { eager: true, import: 'default' });

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const wave = (tSec: number, hz: number) => Math.sin(tSec * hz * 2 * Math.PI);

/** Later arguments are applied inside earlier ones (appended to the rotation list). */
function merge(...parts: Bones[]): Bones {
  const out: Bones = {};
  for (const part of parts) {
    for (const [bone, rots] of Object.entries(part) as Array<[BoneName, Rot[]]>) {
      out[bone] = [...((out[bone] as Rot[] | undefined) ?? []), ...rots];
    }
  }
  return out;
}

// Arms hang at the sides. T-pose arms point along ±X, so "down" is a Z rotation,
// mirrored between the sides.
const armsDown = (deg = 76): Bones => ({ leftUpperArm: [['z', -deg]], rightUpperArm: [['z', deg]] });

// Hands resting on the lap: upper arms slightly forward, elbows bent forward.
const handsOnLap: Bones = {
  leftUpperArm: [['x', -22], ['z', -78]],
  rightUpperArm: [['x', -22], ['z', 78]],
  leftLowerArm: [['y', -62]],
  rightLowerArm: [['y', 62]],
};

// Breathing and a slow look-around, so a held pose does not look frozen.
const alive = (t: number): Bones => ({
  spine: [['z', 1.5 * wave(t, 0.13)], ['x', 1.2 * wave(t, 0.22)]],
  neck: [['y', 5 * wave(t, 0.1)]],
  head: [['y', 9 * wave(t, 0.1)], ['x', 4 * wave(t, 0.17)]],
});

const seatedLeft: Bones = { leftUpperLeg: [['x', -90]], leftLowerLeg: [['x', 90]] };
const seatedRight: Bones = { rightUpperLeg: [['x', -90]], rightLowerLeg: [['x', 90]] };

// ---------------------------------------------------------------------------
// The poses
// ---------------------------------------------------------------------------

const BODY: Pose[] = [
  { id: 'idle', label: 'Idle', group: 'Standing', at: (t) => ({ bones: merge(armsDown(), alive(t)) }) },
  {
    id: 'wave',
    label: 'Wave',
    group: 'Standing',
    at: (t) => ({
      bones: merge(
        armsDown(),
        // Left arm out to the side, forearm up with the palm turned forward, swinging.
        { leftUpperArm: [['z', 76 + 12]], leftLowerArm: [['z', 78 + 22 * wave(t, 1.6)], ['x', -90]] },
        alive(t),
      ),
    }),
  },
  {
    id: 'hands-on-hips',
    label: 'Hands on hips',
    group: 'Standing',
    at: (t) => ({
      bones: merge(
        { leftUpperArm: [['z', -50]], rightUpperArm: [['z', 50]], leftLowerArm: [['z', -85]], rightLowerArm: [['z', 85]] },
        // Weight on the right leg, left leg a little out.
        { leftUpperLeg: [['z', 10]], spine: [['z', -3]] },
        alive(t),
      ),
    }),
  },
  {
    id: 'cheer',
    label: 'Cheer on tiptoes',
    group: 'Standing',
    at: (t) => {
      const up = 0.5 + 0.5 * wave(t, 1.2); // 0..1: heels down .. full tiptoe
      return {
        bones: merge(
          { leftUpperArm: [['z', 62 + 6 * up]], rightUpperArm: [['z', -62 - 6 * up]] },
          { leftFoot: [['x', 32 * up]], rightFoot: [['x', 32 * up]], leftToes: [['x', -32 * up]], rightToes: [['x', -32 * up]] },
          alive(t),
        ),
      };
    },
  },
  {
    id: 'bow',
    label: 'Bow',
    group: 'Standing',
    at: (t) => {
      const k = 0.5 - 0.5 * Math.cos(t * 1.6); // 0..1, slow down and up
      return {
        bones: merge(armsDown(80), { spine: [['x', 28 * k]], chest: [['x', 22 * k]], neck: [['x', 8 * k]] }),
      };
    },
  },
  {
    id: 'walk',
    label: 'Walk in place',
    group: 'Moving',
    at: (t) => {
      const s = wave(t, 0.9);
      const lift = (v: number) => Math.max(0, v);
      return {
        bones: merge(
          // Thigh swings forward on its half of the cycle; the knee bends while it is up.
          { leftUpperLeg: [['x', -34 * lift(s)]], leftLowerLeg: [['x', 58 * lift(s)]] },
          { rightUpperLeg: [['x', -34 * lift(-s)]], rightLowerLeg: [['x', 58 * lift(-s)]] },
          // Arms swing against the legs: forward/back is an X rotation outside the "down" one.
          { leftUpperArm: [['x', 22 * s], ['z', -76]], rightUpperArm: [['x', -22 * s], ['z', 76]] },
          { leftLowerArm: [['y', -18]], rightLowerArm: [['y', 18]] },
          alive(t),
        ),
      };
    },
  },
  {
    id: 'squat',
    label: 'Squat',
    group: 'Moving',
    at: (t) => {
      const k = 0.5 - 0.5 * Math.cos(t * 2.2); // 0..1
      const a = 72 * k;
      return {
        bones: merge(
          // Thigh forward by a, knee by 2a, ankle back by a: the feet stay flat under the hips.
          { leftUpperLeg: [['x', -a]], leftLowerLeg: [['x', 2 * a]], leftFoot: [['x', -a]] },
          { rightUpperLeg: [['x', -a]], rightLowerLeg: [['x', 2 * a]], rightFoot: [['x', -a]] },
          // Arms come forward for balance as the hips go down.
          { leftUpperArm: [['y', -78 * k], ['z', -76 * (1 - k)]], rightUpperArm: [['y', 78 * k], ['z', 76 * (1 - k)]] },
          { spine: [['x', 16 * k]] },
          alive(t),
        ),
      };
    },
  },
  {
    id: 'jump',
    label: 'Small jump',
    group: 'Moving',
    at: (t) => {
      const u = (t % 1.7) / 1.7;
      const crouch = u < 0.35 ? Math.sin((Math.PI * u) / 0.35) : 0;
      const air = u >= 0.35 && u < 0.75 ? Math.sin((Math.PI * (u - 0.35)) / 0.4) : 0;
      const a = 38 * crouch;
      return {
        bones: merge(
          { leftUpperLeg: [['x', -a]], leftLowerLeg: [['x', 2 * a]], leftFoot: [['x', -a + 30 * air]] },
          { rightUpperLeg: [['x', -a]], rightLowerLeg: [['x', 2 * a]], rightFoot: [['x', -a + 30 * air]] },
          { leftUpperArm: [['z', -76 + 130 * air]], rightUpperArm: [['z', 76 - 130 * air]] },
          alive(t),
        ),
        // In the air nothing touches the floor, so the estimate cannot know the height.
        hips: air > 0 ? skeleton.standing_hip_height + 0.28 * air : undefined,
      };
    },
  },
  {
    id: 'sit-crossed',
    label: 'Chair, legs crossed',
    group: 'Seated',
    at: (t) => ({
      bones: merge(
        seatedLeft,
        { rightUpperLeg: [['y', 25], ['x', -100]], rightLowerLeg: [['x', 80]], rightFoot: [['x', 20 + 6 * wave(t, 0.5)]] },
        handsOnLap,
        alive(t),
      ),
    }),
  },
  {
    id: 'sit-ankle-on-knee',
    label: 'Chair, ankle on knee',
    group: 'Seated',
    at: (t) => ({
      bones: merge(
        seatedRight,
        { leftUpperLeg: [['y', 30], ['x', -95], ['y', 100]], leftLowerLeg: [['x', 115]] },
        handsOnLap,
        { spine: [['x', -6]] },
        alive(t),
      ),
    }),
  },
  {
    id: 'stool',
    label: 'High stool, feet off the floor',
    group: 'Seated',
    at: (t) => ({
      bones: merge(
        { leftUpperLeg: [['x', -80]], leftLowerLeg: [['x', 78 + 14 * wave(t, 0.6)]] },
        { rightUpperLeg: [['x', -80]], rightLowerLeg: [['x', 78 - 14 * wave(t, 0.6)]] },
        armsDown(82),
        alive(t),
      ),
      hips: 0.75, // both feet hang: the estimate would drop the avatar onto its toes
    }),
  },
  {
    id: 'kneel',
    label: 'Kneeling',
    group: 'Seated',
    at: (t) => ({
      bones: merge(
        { leftLowerLeg: [['x', 90]], rightLowerLeg: [['x', 90]], leftFoot: [['x', 80]], rightFoot: [['x', 80]] },
        handsOnLap,
        alive(t),
      ),
    }),
  },
  {
    id: 'floor-crossed',
    label: 'Floor, cross-legged',
    group: 'Seated',
    at: (t) => ({
      bones: merge(
        { leftUpperLeg: [['y', 42], ['x', -86], ['y', 82]], leftLowerLeg: [['x', 132]] },
        { rightUpperLeg: [['y', -42], ['x', -86], ['y', -82]], rightLowerLeg: [['x', 132]] },
        handsOnLap,
        alive(t),
      ),
    }),
  },
];

// The conformance vectors, shown with the arms down. Their height comes with the vector.
const TEST: Pose[] = Object.keys(vectors)
  .sort()
  .map((key) => {
    const v = vectors[key];
    const legs = Object.fromEntries(v.bones.map((b) => [b.name, b.quat])) as Bones;
    return {
      id: v.name.slice(0, 3),
      label: v.name.replace(/^(p\d+)-/, '$1 ').replaceAll('-', ' '),
      group: 'Test vectors (legs only)',
      at: () => ({ bones: { ...armsDown(), ...legs }, hips: v.hips_height }),
    };
  });

export const POSES: Pose[] = [...BODY, ...TEST];

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

const DRIVEN = (Object.keys(BIT) as BoneName[]).filter((name) => name !== 'hips');
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const _r = new THREE.Quaternion();

function toQuat(spec: Rot[] | Quat4 | undefined): THREE.Quaternion {
  const q = new THREE.Quaternion();
  if (!spec) return q; // a bone the pose does not mention is identity (T-pose)
  if (typeof spec[0] === 'number') return q.set(...(spec as Quat4));
  for (const [axis, deg] of spec as Rot[]) q.multiply(_r.setFromAxisAngle(AXIS[axis], (deg * Math.PI) / 180));
  return q;
}

// Appendix D: whatever part of the legs is lowest rests on the floor. Clearance is the
// height of that joint above the floor in the T-pose; for the knee, the shin radius. A
// foot whose sole faces up rests on its instep, so it gets the shin radius as well.
const SHIN_RADIUS = 0.05;
const CLEARANCE: Array<[suffix: string, metres: number]> = [['Foot', 0.08], ['Toes', 0.01], ['LowerLeg', SHIN_RADIUS]];
const _o = new THREE.Vector3();

function estimateHips(quats: Map<BoneName, THREE.Quaternion>): number {
  const world = new Map<string, THREE.Quaternion>();
  const pos = new Map<string, THREE.Vector3>();
  let height = 0;
  for (const j of skeleton.joints) {
    const local = quats.get(j.name as BoneName) ?? new THREE.Quaternion();
    if (j.parent === null) {
      world.set(j.name, local);
      pos.set(j.name, new THREE.Vector3());
      continue;
    }
    const p = pos.get(j.parent)!.clone().add(_o.set(...j.offset).applyQuaternion(world.get(j.parent)!));
    pos.set(j.name, p);
    const w = world.get(j.parent)!.clone().multiply(local);
    world.set(j.name, w);
    for (const [suffix, clear] of CLEARANCE) {
      if (!j.name.endsWith(suffix)) continue;
      const soleUp = suffix === 'Foot' && _o.set(0, 1, 0).applyQuaternion(w).y < 0;
      height = Math.max(height, (soleUp ? SHIN_RADIUS : clear) - p.y);
    }
  }
  return height;
}

export interface BodyPose {
  /** bit → parent-relative quaternion, for every bone the demo drives. */
  bones: Map<number, Quat>;
  /** Root-block hips height (§5.4). */
  h: number;
  /** The pose being performed. */
  id: string;
}

const HOLD_SEC = 5; // per pose in Auto
const BLEND_SEC = 0.7; // glide from the previous pose instead of teleporting

let currentId = '';
let changedAt = 0;
let from: { quats: Map<BoneName, THREE.Quaternion>; hips: number } | null = null;
let last: { quats: Map<BoneName, THREE.Quaternion>; hips: number } | null = null;

/** `selected` is a pose id, or 'auto' to cycle through the whole-body poses. */
export function bodyPoseAt(tSec: number, selected: string): BodyPose {
  const pose =
    selected === 'auto'
      ? BODY[Math.floor(tSec / HOLD_SEC) % BODY.length]
      : (POSES.find((p) => p.id === selected) ?? BODY[0]);
  if (pose.id !== currentId) {
    from = last;
    changedAt = tSec;
    currentId = pose.id;
  }

  const shape = pose.at(tSec);
  const quats = new Map<BoneName, THREE.Quaternion>(DRIVEN.map((name) => [name, toQuat(shape.bones[name])]));
  let hips = shape.hips ?? estimateHips(quats);

  const x = Math.min(1, (tSec - changedAt) / BLEND_SEC);
  if (from && x < 1) {
    const k = x * x * (3 - 2 * x);
    for (const [name, q] of quats) q.copy(from.quats.get(name)!.clone().slerp(q, k));
    hips = from.hips + (hips - from.hips) * k;
  }
  last = { quats, hips };

  const bones = new Map<number, Quat>();
  for (const [name, q] of quats) bones.set(BIT[name], { x: q.x, y: q.y, z: q.z, w: q.w });
  const h = Math.round((hips / skeleton.standing_hip_height) * 32768);
  return { bones, h: Math.min(65535, Math.max(0, h)), id: pose.id };
}
