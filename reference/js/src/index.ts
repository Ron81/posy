// Public API for the Posy reference codec (spec §5).
// If this code ever disagrees with the spec, the spec wins.

export type { Quat } from './quat.js';
export { packQuat, unpackQuat } from './quat.js';
export { encode, PosyEncodeError } from './encode.js';
export { decode, PosyDecodeError } from './decode.js';
export { BONE_NAMES, BLENDSHAPE_NAMES, STANDARD_SYNC_NAMES, FINGER_BLOCK_FIELDS, ERROR_CODES } from './tables.generated.js';

import type { Quat } from './quat.js';

export interface HandFingers {
  /** thumb, index, middle, ring, little */
  curl: [number, number, number, number, number];
  splay: [number, number, number, number, number];
  thumbOpposition: number;
}

/** The `version` byte this release writes: the minor revision of the spec (§9). */
export const VERSION = 2;

export interface Frame {
  /** Senders write `VERSION`. Any value 0–15 decodes (§9). */
  version: number;
  seq: number;
  timestampMs: number;
  idle: boolean;
  /** key = bit index; encoded in ascending bit order */
  bones: Map<number, Quat>;
  /** x, y: u16 playspace-normalised; z: i16 depth in mm; h: u16 hips height, 32768 = standing (§5.4) */
  root?: { x: number; y: number; z: number; h: number };
  fingers?: { left: HandFingers; right: HandFingers };
  expressions?: {
    perfectSync: boolean;
    /**
     * 16 slots (Standard-Sync) or 52 (Perfect-Sync), raw bytes 0..255.
     * Standard-Sync slots 14 and 15 (tongueX, tongueY) are i8 on the wire (§5.6):
     * read with `(b << 24) >> 24`, write with `v & 0xff`.
     */
    weights: Uint8Array;
    gazeYaw: number;
    gazePitch: number;
  };
}

// Flag bits (§5.2).
export const FLAG_PERFECT_SYNC = 1 << 0;
export const FLAG_HAS_ROOT = 1 << 1;
export const FLAG_HAS_FINGERS = 1 << 2;
export const FLAG_HAS_EXPRESSIONS = 1 << 3;
export const FLAG_IDLE = 1 << 4;

/** Lowest / highest finger bone bit — MUST be 0 in v1 (§4). */
export const FINGER_BIT_LOW = 25;
export const FINGER_BIT_HIGH = 54;
