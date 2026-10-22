// Forward kinematics for the finger pose vectors (spec §5.5). Used by the generator and by
// test/poses.test.mjs. Plain quaternion math, no dependency on the codec. The point of these
// vectors is to pin the §5.5 *synthesis*: a receiver turns the curl / splay / opposition bytes
// into the 30 finger-bone rotations, and a wrong axis, sign or order moves a fingertip here.

/** Hamilton product a*b: b is applied first, then a. (Same as pose-fk.mjs.) */
export const mul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

const rotate = (q, v) => {
  const p = mul(mul(q, { x: v[0], y: v[1], z: v[2], w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return [p.x, p.y, p.z];
};

const ID = { x: 0, y: 0, z: 0, w: 1 };
const DEG = Math.PI / 180;

/** Unit quaternion for a rotation of `deg` degrees about a single axis 'x' | 'y' | 'z'. */
const axisQuat = (axis, deg) => {
  const h = (deg * DEG) / 2;
  const s = Math.sin(h);
  return { x: axis === 'x' ? s : 0, y: axis === 'y' ? s : 0, z: axis === 'z' ? s : 0, w: Math.cos(h) };
};

/**
 * Euler XYZ in degrees → quaternion, matching three.js THREE.Euler default order 'XYZ'
 * (the demo's synthesis uses it): R = Rx · Ry · Rz, so with x = 0 that is Ry · Rz —
 * splay (Y) outside curl (Z), as §5.5 orders the proximal joint.
 */
export const eulerXYZ = (x, y, z) => mul(mul(axisQuat('x', x), axisQuat('y', y)), axisQuat('z', z));

// §5.5 maximum flexion angles at curl 255, and the splay of index … little at ±127.
const FLEXION = { Proximal: 90, Intermediate: 110, Distal: 70 };
const SPLAY = 30;
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];

/** Unit quaternion for `deg` degrees about an arbitrary axis (normalised first). */
export const axisAngle = ([x, y, z], deg) => {
  const l = Math.hypot(x, y, z), s = Math.sin((deg * DEG) / 2);
  return { x: (x / l) * s, y: (y / l) * s, z: (z / l) * s, w: Math.cos((deg * DEG) / 2) };
};
export const conj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
/** The right hand is the mirror of the left (§5.5): (x, y, z, w) → (x, −y, −z, w). */
const mirror = (q) => ({ x: q.x, y: -q.y, z: -q.z, w: q.w });

/** The reference thumb's resting direction, metacarpal joint to distal joint (§5.5). */
export const referenceThumb = (side) => [side === 'left' ? Math.SQRT1_2 : -Math.SQRT1_2, 0, Math.SQRT1_2];

/** Shortest rotation taking unit vector a onto unit vector b. */
const fromTo = (a, b) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const q = { x: c[0], y: c[1], z: c[2], w: 1 + d };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};

/**
 * The axes rule (§5.5): `T0`, the shortest rotation turning an avatar's resting thumb direction
 * (metacarpal joint to distal joint, T-pose, avatar space) onto the reference direction.
 */
export const thumbRestTurn = (side, resting) => {
  const n = Math.hypot(...resting);
  return fromTo(resting.map((v) => v / n), referenceThumb(side));
};

/**
 * The thumb from its three bytes (§5.5), on the reference hand's axes, left hand; the right hand
 * mirrors. Splay ±127 = ±90°, outward (positive) spread 0.30 : 0.45 : 0.25 over metacarpal,
 * proximal and distal, inward wholly on the metacarpal. Opposition 0…60° toward the palm side
 * plus the same roll about the thumb's own axis. Curl 60° and 80° about Y on the outer joints.
 */
function thumbOnReference(bytes) {
  const s = ((bytes.splay?.[0] ?? 0) / 127) * 90, o = ((bytes.opposition ?? 0) / 255) * 60, c = (bytes.curl?.[0] ?? 0) / 255;
  const [sm, sp, sd] = s > 0 ? [0.3 * s, 0.45 * s, 0.25 * s] : [s, 0, 0];
  return {
    Metacarpal: mul(mul(axisAngle([0, 1, 0], -sm), axisAngle([1, 0, -1], o)), axisAngle([1, 0, 1], -o)),
    Proximal: axisAngle([0, 1, 0], c * 60 - sp),
    Distal: axisAngle([0, 1, 0], c * 80 - sd),
  };
}

/**
 * §5.5 synthesis: the parent-relative rotation of every finger bone from one hand's bytes.
 * `bytes` = { curl:[5], splay:[5], opposition } for Thumb,Index,Middle,Ring,Little.
 * `rest` = the hand's `T0` (axes rule) where the thumb does not rest like the reference; the
 * reference hand's is identity. Returns { boneName: quaternion } for the named side ('left' |
 * 'right'). By the spec text, not by importing the demo.
 */
export function fingerPose(side, bytes, rest = ID) {
  const sign = side === 'left' ? -1 : 1; // curl toward −Y and splay toward the thumb are −Z/−Y left, + right
  const pose = {};
  FINGERS.forEach((finger, k) => {
    const curl = (bytes.curl?.[k + 1] ?? 0) / 255;
    const splay = ((bytes.splay?.[k + 1] ?? 0) / 127) * SPLAY;
    for (const [joint, max] of Object.entries(FLEXION)) {
      // Flexion about Z, splay about Y on the proximal only; q = q_splay · q_curl.
      pose[`${side}${finger}${joint}`] = eulerXYZ(0, joint === 'Proximal' ? sign * splay : 0, sign * curl * max);
    }
  });
  // The axes rule: metacarpal base · T0, outer joints T(before)⁻¹ · q · T(own). Direction only:
  // the outer joints' own turns are identity, so T(before) = T(own) = T0.
  const t = thumbOnReference(bytes), m = side === 'left' ? (q) => q : mirror;
  pose[`${side}ThumbMetacarpal`] = mul(m(t.Metacarpal), rest);
  pose[`${side}ThumbProximal`] = mul(mul(conj(rest), m(t.Proximal)), rest);
  pose[`${side}ThumbDistal`] = mul(mul(conj(rest), m(t.Distal)), rest);
  return pose;
}

/** The rest hand of §5.5: what a frame without finger data shows, and a cleared finger bit's fall-back. */
export const REST_HAND = { curl: [40, 50, 60, 70, 80], splay: [0, 0, 0, 0, 0], opposition: 40 };

/**
 * joints: [{ name, parent, offset:[x,y,z] }], parents before children; the wrist is the root.
 * pose: { boneName: quaternion } parent-relative, identity when absent.
 * Returns { name:[x,y,z] } relative to the wrist.
 */
export function fkHand(joints, pose) {
  const world = {};
  const pos = {};
  for (const j of joints) {
    const local = pose[j.name] ?? ID;
    if (j.parent === null) {
      world[j.name] = local;
      pos[j.name] = [0, 0, 0];
      continue;
    }
    const o = rotate(world[j.parent], j.offset);
    pos[j.name] = pos[j.parent].map((v, k) => v + o[k]);
    world[j.name] = mul(world[j.parent], local);
  }
  return pos;
}
