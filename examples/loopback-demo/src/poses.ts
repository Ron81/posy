// What the performer does: a small set of whole-body poses, written as joint angles
// in the conventions of spec §3.1 / §3.4, plus the conformance pose vectors
// (testvectors/poses) so those stay one click away. The poses are grouped by the part of
// the body they are there to show; a group, or all of them, can be played as a cycle.
//
// A pose also says what the hands and the face do in it. A part that a person would
// keep still in that situation stays still: the hands hang relaxed, the mouth is shut.
//
// Hips height is not authored per pose. Like a webcam sender, the demo estimates it
// from the solved legs with the lowest-contact method of spec Appendix D, and only the
// poses where that method is known to fail carry an explicit height.
import * as THREE from 'three';
import { BONE_NAMES, type Quat } from 'posy';
import { BIT, SLOT } from './bones.ts';
import type { Fingers } from './hands.ts';

type BoneName = keyof typeof BIT;
type Axis = 'x' | 'y' | 'z';
/** One rotation about an avatar axis, in degrees. */
type Rot = [Axis, number];
type Quat4 = [number, number, number, number];
/** Per bone: rotations composed left to right (leftmost is outermost), or a ready quaternion. */
type Bones = Partial<Record<BoneName, Rot[] | Quat4>>;

type Hand = Fingers['left'];

interface Shape {
  bones: Bones;
  /** Hips above the floor in metres on the reference skeleton; omit to estimate it. */
  hips?: number;
  /** The hands as finger block bytes (§5.5); omit for relaxed hands. */
  fingers?: Fingers;
  /**
   * Finger bones by `bone_mask` bit, for a hand shape the block cannot make. `fingers` is
   * then the nearest the block gets, for a sender that has only the block.
   */
  joints?: Map<number, Quat>;
  /** Omit for a still face that only blinks. */
  face?: Face;
  /** Shown next to the pose selector: what is on right now. */
  note?: string;
}

/** What the face does, in the terms of the expression block (§5.6). */
export interface Face {
  /** Eyelids left and right, 0 open … 1 shut. Omit for ordinary blinking. */
  blink?: [number, number];
  /** Mouth shapes and moods by VRM-Sync slot name, 0 … 1. */
  shape?: Partial<Record<Exclude<keyof typeof SLOT, 'blinkLeft' | 'blinkRight'>, number>>;
  /** Gaze in degrees, left and up positive. Omit to let the eyes follow the head. */
  gaze?: [number, number];
}

export interface Pose {
  id: string;
  label: string;
  group: string;
  /** Where the cameras should look while this pose is on; omit for the usual framing. */
  look?: 'hands' | 'feet' | 'head';
  /** Seconds the pose gets in a cycle; omit for HOLD_SEC. */
  hold?: number;
  /** `since` is the time in seconds since the pose was selected. */
  at(tSec: number, since: number): Shape;
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
const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 → 1 → 0 over x in 0 … 1, flat in the middle. */
const bump = (x: number) => smooth(x * 4) * smooth((1 - x) * 4);

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

// Hands. Curl runs thumb to little finger, 0 straight … 255 closed. Finger splay is
// positive toward the thumb side, ±127 = ±30°; thumb splay is positive outward, ±127 = ±90°
// (§5.5). FIST and the thumb of OPEN are the spec's shape bytes ("Fist", "Counting, thumb out").
const hand = (curl: number[], splay = [0, 0, 0, 0, 0], thumbOpposition = 40): Hand => ({
  curl: curl as Hand['curl'],
  splay: splay as Hand['splay'],
  thumbOpposition,
});
const both = (h: Hand): Fingers => ({ left: h, right: h });
const mixHand = (a: Hand, b: Hand, k: number): Hand =>
  hand(
    a.curl.map((v, i) => Math.round(v + (b.curl[i] - v) * k)),
    a.splay.map((v, i) => Math.round(v + (b.splay[i] - v) * k)),
    Math.round(a.thumbOpposition + (b.thumbOpposition - a.thumbOpposition) * k),
  );

/** Hanging at the side: fingers a little bent, more so toward the little finger. */
const RELAXED = hand([40, 50, 60, 70, 80]);
/** Fingers straight and spread, thumb out. */
const OPEN = hand([4, 0, 0, 0, 0], [36, 35, 5, -25, -50], 0);
/** Lying on a thigh or held out flat. */
const FLAT = hand([20, 12, 12, 15, 20], [15, 8, 0, -8, -15], 20);
/** Resting on the hip: fingers wrapped forward, thumb behind. */
const ON_HIP = hand([30, 95, 100, 105, 110], [30, 5, 0, -5, -10], 0);
const FIST = hand([164, 255, 255, 255, 255], [-27, 0, 0, 0, 0], 100);

export const RELAXED_HANDS = both(RELAXED);

const seatedLeft: Bones = { leftUpperLeg: [['x', -90]], leftLowerLeg: [['x', 90]] };
const seatedRight: Bones = { rightUpperLeg: [['x', -90]], rightLowerLeg: [['x', 90]] };

// ---------------------------------------------------------------------------
// The poses
// ---------------------------------------------------------------------------

const BODY: Pose[] = [
  { id: 'idle', label: 'Idle', group: 'Standing and arms', at: (t) => ({ bones: merge(armsDown(), alive(t)) }) },
  {
    id: 'wave',
    label: 'Wave',
    group: 'Standing and arms',
    at: (t) => ({
      bones: merge(
        armsDown(),
        // Left arm out to the side, forearm up with the palm turned forward, swinging.
        { leftUpperArm: [['z', 76 + 12]], leftLowerArm: [['z', 78 + 22 * wave(t, 1.6)], ['x', -90]] },
        alive(t),
      ),
      fingers: { left: OPEN, right: RELAXED },
      face: { shape: { happy: 0.8 } },
    }),
  },
  {
    id: 'hands-on-hips',
    label: 'Hands on hips',
    group: 'Standing and arms',
    at: (t) => ({
      bones: merge(
        { leftUpperArm: [['z', -50]], rightUpperArm: [['z', 50]], leftLowerArm: [['z', -85]], rightLowerArm: [['z', 85]] },
        // Weight on the right leg, left leg a little out.
        { leftUpperLeg: [['z', 10]], spine: [['z', -3]] },
        alive(t),
      ),
      fingers: both(ON_HIP),
    }),
  },
  {
    id: 'cheer',
    label: 'Cheer on tiptoes',
    group: 'Standing and arms',
    at: (t) => {
      const up = 0.5 + 0.5 * wave(t, 1.2); // 0..1: heels down .. full tiptoe
      return {
        bones: merge(
          { leftUpperArm: [['z', 62 + 6 * up]], rightUpperArm: [['z', -62 - 6 * up]] },
          { leftFoot: [['x', 32 * up]], rightFoot: [['x', 32 * up]], leftToes: [['x', -32 * up]], rightToes: [['x', -32 * up]] },
          alive(t),
        ),
        fingers: both(OPEN),
        // Shouting on the way up.
        face: { shape: { happy: 1, aa: 0.2 + 0.6 * up } },
      };
    },
  },
  {
    id: 'bow',
    label: 'Bow',
    group: 'Standing and arms',
    at: (t) => {
      const k = 0.5 - 0.5 * Math.cos(t * 1.6); // 0..1, slow down and up
      return {
        bones: merge(armsDown(80), { spine: [['x', 28 * k]], chest: [['x', 22 * k]], neck: [['x', 8 * k]] }),
        // Eyes go down with the bow and close at the bottom of it.
        face: { gaze: [0, -25 * k], blink: [smooth((k - 0.55) / 0.3), smooth((k - 0.55) / 0.3)] },
      };
    },
  },
  {
    id: 'walk',
    label: 'Walk in place',
    group: 'Legs',
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
    group: 'Legs',
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
        // Hands open out as the arms come forward; breath goes out on the way down.
        fingers: both(mixHand(RELAXED, FLAT, k)),
        face: { shape: { ou: 0.35 * k } },
      };
    },
  },
  {
    id: 'jump',
    label: 'Small jump',
    group: 'Legs',
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
        fingers: both(mixHand(RELAXED, OPEN, air)),
        face: { shape: { happy: 0.5 + 0.5 * air, aa: 0.6 * air } },
        // In the air nothing touches the floor, so the estimate cannot know the height.
        hips: air > 0 ? skeleton.standing_hip_height + 0.28 * air : undefined,
      };
    },
  },
  {
    id: 'sit-crossed',
    label: 'Chair, legs crossed',
    group: 'Legs',
    at: (t) => ({
      bones: merge(
        seatedLeft,
        { rightUpperLeg: [['y', 25], ['x', -100]], rightLowerLeg: [['x', 80]], rightFoot: [['x', 20 + 6 * wave(t, 0.5)]] },
        handsOnLap,
        alive(t),
      ),
      fingers: both(FLAT),
    }),
  },
  {
    id: 'sit-ankle-on-knee',
    label: 'Chair, ankle on knee',
    group: 'Legs',
    at: (t) => ({
      bones: merge(
        seatedRight,
        { leftUpperLeg: [['y', 30], ['x', -95], ['y', 100]], leftLowerLeg: [['x', 115]] },
        handsOnLap,
        { spine: [['x', -6]] },
        alive(t),
      ),
      fingers: both(FLAT),
    }),
  },
  {
    id: 'stool',
    label: 'High stool, feet off the floor',
    group: 'Legs',
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
    group: 'Legs',
    at: (t) => ({
      bones: merge(
        { leftLowerLeg: [['x', 90]], rightLowerLeg: [['x', 90]], leftFoot: [['x', 80]], rightFoot: [['x', 80]] },
        handsOnLap,
        alive(t),
      ),
      fingers: both(FLAT),
    }),
  },
  {
    id: 'floor-crossed',
    label: 'Floor, cross-legged',
    group: 'Legs',
    at: (t) => ({
      bones: merge(
        { leftUpperLeg: [['y', 42], ['x', -86], ['y', 82]], leftLowerLeg: [['x', 132]] },
        { rightUpperLeg: [['y', -42], ['x', -86], ['y', -82]], rightLowerLeg: [['x', 132]] },
        handsOnLap,
        alive(t),
      ),
      fingers: both(FLAT),
    }),
  },
];

// Poses for the small parts. Each runs through a sequence, so its `hold` is the length of
// that sequence.

const COUNT_HALF = 7.5; // seconds per hand
const COUNT_SWAP = 1.2; // one arm comes down while the other goes up
const COUNT_START = 1.8; // fist held until here, then one finger every COUNT_STEP
const COUNT_STEP = 0.7;

/** `raised` 0..1: hanging at the side .. forearm up, palm to the camera. `v`: seconds into this hand's turn. */
function countingHand(raised: number, v: number): Hand {
  // Thumb first, then index to little; each finger opens over half a step.
  const open = [0, 1, 2, 3, 4].map((i) => smooth((v - COUNT_START - COUNT_STEP * i) / (COUNT_STEP / 2)));
  // Each finger goes from its place in the fist to straight; the thumb lies across the
  // fist until it is counted, then stands out.
  const counting = hand(
    open.map((o, i) => mix(FIST.curl[i], OPEN.curl[i], o)),
    [mix(FIST.splay[0], OPEN.splay[0], open[0]), 0, 0, 0, 0],
    FIST.thumbOpposition * (1 - open[0]),
  );
  return mixHand(RELAXED, counting, raised);
}

// One part of the face at a time, each for FACE_STEP seconds. `k` rises to 1 and falls.
const FACE_STEP = 1.3;
const FACE: Array<[note: string, face: (k: number) => Face]> = [
  ['blink', (k) => ({ blink: [k, k] })],
  ['left lid', (k) => ({ blink: [k, 0] })],
  ['right lid', (k) => ({ blink: [0, k] })],
  ['aa', (k) => ({ shape: { aa: k } })],
  ['ih', (k) => ({ shape: { ih: k } })],
  ['ou', (k) => ({ shape: { ou: k } })],
  ['ee', (k) => ({ shape: { ee: k } })],
  ['oh', (k) => ({ shape: { oh: k } })],
  ['happy', (k) => ({ shape: { happy: k } })],
  ['surprised', (k) => ({ shape: { surprised: k } })],
  ['gaze left', (k) => ({ gaze: [35 * k, 0] })],
  ['gaze right', (k) => ({ gaze: [-35 * k, 0] })],
  ['gaze up', (k) => ({ gaze: [0, 30 * k] })],
  ['gaze down', (k) => ({ gaze: [0, -30 * k] })],
];

// A claw: the base joint of each finger stays straight while the two outer joints bend.
// One curl byte bends all three joints together, so the finger block cannot make this
// shape; it takes one rotation per joint (`finger_bones`, pose vector g01). The thumb bits
// stay clear: a receiver shows the rest hand there (§5.5).
const CLAW_BEND = 70; // degrees on each outer joint
function claw(k: number): Map<number, Quat> {
  const joints = new Map<number, Quat>();
  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    const half = (sign * CLAW_BEND * k * Math.PI) / 360; // into the palm: −Z left, +Z right
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      const bit = (joint: string) => (BONE_NAMES as readonly string[]).indexOf(`${side}${finger}${joint}`);
      joints.set(bit('Proximal'), { x: 0, y: 0, z: 0, w: 1 });
      joints.set(bit('Intermediate'), { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) });
      joints.set(bit('Distal'), { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) });
    }
  }
  return joints;
}

const DETAIL: Pose[] = [
  {
    id: 'count',
    label: 'Count to ten on the fingers',
    group: 'Hands',
    look: 'hands',
    hold: 2 * COUNT_HALF,
    at: (t, since) => {
      const u = since % (2 * COUNT_HALF);
      const leftTurn = u < COUNT_HALF;
      const k = smooth((leftTurn ? u : u - COUNT_HALF) / COUNT_SWAP);
      const left = leftTurn ? k : 1 - k;
      // The right arm starts at the side; after that the two arms swap at every half.
      const right = since < COUNT_HALF ? 0 : 1 - left;
      const turn = left - right; // +1: left shoulder forward, −1: right shoulder forward
      // The count is spoken: the mouth opens briefly as each finger comes up.
      const v = leftTurn ? u : u - COUNT_HALF;
      const n = Math.min(5, Math.max(0, Math.floor((v - COUNT_START) / COUNT_STEP) + 1));
      const said = n > 0 ? bump(Math.min(1, (v - COUNT_START - COUNT_STEP * (n - 1)) / (COUNT_STEP * 0.8))) : 0;
      return {
        note: n > 0 ? String(leftTurn ? n : n + 5) : '',
        face: { shape: { aa: 0.7 * said }, gaze: [14 * turn, 4] },
        bones: merge(
          // Upper arm a little forward and out, forearm up. The forearm twist is what is left
          // of a quarter turn once the torso and upper arm have turned: the palm faces +Z.
          { leftUpperArm: [['y', -14 * left], ['z', mix(-76, -58, left)]], leftLowerArm: [['z', 142 * left], ['x', -50 * left]] },
          { rightUpperArm: [['y', 14 * right], ['z', mix(76, 58, right)]], rightLowerArm: [['z', -142 * right], ['x', -50 * right]] },
          // The counting side comes forward; the head stays on the viewer.
          { leftShoulder: [['y', -8 * left]], rightShoulder: [['y', 8 * right]] },
          { spine: [['y', -6 * turn]], chest: [['y', -9 * turn]], head: [['y', 11 * turn]] },
          alive(t),
        ),
        fingers: {
          left: countingHand(left, leftTurn ? u : 2 * COUNT_HALF),
          right: countingHand(right, leftTurn ? 2 * COUNT_HALF : u - COUNT_HALF),
        },
      };
    },
  },
  {
    id: 'claw',
    label: 'Claw: only per-joint fingers can show it',
    group: 'Hands',
    look: 'hands',
    hold: 8,
    at: (t, since) => {
      const k = 0.5 - 0.5 * Math.cos(since * 1.6); // 0..1: open hand .. claw
      const curl = Math.round(150 * k);
      return {
        bones: merge(
          // Both forearms up, palms to the camera, as in the count.
          { leftUpperArm: [['y', -14], ['z', -58]], leftLowerArm: [['z', 142], ['x', -50]] },
          { rightUpperArm: [['y', 14], ['z', 58]], rightLowerArm: [['z', -142], ['x', -50]] },
          alive(t),
        ),
        joints: claw(k),
        fingers: both(hand([40, curl, curl, curl, curl])),
        note: 'through the block every joint bends; per joint the base stays straight',
      };
    },
  },
  {
    id: 'toes',
    label: 'Toes up: left, right, then both on tiptoe',
    group: 'Feet',
    look: 'feet',
    hold: 6,
    at: (t, since) => {
      const u = since % 6;
      const lift = (from: number) => Math.max(0, Math.sin(Math.PI * (u - from))) * (u >= from && u < from + 2 ? 1 : 0);
      const tip = lift(4); // heels up, weight on the toes
      return {
        bones: merge(
          armsDown(),
          { leftToes: [['x', -38 * lift(0) - 34 * tip]], rightToes: [['x', -38 * lift(2) - 34 * tip]] },
          { leftFoot: [['x', 34 * tip]], rightFoot: [['x', 34 * tip]] },
          // Looking down at the feet.
          { neck: [['x', 12]], head: [['x', 22]] },
        ),
        face: { gaze: [0, -18] },
        note: u < 2 ? 'left toes' : u < 4 ? 'right toes' : 'tiptoe',
      };
    },
  },
  {
    id: 'face',
    label: 'Face: lids, mouth, gaze',
    group: 'Face',
    look: 'head',
    hold: FACE_STEP * FACE.length,
    at: (_t, since) => {
      const u = since % (FACE_STEP * FACE.length);
      const i = Math.floor(u / FACE_STEP);
      const [note, face] = FACE[i];
      return {
        bones: armsDown(), // head and body still, so that only the face moves
        face: { blink: [0, 0], gaze: [0, 0], ...face(bump((u % FACE_STEP) / FACE_STEP)) },
        note,
      };
    },
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
      group: 'Leg test vectors',
      hold: 3, // nothing moves in a vector
      at: (): Shape => ({ bones: { ...armsDown(), ...legs }, hips: v.hips_height }),
    };
  });

export const POSES: Pose[] = [...BODY, ...DETAIL, ...TEST];
/** The groups in the order they are offered. */
export const GROUPS: string[] = [...new Set(POSES.map((p) => p.group))];

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
  /** The hands as finger block bytes. */
  fingers: Fingers;
  /** Finger bones by bit, when the pose gives the hands joint by joint. */
  joints?: Map<number, Quat>;
  face?: Face;
  note?: string;
  /** The pose being performed. */
  id: string;
  look?: Pose['look'];
}

const HOLD_SEC = 5; // per pose in a cycle, unless the pose says otherwise
const BLEND_SEC = 0.7; // glide from the previous pose instead of teleporting

let currentId = '';
let changedAt = 0;
let cycled = '';
let cycleFrom = 0;

/** The pose that is on at `tSec` when `list` is played in order, starting at `cycleFrom`. */
function cycle(list: Pose[], tSec: number): Pose {
  let u = (tSec - cycleFrom) % list.reduce((sum, p) => sum + (p.hold ?? HOLD_SEC), 0);
  for (const p of list) {
    if (u < (p.hold ?? HOLD_SEC)) return p;
    u -= p.hold ?? HOLD_SEC;
  }
  return list[0];
}
let from: { quats: Map<BoneName, THREE.Quaternion>; hips: number } | null = null;
let last: { quats: Map<BoneName, THREE.Quaternion>; hips: number } | null = null;

/**
 * `selected` is a pose id to hold that pose, `group:<name>` to cycle through that group,
 * or 'all' to cycle through every pose. A cycle starts at its first pose.
 */
export function bodyPoseAt(tSec: number, selected: string): BodyPose {
  if (selected !== cycled) {
    cycled = selected;
    cycleFrom = tSec;
  }
  const group = selected.startsWith('group:') ? POSES.filter((p) => p.group === selected.slice(6)) : [];
  const pose =
    selected === 'all'
      ? cycle(POSES, tSec)
      : group.length > 0
        ? cycle(group, tSec)
        : (POSES.find((p) => p.id === selected) ?? BODY[0]);
  if (pose.id !== currentId) {
    from = last;
    changedAt = tSec;
    currentId = pose.id;
  }

  const shape = pose.at(tSec, tSec - changedAt);
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
  return { bones, h: Math.min(65535, Math.max(0, h)), fingers: shape.fingers ?? RELAXED_HANDS, joints: shape.joints, face: shape.face, note: shape.note, id: pose.id, look: pose.look };
}
