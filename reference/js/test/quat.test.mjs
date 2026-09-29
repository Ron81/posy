import test from 'node:test';
import assert from 'node:assert/strict';
import { packQuat, unpackQuat } from '../dist/index.js';

// Small seeded PRNG (mulberry32) so the property test is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnitQuat(rnd) {
  // Marsaglia: uniform on the 3-sphere.
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
}

function angleBetween(a, b) {
  // smallest angle between two unit quaternions (accounting for double cover)
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dot));
}

test('Appendix A anchors pack exactly', () => {
  const cases = [
    [{ x: 0, y: 0, z: 0, w: 1 }, 0xe0080200],
    [{ x: 0, y: 0, z: 0, w: -1 }, 0xe0080200],
    [{ x: 1, y: 0, z: 0, w: 0 }, 0x20080200],
    [{ x: 0, y: 0.70710678, z: 0, w: 0.70710678 }, 0x600803ff],
    [{ x: 0.5, y: 0.5, z: 0.5, w: 0.5 }, 0x369da769],
    [{ x: 0.5, y: -0.5, z: 0.5, w: -0.5 }, 0x096da496],
  ];
  for (const [q, u] of cases) assert.equal(packQuat(q) >>> 0, u >>> 0);
});

test('q and -q pack to the same u32', () => {
  const rnd = mulberry32(12345);
  for (let i = 0; i < 200; i++) {
    const q = randomUnitQuat(rnd);
    const neg = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    assert.equal(packQuat(q) >>> 0, packQuat(neg) >>> 0);
  }
});

test('round-trip angular error stays well under a degree', () => {
  const rnd = mulberry32(987654);
  // The identity/tie case sits at ~0.14 deg. A general quaternion can reach ~0.25 deg
  // (measured over 2M samples) because reconstructing the dropped component amplifies
  // error when that component is small. 0.3 deg is a safe ceiling, still an order of
  // magnitude below tracker noise.
  const limit = (0.3 * Math.PI) / 180;
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const q = randomUnitQuat(rnd);
    const r = unpackQuat(packQuat(q));
    const err = angleBetween(q, r);
    worst = Math.max(worst, err);
    assert.ok(err <= limit, `error ${(err * 180) / Math.PI}deg exceeds 0.3deg`);
  }
  assert.ok(worst > 0); // sanity: we actually measured something
});

test('identity round-trips to ~0.14 degrees, not exact', () => {
  const r = unpackQuat(packQuat({ x: 0, y: 0, z: 0, w: 1 }));
  const err = (angleBetween({ x: 0, y: 0, z: 0, w: 1 }, r) * 180) / Math.PI;
  assert.ok(err > 0.13 && err < 0.15, `identity error ${err}deg`);
});

test('degenerate input (zero / non-finite) encodes as identity', () => {
  const idU32 = packQuat({ x: 0, y: 0, z: 0, w: 1 });
  assert.equal(packQuat({ x: 0, y: 0, z: 0, w: 0 }) >>> 0, idU32 >>> 0);
  assert.equal(packQuat({ x: NaN, y: 0, z: 0, w: 1 }) >>> 0, idU32 >>> 0);
});
