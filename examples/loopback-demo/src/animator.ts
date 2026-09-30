// The "sender": a purely procedural performance. Given a time, it builds a Posy
// Frame with sine-wave head/arm motion, finger curl and a periodic blink. This is
// the ground truth we encode and ship down the lossy channel.
import * as THREE from 'three';
import type { Frame, Quat } from 'posy';
import { BIT, BLINK_LEFT_INDEX, BLINK_RIGHT_INDEX } from './bones.ts';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** Euler (radians, XYZ) → Posy Quat. */
function quat(x: number, y: number, z: number): Quat {
  _euler.set(x, y, z, 'XYZ');
  _quat.setFromEuler(_euler);
  return { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w };
}

let seq = 0;

/**
 * Build the pose at time `tSec`. `seq` increments per call; `timestampMs` is the
 * demo clock in ms (kept < 2^32). Finger curl rides a slow wave; blink is a short
 * pulse a few times a minute.
 */
export function poseAt(tSec: number): Frame {
  const bones = new Map<number, Quat>();

  // Head: gentle look-around (yaw) + nod (pitch).
  bones.set(BIT.head, quat(Math.sin(tSec * 0.8) * 0.25, Math.sin(tSec * 0.6) * 0.4, 0));
  bones.set(BIT.neck, quat(Math.sin(tSec * 0.8) * 0.08, Math.sin(tSec * 0.6) * 0.12, 0));

  // Spine sway so the whole torso feels alive.
  bones.set(BIT.spine, quat(0, 0, Math.sin(tSec * 0.5) * 0.06));

  // Arms wave. Upper arms swing out/in on Z, lower arms bend on X, mirrored L/R.
  const upper = Math.sin(tSec * 1.3);
  const lower = (Math.sin(tSec * 1.7) + 1) / 2; // 0..1, always a forward bend
  bones.set(BIT.leftUpperArm, quat(0, 0, -0.5 + upper * 0.6));
  bones.set(BIT.rightUpperArm, quat(0, 0, 0.5 - upper * 0.6));
  bones.set(BIT.leftLowerArm, quat(0, -lower * 1.2, 0));
  bones.set(BIT.rightLowerArm, quat(0, lower * 1.2, 0));

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

  return {
    version: 1,
    seq: seq++ & 0xffff,
    timestampMs: Math.floor(tSec * 1000) >>> 0,
    idle: false,
    bones,
    root: { x: 0x8000, y: 0x8000, z: 0 },
    fingers: { left: hand(), right: hand() },
    expressions: { perfectSync: false, weights, gazeYaw: 0, gazePitch: 0 },
  };
}
