// Avatars that a decoded Posy Frame can drive. Two implementations share one
// interface so the rest of the app never cares which is on screen:
//   - StickFigure: built from three primitives, always available, zero assets.
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
import { unpackQuat, type Frame } from 'posy';
import { BIT, BLINK_LEFT_INDEX, BLINK_RIGHT_INDEX, TONGUE_OUT_INDEX } from './bones.ts';
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

// Finger joints a receiver synthesises from the finger block, with the flexion in degrees
// at curl 255 (§5.5). Order of FINGERS is the order of the block.
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
const FLEXION = { Proximal: 90, Intermediate: 110, Distal: 70 };
const THUMB_FLEXION = { Proximal: 60, Distal: 80 };
const DEG = Math.PI / 180;
const _e = new THREE.Euler();

function blinkWeight(frame: Frame): number {
  const w = frame.expressions?.weights;
  if (!w) return 0;
  return Math.max(w[BLINK_LEFT_INDEX] ?? 0, w[BLINK_RIGHT_INDEX] ?? 0) / 255;
}

// ---------------------------------------------------------------------------
// Stick figure
// ---------------------------------------------------------------------------

/** A jointed humanoid made of boxes and spheres. Bones map bit → pivot group. */
export class StickFigure implements Avatar {
  readonly object = new THREE.Group();
  // No toes, no fingers, no tongue: the figure has nothing to show them with.
  readonly caps: ReadonlySet<DataType> = new Set<DataType>(['bones', 'legs', 'root', 'expressions']);
  readonly height = 1.75;
  private static readonly HIP_HEIGHT = 0.9;
  private readonly hips = new THREE.Group();
  private readonly pivots = new Map<number, THREE.Object3D>();
  private readonly rest = new Map<number, THREE.Quaternion>();
  private leftEye!: THREE.Object3D;
  private rightEye!: THREE.Object3D;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8ab4f8, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0d9c0, roughness: 0.7 });

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
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), skin);
    headMesh.position.y = 0.13;
    head.add(headMesh);

    const eyeGeo = new THREE.SphereGeometry(0.022, 8, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    this.leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    this.rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    this.leftEye.position.set(0.05, 0.15, 0.11);
    this.rightEye.position.set(-0.05, 0.15, 0.11);
    head.add(this.leftEye, this.rightEye);

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
      const handG = pivot(handBit, lower, 0.24 * side, 0, 0);
      const handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.04), skin);
      handMesh.position.x = 0.05 * side;
      handG.add(handMesh);
    };
    arm(BIT.leftShoulder, BIT.leftUpperArm, BIT.leftLowerArm, BIT.leftHand, 1);
    arm(BIT.rightShoulder, BIT.rightUpperArm, BIT.rightLowerArm, BIT.rightHand, -1);

    // Legs hang off the hips: 0.05 + 0.40 + 0.37 + 0.08 (ankle) = the 0.9 m hip height.
    const boneDown = (len: number, r: number) => {
      const m = bone(len, r);
      m.position.y = -len / 2;
      return m;
    };
    const leg = (upperBit: number, lowerBit: number, footBit: number, side: number) => {
      const upper = pivot(upperBit, hips, 0.09 * side, -0.05, 0);
      upper.add(boneDown(0.4, 0.055));
      const lower = pivot(lowerBit, upper, 0, -0.4, 0);
      lower.add(boneDown(0.37, 0.045));
      const foot = pivot(footBit, lower, 0, -0.37, 0);
      const footMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.22), mat);
      footMesh.position.set(0, -0.05, 0.06); // sole 0.08 below the ankle, toes toward +Z
      foot.add(footMesh);
    };
    leg(BIT.leftUpperLeg, BIT.leftLowerLeg, BIT.leftFoot, 1);
    leg(BIT.rightUpperLeg, BIT.rightLowerLeg, BIT.rightFoot, -1);
  }

  applyPose(frame: Frame, smoothing: number): void {
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
    const hipsY = StickFigure.HIP_HEIGHT * hipsRatio(frame);
    this.hips.position.y += (hipsY - this.hips.position.y) * smoothing;
    // Blink → squash the eyes vertically.
    const openY = 1 - 0.9 * blinkWeight(frame);
    this.leftEye.scale.y += (openY - this.leftEye.scale.y) * smoothing;
    this.rightEye.scale.y = this.leftEye.scale.y;
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

export class VrmAvatar implements Avatar {
  readonly object: THREE.Object3D;
  readonly caps: ReadonlySet<DataType>;
  readonly height: number;
  private readonly rest = new Map<VRMHumanBoneName, THREE.Quaternion>();
  private readonly hips: THREE.Object3D | null;
  private readonly hipsRestY: number;
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
    if (vrm.expressionManager) {
      caps.add('expressions');
      if (vrm.expressionManager.getExpression('tongueOut')) caps.add('tongue');
    }
    this.caps = caps;

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
    if (this.caps.has('fingers')) this.applyFingers(frame, smoothing);
    const em = this.vrm.expressionManager;
    if (em) {
      const cur = em.getValue('blink') ?? 0;
      const target = blinkWeight(frame);
      em.setValue('blink', cur + (target - cur) * smoothing);
      if (this.caps.has('tongue')) {
        em.setValue('tongueOut', (frame.expressions?.weights[TONGUE_OUT_INDEX] ?? 0) / 255);
      }
    }
  }

  // §5.5. Normalized finger bones rest at identity with their axes on the avatar's, so
  // the block's angles are set directly. No finger block → fingers extended.
  private applyFingers(frame: Frame, smoothing: number): void {
    const turn = (bone: string, x: number, y: number, z: number) => {
      const node = this.vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
      // Euler XYZ with x = 0 is Ry · Rz: splay outside curl, as §5.5 orders them.
      node?.quaternion.slerp(_q.setFromEuler(_e.set(this.xz * x * DEG, y * DEG, this.xz * z * DEG)), smoothing);
    };
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
          if (finger === 'Thumb') turn(`${side}${finger}${joint}`, 0, y - sign * curl * max, 0);
          else turn(`${side}${finger}${joint}`, 0, y, sign * curl * max);
        }
      });
      turn(`${side}ThumbMetacarpal`, ((hand?.thumbOpposition ?? 0) / 255) * 60, 0, 0);
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
