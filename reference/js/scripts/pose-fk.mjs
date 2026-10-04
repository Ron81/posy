// Forward kinematics for the pose vectors (spec §3.1, §3.4). Used by the generator and by
// test/poses.test.mjs. Plain quaternion math, no dependency on the codec.

/** Hamilton product a*b: b is applied first, then a. */
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

/**
 * joints: [{ name, parent, offset: [x, y, z] }], parents listed before children.
 * pose: { boneName: quaternion }, parent-relative, identity when absent (§3.3).
 * Returns { name: [x, y, z] } relative to the root joint.
 */
export function fk(joints, pose) {
  return fkWorld(joints, pose).pos;
}

/** As fk, and also each joint's avatar-space rotation: { pos, world }. */
export function fkWorld(joints, pose) {
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
    pos[j.name] = pos[j.parent].map((v, i) => v + o[i]);
    world[j.name] = mul(world[j.parent], local);
  }
  return { pos, world };
}

/**
 * Hips height above the floor by the lowest-contact method of spec Appendix D, metres.
 * clear: { foot, toes } T-pose clearances of those joints, and shin, the shin radius.
 */
export function estimateHipsHeight(joints, pose, clear) {
  const { pos, world } = fkWorld(joints, pose);
  let height = 0;
  for (const j of joints) {
    let k;
    if (j.name.endsWith('Foot')) k = rotate(world[j.name], [0, 1, 0])[1] < 0 ? clear.shin : clear.foot;
    else if (j.name.endsWith('Toes')) k = clear.toes;
    else if (j.name.endsWith('LowerLeg')) k = clear.shin;
    else continue;
    height = Math.max(height, k - pos[j.name][1]);
  }
  return height;
}
