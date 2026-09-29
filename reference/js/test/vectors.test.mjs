import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, encode, packQuat, unpackQuat } from '../dist/index.js';

const TV = join(dirname(fileURLToPath(import.meta.url)), '../../../testvectors');
const framesDir = join(TV, 'frames');

const normHex = (s) => '0x' + s.trim().replace(/^0x/i, '').toUpperCase();
const bytesFromHex = (s) => new Uint8Array(s.trim().split(/\s+/).map((h) => parseInt(h, 16)));

const jsonFiles = readdirSync(framesDir).filter((f) => f.endsWith('.json')).sort();

for (const jf of jsonFiles) {
  const vec = JSON.parse(readFileSync(join(framesDir, jf), 'utf8'));
  test(`vector ${vec.name} (${vec.expect})`, () => {
    const bin = new Uint8Array(readFileSync(join(framesDir, jf.replace('.json', '.bin'))));
    const fromHex = bytesFromHex(vec.bytes_hex);
    assert.deepEqual([...bin], [...fromHex], 'bytes_hex must match the .bin');

    if (vec.expect === 'reject') {
      assert.throws(() => decode(bin), `${vec.name} must be rejected`);
      return;
    }

    const f = decode(bin);
    assert.equal(f.version, vec.frame.version);
    assert.equal(f.seq, vec.frame.seq);
    assert.equal(f.timestampMs, vec.frame.timestamp_ms);

    // bones: the decoded quaternion must match unpacking the expected u32 directly
    // (compare floats with tolerance, per testvectors/README.md — re-packing a decoded
    // quaternion is not byte-stable across ties, so we don't repack here).
    for (const b of vec.frame.bones) {
      assert.ok(f.bones.has(b.bit), `bone bit ${b.bit} present`);
      const expQ = unpackQuat(parseInt(normHex(b.u32), 16));
      const gotQ = f.bones.get(b.bit);
      for (const k of ['x', 'y', 'z', 'w']) {
        assert.ok(Math.abs(expQ[k] - gotQ[k]) < 1e-5, `bit ${b.bit} .${k}: ${gotQ[k]} vs ${expQ[k]}`);
      }
    }

    if (vec.frame.root) {
      assert.deepEqual(f.root, vec.frame.root);
    } else {
      assert.equal(f.root, undefined);
    }

    if (vec.frame.expressions) {
      assert.equal(f.expressions.perfectSync, vec.frame.expressions.perfect_sync);
      assert.deepEqual([...f.expressions.weights], vec.frame.expressions.weights);
      assert.equal(f.expressions.gazeYaw, vec.frame.expressions.gaze_yaw);
      assert.equal(f.expressions.gazePitch, vec.frame.expressions.gaze_pitch);
    }

    // round-trip: re-encoding an accept vector must reproduce the exact bytes.
    // Skipped for 006 (reserved bone bits can't be re-encoded by design) and for
    // 005, whose deliberate ties/boundary quaternions are angle-stable but not
    // byte-stable across a decode→encode cycle (a reconstructed component can tip a
    // tie the other way — inherent to smallest-three, not a codec bug).
    if (vec.name !== '006-reserved-bits' && vec.name !== '005-quat-edgecases') {
      const re = encode({
        version: f.version,
        seq: f.seq,
        timestampMs: f.timestampMs,
        idle: f.idle,
        bones: f.bones,
        root: f.root,
        fingers: f.fingers,
        expressions: f.expressions,
      });
      assert.deepEqual([...re], [...bin], 're-encode must reproduce bytes');
    }
  });
}

test('quaternions.csv: every row packs to its expected u32', () => {
  const csv = readFileSync(join(TV, 'quaternions.csv'), 'utf8').trim().split('\n');
  const header = csv[0].split(',');
  assert.deepEqual(header, ['id', 'x', 'y', 'z', 'w', 'expected_u32', 'largest_index', 'note']);
  for (const line of csv.slice(1)) {
    const [id, x, y, z, w, exp] = line.split(',');
    const u = packQuat({ x: +x, y: +y, z: +z, w: +w }) >>> 0;
    assert.equal('0x' + u.toString(16).padStart(8, '0').toUpperCase(), normHex(exp), `row ${id}`);
  }
});
