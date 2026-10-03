// Wire bytes → Frame (spec §5, Appendix B). Rejects any malformed frame.
import { unpackQuat } from './quat.js';
import type { Frame, HandFingers } from './index.js';
import {
  FLAG_PERFECT_SYNC,
  FLAG_HAS_ROOT,
  FLAG_HAS_FINGERS,
  FLAG_HAS_EXPRESSIONS,
  FLAG_IDLE,
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

export function decode(bytes: Uint8Array): Frame {
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
  const need = 16 + 4 * n + (b1 ? 8 : 0) + (b2 ? 24 : 0) + exprLen;
  if (len !== need) throw new PosyDecodeError(`length ${len} != required ${need}`);

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

  return frame;
}
