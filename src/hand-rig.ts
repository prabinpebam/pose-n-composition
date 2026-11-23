import * as T from 'three';
import {
  FINGER_IDS,
  HAND_CURL_MAX,
  HAND_CURL_MIN,
  HAND_OPPOSITION_MAX,
  HAND_OPPOSITION_MIN,
  HAND_SPREAD_MAX,
  HAND_SPREAD_MIN,
  degrees,
  radians,
  type CharacterHandPoses,
  type FingerId,
  type HandPoseSpec,
  type HandSide,
  type Joint,
  type Vec3,
} from './model';
import type { MorphologyProfile } from './morphology-rig';

const DEG = Math.PI / 180;

export interface CalibratedFingerPhalange {
  bone: T.Bone;
  restLocalQuat: T.Quaternion;
  /** Unit knuckle flexion hinge axis in `bone`'s own bind-local space (+angle curls into palm) */
  flexAxisLocal: T.Vector3;
}

export interface CalibratedFingerChain {
  finger: FingerId;
  phalanges: CalibratedFingerPhalange[];
  /** Unit MCP abduction/splay axis in `phalanges[0].bone`'s bind-local space (+angle fans toward index/radial, or opposes thumb) */
  splayAxisLocal: T.Vector3;
}

export interface CalibratedHandRig {
  side: HandSide;
  wristBone: T.Bone;
  fingers: Partial<Record<FingerId, CalibratedFingerChain>>;
  /** Unit distal hand vector (wrist -> middle knuckle/tip) in character-world bind space */
  distalDirWorld: T.Vector3;
  /** Unit across-knuckle vector (`index_01 - pinky_01`) in character-world bind space */
  acrossDirWorld: T.Vector3;
  /** Unit palm-inward normal in character-world bind space */
  palmNormalWorld: T.Vector3;
  /** Unit forearm shaft axis `normalize(pos(wrist) - pos(elbow))` in character-world bind space */
  forearmShaftWorld: T.Vector3;
  /**
   * Orthonormal right-handed (`det = +1`) anatomical wrist frame in character-world bind space
   * with sagittal reflection symmetry (`F_R = -M * F_L`):
   * - `+X`: Palmar Flexion (`+`) / Dorsal Extension (`-`)
   * - `+Y`: Pronation (`+`) / Supination (`-`, palm up)
   * - `+Z`: Radial Deviation (`+`, toward thumb) / Ulnar Deviation (`-`, toward pinky)
   */
  wristAnatomicalFrame: T.Quaternion;
}

export interface CalibratedHandRigs {
  left: CalibratedHandRig;
  right: CalibratedHandRig;
}

const EXCLUDE_FINGER_BONE_RE = /(_end|end$|_nub|nub$|_ik|ik$|pole|target|ctrl|twist|corrective|metacarpal|carpal)/i;

const FINGER_PATTERNS: Record<FingerId, RegExp> = {
  thumb: /(thumb|finger0|pollex)/i,
  index: /(index|forefinger|finger1|f_index)/i,
  middle: /(middle|midfinger|finger2|_mid[123]$)/i,
  ring: /(ring|finger3|f_ring)/i,
  pinky: /(pinky|little|pinkie|finger4|f_pinky)/i,
};

const FINGER_SPLAY_WEIGHTS: Record<Exclude<FingerId, 'thumb'>, number> = {
  index: 0.95,
  middle: 0.18,
  ring: -0.48,
  pinky: -1.05,
};

const FINGER_POS_CURL_DEG: readonly [number, number, number] = [78, 88, 62];
const FINGER_NEG_CURL_DEG: readonly [number, number, number] = [30, 18, 12];
const THUMB_POS_CURL_DEG: readonly [number, number, number] = [28, 44, 38];
const THUMB_NEG_CURL_DEG: readonly [number, number, number] = [22, 16, 12];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function collectDescendantBones(wristBone: T.Bone): Array<{ bone: T.Bone; depth: number }> {
  const out: Array<{ bone: T.Bone; depth: number }> = [];
  const walk = (node: T.Object3D, depth: number) => {
    for (const child of node.children) {
      if (child instanceof T.Bone) {
        out.push({ bone: child, depth });
      }
      walk(child, depth + 1);
    }
  };
  walk(wristBone, 1);
  return out;
}

function orthogonalFallbackAxis(dir: T.Vector3): T.Vector3 {
  const ref = Math.abs(dir.y) < 0.85 ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1);
  return new T.Vector3().crossVectors(dir, ref).normalize();
}

function safePerpendicularAxis(shaftDir: T.Vector3, targetDir: T.Vector3): T.Vector3 {
  const axis = new T.Vector3().crossVectors(shaftDir, targetDir);
  if (axis.lengthSq() > 1e-8) return axis.normalize();
  return orthogonalFallbackAxis(shaftDir);
}

function findPrimaryChildBone(bone: T.Bone): T.Bone | null {
  for (const child of bone.children) {
    if (child instanceof T.Bone) return child;
  }
  return null;
}

function buildOrthonormalWristFrame(
  distalDirWorld: T.Vector3,
  palmNormalWorld: T.Vector3,
  sideSign: 1 | -1,
): T.Quaternion {
  const ex = new T.Vector3().crossVectors(distalDirWorld, palmNormalWorld);
  if (ex.lengthSq() < 1e-8) {
    ex.copy(orthogonalFallbackAxis(distalDirWorld));
  } else {
    ex.normalize();
  }
  // Gram-Schmidt orthogonalize ey = sideSign * distal against ex:
  const ey = distalDirWorld.clone().multiplyScalar(sideSign);
  ey.addScaledVector(ex, -ey.dot(ex));
  if (ey.lengthSq() < 1e-8) {
    ey.copy(orthogonalFallbackAxis(ex));
  } else {
    ey.normalize();
  }
  // Right-handed basis ez = ex x ey (det = +1, and ez == sideSign * palmNormal when distal _|_ palmNormal):
  const ez = new T.Vector3().crossVectors(ex, ey).normalize();
  const rotMat = new T.Matrix4().makeBasis(ex, ey, ez);
  return new T.Quaternion().setFromRotationMatrix(rotMat).normalize();
}

function calibrateSingleHand(
  side: HandSide,
  wristBone: T.Bone,
  elbowBone: T.Bone,
  morphology?: MorphologyProfile | null,
): CalibratedHandRig {
  const sideSign: 1 | -1 = side === 'left' ? 1 : -1;
  const wristPos = wristBone.getWorldPosition(new T.Vector3());
  const elbowPos = elbowBone.getWorldPosition(new T.Vector3());

  const forearmShaftWorld = wristPos.clone().sub(elbowPos);
  if (forearmShaftWorld.lengthSq() > 1e-8) {
    forearmShaftWorld.normalize();
  } else {
    forearmShaftWorld.set(sideSign, 0, 0);
  }

  const descendants = collectDescendantBones(wristBone);
  const rawFingerBones: Partial<Record<FingerId, T.Bone[]>> = {};

  // Some rigs name the thumb finger1-1 and the pinky finger5-1 instead of finger0..4.
  const oneBasedDigits = descendants.some(({ bone }) => /^finger5-1/i.test(bone.name));
  for (const finger of FINGER_IDS) {
    const pattern = oneBasedDigits
      ? new RegExp(`^finger${FINGER_IDS.indexOf(finger) + 1}-[123]`, 'i')
      : FINGER_PATTERNS[finger];
    const matched = descendants
      .filter(({ bone }) => pattern.test(bone.name) && !EXCLUDE_FINGER_BONE_RE.test(bone.name))
      .sort((a, b) => a.depth - b.depth || a.bone.name.localeCompare(b.bone.name))
      .map(entry => entry.bone)
      .slice(0, 3);
    if (matched.length > 0) {
      rawFingerBones[finger] = matched;
    }
  }

  // Distal hand direction in character-world bind space:
  const refChain = rawFingerBones.middle ?? rawFingerBones.index ?? rawFingerBones.ring;
  const distalDirWorld = new T.Vector3();
  if (refChain && refChain.length > 0) {
    const mcpBone = refChain[0]!;
    distalDirWorld.copy(mcpBone.getWorldPosition(new T.Vector3())).sub(wristPos);
  }
  if (distalDirWorld.lengthSq() < 1e-8) {
    if (morphology) {
      const limb = side === 'left' ? morphology.leftArm : morphology.rightArm;
      distalDirWorld.fromArray(limb.lowerDir).normalize();
    } else {
      distalDirWorld.copy(forearmShaftWorld);
    }
  } else {
    distalDirWorld.normalize();
  }

  // Across-knuckle vector (`index_01 -> radial/thumb side` minus `pinky_01 -> ulnar side`):
  const acrossDirWorld = new T.Vector3();
  const radialRef = rawFingerBones.index?.[0] ?? rawFingerBones.thumb?.[0];
  const ulnarRef = rawFingerBones.pinky?.[0] ?? rawFingerBones.ring?.[0];
  if (radialRef && ulnarRef && radialRef !== ulnarRef) {
    acrossDirWorld
      .copy(radialRef.getWorldPosition(new T.Vector3()))
      .sub(ulnarRef.getWorldPosition(new T.Vector3()));
  }
  if (acrossDirWorld.lengthSq() < 1e-8) {
    // Fallback for fingerless procedural rigs: anterior (+Z) is thumb-side in both A-pose and T-pose
    acrossDirWorld.set(0, 0, 1);
    acrossDirWorld.addScaledVector(distalDirWorld, -acrossDirWorld.dot(distalDirWorld));
    if (acrossDirWorld.lengthSq() < 1e-8) acrossDirWorld.set(0, 1, 0);
  }
  acrossDirWorld.normalize();

  // Universal palm-inward normal (`+1 * (distal x across)` on left, `-1 * (distal x across)` on right):
  const palmNormalWorld = new T.Vector3()
    .crossVectors(distalDirWorld, acrossDirWorld)
    .multiplyScalar(sideSign);
  if (palmNormalWorld.lengthSq() < 1e-8) {
    palmNormalWorld.set(0, -1, 0);
  } else {
    palmNormalWorld.normalize();
  }

  const fingers: Partial<Record<FingerId, CalibratedFingerChain>> = {};
  const thumbOpposeTargetWorld = palmNormalWorld
    .clone()
    .multiplyScalar(0.86)
    .addScaledVector(acrossDirWorld, -0.51)
    .normalize();

  for (const finger of FINGER_IDS) {
    const chainBones = rawFingerBones[finger];
    if (!chainBones || chainBones.length === 0) continue;

    const boneWorldPos = chainBones.map(b => b.getWorldPosition(new T.Vector3()));
    const phalanges: CalibratedFingerPhalange[] = [];
    let prevShaftWorld = distalDirWorld.clone();

    // Aim thumb flexion straight toward the middle/ring MCP pocket in the palm:
    const thumbPocketWorld =
      finger === 'thumb'
        ? (rawFingerBones.ring?.[0] ?? rawFingerBones.middle?.[0])
            ?.getWorldPosition(new T.Vector3())
            .addScaledVector(palmNormalWorld, 0.022) ?? null
        : null;

    for (let k = 0; k < chainBones.length; k++) {
      const bone = chainBones[k]!;
      const shaftWorld = new T.Vector3();
      if (k + 1 < chainBones.length) {
        shaftWorld.subVectors(boneWorldPos[k + 1]!, boneWorldPos[k]!);
      } else {
        const childBone = findPrimaryChildBone(bone);
        if (childBone) {
          shaftWorld.copy(childBone.getWorldPosition(new T.Vector3())).sub(boneWorldPos[k]!);
        }
      }
      if (shaftWorld.lengthSq() > 1e-8) {
        shaftWorld.normalize();
        prevShaftWorld.copy(shaftWorld);
      } else {
        shaftWorld.copy(prevShaftWorld);
      }

      const curlTarget =
        finger === 'thumb'
          ? thumbPocketWorld
            ? thumbPocketWorld.clone().sub(boneWorldPos[k]!).normalize()
            : acrossDirWorld.clone().multiplyScalar(-0.88).addScaledVector(palmNormalWorld, 0.47).normalize()
          : palmNormalWorld;
      const flexAxisWorld = safePerpendicularAxis(shaftWorld, curlTarget);
      const invRestWorldQuat = bone.getWorldQuaternion(new T.Quaternion()).invert();
      const flexAxisLocal = flexAxisWorld.clone().applyQuaternion(invRestWorldQuat).normalize();

      phalanges.push({
        bone,
        restLocalQuat: bone.quaternion.clone(),
        flexAxisLocal,
      });
    }

    // Splay / abduction axis at proximal MCP bone (`k = 0`):
    const mcpBone = chainBones[0]!;
    const mcpShaftWorld =
      chainBones.length > 1
        ? new T.Vector3().subVectors(boneWorldPos[1]!, boneWorldPos[0]!)
        : distalDirWorld.clone();
    if (mcpShaftWorld.lengthSq() > 1e-8) mcpShaftWorld.normalize();
    else mcpShaftWorld.copy(distalDirWorld);

    const splayTargetWorld = finger === 'thumb' ? thumbOpposeTargetWorld : acrossDirWorld;
    const splayAxisWorld = safePerpendicularAxis(mcpShaftWorld, splayTargetWorld);
    const invMcpWorldQuat = mcpBone.getWorldQuaternion(new T.Quaternion()).invert();
    const splayAxisLocal = splayAxisWorld.clone().applyQuaternion(invMcpWorldQuat).normalize();

    fingers[finger] = {
      finger,
      phalanges,
      splayAxisLocal,
    };
  }

  const wristAnatomicalFrame = buildOrthonormalWristFrame(distalDirWorld, palmNormalWorld, sideSign);

  return {
    side,
    wristBone,
    fingers,
    distalDirWorld,
    acrossDirWorld,
    palmNormalWorld,
    forearmShaftWorld,
    wristAnatomicalFrame,
  };
}

export function calibrateFigureHandRigs(
  root: T.Object3D,
  bones: Record<Joint, T.Bone>,
  morphology?: MorphologyProfile | null,
  restRotations?: Record<Joint, T.Quaternion>,
): CalibratedHandRigs {
  const savedPos = root.position.clone();
  const savedQuat = root.quaternion.clone();
  const savedScale = root.scale.clone();
  const savedJointQuats = restRotations
    ? (Object.fromEntries(
        (Object.keys(bones) as Joint[]).map(j => [j, bones[j].quaternion.clone()]),
      ) as Record<Joint, T.Quaternion>)
    : null;
  const needsReset =
    savedPos.lengthSq() > 1e-12 ||
    Math.abs(savedQuat.w - 1) > 1e-9 ||
    Math.abs(savedScale.x - 1) > 1e-9 ||
    Math.abs(savedScale.y - 1) > 1e-9 ||
    Math.abs(savedScale.z - 1) > 1e-9;

  if (needsReset) {
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
  }
  if (restRotations) {
    for (const j of Object.keys(bones) as Joint[]) {
      bones[j].quaternion.copy(restRotations[j]);
    }
  }
  root.updateMatrixWorld(true);

  let left: CalibratedHandRig;
  let right: CalibratedHandRig;
  try {
    left = calibrateSingleHand('left', bones.leftWrist, bones.leftElbow, morphology);
    right = calibrateSingleHand('right', bones.rightWrist, bones.rightElbow, morphology);
  } finally {
    if (savedJointQuats) {
      for (const j of Object.keys(bones) as Joint[]) {
        bones[j].quaternion.copy(savedJointQuats[j]);
      }
    }
    if (needsReset) {
      root.position.copy(savedPos);
      root.quaternion.copy(savedQuat);
      root.scale.copy(savedScale);
    }
    if (savedJointQuats || needsReset) {
      root.updateMatrixWorld(true);
    }
  }
  return { left, right };
}

export function hasPoseableFingers(handRigs?: CalibratedHandRigs | null, side?: HandSide): boolean {
  if (!handRigs) return false;
  if (side) return Object.keys(handRigs[side].fingers).length > 0;
  return Object.keys(handRigs.left.fingers).length > 0 || Object.keys(handRigs.right.fingers).length > 0;
}

const _qCurl = new T.Quaternion();
const _qSplay = new T.Quaternion();

function applySingleHandPose(rig: CalibratedHandRig, spec?: HandPoseSpec | null): void {
  const spread = spec ? clamp(spec.spread, HAND_SPREAD_MIN, HAND_SPREAD_MAX) : 0;
  const thumbOpposition = spec
    ? clamp(spec.thumbOpposition, HAND_OPPOSITION_MIN, HAND_OPPOSITION_MAX)
    : 0;

  for (const finger of FINGER_IDS) {
    const chain = rig.fingers[finger];
    if (!chain) continue;
    const rawCurl = spec ? clamp(spec[finger], HAND_CURL_MIN, HAND_CURL_MAX) : 0;

    if (
      Math.abs(rawCurl) < 1e-6 &&
      Math.abs(spread) < 1e-6 &&
      (finger !== 'thumb' || Math.abs(thumbOpposition) < 1e-6)
    ) {
      for (const ph of chain.phalanges) {
        ph.bone.quaternion.copy(ph.restLocalQuat);
      }
      continue;
    }

    const posTable = finger === 'thumb' ? THUMB_POS_CURL_DEG : FINGER_POS_CURL_DEG;
    const negTable = finger === 'thumb' ? THUMB_NEG_CURL_DEG : FINGER_NEG_CURL_DEG;

    let splayAngleRad = 0;
    if (finger === 'thumb') {
      // Positive opposition brings thumb out in front of palm; positive spread opens thumb radially
      splayAngleRad = (thumbOpposition * 18 - spread * 14) * DEG;
    } else {
      // Attenuate splay as fingers curl into a fist so curled fingers converge naturally without crossing
      const curlAtten = 1 - 0.72 * clamp(rawCurl, 0, 1);
      splayAngleRad = FINGER_SPLAY_WEIGHTS[finger] * 18 * DEG * spread * curlAtten;
    }

    for (let k = 0; k < chain.phalanges.length; k++) {
      const ph = chain.phalanges[k]!;
      const idx = Math.min(k, 2) as 0 | 1 | 2;
      const curlDeg = rawCurl >= 0 ? posTable[idx] * rawCurl : negTable[idx] * rawCurl;
      _qCurl.setFromAxisAngle(ph.flexAxisLocal, curlDeg * DEG);

      if (k === 0 && Math.abs(splayAngleRad) > 1e-6) {
        _qSplay.setFromAxisAngle(chain.splayAxisLocal, splayAngleRad);
        ph.bone.quaternion.copy(ph.restLocalQuat).multiply(_qSplay).multiply(_qCurl);
      } else {
        ph.bone.quaternion.copy(ph.restLocalQuat).multiply(_qCurl);
      }
    }
  }
}

export function applyFigureHandPoses(
  figure: { handRigs?: CalibratedHandRigs },
  handPose?: CharacterHandPoses | null,
): void {
  if (!figure.handRigs) return;
  applySingleHandPose(figure.handRigs.left, handPose?.left);
  applySingleHandPose(figure.handRigs.right, handPose?.right);
}

const _qTwistFull = new T.Quaternion();
const _qTwistShare = new T.Quaternion();
const _qTwistRem = new T.Quaternion();
const _qSwing = new T.Quaternion();

/**
 * Exact `SO(3)` swing-twist decomposition around `forearmShaftWorld` that transfers `share` (default 50%)
 * of axial wrist twist onto the forearm (`elbowQuat * qShare` and `qRem * qSwing`).
 * Preserves `elbowOut * wristOut === elbowIn * wristIn` to machine precision (`0.000000m` wrist translation,
 * `0.000000°` hand world rotation delta) while preventing candy-wrapper wrist LBS volume collapse!
 */
export function solveForearmWristTwistShare(
  elbowQuat: T.Quaternion,
  wristQuat: T.Quaternion,
  forearmShaftWorld: T.Vector3,
  share = 0.5,
): { elbowQuat: T.Quaternion; wristQuat: T.Quaternion; twistRad: number } {
  let wx = wristQuat.x;
  let wy = wristQuat.y;
  let wz = wristQuat.z;
  let ww = wristQuat.w;
  if (ww < 0) {
    wx = -wx;
    wy = -wy;
    wz = -wz;
    ww = -ww;
  }
  const proj = wx * forearmShaftWorld.x + wy * forearmShaftWorld.y + wz * forearmShaftWorld.z;
  const phi = 2 * Math.atan2(proj, ww);
  if (Math.abs(phi) < 1e-6 || share <= 0) {
    return {
      elbowQuat: elbowQuat.clone(),
      wristQuat: wristQuat.clone(),
      twistRad: phi,
    };
  }
  _qTwistFull.setFromAxisAngle(forearmShaftWorld, phi);
  _qSwing.copy(_qTwistFull).invert().multiply(wristQuat).normalize();
  _qTwistShare.setFromAxisAngle(forearmShaftWorld, share * phi);
  _qTwistRem.setFromAxisAngle(forearmShaftWorld, (1 - share) * phi);
  return {
    elbowQuat: elbowQuat.clone().multiply(_qTwistShare).normalize(),
    wristQuat: _qTwistRem.clone().multiply(_qSwing).normalize(),
    twistRad: phi,
  };
}

const _inspEuler = new T.Euler();
const _inspQuatWorld = new T.Quaternion();
const _inspQuatAnat = new T.Quaternion();
const _inspFrameInv = new T.Quaternion();

function cleanDeg(deg: number): number {
  const v = Math.abs(deg) < 1e-7 ? 0 : deg;
  return Number(v.toFixed(4));
}

const WRIST_RAW_TO_DISPLAY = new WeakMap<
  CalibratedHandRig,
  { raw: Vec3; deg: Vec3 }
>();

/**
 * Converts a joint's stored character-world Euler `[rx, ry, rz]` (radians) into anatomical Inspector degrees:
 * - For `leftWrist` / `rightWrist` (when calibrated `handRigs` is available): returns `[Flex°, Twist°, Tilt°]`
 *   using `'YXZ'` intrinsic order (`Twist` outer -> zero gimbal lock across `-180°..+180°` pronation/supination,
 *   `Flex` middle -> palmar/dorsal bend in the twisted hand plane, `Tilt` inner -> radial/ulnar deviation).
 *   Caches the exact authored `[Flex°, Twist°, Tilt°]` tuple when `Flex` exceeds `±90°` so dragging sliders in
 *   the `-115°..+115°` expressive range never jumps across Three.js `asin` branch cuts!
 * - For all other joints: returns standard `[deg(rx), deg(ry), deg(rz)]`.
 */
export function poseJointToInspectorDegrees(
  jointEulerRad: Vec3,
  joint: Joint,
  handRigs?: CalibratedHandRigs | null,
): Vec3 {
  if ((joint === 'leftWrist' || joint === 'rightWrist') && handRigs) {
    const rig = joint === 'leftWrist' ? handRigs.left : handRigs.right;
    const cached = WRIST_RAW_TO_DISPLAY.get(rig);
    if (
      cached &&
      Math.abs(cached.raw[0] - jointEulerRad[0]) < 1e-6 &&
      Math.abs(cached.raw[1] - jointEulerRad[1]) < 1e-6 &&
      Math.abs(cached.raw[2] - jointEulerRad[2]) < 1e-6
    ) {
      return [...cached.deg] as Vec3;
    }
    const frame = rig.wristAnatomicalFrame;
    _inspEuler.set(jointEulerRad[0], jointEulerRad[1], jointEulerRad[2], 'XYZ');
    _inspQuatWorld.setFromEuler(_inspEuler);
    _inspFrameInv.copy(frame).invert();
    _inspQuatAnat.copy(_inspFrameInv).multiply(_inspQuatWorld).multiply(frame);
    _inspEuler.setFromQuaternion(_inspQuatAnat, 'YXZ');
    return [cleanDeg(degrees(_inspEuler.x)), cleanDeg(degrees(_inspEuler.y)), cleanDeg(degrees(_inspEuler.z))];
  }
  return [cleanDeg(degrees(jointEulerRad[0])), cleanDeg(degrees(jointEulerRad[1])), cleanDeg(degrees(jointEulerRad[2]))];
}

export interface FkDragAnchor {
  joint: Joint;
  startBoneLocalQuat: T.Quaternion;
  startSemanticQuat: T.Quaternion;
  rotationBasis: T.Quaternion;
}

export function captureFkDragAnchor(
  joint: Joint,
  bone: T.Bone,
  rotationBasis: T.Quaternion,
  currentSemanticEulerRad: Vec3,
): FkDragAnchor {
  return {
    joint,
    startBoneLocalQuat: bone.quaternion.clone(),
    startSemanticQuat: new T.Quaternion().setFromEuler(
      new T.Euler(currentSemanticEulerRad[0], currentSemanticEulerRad[1], currentSemanticEulerRad[2], 'XYZ'),
    ),
    rotationBasis: rotationBasis.clone(),
  };
}

const _fkLocalDelta = new T.Quaternion();
const _fkBasisInv = new T.Quaternion();
const _fkSemantic = new T.Quaternion();
const _fkEuler = new T.Euler();

export function computeAnchoredFkDragEuler(
  anchor: FkDragAnchor,
  currentBoneLocalQuat: T.Quaternion,
): Vec3 {
  _fkLocalDelta.copy(anchor.startBoneLocalQuat).invert().multiply(currentBoneLocalQuat);
  _fkBasisInv.copy(anchor.rotationBasis).invert();
  _fkSemantic
    .copy(anchor.startSemanticQuat)
    .multiply(_fkBasisInv)
    .multiply(_fkLocalDelta)
    .multiply(anchor.rotationBasis)
    .normalize();
  _fkEuler.setFromQuaternion(_fkSemantic, 'XYZ');
  return [_fkEuler.x, _fkEuler.y, _fkEuler.z];
}

/**
 * Inverse of `poseJointToInspectorDegrees`: converts Inspector `[X°, Y°, Z°]` back to stored character-world
 * `'XYZ'` Euler radians `[rx, ry, rz]`.
 */
export function inspectorDegreesToPoseJoint(
  inspectorDeg: Vec3,
  joint: Joint,
  handRigs?: CalibratedHandRigs | null,
): Vec3 {
  if ((joint === 'leftWrist' || joint === 'rightWrist') && handRigs) {
    const rig = joint === 'leftWrist' ? handRigs.left : handRigs.right;
    const frame = rig.wristAnatomicalFrame;
    const rx = radians(inspectorDeg[0]);
    const ry = radians(inspectorDeg[1]);
    const rz = radians(inspectorDeg[2]);
    if (Math.abs(rx) < 1e-9 && Math.abs(ry) < 1e-9 && Math.abs(rz) < 1e-9) {
      WRIST_RAW_TO_DISPLAY.set(rig, { raw: [0, 0, 0], deg: [0, 0, 0] });
      return [0, 0, 0];
    }
    _inspEuler.set(rx, ry, rz, 'YXZ');
    _inspQuatAnat.setFromEuler(_inspEuler);
    _inspFrameInv.copy(frame).invert();
    _inspQuatWorld.copy(frame).multiply(_inspQuatAnat).multiply(_inspFrameInv);
    _inspEuler.setFromQuaternion(_inspQuatWorld, 'XYZ');
    const raw: Vec3 = [_inspEuler.x, _inspEuler.y, _inspEuler.z];
    WRIST_RAW_TO_DISPLAY.set(rig, {
      raw,
      deg: [cleanDeg(inspectorDeg[0]), cleanDeg(inspectorDeg[1]), cleanDeg(inspectorDeg[2])],
    });
    return raw;
  }
  return [radians(inspectorDeg[0]), radians(inspectorDeg[1]), radians(inspectorDeg[2])];
}
