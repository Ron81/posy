import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, PosyEncodeError, PosyDecodeError, FINGER_BONES_MASK, VERSION } from '../dist/index.js';

// What the frame vectors do not cover. Byte layouts, the reject cases, reserved bone bits,
// extras and finger bones on the wire are in testvectors/frames (vectors.test.mjs).

const idQuat = { x: 0, y: 0, z: 0, w: 1 };
const flatHand = { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 };
const minimal = (over = {}) => ({ version: VERSION, seq: 1, timestampMs: 0, bones: new Map([[0, idQuat]]), ...over });
// The typical 13-bone upper body: 0,1,2,4,5,17..24.
const upperBody = (over = {}) =>
  minimal({ bones: new Map([0, 1, 2, 4, 5, 17, 18, 19, 20, 21, 22, 23, 24].map((b) => [b, idQuat])), ...over });

test('frame sizes of §6: 115 B with VRM-Sync, 154 B with Perfect-Sync', () => {
  const typical = (perfectSync) => upperBody({
    root: { x: 0x8000, y: 0x4000, z: -1500, h: 0x6000 },
    fingers: { left: { curl: [0, 64, 128, 192, 255], splay: [-127, -64, 0, 64, 127], thumbOpposition: 30 }, right: flatHand },
    expressions: { perfectSync, weights: new Uint8Array(perfectSync ? 52 : 13), gazeYaw: 10, gazePitch: -10 },
  });
  assert.equal(encode(typical(false)).length, 16 + 4 * 13 + 8 + 24 + 15); // 115
  const bytes = encode(typical(true));
  assert.equal(bytes.length, 16 + 4 * 13 + 8 + 24 + 54); // 154
  const back = decode(bytes);
  assert.deepEqual(back.root, { x: 0x8000, y: 0x4000, z: -1500, h: 0x6000 });
  assert.deepEqual([...back.fingers.left.splay], [-127, -64, 0, 64, 127]);
  assert.equal(back.expressions.gazePitch, -10);
});

test('encoder refuses what a frame cannot carry', () => {
  // An empty extras block, and more than 255 entries.
  assert.throws(() => encode(minimal({ extra: { bones: [], values: new Uint8Array(0) } })), PosyEncodeError);
  assert.throws(() => encode(minimal({ extra: { bones: [], values: new Uint8Array(256) } })), PosyEncodeError);
  // The finger block together with finger bones (bit 28): the two are mutually exclusive.
  const both = minimal({ bones: new Map([[0, idQuat], [28, idQuat]]), fingers: { left: flatHand, right: flatHand } });
  assert.throws(() => encode(both), PosyEncodeError);
  // A face block of the wrong size; 14 was the VRM-Sync block of 1.4.1.
  for (const [perfectSync, length] of [[true, 16], [false, 14]]) {
    const f = minimal({ expressions: { perfectSync, weights: new Uint8Array(length), gazeYaw: 0, gazePitch: 0 } });
    assert.throws(() => encode(f), PosyEncodeError);
  }
});

test('extras: HAS_EXTRA without a block is rejected', () => {
  const bytes = encode(minimal());
  bytes[1] |= 0x20;
  assert.throws(() => decode(bytes), PosyDecodeError);
  assert.throws(() => decode(bytes, { bones: 1, values: 0 }), PosyDecodeError);
});

test('flag bit 4 is reserved since 1.4.6: never set by the encoder, ignored by the decoder', () => {
  const bytes = encode(minimal({ idle: true }));
  assert.equal(bytes[1] & 0x10, 0, 'an old caller asking for IDLE sets nothing');
  bytes[1] |= 0x10; // a frame of an earlier revision with IDLE set
  const f = decode(bytes);
  assert.equal(f.bones.size, 1);
  assert.equal('idle' in f, false);
});

test('flag bits 6 and 7: a block of a later revision may follow, the known part decodes', () => {
  const known = encode(upperBody({ root: { x: 1, y: 2, z: 3, h: 0x8000 } }));
  for (const bits of [0x40, 0x80, 0xc0]) {
    for (const more of [0, 5]) {
      const bytes = new Uint8Array(known.length + more).fill(0xaa);
      bytes.set(known);
      bytes[1] |= bits;
      const f = decode(bytes);
      assert.equal(f.bones.size, 13);
      assert.equal(f.root.z, 3);
    }
  }
  // The bit does not excuse a frame that is too short for the blocks known here.
  const short = known.slice(0, known.length - 1);
  short[1] |= 0x40;
  assert.throws(() => decode(short), PosyDecodeError);
});

test('a later block follows the extras block', () => {
  const known = encode(upperBody({ extra: { bones: [idQuat], values: new Uint8Array([7, 9]) } }));
  const bytes = new Uint8Array(known.length + 3).fill(0xaa);
  bytes.set(known);
  bytes[1] |= 0x80;
  assert.deepEqual([...decode(bytes, { bones: 1, values: 2 }).extra.values], [7, 9]);
  assert.equal(decode(bytes).extra, undefined); // no declaration: the extras and the later block are skipped
  assert.throws(() => decode(bytes, { bones: 2, values: 2 }), PosyDecodeError); // too short for that declaration
});

// The relay, not the decoder, enforces the grant (§1.2 check 3): `bone_mask & ~granted_mask`
// over all 64 bits. The decoder tolerates unknown bits (vector 006).
test('the grant check of §1.2 over the type masks', () => {
  assert.equal(FINGER_BONES_MASK, 0x007FFFFFFE000000n); // bits 25–54
  const BONES_MASK = 0x0000000001FE01FFn, LEGS_MASK = 0x000000000000EE00n;
  const refused = (mask, granted) => (mask & ~granted) !== 0n;
  const everything = BONES_MASK | LEGS_MASK | FINGER_BONES_MASK;
  assert.ok(refused(1n << 55n, everything), 'bit 55 is the first reserved bit');
  assert.ok(refused((1n << 60n) | 1n, everything), 'bit 60 belongs to no type');
  const fingerFrame = 1n | (1n << 28n) | (1n << 30n); // hips and two finger bones
  assert.ok(refused(fingerFrame, BONES_MASK), 'finger bits without finger_bones granted');
  assert.ok(!refused(fingerFrame, BONES_MASK | FINGER_BONES_MASK));
});
