// Generates the shared test vectors from the reference implementation, into ../../testvectors/.
// Format is documented in testvectors/README.md. Run: node scripts/generate-testvectors.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, packQuat, BONE_NAMES } from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TV = resolve(HERE, '../../../testvectors');
mkdirSync(join(TV, 'frames'), { recursive: true });

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const u64hex = (bits) => {
  let m = 0n;
  for (const b of bits) m |= 1n << BigInt(b);
  return '0x' + m.toString(16).padStart(16, '0');
};
const idQuat = { x: 0, y: 0, z: 0, w: 1 };

function boneList(map) {
  return [...map.keys()].sort((a, b) => a - b).map((bit) => ({
    bit,
    name: BONE_NAMES[bit],
    u32: '0x' + (packQuat(map.get(bit)) >>> 0).toString(16).padStart(8, '0').toUpperCase(),
  }));
}

function writeAccept(name, description, frame, extra = {}) {
  const bytes = encode(frame);
  const json = {
    name,
    description,
    expect: 'accept',
    bytes_hex: hex(bytes),
    frame: {
      version: frame.version,
      flags: extra.flags,
      seq: frame.seq,
      timestamp_ms: frame.timestampMs,
      bone_mask: u64hex([...frame.bones.keys()]),
      bones: boneList(frame.bones),
      root: frame.root ?? null,
      fingers: frame.fingers
        ? {
            left: handBytes(frame.fingers.left),
            right: handBytes(frame.fingers.right),
          }
        : null,
      expressions: frame.expressions
        ? {
            perfect_sync: frame.expressions.perfectSync,
            weights: [...frame.expressions.weights],
            gaze_yaw: frame.expressions.gazeYaw,
            gaze_pitch: frame.expressions.gazePitch,
          }
        : null,
    },
  };
  writeFileSync(join(TV, 'frames', `${name}.bin`), bytes);
  writeFileSync(join(TV, 'frames', `${name}.json`), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote  frames/${name}.{bin,json}  (${bytes.length} B)`);
  return bytes;
}

function handBytes(h) {
  // 12 bytes as integers, splay signed
  const out = [];
  for (let f = 0; f < 5; f++) {
    out.push(h.curl[f], h.splay[f]);
  }
  out.push(h.thumbOpposition, 0);
  return out;
}

function writeReject(name, description, bytes, reason) {
  const json = { name, description, expect: 'reject', bytes_hex: hex(bytes), reason };
  writeFileSync(join(TV, 'frames', `${name}.bin`), bytes);
  writeFileSync(join(TV, 'frames', `${name}.json`), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote  frames/${name}.{bin,json}  (reject)`);
}

/* 001-minimal: seq=1, ts=0, flags=0, mask=bit0, hips=identity -> 20 B */
const v001 = writeAccept(
  '001-minimal',
  'one bone (hips, identity), nothing else',
  { version: 1, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) },
  { flags: 0 },
);

/* 002-fullbody-standard: 21 bones, root+fingers+Standard-Sync -> 148 B */
{
  const bits = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const bones = new Map(bits.map((b) => [b, idQuat]));
  writeAccept(
    '002-fullbody-standard',
    '21 bones (spine/head + legs + arms), root + fingers + Standard-Sync face',
    {
      version: 1,
      seq: 2,
      timestampMs: 33,
      idle: false,
      bones,
      root: { x: 0x8000, y: 0x4000, z: -1500 },
      fingers: {
        left: { curl: [0, 64, 128, 192, 255], splay: [-127, -64, 0, 64, 127], thumbOpposition: 30 },
        right: { curl: [0, 64, 128, 192, 255], splay: [-127, -64, 0, 64, 127], thumbOpposition: 30 },
      },
      expressions: { perfectSync: false, weights: new Uint8Array(16), gazeYaw: 12, gazePitch: -8 },
    },
    { flags: 0x0e },
  );
}

/* 003-perfectsync: 13 bones, flags 0x0F, weights i*5 mod 256 -> 152 B */
{
  const bits = [0, 1, 2, 4, 5, 17, 18, 19, 20, 21, 22, 23, 24];
  const bones = new Map(bits.map((b) => [b, idQuat]));
  const weights = new Uint8Array(52);
  for (let i = 0; i < 52; i++) weights[i] = (i * 5) % 256;
  writeAccept(
    '003-perfectsync',
    '13 bones + root + fingers + Perfect-Sync (52 ARKit weights = i*5 mod 256)',
    {
      version: 1,
      seq: 3,
      timestampMs: 66,
      idle: false,
      bones,
      root: { x: 100, y: 200, z: 0 },
      fingers: {
        left: { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 },
        right: { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 },
      },
      expressions: { perfectSync: true, weights, gazeYaw: 0, gazePitch: 0 },
    },
    { flags: 0x0f },
  );
}

/* 004 family: malformed -> reject */
writeReject('004-malformed-length', '001-minimal with its last byte removed', v001.slice(0, v001.length - 1), 'length does not match flags/mask');
{
  const extended = new Uint8Array(v001.length + 1);
  extended.set(v001);
  writeReject('004b-trailing-byte', '001-minimal with an extra trailing byte', extended, 'length longer than required');
}
{
  const noBlock = v001.slice();
  noBlock[1] = 0x04; // HAS_FINGERS set but no finger block present
  writeReject('004c-fingers-flag-no-block', 'HAS_FINGERS set but no 24-byte block', noBlock, 'length does not include the finger block');
}
writeReject('004d-length-too-short', 'a 15-byte buffer (< 16)', new Uint8Array(15), 'length < 16');
{
  const badVer = v001.slice();
  badVer[0] = 0x10; // high nibble != 0
  writeReject('004e-bad-version', 'version byte with a non-zero high nibble', badVer, 'unsupported major version');
}

/* 005-quat-edgecases: several bones with tricky quaternions */
{
  const s = 0.70710678;
  const cases = [
    [0, { x: 0, y: 0, z: 0, w: 1 }], // identity
    [1, { x: 0, y: 0, z: 0, w: -1 }], // negated identity (same rotation)
    [2, { x: 0, y: s, z: 0, w: s }], // tie y/w -> drop y
    [3, { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }], // four-way tie -> drop x
    [4, { x: s, y: 0, z: 0, w: s }], // 90 about X
    [5, { x: 1, y: 0, z: 0, w: 0 }], // 180 about X
    [17, { x: 0, y: 0, z: Math.sin(Math.PI / 24), w: Math.cos(Math.PI / 24) }], // tiny angle
  ];
  const bones = new Map(cases);
  writeAccept('005-quat-edgecases', 'identity, its negation, ties, near 1/sqrt2, 180 deg, tiny angle', {
    version: 1,
    seq: 5,
    timestampMs: 0,
    idle: false,
    bones,
  }, { flags: 0 });
}

/* 006-reserved-bits: a reserved bone bit set, decoder must skip yet parse the rest.
   Hand-built because the encoder refuses to set reserved/finger bits. */
{
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 1);
  dv.setUint8(1, 0);
  dv.setUint16(2, 6, true);
  dv.setUint32(4, 0, true);
  const mask = (1n << 0n) | (1n << 60n);
  dv.setBigUint64(8, mask, true);
  dv.setUint32(16, 0xe0080200, true);
  dv.setUint32(20, 0xe0080200, true);
  const json = {
    name: '006-reserved-bits',
    description: 'bit 0 (hips) plus reserved bit 60 set; decoder consumes both quaternions',
    expect: 'accept',
    bytes_hex: hex(buf),
    frame: {
      version: 1,
      flags: 0,
      seq: 6,
      timestamp_ms: 0,
      bone_mask: '0x' + mask.toString(16).padStart(16, '0'),
      bones: [
        { bit: 0, name: 'hips', u32: '0xE0080200' },
        { bit: 60, name: 'reserved', u32: '0xE0080200' },
      ],
      root: null,
      fingers: null,
      expressions: null,
    },
  };
  writeFileSync(join(TV, 'frames', '006-reserved-bits.bin'), buf);
  writeFileSync(join(TV, 'frames', '006-reserved-bits.json'), JSON.stringify(json, null, 2) + '\n');
  console.log('wrote  frames/006-reserved-bits.{bin,json}  (24 B)');
}

/* quaternions.csv */
{
  const rows = [['id', 'x', 'y', 'z', 'w', 'expected_u32', 'largest_index', 'note']];
  const s = 0.70710678;
  const fixed = [
    ['identity', 0, 0, 0, 1, 'identity'],
    ['neg-identity', 0, 0, 0, -1, 'q == -q'],
    ['x180', 1, 0, 0, 0, '180 about X'],
    ['y180', 0, 1, 0, 0, '180 about Y'],
    ['z180', 0, 0, 1, 0, '180 about Z'],
    ['x90', s, 0, 0, s, '90 about X'],
    ['y90', 0, s, 0, s, '90 about Y'],
    ['z90', 0, 0, s, s, '90 about Z'],
    ['tie-yw', 0, s, 0, s, 'tie y/w -> drop y (lowest index)'],
    ['four-way', 0.5, 0.5, 0.5, 0.5, 'four-way tie -> drop x'],
    ['four-way-mix', 0.5, -0.5, 0.5, -0.5, 'four-way tie, mixed signs'],
    ['nonunit', 0, 0, 0, 2, 'non-unit input, normalises to identity'],
    ['nonunit2', 2, 2, 2, 2, 'non-unit four-way tie'],
  ];
  const largestIndex = (x, y, z, w) => {
    const a = [Math.abs(x), Math.abs(y), Math.abs(z), Math.abs(w)];
    let i = 0;
    for (let k = 1; k < 4; k++) if (a[k] > a[i]) i = k;
    return i;
  };
  for (const [id, x, y, z, w, note] of fixed) {
    const u = packQuat({ x, y, z, w }) >>> 0;
    rows.push([id, x.toFixed(9), y.toFixed(9), z.toFixed(9), w.toFixed(9), '0x' + u.toString(16).padStart(8, '0').toUpperCase(), largestIndex(x, y, z, w), note]);
  }
  // ~20 pseudo-random unit quaternions from a seeded PRNG, printed at 9 decimals.
  let a = 0x1234abcd;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rq = () => {
    let x, y, s1;
    do {
      x = rnd() * 2 - 1;
      y = rnd() * 2 - 1;
      s1 = x * x + y * y;
    } while (s1 >= 1);
    let z, w, s2;
    do {
      z = rnd() * 2 - 1;
      w = rnd() * 2 - 1;
      s2 = z * z + w * w;
    } while (s2 >= 1);
    const f = Math.sqrt((1 - s1) / s2);
    return { x, y, z: z * f, w: w * f };
  };
  for (let i = 0; i < 20; i++) {
    const q = rq();
    const u = packQuat(q) >>> 0;
    rows.push([`rand${i}`, q.x.toFixed(9), q.y.toFixed(9), q.z.toFixed(9), q.w.toFixed(9), '0x' + u.toString(16).padStart(8, '0').toUpperCase(), largestIndex(q.x, q.y, q.z, q.w), 'seeded random unit quaternion']);
  }
  writeFileSync(join(TV, 'quaternions.csv'), rows.map((r) => r.join(',')).join('\n') + '\n');
  console.log(`wrote  quaternions.csv  (${rows.length - 1} rows)`);
}
