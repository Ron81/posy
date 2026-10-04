import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { BLENDSHAPE_NAMES, BONE_NAMES, encode, packQuat, unpackQuat } from '../dist/index.js';

// docs/assets/data.js and codec.js are hand-written copies of the tables and the quaternion
// packing (the site is buildless and cannot import the codec). These tests fail when a copy
// drifts from the reference implementation.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Both files are classic scripts that attach to `window`.
const window = {};
const context = vm.createContext({ window, console });
for (const f of ['docs/assets/data.js', 'docs/assets/codec.js']) {
  vm.runInContext(read(f), context, { filename: f });
}
const { PosyData, PosyCodec } = window;

test('docs: bone table equals BONE_NAMES', () => {
  assert.deepEqual(Array.from(PosyData.BONES, (b) => b.name), [...BONE_NAMES]);
  assert.deepEqual(Array.from(PosyData.BONES, (b) => b.bit), BONE_NAMES.map((_, i) => i));
});

test('docs: blendshape order equals BLENDSHAPE_NAMES', () => {
  assert.deepEqual([...PosyData.BLENDSHAPES], [...BLENDSHAPE_NAMES]);
});

test('docs: typical mask equals spec/bone-index-table.md', () => {
  const table = read('spec/bone-index-table.md');
  const bits = [...PosyData.TYPICAL_BITS];
  assert.ok(table.includes(`bits ${bits.join(', ')} → ${bits.length} bones → \`${PosyCodec.maskHex(bits)}\``));
});

test('docs: smallest-three packing equals packQuat / unpackQuat', () => {
  const quats = read('testvectors/quaternions.csv').trim().split('\n').slice(1).map((line) => {
    const [, x, y, z, w] = line.split(',').map(Number);
    return { x, y, z, w };
  });
  // Grid over {-1, -0.5, 0, 0.5, 1}^4: dense in exact ties and sign flips.
  const steps = [-1, -0.5, 0, 0.5, 1];
  for (const x of steps) for (const y of steps) for (const z of steps) for (const w of steps) {
    if (x || y || z || w) quats.push({ x, y, z, w });
  }
  for (const q of quats) {
    const label = JSON.stringify(q);
    const u32 = packQuat(q);
    assert.equal(PosyCodec.encodeSmallestThree(q).u32, u32, label);
    const a = PosyCodec.decodeSmallestThree(u32);
    const b = unpackQuat(u32);
    for (const k of ['x', 'y', 'z', 'w']) assert.ok(Math.abs(a[k] - b[k]) < 1e-12, `${label} ${k}`);
  }
});

test('docs: packetSize equals encoded frame length', () => {
  const hand = { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 };
  const sets = [PosyData.PRESETS[0].bits, PosyData.TYPICAL_BITS, PosyData.PRESETS[2].bits];
  for (const bits of sets) for (const hasRoot of [false, true]) for (const hasFingers of [false, true]) {
    for (const expr of [null, false, true]) {
      const frame = {
        version: 1, seq: 0, timestampMs: 0, idle: false,
        bones: new Map([...bits].map((b) => [b, { x: 0, y: 0, z: 0, w: 1 }])),
      };
      if (hasRoot) frame.root = { x: 0, y: 0, z: 0, h: 32768 };
      if (hasFingers) frame.fingers = { left: hand, right: hand };
      if (expr !== null) {
        frame.expressions = { perfectSync: expr, weights: new Uint8Array(expr ? 52 : 16), gazeYaw: 0, gazePitch: 0 };
      }
      const opts = { boneCount: bits.length, hasRoot, hasFingers, hasExpressions: expr !== null, perfectSync: expr === true };
      assert.equal(PosyCodec.packetSize(opts), encode(frame).length, JSON.stringify(opts));
    }
  }
});
