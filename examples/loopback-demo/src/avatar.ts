// Avatars that a decoded Posy Frame can drive. Two implementations share one
// interface so the rest of the app never cares which is on screen:
//   - StickFigure: built from primitives, always available, zero assets. It has a part
//     for every data type on the wire, so each one can be seen without loading a model.
//   - VrmAvatar:   wraps a user-loaded .vrm via @pixiv/three-vrm.
//
// Each avatar reports which data types it can show (`caps`). The sender declares only
// those (spec §2.1), so a part the avatar lacks is never transmitted.
//
// Both smooth incoming rotations by slerping the *rendered* bone toward the
// decoded target every tick, so a low send rate or a jittery channel still looks
// continuous rather than steppy.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Frame } from 'posy';
import { BIT, SLOT } from './bones.ts';
import type { DataType } from './declare.ts';

export interface Avatar {
  readonly object: THREE.Object3D;
  /** Data types this avatar can show. */
  readonly caps: ReadonlySet<DataType>;
  /** Top of the head above the floor in metres, for camera framing. */
  readonly height: number;
  /** Move rendered bones a fraction toward the decoded pose. */
  applyPose(frame: Frame, smoothing: number): void;
  update(deltaSec: number): void;
  dispose(): void;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const DEG = Math.PI / 180;

/** Hips height as a fraction of standing (§5.4). No root block → standing. */
const hipsRatio = (frame: Frame): number => (frame.root?.h ?? 0x8000) / 0x8000;

function frameQuat(frame: Frame, bit: number, out: THREE.Quaternion): boolean {
  const q = frame.bones.get(bit);
  if (!q) return false;
  out.set(q.x, q.y, q.z, q.w);
  return true;
}

// Bone bit → three-vrm humanoid bone name, for the bones the animator drives.
const VRM_BONE: Array<[number, VRMHumanBoneName]> = [
  [BIT.spine, VRMHumanBoneName.Spine],
  [BIT.chest, VRMHumanBoneName.Chest],
  [BIT.neck, VRMHumanBoneName.Neck],
  [BIT.head, VRMHumanBoneName.Head],
  [BIT.leftShoulder, VRMHumanBoneName.LeftShoulder],
  [BIT.leftUpperArm, VRMHumanBoneName.LeftUpperArm],
  [BIT.leftLowerArm, VRMHumanBoneName.LeftLowerArm],
  [BIT.leftHand, VRMHumanBoneName.LeftHand],
  [BIT.rightShoulder, VRMHumanBoneName.RightShoulder],
  [BIT.rightUpperArm, VRMHumanBoneName.RightUpperArm],
  [BIT.rightLowerArm, VRMHumanBoneName.RightLowerArm],
  [BIT.rightHand, VRMHumanBoneName.RightHand],
  [BIT.leftUpperLeg, VRMHumanBoneName.LeftUpperLeg],
  [BIT.leftLowerLeg, VRMHumanBoneName.LeftLowerLeg],
  [BIT.leftFoot, VRMHumanBoneName.LeftFoot],
  [BIT.leftToes, VRMHumanBoneName.LeftToes],
  [BIT.rightUpperLeg, VRMHumanBoneName.RightUpperLeg],
  [BIT.rightLowerLeg, VRMHumanBoneName.RightLowerLeg],
  [BIT.rightFoot, VRMHumanBoneName.RightFoot],
  [BIT.rightToes, VRMHumanBoneName.RightToes],
];

// ---------------------------------------------------------------------------
// What a receiver works out from the blocks, for either avatar
// ---------------------------------------------------------------------------

// Finger joints a receiver synthesises from the finger block, with the flexion in degrees
// at curl 255 (§5.5). Order of FINGERS is the order of the block.
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
const FLEXION = { Proximal: 90, Intermediate: 110, Distal: 70 };
const THUMB_FLEXION = { Proximal: 60, Distal: 80 };

/**
 * §5.5: the rotations of the 30 finger bones. `set` gets the VRM humanoid bone name and
 * Euler XYZ angles in degrees, in avatar space; with x = 0 that is Ry · Rz, splay outside
 * curl, as §5.5 orders them. No finger block → fingers extended.
 */
function fingerAngles(frame: Frame, set: (bone: string, x: number, y: number, z: number) => void): void {
  for (const side of ['left', 'right'] as const) {
    const hand = frame.fingers?.[side];
    // Toward −Y (curl) and toward the thumb (splay) is −Z / −Y on the left hand, + on the right.
    const sign = side === 'left' ? -1 : 1;
    FINGERS.forEach((finger, i) => {
      const curl = (hand?.curl[i] ?? 0) / 255;
      const splay = ((hand?.splay[i] ?? 0) / 127) * 15;
      for (const [joint, max] of Object.entries(finger === 'Thumb' ? THUMB_FLEXION : FLEXION)) {
        const y = joint === 'Proximal' ? sign * splay : 0;
        // The thumb lies in the palm plane, so it flexes about Y, toward the fingers.
        if (finger === 'Thumb') set(`${side}${finger}${joint}`, 0, y - sign * curl * max, 0);
        else set(`${side}${finger}${joint}`, 0, y, sign * curl * max);
      }
    });
    set(`${side}ThumbMetacarpal`, ((hand?.thumbOpposition ?? 0) / 255) * 60, 0, 0);
  }
}

/** A Standard-Sync slot as 0 … 1 (§5.6). No expression block → 0. */
const slot = (frame: Frame, index: number): number => (frame.expressions?.weights[index] ?? 0) / 255;

/** Tongue as [out 0 … 1, left −1 … 1, up −1 … 1]. Direction counts only while it is out (§5.6). */
function tongue(frame: Frame): [number, number, number] {
  const w = frame.expressions?.weights;
  if (!w || w[SLOT.tongueOut] === 0) return [0, 0, 0];
  const i8 = (v: number) => Math.max(-127, v > 127 ? v - 256 : v) / 127;
  return [w[SLOT.tongueOut] / 255, i8(w[SLOT.tongueX]), i8(w[SLOT.tongueY])];
}

/** Gaze in degrees, [left, up] (§5.6: ±127 is ±45°). */
const gaze = (frame: Frame): [number, number] => [
  ((frame.expressions?.gazeYaw ?? 0) / 127) * 45,
  ((frame.expressions?.gazePitch ?? 0) / 127) * 45,
];

// ---------------------------------------------------------------------------
// Stick figure
// ---------------------------------------------------------------------------

/** A jointed humanoid made of boxes and spheres. Bones map bit → pivot group. */
export class StickFigure implements Avatar {
  readonly object = new THREE.Group();
  readonly caps: ReadonlySet<DataType> = new Set<DataType>(['bones', 'legs', 'toes', 'root', 'fingers', 'expressions', 'tongue']);
  readonly height = 1.75;
  private static readonly HIP_HEIGHT = 0.9;
  private readonly hips = new THREE.Group();
  private readonly pivots = new Map<number, THREE.Object3D>();
  private readonly rest = new Map<number, THREE.Quaternion>();
  /** Finger joints by VRM humanoid bone name. */
  private readonly fingers = new Map<string, THREE.Object3D>();
  private readonly eyes: THREE.Object3D[] = []; // left, right: scaled shut by the lids
  private readonly pupils: THREE.Object3D[] = [];
  private readonly mouth: THREE.Object3D;
  private readonly tongue = new THREE.Group();

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8ab4f8, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0d9c0, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222 });

    const bone = (len: number, r = 0.05) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
      m.position.y = len / 2; // grow upward from the pivot
      return m;
    };
    const pivot = (bit: number, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      this.pivots.set(bit, g);
      this.rest.set(bit, g.quaternion.clone());
      return g;
    };

    // Torso up the spine.
    const hips = this.hips;
    hips.position.y = StickFigure.HIP_HEIGHT;
    this.object.add(hips);

    const spine = pivot(BIT.spine, hips, 0, 0, 0);
    spine.add(bone(0.28));
    const chest = pivot(BIT.chest, spine, 0, 0.28, 0);
    chest.add(bone(0.22));
    const neck = pivot(BIT.neck, chest, 0, 0.22, 0);
    neck.add(bone(0.08, 0.035));
    const head = pivot(BIT.head, neck, 0, 0.08, 0);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 24), skin);
    headMesh.position.y = 0.13;
    head.add(headMesh);

    // Face, on the front (+Z) of the head sphere. +X is the avatar's left.
    const white = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 });
    for (const side of [1, -1]) {
      const eye = new THREE.Group();
      eye.position.set(0.048 * side, 0.155, 0.114);
      eye.rotation.y = 0.38 * side; // face outward along the sphere, not straight ahead
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.027, 16, 12), white);
      ball.scale.z = 0.45;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), dark);
      pupil.position.z = 0.011;
      pupil.scale.z = 0.5;
      eye.add(ball, pupil);
      head.add(eye);
      this.eyes.push(eye);
      this.pupils.push(pupil);
    }
    this.mouth = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x4a1f1f }));
    this.mouth.position.set(0, 0.078, 0.1215);
    this.mouth.rotation.x = 0.4; // lie on the sphere below its middle
    this.mouth.scale.set(0.034, 0.004, 1); // shut, until the first frame says otherwise
    head.add(this.mouth);
    const tongueMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.009, 0.055),
      new THREE.MeshStandardMaterial({ color: 0xe46a7a, roughness: 0.5 }),
    );
    tongueMesh.position.z = 0.0275; // grows forward out of the mouth
    this.tongue.add(tongueMesh);
    this.tongue.position.set(0, 0.074, 0.118);
    this.tongue.scale.z = 0.001;
    this.tongue.visible = false;
    head.add(this.tongue);

    // Arms. Shoulder pivots hang off the chest; +X is the avatar's left.
    const arm = (shoulderBit: number, upperBit: number, lowerBit: number, handBit: number, side: number) => {
      const sh = pivot(shoulderBit, chest, 0.02 * side, 0.2, 0);
      const upper = pivot(upperBit, sh, 0.16 * side, 0, 0);
      const upperMesh = bone(0.26, 0.045);
      upperMesh.rotation.z = side * Math.PI / 2; // lay the capsule along ∓X
      upperMesh.position.set(0.13 * side, 0, 0);
      upper.add(upperMesh);
      const lower = pivot(lowerBit, upper, 0.26 * side, 0, 0);
      const lowerMesh = bone(0.24, 0.04);
      lowerMesh.rotation.z = side * Math.PI / 2;
      lowerMesh.position.set(0.12 * side, 0, 0);
      lower.add(lowerMesh);
      this.buildHand(pivot(handBit, lower, 0.26 * side, 0, 0), side, skin);
    };
    arm(BIT.leftShoulder, BIT.leftUpperArm, BIT.leftLowerArm, BIT.leftHand, 1);
    arm(BIT.rightShoulder, BIT.rightUpperArm, BIT.rightLowerArm, BIT.rightHand, -1);

    // Legs hang off the hips: 0.05 + 0.40 + 0.37 + 0.08 (ankle) = the 0.9 m hip height.
    const boneDown = (len: number, r: number) => {
      const m = bone(len, r);
      m.position.y = -len / 2;
      return m;
    };
    const leg = (upperBit: number, lowerBit: number, footBit: number, toesBit: number, side: number) => {
      const upper = pivot(upperBit, hips, 0.09 * side, -0.05, 0);
      upper.add(boneDown(0.4, 0.055));
      const lower = pivot(lowerBit, upper, 0, -0.4, 0);
      lower.add(boneDown(0.37, 0.045));
      const foot = pivot(footBit, lower, 0, -0.37, 0);
      // Heel to the ball of the foot; sole 0.08 below the ankle, toes toward +Z.
      const footMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.15), mat);
      footMesh.position.set(0, -0.05, 0.025);
      foot.add(footMesh);
      // The toes are one piece per foot: that is what the wire carries (bits 12 and 16).
      const toes = pivot(toesBit, foot, 0, -0.06, 0.1);
      const toesMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.07), skin);
      toesMesh.position.z = 0.035;
      toes.add(toesMesh);
    };
    leg(BIT.leftUpperLeg, BIT.leftLowerLeg, BIT.leftFoot, BIT.leftToes, 1);
    leg(BIT.rightUpperLeg, BIT.rightLowerLeg, BIT.rightFoot, BIT.rightToes, -1);
  }

  // A hand in the T-pose as VRM has it: palm down, fingers along the arm (±X), the thumb
  // in the plane of the palm pointing forward and outward. Every joint rests at identity,
  // like the bones of a normalized rig, so §5.5 applies to it unchanged.
  private buildHand(wrist: THREE.Object3D, side: number, skin: THREE.Material): void {
    const name = side > 0 ? 'left' : 'right';
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.022, 0.08), skin);
    palm.position.x = 0.0425 * side;
    wrist.add(palm);

    /** A chain of joints from `at` (in the wrist's frame), each segment along (dx, 0, dz). */
    const chain = (finger: string, joints: string[], at: [number, number, number], lens: number[], dx: number, dz: number, thick: number) => {
      let parent = wrist;
      joints.forEach((joint, i) => {
        const g = new THREE.Group();
        g.position.set(...at);
        parent.add(g);
        this.fingers.set(`${name}${finger}${joint}`, g);
        const m = new THREE.Mesh(new THREE.BoxGeometry(lens[i] - 0.003, thick, thick), skin);
        m.position.set((dx * lens[i]) / 2, 0, (dz * lens[i]) / 2);
        m.rotation.y = -Math.atan2(dz, dx); // long side of the box along the segment
        g.add(m);
        parent = g;
        at = [dx * lens[i], 0, dz * lens[i]];
      });
    };
    const three = ['Proximal', 'Intermediate', 'Distal'];
    const finger = (which: string, z: number, scale: number) =>
      chain(which, three, [0.085 * side, 0, z], [0.04 * scale, 0.026 * scale, 0.02 * scale], side, 0, 0.015);
    finger('Index', 0.03, 0.95); // the index finger is on the thumb side, +Z
    finger('Middle', 0.01, 1);
    finger('Ring', -0.01, 0.95);
    finger('Little', -0.03, 0.78);
    chain('Thumb', ['Metacarpal', 'Proximal', 'Distal'], [0.015 * side, 0, 0.036], [0.032, 0.03, 0.025], side * Math.SQRT1_2, Math.SQRT1_2, 0.018);
  }

  applyPose(frame: Frame, smoothing: number): void {
    const ease = (now: number, target: number) => now + (target - now) * smoothing;

    for (const [bit, pivotNode] of this.pivots) {
      const rest = this.rest.get(bit)!;
      if (frameQuat(frame, bit, _q)) {
        // Target = rest * decoded, so the animator's rotations are relative to
        // the figure's neutral pose.
        _q.premultiply(rest);
      } else {
        _q.copy(rest);
      }
      pivotNode.quaternion.slerp(_q, smoothing);
    }
    // Hips height: `h` scales this figure's own standing hip height (§8.5).
    this.hips.position.y = ease(this.hips.position.y, StickFigure.HIP_HEIGHT * hipsRatio(frame));

    fingerAngles(frame, (bone, x, y, z) => {
      this.fingers.get(bone)?.quaternion.slerp(_q.setFromEuler(_e.set(x * DEG, y * DEG, z * DEG)), smoothing);
    });

    // Lids squash the eye; gaze moves the pupil on it (left and up positive).
    const [yaw, pitch] = gaze(frame);
    [SLOT.blinkLeft, SLOT.blinkRight].forEach((lid, i) => {
      this.eyes[i].scale.y = ease(this.eyes[i].scale.y, 1 - 0.92 * slot(frame, lid));
      this.pupils[i].position.x = ease(this.pupils[i].position.x, 0.014 * Math.sin(yaw * DEG));
      this.pupils[i].position.y = ease(this.pupils[i].position.y, 0.014 * Math.sin(pitch * DEG));
    });

    // Mouth: the vowels and surprise open it; a smile and the spread vowels widen it,
    // the rounded ones narrow it.
    const s = (name: keyof typeof SLOT) => slot(frame, SLOT[name]);
    const open = Math.max(s('aa'), 0.8 * s('oh'), 0.55 * s('ou'), 0.35 * s('ih'), 0.3 * s('ee'), 0.7 * s('surprised'));
    const wide = 1 + 0.55 * s('happy') + 0.4 * s('ee') + 0.2 * s('ih') - 0.5 * s('ou') - 0.3 * s('oh');
    this.mouth.scale.x = ease(this.mouth.scale.x, 0.034 * wide);
    this.mouth.scale.y = ease(this.mouth.scale.y, 0.004 + 0.034 * open);

    // Tongue: length is protrusion; it swings toward the avatar's left and upward.
    const [out, left, up] = tongue(frame);
    this.tongue.scale.z = ease(this.tongue.scale.z, Math.max(out, 0.001));
    this.tongue.visible = this.tongue.scale.z > 0.03;
    this.tongue.rotation.y = ease(this.tongue.rotation.y, left * 38 * DEG);
    this.tongue.rotation.x = ease(this.tongue.rotation.x, -up * 38 * DEG);
  }

  update(): void {
    /* nothing time-based to advance */
  }

  dispose(): void {
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
  }
}

// ---------------------------------------------------------------------------
// VRM
// ---------------------------------------------------------------------------

// Standard-Sync slots that are VRM 1.0 expression presets of the same name.
const VRM_EXPRESSIONS = ['aa', 'ih', 'ou', 'ee', 'oh', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral'] as const;

export class VrmAvatar implements Avatar {
  readonly object: THREE.Object3D;
  readonly caps: ReadonlySet<DataType>;
  readonly height: number;
  private readonly rest = new Map<VRMHumanBoneName, THREE.Quaternion>();
  private readonly hips: THREE.Object3D | null;
  private readonly hipsRestY: number;
  /** The model has one lid expression per eye; otherwise only the common `blink`. */
  private readonly lids: boolean;
  /**
   * Standard-Sync slot name → the model's expression of that name, compared without case.
   * VRM 0.x has no `surprised` preset; models that have one carry it as a custom
   * "Surprised".
   */
  private readonly expressions = new Map<string, string>();
  // A VRM 0.x model faces −Z, and three-vrm leaves its normalized rig in that space. The
  // model is turned half a turn about Y to face +Z (§3.2); a rotation given in avatar
  // space (§3.1) then has its X and Z components negated in the rig's space.
  private readonly xz: 1 | -1;

  private constructor(private readonly vrm: VRM) {
    this.xz = vrm.meta.metaVersion === '0' ? -1 : 1;
    VRMUtils.rotateVRM0(vrm); // no effect on a VRM 1.0 model
    this.object = vrm.scene;
    const node = (name: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(name);

    // What this model can show. Legs are required VRM bones; toes, fingers, expressions
    // and a tongue expression are optional and differ from model to model.
    const caps = new Set<DataType>(['bones', 'legs', 'root']);
    if (node(VRMHumanBoneName.LeftToes) && node(VRMHumanBoneName.RightToes)) caps.add('toes');
    if (node(VRMHumanBoneName.LeftIndexProximal)) caps.add('fingers');
    const em = vrm.expressionManager;
    if (em) {
      caps.add('expressions');
      if (em.getExpression('tongueOut')) caps.add('tongue');
    }
    this.caps = caps;
    this.lids = !!em?.getExpression('blinkLeft') && !!em.getExpression('blinkRight');
    for (const e of em?.expressions ?? []) {
      const slot = VRM_EXPRESSIONS.find((name) => name.toLowerCase() === e.expressionName.toLowerCase());
      if (slot && !this.expressions.has(slot)) this.expressions.set(slot, e.expressionName);
    }

    vrm.scene.updateMatrixWorld(true);
    this.height = (node(VRMHumanBoneName.Head)?.getWorldPosition(_v).y ?? 1.4) + 0.2;
    // The model stands on Y = 0 in its T-pose, so the rest height of the hips is its
    // standing hip height (§5.4).
    this.hips = node(VRMHumanBoneName.Hips);
    this.hipsRestY = this.hips?.position.y ?? 0;
    // Record each driven bone's rest rotation once.
    for (const [, name] of VRM_BONE) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) this.rest.set(name, node.quaternion.clone());
    }
  }

  static async load(buffer: ArrayBuffer): Promise<VrmAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(buffer, '');
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('file is not a VRM');
    return new VrmAvatar(vrm);
  }

  applyPose(frame: Frame, smoothing: number): void {
    for (const [bit, name] of VRM_BONE) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      const rest = this.rest.get(name)!;
      if (frameQuat(frame, bit, _q)) _q.set(this.xz * _q.x, _q.y, this.xz * _q.z, _q.w).premultiply(rest);
      else _q.copy(rest);
      node.quaternion.slerp(_q, smoothing);
    }
    if (this.hips) {
      const hipsY = this.hipsRestY * hipsRatio(frame);
      this.hips.position.y += (hipsY - this.hips.position.y) * smoothing;
    }
    // §5.5. Normalized finger bones rest at identity, so the angles are set directly.
    if (this.caps.has('fingers')) {
      fingerAngles(frame, (bone, x, y, z) => {
        const node = this.vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
        node?.quaternion.slerp(_q.setFromEuler(_e.set(this.xz * x * DEG, y * DEG, this.xz * z * DEG)), smoothing);
      });
    }
    this.applyFace(frame, smoothing);
  }

  // §5.6. Tongue direction has no VRM expression, so only protrusion is shown, and only
  // on a model that brings a `tongueOut` expression.
  private applyFace(frame: Frame, smoothing: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    const ease = (name: string, target: number) => {
      const now = em.getValue(name) ?? 0;
      em.setValue(name, now + (target - now) * smoothing);
    };
    const left = slot(frame, SLOT.blinkLeft);
    const right = slot(frame, SLOT.blinkRight);
    if (this.lids) {
      ease('blinkLeft', left);
      ease('blinkRight', right);
    } else {
      ease('blink', Math.max(left, right));
    }
    for (const [name, own] of this.expressions) ease(own, slot(frame, SLOT[name as (typeof VRM_EXPRESSIONS)[number]]));
    if (this.caps.has('tongue')) ease('tongueOut', tongue(frame)[0]);

    // three-vrm takes gaze in degrees: yaw positive to the avatar's left as in §5.6, but
    // pitch positive downward, the opposite of §5.6.
    const lookAt = this.vrm.lookAt;
    if (lookAt) {
      const [yaw, pitch] = gaze(frame);
      lookAt.yaw += (yaw - lookAt.yaw) * smoothing;
      lookAt.pitch += (-pitch - lookAt.pitch) * smoothing;
    }
  }

  update(deltaSec: number): void {
    this.vrm.update(deltaSec);
  }

  dispose(): void {
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
  }
}
