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

// §5.5 maximum flexion angles at curl 255.
const FLEXION = { Proximal: 90, Intermediate: 110, Distal: 70 };
const THUMB_FLEXION = { Proximal: 60, Distal: 80 };
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

/**
 * §5.5 synthesis: the parent-relative rotation of every finger bone from one hand's bytes.
 * `bytes` = { curl:[5], splay:[5], opposition } for Thumb,Index,Middle,Ring,Little.
 * Returns { boneName: quaternion } for the named side ('left' | 'right'). Mirrors the demo's
 * fingerAngles(), by the spec text, not by importing it.
 */
export function fingerPose(side, bytes) {
  const sign = side === 'left' ? -1 : 1; // curl toward −Y and splay toward the thumb are −Z/−Y left, + right
  const pose = {};
  FINGERS.forEach((finger, i) => {
    const curl = (bytes.curl?.[i] ?? 0) / 255;
    const splay = ((bytes.splay?.[i] ?? 0) / 127) * 15;
    const table = finger === 'Thumb' ? THUMB_FLEXION : FLEXION;
    for (const [joint, max] of Object.entries(table)) {
      const y = joint === 'Proximal' ? sign * splay : 0;
      if (finger === 'Thumb') {
        // Thumb flexes about Y (palm plane); splay shares Y in the opposite sense (§5.5).
        pose[`${side}${finger}${joint}`] = eulerXYZ(0, y - sign * curl * max, 0);
      } else {
        // Index … little flex about Z, splay about Y on the proximal only; q = q_splay · q_curl.
        pose[`${side}${finger}${joint}`] = eulerXYZ(0, y, sign * curl * max);
      }
    }
  });
  // Thumb opposition rotates the metacarpal about X, positive on both hands (§5.5).
  pose[`${side}ThumbMetacarpal`] = eulerXYZ(((bytes.opposition ?? 0) / 255) * 60, 0, 0);
  return pose;
}

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
