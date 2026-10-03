// Frame → wire bytes (spec §5). Little-endian throughout.
import { packQuat } from './quat.js';
import type { Frame } from './index.js';
import {
  FLAG_PERFECT_SYNC,
  FLAG_HAS_ROOT,
  FLAG_HAS_FINGERS,
  FLAG_HAS_EXPRESSIONS,
  FLAG_IDLE,
  FINGER_BIT_LOW,
  FINGER_BIT_HIGH,
} from './index.js';

export class PosyEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PosyEncodeError';
  }
}

const MAX_FRAME = 1100;

function u16(n: number, field: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new PosyEncodeError(`${field} out of u16 range: ${n}`);
  return n;
}
function u32(n: number, field: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new PosyEncodeError(`${field} out of u32 range: ${n}`);
  return n;
}
function u8(n: number, field: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new PosyEncodeError(`${field} out of u8 range: ${n}`);
  return n;
}
function i8(n: number, field: string): number {
  if (!Number.isInteger(n) || n < -128 || n > 127) throw new PosyEncodeError(`${field} out of i8 range: ${n}`);
  return n & 0xff;
}
function i16(n: number, field: string): number {
  if (!Number.isInteger(n) || n < -32768 || n > 32767) throw new PosyEncodeError(`${field} out of i16 range: ${n}`);
  return n & 0xffff;
}

export function encode(frame: Frame): Uint8Array {
  const bits = [...frame.bones.keys()].sort((a, b) => a - b);
  let mask = 0n;
  for (const bit of bits) {
    if (!Number.isInteger(bit) || bit < 0 || bit > 63) throw new PosyEncodeError(`bone bit out of range: ${bit}`);
    if (bit >= FINGER_BIT_LOW && bit <= FINGER_BIT_HIGH) {
      throw new PosyEncodeError(`finger bone bit ${bit} MUST NOT be set in v1 (use the finger block)`);
    }
    mask |= 1n << BigInt(bit);
  }

  let flags = 0;
  if (frame.idle) flags |= FLAG_IDLE;
  if (frame.root) flags |= FLAG_HAS_ROOT;
  if (frame.fingers) flags |= FLAG_HAS_FINGERS;
  if (frame.expressions) {
    flags |= FLAG_HAS_EXPRESSIONS;
    if (frame.expressions.perfectSync) flags |= FLAG_PERFECT_SYNC;
  }

  // PERFECT_SYNC is only meaningful with HAS_EXPRESSIONS.
  const exprLen = frame.expressions ? (frame.expressions.perfectSync ? 54 : 18) : 0;
  if (frame.expressions) {
    const want = frame.expressions.perfectSync ? 52 : 16;
    if (frame.expressions.weights.length !== want) {
      throw new PosyEncodeError(`expression weights length ${frame.expressions.weights.length}, expected ${want}`);
    }
  }

  const total = 16 + 4 * bits.length + (frame.root ? 8 : 0) + (frame.fingers ? 24 : 0) + exprLen;
  if (total > MAX_FRAME) throw new PosyEncodeError(`frame ${total} B exceeds ${MAX_FRAME} B limit`);

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, u8(frame.version, 'version'));
  dv.setUint8(1, flags);
  dv.setUint16(2, u16(frame.seq, 'seq'), true);
  dv.setUint32(4, u32(frame.timestampMs, 'timestampMs'), true);
  dv.setBigUint64(8, mask, true);

  let off = 16;
  for (const bit of bits) {
    dv.setUint32(off, packQuat(frame.bones.get(bit)!), true);
    off += 4;
  }

  if (frame.root) {
    dv.setUint16(off, u16(frame.root.x, 'root.x'), true);
    dv.setUint16(off + 2, u16(frame.root.y, 'root.y'), true);
    dv.setUint16(off + 4, i16(frame.root.z, 'root.z'), true);
    dv.setUint16(off + 6, u16(frame.root.h, 'root.h'), true);
    off += 8;
  }

  if (frame.fingers) {
    for (const hand of [frame.fingers.left, frame.fingers.right]) {
      // thumb, index, middle, ring, little: curl (u8) + splay (i8) interleaved
      for (let f = 0; f < 5; f++) {
        buf[off++] = u8(hand.curl[f], `curl[${f}]`);
        buf[off++] = i8(hand.splay[f], `splay[${f}]`);
      }
      buf[off++] = u8(hand.thumbOpposition, 'thumbOpposition');
      buf[off++] = 0; // reserved MUST be 0
    }
  }

  if (frame.expressions) {
    for (const wgt of frame.expressions.weights) buf[off++] = u8(wgt, 'weight');
    buf[off++] = i8(frame.expressions.gazeYaw, 'gazeYaw');
    buf[off++] = i8(frame.expressions.gazePitch, 'gazePitch');
  }

  return buf;
}
