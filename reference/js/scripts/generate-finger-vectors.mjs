// Generates the finger pose vectors in testvectors/poses/ (hand-skeleton.json + f01…f06).
// Run from reference/js:  node scripts/generate-finger-vectors.mjs
// The vectors pin the §5.5 finger synthesis (curl / splay / opposition → bone rotations).
// Codec-independent: uses only finger-fk.mjs. Re-run and diff to regenerate.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerPose, fkHand } from './finger-fk.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../testvectors/poses');
const R2 = Math.SQRT1_2;

// A test-fixture hand, both hands, in the VRM 1.0 normalized T-pose as the demo builds it:
// palm down, index-to-little along ±X (left = +X), thumb in the palm plane pointing forward
// and outward along (±√½, 0, √½). Round numbers; not a VRM standard. Each finger ends in a
// Tip endpoint (not a bone) so the fingertip is a measurable point, like ToeTip in skeleton.json.
function buildSkeleton() {
  const joints = [{ name: 'wrist', parent: null, offset: [0, 0, 0] }];
  const seg = (name, parent, dx, dz, len) => joints.push({ name, parent, offset: [dx * len, 0, dz * len] });

  for (const side of ['left', 'right']) {
    const s = side === 'left' ? 1 : -1;
    // index … little: start on the knuckle line at x = 0.085·s, spread in z; segments along ±X.
    const fingers = [
      ['Index', 0.03, [0.04, 0.026, 0.02]],
      ['Middle', 0.01, [0.045, 0.03, 0.022]],
      ['Ring', -0.01, [0.04, 0.028, 0.02]],
      ['Little', -0.03, [0.032, 0.022, 0.018]],
    ];
    for (const [finger, z, lens] of fingers) {
      joints.push({ name: `${side}${finger}Proximal`, parent: 'wrist', offset: [0.085 * s, 0, z] });
      seg(`${side}${finger}Intermediate`, `${side}${finger}Proximal`, s, 0, lens[0]);
      seg(`${side}${finger}Distal`, `${side}${finger}Intermediate`, s, 0, lens[1]);
      seg(`${side}${finger}Tip`, `${side}${finger}Distal`, s, 0, lens[2]);
    }
    // thumb: metacarpal on the palm, then proximal, distal, tip along the forward-outward diagonal.
    joints.push({ name: `${side}ThumbMetacarpal`, parent: 'wrist', offset: [0.015 * s, 0, 0.036] });
    seg(`${side}ThumbProximal`, `${side}ThumbMetacarpal`, s * R2, R2, 0.032);
    seg(`${side}ThumbDistal`, `${side}ThumbProximal`, s * R2, R2, 0.03);
    seg(`${side}ThumbTip`, `${side}ThumbDistal`, s * R2, R2, 0.025);
  }
  return {
    description:
      'Finger test-fixture hand for the §5.5 pose vectors. VRM 1.0 normalized space: right-handed, ' +
      'Y up, +Z forward, left = +X. Both hands rest at identity (T-pose): palm down, index–little ' +
      'along ±X, thumb forward-and-outward in the palm plane. Tip joints are end points, not bones. ' +
      'A test fixture with round numbers, not a VRM standard; a check against a real model compares ' +
      'fingertip directions, not positions.',
    joints,
  };
}

const skeleton = buildSkeleton();

// Bytes per hand. curl/splay are [thumb, index, middle, ring, little]; opposition is one u8.
const EMPTY = { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], opposition: 0 };
const bytesOf = (side, b) => (b ? { ...EMPTY, ...b } : EMPTY);

// Each pose isolates one axis/sign so a §5.5 mistake moves a named Tip by centimetres.
const POSES = [
  {
    name: 'f01-four-fingers-curl',
    description: 'index–little fully curled on both hands; thumbs extended. Flexion about Z (−Z left, +Z right): fingertips move toward −Y, into the palm.',
    left: { curl: [0, 255, 255, 255, 255] },
    right: { curl: [0, 255, 255, 255, 255] },
  },
  {
    name: 'f02-thumb-curl',
    description: 'thumbs fully curled, fingers extended. Thumb flexes about Y (+Y left, −Y right): the thumb tip crosses the palm toward the fingers, not down. About Z it would move in Y instead — the pre-1.2 bug this pins against.',
    left: { curl: [255, 0, 0, 0, 0] },
    right: { curl: [255, 0, 0, 0, 0] },
  },
  {
    name: 'f03-index-splay',
    description: 'index proximal splayed to +127 on both hands, no curl. Splay about Y (−Y left, +Y right): the extended index tip moves toward the thumb side, +Z.',
    left: { splay: [0, 127, 0, 0, 0] },
    right: { splay: [0, 127, 0, 0, 0] },
  },
  {
    name: 'f04-thumb-opposition',
    description: 'thumb opposition 255 on both hands, no curl. Opposition rotates the metacarpal about X (positive both hands): the whole thumb swings toward −Y, under the palm.',
    left: { opposition: 255 },
    right: { opposition: 255 },
  },
  {
    name: 'f05-fist',
    description: 'full fist both hands: all four fingers curled, thumb curled with half opposition. Everything at once; product order on the proximal (q_splay · q_curl) and the thumb axis both matter.',
    left: { curl: [255, 255, 255, 255, 255], opposition: 128 },
    right: { curl: [255, 255, 255, 255, 255], opposition: 128 },
  },
  {
    name: 'f06-count-two',
    description: 'left hand: index and middle extended, ring/little curled, thumb across (opposition). Right hand flat. An asymmetric pose: left and right must differ.',
    left: { curl: [255, 0, 0, 255, 255], opposition: 200 },
    right: null,
  },
];

function emit(pose) {
  const full = {};
  const bytes = {};
  for (const side of ['left', 'right']) {
    const b = bytesOf(side, pose[side]);
    bytes[side] = b;
    Object.assign(full, fingerPose(side, b));
  }
  const posAll = fkHand(skeleton.joints, full);
  // Store only the Tip positions (the measurable fingertips) plus the two thumb joints,
  // rounded to 1e-6 m. That is enough to catch any axis/sign/order error.
  const expect = {};
  for (const name of Object.keys(posAll)) {
    if (name.endsWith('Tip') || name.endsWith('ThumbProximal') || name.endsWith('ThumbDistal')) {
      expect[name] = posAll[name].map((v) => Math.round(v * 1e6) / 1e6);
    }
  }
  return { name: pose.name, description: pose.description, bytes, expect };
}

writeFileSync(join(OUT, 'hand-skeleton.json'), JSON.stringify(skeleton, null, 2) + '\n');
for (const pose of POSES) {
  const vec = emit(pose);
  writeFileSync(join(OUT, `${vec.name}.json`), JSON.stringify(vec, null, 2) + '\n');
  console.log(`wrote ${vec.name}.json`);
}
console.log('wrote hand-skeleton.json');
