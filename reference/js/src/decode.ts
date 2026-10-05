// Wire bytes → Frame (spec §5, Appendix B). Rejects any malformed frame.
import { unpackQuat } from './quat.js';
import type { ExtraCounts, Frame, HandFingers } from './index.js';
import {
  FLAG_PERFECT_SYNC,
  FLAG_HAS_ROOT,
  FLAG_HAS_FINGERS,
  FLAG_HAS_EXPRESSIONS,
  FLAG_IDLE,
  FLAG_HAS_EXTRA,
} from './index.js';

export class PosyDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PosyDecodeError';
  }
}

function popcount64(v: bigint): number {
  let n = 0;
  while (v) {
    v &= v - 1n;
    n++;
  }
  return n;
}

/** `timestamp_ms` of a frame, to pick the declaration that applies to it (§2.6). */
export function timestampOf(bytes: Uint8Array): number {
  if (bytes.length < 16) throw new PosyDecodeError(`length ${bytes.length} < 16`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(4, true);
}

/**
 * `extra` is the pair of list lengths of the declaration that applies at the frame's
 * timestamp. Without it the extras block of a frame cannot be sized: it is skipped and
 * the rest of the frame is returned (§2.6).
 */
export function decode(bytes: Uint8Array, extra?: ExtraCounts): Frame {
  const len = bytes.length;
  if (len < 16) throw new PosyDecodeError(`length ${len} < 16`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, len);

  const version = dv.getUint8(0);
  if (version >> 4 !== 0) throw new PosyDecodeError(`unsupported major version (byte 0x${version.toString(16)})`);
  const flags = dv.getUint8(1);
  const seq = dv.getUint16(2, true);
  const timestampMs = dv.getUint32(4, true);
  const mask = dv.getBigUint64(8, true);

  const b0 = (flags & FLAG_PERFECT_SYNC) !== 0;
  const b1 = (flags & FLAG_HAS_ROOT) !== 0;
  const b2 = (flags & FLAG_HAS_FINGERS) !== 0;
  const b3 = (flags & FLAG_HAS_EXPRESSIONS) !== 0;

  const n = popcount64(mask);
  const exprLen = b3 ? (b0 ? 54 : 18) : 0;
  const b5 = (flags & FLAG_HAS_EXTRA) !== 0;
  const fixed = 16 + 4 * n + (b1 ? 8 : 0) + (b2 ? 24 : 0) + exprLen;
  if (b5 && !extra) {
    // No declaration for this frame: everything after the known blocks is the extras block.
    if (len <= fixed) throw new PosyDecodeError(`length ${len}: HAS_EXTRA set but no extras block`);
  } else {
    const need = fixed + (b5 ? 4 * extra!.bones + extra!.values : 0);
    if (len !== need) throw new PosyDecodeError(`length ${len} != required ${need}`);
  }

  // Consume a quaternion for every set bit, including reserved/unknown ones (§9),
  // so downstream offsets stay aligned. Unknown bones are still stored by bit.
  const bones = new Map<number, ReturnType<typeof unpackQuat>>();
  let off = 16;
  for (let bit = 0; bit < 64; bit++) {
    if (mask & (1n << BigInt(bit))) {
      bones.set(bit, unpackQuat(dv.getUint32(off, true)));
      off += 4;
    }
  }

  const frame: Frame = {
    version,
    seq,
    timestampMs,
    idle: (flags & FLAG_IDLE) !== 0,
    bones,
  };

  if (b1) {
    frame.root = {
      x: dv.getUint16(off, true),
      y: dv.getUint16(off + 2, true),
      z: dv.getInt16(off + 4, true),
      h: dv.getUint16(off + 6, true),
    };
    off += 8;
  }

  if (b2) {
    const readHand = (): HandFingers => {
      const curl: number[] = [];
      const splay: number[] = [];
      for (let f = 0; f < 5; f++) {
        curl.push(dv.getUint8(off++));
        splay.push(dv.getInt8(off++));
      }
      const thumbOpposition = dv.getUint8(off++);
      off++; // reserved byte
      return {
        curl: curl as [number, number, number, number, number],
        splay: splay as [number, number, number, number, number],
        thumbOpposition,
      };
    };
    const left = readHand();
    const right = readHand();
    frame.fingers = { left, right };
  }

  if (b3) {
    const m = b0 ? 52 : 16;
    const weights = new Uint8Array(m);
    for (let k = 0; k < m; k++) weights[k] = dv.getUint8(off++);
    const gazeYaw = dv.getInt8(off++);
    const gazePitch = dv.getInt8(off++);
    frame.expressions = { perfectSync: b0, weights, gazeYaw, gazePitch };
  }

  if (b5 && extra) {
    const extraBones = [];
    for (let k = 0; k < extra.bones; k++) {
      extraBones.push(unpackQuat(dv.getUint32(off, true)));
      off += 4;
    }
    frame.extra = { bones: extraBones, values: bytes.slice(off, off + extra.values) };
  }

  return frame;
}
