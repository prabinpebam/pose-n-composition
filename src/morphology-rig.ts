import * as T from 'three';
import { clone, JOINTS, neutralPose, type Joint, type Pose, type Vec3 } from './model';
import type { Figure } from './rig';
import type { PoseLimitMode } from './skinDeformer';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Canonical lean reference arm slope in character space: atan2(0.12, 1) ≈ 6.843°. */
export const CANONICAL_ARM_SLOPE_X = 0.12;
export const CANONICAL_ARM_ABDUCTION_RAD = Math.atan2(CANONICAL_ARM_SLOPE_X, 1);

export interface LimbRestMetrics {
  upperDir: Vec3;
  lowerDir: Vec3;
  upperLength: number;
  lowerLength: number;
  /** Orthonormal bind segment frame in character space (-Y along upper bone shaft). */
  upperBindFrame: T.Quaternion;
  /** Orthonormal bind segment frame in character space (-Y along lower bone shaft). */
  lowerBindFrame: T.Quaternion;
  abductionFromDownRad: number;
  forwardPitchRad: number;
  hingeBendRad: number;
}

export interface SoftTissueEnvelope {
  height: number;
  torsoHalfWidth: number;
  waistHalfWidth: number;
  hipHalfWidth: number;
  bellyFrontZ: number;
  backZ: number;
  pelvisCenterX: number;
  hipsY: number;
  spineY: number;
  chestY: number;
  shoulderOffsetX: number;
  hipOffsetX: number;
  upperArmRadius: number;
  forearmRadius: number;
  thighMedialRadius: number;
  thighLateralRadius: number;
  dorsalSpineFraction: number;
  /** Normalized [0, 1] heavy/adipose index (0 = lean/ectomorph, 1 = very heavy endomorph). */
  adiposityIndex: number;
}

export interface MorphologyProfile {
  /** True when bind rest already matches canonical lean mannequin rest (no rest-frame retargeting needed). */
  isCanonicalMannequin: boolean;
  /** When true, Neutral ([0,0,0]) preserves exact bind posture, while non-neutral poses still retarget cleanly. */
  preserveAuthoredNeutral?: boolean;
  leftArm: LimbRestMetrics;
  rightArm: LimbRestMetrics;
  leftLeg: LimbRestMetrics;
  rightLeg: LimbRestMetrics;
  jointBindPositions: Record<Joint, Vec3>;
  bindTorsoPitchRad: number;
  bindNeckPitchRad: number;
  envelope: SoftTissueEnvelope;
  /** Minimum lateral arm abduction from vertical (rad) so medial upper arm clears lateral torso fat/muscle. */
  naturalArmAbductionRad: number;
  /** Gentle resting elbow flexion (rad) when wide hips exceed shoulder + resting arm clearance. */
  naturalElbowBendRad: number;
  /** Minimum standing thigh splay from vertical (rad) so medial inner thighs clear midline. */
  naturalThighSplayRad: number;
}

export interface MorphologyMeasureOptions {
  isCanonicalMannequin?: boolean;
  preserveAuthoredNeutral?: boolean;
}

export interface MorphologyAdaptOptions {
  limitMode?: PoseLimitMode;
  /** Disable soft-tissue envelope clearance while retaining rest-pose character-space retargeting. */
  disableEnvelopeClearance?: boolean;
}

const PARENT_JOINT: Partial<Record<Joint, Joint>> = {
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  leftShoulder: 'chest',
  leftElbow: 'leftShoulder',
  leftWrist: 'leftElbow',
  rightShoulder: 'chest',
  rightElbow: 'rightShoulder',
  rightWrist: 'rightElbow',
  leftHip: 'hips',
  leftKnee: 'leftHip',
  leftAnkle: 'leftKnee',
  rightHip: 'hips',
  rightKnee: 'rightHip',
  rightAnkle: 'rightKnee',
};

const DOWN = new T.Vector3(0, -1, 0);

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (Math.abs(edge1 - edge0) < 1e-9) return x >= edge1 ? 1 : 0;
  const t = T.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smooth C1 maximum: smoothly floors `value` at `floor` with transition half-width `knee`. */
export function softFloor(value: number, floor: number, knee = 6 * DEG): number {
  const diff = value - floor;
  if (diff >= knee) return value;
  if (diff <= -knee) return floor;
  const t = (diff + knee) / (2 * knee);
  return floor + knee * t * t;
}

function swingQuaternion(fromDir: T.Vector3, toDir: T.Vector3): T.Quaternion {
  const a = fromDir.clone().normalize();
  const b = toDir.clone().normalize();
  const dot = a.dot(b);
  if (dot < -0.999999) {
    // 180-deg flip: rotate around character Z (coronal abduction plane)
    const fallbackAxis = Math.abs(a.z) < 0.9 ? new T.Vector3(0, 0, 1) : new T.Vector3(1, 0, 0);
    const axis = new T.Vector3().crossVectors(a, fallbackAxis).normalize();
    return new T.Quaternion().setFromAxisAngle(axis, Math.PI);
  }
  return new T.Quaternion().setFromUnitVectors(a, b);
}

function measureLimbMetrics(
  upperStart: T.Vector3,
  jointMid: T.Vector3,
  lowerEnd: T.Vector3,
  sideSign: 1 | -1,
): LimbRestMetrics {
  const upperVec = jointMid.clone().sub(upperStart);
  const lowerVec = lowerEnd.clone().sub(jointMid);
  const upperLength = Math.max(upperVec.length(), 1e-4);
  const lowerLength = Math.max(lowerVec.length(), 1e-4);
  const uDir = upperVec.clone().divideScalar(upperLength);
  const lDir = lowerVec.clone().divideScalar(lowerLength);

  // Construct minimal-twist anatomical frames in character space (-Y along bone shaft):
  const upperBindFrame = swingQuaternion(DOWN, uDir);
  const lowerBindFrame = swingQuaternion(uDir, lDir).multiply(upperBindFrame);

  const abductionFromDownRad = Math.atan2(sideSign * uDir.x, Math.max(-uDir.y, 1e-6));
  const forwardPitchRad = Math.asin(T.MathUtils.clamp(uDir.z, -1, 1));
  const hingeBendRad = Math.acos(T.MathUtils.clamp(uDir.dot(lDir), -1, 1));

  return {
    upperDir: [uDir.x, uDir.y, uDir.z],
    lowerDir: [lDir.x, lDir.y, lDir.z],
    upperLength,
    lowerLength,
    upperBindFrame,
    lowerBindFrame,
    abductionFromDownRad,
    forwardPitchRad,
    hingeBendRad,
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = T.MathUtils.clamp(p * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo]! : sorted[lo]! * (1 - (idx - lo)) + sorted[hi]! * (idx - lo);
}

function pointToSegmentRadial(p: T.Vector3, a: T.Vector3, b: T.Vector3): { dist: number; t: number } {
  const ab = b.clone().sub(a);
  const lenSq = Math.max(ab.lengthSq(), 1e-10);
  const t = T.MathUtils.clamp(p.clone().sub(a).dot(ab) / lenSq, 0, 1);
  const closest = a.clone().addScaledVector(ab, t);
  return { dist: p.distanceTo(closest), t };
}

function classifyBoneDescendants(bones: T.Bone[], figureBones: Record<Joint, T.Bone>): {
  armBoneIndices: Set<number>;
  forearmBoneIndices: Set<number>;
  legBoneIndices: Set<number>;
  leftLegBoneIndices: Set<number>;
  rightLegBoneIndices: Set<number>;
  torsoBoneIndices: Set<number>;
} {
  const indexByBone = new Map<T.Bone, number>();
  bones.forEach((b, i) => indexByBone.set(b, i));

  const collectSubtree = (roots: T.Bone[]): Set<number> => {
    const out = new Set<number>();
    const visit = (obj: T.Object3D) => {
      if (obj instanceof T.Bone) {
        const idx = indexByBone.get(obj);
        if (idx !== undefined) out.add(idx);
      }
      for (const ch of obj.children) visit(ch);
    };
    roots.forEach(visit);
    return out;
  };

  const armBoneIndices = collectSubtree([figureBones.leftShoulder, figureBones.rightShoulder]);
  const forearmBoneIndices = collectSubtree([figureBones.leftElbow, figureBones.rightElbow]);
  const leftLegBoneIndices = collectSubtree([figureBones.leftHip]);
  const rightLegBoneIndices = collectSubtree([figureBones.rightHip]);
  const legBoneIndices = new Set<number>([...leftLegBoneIndices, ...rightLegBoneIndices]);
  const torsoBoneIndices = new Set<number>();
  bones.forEach((_, idx) => {
    if (!armBoneIndices.has(idx) && !legBoneIndices.has(idx)) torsoBoneIndices.add(idx);
  });
  return {
    armBoneIndices,
    forearmBoneIndices,
    legBoneIndices,
    leftLegBoneIndices,
    rightLegBoneIndices,
    torsoBoneIndices,
  };
}

/**
 * Measures a Figure's bind-pose limb frames and 3D skinned-mesh soft-tissue envelope in character space.
 * Assumes `figure.bones` are currently in their bind/rest pose (or temporarily evaluates them in character space).
 */
export function measureFigureMorphology(
  figure: Figure,
  options: MorphologyMeasureOptions = {},
): MorphologyProfile {
  const { root, bones, skin } = figure;
  const savedPos = root.position.clone();
  const savedQuat = root.quaternion.clone();
  const savedScale = root.scale.clone();
  const savedBoneQuats = Object.fromEntries(
    JOINTS.map(j => [j, bones[j].quaternion.clone()]),
  ) as Record<Joint, T.Quaternion>;

  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);
  for (const j of JOINTS) {
    if (figure.restRotations[j]) bones[j].quaternion.copy(figure.restRotations[j]);
  }
  root.updateMatrixWorld(true);
  skin.skeleton.update();

  try {
    const jp = Object.fromEntries(
      JOINTS.map(j => {
        const v = bones[j].getWorldPosition(new T.Vector3());
        return [j, v] as const;
      }),
    ) as Record<Joint, T.Vector3>;

    const jointBindPositions = Object.fromEntries(
      JOINTS.map(j => [j, [jp[j].x, jp[j].y, jp[j].z] as Vec3]),
    ) as Record<Joint, Vec3>;

    const leftArm = measureLimbMetrics(jp.leftShoulder, jp.leftElbow, jp.leftWrist, 1);
    const rightArm = measureLimbMetrics(jp.rightShoulder, jp.rightElbow, jp.rightWrist, -1);
    const leftLeg = measureLimbMetrics(jp.leftHip, jp.leftKnee, jp.leftAnkle, 1);
    const rightLeg = measureLimbMetrics(jp.rightHip, jp.rightKnee, jp.rightAnkle, -1);

    const torsoVec = jp.chest.clone().sub(jp.hips);
    const neckVec = jp.head.clone().sub(jp.neck);
    const bindTorsoPitchRad = Math.atan2(torsoVec.z, Math.max(torsoVec.y, 1e-4));
    const bindNeckPitchRad = Math.atan2(neckVec.z, Math.max(neckVec.y, 1e-4));

    // Sample all body & garment skin meshes in world bind space (using getVertexPosition so FBX
    // centimeter-buffered glTFs with 0.01 inverseBindMatrices measure in exact world meters!).
    const NON_BODY_RE = /hair|scalp|brow|lash|eye|cornea|tear|teeth|tongue|beard/i;
    const candidateSkins = (figure.skins?.length ? figure.skins : [skin]).filter(m => {
      if (NON_BODY_RE.test(m.name)) return false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      return !mats.every(mat => mat && NON_BODY_RE.test(mat.name));
    });
    const bodySkins = candidateSkins.length ? candidateSkins : [skin];
    for (const m of bodySkins) {
      m.updateMatrixWorld(true);
      m.skeleton.update();
    }

    const totalBodyVerts = bodySkins.reduce(
      (sum, m) => sum + m.geometry.getAttribute('position').count,
      0,
    );
    const stride = Math.max(1, Math.floor(totalBodyVerts / 12000));

    let minY = Infinity;
    let maxY = -Infinity;
    const pelvisCenterX = (jp.leftHip.x + jp.rightHip.x) * 0.5;
    const shoulderOffsetX = Math.max(
      (Math.abs(jp.leftShoulder.x - pelvisCenterX) + Math.abs(jp.rightShoulder.x - pelvisCenterX)) * 0.5,
      0.04,
    );
    const hipOffsetX = Math.max(
      (Math.abs(jp.leftHip.x - pelvisCenterX) + Math.abs(jp.rightHip.x - pelvisCenterX)) * 0.5,
      0.03,
    );

    const vTmp = new T.Vector3();
    for (const m of bodySkins) {
      const count = m.geometry.getAttribute('position').count;
      for (let i = 0; i < count; i += stride) {
        m.getVertexPosition(i, vTmp).applyMatrix4(m.matrixWorld);
        if (vTmp.y < minY) minY = vTmp.y;
        if (vTmp.y > maxY) maxY = vTmp.y;
      }
    }
    const height = Math.max(maxY - minY, 0.5);

    const armZoneLoY = jp.hips.y - 0.01 * height;
    const armZoneHiY = Math.min(jp.leftShoulder.y, jp.rightShoulder.y) - 0.065 * height;
    const waistLoY = jp.hips.y + 0.01 * height;
    const waistHiY = jp.chest.y - 0.01 * height;
    const hipLoY = jp.hips.y - 0.07 * height;
    const hipHiY = jp.hips.y + 0.05 * height;
    const spineSliceLoY = jp.spine.y - 0.03 * height;
    const spineSliceHiY = jp.spine.y + 0.03 * height;

    const torsoLateralXs: number[] = [];
    const waistLateralXs: number[] = [];
    const hipLateralXs: number[] = [];
    const bellyFrontZs: number[] = [];
    const spineBackZs: number[] = [];
    const spineFrontZs: number[] = [];
    const upperArmRadii: number[] = [];
    const forearmRadii: number[] = [];
    const thighMedialRadii: number[] = [];
    const thighLateralRadii: number[] = [];

    for (const m of bodySkins) {
      const posCount = m.geometry.getAttribute('position').count;
      const skinIdxAttr = m.geometry.getAttribute('skinIndex');
      const skinWgtAttr = m.geometry.getAttribute('skinWeight');
      const {
        armBoneIndices,
        forearmBoneIndices,
        legBoneIndices,
        leftLegBoneIndices,
        rightLegBoneIndices,
      } = classifyBoneDescendants(m.skeleton.bones, bones);

      for (let i = 0; i < posCount; i += stride) {
        m.getVertexPosition(i, vTmp).applyMatrix4(m.matrixWorld);

        let armWeight = 0;
        let forearmWeight = 0;
        let legWeight = 0;
        let leftLegWeight = 0;
        let rightLegWeight = 0;
        if (skinIdxAttr && skinWgtAttr) {
          for (let k = 0; k < 4; k++) {
            const w = skinWgtAttr.getComponent(i, k);
            if (w <= 1e-4) continue;
            const bi = Math.round(skinIdxAttr.getComponent(i, k));
            if (armBoneIndices.has(bi)) armWeight += w;
            if (forearmBoneIndices.has(bi)) forearmWeight += w;
            if (legBoneIndices.has(bi)) legWeight += w;
            if (leftLegBoneIndices.has(bi)) leftLegWeight += w;
            if (rightLegBoneIndices.has(bi)) rightLegWeight += w;
          }
        }

        const absX = Math.abs(vTmp.x - pelvisCenterX);

        // Torso / waist / belly envelope (exclude arm-dominated vertices!)
        if (armWeight < 0.35) {
          if (vTmp.y >= armZoneLoY && vTmp.y <= armZoneHiY && absX < shoulderOffsetX * 1.65) {
            torsoLateralXs.push(absX);
            if (absX < shoulderOffsetX * 0.85) bellyFrontZs.push(vTmp.z);
          }
          if (vTmp.y >= waistLoY && vTmp.y <= Math.max(waistHiY, waistLoY + 0.03 * height) && absX < shoulderOffsetX * 1.65) {
            waistLateralXs.push(absX);
          }
          if (vTmp.y >= hipLoY && vTmp.y <= hipHiY && absX < shoulderOffsetX * 1.75) {
            hipLateralXs.push(absX);
          }
          if (vTmp.y >= spineSliceLoY && vTmp.y <= spineSliceHiY && absX < hipOffsetX * 1.1) {
            spineBackZs.push(vTmp.z);
            spineFrontZs.push(vTmp.z);
          }
        }

        // Upper arm & forearm soft-tissue radii
        if (armWeight >= 0.45 && forearmWeight < 0.45) {
          const isLeft = vTmp.x >= pelvisCenterX;
          const { dist, t } = pointToSegmentRadial(
            vTmp,
            isLeft ? jp.leftShoulder : jp.rightShoulder,
            isLeft ? jp.leftElbow : jp.rightElbow,
          );
          if (t >= 0.22 && t <= 0.82 && dist < 0.16 * height) {
            upperArmRadii.push(dist);
          }
        } else if (forearmWeight >= 0.45) {
          const isLeft = vTmp.x >= pelvisCenterX;
          const { dist, t } = pointToSegmentRadial(
            vTmp,
            isLeft ? jp.leftElbow : jp.rightElbow,
            isLeft ? jp.leftWrist : jp.rightWrist,
          );
          if (t >= 0.15 && t <= 0.85 && dist < 0.12 * height) {
            forearmRadii.push(dist);
          }
        }

        // Thigh medial / lateral radii invariant to bind splay & midline overlap
        if (legWeight >= 0.45) {
          const isLeft = leftLegWeight >= rightLegWeight;
          const hipPt = isLeft ? jp.leftHip : jp.rightHip;
          const kneePt = isLeft ? jp.leftKnee : jp.rightKnee;
          const { dist, t } = pointToSegmentRadial(vTmp, hipPt, kneePt);
          if (t >= 0.15 && t <= 0.55 && dist < 0.18 * height) {
            const axisX = hipPt.x + (kneePt.x - hipPt.x) * t;
            const sideSign = isLeft ? 1 : -1;
            if (sideSign * (vTmp.x - axisX) <= 0) {
              thighMedialRadii.push(dist);
            } else {
              thighLateralRadii.push(dist);
            }
          }
        }
      }
    }

    torsoLateralXs.sort((a, b) => a - b);
    waistLateralXs.sort((a, b) => a - b);
    hipLateralXs.sort((a, b) => a - b);
    bellyFrontZs.sort((a, b) => a - b);
    spineBackZs.sort((a, b) => a - b);
    spineFrontZs.sort((a, b) => a - b);
    upperArmRadii.sort((a, b) => a - b);
    forearmRadii.sort((a, b) => a - b);
    thighMedialRadii.sort((a, b) => a - b);
    thighLateralRadii.sort((a, b) => a - b);

    const torsoHalfWidth = torsoLateralXs.length ? percentile(torsoLateralXs, 0.93) : shoulderOffsetX * 0.82;
    const waistHalfWidth = waistLateralXs.length ? percentile(waistLateralXs, 0.93) : torsoHalfWidth * 0.92;
    const hipHalfWidth = hipLateralXs.length ? percentile(hipLateralXs, 0.95) : hipOffsetX * 1.45;
    const bellyFrontZ = bellyFrontZs.length ? percentile(bellyFrontZs, 0.96) : jp.hips.z + 0.055 * height;
    const backZ = spineBackZs.length ? percentile(spineBackZs, 0.04) : jp.hips.z - 0.055 * height;
    const frontSpineZ = spineFrontZs.length ? percentile(spineFrontZs, 0.96) : bellyFrontZ;
    const spineAp = Math.max(frontSpineZ - backZ, 0.04 * height);
    const dorsalSpineFraction = T.MathUtils.clamp((jp.spine.z - backZ) / spineAp, 0.1, 0.9);

    const upperArmRadius = upperArmRadii.length ? percentile(upperArmRadii, 0.85) : 0.032 * height;
    const forearmRadius = forearmRadii.length ? percentile(forearmRadii, 0.85) : upperArmRadius * 0.78;
    const thighMedialRadius = thighMedialRadii.length ? percentile(thighMedialRadii, 0.88) : 0.035 * height;
    const thighLateralRadius = thighLateralRadii.length ? percentile(thighLateralRadii, 0.88) : 0.042 * height;

    // Composite normalized adiposity index [0, 1] combining waist-to-height, AP belly depth, and limb girth:
    const waistToHeight = (waistHalfWidth * 2) / height; // lean ~0.10-0.13, heavy ~0.16-0.24
    const bellyToHeight = (bellyFrontZ - backZ) / height; // lean ~0.08-0.11, heavy ~0.13-0.23
    const armToHeight = upperArmRadius / height; // lean ~0.018-0.026, heavy ~0.030-0.045
    const adiposityIndex = T.MathUtils.clamp(
      0.45 * smoothstep(0.125, 0.21, waistToHeight) +
      0.35 * smoothstep(0.11, 0.20, bellyToHeight) +
      0.20 * smoothstep(0.025, 0.040, armToHeight),
      0,
      1,
    );

    const envelope: SoftTissueEnvelope = {
      height,
      torsoHalfWidth,
      waistHalfWidth,
      hipHalfWidth,
      bellyFrontZ,
      backZ,
      pelvisCenterX,
      hipsY: jp.hips.y,
      spineY: jp.spine.y,
      chestY: jp.chest.y,
      shoulderOffsetX,
      hipOffsetX,
      upperArmRadius,
      forearmRadius,
      thighMedialRadius,
      thighLateralRadius,
      dorsalSpineFraction,
      adiposityIndex,
    };

    const avgUpperArmLen = (leftArm.upperLength + rightArm.upperLength) * 0.5;
    const avgThighLen = (leftLeg.upperLength + rightLeg.upperLength) * 0.5;
    const padArm = (0.004 + 0.004 * adiposityIndex) * height;
    const lateralContour = Math.max(torsoHalfWidth * 0.96, waistHalfWidth * 0.96);
    const sinArm = T.MathUtils.clamp(
      (lateralContour + upperArmRadius * 0.96 + padArm - shoulderOffsetX) / Math.max(0.84 * avgUpperArmLen, 0.09),
      Math.sin(CANONICAL_ARM_ABDUCTION_RAD),
      Math.sin(34 * DEG),
    );
    const naturalArmAbductionRad = options.isCanonicalMannequin
      ? CANONICAL_ARM_ABDUCTION_RAD
      : Math.asin(sinArm);

    // If wide hips/apron exceed resting elbow lateral X, add subtle natural elbow flexion (4-14 deg)
    const elbowAtRestX = shoulderOffsetX + avgUpperArmLen * Math.sin(naturalArmAbductionRad);
    const hipExcess = Math.max(0, hipHalfWidth + forearmRadius * 0.85 - elbowAtRestX);
    const naturalElbowBendRad = options.isCanonicalMannequin
      ? 0
      : T.MathUtils.clamp((hipExcess / Math.max(avgUpperArmLen, 0.12)) * 0.55 + adiposityIndex * 6 * DEG, 0, 16 * DEG);

    const padMidline = (0.003 + 0.004 * adiposityIndex) * height;
    const sinThigh = T.MathUtils.clamp(
      (thighMedialRadius + padMidline - hipOffsetX) / Math.max(0.58 * avgThighLen, 0.10),
      0,
      Math.sin(11 * DEG),
    );
    const naturalThighSplayRad = options.isCanonicalMannequin ? 0 : Math.asin(sinThigh);

    const avgBindArmAbd = (leftArm.abductionFromDownRad + rightArm.abductionFromDownRad) * 0.5;
    const isCanonicalMannequin =
      options.isCanonicalMannequin ??
      (Math.abs(avgBindArmAbd - CANONICAL_ARM_ABDUCTION_RAD) < 2.5 * DEG &&
        Math.abs(leftLeg.abductionFromDownRad) < 1.5 * DEG &&
        adiposityIndex < 0.15);

    return {
      isCanonicalMannequin,
      preserveAuthoredNeutral: options.preserveAuthoredNeutral,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      jointBindPositions,
      bindTorsoPitchRad,
      bindNeckPitchRad,
      envelope,
      naturalArmAbductionRad,
      naturalElbowBendRad,
      naturalThighSplayRad,
    };
  } finally {
    root.position.copy(savedPos);
    root.quaternion.copy(savedQuat);
    root.scale.copy(savedScale);
    for (const j of JOINTS) bones[j].quaternion.copy(savedBoneQuats[j]);
    root.updateMatrixWorld(true);
    skin.skeleton.update();
  }
}

const CANONICAL_LEFT_UPPER_FRAME = new T.Quaternion().setFromAxisAngle(
  new T.Vector3(0, 0, 1),
  CANONICAL_ARM_ABDUCTION_RAD,
);
const CANONICAL_RIGHT_UPPER_FRAME = new T.Quaternion().setFromAxisAngle(
  new T.Vector3(0, 0, 1),
  -CANONICAL_ARM_ABDUCTION_RAD,
);
const IDENTITY_QUAT = new T.Quaternion();

function computeCanonicalWorldDeltas(pose: Pose): Record<Joint, T.Quaternion> {
  const out = {} as Record<Joint, T.Quaternion>;
  for (const j of JOINTS) {
    const localDelta = new T.Quaternion().setFromEuler(new T.Euler(pose[j][0], pose[j][1], pose[j][2], 'XYZ'));
    const parent = PARENT_JOINT[j];
    out[j] = parent ? out[parent].clone().multiply(localDelta) : localDelta;
  }
  return out;
}

function adaptArmChain(
  sideSign: 1 | -1,
  limb: LimbRestMetrics,
  profile: MorphologyProfile,
  chestWorld: T.Quaternion,
  canonUpperWorld: T.Quaternion,
  canonLowerWorld: T.Quaternion,
  canonWristLocal: Vec3,
  enableClearance: boolean,
): { shoulder: T.Quaternion; elbow: T.Quaternion; wrist: T.Quaternion } {
  const refUpperFrame = sideSign === 1 ? CANONICAL_LEFT_UPPER_FRAME : CANONICAL_RIGHT_UPPER_FRAME;
  const desiredUpperInChest = chestWorld
    .clone()
    .invert()
    .multiply(canonUpperWorld)
    .multiply(refUpperFrame);
  const desiredLowerInChest = chestWorld
    .clone()
    .invert()
    .multiply(canonLowerWorld); // refLowerFrame === Identity

  let adaptedUpperInChest = desiredUpperInChest.clone();
  let adaptedLowerInChest = desiredLowerInChest.clone();

  if (enableClearance) {
    const uDir = DOWN.clone().applyQuaternion(adaptedUpperInChest);
    // Downward side-hanging weight: 1 when arm hangs near torso side, 0 when raised overhead or reaching far forward/back
    const sideHangWeight =
      smoothstep(-0.10, -0.72, uDir.y) * smoothstep(0.82, 0.32, Math.abs(uDir.z));

    if (sideHangWeight > 1e-3) {
      const currentAbd = Math.atan2(sideSign * uDir.x, Math.max(-uDir.y, 1e-4));
      const restShift =
        (profile.naturalArmAbductionRad - CANONICAL_ARM_ABDUCTION_RAD) *
        smoothstep(42 * DEG, 12 * DEG, currentAbd);
      const shiftedAbd = currentAbd + restShift * sideHangWeight;
      const clearedAbd =
        currentAbd * (1 - sideHangWeight) +
        softFloor(shiftedAbd, profile.naturalArmAbductionRad - 1.5 * DEG, 5 * DEG) * sideHangWeight;
      const deltaAbd = clearedAbd - currentAbd;

      if (Math.abs(deltaAbd) > 1e-4) {
        const abdRot = new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          sideSign * deltaAbd,
        );
        adaptedUpperInChest.premultiply(abdRot);
        adaptedLowerInChest.premultiply(abdRot);
      }

      // Subtle resting elbow bend clearance over wide hips when arm is nearly straight at side
      const curLowerDir = DOWN.clone().applyQuaternion(adaptedLowerInChest);
      const curUpperDir = DOWN.clone().applyQuaternion(adaptedUpperInChest);
      const curBend = Math.acos(T.MathUtils.clamp(curUpperDir.dot(curLowerDir), -1, 1));
      const extraBend =
        profile.naturalElbowBendRad * sideHangWeight * smoothstep(28 * DEG, 8 * DEG, curBend);
      if (extraBend > 1e-4) {
        const elbowFlex = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -extraBend);
        adaptedLowerInChest.multiply(elbowFlex);
      }
    }

    // Distal wrist & elbow body-envelope surface clearance (handles Heroic / Contrapposto akimbo & Seated lap!)
    const env = profile.envelope;
    const shBind = new T.Vector3(
      ...(sideSign === 1 ? profile.jointBindPositions.leftShoulder : profile.jointBindPositions.rightShoulder),
    );
    const chestBind = new T.Vector3(...profile.jointBindPositions.chest);
    const shRelChest = shBind.clone().sub(chestBind);

    const upperDirChest = DOWN.clone().applyQuaternion(adaptedUpperInChest);
    const lowerDirChest = DOWN.clone().applyQuaternion(adaptedLowerInChest);
    const elbowRelChest = shRelChest.clone().addScaledVector(upperDirChest, limb.upperLength);
    const wristRelChest = elbowRelChest.clone().addScaledVector(lowerDirChest, limb.lowerLength);

    // Express wrist in torso-centered coordinates (approximate chestBind + wristRelChest)
    const wristTorso = chestBind.clone().add(wristRelChest);
    const minEnvY = env.hipsY - 0.11 * env.height;
    const maxEnvY = env.chestY + 0.06 * env.height;
    if (wristTorso.y >= minEnvY && wristTorso.y <= maxEnvY) {
      const yNorm = T.MathUtils.clamp(
        (wristTorso.y - env.hipsY) / Math.max(env.chestY - env.hipsY, 0.05),
        -0.4,
        1.2,
      );
      const halfW =
        (yNorm < 0.45
          ? T.MathUtils.lerp(env.hipHalfWidth, env.waistHalfWidth, T.MathUtils.clamp((yNorm + 0.2) / 0.65, 0, 1))
          : T.MathUtils.lerp(env.waistHalfWidth, env.torsoHalfWidth, T.MathUtils.clamp((yNorm - 0.45) / 0.55, 0, 1))) +
        env.forearmRadius * 0.9;
      const centerZ = (env.backZ + env.bellyFrontZ) * 0.5;
      const halfD = Math.max((env.bellyFrontZ - env.backZ) * 0.5, 0.05 * env.height) + env.forearmRadius * 0.9;

      const dx = wristTorso.x - env.pelvisCenterX;
      const dz = wristTorso.z - centerZ;
      const rho = Math.hypot(dx / Math.max(halfW, 0.04), dz / Math.max(halfD, 0.04));

      if (rho < 1.0 && rho > 0.08) {
        // Push wrist radially onto the outer waist/hip/belly contour (Interaction Mesh / Spore surface preservation)
        const scaleOut = 1.02 / rho;
        const targetWristTorso = new T.Vector3(
          env.pelvisCenterX + dx * scaleOut,
          wristTorso.y,
          centerZ + dz * scaleOut,
        );
        const shift = targetWristTorso.sub(wristTorso);
        // Convert lateral/anterior wrist push into smooth shoulder abduction + forward pitch adjustment
        const armSpan = Math.max(elbowRelChest.distanceTo(shRelChest) * 1.35, 0.12);
        const addAbd = T.MathUtils.clamp((sideSign * shift.x) / armSpan, 0, 26 * DEG);
        const addFwd = T.MathUtils.clamp(shift.z / armSpan, -18 * DEG, 22 * DEG);
        const pushQuat = new T.Quaternion().setFromEuler(new T.Euler(-addFwd, 0, sideSign * addAbd, 'XYZ'));
        adaptedUpperInChest.premultiply(pushQuat);
        adaptedLowerInChest.premultiply(pushQuat);
      }
    }
  }

  const targetUpperWorld = chestWorld.clone().multiply(adaptedUpperInChest);
  const targetLowerWorld = chestWorld.clone().multiply(adaptedLowerInChest);

  const charUpperWorld = targetUpperWorld.clone().multiply(limb.upperBindFrame.clone().invert());
  const charLowerWorld = targetLowerWorld.clone().multiply(limb.lowerBindFrame.clone().invert());

  const shoulderDelta = chestWorld.clone().invert().multiply(charUpperWorld);
  const elbowDelta = charUpperWorld.clone().invert().multiply(charLowerWorld);

  // Preserve canonical wrist rotation in the posed forearm anatomical frame:
  const canonWristQ = new T.Quaternion().setFromEuler(
    new T.Euler(canonWristLocal[0], canonWristLocal[1], canonWristLocal[2], 'XYZ'),
  );
  const targetHandWorld = targetLowerWorld.clone().multiply(canonWristQ);
  const charHandWorld = targetHandWorld.clone().multiply(limb.lowerBindFrame.clone().invert());
  const wristDelta = charLowerWorld.clone().invert().multiply(charHandWorld);

  return { shoulder: shoulderDelta, elbow: elbowDelta, wrist: wristDelta };
}

function adaptLegChain(
  sideSign: 1 | -1,
  limb: LimbRestMetrics,
  profile: MorphologyProfile,
  hipsWorld: T.Quaternion,
  canonUpperWorld: T.Quaternion,
  canonLowerWorld: T.Quaternion,
  canonAnkleLocal: Vec3,
  otherThighCanonWorld: T.Quaternion,
  enableClearance: boolean,
): { hip: T.Quaternion; knee: T.Quaternion; ankle: T.Quaternion } {
  const desiredUpperInHips = hipsWorld.clone().invert().multiply(canonUpperWorld);
  const desiredLowerInHips = hipsWorld.clone().invert().multiply(canonLowerWorld);
  const otherUpperInHips = hipsWorld.clone().invert().multiply(otherThighCanonWorld);

  const adaptedUpperInHips = desiredUpperInHips.clone();
  const adaptedLowerInHips = desiredLowerInHips.clone();

  if (enableClearance) {
    const uDir = DOWN.clone().applyQuaternion(adaptedUpperInHips);
    const otherDir = DOWN.clone().applyQuaternion(otherUpperInHips);

    // 1. Standing / walking inner-thigh midline clearance:
    const bothStanding =
      smoothstep(-0.35, -0.80, uDir.y) *
      smoothstep(-0.35, -0.80, otherDir.y) *
      smoothstep(0.55, 0.20, Math.abs(uDir.z - otherDir.z));
    if (bothStanding > 1e-3 && profile.naturalThighSplayRad > 1e-4) {
      const curSplay = Math.atan2(sideSign * uDir.x, Math.max(-uDir.y, 1e-4));
      const shifted = curSplay + profile.naturalThighSplayRad * smoothstep(14 * DEG, 3 * DEG, curSplay);
      const cleared = softFloor(shifted, profile.naturalThighSplayRad * 0.85, 3 * DEG);
      const deltaSplay = (cleared - curSplay) * bothStanding;
      if (Math.abs(deltaSplay) > 1e-4) {
        const splayRot = new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          sideSign * deltaSplay,
        );
        adaptedUpperInHips.premultiply(splayRot);
        adaptedLowerInHips.premultiply(splayRot);
      }
    }

    // 2. Abdominal / panniculus hip-flexion adaptation (Seated, Kneeling, Crouch):
    const env = profile.envelope;
    const bellyExcess = T.MathUtils.clamp((env.bellyFrontZ / env.height - 0.062) / 0.080, 0, 1);
    const bellySeverity = Math.max(bellyExcess, env.adiposityIndex * 0.85);
    if (bellySeverity > 0.03) {
      const forwardFlexRad = Math.atan2(uDir.z, Math.max(-uDir.y, -0.5));
      const deepFlexWeight = smoothstep(45 * DEG, 92 * DEG, forwardFlexRad);
      if (deepFlexWeight > 1e-3) {
        // Outward horizontal-plane femoral splay (around +Y when thigh is flexed forward!) so thighs straddle the abdomen
        const bellySplay = bellySeverity * 14 * DEG * deepFlexWeight;
        // Moderate extreme >76° thigh-to-belly compression slightly while keeping shin vertical
        const overCompress = Math.max(0, forwardFlexRad - 76 * DEG);
        const flexRelief = Math.min(overCompress * 0.45, bellySeverity * 11 * DEG) * deepFlexWeight;

        const hipAdapt = new T.Quaternion().setFromEuler(
          new T.Euler(flexRelief, sideSign * bellySplay, sideSign * bellySplay * 0.25, 'XYZ'),
        );
        adaptedUpperInHips.premultiply(hipAdapt);
        // Carry horizontal splay to lower leg while keeping shin vertical pitch grounded
        const shinSplayOnly = new T.Quaternion().setFromEuler(
          new T.Euler(0, sideSign * bellySplay, sideSign * bellySplay * 0.25, 'XYZ'),
        );
        adaptedLowerInHips.premultiply(shinSplayOnly);
      }
    }
  }

  const targetUpperWorld = hipsWorld.clone().multiply(adaptedUpperInHips);
  const targetLowerWorld = hipsWorld.clone().multiply(adaptedLowerInHips);

  const charUpperWorld = targetUpperWorld.clone().multiply(limb.upperBindFrame.clone().invert());
  const charLowerWorld = targetLowerWorld.clone().multiply(limb.lowerBindFrame.clone().invert());

  const hipDelta = hipsWorld.clone().invert().multiply(charUpperWorld);
  const kneeDelta = charUpperWorld.clone().invert().multiply(charLowerWorld);

  const canonAnkleQ = new T.Quaternion().setFromEuler(
    new T.Euler(canonAnkleLocal[0], canonAnkleLocal[1], canonAnkleLocal[2], 'XYZ'),
  );
  const targetFootWorld = targetLowerWorld.clone().multiply(canonAnkleQ);
  const charFootWorld = targetFootWorld.clone().multiply(limb.lowerBindFrame.clone().invert());
  const ankleDelta = charLowerWorld.clone().invert().multiply(charFootWorld);

  return { hip: hipDelta, knee: kneeDelta, ankle: ankleDelta };
}

function quatToVec3(q: T.Quaternion): Vec3 {
  const e = new T.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

function isZeroPose(pose: Pose): boolean {
  for (const j of JOINTS) {
    const v = pose[j];
    if (Math.abs(v[0]) > 1e-6 || Math.abs(v[1]) > 1e-6 || Math.abs(v[2]) > 1e-6) return false;
  }
  return true;
}

/**
 * Translates a canonical studio `Pose` into target character bone deltas (`Pose` relative to
 * the target character's untouched bind rest pose), compensating for T-pose / A-pose / bent-limb
 * bind orientations and adapting to the character's measured soft-tissue & adipose envelope.
 */
export function adaptCanonicalPoseToMorphology(
  canonicalPose: Pose,
  profile: MorphologyProfile,
  options: MorphologyAdaptOptions = {},
): Pose {
  if (profile.isCanonicalMannequin) {
    return clone(canonicalPose);
  }
  if (profile.preserveAuthoredNeutral && isZeroPose(canonicalPose)) {
    return neutralPose();
  }

  const enableClearance =
    !options.disableEnvelopeClearance && options.limitMode !== 'free';

  const canonWorld = computeCanonicalWorldDeltas(canonicalPose);
  const out = clone(canonicalPose);

  // Torso & head chain remain direct in character world space (hips -> spine -> chest -> neck -> head),
  // with subtle lumbar/pelvic pitch sharing under heavy abdominal sitting if needed:
  const chestWorld = canonWorld.chest;
  const hipsWorld = canonWorld.hips;

  const leftArm = adaptArmChain(
    1,
    profile.leftArm,
    profile,
    chestWorld,
    canonWorld.leftShoulder,
    canonWorld.leftElbow,
    canonicalPose.leftWrist,
    enableClearance,
  );
  out.leftShoulder = quatToVec3(leftArm.shoulder);
  out.leftElbow = quatToVec3(leftArm.elbow);
  out.leftWrist = quatToVec3(leftArm.wrist);

  const rightArm = adaptArmChain(
    -1,
    profile.rightArm,
    profile,
    chestWorld,
    canonWorld.rightShoulder,
    canonWorld.rightElbow,
    canonicalPose.rightWrist,
    enableClearance,
  );
  out.rightShoulder = quatToVec3(rightArm.shoulder);
  out.rightElbow = quatToVec3(rightArm.elbow);
  out.rightWrist = quatToVec3(rightArm.wrist);

  const leftLeg = adaptLegChain(
    1,
    profile.leftLeg,
    profile,
    hipsWorld,
    canonWorld.leftHip,
    canonWorld.leftKnee,
    canonicalPose.leftAnkle,
    canonWorld.rightHip,
    enableClearance,
  );
  out.leftHip = quatToVec3(leftLeg.hip);
  out.leftKnee = quatToVec3(leftLeg.knee);
  out.leftAnkle = quatToVec3(leftLeg.ankle);

  const rightLeg = adaptLegChain(
    -1,
    profile.rightLeg,
    profile,
    hipsWorld,
    canonWorld.rightHip,
    canonWorld.rightKnee,
    canonicalPose.rightAnkle,
    canonWorld.leftHip,
    enableClearance,
  );
  out.rightHip = quatToVec3(rightLeg.hip);
  out.rightKnee = quatToVec3(rightLeg.knee);
  out.rightAnkle = quatToVec3(rightLeg.ankle);

  return out;
}

/**
 * Inverse of `adaptCanonicalPoseToMorphology`: extracts a morphology-neutral canonical `Pose`
 * from a character's physical bone-delta pose so poses authored on a fat/A-pose/T-pose character
 * transfer onto a lean character without "invisible lat syndrome" or rest-pose bias.
 */
export function extractCanonicalPoseFromMorphology(
  characterPose: Pose,
  profile: MorphologyProfile,
): Pose {
  if (profile.isCanonicalMannequin) {
    return clone(characterPose);
  }

  const charWorld = computeCanonicalWorldDeltas(characterPose);
  const out = clone(characterPose);

  const extractArm = (
    sideSign: 1 | -1,
    limb: LimbRestMetrics,
    charUpperW: T.Quaternion,
    charLowerW: T.Quaternion,
    charHandW: T.Quaternion,
  ) => {
    const refUpperFrame = sideSign === 1 ? CANONICAL_LEFT_UPPER_FRAME : CANONICAL_RIGHT_UPPER_FRAME;
    // Actual posed anatomical segment frames in character world space:
    const posedUpperInChest = charWorld.chest
      .clone()
      .invert()
      .multiply(charUpperW)
      .multiply(limb.upperBindFrame);
    const posedLowerInChest = charWorld.chest
      .clone()
      .invert()
      .multiply(charLowerW)
      .multiply(limb.lowerBindFrame);

    // Remove the character's resting soft-tissue abduction baseline so contact-at-side maps to canonical contact-at-side!
    const uDir = DOWN.clone().applyQuaternion(posedUpperInChest);
    const sideHangWeight =
      smoothstep(-0.10, -0.72, uDir.y) * smoothstep(0.82, 0.32, Math.abs(uDir.z));
    if (sideHangWeight > 1e-3) {
      const posedAbd = Math.atan2(sideSign * uDir.x, Math.max(-uDir.y, 1e-4));
      const excessRest =
        (profile.naturalArmAbductionRad - CANONICAL_ARM_ABDUCTION_RAD) *
        sideHangWeight *
        smoothstep(
          profile.naturalArmAbductionRad + 35 * DEG,
          profile.naturalArmAbductionRad + 2 * DEG,
          posedAbd,
        );
      const unclampedAbd = Math.max(0, posedAbd - excessRest);
      const removeAbd = unclampedAbd - posedAbd;
      if (Math.abs(removeAbd) > 1e-4) {
        const unAbd = new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          sideSign * removeAbd,
        );
        posedUpperInChest.premultiply(unAbd);
        posedLowerInChest.premultiply(unAbd);
      }

      const curLowerDir = DOWN.clone().applyQuaternion(posedLowerInChest);
      const curUpperDir = DOWN.clone().applyQuaternion(posedUpperInChest);
      const curBend = Math.acos(T.MathUtils.clamp(curUpperDir.dot(curLowerDir), -1, 1));
      const undoBend = Math.min(
        curBend,
        profile.naturalElbowBendRad * sideHangWeight * smoothstep(32 * DEG, 10 * DEG, curBend),
      );
      if (undoBend > 1e-4) {
        const elbowUnflex = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), undoBend);
        posedLowerInChest.multiply(elbowUnflex);
      }
    }

    const canonUpperW = charWorld.chest
      .clone()
      .multiply(posedUpperInChest)
      .multiply(refUpperFrame.clone().invert());
    const canonLowerW = charWorld.chest.clone().multiply(posedLowerInChest);
    const posedHandFrame = charHandW.clone().multiply(limb.lowerBindFrame);
    const canonWristQ = canonLowerW.clone().invert().multiply(posedHandFrame);

    return {
      shoulder: quatToVec3(charWorld.chest.clone().invert().multiply(canonUpperW)),
      elbow: quatToVec3(canonUpperW.clone().invert().multiply(canonLowerW)),
      wrist: quatToVec3(canonWristQ),
    };
  };

  const lArm = extractArm(1, profile.leftArm, charWorld.leftShoulder, charWorld.leftElbow, charWorld.leftWrist);
  out.leftShoulder = lArm.shoulder;
  out.leftElbow = lArm.elbow;
  out.leftWrist = lArm.wrist;

  const rArm = extractArm(-1, profile.rightArm, charWorld.rightShoulder, charWorld.rightElbow, charWorld.rightWrist);
  out.rightShoulder = rArm.shoulder;
  out.rightElbow = rArm.elbow;
  out.rightWrist = rArm.wrist;

  const extractLeg = (
    sideSign: 1 | -1,
    limb: LimbRestMetrics,
    charUpperW: T.Quaternion,
    charLowerW: T.Quaternion,
    charFootW: T.Quaternion,
  ) => {
    const posedUpperInHips = charWorld.hips
      .clone()
      .invert()
      .multiply(charUpperW)
      .multiply(limb.upperBindFrame);
    const posedLowerInHips = charWorld.hips
      .clone()
      .invert()
      .multiply(charLowerW)
      .multiply(limb.lowerBindFrame);

    const uDir = DOWN.clone().applyQuaternion(posedUpperInHips);
    const standingWeight = smoothstep(-0.35, -0.80, uDir.y);
    if (standingWeight > 1e-3 && profile.naturalThighSplayRad > 1e-4) {
      const posedSplay = Math.atan2(sideSign * uDir.x, Math.max(-uDir.y, 1e-4));
      const removeSplay =
        -Math.min(posedSplay, profile.naturalThighSplayRad) *
        standingWeight *
        smoothstep(18 * DEG, profile.naturalThighSplayRad, posedSplay);
      if (Math.abs(removeSplay) > 1e-4) {
        const unSplay = new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          sideSign * removeSplay,
        );
        posedUpperInHips.premultiply(unSplay);
        posedLowerInHips.premultiply(unSplay);
      }
    }

    const canonUpperW = charWorld.hips.clone().multiply(posedUpperInHips).multiply(IDENTITY_QUAT);
    const canonLowerW = charWorld.hips.clone().multiply(posedLowerInHips);
    const posedFootFrame = charFootW.clone().multiply(limb.lowerBindFrame);
    const canonAnkleQ = canonLowerW.clone().invert().multiply(posedFootFrame);

    return {
      hip: quatToVec3(charWorld.hips.clone().invert().multiply(canonUpperW)),
      knee: quatToVec3(canonUpperW.clone().invert().multiply(canonLowerW)),
      ankle: quatToVec3(canonAnkleQ),
    };
  };

  const lLeg = extractLeg(1, profile.leftLeg, charWorld.leftHip, charWorld.leftKnee, charWorld.leftAnkle);
  out.leftHip = lLeg.hip;
  out.leftKnee = lLeg.knee;
  out.leftAnkle = lLeg.ankle;

  const rLeg = extractLeg(-1, profile.rightLeg, charWorld.rightHip, charWorld.rightKnee, charWorld.rightAnkle);
  out.rightHip = rLeg.hip;
  out.rightKnee = rLeg.knee;
  out.rightAnkle = rLeg.ankle;

  return out;
}

/**
 * Directly translates a physical bone-delta `Pose` authored on `sourceProfile` onto `targetProfile`
 * (`lean -> fat`, `fat -> lean`, `T-pose -> A-pose`, etc.).
 */
export function translatePoseAcrossMorphologies(
  sourceCharacterPose: Pose,
  sourceProfile: MorphologyProfile,
  targetProfile: MorphologyProfile,
  options: MorphologyAdaptOptions = {},
): Pose {
  const canonical = extractCanonicalPoseFromMorphology(sourceCharacterPose, sourceProfile);
  return adaptCanonicalPoseToMorphology(canonical, targetProfile, options);
}

export function formatMorphologySummary(profile: MorphologyProfile): string {
  return [
    `adiposity=${profile.envelope.adiposityIndex.toFixed(2)}`,
    `bindArm=${(profile.leftArm.abductionFromDownRad * RAD).toFixed(1)}°`,
    `restArmClear=${(profile.naturalArmAbductionRad * RAD).toFixed(1)}°`,
    `restThighSplay=${(profile.naturalThighSplayRad * RAD).toFixed(1)}°`,
  ].join(', ');
}
