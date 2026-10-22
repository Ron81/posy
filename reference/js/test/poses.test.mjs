import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packQuat, unpackQuat } from '../dist/index.js';
import { estimateHipsHeight, fk } from '../scripts/pose-fk.mjs';
import { REST_HAND, axisAngle, conj, fingerPose, fkHand, eulerXYZ, mul, referenceThumb, thumbRestTurn } from '../scripts/finger-fk.mjs';

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

  test(`finger ${vec.name}: §5.5 synthesis gives the expected joint positions`, () => {
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

// A flipped curl sign on the fingers (curl toward +Y instead of −Y) is caught. Checked on the
// half-curled f07: a fully curled finger folds back onto its knuckle and a sign error moves its
// tip by about 2 cm only, a half-curled one by more than 10 cm.
test('a flipped finger curl sign is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f07-half-curl-splay.json'), 'utf8'));
  const wrong = synth(vec.bytes);
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    ['Index', 'Middle', 'Ring', 'Little'].forEach((finger, i) => {
      const curl = vec.bytes[side].curl[i + 1] / 255;
      const splay = (vec.bytes[side].splay[i + 1] / 127) * 30;
      for (const [joint, max] of [['Proximal', 90], ['Intermediate', 110], ['Distal', 70]]) {
        // curl toward +Y — wrong
        wrong[`${side}${finger}${joint}`] = eulerXYZ(0, joint === 'Proximal' ? sign * splay : 0, -sign * curl * max);
      }
    });
  }
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.1);
});

// §5.5 orders the proximal joint q = q_splay · q_curl. f07 is the pose with both on one joint.
test('the wrong product order on a proximal joint is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f07-half-curl-splay.json'), 'utf8'));
  const wrong = synth(vec.bytes);
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].forEach((finger, i) => {
      if (finger === 'Thumb') return;
      const splay = eulerXYZ(0, sign * (vec.bytes[side].splay[i] / 127) * 30, 0);
      const curl = eulerXYZ(0, 0, sign * (vec.bytes[side].curl[i] / 255) * 90);
      wrong[`${side}${finger}Proximal`] = mul(curl, splay); // curl outside splay — wrong
    });
  }
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.01);
});

// Positive thumb splay opens the thumb away from the fingers (§5.5). f07 carries the only
// non-zero thumb splay byte.
test('a flipped thumb splay sign is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f07-half-curl-splay.json'), 'utf8'));
  const flipped = (b) => ({ ...b, splay: [-b.splay[0], ...b.splay.slice(1)] });
  const wrong = synth({ left: flipped(vec.bytes.left), right: flipped(vec.bytes.right) });
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.02);
});

// Left and right must differ: an asymmetric pose applied with a single (unmirrored) sign fails.
test('f06 is asymmetric: the right hand is not the left', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'f06-count-two.json'), 'utf8'));
  // Drive the right hand with the left hand's bytes (as a sender that forgot to mirror would):
  const wrong = { ...fingerPose('left', vec.bytes.left), ...fingerPose('right', vec.bytes.left) };
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.1);
});

// --- Per-joint finger pose vectors (finger_bones, §4): direct quaternions, no §5.5 synthesis ---
// These carry parent-relative quaternions like the leg poses, applied to the hand skeleton with
// fkHand. They pin shapes the compact block cannot express (a claw: base straight, outer bent).
const gFiles = readdirSync(POSES).filter((f) => /^g\d+.*\.json$/.test(f)).sort();
const restHand = { ...fingerPose('left', REST_HAND), ...fingerPose('right', REST_HAND) };

for (const file of gFiles) {
  const vec = JSON.parse(readFileSync(join(POSES, file), 'utf8'));

  // A cleared finger bit takes the rest hand of §5.5 for that joint.
  test(`finger_bones ${vec.name}: direct quaternions give the expected joint positions`, () => {
    const pose = { ...restHand, ...Object.fromEntries(vec.bones.map((b) => [b.name, toQuat(b.quat)])) };
    assert.ok(maxError(fkHand(handSkeleton.joints, pose), vec.expect) < 1e-4);
  });

  test(`finger_bones ${vec.name}: still within 1 cm after the wire encoding`, () => {
    const pose = { ...restHand, ...Object.fromEntries(vec.bones.map((b) => [b.name, unpackQuat(packQuat(toQuat(b.quat)))])) };
    assert.ok(maxError(fkHand(handSkeleton.joints, pose), vec.expect) < 0.01);
  });
}

// A claw is axis-sensitive: flipping the flexion axis (−Z → +Z) curls the finger the wrong way
// and moves its tip by more than a centimetre, which a frame vector cannot catch.
test('finger_bones g01: a flipped flexion axis is caught', () => {
  const vec = JSON.parse(readFileSync(join(POSES, 'g01-claw-left-index.json'), 'utf8'));
  const wrong = Object.fromEntries(vec.bones.map((b) => {
    const [x, y, z, w] = b.quat;
    return [b.name, { x: -x, y: -y, z: -z, w }];
  }));
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.01);
});

// --- The thumb of 1.4.5 (§5.5): opposition with its roll, the outward splay spread, the axes rule ---

const mirrored = (q) => ({ x: q.x, y: -q.y, z: -q.z, w: q.w });
const onSides = (f) => ({ ...f('left', (q) => q), ...f('right', mirrored) });
const vector = (name) => JSON.parse(readFileSync(join(POSES, `${name}.json`), 'utf8'));

// Opposition turns the metacarpal about (1, 0, −1)/√2 on the left hand, not about X as up to 1.4.4.
test('opposition about X (1.4.4) is caught', () => {
  const vec = vector('f04-thumb-opposition');
  const wrong = { ...synth(vec.bytes), ...onSides((side) => ({ [`${side}ThumbMetacarpal`]: eulerXYZ(60, 0, 0) })) };
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.02);
});

// The roll only shows once the thumb bends, so it is pinned on the curled f05 and f06.
for (const name of ['f05-fist', 'f06-count-two']) {
  test(`${name}: opposition without its roll, or with the roll's sign flipped, is caught`, () => {
    const vec = vector(name);
    for (const roll of [0, 1]) {
      const wrong = { ...synth(vec.bytes), ...onSides((side, m) => {
        const o = (vec.bytes[side].opposition / 255) * 60;
        return { [`${side}ThumbMetacarpal`]: m(mul(axisAngle([1, 0, -1], o), axisAngle([1, 0, 1], roll * o))) };
      }) };
      assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.01);
    }
  });
}

test('an outward thumb splay wholly on the metacarpal (no spread) is caught', () => {
  const vec = vector('f08-all-splay');
  const s = (vec.bytes.left.splay[0] / 127) * 90, ID = { x: 0, y: 0, z: 0, w: 1 };
  const wrong = { ...synth(vec.bytes), ...onSides((side, m) => ({
    [`${side}ThumbMetacarpal`]: m(axisAngle([0, 1, 0], -s)), [`${side}ThumbProximal`]: ID, [`${side}ThumbDistal`]: ID,
  })) };
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.01);
});

test('an inward thumb splay spread over the joints is caught', () => {
  const vec = vector('f09-thumb-inward');
  const s = (vec.bytes.left.splay[0] / 127) * 90, c = vec.bytes.left.curl[0] / 255;
  const wrong = { ...synth(vec.bytes), ...onSides((side, m) => ({
    [`${side}ThumbMetacarpal`]: m(axisAngle([0, 1, 0], -0.3 * s)),
    [`${side}ThumbProximal`]: m(axisAngle([0, 1, 0], 60 * c - 0.45 * s)),
    [`${side}ThumbDistal`]: m(axisAngle([0, 1, 0], 80 * c - 0.25 * s)),
  })) };
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.02);
});

test('the finger splay at ±15° (up to 1.4.4) is caught', () => {
  const vec = vector('f08-all-splay');
  const half = (b) => ({ ...b, splay: b.splay.map((v, i) => (i ? v / 2 : v)) });
  const wrong = synth({ left: half(vec.bytes.left), right: half(vec.bytes.right) });
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.01);
});

test('finger_bones g02: cleared bits left at identity instead of the rest hand are caught', () => {
  const vec = vector('g02-cleared-bits-rest-hand');
  const wrong = Object.fromEntries(vec.bones.map((b) => [b.name, toQuat(b.quat)]));
  assert.ok(maxError(fkHand(handSkeleton.joints, wrong), vec.expect) > 0.05);
});

// The axes rule on a hand whose thumb rests turned: every thumb segment there points as on the
// reference hand, for the bytes of every finger vector. Without the rule it is off by the rest turn.
const turnedHand = (resting) => {
  const n = Math.hypot(...resting.left);
  return handSkeleton.joints.map((j) => {
    const side = j.name.startsWith('left') ? 'left' : 'right';
    if (!/Thumb(Proximal|Distal|Tip)$/.test(j.name)) return j;
    const len = Math.hypot(...j.offset), d = side === 'left' ? resting.left.map((v) => v / n) : [-resting.left[0] / n, resting.left[1] / n, resting.left[2] / n];
    return { ...j, offset: d.map((v) => v * len) };
  });
};
// An avatar thumb measured at load: 31.0° from the arm's axis in the palm's plane, 13.8° below it.
const RESTING = { left: [0.832134, -0.238844, 0.500506] };
const RESTING_RIGHT = [-0.832134, -0.238844, 0.500506];

test('the axes rule: T0 of the worked example in §5.5', () => {
  const close = (q, e) => Math.max(...['x', 'y', 'z', 'w'].map((k, i) => Math.abs(q[k] - e[i]))) < 1e-5;
  assert.ok(close(thumbRestTurn('left', RESTING.left), [-0.085689, -0.118976, 0.085689, 0.985474]));
  assert.ok(close(thumbRestTurn('right', RESTING_RIGHT), [-0.085689, 0.118976, -0.085689, 0.985474]));
  assert.ok(close(thumbRestTurn('left', referenceThumb('left')), [0, 0, 0, 1]));
});

test('the axes rule: a turned resting thumb points as the reference thumb, for every finger vector', () => {
  const turned = turnedHand(RESTING);
  const rest = { left: thumbRestTurn('left', RESTING.left), right: thumbRestTurn('right', RESTING_RIGHT) };
  const dir = (pos, side, a, b) => { const v = pos[`${side}Thumb${b}`].map((x, i) => x - pos[`${side}Thumb${a}`][i]); const l = Math.hypot(...v); return v.map((x) => x / l); };
  const worst = (withRule) => {
    let w = 0;
    for (const file of fingerFiles) {
      const { bytes } = JSON.parse(readFileSync(join(POSES, file), 'utf8'));
      const ref = fkHand(handSkeleton.joints, synth(bytes));
      const pose = { ...fingerPose('left', bytes.left, withRule ? rest.left : undefined), ...fingerPose('right', bytes.right, withRule ? rest.right : undefined) };
      const got = fkHand(turned, pose);
      for (const side of ['left', 'right']) for (const [a, b] of [['Metacarpal', 'Proximal'], ['Proximal', 'Distal'], ['Distal', 'Tip']]) {
        const u = dir(got, side, a, b), r = dir(ref, side, a, b);
        w = Math.max(w, Math.acos(Math.min(1, u[0] * r[0] + u[1] * r[1] + u[2] * r[2])) * 180 / Math.PI);
      }
    }
    return w;
  };
  assert.ok(worst(true) < 1e-4);
  assert.ok(worst(false) > 15);
});

test('the axes rule: the sender inverts it, T(before) · q · T(own)⁻¹ recovers the reference rotations', () => {
  const T0 = thumbRestTurn('left', RESTING.left), bytes = vector('f07-half-curl-splay').bytes.left;
  const ref = fingerPose('left', bytes), onAvatar = fingerPose('left', bytes, T0);
  const back = {
    leftThumbMetacarpal: mul(onAvatar.leftThumbMetacarpal, conj(T0)),
    leftThumbProximal: mul(mul(T0, onAvatar.leftThumbProximal), conj(T0)),
    leftThumbDistal: mul(mul(T0, onAvatar.leftThumbDistal), conj(T0)),
  };
  for (const [k, q] of Object.entries(back)) {
    const r = ref[k], dot = Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w);
    assert.ok(dot > 1 - 1e-12, k);
  }
});
