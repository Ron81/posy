// The performer's full performance as a Posy Frame: body, hands and face of the pose
// from poses.ts. The sender cuts this down to what it declared (declare.ts) before
// encoding.
//
// Nothing moves here on its own account except what a person does without meaning to:
// the eyes blink, and they follow the head when it looks around.
import { VERSION, type Frame } from 'posy';
import { SLOT } from './bones.ts';
import { RELAXED_HANDS, type BodyPose } from './poses.ts';

let seq = 0;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const u8 = (v: number) => Math.round(clamp(v, 0, 1) * 255);
const i8 = (v: number) => Math.round(clamp(v, -1, 1) * 127);

/**
 * Build the frame at time `tSec`. `seq` increments per call; `timestampMs` is the
 * demo clock in ms (kept < 2^32).
 */
export function poseAt(tSec: number, body: BodyPose): Frame {
  const face = body.face ?? {};
  const weights = new Uint8Array(16);

  // Blink: shut for a short window roughly every 4 s, unless the pose holds the lids.
  const natural = tSec % 4 < 0.15 ? 1 : 0;
  const [blinkLeft, blinkRight] = face.blink ?? [natural, natural];
  weights[SLOT.blinkLeft] = u8(blinkLeft);
  weights[SLOT.blinkRight] = u8(blinkRight);

  for (const [name, value] of Object.entries(face.shape ?? {})) weights[SLOT[name as keyof typeof SLOT]] = u8(value);

  // Tongue direction counts only while the tongue is out (§5.6). Slots 14 and 15 are i8.
  const [out, left, up] = face.tongue ?? [0, 0, 0];
  weights[SLOT.tongueOut] = u8(out);
  if (weights[SLOT.tongueOut] > 0) {
    weights[SLOT.tongueX] = i8(left) & 0xff;
    weights[SLOT.tongueY] = i8(up) & 0xff;
  }

  // Gaze: ±45° over the i8 range (§5.6). Without a pose value the eyes lead the slow
  // look-around of the head (same rhythm as `alive` in poses.ts).
  const [yaw, pitch] = face.gaze ?? [8 * Math.sin(tSec * 0.1 * 2 * Math.PI), 0];

  return {
    version: VERSION,
    seq: seq++ & 0xffff,
    timestampMs: Math.floor(tSec * 1000) >>> 0,
    idle: false,
    bones: body.bones,
    root: { x: 0x8000, y: 0x8000, z: 0, h: body.h },
    fingers: body.fingers ?? RELAXED_HANDS,
    expressions: { perfectSync: false, weights, gazeYaw: i8(yaw / 45), gazePitch: i8(pitch / 45) },
  };
}
