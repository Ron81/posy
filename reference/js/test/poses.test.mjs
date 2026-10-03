import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packQuat, unpackQuat } from '../dist/index.js';
import { fk } from '../scripts/pose-fk.mjs';

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
}

test('a flipped knee sign is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'p02-knee-flexion.json'), 'utf8'));
  const [x, y, z, w] = vec.bones[0].quat;
  const wrong = fk(skeleton.joints, { [vec.bones[0].name]: { x: -x, y: -y, z: -z, w } });
  assert.ok(maxError(wrong, vec.expect) > 0.5);
});
