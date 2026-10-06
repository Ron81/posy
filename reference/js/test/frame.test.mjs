import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, PosyEncodeError, PosyDecodeError } from '../dist/index.js';

const idQuat = { x: 0, y: 0, z: 0, w: 1 };

function upperBodyBones() {
  // typical 13-bone upper body: 0,1,2,4,5,17..24
  const bits = [0, 1, 2, 4, 5, 17, 18, 19, 20, 21, 22, 23, 24];
  const m = new Map();
  for (const b of bits) m.set(b, idQuat);
  return m;
}

function baseFrame(over = {}) {
  return {
    version: 1,
    seq: 7,
    timestampMs: 1000,
    idle: false,
    bones: upperBodyBones(),
    ...over,
  };
}

test('001-minimal is 20 bytes with exact spec bytes', () => {
  const bytes = encode({ version: 1, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) });
  assert.equal(bytes.length, 20);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, '010001000000000001000000000000000002 08e0'.replaceAll(' ', ''));
});

test('118 B golden: 13 bones + root + fingers + Standard-Sync', () => {
  const f = baseFrame({
    root: { x: 0x8000, y: 0x4000, z: -1500, h: 0x6000 },
    fingers: {
      left: { curl: [0, 64, 128, 192, 255], splay: [-127, -64, 0, 64, 127], thumbOpposition: 30 },
      right: { curl: [255, 192, 128, 64, 0], splay: [127, 64, 0, -64, -127], thumbOpposition: 60 },
    },
    expressions: { perfectSync: false, weights: new Uint8Array(16), gazeYaw: 0, gazePitch: 0 },
  });
  const bytes = encode(f);
  // 16 + 4*13 + 8 + 24 + 18 = 118
  assert.equal(bytes.length, 118);
  const back = decode(bytes);
  assert.equal(back.bones.size, 13);
  assert.equal(back.root.z, -1500);
  assert.equal(back.root.h, 0x6000);
  assert.deepEqual([...back.fingers.left.curl], [0, 64, 128, 192, 255]);
  assert.deepEqual([...back.fingers.left.splay], [-127, -64, 0, 64, 127]);
  assert.equal(back.expressions.weights.length, 16);
});

test('154 B golden: 13 bones + root + fingers + Perfect-Sync', () => {
  const f = baseFrame({
    root: { x: 1, y: 2, z: 3, h: 0x8000 },
    fingers: {
      left: { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 },
      right: { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 },
    },
    expressions: { perfectSync: true, weights: new Uint8Array(52), gazeYaw: 10, gazePitch: -10 },
  });
  const bytes = encode(f);
  // 16 + 52 + 8 + 24 + 54 = 154
  assert.equal(bytes.length, 154);
  const back = decode(bytes);
  assert.equal(back.expressions.perfectSync, true);
  assert.equal(back.expressions.weights.length, 52);
  assert.equal(back.expressions.gazeYaw, 10);
  assert.equal(back.expressions.gazePitch, -10);
});

test('reject: length < 16', () => {
  assert.throws(() => decode(new Uint8Array(8)), PosyDecodeError);
});

test('reject: truncated frame (last byte removed)', () => {
  const bytes = encode({ version: 1, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) });
  assert.throws(() => decode(bytes.slice(0, bytes.length - 1)), PosyDecodeError);
});

test('reject: extended frame (trailing byte)', () => {
  const bytes = encode({ version: 1, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) });
  const longer = new Uint8Array(bytes.length + 1);
  longer.set(bytes);
  assert.throws(() => decode(longer), PosyDecodeError);
});

test('reject: high version nibble != 0', () => {
  const bytes = encode({ version: 1, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) });
  bytes[0] = 0x10; // major version 1
  assert.throws(() => decode(bytes), PosyDecodeError);
});

test('extras: round trip, and the counts decide the length', () => {
  const frame = {
    version: 3, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]),
    extra: { bones: [idQuat, idQuat], values: new Uint8Array([1, 2, 3]) },
  };
  const bytes = encode(frame);
  assert.equal(bytes.length, 16 + 4 + 2 * 4 + 3);
  assert.equal(bytes[1] & 0x20, 0x20);
  const back = decode(bytes, { bones: 2, values: 3 });
  assert.equal(back.extra.bones.length, 2);
  assert.deepEqual([...back.extra.values], [1, 2, 3]);
  assert.throws(() => decode(bytes, { bones: 1, values: 3 }), PosyDecodeError);
  assert.throws(() => decode(bytes, { bones: 2, values: 4 }), PosyDecodeError);
  assert.equal(decode(bytes).extra, undefined); // no declaration: block skipped
});

test('extras: encoder refuses an empty block and more than 255 entries', () => {
  const base = { version: 3, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) };
  assert.throws(() => encode({ ...base, extra: { bones: [], values: new Uint8Array(0) } }), PosyEncodeError);
  assert.throws(() => encode({ ...base, extra: { bones: [], values: new Uint8Array(256) } }), PosyEncodeError);
});

test('extras: HAS_EXTRA without a block is rejected', () => {
  const bytes = encode({ version: 3, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) });
  bytes[1] |= 0x20;
  assert.throws(() => decode(bytes), PosyDecodeError);
  assert.throws(() => decode(bytes, { bones: 1, values: 0 }), PosyDecodeError);
});

test('encoder refuses finger bone bits in bone_mask', () => {
  const m = new Map([[0, idQuat], [28, idQuat]]); // 28 is a finger bit
  assert.throws(() => encode({ version: 1, seq: 1, timestampMs: 0, idle: false, bones: m }), PosyEncodeError);
});

test('encoder refuses wrong expression weight length', () => {
  const f = baseFrame({ expressions: { perfectSync: true, weights: new Uint8Array(16), gazeYaw: 0, gazePitch: 0 } });
  assert.throws(() => encode(f), PosyEncodeError);
});

test('reserved bone bit is consumed and preserved, rest parses', () => {
  // Hand-craft a frame with bit 0 and reserved bit 60 set. popcount=2 -> len 16+8=24.
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 1);
  dv.setUint8(1, 0);
  dv.setUint16(2, 5, true);
  dv.setUint32(4, 0, true);
  const mask = (1n << 0n) | (1n << 60n);
  dv.setBigUint64(8, mask, true);
  dv.setUint32(16, 0xe0080200, true); // bit 0 identity
  dv.setUint32(20, 0xe0080200, true); // bit 60 identity
  const f = decode(buf);
  assert.equal(f.bones.size, 2);
  assert.ok(f.bones.has(0));
  assert.ok(f.bones.has(60)); // unknown/reserved bone still stored, offsets stayed aligned
  assert.equal(f.seq, 5);
});

test('reserved flag bits 6-7 are ignored, not rejected', () => {
  const bytes = encode({ version: 1, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) });
  bytes[1] |= 0xc0; // set flags 6,7
  const f = decode(bytes); // must not throw
  assert.equal(f.bones.size, 1);
});
