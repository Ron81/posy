// The sender's declaration (spec §2.1): it transmits only the data types its tracker
// delivers AND its avatar can show. This module computes that set and cuts a full
// performance frame down to it.
import { FINGER_BIT_HIGH, FINGER_BIT_LOW, type Frame } from 'posy';
import { fromBlock, toFingerBones, type Fingers, type ThumbRest } from './hands.ts';

export type DataType = 'bones' | 'legs' | 'toes' | 'root' | 'fingers' | 'finger_bones' | 'expressions';

/** Rows of the on-screen table, in the order `caps.sends` is written. */
export const FEATURES: Array<{ type: DataType; label: string; short: string }> = [
  { type: 'bones', label: 'Body: spine, head, arms', short: 'Body' },
  { type: 'legs', label: 'Legs and feet', short: 'Legs' },
  { type: 'toes', label: 'Toes', short: 'Toes' },
  { type: 'root', label: 'Position and hips height', short: 'Position' },
  { type: 'fingers', label: 'Fingers, compact block', short: 'Fingers' },
  { type: 'finger_bones', label: 'Fingers, one rotation per joint', short: 'Finger joints' },
  { type: 'expressions', label: 'Face', short: 'Face' },
];

// bone_mask bits per declared type (spec §4).
const BONE_BITS: Record<'bones' | 'legs' | 'toes', number[]> = {
  bones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23, 24],
  legs: [9, 10, 11, 13, 14, 15],
  toes: [12, 16],
};
const isFingerBit = (bit: number) => bit >= FINGER_BIT_LOW && bit <= FINGER_BIT_HIGH;

// A type that cannot be sent without another one (spec §2.1).
const REQUIRES: Partial<Record<DataType, DataType>> = { legs: 'bones', toes: 'legs', finger_bones: 'bones' };

export interface Tracker {
  id: string;
  label: string;
  delivers: DataType[];
  /** Set when the tracker covers only part of the `bones` type. */
  bonesOnly?: { bits: number[]; note: string };
}

export const TRACKERS: Tracker[] = [
  { id: 'full-toes', label: 'Full body + toes', delivers: ['bones', 'legs', 'toes', 'root', 'fingers', 'expressions'] },
  { id: 'full', label: 'Full body', delivers: ['bones', 'legs', 'root', 'fingers', 'expressions'] },
  { id: 'upper', label: 'Upper body', delivers: ['bones', 'root', 'fingers', 'expressions'] },
  { id: 'face', label: 'Face only', delivers: ['bones', 'expressions'], bonesOnly: { bits: [4, 5], note: 'head only' } },
];

/**
 * The tracker as it sends its fingers: through the compact block, or one rotation per
 * joint. The two are never declared together (§2.1).
 */
export const withFingerJoints = (tracker: Tracker, perJoint: boolean): Tracker =>
  perJoint ? { ...tracker, delivers: tracker.delivers.map((t) => (t === 'fingers' ? 'finger_bones' : t)) } : tracker;

/** `caps.sends`: what the tracker delivers, reduced to what the avatar can show. */
export function computeSends(tracker: Tracker, avatar: ReadonlySet<DataType>): DataType[] {
  const sends = new Set(tracker.delivers.filter((t) => avatar.has(t)));
  for (const { type } of FEATURES) {
    const needs = REQUIRES[type];
    if (needs && !sends.has(needs)) sends.delete(type);
  }
  return FEATURES.map((f) => f.type).filter((t) => sends.has(t));
}

/** Which part of the avatar the declaration covers; the receiver camera frames it. */
export function region(tracker: Tracker, sends: ReadonlySet<DataType>): 'full' | 'upper' | 'face' {
  if (sends.has('legs')) return 'full';
  return tracker.bonesOnly ? 'face' : 'upper';
}

/**
 * The frame the sender actually encodes: the full performance cut down to `sends`.
 * `hand` is the performer's hand as block bytes; a `finger_bones` sender transmits the
 * joints of the performance if it has any, otherwise the joints those bytes give on its
 * avatar (`rest`: the avatar's thumb rest, §5.5).
 */
export function crop(frame: Frame, tracker: Tracker, sends: ReadonlySet<DataType>, hand: Fingers, rest: ThumbRest): Frame {
  const allowed = new Set<number>();
  if (sends.has('bones')) for (const b of tracker.bonesOnly?.bits ?? BONE_BITS.bones) allowed.add(b);
  if (sends.has('legs')) for (const b of BONE_BITS.legs) allowed.add(b);
  if (sends.has('toes')) for (const b of BONE_BITS.toes) allowed.add(b);

  const out: Frame = {
    version: frame.version,
    seq: frame.seq,
    timestampMs: frame.timestampMs,
    bones: new Map([...frame.bones].filter(([bit]) => allowed.has(bit))),
  };
  if (frame.root && sends.has('root')) {
    // Without legs the hips height carries no information: send "standing" (§8.5).
    out.root = { ...frame.root, h: sends.has('legs') ? frame.root.h : 0x8000 };
  }
  if (sends.has('fingers')) out.fingers = hand;
  if (sends.has('finger_bones')) {
    const own = [...frame.bones].filter(([bit]) => isFingerBit(bit));
    for (const [bit, q] of own.length > 0 ? own : toFingerBones(fromBlock(hand, rest))) out.bones.set(bit, q);
  }
  if (frame.expressions && sends.has('expressions')) out.expressions = frame.expressions;
  return out;
}

/**
 * A declaration of extras (spec §2.6): the avatar's own names, in the order of the block,
 * and the session time from which it applies.
 */
export interface ExtraDecl {
  bones: string[];
  values: string[];
  since: number;
}

export const NO_EXTRAS: ExtraDecl = { bones: [], values: [], since: 0 };

/**
 * The declaration a frame follows: the newest one whose `since` is not after the frame's
 * timestamp. `decls` is ordered oldest first. The frame carries no identifier (§5.8).
 */
export function declAt(decls: readonly ExtraDecl[], timestampMs: number): ExtraDecl {
  for (let i = decls.length - 1; i >= 0; i--) if (timestampMs >= decls[i].since) return decls[i];
  return NO_EXTRAS;
}
