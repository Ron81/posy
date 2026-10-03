// The performer's full performance as a Posy Frame: the whole-body pose from poses.ts
// plus finger curl, a periodic blink and an occasional tongue. The sender cuts this
// down to what it declared (declare.ts) before encoding.
import type { Frame } from 'posy';
import { BLINK_LEFT_INDEX, BLINK_RIGHT_INDEX, TONGUE_OUT_INDEX, TONGUE_X_INDEX } from './bones.ts';
import type { BodyPose } from './poses.ts';

let seq = 0;

/**
 * Build the frame at time `tSec`. `seq` increments per call; `timestampMs` is the
 * demo clock in ms (kept < 2^32). Finger curl rides a slow wave; blink is a short
 * pulse a few times a minute.
 */
export function poseAt(tSec: number, body: BodyPose): Frame {
  // Fingers: curl oscillates 0..255 together (thumb..little), gentle splay.
  const curlWave = Math.round(((Math.sin(tSec * 2) + 1) / 2) * 255);
  const curl: [number, number, number, number, number] = [
    curlWave, curlWave, curlWave, curlWave, curlWave,
  ];
  const splay: [number, number, number, number, number] = [-20, -10, 0, 10, 20];
  const hand = () => ({ curl: [...curl] as typeof curl, splay: [...splay] as typeof splay, thumbOpposition: 128 });

  // Blink: full-shut for a short window roughly every 4 s.
  const blinkPhase = tSec % 4;
  const blink = blinkPhase < 0.15 ? 255 : 0;
  const weights = new Uint8Array(16);
  weights[BLINK_LEFT_INDEX] = blink;
  weights[BLINK_RIGHT_INDEX] = blink;

  // Tongue: out for a second every 6 s, drifting side to side (slot 14 is i8, §5.6).
  if (tSec % 6 < 1) {
    weights[TONGUE_OUT_INDEX] = 255;
    weights[TONGUE_X_INDEX] = Math.round(Math.sin(tSec * 6) * 100) & 0xff;
  }

  return {
    version: 1,
    seq: seq++ & 0xffff,
    timestampMs: Math.floor(tSec * 1000) >>> 0,
    idle: false,
    bones: body.bones,
    root: { x: 0x8000, y: 0x8000, z: 0, h: body.h },
    fingers: { left: hand(), right: hand() },
    expressions: { perfectSync: false, weights, gazeYaw: 0, gazePitch: 0 },
  };
}
