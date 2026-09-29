// Smallest-three quaternion packing (spec §5.3).

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Spec §5.3 constants — used verbatim, not Math.SQRT1_2.
const C = 0.70710678;
const SCALE = 1.41421356;

function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

function clamp10(e: number): number {
  return e < 0 ? 0 : e > 1023 ? 1023 : e;
}

/** Pack a quaternion into a u32 (smallest-three). */
export function packQuat(q: Quat): number {
  let { x, y, z, w } = q;

  // Normalise; degenerate (zero-length / non-finite) → identity.
  let len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (!Number.isFinite(len) || len === 0) {
    x = 0;
    y = 0;
    z = 0;
    w = 1;
    len = 1;
  }
  x /= len;
  y /= len;
  z /= len;
  w /= len;

  const c = [x, y, z, w];

  // Largest magnitude wins; ties → lowest index (E5).
  let i = 0;
  let best = Math.abs(c[0]);
  for (let k = 1; k < 4; k++) {
    const m = Math.abs(c[k]);
    if (m > best) {
      best = m;
      i = k;
    }
  }

  // Dropped component always ≥ 0.
  if (c[i] < 0) {
    c[0] = -c[0];
    c[1] = -c[1];
    c[2] = -c[2];
    c[3] = -c[3];
  }

  // Remaining three in ascending original index order.
  const enc: number[] = [];
  for (let k = 0; k < 4; k++) {
    if (k === i) continue;
    enc.push(clamp10(roundHalfUp(((c[k] + C) / SCALE) * 1023)));
  }

  // Pack: [i:2][a:10][b:10][c:10]. >>> 0 keeps it unsigned.
  return (((i << 30) | (enc[0] << 20) | (enc[1] << 10) | enc[2]) >>> 0);
}

/** Unpack a u32 back into a (renormalised) quaternion. */
export function unpackQuat(u32: number): Quat {
  const w = u32 >>> 0;
  const i = w >>> 30;
  const v = [
    ((w >>> 20) & 0x3ff) / 1023 * SCALE - C,
    ((w >>> 10) & 0x3ff) / 1023 * SCALE - C,
    (w & 0x3ff) / 1023 * SCALE - C,
  ];
  const s = 1 - v[0] * v[0] - v[1] * v[1] - v[2] * v[2];
  const dropped = Math.sqrt(s > 0 ? s : 0);

  const c: number[] = [];
  let j = 0;
  for (let k = 0; k < 4; k++) c.push(k === i ? dropped : v[j++]);

  // MUST renormalise (§5.3 receiver step 3).
  let len = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2] + c[3] * c[3]);
  if (len === 0) len = 1;
  return { x: c[0] / len, y: c[1] / len, z: c[2] / len, w: c[3] / len };
}
