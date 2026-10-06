#!/usr/bin/env node
/**
 * scripts/generate-spec-tables.mjs
 *
 * Single source of truth for the lookup tables and name lists of the Posy spec, so nobody
 * ever has to hand-type (and mis-type) them again:
 *
 *   spec/blendshape-order.json            Appendix A — the 52 ARKit blendshapes, sorted
 *   spec/bone-index-table.md              §4        — the 64-bit bone_mask bit assignments
 *   reference/js/src/tables.generated.ts  (only written if reference/js/ exists); also carries
 *                                         the Standard-Sync slots (§5.6), the finger block
 *                                         fields (§5.5) and the error codes (§2.5)
 *
 * Usage
 *   node scripts/generate-spec-tables.mjs               write the files
 *   node scripts/generate-spec-tables.mjs --check       exit 1 if any file is out of date (used by CI)
 *   node scripts/generate-spec-tables.mjs --appendix-a  print the Appendix A table (Markdown) to stdout,
 *                                                       ready to paste into spec/Posy.md
 *
 * No dependencies. Needs Node 18+.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const APPENDIX_A = args.has('--appendix-a');

/**
 * Finger bit layout.
 *   'fixed'       15 finger bones per hand, VRM order: left = bits 25–39, right = bits 40–54.
 *                 This is the layout used by the spec: 30 finger bones total, matching §5.5.
 *   'as-written'  an alternate layout with 13 left-hand rows (left = 25–37, right = 38–52).
 * Finger bits MUST be 0 in v1, so this choice does not change a single v1 frame.
 */
const FINGER_LAYOUT = 'fixed';

/** §5.6: the 16 Standard-Sync slots, in wire order. */
const STANDARD_SYNC_SLOTS = [
  'blinkLeft', 'blinkRight', 'aa', 'ih', 'ou', 'ee', 'oh', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral',
  'tongueOut', 'tongueX', 'tongueY',
];

/** §5.5: the 12 bytes of one hand in the finger block, in wire order, as [type, name]. */
const FINGER_BLOCK_FIELDS = [
  ['u8', 'thumb_curl'], ['i8', 'thumb_splay'], ['u8', 'index_curl'], ['i8', 'index_splay'],
  ['u8', 'middle_curl'], ['i8', 'middle_splay'], ['u8', 'ring_curl'], ['i8', 'ring_splay'],
  ['u8', 'little_curl'], ['i8', 'little_splay'], ['u8', 'thumb_opposition'], ['u8', 'reserved'],
];

/** §2.5: the error codes, in the order of the spec table. */
const ERROR_CODES = ['BAD_VERSION', 'UNAUTHORIZED_TYPE', 'MALFORMED_THRESHOLD', 'RATE_EXCEEDED', 'UNSUPPORTED_TRANSPORT'];

/** The 52 ARKit ARFaceAnchor.BlendShapeLocation names — deliberately NOT in sorted order. */
const ARKIT_BLENDSHAPES = [
  'eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeSquintLeft', 'eyeWideLeft',
  'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawRight', 'jawOpen',
  'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthDimpleLeft', 'mouthDimpleRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'noseSneerLeft', 'noseSneerRight',
  'tongueOut',
];

const BODY_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
]; // bits 0–24

const PID = ['Proximal', 'Intermediate', 'Distal'];
const FINGERS = [
  ['Thumb', ['Metacarpal', 'Proximal', 'Distal']],
  ['Index', PID], ['Middle', PID], ['Ring', PID], ['Little', PID],
];

/* ------------------------------------------------------------------ build */

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // NOT localeCompare: must be locale-independent

function buildBlendshapes() {
  if (ARKIT_BLENDSHAPES.length !== 52) throw new Error(`expected 52 ARKit blendshapes, got ${ARKIT_BLENDSHAPES.length}`);
  if (new Set(ARKIT_BLENDSHAPES).size !== 52) throw new Error('duplicate ARKit blendshape name');
  for (const n of ARKIT_BLENDSHAPES) {
    if (!/^[a-z]+(?:[A-Z][a-z]*)*$/.test(n)) throw new Error(`unexpected blendshape name format: ${n}`);
  }
  return [...ARKIT_BLENDSHAPES].sort(byCodeUnit);
}

function hand(side) {
  const out = [];
  for (const [finger, joints] of FINGERS) for (const j of joints) out.push(`${side}${finger}${j}`);
  if (FINGER_LAYOUT === 'as-written' && side === 'left') {
    return out.filter((n) => n !== 'leftIndexProximal' && n !== 'leftIndexIntermediate');
  }
  return out;
}

function buildBones() {
  const names = [...BODY_BONES, ...hand('left'), ...hand('right')];
  if (names.length > 64) throw new Error('more than 64 bones');
  const fingerStart = BODY_BONES.length;
  const fingerEnd = names.length - 1;
  const bones = [];
  for (let bit = 0; bit < 64; bit++) bones.push({ bit, name: names[bit] ?? 'reserved' });
  return { bones, fingerStart, fingerEnd, firstReserved: names.length };
}

function classify(bit, { fingerStart, fingerEnd }) {
  if (bit <= 5) return ['spine & head', 'allowed'];
  if (bit <= 8) return ['face (fallback)', 'allowed — but face tracking belongs in the expression block (§5.6)'];
  if (bit <= 16) return ['legs & feet', 'optional'];
  if (bit < fingerStart) return ['arms & shoulders', 'allowed'];
  if (bit <= fingerEnd) return ['fingers', 'MUST be 0 in v1 — use the finger block (§5.5)'];
  return ['reserved', 'reserved, MUST be 0'];
}

/* --------------------------------------------------------------- renderers */

function renderBlendshapeJson(names) {
  return JSON.stringify(
    {
      $comment: 'GENERATED by scripts/generate-spec-tables.mjs. Do not edit by hand.',
      spec: 'Posy-1.0 Appendix A',
      source: 'ARKit ARFaceAnchor.BlendShapeLocation names, sorted ascending by UTF-16 code unit (locale-independent)',
      count: names.length,
      blendshapes: names,
    },
    null,
    2,
  ) + '\n';
}

function renderBoneMarkdown(info) {
  const { bones, fingerStart, fingerEnd, firstReserved } = info;
  const typical = [0, 1, 2, 4, 5, 17, 18, 19, 20, 21, 22, 23, 24];
  const mask = typical.reduce((m, b) => m | (1n << BigInt(b)), 0n);
  const L = [];
  L.push('# Bone index table (Posy 1.0, §4)');
  L.push('');
  L.push('<!-- GENERATED by scripts/generate-spec-tables.mjs. Do not edit by hand. -->');
  L.push('');
  L.push('`bone_mask` is a `u64`. Bit *n* set ⇒ the quaternion for bone *n* is present. Quaternions appear in the payload in **ascending bit order**.');
  L.push('');
  L.push('| Bit | Bone | Group | v1 status |');
  L.push('|---:|---|---|---|');
  for (const b of bones) {
    if (b.bit >= firstReserved) continue;
    const [group, status] = classify(b.bit, info);
    L.push(`| ${b.bit} | \`${b.name}\` | ${group} | ${status} |`);
  }
  L.push(`| ${firstReserved}–63 | *reserved* | reserved | reserved, MUST be 0 |`);
  L.push('');
  L.push(`**v1 constraint:** bits **${fingerStart}–${fingerEnd}** (all finger bones) MUST be 0. Fingers are carried by the compact finger block (§5.5). Bits 9–16 (legs/feet) MAY be used but are OPTIONAL; receivers MUST handle their absence.`);
  L.push('');
  L.push(`**Typical v1 upper-body mask** = bits ${typical.join(', ')} → ${typical.length} bones → \`0x${mask.toString(16).toUpperCase().padStart(16, '0')}\`.`);
  L.push('');
  if (FINGER_LAYOUT === 'fixed') {
    L.push('Finger layout: 15 bones per hand in VRM order (thumb metacarpal/proximal/distal, then index, middle, ring, little proximal/intermediate/distal); left hand first.');
    L.push('');
  }
  return L.join('\n');
}

function renderTs(blendshapes, info) {
  const q = (arr) => arr.map((n) => `  '${n}',`).join('\n');
  return [
    '// GENERATED by scripts/generate-spec-tables.mjs. Do not edit by hand.',
    '',
    '/** Index = bit number in bone_mask (spec §4). */',
    'export const BONE_NAMES = [',
    q(info.bones.map((b) => b.name)),
    '] as const;',
    '',
    '/** Index = position in the Perfect-Sync expression block (spec Appendix A). */',
    'export const BLENDSHAPE_NAMES = [',
    q(blendshapes),
    '] as const;',
    '',
    '/** Index = slot in the Standard-Sync expression block (spec §5.6). */',
    'export const STANDARD_SYNC_NAMES = [',
    q(STANDARD_SYNC_SLOTS),
    '] as const;',
    '',
    '/** Index = byte offset within one hand of the finger block (spec §5.5). */',
    'export const FINGER_BLOCK_FIELDS = [',
    FINGER_BLOCK_FIELDS.map(([type, name]) => `  { type: '${type}', name: '${name}' },`).join('\n'),
    '] as const;',
    '',
    '/** Error codes of the `error` message (spec §2.5). */',
    'export const ERROR_CODES = [',
    q(ERROR_CODES),
    '] as const;',
    '',
  ].join('\n');
}

/* -------------------------------------------------------------------- main */

const blendshapes = buildBlendshapes();
const info = buildBones();

// sanity checks that encode what the spec says must be true
if (blendshapes[38] !== 'mouthRight') throw new Error(`index 38 should be mouthRight, got ${blendshapes[38]}`);
if (blendshapes[51] !== 'tongueOut') throw new Error(`index 51 should be tongueOut, got ${blendshapes[51]}`);

if (APPENDIX_A) {
  const out = ['| Idx | Blendshape | Idx | Blendshape | Idx | Blendshape | Idx | Blendshape |', '|---:|---|---:|---|---:|---|---:|---|'];
  for (let r = 0; r < 13; r++) {
    out.push('| ' + [0, 13, 26, 39].map((o) => `${r + o} | \`${blendshapes[r + o]}\``).join(' | ') + ' |');
  }
  console.log(out.join('\n'));
  process.exit(0);
}

const outputs = [
  ['spec/blendshape-order.json', renderBlendshapeJson(blendshapes)],
  ['spec/bone-index-table.md', renderBoneMarkdown(info)],
];
if (existsSync(join(ROOT, 'reference/js'))) {
  outputs.push(['reference/js/src/tables.generated.ts', renderTs(blendshapes, info)]);
}

let stale = false;
for (const [rel, content] of outputs) {
  const file = join(ROOT, rel);
  if (CHECK) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (current === content) console.log(`ok     ${rel}`);
    else { console.error(`STALE  ${rel}`); stale = true; }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote  ${rel}`);
  }
}
if (CHECK && stale) {
  console.error('\nGenerated files are out of date. Run: node scripts/generate-spec-tables.mjs');
  process.exit(1);
}
