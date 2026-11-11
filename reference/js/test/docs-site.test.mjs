import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  BLENDSHAPE_NAMES, BONE_NAMES, ERROR_CODES, FINGER_BLOCK_FIELDS, FINGER_BONES_MASK, STANDARD_SYNC_NAMES, encode, packQuat, unpackQuat,
} from '../dist/index.js';

// docs/assets/data.js and codec.js are hand-written copies of the tables, the quaternion
// packing and the size formula (the site is buildless and cannot import the codec). These
// tests fail when a copy drifts from the reference implementation.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Both files are classic scripts that attach to `window`.
const window = {};
const context = vm.createContext({ window, console });
for (const f of ['docs/assets/data.js', 'docs/assets/codec.js']) {
  vm.runInContext(read(f), context, { filename: f });
}
const { PosyData, PosyCodec } = window;

test('docs: the tables equal the generated lists', () => {
  assert.deepEqual(Array.from(PosyData.BONES, (b) => b.name), [...BONE_NAMES]);
  assert.deepEqual(Array.from(PosyData.BONES, (b) => b.bit), BONE_NAMES.map((_, i) => i));
  assert.deepEqual([...PosyData.BLENDSHAPES], [...BLENDSHAPE_NAMES]);
  assert.deepEqual(Array.from(PosyData.VRM_SYNC_SLOTS, (s) => [s.idx, s.name]), STANDARD_SYNC_NAMES.map((n, i) => [i, n]));
  // The site writes the last row as "reserved (MUST be 0)".
  const rows = Array.from(PosyData.FINGER_ROWS, ([offset, type, name]) => [Number(offset), type, name.split(' ')[0]]);
  assert.deepEqual(rows, FINGER_BLOCK_FIELDS.map((f, i) => [i, f.type, f.name]));
  assert.deepEqual(Array.from(PosyData.ERROR_ROWS, (r) => r[0]), [...ERROR_CODES]);
});

// The spec is normative and hand-written; the generator's lists are checked against its tables.
test('spec: §5.6 slot table, §5.5 hand layout and §2.5 error table match the generated lists', () => {
  const spec = read('spec/Posy.md');
  const slots = [...spec.matchAll(/^\| (\d+) \| `(\w+)` \| `[ui]8` \|/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(slots, STANDARD_SYNC_NAMES.map((n, i) => [i, n]));
  const hand = [...spec.matchAll(/^(\d+) +1 +([ui]8) +(\w+)/gm)].map((m) => [Number(m[1]), m[2], m[3]]);
  assert.deepEqual(hand, FINGER_BLOCK_FIELDS.map((f, i) => [i, f.type, f.name]));
  const errors = [...spec.matchAll(/^\| `([A-Z_]+)` \| [^|]+ \| [^|]+ \|$/gm)].map((m) => m[1]);
  assert.deepEqual(errors, [...ERROR_CODES]);
});

test('docs: masks equal the spec and the codec', () => {
  const table = read('spec/bone-index-table.md');
  const bits = [...PosyData.TYPICAL_BITS];
  assert.ok(table.includes(`bits ${bits.join(', ')} → ${bits.length} bones → \`${PosyCodec.maskHex(bits)}\``));
  assert.equal(BigInt(PosyCodec.maskHex([...PosyData.FINGER_BITS])), FINGER_BONES_MASK);
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

test('docs: packetSize equals the encoded frame length', () => {
  const id = { x: 0, y: 0, z: 0, w: 1 };
  const hand = { curl: [0, 0, 0, 0, 0], splay: [0, 0, 0, 0, 0], thumbOpposition: 0 };
  const { bones: B, values: V } = PosyData.EXTRA_EXAMPLE;
  for (const preset of PosyData.PRESETS) for (const hasRoot of [false, true]) for (const fingers of ['none', 'block', 'joints']) {
    for (const expr of [null, false, true]) for (const hasExtra of [false, true]) {
      const bits = [...preset.bits, ...(fingers === 'joints' ? PosyData.FINGER_BITS : [])];
      const frame = { version: 5, seq: 0, timestampMs: 0, bones: new Map(bits.map((b) => [b, id])) };
      if (hasRoot) frame.root = { x: 0, y: 0, z: 0, h: 32768 };
      if (fingers === 'block') frame.fingers = { left: hand, right: hand };
      if (expr !== null) frame.expressions = { perfectSync: expr, weights: new Uint8Array(expr ? 52 : 13), gazeYaw: 0, gazePitch: 0 };
      if (hasExtra) frame.extra = { bones: Array(B).fill(id), values: new Uint8Array(V) };
      const opts = {
        boneCount: bits.length, hasRoot, hasFingers: fingers === 'block', hasExpressions: expr !== null, perfectSync: expr === true,
        hasExtra, extraBones: B, extraValues: V,
      };
      assert.equal(PosyCodec.packetSize(opts), encode(frame).length, JSON.stringify(opts));
    }
  }
});

// Each page states the release once. The other sizes it prints are literals in its text.
test('docs: both pages show the version of package.json and the frame sizes of §6', () => {
  const { version } = JSON.parse(read('reference/js/package.json'));
  const typical = { boneCount: PosyData.TYPICAL_BITS.length, hasRoot: true, hasFingers: true, hasExpressions: true };
  assert.equal(PosyCodec.packetSize({ ...typical, perfectSync: false }), 115);
  assert.equal(PosyCodec.packetSize({ ...typical, perfectSync: true }), 154);
  for (const page of ['docs/index.html', 'docs/de/index.html']) {
    const html = read(page);
    assert.equal(html.match(/class="brand-tag">([^<]+)</)[1], version, page);
    assert.ok(/115 bytes/i.test(html) && !/\b11[68] ?(B|bytes)\b/i.test(html), page);
  }
});

// The German page shares scripts and tables with the English one. It drifts in two ways: an
// element the scripts look for is missing, or a text of data.js has no German counterpart.
test('docs: the German page has every element and every text of the English one', () => {
  const ids = (page) => [...read(page).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'uk').sort();
  assert.deepEqual(ids('docs/de/index.html'), ids('docs/index.html'));

  const de = {};
  const deContext = vm.createContext({ window: de, console });
  for (const f of ['docs/assets/data.js', 'docs/assets/de.js']) vm.runInContext(read(f), deContext, { filename: f });
  const en = PosyData, ge = de.PosyData;
  const slots = (text) => (text.match(/\{\w+\}/g) ?? []).sort();
  assert.deepEqual(Object.keys(ge.T).sort(), Object.keys(en.T).sort());
  for (const k of Object.keys(en.T)) assert.deepEqual(slots(ge.T[k]), slots(en.T[k]), `T.${k}`);
  assert.deepEqual(Object.keys(ge.FLAG_INFO).sort(), Object.keys(en.FLAG_INFO).sort());
  assert.deepEqual(Object.keys(ge.CATEGORY_LABEL), Object.keys(en.CATEGORY_LABEL));
  // Texts only: tables, bits and codes are those of data.js.
  assert.deepEqual(Array.from(ge.PRESETS, (p) => [...p.bits]), Array.from(en.PRESETS, (p) => [...p.bits]));
  assert.deepEqual(Array.from(ge.ERROR_ROWS, (r) => r[0]), Array.from(en.ERROR_ROWS, (r) => r[0]));
  assert.deepEqual(Array.from(ge.FINGER_ROWS, (r) => r[2].split(' ')[0]), Array.from(en.FINGER_ROWS, (r) => r[2].split(' ')[0]));
  for (const list of ['PRESETS', 'SCENARIOS']) {
    ge[list].forEach((item, i) => assert.notEqual(item.label, en[list][i].label, `${list}[${i}]`));
  }
});
