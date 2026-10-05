import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packQuat, unpackQuat } from '../dist/index.js';
import { estimateHipsHeight, fk } from '../scripts/pose-fk.mjs';
import { fingerPose, fkHand, eulerXYZ } from '../scripts/finger-fk.mjs';

const POSES = join(dirname(fileURLToPath(import.meta.url)), '../../../testvectors/poses');
const skeleton = JSON.parse(readFileSync(join(POSES, 'skeleton.json'), 'utf8'));
const files = readdirSync(POSES).filter((f) => /^p\d+.*\.json$/.test(f)).sort();

const toQuat = ([x, y, z, w]) => ({ x, y, z, w });
const maxError = (got, expect) =>
  Math.max(...Object.keys(expect).map((j) => Math.hypot(...got[j].map((v, i) => v - expect[j][i]))));

for (const file of files) {
  const vec = JSON.parse(readFileSync(join(POSES, file), 'utf8'));

  test(`pose ${vec.name}: quaternions give the expected joint positions`, () => {
    const pose = Object.fromEntries(vec.bones.map((b) => [b.name, toQuat(b.quat)]));
    assert.ok(maxError(fk(skeleton.joints, pose), vec.expect) < 1e-4);
  });

  test(`pose ${vec.name}: still within 1 cm after the wire encoding`, () => {
    const pose = Object.fromEntries(vec.bones.map((b) => [b.name, unpackQuat(packQuat(toQuat(b.quat)))]));
    // Absent bones are identity on the wire side too, so only the listed bones are quantised.
    assert.ok(maxError(fk(skeleton.joints, pose), vec.expect) < 0.01);
  });

  test(`pose ${vec.name}: h matches hips_height`, () => {
    assert.equal(vec.h, Math.round((vec.hips_height / skeleton.standing_hip_height) * 32768));
  });

  // Appendix D on the reference skeleton: ankle 0.08 m and toes 0.01 m above the floor in
  // the T-pose, shin radius 0.05 m. p09 is its documented failure: nothing touches the floor.
  test(`pose ${vec.name}: Appendix D estimate ${vec.name.startsWith('p09') ? 'fails' : 'gives hips_height'}`, () => {
    const pose = Object.fromEntries(vec.bones.map((b) => [b.name, toQuat(b.quat)]));
    const error = Math.abs(estimateHipsHeight(skeleton.joints, pose, { foot: 0.08, toes: 0.01, shin: 0.05 }) - vec.hips_height);
    if (vec.name.startsWith('p09')) assert.ok(error > 0.1);
    else assert.ok(error < 1e-3);
  });
}

test('a flipped knee sign is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'p02-knee-flexion.json'), 'utf8'));
  const [x, y, z, w] = vec.bones[0].quat;
  const wrong = fk(skeleton.joints, { [vec.bones[0].name]: { x: -x, y: -y, z: -z, w } });
  assert.ok(maxError(wrong, vec.expect) > 0.5);
});

// --- Finger pose vectors (§5.5 synthesis: curl / splay / opposition → bone rotations) ---

const handSkeleton = JSON.parse(readFileSync(join(POSES, 'hand-skeleton.json'), 'utf8'));
const fingerFiles = readdirSync(POSES).filter((f) => /^f\d+.*\.json$/.test(f)).sort();

const synth = (bytes) => ({ ...fingerPose('left', bytes.left), ...fingerPose('right', bytes.right) });

for (const file of fingerFiles) {
  const vec = JSON.parse(readFileSync(join(POSES, file), 'utf8'));

  test(`finger ${vec.name}: §5.5 synthesis gives the expected fingertip positions`, () => {
    assert.ok(maxError(fkHand(handSkeleton.joints, synth(vec.bytes)), vec.expect) < 1e-4);
  });
}

// The thumb flexes about Y, not Z (§5.5). Pin it against the pre-1.2 bug: with the thumb
// synthesised about Z instead, f02's thumb tip leaves the y = 0 plane and misses by centimetres.
test('a thumb synthesised about Z (the old bug) is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f02-thumb-curl.json'), 'utf8'));
  const wrong = {};
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    const curl = (vec.bytes[side].curl[0] / 255) * 60; // thumb proximal max
    const distal = (vec.bytes[side].curl[0] / 255) * 80;
    wrong[`${side}ThumbMetacarpal`] = eulerXYZ(0, 0, 0);
    wrong[`${side}ThumbProximal`] = eulerXYZ(0, 0, sign * curl); // about Z — wrong
    wrong[`${side}ThumbDistal`] = eulerXYZ(0, 0, sign * distal);
  }
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.02);
});

// A flipped curl sign on the fingers (curl toward +Y instead of −Y) is caught. A fully curled
// finger folds back near its knuckle, so the tip's +Y/−Y gap is a couple of centimetres, not the
// tens a leg sign error gives — still far above the sub-millimetre quantisation noise.
test('a flipped finger curl sign is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f01-four-fingers-curl.json'), 'utf8'));
  const good = synth(vec.bytes);
  const wrong = Object.fromEntries(
    Object.entries(good).map(([k, q]) => [k, { x: q.x, y: q.y, z: -q.z, w: q.w }]),
  );
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.02);
});

// Left and right must differ: an asymmetric pose applied with a single (unmirrored) sign fails.
test('f06 is asymmetric: the right hand is not the left', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f06-count-two.json'), 'utf8'));
  // Drive the right hand with the left hand's bytes (as a sender that forgot to mirror would):
  const wrong = { ...fingerPose('left', vec.bytes.left), ...fingerPose('right', vec.bytes.left) };
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.1);
});
