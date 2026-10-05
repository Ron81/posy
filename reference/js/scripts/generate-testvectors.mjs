// Generates the shared test vectors from the reference implementation, into ../../testvectors/.
// Format is documented in testvectors/README.md. Run: node scripts/generate-testvectors.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, packQuat, BONE_NAMES, VERSION } from '../dist/index.js';
import { fk, mul } from './pose-fk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TV = resolve(HERE, '../../../testvectors');
mkdirSync(join(TV, 'frames'), { recursive: true });
mkdirSync(join(TV, 'poses'), { recursive: true });

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
  { version: VERSION, seq: 1, timestampMs: 0, idle: false, bones: new Map([[0, idQuat]]) },
  { flags: 0 },
);

/* 002-fullbody-standard: 22 bones, root+fingers+Standard-Sync -> 154 B */
{
  const bits = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
  const bones = new Map(bits.map((b) => [b, idQuat]));
  writeAccept(
    '002-fullbody-standard',
    '22 bones (spine/head + legs + toes + both arms), root + fingers + Standard-Sync face',
    {
      version: VERSION,
      seq: 2,
      timestampMs: 33,
      idle: false,
      bones,
      root: { x: 0x8000, y: 0x4000, z: -1500, h: 0x8000 },
      fingers: {
        left: { curl: [0, 64, 128, 192, 255], splay: [-127, -64, 0, 64, 127], thumbOpposition: 30 },
        right: { curl: [0, 64, 128, 192, 255], splay: [-127, -64, 0, 64, 127], thumbOpposition: 30 },
      },
      expressions: { perfectSync: false, weights: new Uint8Array(16), gazeYaw: 12, gazePitch: -8 },
    },
    { flags: 0x0e },
  );
}

/* 003-perfectsync: 13 bones, flags 0x0F, weights i*5 mod 256 -> 154 B */
{
  const bits = [0, 1, 2, 4, 5, 17, 18, 19, 20, 21, 22, 23, 24];
  const bones = new Map(bits.map((b) => [b, idQuat]));
  const weights = new Uint8Array(52);
  for (let i = 0; i < 52; i++) weights[i] = (i * 5) % 256;
  writeAccept(
    '003-perfectsync',
    '13 bones + root + fingers + Perfect-Sync (52 ARKit weights = i*5 mod 256)',
    {
      version: VERSION,
      seq: 3,
      timestampMs: 66,
      idle: false,
      bones,
      root: { x: 100, y: 200, z: 0, h: 0x8000 },
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
    version: VERSION,
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
  dv.setUint8(0, VERSION);
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
      version: VERSION,
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

/* 007-fullbody-legs: 21 bones with distinct non-identity leg and toe rotations, root with a
   lowered hips height, fingers, Standard-Sync with tongue -> 150 B.
   Every leg bone carries a different quaternion so that a wrong bone order or offset
   shows up. Rotations are given as axis-angle in degrees; 90 deg is avoided on purpose
   (exact tie, see 005). */
{
  const rot = (axis, deg) => {
    const h = (deg * Math.PI) / 360;
    const q = { x: 0, y: 0, z: 0, w: Math.cos(h) };
    q[axis] = Math.sin(h);
    return q;
  };
  const bones = new Map([
    [0, rot('x', -10)], // hips
    [1, rot('x', 5)], // spine
    [2, idQuat], // chest
    [4, idQuat], // neck
    [5, rot('y', 15)], // head
    [9, mul(rot('y', -60), rot('x', -80))], // leftUpperLeg: raised, then swung across the body
    [10, rot('x', 95)], // leftLowerLeg
    [11, rot('x', -10)], // leftFoot
    [12, rot('x', 20)], // leftToes
    [13, rot('x', -75)], // rightUpperLeg
    [14, rot('x', 100)], // rightLowerLeg
    [15, rot('z', 12)], // rightFoot
    [16, rot('x', -15)], // rightToes
    [17, idQuat], // leftShoulder
    [18, rot('z', -70)], // leftUpperArm
    [19, idQuat], // leftLowerArm
    [20, idQuat], // leftHand
    [21, idQuat], // rightShoulder
    [22, rot('z', 70)], // rightUpperArm
    [23, idQuat], // rightLowerArm
    [24, idQuat], // rightHand
  ]);
  const weights = new Uint8Array(16);
  weights[2] = 128; // aa
  weights[13] = 200; // tongueOut
  weights[14] = -64 & 0xff; // tongueX, i8
  weights[15] = 32; // tongueY, i8
  writeAccept(
    '007-fullbody-legs',
    '21 bones with non-identity legs and toes, root with h = 0.55 (seated), fingers, Standard-Sync with tongue',
    {
      version: VERSION,
      seq: 7,
      timestampMs: 100,
      idle: false,
      bones,
      root: { x: 0x8000, y: 0xc000, z: 250, h: 18022 },
      fingers: {
        left: { curl: [40, 40, 40, 40, 40], splay: [0, 0, 0, 0, 0], thumbOpposition: 20 },
        right: { curl: [40, 40, 40, 40, 40], splay: [0, 0, 0, 0, 0], thumbOpposition: 20 },
      },
      expressions: { perfectSync: false, weights, gazeYaw: 5, gazePitch: -3 },
    },
    { flags: 0x0e },
  );
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

/* poses/: leg rotation sense (spec §3.4). Each pose is a set of parent-relative
   quaternions on the reference skeleton plus the joint positions they must produce.
   A wrong axis, sign, side or composition order moves a joint by tens of centimetres. */
{
  const rot = (axis, deg) => {
    const h = (deg * Math.PI) / 360;
    const q = { x: 0, y: 0, z: 0, w: Math.cos(h) };
    q[axis] = Math.sin(h);
    return q;
  };
  const seq = (...parts) => parts.reduce(mul); // leftmost is outermost (applied last)

  // Reference skeleton: T-pose offsets from the parent joint, metres. Left is +X.
  const leg = (side, sx) => [
    { name: `${side}UpperLeg`, parent: 'hips', offset: [0.1 * sx, -0.05, 0] },
    { name: `${side}LowerLeg`, parent: `${side}UpperLeg`, offset: [0, -0.4, 0] },
    { name: `${side}Foot`, parent: `${side}LowerLeg`, offset: [0, -0.4, 0] },
    { name: `${side}Toes`, parent: `${side}Foot`, offset: [0, -0.07, 0.12] },
    { name: `${side}ToeTip`, parent: `${side}Toes`, offset: [0, 0, 0.06] },
  ];
  const joints = [{ name: 'hips', parent: null, offset: [0, 0, 0] }, ...leg('left', 1), ...leg('right', -1)];
  const skeleton = {
    description:
      'Reference skeleton for the pose vectors. VRM 1.0 normalized space: right-handed, Y up, facing +Z, left = +X. Offsets are from the parent joint in the T-pose, in metres. ToeTip joints are end points, not bones.',
    standing_hip_height: 0.93,
    joints,
  };
  writeFileSync(join(TV, 'poses', 'skeleton.json'), JSON.stringify(skeleton, null, 2) + '\n');

  const r6 = (n) => Math.round(n * 1e6) / 1e6 + 0; // + 0 turns -0 into 0
  const bitOf = (name) => BONE_NAMES.indexOf(name);

  function writePose(name, description, pose, hipsHeight) {
    const pos = fk(joints, pose);
    const json = {
      name,
      description,
      bones: Object.keys(pose)
        .sort((a, b) => bitOf(a) - bitOf(b))
        .map((bone) => ({ bit: bitOf(bone), name: bone, quat: ['x', 'y', 'z', 'w'].map((k) => r6(pose[bone][k])) })),
      // hips height above the floor in metres, and the root-block value it encodes to (§5.4)
      hips_height: hipsHeight,
      h: Math.round((hipsHeight / skeleton.standing_hip_height) * 32768),
      // joint positions relative to the hips, metres
      expect: Object.fromEntries(joints.filter((j) => j.parent !== null).map((j) => [j.name, pos[j.name].map(r6)])),
    };
    writeFileSync(join(TV, 'poses', `${name}.json`), JSON.stringify(json, null, 2) + '\n');
    console.log(`wrote  poses/${name}.json`);
  }

  // Single-axis anchors: one row of the §3.4 table each, left and right where they differ.
  writePose('p01-hip-flexion', 'left thigh raised forward 90 deg (leftUpperLeg -X); right leg in T-pose', {
    leftUpperLeg: rot('x', -90),
  }, 0.93);
  writePose('p02-knee-flexion', 'left knee bent 90 deg, shin pointing back (leftLowerLeg +X)', {
    leftLowerLeg: rot('x', 90),
  }, 0.93);
  writePose('p03-hip-abduction', 'both legs spread 30 deg outward (leftUpperLeg +Z, rightUpperLeg -Z)', {
    leftUpperLeg: rot('z', 30),
    rightUpperLeg: rot('z', -30),
  }, 0.823);
  writePose('p04-hip-external-rotation', 'both legs turned out 45 deg, toes pointing outward (leftUpperLeg +Y, rightUpperLeg -Y)', {
    leftUpperLeg: rot('y', 45),
    rightUpperLeg: rot('y', -45),
  }, 0.93);
  writePose('p05-ankle-and-toes', 'standing on the right tiptoe: rightFoot +X 30 deg (plantarflexion), rightToes -X 30 deg (extension, toes flat on the floor); left foot off the floor, dorsiflexed 20 deg (leftFoot -X) with toes extended 30 deg (leftToes -X)', {
    leftFoot: rot('x', -20),
    leftToes: rot('x', -30),
    rightFoot: rot('x', 30),
    rightToes: rot('x', -30),
  }, 0.981);

  // Named poses from the 1.1.0 requirements.
  const seatedLeft = { leftUpperLeg: rot('x', -90), leftLowerLeg: rot('x', 90) };
  const seatedRight = { rightUpperLeg: rot('x', -90), rightLowerLeg: rot('x', 90) };
  writePose('p06-seated-crossed-legs', 'seated, left foot on the floor, right thigh crossed over the left knee', {
    ...seatedLeft,
    rightUpperLeg: seq(rot('y', 25), rot('x', -100)),
    rightLowerLeg: rot('x', 80),
    rightFoot: rot('x', 20),
  }, 0.53);
  writePose('p07-seated-ankle-on-knee', 'seated, right foot on the floor, left ankle resting on the right knee', {
    ...seatedRight,
    leftUpperLeg: seq(rot('y', 30), rot('x', -95), rot('y', 100)),
    leftLowerLeg: rot('x', 115),
  }, 0.53);
  writePose('p08-kneeling', 'kneeling upright on both knees, shins and insteps on the floor', {
    leftLowerLeg: rot('x', 90),
    rightLowerLeg: rot('x', 90),
    leftFoot: rot('x', 80),
    rightFoot: rot('x', 80),
  }, 0.5);
  writePose('p09-seated-feet-off-floor', 'seated on a high stool, both feet hanging clear of the floor', {
    leftUpperLeg: rot('x', -80),
    leftLowerLeg: rot('x', 70),
    rightUpperLeg: rot('x', -80),
    rightLowerLeg: rot('x', 85),
  }, 0.75);
}
