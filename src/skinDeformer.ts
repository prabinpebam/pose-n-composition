import * as T from 'three';
import { JOINTS, type Body, type Joint, type Pose, type Vec3 } from './model';
import type { Figure } from './rig';
import type { MorphologyProfile } from './morphology-rig';
import {
  applyBodyProportion,
  getMannequinWeldTable,
  hasBodyProportionBaseline,
  isBodyTypeId,
  registerProportionPreHook,
  type BodyTypeId,
} from './bodyProportions';

export type PoseLimitMode = 'anatomical' | 'free';

export interface SkinDeformerOptions {
  gender?: 'male' | 'female';
  bodyType?: BodyTypeId;
  limitMode?: PoseLimitMode;
  enableCoupledJoints?: boolean;
  enableTwistDistribution?: boolean;
  enableHybridDqs?: boolean;
  enableDeltaMush?: boolean;
  enableContactAndBulge?: boolean;
  deltaMushIterations?: number;
  onAfterPoseSolve?: () => void;
}

export interface CoupledRigDiagnostics {
  clampedJointCount: number;
  leftClavicleElevationRad: number;
  rightClavicleElevationRad: number;
  leftClavicleProtractionRad: number;
  rightClavicleProtractionRad: number;
  spine02ShareRad: number;
  leftToeFlexionRad: number;
  rightToeFlexionRad: number;
}

export interface SkinDeformationDiagnostics {
  coupled: CoupledRigDiagnostics;
  leftForearmTwistRad: number;
  rightForearmTwistRad: number;
  leftElbowFlexionRad: number;
  rightElbowFlexionRad: number;
  leftKneeFlexionRad: number;
  rightKneeFlexionRad: number;
  leftHipFlexionRad: number;
  rightHipFlexionRad: number;
  maxCreaseCorrectionM: number;
  maxMuscleBulgeM: number;
  maxCapsulePushoutM: number;
  elapsedMs: number;
  skippedRedundant?: boolean;
}

const figureSkinStates = new WeakMap<T.Object3D, FigureSkinState>();

/** CPU skinning repurposes the GPU bone inverses for pass-through rendering. */
export function posedSkinBindInverses(figure: Figure): readonly T.Matrix4[] {
  return figureSkinStates.get(figure.root)?.bindBoneInverses ?? figure.skin.skeleton.boneInverses;
}
const DEG = Math.PI / 180;

registerProportionPreHook(figureRoot => {
  const existing = figureSkinStates.get(figureRoot);
  if (existing) restoreBindAttributesIfPassThrough(existing);
});

interface JointEulerBounds {
  min: Vec3;
  max: Vec3;
}

const ANATOMICAL_JOINT_LIMITS: Record<Joint, JointEulerBounds> = {
  hips: { min: [-180 * DEG, -180 * DEG, -180 * DEG], max: [180 * DEG, 180 * DEG, 180 * DEG] },
  spine: { min: [-38 * DEG, -42 * DEG, -35 * DEG], max: [55 * DEG, 42 * DEG, 35 * DEG] },
  chest: { min: [-35 * DEG, -48 * DEG, -35 * DEG], max: [55 * DEG, 48 * DEG, 35 * DEG] },
  neck: { min: [-50 * DEG, -65 * DEG, -42 * DEG], max: [55 * DEG, 65 * DEG, 42 * DEG] },
  head: { min: [-45 * DEG, -65 * DEG, -38 * DEG], max: [50 * DEG, 65 * DEG, 38 * DEG] },
  leftShoulder: { min: [-180 * DEG, -145 * DEG, -85 * DEG], max: [110 * DEG, 145 * DEG, 180 * DEG] },
  rightShoulder: { min: [-180 * DEG, -145 * DEG, -180 * DEG], max: [110 * DEG, 145 * DEG, 85 * DEG] },
  leftElbow: { min: [-160 * DEG, -170 * DEG, -12 * DEG], max: [2 * DEG, 170 * DEG, 12 * DEG] },
  rightElbow: { min: [-160 * DEG, -170 * DEG, -12 * DEG], max: [2 * DEG, 170 * DEG, 12 * DEG] },
  leftWrist: { min: [-115 * DEG, -180 * DEG, -115 * DEG], max: [115 * DEG, 180 * DEG, 115 * DEG] },
  rightWrist: { min: [-115 * DEG, -180 * DEG, -115 * DEG], max: [115 * DEG, 180 * DEG, 115 * DEG] },
  leftHip: { min: [-145 * DEG, -65 * DEG, -40 * DEG], max: [55 * DEG, 65 * DEG, 85 * DEG] },
  rightHip: { min: [-145 * DEG, -65 * DEG, -85 * DEG], max: [55 * DEG, 65 * DEG, 40 * DEG] },
  leftKnee: { min: [-2 * DEG, -28 * DEG, -8 * DEG], max: [155 * DEG, 28 * DEG, 8 * DEG] },
  rightKnee: { min: [-2 * DEG, -28 * DEG, -8 * DEG], max: [155 * DEG, 28 * DEG, 8 * DEG] },
  leftAnkle: { min: [-52 * DEG, -35 * DEG, -35 * DEG], max: [78 * DEG, 35 * DEG, 35 * DEG] },
  rightAnkle: { min: [-52 * DEG, -35 * DEG, -35 * DEG], max: [78 * DEG, 35 * DEG, 35 * DEG] },
};

// Limb segment slots for continuous axial twist distribution (0..7)
const SEG_NONE = -1;
const SEG_UPPERARM_L = 0;
const SEG_LOWERARM_L = 1;
const SEG_UPPERARM_R = 2;
const SEG_LOWERARM_R = 3;
const SEG_THIGH_L = 4;
const SEG_CALF_L = 5;
const SEG_THIGH_R = 6;
const SEG_CALF_R = 7;
const NUM_TWIST_SEGS = 8;

const BONE_ROLE_OTHER = 0;
const BONE_ROLE_HEAD = 1;
const BONE_ROLE_FINGER = 2;
const BONE_ROLE_TOE = 3;
const BONE_ROLE_HAND = 4;
const BONE_ROLE_FOOT = 5;

interface BoneLookup {
  pelvis: number;
  spine01: number;
  spine02: number;
  spine03: number;
  neck01: number;
  head: number;
  clavicleL: number;
  upperarmL: number;
  lowerarmL: number;
  handL: number;
  clavicleR: number;
  upperarmR: number;
  lowerarmR: number;
  handR: number;
  thighL: number;
  calfL: number;
  footL: number;
  ballL: number;
  ballLeafL: number;
  thighR: number;
  calfR: number;
  footR: number;
  ballR: number;
  ballLeafR: number;
}

interface TopologyTemplate {
  splitCount: number;
  weldCount: number;
  boneCount: number;
  vToWeld: Int32Array;
  weldToFirstV: Int32Array;
  normWeldCanon: Int32Array;
  normWeldGroupCount: number;
  triIndices: Int32Array;
  csrRowOffsets: Int32Array;
  csrColIndices: Int32Array;
  skinIdx4: Uint16Array;
  skinWgt4: Float32Array;
  boneLookup: BoneLookup;
  boneToTwistSeg: Int8Array;
  boneRole: Uint8Array;
  mushLambda: Float32Array;
  mushActiveIndices: Int32Array;
  refNeighbor: Int32Array;
  refNeighbor2: Int32Array;
  weldWeightMap: {
    wTorsoCore: Float32Array;
    wPelvis: Float32Array;
    wSpine1: Float32Array;
    wUpperArmL: Float32Array;
    wLowerArmL: Float32Array;
    wHandChainL: Float32Array;
    wUpperArmR: Float32Array;
    wLowerArmR: Float32Array;
    wHandChainR: Float32Array;
    wThighL: Float32Array;
    wCalfL: Float32Array;
    wFootChainL: Float32Array;
    wThighR: Float32Array;
    wCalfR: Float32Array;
    wFootChainR: Float32Array;
  };
  bulgeCandidates: Int32Array;
  creaseElbL: Int32Array;
  creaseElbR: Int32Array;
  creaseKneeL: Int32Array;
  creaseKneeR: Int32Array;
  creaseHipL: Int32Array;
  creaseHipR: Int32Array;
  distArmCandidates: Int32Array;
}

interface LimbSegRest {
  boneIdx: number;
  parentBoneIdx: number;
  childBoneIdx: number;
  p0x: number;
  p0y: number;
  p0z: number;
  ax: number;
  ay: number;
  az: number;
  len: number;
  proxUnwindScale: number;
  distAdvanceScale: number;
  sStart: number;
  sEnd: number;
}

interface BodyEnvelopeRadii {
  pelvisRx: number;
  pelvisRz: number;
  waistRx: number;
  waistRz: number;
  bellyFrontOffsetZ: number;
  bellyRadius: number;
  chestRx: number;
  chestRz: number;
  bustRadius: number;
  bustOffsetX: number;
  bustOffsetY: number;
  bustOffsetZ: number;
  headRadius: number;
  upperArmR: number;
  forearmR: number;
  thighR: number;
  calfR: number;
}

interface FigureSkinState {
  gender: 'male' | 'female';
  mainSkin: T.SkinnedMesh;
  topology: TopologyTemplate;
  clavicleL: T.Bone | null;
  clavicleR: T.Bone | null;
  spine02: T.Bone | null;
  ballL: T.Bone | null;
  ballR: T.Bone | null;
  clavicleLRestLocal: T.Quaternion;
  clavicleRRestLocal: T.Quaternion;
  spine02RestLocal: T.Quaternion;
  spine02RestBasis: T.Quaternion;
  ballLRestLocal: T.Quaternion;
  ballLRestBasis: T.Quaternion;
  ballRRestLocal: T.Quaternion;
  ballRRestBasis: T.Quaternion;
  lastProportionRevision: number;
  lastDeltaMushIterations: number;
  activePassThrough: boolean;
  lastCoupledDiagnostics: CoupledRigDiagnostics;

  // Refreshed per bodyType change
  morphedSplitBindPos: Float32Array;
  morphedSplitBindNorm: Float32Array;
  restWeldedPos: Float32Array;
  bindBoneInverses: T.Matrix4[];
  bindBonePos: Float32Array;
  limbSegs: LimbSegRest[];
  weldedWeightAxialS: Float32Array;
  restDeltasTS: Float32Array;
  restRefEdgeLen: Float32Array;
  envelope: BodyEnvelopeRadii;

  // Preallocated zero-GC evaluation buffers
  boneSkinMat: Float32Array;
  boneQuat: Float32Array;
  boneTrans: Float32Array;
  boneDual: Float32Array;
  posedBonePos: Float32Array;
  posedBoneRot9: Float32Array;
  segProxTwist: Float32Array;
  segDistTwist: Float32Array;
  skinnedPos: Float32Array;
  smoothBufA: Float32Array;
  smoothBufB: Float32Array;
  weldedPos: Float32Array;
  smoothWeldNorm: Float32Array;
  normGroupAccum: Float64Array;

  // Pose & bone-skinning dirty caches for O(1) unchanged-pose short-circuiting
  hasCachedAppliedPose: boolean;
  lastAppliedPose48: Float32Array;
  lastAppliedJointQuats64: Float32Array;
  lastAppliedMetaKey: string;
  hasCachedDeformation: boolean;
  lastDeformedBoneQuatTrans: Float32Array;
  lastDeformedMetaKey: string;
  lastDeformationDiagnostics: SkinDeformationDiagnostics | null;
}

const topologyCache = new Map<string, TopologyTemplate>();
const POSE_DIRTY_EPSILON = 1e-6;
const BONE_TRANS_EPSILON = 1e-6;
const BONE_QUAT_DOT_MIN = 1 - 1e-9;

// Reusable module-level temporaries (never escaped)
const _matA = new T.Matrix4();
const _matB = new T.Matrix4();
const _matSkinInv = new T.Matrix4();
const _quatA = new T.Quaternion();
const _quatB = new T.Quaternion();
const _quatC = new T.Quaternion();
const _quatD = new T.Quaternion();
const _quatId = new T.Quaternion();
const _quatChestTarget = new T.Quaternion();
const _quatChestWorld = new T.Quaternion();
const _quatChestChar = new T.Quaternion();
const _quatUpperTarget = new T.Quaternion();
const _quatElevWorld = new T.Quaternion();
const _quatProtWorld = new T.Quaternion();
const _quatClavParent = new T.Quaternion();
const _quatClavRestWorld = new T.Quaternion();
const _quatAbduct = new T.Quaternion();
const _quatCurUpperWorld = new T.Quaternion();
const _quatParentInv = new T.Quaternion();
const _eulerA = new T.Euler();
const _vecA = new T.Vector3();
const _vecB = new T.Vector3();
const _vecC = new T.Vector3();
const _vecScale = new T.Vector3();
const _savedRootPos = new T.Vector3();
const _savedRootQuat = new T.Quaternion();
const _savedRootScale = new T.Vector3();
const _spineAxisX = new T.Vector3();
const _spineAxisY = new T.Vector3();
const _spineAxisZ = new T.Vector3();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sanitizeAngle(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

const NON_CANONICAL_LIMB_LIMITS: Partial<Record<Joint, JointEulerBounds>> = {
  leftShoulder: { min: [-180 * DEG, -180 * DEG, -180 * DEG], max: [180 * DEG, 180 * DEG, 180 * DEG] },
  rightShoulder: { min: [-180 * DEG, -180 * DEG, -180 * DEG], max: [180 * DEG, 180 * DEG, 180 * DEG] },
  leftElbow: { min: [-165 * DEG, -180 * DEG, -165 * DEG], max: [165 * DEG, 180 * DEG, 165 * DEG] },
  rightElbow: { min: [-165 * DEG, -180 * DEG, -165 * DEG], max: [165 * DEG, 180 * DEG, 165 * DEG] },
  leftWrist: { min: [-155 * DEG, -180 * DEG, -155 * DEG], max: [155 * DEG, 180 * DEG, 155 * DEG] },
  rightWrist: { min: [-155 * DEG, -180 * DEG, -155 * DEG], max: [155 * DEG, 180 * DEG, 155 * DEG] },
  leftHip: { min: [-150 * DEG, -95 * DEG, -95 * DEG], max: [80 * DEG, 95 * DEG, 95 * DEG] },
  rightHip: { min: [-150 * DEG, -95 * DEG, -95 * DEG], max: [80 * DEG, 95 * DEG, 95 * DEG] },
  leftKnee: { min: [-25 * DEG, -65 * DEG, -45 * DEG], max: [165 * DEG, 65 * DEG, 45 * DEG] },
  rightKnee: { min: [-25 * DEG, -65 * DEG, -45 * DEG], max: [165 * DEG, 65 * DEG, 45 * DEG] },
  leftAnkle: { min: [-75 * DEG, -75 * DEG, -65 * DEG], max: [75 * DEG, 75 * DEG, 65 * DEG] },
  rightAnkle: { min: [-75 * DEG, -75 * DEG, -65 * DEG], max: [75 * DEG, 75 * DEG, 65 * DEG] },
};

const _clampEulerIn = new T.Euler();
const _clampEulerOut = new T.Euler();
const _clampQuatWorld = new T.Quaternion();
const _clampQuatLimb = new T.Quaternion();
const _clampFrameInv = new T.Quaternion();

function clampEulerOrderForJoint(joint: Joint): T.EulerOrder {
  return joint === 'leftWrist' ||
    joint === 'rightWrist' ||
    joint === 'leftElbow' ||
    joint === 'rightElbow'
    ? 'YXZ'
    : 'XYZ';
}

function resolveLimbClampFrame(joint: Joint, morphology: MorphologyProfile): T.Quaternion | null {
  switch (joint) {
    case 'leftShoulder':
      return morphology.leftArm.upperBindFrame;
    case 'rightShoulder':
      return morphology.rightArm.upperBindFrame;
    case 'leftElbow':
    case 'leftWrist':
      return morphology.leftArm.lowerBindFrame;
    case 'rightElbow':
    case 'rightWrist':
      return morphology.rightArm.lowerBindFrame;
    case 'leftHip':
      return morphology.leftLeg.upperBindFrame;
    case 'rightHip':
      return morphology.rightLeg.upperBindFrame;
    case 'leftKnee':
    case 'leftAnkle':
      return morphology.leftLeg.lowerBindFrame;
    case 'rightKnee':
    case 'rightAnkle':
      return morphology.rightLeg.lowerBindFrame;
    default:
      return null;
  }
}

export function clampPoseToAnatomicalLimits(
  pose: Pose,
  mode: PoseLimitMode = 'anatomical',
  morphology?: MorphologyProfile | null,
): Pose {
  const out = {} as Pose;
  const nonCanonical = Boolean(morphology && !morphology.isCanonicalMannequin);
  for (const j of JOINTS) {
    const src = pose[j] ?? [0, 0, 0];
    const rx = sanitizeAngle(src[0]);
    const ry = sanitizeAngle(src[1]);
    const rz = sanitizeAngle(src[2]);
    if (mode === 'free') {
      out[j] = [rx, ry, rz];
      continue;
    }
    if (nonCanonical && morphology) {
      const frame = resolveLimbClampFrame(j, morphology);
      const limbBounds = NON_CANONICAL_LIMB_LIMITS[j];
      if (frame && limbBounds) {
        const order = clampEulerOrderForJoint(j);
        _clampEulerIn.set(rx, ry, rz, 'XYZ');
        _clampQuatWorld.setFromEuler(_clampEulerIn);
        _clampFrameInv.copy(frame).invert();
        _clampQuatLimb.copy(_clampFrameInv).multiply(_clampQuatWorld).multiply(frame);
        _clampEulerOut.setFromQuaternion(_clampQuatLimb, order);
        const cx = clamp(_clampEulerOut.x, limbBounds.min[0], limbBounds.max[0]);
        const cy = clamp(_clampEulerOut.y, limbBounds.min[1], limbBounds.max[1]);
        const cz = clamp(_clampEulerOut.z, limbBounds.min[2], limbBounds.max[2]);
        const wasClamped =
          Math.abs(cx - _clampEulerOut.x) > 1e-6 ||
          Math.abs(cy - _clampEulerOut.y) > 1e-6 ||
          Math.abs(cz - _clampEulerOut.z) > 1e-6;
        if (!wasClamped) {
          out[j] = [rx, ry, rz];
        } else {
          _clampEulerIn.set(cx, cy, cz, order);
          _clampQuatLimb.setFromEuler(_clampEulerIn);
          _clampQuatWorld.copy(frame).multiply(_clampQuatLimb).multiply(_clampFrameInv);
          _clampEulerOut.setFromQuaternion(_clampQuatWorld, 'XYZ');
          out[j] = [_clampEulerOut.x, _clampEulerOut.y, _clampEulerOut.z];
        }
        continue;
      }
    }
    const bounds = ANATOMICAL_JOINT_LIMITS[j];
    if (j === 'leftWrist' || j === 'rightWrist') {
      _clampEulerIn.set(rx, ry, rz, 'XYZ');
      _clampQuatWorld.setFromEuler(_clampEulerIn);
      _clampEulerOut.setFromQuaternion(_clampQuatWorld, 'YXZ');
      const cx = clamp(_clampEulerOut.x, bounds.min[0], bounds.max[0]);
      const cy = clamp(_clampEulerOut.y, bounds.min[1], bounds.max[1]);
      const cz = clamp(_clampEulerOut.z, bounds.min[2], bounds.max[2]);
      const wasClamped =
        Math.abs(cx - _clampEulerOut.x) > 1e-6 ||
        Math.abs(cy - _clampEulerOut.y) > 1e-6 ||
        Math.abs(cz - _clampEulerOut.z) > 1e-6;
      if (!wasClamped) {
        out[j] = [rx, ry, rz];
      } else {
        _clampEulerIn.set(cx, cy, cz, 'YXZ');
        _clampQuatWorld.setFromEuler(_clampEulerIn);
        _clampEulerOut.setFromQuaternion(_clampQuatWorld, 'XYZ');
        out[j] = [_clampEulerOut.x, _clampEulerOut.y, _clampEulerOut.z];
      }
      continue;
    }
    out[j] = [
      clamp(rx, bounds.min[0], bounds.max[0]),
      clamp(ry, bounds.min[1], bounds.max[1]),
      clamp(rz, bounds.min[2], bounds.max[2]),
    ];
  }
  return out;
}

function classifyBoneRole(name: string): number {
  if (name === 'Head') return BONE_ROLE_HEAD;
  if (name === 'hand_l' || name === 'hand_r') return BONE_ROLE_HAND;
  if (name === 'foot_l' || name === 'foot_r') return BONE_ROLE_FOOT;
  if (name === 'ball_l' || name === 'ball_r' || name === 'ball_leaf_l' || name === 'ball_leaf_r') {
    return BONE_ROLE_TOE;
  }
  if (/^(thumb|index|middle|ring|pinky)_.*_[lr]$/.test(name)) {
    return BONE_ROLE_FINGER;
  }
  return BONE_ROLE_OTHER;
}

function buildTopologyTemplate(gender: 'male' | 'female', mainSkin: T.SkinnedMesh): TopologyTemplate {
  const geo = mainSkin.geometry;
  const posAttr = geo.getAttribute('position') as T.BufferAttribute;
  let normAttr = geo.getAttribute('normal') as T.BufferAttribute | undefined;
  if (!normAttr) {
    geo.computeVertexNormals();
    normAttr = geo.getAttribute('normal') as T.BufferAttribute;
  }
  const skinIdxAttr = geo.getAttribute('skinIndex') as T.BufferAttribute;
  const skinWgtAttr = geo.getAttribute('skinWeight') as T.BufferAttribute;
  const indexAttr = geo.getIndex();

  const splitCount = posAttr.count;
  const triVertCount = indexAttr ? indexAttr.count : splitCount;
  const cacheKey = `${gender}:${splitCount}:${triVertCount}:${mainSkin.skeleton.bones.length}`;
  const cached = topologyCache.get(cacheKey);
  if (cached) return cached;

  const preparsedWeld = getMannequinWeldTable(gender, mainSkin.name || 'Body', splitCount);
  let vToWeld: Int32Array;
  let weldToFirstV: Int32Array;
  let weldCount: number;
  let normWeldCanon: Int32Array;
  let normWeldGroupCount: number;

  if (preparsedWeld) {
    vToWeld = preparsedWeld.vToWeld;
    weldToFirstV = preparsedWeld.weldToFirstV;
    weldCount = preparsedWeld.weldCount;
    normWeldCanon = vToWeld;
    normWeldGroupCount = weldCount;
  } else {
    vToWeld = new Int32Array(splitCount);
    const weldFirstList: number[] = [];
    const posMap = new Map<string, number>();

    normWeldCanon = new Int32Array(splitCount);
    const normMap = new Map<string, number>();
    normWeldGroupCount = 0;

    for (let i = 0; i < splitCount; i++) {
      const px = posAttr.getX(i);
      const py = posAttr.getY(i);
      const pz = posAttr.getZ(i);
      const pKey = `${Math.round(px * 1e5)},${Math.round(py * 1e5)},${Math.round(pz * 1e5)}`;
      let wIdx = posMap.get(pKey);
      if (wIdx === undefined) {
        wIdx = weldFirstList.length;
        weldFirstList.push(i);
        posMap.set(pKey, wIdx);
      }
      vToWeld[i] = wIdx;

      const nx = normAttr.getX(i);
      const ny = normAttr.getY(i);
      const nz = normAttr.getZ(i);
      const nKey = `${pKey}|${Math.round(nx * 2e3)},${Math.round(ny * 2e3)},${Math.round(nz * 2e3)}`;
      let nGroup = normMap.get(nKey);
      if (nGroup === undefined) {
        nGroup = normWeldGroupCount++;
        normMap.set(nKey, nGroup);
      }
      normWeldCanon[i] = nGroup;
    }

    weldCount = weldFirstList.length;
    weldToFirstV = Int32Array.from(weldFirstList);
  }

  const triIndices = new Int32Array(triVertCount);
  if (indexAttr) {
    for (let i = 0; i < triVertCount; i++) triIndices[i] = indexAttr.getX(i);
  } else {
    for (let i = 0; i < triVertCount; i++) triIndices[i] = i;
  }

  // Fast flat two-pass welded CSR 1-ring graph (avoids 53k Set allocations)
  const maxDegreeCap = new Int32Array(weldCount);
  for (let i = 0; i + 2 < triVertCount; i += 3) {
    const wa = vToWeld[triIndices[i]!]!;
    const wb = vToWeld[triIndices[i + 1]!]!;
    const wc = vToWeld[triIndices[i + 2]!]!;
    if (wa !== wb) { maxDegreeCap[wa]!++; maxDegreeCap[wb]!++; }
    if (wb !== wc) { maxDegreeCap[wb]!++; maxDegreeCap[wc]!++; }
    if (wc !== wa) { maxDegreeCap[wc]!++; maxDegreeCap[wa]!++; }
  }
  const tmpOffsets = new Int32Array(weldCount + 1);
  let capTotal = 0;
  for (let w = 0; w < weldCount; w++) {
    tmpOffsets[w] = capTotal;
    capTotal += maxDegreeCap[w]!;
  }
  tmpOffsets[weldCount] = capTotal;
  const tmpCols = new Int32Array(capTotal);
  const rowCounts = new Int32Array(weldCount);
  const addDirectedUnique = (u: number, v: number) => {
    const base = tmpOffsets[u]!;
    const len = rowCounts[u]!;
    for (let k = 0; k < len; k++) {
      if (tmpCols[base + k] === v) return;
    }
    tmpCols[base + len] = v;
    rowCounts[u] = len + 1;
  };
  for (let i = 0; i + 2 < triVertCount; i += 3) {
    const wa = vToWeld[triIndices[i]!]!;
    const wb = vToWeld[triIndices[i + 1]!]!;
    const wc = vToWeld[triIndices[i + 2]!]!;
    if (wa !== wb) { addDirectedUnique(wa, wb); addDirectedUnique(wb, wa); }
    if (wb !== wc) { addDirectedUnique(wb, wc); addDirectedUnique(wc, wb); }
    if (wc !== wa) { addDirectedUnique(wc, wa); addDirectedUnique(wa, wc); }
  }
  const csrRowOffsets = new Int32Array(weldCount + 1);
  let totalEdges = 0;
  for (let w = 0; w < weldCount; w++) {
    csrRowOffsets[w] = totalEdges;
    totalEdges += rowCounts[w]!;
  }
  csrRowOffsets[weldCount] = totalEdges;
  const csrColIndices = new Int32Array(totalEdges);
  for (let w = 0; w < weldCount; w++) {
    const srcStart = tmpOffsets[w]!;
    const dstStart = csrRowOffsets[w]!;
    const len = rowCounts[w]!;
    for (let k = 0; k < len; k++) {
      csrColIndices[dstStart + k] = tmpCols[srcStart + k]!;
    }
  }

  // Bone index lookup
  const bones = mainSkin.skeleton.bones;
  const boneCount = bones.length;
  const byName = new Map<string, number>();
  const boneRole = new Uint8Array(boneCount);
  bones.forEach((b, idx) => {
    byName.set(b.name, idx);
    boneRole[idx] = classifyBoneRole(b.name);
  });

  const req = (name: string): number => byName.get(name) ?? 0;
  const opt = (name: string): number => byName.get(name) ?? -1;
  const boneLookup: BoneLookup = {
    pelvis: req('pelvis'),
    spine01: req('spine_01'),
    spine02: req('spine_02'),
    spine03: req('spine_03'),
    neck01: req('neck_01'),
    head: req('Head'),
    clavicleL: req('clavicle_l'),
    upperarmL: req('upperarm_l'),
    lowerarmL: req('lowerarm_l'),
    handL: req('hand_l'),
    clavicleR: req('clavicle_r'),
    upperarmR: req('upperarm_r'),
    lowerarmR: req('lowerarm_r'),
    handR: req('hand_r'),
    thighL: req('thigh_l'),
    calfL: req('calf_l'),
    footL: req('foot_l'),
    ballL: req('ball_l'),
    ballLeafL: opt('ball_leaf_l'),
    thighR: req('thigh_r'),
    calfR: req('calf_r'),
    footR: req('foot_r'),
    ballR: req('ball_r'),
    ballLeafR: opt('ball_leaf_r'),
  };

  const boneToTwistSeg = new Int8Array(boneCount).fill(SEG_NONE);
  boneToTwistSeg[boneLookup.upperarmL] = SEG_UPPERARM_L;
  boneToTwistSeg[boneLookup.lowerarmL] = SEG_LOWERARM_L;
  boneToTwistSeg[boneLookup.upperarmR] = SEG_UPPERARM_R;
  boneToTwistSeg[boneLookup.lowerarmR] = SEG_LOWERARM_R;
  boneToTwistSeg[boneLookup.thighL] = SEG_THIGH_L;
  boneToTwistSeg[boneLookup.calfL] = SEG_CALF_L;
  boneToTwistSeg[boneLookup.thighR] = SEG_THIGH_R;
  boneToTwistSeg[boneLookup.calfR] = SEG_CALF_R;

  const isLeftBone = new Int8Array(boneCount);
  bones.forEach((b, idx) => {
    if (b.name.endsWith('_l')) isLeftBone[idx] = 1;
    else if (b.name.endsWith('_r')) isLeftBone[idx] = -1;
  });

  // Per-welded-vertex normalized 4-bone weights + cached anatomical weight channels
  const skinIdx4 = new Uint16Array(weldCount * 4);
  const skinWgt4 = new Float32Array(weldCount * 4);

  const wTorsoCore = new Float32Array(weldCount);
  const wPelvis = new Float32Array(weldCount);
  const wSpine1 = new Float32Array(weldCount);
  const wUpperArmL = new Float32Array(weldCount);
  const wLowerArmL = new Float32Array(weldCount);
  const wHandChainL = new Float32Array(weldCount);
  const wUpperArmR = new Float32Array(weldCount);
  const wLowerArmR = new Float32Array(weldCount);
  const wHandChainR = new Float32Array(weldCount);
  const wThighL = new Float32Array(weldCount);
  const wCalfL = new Float32Array(weldCount);
  const wFootChainL = new Float32Array(weldCount);
  const wThighR = new Float32Array(weldCount);
  const wCalfR = new Float32Array(weldCount);
  const wFootChainR = new Float32Array(weldCount);

  const rawMush = new Float32Array(weldCount);

  for (let w = 0; w < weldCount; w++) {
    const v = weldToFirstV[w]!;
    const i0 = Math.round(skinIdxAttr.getX(v));
    const i1 = Math.round(skinIdxAttr.getY(v));
    const i2 = Math.round(skinIdxAttr.getZ(v));
    const i3 = Math.round(skinIdxAttr.getW(v));
    let g0 = skinWgtAttr.getX(v);
    let g1 = skinWgtAttr.getY(v);
    let g2 = skinWgtAttr.getZ(v);
    let g3 = skinWgtAttr.getW(v);
    const sum = g0 + g1 + g2 + g3;
    if (sum > 1e-8) {
      const inv = 1 / sum;
      g0 *= inv; g1 *= inv; g2 *= inv; g3 *= inv;
    } else {
      g0 = 1; g1 = 0; g2 = 0; g3 = 0;
    }

    // Sort 4 influences descending by weight so slot 0 is always the dominant DQS hemisphere pivot!
    const pairs: Array<[number, number]> = [
      [i0, g0],
      [i1, g1],
      [i2, g2],
      [i3, g3],
    ];
    pairs.sort((a, b) => b[1] - a[1]);

    let wHead = 0;
    let wFinger = 0;
    let wToe = 0;
    let wHand = 0;
    let wFoot = 0;
    let wShoulderHipZone = 0;

    for (let k = 0; k < 4; k++) {
      const bIdx = pairs[k]![0];
      const bw = pairs[k]![1];
      skinIdx4[w * 4 + k] = bIdx;
      skinWgt4[w * 4 + k] = bw;
      if (bw <= 0) continue;

      const role = boneRole[bIdx]!;
      if (role === BONE_ROLE_HEAD) wHead += bw;
      else if (role === BONE_ROLE_FINGER) wFinger += bw;
      else if (role === BONE_ROLE_TOE) wToe += bw;
      else if (role === BONE_ROLE_HAND) wHand += bw;
      else if (role === BONE_ROLE_FOOT) wFoot += bw;

      if (bIdx === boneLookup.pelvis) { wPelvis[w]! += bw; wTorsoCore[w]! += bw; wShoulderHipZone += bw * 0.6; }
      else if (bIdx === boneLookup.spine01) { wSpine1[w]! += bw; wTorsoCore[w]! += bw; }
      else if (bIdx === boneLookup.spine02) { wTorsoCore[w]! += bw; }
      else if (bIdx === boneLookup.spine03) { wTorsoCore[w]! += bw; wShoulderHipZone += bw * 0.5; }
      else if (bIdx === boneLookup.clavicleL || bIdx === boneLookup.clavicleR) { wTorsoCore[w]! += bw * 0.5; wShoulderHipZone += bw; }
      else if (bIdx === boneLookup.upperarmL) { wUpperArmL[w]! += bw; wShoulderHipZone += bw * 0.45; }
      else if (bIdx === boneLookup.lowerarmL) { wLowerArmL[w]! += bw; }
      else if (bIdx === boneLookup.upperarmR) { wUpperArmR[w]! += bw; wShoulderHipZone += bw * 0.45; }
      else if (bIdx === boneLookup.lowerarmR) { wLowerArmR[w]! += bw; }
      else if (bIdx === boneLookup.thighL) { wThighL[w]! += bw; wShoulderHipZone += bw * 0.45; }
      else if (bIdx === boneLookup.calfL) { wCalfL[w]! += bw; }
      else if (bIdx === boneLookup.thighR) { wThighR[w]! += bw; wShoulderHipZone += bw * 0.45; }
      else if (bIdx === boneLookup.calfR) { wCalfR[w]! += bw; }

      if (role === BONE_ROLE_HAND || role === BONE_ROLE_FINGER) {
        if (isLeftBone[bIdx] === 1) wHandChainL[w]! += bw;
        else if (isLeftBone[bIdx] === -1) wHandChainR[w]! += bw;
      }
      if (role === BONE_ROLE_FOOT || role === BONE_ROLE_TOE) {
        if (isLeftBone[bIdx] === 1) wFootChainL[w]! += bw;
        else if (isLeftBone[bIdx] === -1) wFootChainR[w]! += bw;
      }
    }

    const maxW = pairs[0]![1];
    const multiBoneScore = clamp((1 - maxW) * 2.35, 0, 1);
    const zoneBoost = clamp(multiBoneScore + 0.25 * wShoulderHipZone, 0, 1);
    const rigidProtect =
      smoothstep(0.20, 0.65, wHead) +
      smoothstep(0.10, 0.45, wFinger) +
      smoothstep(0.25, 0.70, wToe) +
      smoothstep(0.75, 0.96, wHand + wFinger) +
      smoothstep(0.78, 0.96, wFoot + wToe);
    rawMush[w] = clamp(zoneBoost * (1 - clamp(rigidProtect, 0, 1)), 0, 1);
  }

  // Dilate/smooth mush mask over 2 graph hops so transition boundaries are C1 smooth
  const mushPass1 = new Float32Array(weldCount);
  const mushLambda = new Float32Array(weldCount);
  for (let w = 0; w < weldCount; w++) {
    const start = csrRowOffsets[w]!;
    const end = csrRowOffsets[w + 1]!;
    const deg = end - start;
    if (deg === 0) { mushPass1[w] = rawMush[w]!; continue; }
    let acc = rawMush[w]!;
    for (let e = start; e < end; e++) acc += rawMush[csrColIndices[e]!]!;
    mushPass1[w] = Math.max(rawMush[w]! * 0.85, acc / (deg + 1));
  }
  const activeList: number[] = [];
  for (let w = 0; w < weldCount; w++) {
    const start = csrRowOffsets[w]!;
    const end = csrRowOffsets[w + 1]!;
    const deg = end - start;
    let val = mushPass1[w]!;
    if (deg > 0) {
      let acc = val;
      for (let e = start; e < end; e++) acc += mushPass1[csrColIndices[e]!]!;
      val = acc / (deg + 1);
    }
    // Re-enforce strict zero on head, fingers, and toes
    const vHeadFinger =
      (skinIdx4[w * 4] === boneLookup.head && skinWgt4[w * 4]! > 0.6) ||
      boneRole[skinIdx4[w * 4]!] === BONE_ROLE_FINGER ||
      boneRole[skinIdx4[w * 4]!] === BONE_ROLE_TOE;
    const lambda = vHeadFinger ? 0 : 0.54 * val;
    mushLambda[w] = lambda > 1e-3 ? lambda : 0;
    if (mushLambda[w]! > 0) activeList.push(w);
  }

  // Choose stable primary & fallback 1-ring tangent neighbors per welded vertex
  const refNeighbor = new Int32Array(weldCount);
  const refNeighbor2 = new Int32Array(weldCount);
  for (let w = 0; w < weldCount; w++) {
    const v0 = weldToFirstV[w]!;
    const px = posAttr.getX(v0), py = posAttr.getY(v0), pz = posAttr.getZ(v0);
    const nx = normAttr.getX(v0), ny = normAttr.getY(v0), nz = normAttr.getZ(v0);
    const start = csrRowOffsets[w]!;
    const end = csrRowOffsets[w + 1]!;
    let bestNb = w;
    let secondNb = w;
    let bestScore = -1;
    let secondScore = -1;
    for (let e = start; e < end; e++) {
      const nb = csrColIndices[e]!;
      const vn = weldToFirstV[nb]!;
      const dx = posAttr.getX(vn) - px;
      const dy = posAttr.getY(vn) - py;
      const dz = posAttr.getZ(vn) - pz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) continue;
      const dotN = Math.abs((dx * nx + dy * ny + dz * nz) / len);
      const tangency = (1 - dotN) * Math.min(len, 0.04);
      if (tangency > bestScore) {
        secondScore = bestScore;
        secondNb = bestNb;
        bestScore = tangency;
        bestNb = nb;
      } else if (tangency > secondScore) {
        secondScore = tangency;
        secondNb = nb;
      }
    }
    refNeighbor[w] = bestNb;
    refNeighbor2[w] = secondNb === w ? bestNb : secondNb;
  }

  // Pre-index Layer 3 anatomical candidate subsets so 53.5k-vertex meshes only touch active limb/joint regions
  const bulgeList: number[] = [];
  const elbLList: number[] = [];
  const elbRList: number[] = [];
  const kneeLList: number[] = [];
  const kneeRList: number[] = [];
  const hipLList: number[] = [];
  const hipRList: number[] = [];
  const distArmList: number[] = [];

  for (let w = 0; w < weldCount; w++) {
    const wUL = wUpperArmL[w]!, wLL = wLowerArmL[w]!;
    const wUR = wUpperArmR[w]!, wLR = wLowerArmR[w]!;
    const wTL = wThighL[w]!, wCL = wCalfL[w]!;
    const wTR = wThighR[w]!, wCR = wCalfR[w]!;
    const wPel = wPelvis[w]!, wTorso = wTorsoCore[w]!;

    if (
      wUL > 0.20 || wLL > 0.20 ||
      wUR > 0.20 || wLR > 0.20 ||
      wTL > 0.20 || wCL > 0.20 ||
      wTR > 0.20 || wCR > 0.20 ||
      wPel + wTL + wTR > 0.45
    ) {
      bulgeList.push(w);
    }
    if (wUL + wLL >= 0.30) elbLList.push(w);
    if (wUR + wLR >= 0.30) elbRList.push(w);
    if (wTL + wCL >= 0.30) kneeLList.push(w);
    if (wTR + wCR >= 0.30) kneeRList.push(w);
    if (wTorso + wTL >= 0.30) hipLList.push(w);
    if (wTorso + wTR >= 0.30) hipRList.push(w);
    if (wLL + wHandChainL[w]! + wLR + wHandChainR[w]! >= 0.35) distArmList.push(w);
  }

  const tpl: TopologyTemplate = {
    splitCount,
    weldCount,
    boneCount,
    vToWeld,
    weldToFirstV,
    normWeldCanon,
    normWeldGroupCount,
    triIndices,
    csrRowOffsets,
    csrColIndices,
    skinIdx4,
    skinWgt4,
    boneLookup,
    boneToTwistSeg,
    boneRole,
    mushLambda,
    mushActiveIndices: Int32Array.from(activeList),
    refNeighbor,
    refNeighbor2,
    weldWeightMap: {
      wTorsoCore,
      wPelvis,
      wSpine1,
      wUpperArmL,
      wLowerArmL,
      wHandChainL,
      wUpperArmR,
      wLowerArmR,
      wHandChainR,
      wThighL,
      wCalfL,
      wFootChainL,
      wThighR,
      wCalfR,
      wFootChainR,
    },
    bulgeCandidates: Int32Array.from(bulgeList),
    creaseElbL: Int32Array.from(elbLList),
    creaseElbR: Int32Array.from(elbRList),
    creaseKneeL: Int32Array.from(kneeLList),
    creaseKneeR: Int32Array.from(kneeRList),
    creaseHipL: Int32Array.from(hipLList),
    creaseHipR: Int32Array.from(hipRList),
    distArmCandidates: Int32Array.from(distArmList),
  };
  topologyCache.set(cacheKey, tpl);
  return tpl;
}

function detectFigureGender(figure: Figure, explicit?: Body): Body {
  if (explicit === 'male' || explicit === 'female') return explicit;
  if (figure.body === 'male' || figure.body === 'female') return figure.body;
  const udGender = figure.root.userData?.gender;
  if (udGender === 'male' || udGender === 'female') return udGender;
  let foundGender: Body | null = null;
  let mainSkin: T.SkinnedMesh | null = null;
  let mainCount = 0;
  figure.root.traverse(node => {
    const g = node.userData?.gender ?? node.userData?.pncGender;
    if (g === 'male' || g === 'female') foundGender = g;
    if (!foundGender && /female/i.test(node.name)) foundGender = 'female';
    else if (!foundGender && /\bmale\b/i.test(node.name)) foundGender = 'male';
    if (node instanceof T.SkinnedMesh) {
      const c = node.geometry.getAttribute('position').count;
      if (c > mainCount) {
        mainCount = c;
        mainSkin = node;
      }
    }
  });
  if (foundGender) return foundGender;
  if (mainSkin && mainCount > 20_000) {
    // Mannequin_Male native rest stature is 1.80 m vs Mannequin_Female 1.75 m
    const pos = (mainSkin as T.SkinnedMesh).geometry.getAttribute('position');
    let maxY = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i += 8) {
      const y = pos.getY(i);
      if (y > maxY) maxY = y;
      if (y < minY) minY = y;
    }
    return maxY - minY >= 1.775 ? 'male' : 'female';
  }
  return mainCount >= 7330 ? 'female' : 'male';
}

function findMainSkin(figureRoot: T.Object3D): T.SkinnedMesh {
  let best: T.SkinnedMesh | null = null;
  let bestCount = -1;
  figureRoot.traverse(node => {
    if (node instanceof T.SkinnedMesh) {
      const c = node.geometry.getAttribute('position').count;
      if (c > bestCount) {
        bestCount = c;
        best = node;
      }
    }
  });
  if (!best) {
    throw new Error('skinDeformer requires a Figure containing a main SkinnedMesh.');
  }
  return best;
}

function computeWeldedNormalsAndTangents(
  triIndices: Int32Array,
  vToWeld: Int32Array,
  positions: Float32Array,
  weldCount: number,
  outWeldedNorm: Float32Array,
): void {
  outWeldedNorm.fill(0);
  const triCount = triIndices.length;
  for (let i = 0; i + 2 < triCount; i += 3) {
    const wa = vToWeld[triIndices[i]!]! * 3;
    const wb = vToWeld[triIndices[i + 1]!]! * 3;
    const wc = vToWeld[triIndices[i + 2]!]! * 3;
    const ax = positions[wa]!, ay = positions[wa + 1]!, az = positions[wa + 2]!;
    const bx = positions[wb]!, by = positions[wb + 1]!, bz = positions[wb + 2]!;
    const cx = positions[wc]!, cy = positions[wc + 1]!, cz = positions[wc + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;
    outWeldedNorm[wa]! += fnx; outWeldedNorm[wa + 1]! += fny; outWeldedNorm[wa + 2]! += fnz;
    outWeldedNorm[wb]! += fnx; outWeldedNorm[wb + 1]! += fny; outWeldedNorm[wb + 2]! += fnz;
    outWeldedNorm[wc]! += fnx; outWeldedNorm[wc + 1]! += fny; outWeldedNorm[wc + 2]! += fnz;
  }
  for (let w = 0; w < weldCount; w++) {
    const b = w * 3;
    const nx = outWeldedNorm[b]!, ny = outWeldedNorm[b + 1]!, nz = outWeldedNorm[b + 2]!;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      const inv = 1 / len;
      outWeldedNorm[b] = nx * inv;
      outWeldedNorm[b + 1] = ny * inv;
      outWeldedNorm[b + 2] = nz * inv;
    } else {
      outWeldedNorm[b] = 0;
      outWeldedNorm[b + 1] = 1;
      outWeldedNorm[b + 2] = 0;
    }
  }
}

function runSelectiveCsrJacobi(
  srcPos: Float32Array,
  tpl: TopologyTemplate,
  iterations: number,
  bufA: Float32Array,
  bufB: Float32Array,
): Float32Array {
  bufA.set(srcPos);
  if (iterations <= 0) return bufA;
  bufB.set(srcPos);

  const { mushActiveIndices, mushLambda, csrRowOffsets, csrColIndices } = tpl;
  const activeCount = mushActiveIndices.length;
  let cur = bufA;
  let nxt = bufB;

  for (let it = 0; it < iterations; it++) {
    if (it > 0) nxt.set(cur);
    for (let idx = 0; idx < activeCount; idx++) {
      const w = mushActiveIndices[idx]!;
      const start = csrRowOffsets[w]!;
      const end = csrRowOffsets[w + 1]!;
      const deg = end - start;
      if (deg === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (let e = start; e < end; e++) {
        const nb3 = csrColIndices[e]! * 3;
        ax += cur[nb3]!;
        ay += cur[nb3 + 1]!;
        az += cur[nb3 + 2]!;
      }
      const invDeg = 1 / deg;
      const w3 = w * 3;
      const px = cur[w3]!, py = cur[w3 + 1]!, pz = cur[w3 + 2]!;
      const lam = mushLambda[w]!;
      nxt[w3] = px + lam * (ax * invDeg - px);
      nxt[w3 + 1] = py + lam * (ay * invDeg - py);
      nxt[w3 + 2] = pz + lam * (az * invDeg - pz);
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
  }
  return cur;
}

function buildVertexTangentBasis(
  w: number,
  smoothedPos: Float32Array,
  smoothedNorm: Float32Array,
  refNeighbor: Int32Array,
  refNeighbor2: Int32Array,
  outBasis9: Float32Array,
): number {
  const w3 = w * 3;
  const nx = smoothedNorm[w3]!, ny = smoothedNorm[w3 + 1]!, nz = smoothedNorm[w3 + 2]!;
  const px = smoothedPos[w3]!, py = smoothedPos[w3 + 1]!, pz = smoothedPos[w3 + 2]!;

  let nb = refNeighbor[w]!;
  let nb3 = nb * 3;
  let ex = smoothedPos[nb3]! - px;
  let ey = smoothedPos[nb3 + 1]! - py;
  let ez = smoothedPos[nb3 + 2]! - pz;
  const edgeLen = Math.sqrt(ex * ex + ey * ey + ez * ez);

  const proj = ex * nx + ey * ny + ez * nz;
  let tx = ex - proj * nx;
  let ty = ey - proj * ny;
  let tz = ez - proj * nz;
  let tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);

  if (tLen < 1e-6) {
    nb = refNeighbor2[w]!;
    nb3 = nb * 3;
    ex = smoothedPos[nb3]! - px;
    ey = smoothedPos[nb3 + 1]! - py;
    ez = smoothedPos[nb3 + 2]! - pz;
    const proj2 = ex * nx + ey * ny + ez * nz;
    tx = ex - proj2 * nx;
    ty = ey - proj2 * ny;
    tz = ez - proj2 * nz;
    tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
  }

  if (tLen < 1e-6) {
    // Analytic fallback perpendicular to normal
    if (Math.abs(ny) < 0.9) {
      tx = nz; ty = 0; tz = -nx;
    } else {
      tx = 1; ty = 0; tz = 0;
      const p3 = tx * nx;
      tx -= p3 * nx; ty -= p3 * ny; tz -= p3 * nz;
    }
    tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
  }

  const invT = 1 / tLen;
  tx *= invT; ty *= invT; tz *= invT;

  // b = n x t
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;

  outBasis9[0] = tx; outBasis9[1] = ty; outBasis9[2] = tz;
  outBasis9[3] = bx; outBasis9[4] = by; outBasis9[5] = bz;
  outBasis9[6] = nx; outBasis9[7] = ny; outBasis9[8] = nz;
  return edgeLen;
}

const _tmpBasis9 = new Float32Array(9);

function measureBodyEnvelope(
  restWeldedPos: Float32Array,
  bindBonePos: Float32Array,
  tpl: TopologyTemplate,
): BodyEnvelopeRadii {
  const { boneLookup: bl, weldCount, weldWeightMap: wm } = tpl;
  const pPelvisY = bindBonePos[bl.pelvis * 3 + 1]!, pPelvisZ = bindBonePos[bl.pelvis * 3 + 2]!;
  const pSpine1Y = bindBonePos[bl.spine01 * 3 + 1]!, pSpine1Z = bindBonePos[bl.spine01 * 3 + 2]!;
  const pSpine2Y = bindBonePos[bl.spine02 * 3 + 1]!, pSpine2Z = bindBonePos[bl.spine02 * 3 + 2]!;
  const pSpine3Y = bindBonePos[bl.spine03 * 3 + 1]!, pSpine3Z = bindBonePos[bl.spine03 * 3 + 2]!;
  const pHeadY = bindBonePos[bl.head * 3 + 1]!, pHeadZ = bindBonePos[bl.head * 3 + 2]!;

  let pelvisMaxX = 0.13, pelvisFrontZ = 0.09, pelvisBackZ = 0.09;
  let waistMaxX = 0.12, waistFrontZ = 0.09, waistBackZ = 0.09;
  let bellyMaxFrontZ = 0.10;
  let chestMaxX = 0.14, chestFrontZ = 0.10, chestBackZ = 0.09;
  let bustPeakFrontZ = 0.10, bustPeakX = 0.075;
  let headMaxR = 0.10;
  let upperArmR = 0.045, forearmR = 0.036, thighR = 0.072, calfR = 0.052;

  const pUpperArmLY = bindBonePos[bl.upperarmL * 3 + 1]!, pUpperArmLZ = bindBonePos[bl.upperarmL * 3 + 2]!;
  const pLowerArmLY = bindBonePos[bl.lowerarmL * 3 + 1]!, pLowerArmLZ = bindBonePos[bl.lowerarmL * 3 + 2]!;
  const pThighLX = bindBonePos[bl.thighL * 3]!, pThighLZ = bindBonePos[bl.thighL * 3 + 2]!;
  const pCalfLX = bindBonePos[bl.calfL * 3]!, pCalfLZ = bindBonePos[bl.calfL * 3 + 2]!;

  for (let w = 0; w < weldCount; w++) {
    const x = restWeldedPos[w * 3]!;
    const y = restWeldedPos[w * 3 + 1]!;
    const z = restWeldedPos[w * 3 + 2]!;
    const ax = Math.abs(x);

    if (wm.wTorsoCore[w]! > 0.45 && wm.wUpperArmL[w]! + wm.wUpperArmR[w]! < 0.15) {
      if (Math.abs(y - pPelvisY) < 0.05) {
        if (ax > pelvisMaxX) pelvisMaxX = ax;
        if (z - pPelvisZ > pelvisFrontZ) pelvisFrontZ = z - pPelvisZ;
        if (pPelvisZ - z > pelvisBackZ) pelvisBackZ = pPelvisZ - z;
      }
      if (Math.abs(y - pSpine2Y) < 0.045) {
        if (ax > waistMaxX) waistMaxX = ax;
        if (z - pSpine2Z > waistFrontZ) waistFrontZ = z - pSpine2Z;
        if (pSpine2Z - z > waistBackZ) waistBackZ = pSpine2Z - z;
      }
      const yBelly = 0.55 * pSpine1Y + 0.45 * pSpine2Y;
      if (Math.abs(y - yBelly) < 0.07 && z - pSpine1Z > bellyMaxFrontZ) {
        bellyMaxFrontZ = z - pSpine1Z;
      }
      if (Math.abs(y - (pSpine3Y + 0.02)) < 0.055) {
        if (ax > chestMaxX && ax < 0.22) chestMaxX = ax;
        if (pSpine3Z - z > chestBackZ) chestBackZ = pSpine3Z - z;
        if (z - pSpine3Z > chestFrontZ) chestFrontZ = z - pSpine3Z;
        if (ax > 0.03 && ax < 0.16 && z - pSpine3Z > bustPeakFrontZ) {
          bustPeakFrontZ = z - pSpine3Z;
          bustPeakX = ax;
        }
      }
    }

    if (tpl.skinIdx4[w * 4] === bl.head && tpl.skinWgt4[w * 4]! > 0.7) {
      const hr = Math.hypot(x, y - (pHeadY + 0.08), z - pHeadZ);
      if (hr > headMaxR) headMaxR = hr;
    }
    if (wm.wUpperArmL[w]! > 0.75) {
      const r = Math.hypot(y - pUpperArmLY, z - pUpperArmLZ);
      if (r < 0.12 && r > upperArmR) upperArmR = r;
    }
    if (wm.wLowerArmL[w]! > 0.75) {
      const r = Math.hypot(y - pLowerArmLY, z - pLowerArmLZ);
      if (r < 0.10 && r > forearmR) forearmR = r;
    }
    if (wm.wThighL[w]! > 0.75) {
      const r = Math.hypot(x - pThighLX, z - pThighLZ);
      if (r < 0.16 && r > thighR) thighR = r;
    }
    if (wm.wCalfL[w]! > 0.75) {
      const r = Math.hypot(x - pCalfLX, z - pCalfLZ);
      if (r < 0.12 && r > calfR) calfR = r;
    }
  }

  const extraBelly = Math.max(0, bellyMaxFrontZ - 0.10);
  const bustExcess = Math.max(0, bustPeakFrontZ - 0.105);

  return {
    pelvisRx: pelvisMaxX * 0.90,
    pelvisRz: 0.5 * (pelvisFrontZ + pelvisBackZ) * 0.92,
    waistRx: waistMaxX * 0.92,
    waistRz: 0.5 * (waistFrontZ + waistBackZ) * 0.92,
    bellyFrontOffsetZ: 0.025 + extraBelly * 0.52,
    bellyRadius: Math.max(waistMaxX * 0.76, 0.085 + extraBelly * 0.58),
    chestRx: chestMaxX * 0.88,
    chestRz: 0.5 * (Math.min(chestFrontZ, 0.13) + chestBackZ) * 0.92,
    bustRadius: bustExcess > 0.008 ? 0.052 + bustExcess * 0.55 : 0,
    bustOffsetX: bustPeakX,
    bustOffsetY: 0.02,
    bustOffsetZ: Math.max(0.055, bustPeakFrontZ - (0.048 + bustExcess * 0.52)),
    headRadius: headMaxR * 0.88,
    upperArmR: upperArmR * 0.82,
    forearmR: forearmR * 0.82,
    thighR: thighR * 0.86,
    calfR: calfR * 0.84,
  };
}

function refreshMorphedBindSnapshot(state: FigureSkinState, deltaMushIterations: number): void {
  const { mainSkin, topology: tpl } = state;
  const posAttr = mainSkin.geometry.getAttribute('position') as T.BufferAttribute;
  const normAttr = mainSkin.geometry.getAttribute('normal') as T.BufferAttribute;
  const { splitCount, weldCount, weldToFirstV, boneCount, boneLookup: bl } = tpl;

  state.morphedSplitBindPos.set((posAttr.array as Float32Array).subarray(0, splitCount * 3));
  state.morphedSplitBindNorm.set((normAttr.array as Float32Array).subarray(0, splitCount * 3));

  for (let w = 0; w < weldCount; w++) {
    const v3 = weldToFirstV[w]! * 3;
    const w3 = w * 3;
    state.restWeldedPos[w3] = state.morphedSplitBindPos[v3]!;
    state.restWeldedPos[w3 + 1] = state.morphedSplitBindPos[v3 + 1]!;
    state.restWeldedPos[w3 + 2] = state.morphedSplitBindPos[v3 + 2]!;
  }

  for (let b = 0; b < boneCount; b++) {
    const inv = mainSkin.skeleton.boneInverses[b]!;
    state.bindBoneInverses[b]!.copy(inv);
    _matA.copy(inv).invert();
    state.bindBonePos[b * 3] = _matA.elements[12]!;
    state.bindBonePos[b * 3 + 1] = _matA.elements[13]!;
    state.bindBonePos[b * 3 + 2] = _matA.elements[14]!;
  }

  // Build 8 limb segment rest descriptors in morphed bind space
  const makeSeg = (
    boneIdx: number,
    parentBoneIdx: number,
    childBoneIdx: number,
    proxUnwindScale: number,
    distAdvanceScale: number,
    sStart: number,
    sEnd: number,
  ): LimbSegRest => {
    const p0x = state.bindBonePos[boneIdx * 3]!;
    const p0y = state.bindBonePos[boneIdx * 3 + 1]!;
    const p0z = state.bindBonePos[boneIdx * 3 + 2]!;
    const p1x = state.bindBonePos[childBoneIdx * 3]!;
    const p1y = state.bindBonePos[childBoneIdx * 3 + 1]!;
    const p1z = state.bindBonePos[childBoneIdx * 3 + 2]!;
    const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    return {
      boneIdx,
      parentBoneIdx,
      childBoneIdx,
      p0x,
      p0y,
      p0z,
      ax: dx / len,
      ay: dy / len,
      az: dz / len,
      len,
      proxUnwindScale,
      distAdvanceScale,
      sStart,
      sEnd,
    };
  };

  state.limbSegs = [
    makeSeg(bl.upperarmL, bl.clavicleL, bl.lowerarmL, 0.85, 0.0, 0.08, 0.90),
    makeSeg(bl.lowerarmL, bl.upperarmL, bl.handL, 0.92, 1.0, 0.05, 0.95),
    makeSeg(bl.upperarmR, bl.clavicleR, bl.lowerarmR, 0.85, 0.0, 0.08, 0.90),
    makeSeg(bl.lowerarmR, bl.upperarmR, bl.handR, 0.92, 1.0, 0.05, 0.95),
    makeSeg(bl.thighL, bl.pelvis, bl.calfL, 0.82, 0.0, 0.08, 0.88),
    makeSeg(bl.calfL, bl.thighL, bl.footL, 0.85, 0.45, 0.06, 0.92),
    makeSeg(bl.thighR, bl.pelvis, bl.calfR, 0.82, 0.0, 0.08, 0.88),
    makeSeg(bl.calfR, bl.thighR, bl.footR, 0.85, 0.45, 0.06, 0.92),
  ];

  // Precompute axial coordinate s along each vertex's 4 weighted limb bones
  for (let w = 0; w < weldCount; w++) {
    const vx = state.restWeldedPos[w * 3]!;
    const vy = state.restWeldedPos[w * 3 + 1]!;
    const vz = state.restWeldedPos[w * 3 + 2]!;
    for (let k = 0; k < 4; k++) {
      const bIdx = tpl.skinIdx4[w * 4 + k]!;
      const segIdx = tpl.boneToTwistSeg[bIdx]!;
      if (segIdx === SEG_NONE) {
        state.weldedWeightAxialS[w * 4 + k] = 0;
      } else {
        const seg = state.limbSegs[segIdx]!;
        const proj = (vx - seg.p0x) * seg.ax + (vy - seg.p0y) * seg.ay + (vz - seg.p0z) * seg.az;
        state.weldedWeightAxialS[w * 4 + k] = clamp(proj / seg.len, 0, 1);
      }
    }
  }

  // Precompute Delta Mush rest tangent-space detail vectors so neutral rest pose reconstructs to 1e-7
  const restSmoothed = runSelectiveCsrJacobi(
    state.restWeldedPos,
    tpl,
    deltaMushIterations,
    state.smoothBufA,
    state.smoothBufB,
  );
  computeWeldedNormalsAndTangents(
    tpl.triIndices,
    tpl.vToWeld,
    restSmoothed,
    weldCount,
    state.smoothWeldNorm,
  );
  for (let w = 0; w < weldCount; w++) {
    const w3 = w * 3;
    if (tpl.mushLambda[w]! <= 0) {
      state.restDeltasTS[w3] = 0;
      state.restDeltasTS[w3 + 1] = 0;
      state.restDeltasTS[w3 + 2] = 0;
      state.restRefEdgeLen[w] = 1;
      continue;
    }
    const edgeLen = buildVertexTangentBasis(
      w,
      restSmoothed,
      state.smoothWeldNorm,
      tpl.refNeighbor,
      tpl.refNeighbor2,
      _tmpBasis9,
    );
    state.restRefEdgeLen[w] = Math.max(edgeLen, 1e-5);
    const dx = state.restWeldedPos[w3]! - restSmoothed[w3]!;
    const dy = state.restWeldedPos[w3 + 1]! - restSmoothed[w3 + 1]!;
    const dz = state.restWeldedPos[w3 + 2]! - restSmoothed[w3 + 2]!;
    state.restDeltasTS[w3] = dx * _tmpBasis9[0]! + dy * _tmpBasis9[1]! + dz * _tmpBasis9[2]!;
    state.restDeltasTS[w3 + 1] = dx * _tmpBasis9[3]! + dy * _tmpBasis9[4]! + dz * _tmpBasis9[5]!;
    state.restDeltasTS[w3 + 2] = dx * _tmpBasis9[6]! + dy * _tmpBasis9[7]! + dz * _tmpBasis9[8]!;
  }

  state.envelope = measureBodyEnvelope(state.restWeldedPos, state.bindBonePos, tpl);
  state.activePassThrough = false;
  state.hasCachedAppliedPose = false;
  state.hasCachedDeformation = false;
  state.mainSkin.userData.__skinDeformerPassThrough = false;
  if (state.mainSkin.geometry.boundsTree) {
    state.mainSkin.geometry.disposeBoundsTree?.();
    state.mainSkin.geometry.boundsTree = undefined;
  }
}

function restoreBindAttributesIfPassThrough(state: FigureSkinState): void {
  state.hasCachedAppliedPose = false;
  state.hasCachedDeformation = false;
  if (!state.activePassThrough) {
    state.mainSkin.userData.__skinDeformerPassThrough = false;
    return;
  }
  const { mainSkin } = state;
  const posAttr = mainSkin.geometry.getAttribute('position') as T.BufferAttribute;
  const normAttr = mainSkin.geometry.getAttribute('normal') as T.BufferAttribute;
  (posAttr.array as Float32Array).set(state.morphedSplitBindPos);
  (normAttr.array as Float32Array).set(state.morphedSplitBindNorm);
  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  for (let b = 0; b < state.bindBoneInverses.length; b++) {
    mainSkin.skeleton.boneInverses[b]!.copy(state.bindBoneInverses[b]!);
  }
  state.activePassThrough = false;
  mainSkin.userData.__skinDeformerPassThrough = false;
  if (mainSkin.geometry.boundsTree) {
    mainSkin.geometry.disposeBoundsTree?.();
    mainSkin.geometry.boundsTree = undefined;
  }
}

function resolveDeltaMushIterations(weldCount: number, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  // Subdivided Catmull-Clark meshes (>25k welded verts) already have fine smooth triangles, so 1 selective Jacobi pass matches 6 passes on coarse cages while avoiding double 107k-tri normal sweeps
  return weldCount > 25_000 ? 1 : 6;
}

function ensureFigureSkinState(figure: Figure, options?: SkinDeformerOptions): FigureSkinState {
  const existing = figureSkinStates.get(figure.root);
  const gender = detectFigureGender(figure, options?.gender);
  const desiredBodyType = options?.bodyType;

  if (existing) {
    const dmIters = resolveDeltaMushIterations(existing.topology.weldCount, options?.deltaMushIterations);
    if (desiredBodyType && isBodyTypeId(desiredBodyType) && figure.root.userData.bodyType !== desiredBodyType) {
      restoreBindAttributesIfPassThrough(existing);
      applyBodyProportion(figure.root, gender, desiredBodyType);
    }
    const rev = (figure.root.userData.__bodyProportionRevision as number) || 0;
    if (rev !== existing.lastProportionRevision || dmIters !== existing.lastDeltaMushIterations) {
      existing.lastProportionRevision = rev;
      existing.lastDeltaMushIterations = dmIters;
      refreshMorphedBindSnapshot(existing, dmIters);
    }
    return existing;
  }

  const mainSkin = findMainSkin(figure.root);
  const bones = mainSkin.skeleton.bones;
  const boneByName = new Map<string, T.Bone>();
  bones.forEach(b => boneByName.set(b.name, b));

  // Temporarily set neutral rest pose so helper rest bases & bodyProportions baseline are 100% clean
  const savedJointQuats = {} as Record<Joint, T.Quaternion>;
  for (const j of JOINTS) {
    savedJointQuats[j] = figure.bones[j].quaternion.clone();
    figure.bones[j].quaternion.copy(figure.restRotations[j]);
  }
  const savedRootPos = figure.root.position.clone();
  const savedRootQuat = figure.root.quaternion.clone();
  const savedRootScale = figure.root.scale.clone();
  figure.root.position.set(0, 0, 0);
  figure.root.quaternion.identity();
  figure.root.scale.set(1, 1, 1);
  figure.root.updateMatrixWorld(true);

  if (!hasBodyProportionBaseline(figure.root)) {
    const initBodyType =
      desiredBodyType && isBodyTypeId(desiredBodyType)
        ? desiredBodyType
        : isBodyTypeId(figure.root.userData.bodyType)
          ? figure.root.userData.bodyType
          : 'heroic';
    applyBodyProportion(figure.root, gender, initBodyType);
    figure.root.updateMatrixWorld(true);
  } else if (desiredBodyType && isBodyTypeId(desiredBodyType) && figure.root.userData.bodyType !== desiredBodyType) {
    applyBodyProportion(figure.root, gender, desiredBodyType);
    figure.root.updateMatrixWorld(true);
  }

  const clavicleL = boneByName.get('clavicle_l') ?? null;
  const clavicleR = boneByName.get('clavicle_r') ?? null;
  const spine02 = boneByName.get('spine_02') ?? null;
  const ballL = boneByName.get('ball_l') ?? null;
  const ballR = boneByName.get('ball_r') ?? null;

  const clavicleLRestLocal = clavicleL ? clavicleL.quaternion.clone() : new T.Quaternion();
  const clavicleRRestLocal = clavicleR ? clavicleR.quaternion.clone() : new T.Quaternion();
  const spine02RestLocal = spine02 ? spine02.quaternion.clone() : new T.Quaternion();
  const spine02RestBasis = spine02 ? spine02.getWorldQuaternion(new T.Quaternion()).invert() : new T.Quaternion();
  const ballLRestLocal = ballL ? ballL.quaternion.clone() : new T.Quaternion();
  const ballLRestBasis = ballL ? ballL.getWorldQuaternion(new T.Quaternion()).invert() : new T.Quaternion();
  const ballRRestLocal = ballR ? ballR.quaternion.clone() : new T.Quaternion();
  const ballRRestBasis = ballR ? ballR.getWorldQuaternion(new T.Quaternion()).invert() : new T.Quaternion();

  const topology = buildTopologyTemplate(gender, mainSkin);
  const { splitCount, weldCount, boneCount, normWeldGroupCount } = topology;
  const dmIters = resolveDeltaMushIterations(weldCount, options?.deltaMushIterations);

  const state: FigureSkinState = {
    gender,
    mainSkin,
    topology,
    clavicleL,
    clavicleR,
    spine02,
    ballL,
    ballR,
    clavicleLRestLocal,
    clavicleRRestLocal,
    spine02RestLocal,
    spine02RestBasis,
    ballLRestLocal,
    ballLRestBasis,
    ballRRestLocal,
    ballRRestBasis,
    lastProportionRevision: (figure.root.userData.__bodyProportionRevision as number) || 0,
    lastDeltaMushIterations: dmIters,
    activePassThrough: false,
    lastCoupledDiagnostics: {
      clampedJointCount: 0,
      leftClavicleElevationRad: 0,
      rightClavicleElevationRad: 0,
      leftClavicleProtractionRad: 0,
      rightClavicleProtractionRad: 0,
      spine02ShareRad: 0,
      leftToeFlexionRad: 0,
      rightToeFlexionRad: 0,
    },
    morphedSplitBindPos: new Float32Array(splitCount * 3),
    morphedSplitBindNorm: new Float32Array(splitCount * 3),
    restWeldedPos: new Float32Array(weldCount * 3),
    bindBoneInverses: Array.from({ length: boneCount }, () => new T.Matrix4()),
    bindBonePos: new Float32Array(boneCount * 3),
    limbSegs: [],
    weldedWeightAxialS: new Float32Array(weldCount * 4),
    restDeltasTS: new Float32Array(weldCount * 3),
    restRefEdgeLen: new Float32Array(weldCount),
    envelope: {
      pelvisRx: 0.13, pelvisRz: 0.09, waistRx: 0.12, waistRz: 0.09,
      bellyFrontOffsetZ: 0.025, bellyRadius: 0.09, chestRx: 0.14, chestRz: 0.09,
      bustRadius: 0, bustOffsetX: 0.075, bustOffsetY: 0.02, bustOffsetZ: 0.06,
      headRadius: 0.10, upperArmR: 0.045, forearmR: 0.036, thighR: 0.072, calfR: 0.052,
    },
    boneSkinMat: new Float32Array(boneCount * 16),
    boneQuat: new Float32Array(boneCount * 4),
    boneTrans: new Float32Array(boneCount * 3),
    boneDual: new Float32Array(boneCount * 4),
    posedBonePos: new Float32Array(boneCount * 3),
    posedBoneRot9: new Float32Array(boneCount * 9),
    segProxTwist: new Float32Array(NUM_TWIST_SEGS),
    segDistTwist: new Float32Array(NUM_TWIST_SEGS),
    skinnedPos: new Float32Array(weldCount * 3),
    smoothBufA: new Float32Array(weldCount * 3),
    smoothBufB: new Float32Array(weldCount * 3),
    weldedPos: new Float32Array(weldCount * 3),
    smoothWeldNorm: new Float32Array(weldCount * 3),
    normGroupAccum: new Float64Array(normWeldGroupCount * 3),
    hasCachedAppliedPose: false,
    lastAppliedPose48: new Float32Array(JOINTS.length * 3),
    lastAppliedJointQuats64: new Float32Array(JOINTS.length * 4),
    lastAppliedMetaKey: '',
    hasCachedDeformation: false,
    lastDeformedBoneQuatTrans: new Float32Array(boneCount * 7),
    lastDeformedMetaKey: '',
    lastDeformationDiagnostics: null,
  };

  refreshMorphedBindSnapshot(state, dmIters);

  // Restore saved figure pose & root transform
  for (const j of JOINTS) {
    figure.bones[j].quaternion.copy(savedJointQuats[j]);
  }
  figure.root.position.copy(savedRootPos);
  figure.root.quaternion.copy(savedRootQuat);
  figure.root.scale.copy(savedRootScale);
  figure.root.updateMatrixWorld(true);

  figureSkinStates.set(figure.root, state);
  return state;
}

/**
 * Layer 1: Stateless Coupled Biomechanical Joint Solver.
 * - Clamps pose to physiological ROM when `limitMode !== 'free'`.
 * - Splits thoracic `chest` rotation 45% / 55% across `spine_02` and `spine_03` while preserving `spine_03` world orientation.
 * - Drives world-direction-preserving scapulohumeral rhythm on `clavicle_l` / `clavicle_r` with exact humerus world-quaternion compensation.
 * - Couples `ball_l` / `ball_r` metatarsophalangeal toe hinge during kneeling / plantarflexed ankle bends.
 * - Gently clears resting arms past widened body envelopes (`chubby`, `fat`, `obese`, `busty`) when needed.
 */
export function solveCoupledRigPose(
  figure: Figure,
  pose: Pose,
  options?: SkinDeformerOptions,
): CoupledRigDiagnostics {
  const state = ensureFigureSkinState(figure, options);
  state.hasCachedAppliedPose = false;
  const limitMode = options?.limitMode ?? 'anatomical';
  const enableCoupled = options?.enableCoupledJoints ?? true;

  const effectivePose = clampPoseToAnatomicalLimits(pose, limitMode, figure.morphology);
  let clampedJointCount = 0;
  if (limitMode === 'anatomical') {
    for (const j of JOINTS) {
      const raw = pose[j] ?? [0, 0, 0];
      const clp = effectivePose[j];
      if (
        Math.abs(sanitizeAngle(raw[0]) - clp[0]) > 1e-6 ||
        Math.abs(sanitizeAngle(raw[1]) - clp[1]) > 1e-6 ||
        Math.abs(sanitizeAngle(raw[2]) - clp[2]) > 1e-6
      ) {
        clampedJointCount++;
      }
    }
  }

  // Reset helper bones to neutral rest before stateless solve
  if (state.clavicleL) state.clavicleL.quaternion.copy(state.clavicleLRestLocal);
  if (state.clavicleR) state.clavicleR.quaternion.copy(state.clavicleRRestLocal);
  if (state.spine02) state.spine02.quaternion.copy(state.spine02RestLocal);
  if (state.ballL) state.ballL.quaternion.copy(state.ballLRestLocal);
  if (state.ballR) state.ballR.quaternion.copy(state.ballRRestLocal);

  // Apply standard uncoupled FK pose to all 16 semantic joints
  for (const j of JOINTS) {
    const basis = figure.rotationBases[j];
    _eulerA.set(effectivePose[j][0], effectivePose[j][1], effectivePose[j][2], 'XYZ');
    _quatA.setFromEuler(_eulerA);
    _quatB.copy(basis).invert();
    figure.bones[j].quaternion.copy(figure.restRotations[j]).multiply(basis).multiply(_quatA).multiply(_quatB);
  }
  figure.root.updateMatrixWorld(true);

  const diag: CoupledRigDiagnostics = {
    clampedJointCount,
    leftClavicleElevationRad: 0,
    rightClavicleElevationRad: 0,
    leftClavicleProtractionRad: 0,
    rightClavicleProtractionRad: 0,
    spine02ShareRad: 0,
    leftToeFlexionRad: 0,
    rightToeFlexionRad: 0,
  };

  if (!enableCoupled) {
    state.lastCoupledDiagnostics = diag;
    return diag;
  }

  // 1A. 3-Vertebra Thoracic Spine Split (45% spine_02 / 55% spine_03, preserving spine_03 world orientation)
  const chestAngles = effectivePose.chest;
  if (
    state.spine02 &&
    (Math.abs(chestAngles[0]) > 1e-5 || Math.abs(chestAngles[1]) > 1e-5 || Math.abs(chestAngles[2]) > 1e-5)
  ) {
    const targetChestWorld = figure.bones.chest.getWorldQuaternion(_quatChestTarget);
    _eulerA.set(chestAngles[0], chestAngles[1], chestAngles[2], 'XYZ');
    _quatA.setFromEuler(_eulerA);
    _quatB.copy(_quatId).slerp(_quatA, 0.45);
    diag.spine02ShareRad = 2 * Math.acos(clamp(Math.abs(_quatB.w), 0, 1));

    _quatC.copy(state.spine02RestBasis).invert();
    state.spine02.quaternion
      .copy(state.spine02RestLocal)
      .multiply(state.spine02RestBasis)
      .multiply(_quatB)
      .multiply(_quatC);
    state.spine02.updateMatrixWorld(true);

    // Compensate spine_03 so upper chest, neck, head, and shoulders keep exact target world orientation
    const spine02WorldInv = state.spine02.getWorldQuaternion(_quatD).invert();
    figure.bones.chest.quaternion.copy(spine02WorldInv).multiply(targetChestWorld);
    figure.bones.chest.updateMatrixWorld(true);
  }

  // 1B. World-Direction-Preserving Scapulohumeral Rhythm on clavicle_l / clavicle_r
  const chestWorldQuat = figure.bones.chest.getWorldQuaternion(_quatChestWorld);
  // Strip spine_03's rest world orientation on the right (`rotationBases.chest == inv(Q_chest_restWorld)`)
  // so `chestCharQuat = Q_root * Delta_thoracic` maps character (+X Left, +Y Up, +Z Forward) directly to world space!
  const chestCharQuat = _quatChestChar.copy(chestWorldQuat).multiply(figure.rotationBases.chest);
  _spineAxisX.set(1, 0, 0).applyQuaternion(chestCharQuat).normalize(); // Left
  _spineAxisY.set(0, 1, 0).applyQuaternion(chestCharQuat).normalize(); // Up
  _spineAxisZ.set(0, 0, 1).applyQuaternion(chestCharQuat).normalize(); // Forward

  const solveSideClavicle = (isLeft: boolean) => {
    const clav = isLeft ? state.clavicleL : state.clavicleR;
    const upper = isLeft ? figure.bones.leftShoulder : figure.bones.rightShoulder;
    const lower = isLeft ? figure.bones.leftElbow : figure.bones.rightElbow;
    const hand = isLeft ? figure.bones.leftWrist : figure.bones.rightWrist;
    if (!clav) return;

    const targetUpperWorld = upper.getWorldQuaternion(_quatUpperTarget);
    upper.getWorldPosition(_vecA);
    lower.getWorldPosition(_vecB);
    _vecC.subVectors(_vecB, _vecA);
    const segLen = _vecC.length();
    if (segLen < 1e-6) return;
    _vecC.multiplyScalar(1 / segLen);

    // Elevation angle above straight-down (-spineAxisY): ~7 deg in neutral A-pose
    const downDot = clamp(-_vecC.dot(_spineAxisY), -1, 1);
    const raiseAngle = Math.acos(downDot);
    const maxElev = 30 * DEG;
    const rawElev = 0.28 * Math.max(0, raiseAngle - 22 * DEG);
    const elevRad = rawElev > 0 ? maxElev * Math.tanh(rawElev / maxElev) : 0;

    // Horizontal protraction / retraction
    const fwdComp = _vecC.dot(_spineAxisZ);
    const outSign = isLeft ? 1 : -1;
    const crossBodyComp = -outSign * _vecC.dot(_spineAxisX);
    const horizGate = smoothstep(16 * DEG, 55 * DEG, raiseAngle);
    const protRad = clamp(horizGate * (0.22 * fwdComp + 0.26 * crossBodyComp), -14 * DEG, 18 * DEG);

    if (elevRad > 1e-5 || Math.abs(protRad) > 1e-5) {
      // Elevate around +Z (left) / -Z (right), protract around -Y (left) / +Y (right) in world space
      const qElevWorld = _quatElevWorld.setFromAxisAngle(_spineAxisZ, outSign * elevRad);
      const qProtWorld = _quatProtWorld.setFromAxisAngle(_spineAxisY, -outSign * protRad);
      const clavParentWorld = clav.parent
        ? clav.parent.getWorldQuaternion(_quatClavParent)
        : _quatClavParent.identity();
      const clavRestWorld = _quatClavRestWorld.copy(clavParentWorld).multiply(
        isLeft ? state.clavicleLRestLocal : state.clavicleRRestLocal,
      );
      const desiredClavWorld = qProtWorld.multiply(qElevWorld).multiply(clavRestWorld);
      clav.quaternion.copy(clavParentWorld.invert()).multiply(desiredClavWorld);
      clav.updateMatrixWorld(true);

      // Compensate upperarm local quaternion so world arm direction matches uncoupled target!
      const newClavWorldInv = clav.getWorldQuaternion(_quatC).invert();
      upper.quaternion.copy(newClavWorldInv).multiply(targetUpperWorld);
      upper.updateMatrixWorld(true);
    }

    // Gentle resting-arm body-envelope clearance for wide silhouettes (chubby / fat / obese)
    const extraWaist = Math.max(0, state.envelope.waistRx - (state.gender === 'male' ? 0.145 : 0.125));
    const extraHip = Math.max(0, state.envelope.pelvisRx - (state.gender === 'male' ? 0.155 : 0.155));
    const extraWidth = Math.max(extraWaist, extraHip);
    if (extraWidth > 0.012 && raiseAngle < 35 * DEG) {
      // Check if elbow or wrist hangs inside the widened lateral waist/hip silhouette
      figure.bones.hips.getWorldPosition(_vecA);
      lower.getWorldPosition(_vecB);
      hand.getWorldPosition(_vecC);
      const latElbow = outSign * _vecB.sub(_vecA).dot(_spineAxisX);
      const latWrist = outSign * _vecC.sub(_vecA).dot(_spineAxisX);
      const minClearance = Math.max(state.envelope.waistRx, state.envelope.pelvisRx) + state.envelope.forearmR * 0.85;
      const pen = Math.max(0, minClearance - Math.min(latElbow, latWrist));
      if (pen > 0.002) {
        const hangFactor = 1 - smoothstep(14 * DEG, 35 * DEG, raiseAngle);
        const abductRad = clamp((pen / 0.26) * hangFactor, 0, 11 * DEG);
        if (abductRad > 1e-4) {
          const qAbduct = _quatAbduct.setFromAxisAngle(_spineAxisZ, outSign * abductRad);
          const curUpperWorld = upper.getWorldQuaternion(_quatCurUpperWorld);
          const parentInv = upper.parent
            ? upper.parent.getWorldQuaternion(_quatParentInv).invert()
            : _quatParentInv.identity();
          upper.quaternion.copy(parentInv).multiply(qAbduct.multiply(curUpperWorld));
          upper.updateMatrixWorld(true);
        }
      }
    }

    if (isLeft) {
      diag.leftClavicleElevationRad = elevRad;
      diag.leftClavicleProtractionRad = protRad;
    } else {
      diag.rightClavicleElevationRad = elevRad;
      diag.rightClavicleProtractionRad = protRad;
    }
  };

  solveSideClavicle(true);
  solveSideClavicle(false);

  // 1C. Metatarsophalangeal Toe Hinge (ball_l / ball_r) on kneeling / plantarflexed ankle bends
  const solveSideToe = (isLeft: boolean) => {
    const ball = isLeft ? state.ballL : state.ballR;
    if (!ball) return;
    const kneeRx = isLeft ? effectivePose.leftKnee[0] : effectivePose.rightKnee[0];
    const ankleRx = isLeft ? effectivePose.leftAnkle[0] : effectivePose.rightAnkle[0];

    // Kneeling / push-off: knee flexed + ankle plantarflexed (+rx) -> dorsiflex toes (-rx in char frame)
    let toePitch = 0;
    if (ankleRx > 10 * DEG && kneeRx > 35 * DEG) {
      toePitch = -clamp(
        0.58 * (ankleRx - 10 * DEG) * smoothstep(35 * DEG, 85 * DEG, kneeRx),
        0,
        52 * DEG,
      );
    }
    if (Math.abs(toePitch) > 1e-4) {
      const restLocal = isLeft ? state.ballLRestLocal : state.ballRRestLocal;
      const restBasis = isLeft ? state.ballLRestBasis : state.ballRRestBasis;
      _eulerA.set(toePitch, 0, 0, 'XYZ');
      _quatA.setFromEuler(_eulerA);
      _quatB.copy(restBasis).invert();
      ball.quaternion.copy(restLocal).multiply(restBasis).multiply(_quatA).multiply(_quatB);
      ball.updateMatrixWorld(true);
    }
    if (isLeft) diag.leftToeFlexionRad = -toePitch;
    else diag.rightToeFlexionRad = -toePitch;
  };

  solveSideToe(true);
  solveSideToe(false);

  figure.root.updateMatrixWorld(true);
  state.lastCoupledDiagnostics = diag;
  return diag;
}

/**
 * Extracts signed axial twist angle in [-pi, +pi] of relative rotation `qRel = inv(qParent) * qChild`
 * around unit bind-space shaft vector `(ax, ay, az)`.
 * Antipodal-safe even at exact +/-180 deg twist (`w == 0`).
 */
function extractRelativeAxialTwist(
  qParentX: number, qParentY: number, qParentZ: number, qParentW: number,
  qChildX: number, qChildY: number, qChildZ: number, qChildW: number,
  ax: number, ay: number, az: number,
): number {
  // qRel = conj(qParent) * qChild
  const px = -qParentX, py = -qParentY, pz = -qParentZ, pw = qParentW;
  let rx = pw * qChildX + px * qChildW + py * qChildZ - pz * qChildY;
  let ry = pw * qChildY - px * qChildZ + py * qChildW + pz * qChildX;
  let rz = pw * qChildZ + px * qChildY - py * qChildX + pz * qChildW;
  let rw = pw * qChildW - px * qChildX - py * qChildY - pz * qChildZ;

  // Choose canonical shortest-arc hemisphere (rw >= 0)
  if (rw < 0) {
    rx = -rx; ry = -ry; rz = -rz; rw = -rw;
  }
  const proj = rx * ax + ry * ay + rz * az;
  const norm = Math.hypot(proj, rw);
  if (norm < 1e-8) return 0;
  return 2 * Math.atan2(proj, rw);
}

function computeFlexionAngle(
  posedBonePos: Float32Array,
  proxBone: number,
  pivotBone: number,
  distBone: number,
): number {
  const jx = posedBonePos[pivotBone * 3]!, jy = posedBonePos[pivotBone * 3 + 1]!, jz = posedBonePos[pivotBone * 3 + 2]!;
  const ux = posedBonePos[proxBone * 3]! - jx;
  const uy = posedBonePos[proxBone * 3 + 1]! - jy;
  const uz = posedBonePos[proxBone * 3 + 2]! - jz;
  const vx = posedBonePos[distBone * 3]! - jx;
  const vy = posedBonePos[distBone * 3 + 1]! - jy;
  const vz = posedBonePos[distBone * 3 + 2]! - jz;
  const lu = Math.hypot(ux, uy, uz);
  const lv = Math.hypot(vx, vy, vz);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  const cosOpen = clamp((ux * vx + uy * vy + uz * vz) / (lu * lv), -1, 1);
  return Math.PI - Math.acos(cosOpen);
}

function applyHingeCreaseContact(
  weldedPos: Float32Array,
  candidates: Int32Array,
  wParentArr: Float32Array,
  wChildArr: Float32Array,
  sideFilter: -1 | 0 | 1,
  restWeldedPos: Float32Array,
  px: number, py: number, pz: number,
  upx: number, upy: number, upz: number,
  ucx: number, ucy: number, ucz: number,
  segLen: number,
  limbRadius: number,
  onsetRad: number,
  fullRad: number,
  clearanceGap: number,
  squishGain: number,
): number {
  const lu = Math.hypot(upx, upy, upz);
  const lc = Math.hypot(ucx, ucy, ucz);
  if (lu < 1e-6 || lc < 1e-6) return 0;
  const uPx = upx / lu, uPy = upy / lu, uPz = upz / lu;
  const uCx = ucx / lc, uCy = ucy / lc, uCz = ucz / lc;

  const cosOpen = clamp(uPx * uCx + uPy * uCy + uPz * uCz, -1, 1);
  const flexRad = Math.PI - Math.acos(cosOpen);
  const bendGate = smoothstep(onsetRad, fullRad, flexRad);
  if (bendGate <= 1e-4) return 0;

  // mJ points from joint pivot into the folded crease wedge; nJ points from parent (-) across crease to child (+)
  let mx = uPx + uCx, my = uPy + uCy, mz = uPz + uCz;
  const mLen = Math.hypot(mx, my, mz);
  if (mLen < 1e-5) return 0;
  mx /= mLen; my /= mLen; mz /= mLen;

  let nx = uCx - uPx, ny = uCy - uPy, nz = uCz - uPz;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-5) return 0;
  nx /= nLen; ny /= nLen; nz /= nLen;

  // Lateral hinge axis hJ = nJ x mJ
  let hx = ny * mz - nz * my;
  let hy = nz * mx - nx * mz;
  let hz = nx * my - ny * mx;
  const hLen = Math.hypot(hx, hy, hz) || 1;
  hx /= hLen; hy /= hLen; hz /= hLen;

  const maxLat = limbRadius * 2.45;
  let maxCorr = 0;

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const w = candidates[cIdx]!;
    const wp = wParentArr[w]!;
    const wc = wChildArr[w]!;
    const wTot = wp + wc;
    if (wTot < 0.30) continue;

    if (sideFilter !== 0) {
      const rx0 = restWeldedPos[w * 3]!;
      if (sideFilter === 1 && rx0 < -0.025) continue;
      if (sideFilter === -1 && rx0 > 0.025) continue;
    }

    const w3 = w * 3;
    const dx = weldedPos[w3]! - px;
    const dy = weldedPos[w3 + 1]! - py;
    const dz = weldedPos[w3 + 2]! - pz;

    const dFold = dx * mx + dy * my + dz * mz;
    if (dFold <= 0.004 || dFold >= segLen * 0.98) continue;

    const hCoord = dx * hx + dy * hy + dz * hz;
    if (Math.abs(hCoord) > maxLat) continue;

    const foldMask =
      smoothstep(0.004, 0.032, dFold) *
      (1 - smoothstep(segLen * 0.82, segLen * 0.98, dFold)) *
      (1 - smoothstep(limbRadius * 1.65, maxLat, Math.abs(hCoord)));
    if (foldMask <= 1e-4) continue;

    const eta = (wc - wp) / (wTot + 1e-6);
    const dn = dx * nx + dy * ny + dz * nz;

    let corr = 0;
    let dirSign = 0;
    if (eta > 0.08) {
      // Child vertex: belongs on +nJ half-space (dn >= clearanceGap)
      const pen = clearanceGap - dn;
      if (pen > 0) {
        corr = bendGate * foldMask * smoothstep(0.08, 0.48, eta) * pen;
        dirSign = 1;
      }
    } else if (eta < -0.08) {
      // Parent vertex: belongs on -nJ half-space (dn <= -clearanceGap)
      const pen = dn + clearanceGap;
      if (pen > 0) {
        corr = bendGate * foldMask * smoothstep(0.08, 0.48, -eta) * pen;
        dirSign = -1;
      }
    }

    if (corr > 1e-6) {
      weldedPos[w3]! += dirSign * corr * nx;
      weldedPos[w3 + 1]! += dirSign * corr * ny;
      weldedPos[w3 + 2]! += dirSign * corr * nz;

      // Volume-preserving lateral Poisson squish along +/-hJ
      const smoothSignH = hCoord / Math.hypot(hCoord, 0.012);
      const latDisp = squishGain * corr * smoothSignH;
      weldedPos[w3]! += latDisp * hx;
      weldedPos[w3 + 1]! += latDisp * hy;
      weldedPos[w3 + 2]! += latDisp * hz;

      if (corr > maxCorr) maxCorr = corr;
    }
  }

  return maxCorr;
}

function pushOutOfTaperedCapsule(
  vx: number, vy: number, vz: number,
  ax: number, ay: number, az: number, ra: number,
  bx: number, by: number, bz: number, rb: number,
  weight: number,
  outDelta: Float64Array,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  const t = abLenSq > 1e-8 ? clamp(((vx - ax) * abx + (vy - ay) * aby + (vz - az) * abz) / abLenSq, 0, 1) : 0;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const cz = az + t * abz;
  const r = ra + t * (rb - ra);
  if (r <= 1e-5) return 0;

  let dx = vx - cx, dy = vy - cy, dz = vz - cz;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq >= r * r) return 0;
  let dist = Math.sqrt(distSq);

  if (dist < 1e-6) {
    dx = 0; dy = 0; dz = 1; dist = 1;
  }
  const pen = (r - dist) * weight;
  const inv = pen / dist;
  outDelta[0] = dx * inv;
  outDelta[1] = dy * inv;
  outDelta[2] = dz * inv;
  return pen;
}

const _capDelta = new Float64Array(3);

/**
 * Evaluates standard Linear Blend Skinning (LBS) positions in `mainSkin` object space
 * using the figure's true morphed bind mesh & current bone world matrices (without mutating `mainSkin`).
 * Useful for direct quantitative comparison against the 3-layer extreme-pose deformer.
 */
export function evaluateStandardLbsPositions(
  figure: Figure,
  options?: SkinDeformerOptions,
): Float32Array {
  const state = ensureFigureSkinState(figure, options);
  figure.root.updateMatrixWorld(true);
  const { mainSkin, topology: tpl } = state;
  const { splitCount, weldCount, vToWeld, skinIdx4, skinWgt4, boneCount } = tpl;

  _matSkinInv.copy(mainSkin.matrixWorld).invert();
  const lbsMats = new Float32Array(boneCount * 16);
  for (let b = 0; b < boneCount; b++) {
    const bone = mainSkin.skeleton.bones[b]!;
    _matA.multiplyMatrices(_matSkinInv, bone.matrixWorld);
    _matB.multiplyMatrices(_matA, state.bindBoneInverses[b]!);
    _matB.multiply(mainSkin.bindMatrix);
    _matB.toArray(lbsMats, b * 16);
  }

  const weldedOut = new Float32Array(weldCount * 3);
  for (let w = 0; w < weldCount; w++) {
    const px = state.restWeldedPos[w * 3]!;
    const py = state.restWeldedPos[w * 3 + 1]!;
    const pz = state.restWeldedPos[w * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const wgt = skinWgt4[w * 4 + k]!;
      if (wgt <= 0) continue;
      const mOff = skinIdx4[w * 4 + k]! * 16;
      ox += wgt * (lbsMats[mOff]! * px + lbsMats[mOff + 4]! * py + lbsMats[mOff + 8]! * pz + lbsMats[mOff + 12]!);
      oy += wgt * (lbsMats[mOff + 1]! * px + lbsMats[mOff + 5]! * py + lbsMats[mOff + 9]! * pz + lbsMats[mOff + 13]!);
      oz += wgt * (lbsMats[mOff + 2]! * px + lbsMats[mOff + 6]! * py + lbsMats[mOff + 10]! * pz + lbsMats[mOff + 14]!);
    }
    weldedOut[w * 3] = ox;
    weldedOut[w * 3 + 1] = oy;
    weldedOut[w * 3 + 2] = oz;
  }

  const splitOut = new Float32Array(splitCount * 3);
  for (let v = 0; v < splitCount; v++) {
    const w3 = vToWeld[v]! * 3;
    splitOut[v * 3] = weldedOut[w3]!;
    splitOut[v * 3 + 1] = weldedOut[w3 + 1]!;
    splitOut[v * 3 + 2] = weldedOut[w3 + 2]!;
  }
  return splitOut;
}

/**
 * Layers 2 & 3: Evaluates CPU-authoritative extreme-pose skin deformation on `figure`'s current bone transforms,
 * writes welded seam-safe deformed positions & normals to `mainSkin.geometry`, and configures identity pass-through
 * skinning on `mainSkin.skeleton` so `MeshStandardMaterial`, `BokehPass`, `ShadowMap`, `Raycaster`, and `groundPoseY`
 * all read the exact sculpted surface without double-skinning.
 */
export function evaluateSkinDeformation(
  figure: Figure,
  options?: SkinDeformerOptions,
): SkinDeformationDiagnostics {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const state = ensureFigureSkinState(figure, options);
  figure.root.updateMatrixWorld(true);

  const activeBt =
    options?.bodyType ??
    figure.deformation?.bodyType ??
    (isBodyTypeId(figure.root.userData?.bodyType) ? figure.root.userData.bodyType : undefined);
  const enableTwist = options?.enableTwistDistribution ?? true;
  const enableDqs = options?.enableHybridDqs ?? true;
  const enableDeltaMush = options?.enableDeltaMush ?? true;
  const enableContact = options?.enableContactAndBulge ?? activeBt !== 'chibi';
  const dmIters = resolveDeltaMushIterations(state.topology.weldCount, options?.deltaMushIterations);

  const { mainSkin, topology: tpl } = state;
  const {
    splitCount,
    weldCount,
    boneCount,
    vToWeld,
    normWeldCanon,
    normWeldGroupCount,
    triIndices,
    skinIdx4,
    skinWgt4,
    boneLookup: bl,
    boneToTwistSeg,
    mushLambda,
    refNeighbor,
    refNeighbor2,
    weldWeightMap: wm,
  } = tpl;

  // Step 1: Compute rigid SE(3) skinning transforms S_b = inv(mainSkin.matrixWorld) * bones[b].matrixWorld * bindBoneInverses[b]
  _matSkinInv.copy(mainSkin.matrixWorld).invert();
  const { boneSkinMat, boneQuat, boneTrans, boneDual, posedBonePos, posedBoneRot9 } = state;

  for (let b = 0; b < boneCount; b++) {
    const bone = mainSkin.skeleton.bones[b]!;
    _matA.multiplyMatrices(_matSkinInv, bone.matrixWorld);
    _matB.multiplyMatrices(_matA, state.bindBoneInverses[b]!);
    _matB.multiply(mainSkin.bindMatrix);
    _matB.toArray(boneSkinMat, b * 16);

    _matB.decompose(_vecA, _quatA, _vecScale);
    _quatA.normalize();

    const qx = _quatA.x, qy = _quatA.y, qz = _quatA.z, qw = _quatA.w;
    const tx = _vecA.x, ty = _vecA.y, tz = _vecA.z;
    boneQuat[b * 4] = qx;
    boneQuat[b * 4 + 1] = qy;
    boneQuat[b * 4 + 2] = qz;
    boneQuat[b * 4 + 3] = qw;
    boneTrans[b * 3] = tx;
    boneTrans[b * 3 + 1] = ty;
    boneTrans[b * 3 + 2] = tz;

    // Dual part d = 0.5 * t_quat * q
    boneDual[b * 4] = 0.5 * (tx * qw + ty * qz - tz * qy);
    boneDual[b * 4 + 1] = 0.5 * (-tx * qz + ty * qw + tz * qx);
    boneDual[b * 4 + 2] = 0.5 * (tx * qy - ty * qx + tz * qw);
    boneDual[b * 4 + 3] = -0.5 * (tx * qx + ty * qy + tz * qz);

    // Posed joint position in mainSkin bind/object space: S_b * bindPos_b
    const bx0 = state.bindBonePos[b * 3]!;
    const by0 = state.bindBonePos[b * 3 + 1]!;
    const bz0 = state.bindBonePos[b * 3 + 2]!;
    const mOff = b * 16;
    posedBonePos[b * 3] = boneSkinMat[mOff]! * bx0 + boneSkinMat[mOff + 4]! * by0 + boneSkinMat[mOff + 8]! * bz0 + tx;
    posedBonePos[b * 3 + 1] = boneSkinMat[mOff + 1]! * bx0 + boneSkinMat[mOff + 5]! * by0 + boneSkinMat[mOff + 9]! * bz0 + ty;
    posedBonePos[b * 3 + 2] = boneSkinMat[mOff + 2]! * bx0 + boneSkinMat[mOff + 6]! * by0 + boneSkinMat[mOff + 10]! * bz0 + tz;

    const rOff = b * 9;
    posedBoneRot9[rOff] = boneSkinMat[mOff]!;
    posedBoneRot9[rOff + 1] = boneSkinMat[mOff + 1]!;
    posedBoneRot9[rOff + 2] = boneSkinMat[mOff + 2]!;
    posedBoneRot9[rOff + 3] = boneSkinMat[mOff + 4]!;
    posedBoneRot9[rOff + 4] = boneSkinMat[mOff + 5]!;
    posedBoneRot9[rOff + 5] = boneSkinMat[mOff + 6]!;
    posedBoneRot9[rOff + 6] = boneSkinMat[mOff + 8]!;
    posedBoneRot9[rOff + 7] = boneSkinMat[mOff + 9]!;
    posedBoneRot9[rOff + 8] = boneSkinMat[mOff + 10]!;
  }

  // Bone-skinning dirty check: if every bone's rigid SE(3) skinning transform & deformer flags
  // match the last evaluated pass-through state, skip the 55k-vertex loop & GPU re-upload!
  const deformMetaKey = `${activeBt ?? ''}|${enableTwist ? 1 : 0}|${enableDqs ? 1 : 0}|${enableDeltaMush ? 1 : 0}|${enableContact ? 1 : 0}|${dmIters}|${state.lastProportionRevision}`;
  if (
    state.activePassThrough &&
    state.hasCachedDeformation &&
    state.lastDeformationDiagnostics !== null &&
    state.lastDeformedMetaKey === deformMetaKey
  ) {
    let bonesUnchanged = true;
    const prevQT = state.lastDeformedBoneQuatTrans;
    for (let b = 0; b < boneCount; b++) {
      const off7 = b * 7;
      const qx = boneQuat[b * 4]!, qy = boneQuat[b * 4 + 1]!, qz = boneQuat[b * 4 + 2]!, qw = boneQuat[b * 4 + 3]!;
      const tx = boneTrans[b * 3]!, ty = boneTrans[b * 3 + 1]!, tz = boneTrans[b * 3 + 2]!;
      const dot = Math.abs(
        qx * prevQT[off7]! + qy * prevQT[off7 + 1]! + qz * prevQT[off7 + 2]! + qw * prevQT[off7 + 3]!,
      );
      if (
        dot < BONE_QUAT_DOT_MIN ||
        Math.abs(tx - prevQT[off7 + 4]!) > BONE_TRANS_EPSILON ||
        Math.abs(ty - prevQT[off7 + 5]!) > BONE_TRANS_EPSILON ||
        Math.abs(tz - prevQT[off7 + 6]!) > BONE_TRANS_EPSILON
      ) {
        bonesUnchanged = false;
        break;
      }
    }

    if (bonesUnchanged) {
      // Keep skeleton boneInverses synced with current bone.matrixWorld in case root moved
      _matB.copy(mainSkin.bindMatrix).invert();
      _matA.multiplyMatrices(mainSkin.matrixWorld, _matB);
      for (let b = 0; b < boneCount; b++) {
        const bone = mainSkin.skeleton.bones[b]!;
        mainSkin.skeleton.boneInverses[b]!.copy(bone.matrixWorld).invert().multiply(_matA);
      }
      mainSkin.skeleton.update();
      const tFast = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        ...state.lastDeformationDiagnostics,
        coupled: state.lastCoupledDiagnostics,
        elapsedMs: tFast - t0,
        skippedRedundant: true,
      };
    }
  }

  // Step 2A: Extract continuous axial twist angles along the 8 major limb segments
  const { segProxTwist, segDistTwist } = state;
  segProxTwist.fill(0);
  segDistTwist.fill(0);
  if (enableTwist) {
    for (let sIdx = 0; sIdx < NUM_TWIST_SEGS; sIdx++) {
      const seg = state.limbSegs[sIdx]!;
      const b = seg.boneIdx;
      const p = seg.parentBoneIdx;
      const c = seg.childBoneIdx;
      if (seg.proxUnwindScale > 0) {
        segProxTwist[sIdx] =
          seg.proxUnwindScale *
          extractRelativeAxialTwist(
            boneQuat[p * 4]!, boneQuat[p * 4 + 1]!, boneQuat[p * 4 + 2]!, boneQuat[p * 4 + 3]!,
            boneQuat[b * 4]!, boneQuat[b * 4 + 1]!, boneQuat[b * 4 + 2]!, boneQuat[b * 4 + 3]!,
            seg.ax, seg.ay, seg.az,
          );
      }
      if (seg.distAdvanceScale > 0) {
        segDistTwist[sIdx] =
          seg.distAdvanceScale *
          extractRelativeAxialTwist(
            boneQuat[b * 4]!, boneQuat[b * 4 + 1]!, boneQuat[b * 4 + 2]!, boneQuat[b * 4 + 3]!,
            boneQuat[c * 4]!, boneQuat[c * 4 + 1]!, boneQuat[c * 4 + 2]!, boneQuat[c * 4 + 3]!,
            seg.ax, seg.ay, seg.az,
          );
      }
    }
  }

  const leftForearmTwistRad =
    segDistTwist[SEG_LOWERARM_L]! + segProxTwist[SEG_LOWERARM_L]!;
  const rightForearmTwistRad =
    segDistTwist[SEG_LOWERARM_R]! + segProxTwist[SEG_LOWERARM_R]!;

  // Step 2B: Fused Continuous-Twist + Antipodal-Safe Hybrid DQS / LBS Skinning across W welded vertices
  const { skinnedPos, restWeldedPos, weldedWeightAxialS } = state;
  for (let w = 0; w < weldCount; w++) {
    const w3 = w * 3;
    const w4 = w * 4;
    const px0 = restWeldedPos[w3]!;
    const py0 = restWeldedPos[w3 + 1]!;
    const pz0 = restWeldedPos[w3 + 2]!;

    // Single-bone rigid fast path (w0 > 0.999 -> DQS === LBS === single rigid matrix multiply)
    const w0 = skinWgt4[w4]!;
    if (w0 > 0.999) {
      const b0 = skinIdx4[w4]!;
      const seg0 = boneToTwistSeg[b0]!;
      let vx0 = px0, vy0 = py0, vz0 = pz0;
      if (enableTwist && seg0 !== SEG_NONE) {
        const phiProx0 = segProxTwist[seg0]!;
        const phiDist0 = segDistTwist[seg0]!;
        if (Math.abs(phiProx0) > 1e-5 || Math.abs(phiDist0) > 1e-5) {
          const seg = state.limbSegs[seg0]!;
          const u = smoothstep(seg.sStart, seg.sEnd, weldedWeightAxialS[w4]!);
          const theta = -(1 - u) * phiProx0 + u * phiDist0;
          if (Math.abs(theta) > 1e-6) {
            const half = 0.5 * theta;
            const sh = Math.sin(half), ch = Math.cos(half);
            const tqx = seg.ax * sh, tqy = seg.ay * sh, tqz = seg.az * sh;
            const rx = px0 - seg.p0x, ry = py0 - seg.p0y, rz = pz0 - seg.p0z;
            const cx1 = tqy * rz - tqz * ry + ch * rx;
            const cy1 = tqz * rx - tqx * rz + ch * ry;
            const cz1 = tqx * ry - tqy * rx + ch * rz;
            vx0 = seg.p0x + rx + 2 * (tqy * cz1 - tqz * cy1);
            vy0 = seg.p0y + ry + 2 * (tqz * cx1 - tqx * cz1);
            vz0 = seg.p0z + rz + 2 * (tqx * cy1 - tqy * cx1);
          }
        }
      }
      const mOff0 = b0 * 16;
      skinnedPos[w3] = boneSkinMat[mOff0]! * vx0 + boneSkinMat[mOff0 + 4]! * vy0 + boneSkinMat[mOff0 + 8]! * vz0 + boneSkinMat[mOff0 + 12]!;
      skinnedPos[w3 + 1] = boneSkinMat[mOff0 + 1]! * vx0 + boneSkinMat[mOff0 + 5]! * vy0 + boneSkinMat[mOff0 + 9]! * vz0 + boneSkinMat[mOff0 + 13]!;
      skinnedPos[w3 + 2] = boneSkinMat[mOff0 + 2]! * vx0 + boneSkinMat[mOff0 + 6]! * vy0 + boneSkinMat[mOff0 + 10]! * vz0 + boneSkinMat[mOff0 + 14]!;
      continue;
    }

    let lbsX = 0, lbsY = 0, lbsZ = 0;
    let dqsQx = 0, dqsQy = 0, dqsQz = 0, dqsQw = 0;
    let dqsDx = 0, dqsDy = 0, dqsDz = 0, dqsDw = 0;
    let pivQx = 0, pivQy = 0, pivQz = 0, pivQw = 1;
    let maxTwistMag = 0;

    for (let k = 0; k < 4; k++) {
      const bw = skinWgt4[w4 + k]!;
      if (bw <= 0) continue;
      const bIdx = skinIdx4[w4 + k]!;
      const segIdx = boneToTwistSeg[bIdx]!;

      let qx = boneQuat[bIdx * 4]!;
      let qy = boneQuat[bIdx * 4 + 1]!;
      let qz = boneQuat[bIdx * 4 + 2]!;
      let qw = boneQuat[bIdx * 4 + 3]!;
      let dx = boneDual[bIdx * 4]!;
      let dy = boneDual[bIdx * 4 + 1]!;
      let dz = boneDual[bIdx * 4 + 2]!;
      let dw = boneDual[bIdx * 4 + 3]!;

      let vx = px0, vy = py0, vz = pz0;

      if (enableTwist && segIdx !== SEG_NONE) {
        const phiProx = segProxTwist[segIdx]!;
        const phiDist = segDistTwist[segIdx]!;
        if (Math.abs(phiProx) > 1e-5 || Math.abs(phiDist) > 1e-5) {
          const seg = state.limbSegs[segIdx]!;
          const sVal = weldedWeightAxialS[w4 + k]!;
          const u = smoothstep(seg.sStart, seg.sEnd, sVal);
          // Unwind proximal twist near parent joint (u=0 -> -phiProx, u=1 -> 0) and advance toward child twist (u=0 -> 0, u=1 -> +phiDist)
          const theta = -(1 - u) * phiProx + u * phiDist;
          const absTwist = Math.abs(phiProx) + Math.abs(phiDist);
          if (absTwist > maxTwistMag) maxTwistMag = absTwist;

          if (Math.abs(theta) > 1e-6) {
            const half = 0.5 * theta;
            const sh = Math.sin(half);
            const ch = Math.cos(half);
            const tqx = seg.ax * sh, tqy = seg.ay * sh, tqz = seg.az * sh, tqw = ch;

            // Rotate bind vertex around bone shaft (p0 + R_twist * (p - p0))
            const rx = px0 - seg.p0x, ry = py0 - seg.p0y, rz = pz0 - seg.p0z;
            const cx1 = tqy * rz - tqz * ry + tqw * rx;
            const cy1 = tqz * rx - tqx * rz + tqw * ry;
            const cz1 = tqx * ry - tqy * rx + tqw * rz;
            vx = seg.p0x + rx + 2 * (tqy * cz1 - tqz * cy1);
            vy = seg.p0y + ry + 2 * (tqz * cx1 - tqx * cz1);
            vz = seg.p0z + rz + 2 * (tqx * cy1 - tqy * cx1);

            if (enableDqs) {
              // Effective rigid rotation q_eff = q_b * q_twist
              const nqx = qw * tqx + qx * tqw + qy * tqz - qz * tqy;
              const nqy = qw * tqy - qx * tqz + qy * tqw + qz * tqx;
              const nqz = qw * tqz + qx * tqy - qy * tqx + qz * tqw;
              const nqw = qw * tqw - qx * tqx - qy * tqy - qz * tqz;

              // Effective translation t_eff = t_b + R_b * (p0 - R_twist * p0)
              const p0rx = seg.p0x, p0ry = seg.p0y, p0rz = seg.p0z;
              const pcx = tqy * p0rz - tqz * p0ry + tqw * p0rx;
              const pcy = tqz * p0rx - tqx * p0rz + tqw * p0ry;
              const pcz = tqx * p0ry - tqy * p0rx + tqw * p0rz;
              const dpx = -2 * (tqy * pcz - tqz * pcy);
              const dpy = -2 * (tqz * pcx - tqx * pcz);
              const dpz = -2 * (tqx * pcy - tqy * pcx);

              const rOff = bIdx * 9;
              const etx = boneTrans[bIdx * 3]! + posedBoneRot9[rOff]! * dpx + posedBoneRot9[rOff + 3]! * dpy + posedBoneRot9[rOff + 6]! * dpz;
              const ety = boneTrans[bIdx * 3 + 1]! + posedBoneRot9[rOff + 1]! * dpx + posedBoneRot9[rOff + 4]! * dpy + posedBoneRot9[rOff + 7]! * dpz;
              const etz = boneTrans[bIdx * 3 + 2]! + posedBoneRot9[rOff + 2]! * dpx + posedBoneRot9[rOff + 5]! * dpy + posedBoneRot9[rOff + 8]! * dpz;

              qx = nqx; qy = nqy; qz = nqz; qw = nqw;
              dx = 0.5 * (etx * qw + ety * qz - etz * qy);
              dy = 0.5 * (-etx * qz + ety * qw + etz * qx);
              dz = 0.5 * (etx * qy - ety * qx + etz * qw);
              dw = -0.5 * (etx * qx + ety * qy + etz * qz);
            }
          }
        }
      }

      // LBS contribution using (potentially twist-warped) bind point
      const mOff = bIdx * 16;
      lbsX += bw * (boneSkinMat[mOff]! * vx + boneSkinMat[mOff + 4]! * vy + boneSkinMat[mOff + 8]! * vz + boneSkinMat[mOff + 12]!);
      lbsY += bw * (boneSkinMat[mOff + 1]! * vx + boneSkinMat[mOff + 5]! * vy + boneSkinMat[mOff + 9]! * vz + boneSkinMat[mOff + 13]!);
      lbsZ += bw * (boneSkinMat[mOff + 2]! * vx + boneSkinMat[mOff + 6]! * vy + boneSkinMat[mOff + 10]! * vz + boneSkinMat[mOff + 14]!);

      if (enableDqs) {
        if (k === 0) {
          pivQx = qx; pivQy = qy; pivQz = qz; pivQw = qw;
          dqsQx = bw * qx; dqsQy = bw * qy; dqsQz = bw * qz; dqsQw = bw * qw;
          dqsDx = bw * dx; dqsDy = bw * dy; dqsDz = bw * dz; dqsDw = bw * dw;
        } else {
          const dot = pivQx * qx + pivQy * qy + pivQz * qz + pivQw * qw;
          const sgn = dot < 0 ? -bw : bw;
          dqsQx += sgn * qx; dqsQy += sgn * qy; dqsQz += sgn * qz; dqsQw += sgn * qw;
          dqsDx += sgn * dx; dqsDy += sgn * dy; dqsDz += sgn * dz; dqsDw += sgn * dw;
        }
      }
    }

    if (!enableDqs) {
      skinnedPos[w3] = lbsX;
      skinnedPos[w3 + 1] = lbsY;
      skinnedPos[w3 + 2] = lbsZ;
      continue;
    }

    const qNorm = Math.sqrt(dqsQx * dqsQx + dqsQy * dqsQy + dqsQz * dqsQz + dqsQw * dqsQw);
    if (qNorm < 1e-8) {
      skinnedPos[w3] = lbsX;
      skinnedPos[w3 + 1] = lbsY;
      skinnedPos[w3 + 2] = lbsZ;
      continue;
    }
    const invQ = 1 / qNorm;
    const hqx = dqsQx * invQ, hqy = dqsQy * invQ, hqz = dqsQz * invQ, hqw = dqsQw * invQ;
    const hdx = dqsDx * invQ, hdy = dqsDy * invQ, hdz = dqsDz * invQ, hdw = dqsDw * invQ;

    // Evaluate DQS on restWeldedPos (px0, py0, pz0)
    const rcx = hqy * pz0 - hqz * py0 + hqw * px0;
    const rcy = hqz * px0 - hqx * pz0 + hqw * py0;
    const rcz = hqx * py0 - hqy * px0 + hqw * pz0;
    const dqsX = px0 + 2 * (hqy * rcz - hqz * rcy) + 2 * (hqw * hdx - hdw * hqx + (hqy * hdz - hqz * hdy));
    const dqsY = py0 + 2 * (hqz * rcx - hqx * rcz) + 2 * (hqw * hdy - hdw * hqy + (hqz * hdx - hqx * hdz));
    const dqsZ = pz0 + 2 * (hqx * rcy - hqy * rcx) + 2 * (hqw * hdz - hdw * hqz + (hqx * hdy - hqy * hdx));

    // Hybrid blend: 0.36 baseline DQS volume preservation (avoids DQS joint inflation on pure bends)
    // ramping to 1.0 under axial twist
    const beta = clamp(0.36 + 0.64 * smoothstep(10 * DEG, 55 * DEG, maxTwistMag), 0, 1);
    skinnedPos[w3] = lbsX + beta * (dqsX - lbsX);
    skinnedPos[w3 + 1] = lbsY + beta * (dqsY - lbsY);
    skinnedPos[w3 + 2] = lbsZ + beta * (dqsZ - lbsZ);
  }

  // Step 2C: Selective Welded CSR Jacobi Delta Mush + Tangent-Space Rest Detail Reconstruction
  const { weldedPos } = state;
  if (enableDeltaMush && dmIters > 0) {
    const smoothed = runSelectiveCsrJacobi(skinnedPos, tpl, dmIters, state.smoothBufA, state.smoothBufB);
    const { mushActiveIndices } = tpl;
    computeWeldedNormalsAndTangents(triIndices, vToWeld, smoothed, weldCount, state.smoothWeldNorm);
    if (mushActiveIndices.length < weldCount * 0.65) {
      weldedPos.set(skinnedPos);
      for (let idx = 0; idx < mushActiveIndices.length; idx++) {
        const w = mushActiveIndices[idx]!;
        const w3 = w * 3;
        const curEdgeLen = buildVertexTangentBasis(
          w,
          smoothed,
          state.smoothWeldNorm,
          refNeighbor,
          refNeighbor2,
          _tmpBasis9,
        );
        const stretchRatio = curEdgeLen / state.restRefEdgeLen[w]!;
        const detailScale = clamp(smoothstep(0.35, 0.85, stretchRatio), 0.35, 1.0);
        const d0 = state.restDeltasTS[w3]! * detailScale;
        const d1 = state.restDeltasTS[w3 + 1]! * detailScale;
        const d2 = state.restDeltasTS[w3 + 2]! * detailScale;
        weldedPos[w3] = smoothed[w3]! + _tmpBasis9[0]! * d0 + _tmpBasis9[3]! * d1 + _tmpBasis9[6]! * d2;
        weldedPos[w3 + 1] = smoothed[w3 + 1]! + _tmpBasis9[1]! * d0 + _tmpBasis9[4]! * d1 + _tmpBasis9[7]! * d2;
        weldedPos[w3 + 2] = smoothed[w3 + 2]! + _tmpBasis9[2]! * d0 + _tmpBasis9[5]! * d1 + _tmpBasis9[8]! * d2;
      }
    } else {
      for (let w = 0; w < weldCount; w++) {
        const w3 = w * 3;
        if (mushLambda[w]! <= 0) {
          weldedPos[w3] = skinnedPos[w3]!;
          weldedPos[w3 + 1] = skinnedPos[w3 + 1]!;
          weldedPos[w3 + 2] = skinnedPos[w3 + 2]!;
          continue;
        }
        const curEdgeLen = buildVertexTangentBasis(
          w,
          smoothed,
          state.smoothWeldNorm,
          refNeighbor,
          refNeighbor2,
          _tmpBasis9,
        );
        // Attenuate outward high-frequency detail slightly under strong tangential skin compression so concave folds stay silky
        const stretchRatio = curEdgeLen / state.restRefEdgeLen[w]!;
        const detailScale = clamp(smoothstep(0.35, 0.85, stretchRatio), 0.35, 1.0);
        const d0 = state.restDeltasTS[w3]! * detailScale;
        const d1 = state.restDeltasTS[w3 + 1]! * detailScale;
        const d2 = state.restDeltasTS[w3 + 2]! * detailScale;
        weldedPos[w3] = smoothed[w3]! + _tmpBasis9[0]! * d0 + _tmpBasis9[3]! * d1 + _tmpBasis9[6]! * d2;
        weldedPos[w3 + 1] = smoothed[w3 + 1]! + _tmpBasis9[1]! * d0 + _tmpBasis9[4]! * d1 + _tmpBasis9[7]! * d2;
        weldedPos[w3 + 2] = smoothed[w3 + 2]! + _tmpBasis9[2]! * d0 + _tmpBasis9[5]! * d1 + _tmpBasis9[8]! * d2;
      }
    }
  } else {
    weldedPos.set(skinnedPos);
  }

  // Measure posed flexion angles for diagnostics & Layer 3
  const leftElbowFlexionRad = computeFlexionAngle(posedBonePos, bl.upperarmL, bl.lowerarmL, bl.handL);
  const rightElbowFlexionRad = computeFlexionAngle(posedBonePos, bl.upperarmR, bl.lowerarmR, bl.handR);
  const leftKneeFlexionRad = computeFlexionAngle(posedBonePos, bl.thighL, bl.calfL, bl.footL);
  const rightKneeFlexionRad = computeFlexionAngle(posedBonePos, bl.thighR, bl.calfR, bl.footR);

  // Hip flexion measured relative to lumbar spine shaft (pelvis -> spine_02)
  const torsoUpX = posedBonePos[bl.spine02 * 3]! - posedBonePos[bl.pelvis * 3]!;
  const torsoUpY = posedBonePos[bl.spine02 * 3 + 1]! - posedBonePos[bl.pelvis * 3 + 1]!;
  const torsoUpZ = posedBonePos[bl.spine02 * 3 + 2]! - posedBonePos[bl.pelvis * 3 + 2]!;
  const torsoUpLen = Math.hypot(torsoUpX, torsoUpY, torsoUpZ) || 1;
  const tUx = torsoUpX / torsoUpLen, tUy = torsoUpY / torsoUpLen, tUz = torsoUpZ / torsoUpLen;

  const measureHipFlexion = (thighIdx: number, calfIdx: number): number => {
    const dx = posedBonePos[calfIdx * 3]! - posedBonePos[thighIdx * 3]!;
    const dy = posedBonePos[calfIdx * 3 + 1]! - posedBonePos[thighIdx * 3 + 1]!;
    const dz = posedBonePos[calfIdx * 3 + 2]! - posedBonePos[thighIdx * 3 + 2]!;
    const dl = Math.hypot(dx, dy, dz) || 1;
    // Only count anterior/upward flexion (filter out pure backward hip extension)
    const spineFwdX = posedBoneRot9[bl.pelvis * 9 + 6]!;
    const spineFwdY = posedBoneRot9[bl.pelvis * 9 + 7]!;
    const spineFwdZ = posedBoneRot9[bl.pelvis * 9 + 8]!;
    const fwdDot = (dx * spineFwdX + dy * spineFwdY + dz * spineFwdZ) / dl;
    if (fwdDot < -0.15) return 0;
    const cosOpen = clamp((dx * tUx + dy * tUy + dz * tUz) / dl, -1, 1);
    return Math.PI - Math.acos(cosOpen);
  };
  const leftHipFlexionRad = measureHipFlexion(bl.thighL, bl.calfL);
  const rightHipFlexionRad = measureHipFlexion(bl.thighR, bl.calfR);

  let maxCreaseCorrectionM = 0;
  let maxMuscleBulgeM = 0;
  let maxCapsulePushoutM = 0;

  if (enableContact) {
    const env = state.envelope;

    // 3A. Closed-Form Agonist Muscle Bulges & Bony Landmark Protection (Olecranon, Patella, Biceps, Gastrocnemius, Gluteus)
    // Evaluated BEFORE Hinge Crease-Bisector Contact so bulging gastrocnemius/biceps tissue is physically clamped against Pi_J and redirected into lateral Poisson squish!
    const curlActL = smoothstep(22 * DEG, 130 * DEG, leftElbowFlexionRad);
    const curlActR = smoothstep(22 * DEG, 130 * DEG, rightElbowFlexionRad);
    const kneeActL = smoothstep(45 * DEG, 135 * DEG, leftKneeFlexionRad);
    const kneeActR = smoothstep(45 * DEG, 135 * DEG, rightKneeFlexionRad);
    const hipActL = smoothstep(45 * DEG, 105 * DEG, leftHipFlexionRad);
    const hipActR = smoothstep(45 * DEG, 105 * DEG, rightHipFlexionRad);

    // Supination bonus on biceps peak: on left arm (+X bind), positive twist around +X rotates +Z -> -Y; check +/- twist symmetrically for tone
    const supinBonusL = 1 + 0.18 * clamp(Math.abs(Math.sin(0.5 * leftForearmTwistRad)), 0, 1);
    const supinBonusR = 1 + 0.18 * clamp(Math.abs(Math.sin(0.5 * rightForearmTwistRad)), 0, 1);

    if (
      curlActL > 1e-3 || curlActR > 1e-3 ||
      kneeActL > 1e-3 || kneeActR > 1e-3 ||
      hipActL > 1e-3 || hipActR > 1e-3
    ) {
      const segUL = state.limbSegs[SEG_UPPERARM_L]!;
      const segUR = state.limbSegs[SEG_UPPERARM_R]!;
      const segCL = state.limbSegs[SEG_CALF_L]!;
      const segCR = state.limbSegs[SEG_CALF_R]!;
      const segTL = state.limbSegs[SEG_THIGH_L]!;
      const segTR = state.limbSegs[SEG_THIGH_R]!;
      const pPelvisBindY = state.bindBonePos[bl.pelvis * 3 + 1]!;
      const pPelvisBindZ = state.bindBonePos[bl.pelvis * 3 + 2]!;
      const { bulgeCandidates } = tpl;

      for (let bIdx = 0; bIdx < bulgeCandidates.length; bIdx++) {
        const w = bulgeCandidates[bIdx]!;
        const w3 = w * 3;
        const rx0 = restWeldedPos[w3]!;
        const ry0 = restWeldedPos[w3 + 1]!;
        const rz0 = restWeldedPos[w3 + 2]!;
        let bdx = 0, bdy = 0, bdz = 0;

        // Left / Right Biceps Brachii (proximally shortening peak on deep flexion) + Olecranon preservation
        const wUL = wm.wUpperArmL[w]!;
        const wLL = wm.wLowerArmL[w]!;
        if (curlActL > 1e-3 && (wUL > 0.20 || wLL > 0.20)) {
          const sU = ((rx0 - segUL.p0x) * segUL.ax + (ry0 - segUL.p0y) * segUL.ay + (rz0 - segUL.p0z) * segUL.az) / segUL.len;
          const dzAnt = rz0 - segUL.p0z; // +Z in bind space is anterior biceps, -Z is posterior olecranon/triceps
          const sSpanL = 0.72 - 0.14 * curlActL; // Muscle belly shortens proximally toward ~0.34 under deep curl
          if (wUL > 0.25 && dzAnt > -0.004 && sU > 0.08 && sU < 0.08 + sSpanL) {
            const sNorm = clamp((sU - 0.08) / sSpanL, 0, 1);
            // Skewed bell peaking around sNorm ~ 0.42 (sU ~ 0.32 at full curl, clear of the folded forearm)
            const axialBell = Math.sin(Math.PI * Math.pow(sNorm, 0.82));
            const antMask = smoothstep(-0.004, 0.024, dzAnt);
            const amp = 0.0155 * wUL * curlActL * supinBonusL * axialBell * axialBell * antMask;
            const rOff = bl.upperarmL * 9;
            // +Z bind direction rotated by upperarmL skinning rotation (col 2 of posedBoneRot9)
            bdx += amp * posedBoneRot9[rOff + 6]!;
            bdy += amp * posedBoneRot9[rOff + 7]!;
            bdz += amp * posedBoneRot9[rOff + 8]!;
          } else if (dzAnt < -0.008 && sU > 0.82 && sU < 1.14) {
            // Olecranon bony elbow tip preservation (-Z bind)
            const oleBell = 1 - Math.abs(clamp((sU - 0.98) / 0.16, -1, 1));
            const amp = 0.0055 * (wUL + wLL) * curlActL * oleBell * smoothstep(0.008, 0.030, -dzAnt);
            const rOff = bl.upperarmL * 9;
            bdx -= amp * posedBoneRot9[rOff + 6]!;
            bdy -= amp * posedBoneRot9[rOff + 7]!;
            bdz -= amp * posedBoneRot9[rOff + 8]!;
          }
        }

        const wUR = wm.wUpperArmR[w]!;
        const wLR = wm.wLowerArmR[w]!;
        if (curlActR > 1e-3 && (wUR > 0.20 || wLR > 0.20)) {
          const sU = ((rx0 - segUR.p0x) * segUR.ax + (ry0 - segUR.p0y) * segUR.ay + (rz0 - segUR.p0z) * segUR.az) / segUR.len;
          const dzAnt = rz0 - segUR.p0z;
          const sSpanR = 0.72 - 0.14 * curlActR;
          if (wUR > 0.25 && dzAnt > -0.004 && sU > 0.08 && sU < 0.08 + sSpanR) {
            const sNorm = clamp((sU - 0.08) / sSpanR, 0, 1);
            const axialBell = Math.sin(Math.PI * Math.pow(sNorm, 0.82));
            const antMask = smoothstep(-0.004, 0.024, dzAnt);
            const amp = 0.0155 * wUR * curlActR * supinBonusR * axialBell * axialBell * antMask;
            const rOff = bl.upperarmR * 9;
            bdx += amp * posedBoneRot9[rOff + 6]!;
            bdy += amp * posedBoneRot9[rOff + 7]!;
            bdz += amp * posedBoneRot9[rOff + 8]!;
          } else if (dzAnt < -0.008 && sU > 0.82 && sU < 1.14) {
            const oleBell = 1 - Math.abs(clamp((sU - 0.98) / 0.16, -1, 1));
            const amp = 0.0055 * (wUR + wLR) * curlActR * oleBell * smoothstep(0.008, 0.030, -dzAnt);
            const rOff = bl.upperarmR * 9;
            bdx -= amp * posedBoneRot9[rOff + 6]!;
            bdy -= amp * posedBoneRot9[rOff + 7]!;
            bdz -= amp * posedBoneRot9[rOff + 8]!;
          }
        }

        // Left / Right Gastrocnemius Calf Bulge + Patella Bony Preservation
        const wTL = wm.wThighL[w]!;
        const wCL = wm.wCalfL[w]!;
        if (kneeActL > 1e-3 && (wCL > 0.20 || wTL > 0.20)) {
          const sC = ((rx0 - segCL.p0x) * segCL.ax + (ry0 - segCL.p0y) * segCL.ay + (rz0 - segCL.p0z) * segCL.az) / segCL.len;
          const dzC = rz0 - segCL.p0z; // +Z anterior shin/patella, -Z posterior gastrocnemius
          if (wCL > 0.25 && dzC < 0.005 && sC > 0.08 && sC < 0.68) {
            const sNorm = clamp((sC - 0.08) / 0.58, 0, 1);
            const gastroBell = Math.sin(Math.PI * sNorm);
            const postMask = smoothstep(-0.005, 0.035, -dzC);
            const latOffset = rx0 - segCL.p0x;
            const latSign = latOffset / Math.hypot(latOffset, 0.015);
            const amp = 0.011 * wCL * kneeActL * gastroBell * postMask;
            const rOff = bl.calfL * 9;
            // Push posteriorly (-Z bind) and spread gastrocnemius heads laterally (+/-X bind)
            bdx += -amp * 0.55 * posedBoneRot9[rOff + 6]! + amp * 0.72 * latSign * posedBoneRot9[rOff]!;
            bdy += -amp * 0.55 * posedBoneRot9[rOff + 7]! + amp * 0.72 * latSign * posedBoneRot9[rOff + 1]!;
            bdz += -amp * 0.55 * posedBoneRot9[rOff + 8]! + amp * 0.72 * latSign * posedBoneRot9[rOff + 2]!;
          } else if (dzC > 0.012 && sC > -0.14 && sC < 0.16) {
            // Patella bony kneecap preservation (+Z bind)
            const patBell = 1 - Math.abs(clamp(sC / 0.15, -1, 1));
            const amp = 0.0055 * (wTL + wCL) * kneeActL * patBell * smoothstep(0.012, 0.042, dzC);
            const rOff = bl.calfL * 9;
            bdx += amp * posedBoneRot9[rOff + 6]!;
            bdy += amp * posedBoneRot9[rOff + 7]!;
            bdz += amp * posedBoneRot9[rOff + 8]!;
          }
        }

        const wTR = wm.wThighR[w]!;
        const wCR = wm.wCalfR[w]!;
        if (kneeActR > 1e-3 && (wCR > 0.20 || wTR > 0.20)) {
          const sC = ((rx0 - segCR.p0x) * segCR.ax + (ry0 - segCR.p0y) * segCR.ay + (rz0 - segCR.p0z) * segCR.az) / segCR.len;
          const dzC = rz0 - segCR.p0z;
          if (wCR > 0.25 && dzC < 0.005 && sC > 0.08 && sC < 0.68) {
            const sNorm = clamp((sC - 0.08) / 0.58, 0, 1);
            const gastroBell = Math.sin(Math.PI * sNorm);
            const postMask = smoothstep(-0.005, 0.035, -dzC);
            const latOffset = rx0 - segCR.p0x;
            const latSign = latOffset / Math.hypot(latOffset, 0.015);
            const amp = 0.011 * wCR * kneeActR * gastroBell * postMask;
            const rOff = bl.calfR * 9;
            bdx += -amp * 0.55 * posedBoneRot9[rOff + 6]! + amp * 0.72 * latSign * posedBoneRot9[rOff]!;
            bdy += -amp * 0.55 * posedBoneRot9[rOff + 7]! + amp * 0.72 * latSign * posedBoneRot9[rOff + 1]!;
            bdz += -amp * 0.55 * posedBoneRot9[rOff + 8]! + amp * 0.72 * latSign * posedBoneRot9[rOff + 2]!;
          } else if (dzC > 0.012 && sC > -0.14 && sC < 0.16) {
            const patBell = 1 - Math.abs(clamp(sC / 0.15, -1, 1));
            const amp = 0.0055 * (wTR + wCR) * kneeActR * patBell * smoothstep(0.012, 0.042, dzC);
            const rOff = bl.calfR * 9;
            bdx += amp * posedBoneRot9[rOff + 6]!;
            bdy += amp * posedBoneRot9[rOff + 7]!;
            bdz += amp * posedBoneRot9[rOff + 8]!;
          }
        }

        // Seated / Crouch Gluteus Maximus Volume Arc (-Z posterior pelvis/upper-thigh)
        const wGluteRegion = wm.wPelvis[w]! + wTL + wTR;
        if ((hipActL > 1e-3 || hipActR > 1e-3) && wGluteRegion > 0.45 && rz0 < pPelvisBindZ - 0.01) {
          const isLeftSide = rx0 >= 0;
          const sideAct = isLeftSide
            ? hipActL * smoothstep(-0.02, 0.04, rx0) + hipActR * (1 - smoothstep(-0.02, 0.04, rx0))
            : hipActR * smoothstep(-0.02, 0.04, -rx0) + hipActL * (1 - smoothstep(-0.02, 0.04, -rx0));
          const yBand = 1 - clamp(Math.abs(ry0 - (pPelvisBindY - 0.035)) / 0.11, 0, 1);
          const postMask = smoothstep(0.015, 0.065, pPelvisBindZ - rz0);
          if (yBand > 0 && postMask > 0 && sideAct > 1e-3) {
            const amp = 0.011 * sideAct * yBand * postMask * Math.min(1, wGluteRegion);
            const rOff = bl.pelvis * 9;
            // Posterior (-Z) and slightly inferior (-Y) in pelvis frame so seated glutes stay rounded
            bdx += -amp * posedBoneRot9[rOff + 6]! - amp * 0.30 * posedBoneRot9[rOff + 3]!;
            bdy += -amp * posedBoneRot9[rOff + 7]! - amp * 0.30 * posedBoneRot9[rOff + 4]!;
            bdz += -amp * posedBoneRot9[rOff + 8]! - amp * 0.30 * posedBoneRot9[rOff + 5]!;
          }
        }

        // Prevent medial thigh overlap if hips adduct slightly
        if ((wTL > 0.5 || wTR > 0.5) && Math.abs(rx0) > 0.005) {
          const segT = wTL >= wTR ? segTL : segTR;
          const sT = ((rx0 - segT.p0x) * segT.ax + (ry0 - segT.p0y) * segT.ay + (rz0 - segT.p0z) * segT.az) / segT.len;
          void sT;
        }

        const bulgeMag = Math.hypot(bdx, bdy, bdz);
        if (bulgeMag > 1e-6) {
          weldedPos[w3]! += bdx;
          weldedPos[w3 + 1]! += bdy;
          weldedPos[w3 + 2]! += bdz;
          if (bulgeMag > maxMuscleBulgeM) maxMuscleBulgeM = bulgeMag;
        }
      }
    }

    // 3B. Hinge Crease-Bisector Half-Space Contact + Lateral Poisson Squish
    // Left Knee
    maxCreaseCorrectionM = Math.max(
      maxCreaseCorrectionM,
      applyHingeCreaseContact(
        weldedPos, tpl.creaseKneeL, wm.wThighL, wm.wCalfL, 0, restWeldedPos,
        posedBonePos[bl.calfL * 3]!, posedBonePos[bl.calfL * 3 + 1]!, posedBonePos[bl.calfL * 3 + 2]!,
        posedBonePos[bl.thighL * 3]! - posedBonePos[bl.calfL * 3]!,
        posedBonePos[bl.thighL * 3 + 1]! - posedBonePos[bl.calfL * 3 + 1]!,
        posedBonePos[bl.thighL * 3 + 2]! - posedBonePos[bl.calfL * 3 + 2]!,
        posedBonePos[bl.footL * 3]! - posedBonePos[bl.calfL * 3]!,
        posedBonePos[bl.footL * 3 + 1]! - posedBonePos[bl.calfL * 3 + 1]!,
        posedBonePos[bl.footL * 3 + 2]! - posedBonePos[bl.calfL * 3 + 2]!,
        state.limbSegs[SEG_CALF_L]!.len, env.thighR,
        62 * DEG, 98 * DEG, 0.002, 0.52,
      ),
    );
    // Right Knee
    maxCreaseCorrectionM = Math.max(
      maxCreaseCorrectionM,
      applyHingeCreaseContact(
        weldedPos, tpl.creaseKneeR, wm.wThighR, wm.wCalfR, 0, restWeldedPos,
        posedBonePos[bl.calfR * 3]!, posedBonePos[bl.calfR * 3 + 1]!, posedBonePos[bl.calfR * 3 + 2]!,
        posedBonePos[bl.thighR * 3]! - posedBonePos[bl.calfR * 3]!,
        posedBonePos[bl.thighR * 3 + 1]! - posedBonePos[bl.calfR * 3 + 1]!,
        posedBonePos[bl.thighR * 3 + 2]! - posedBonePos[bl.calfR * 3 + 2]!,
        posedBonePos[bl.footR * 3]! - posedBonePos[bl.calfR * 3]!,
        posedBonePos[bl.footR * 3 + 1]! - posedBonePos[bl.calfR * 3 + 1]!,
        posedBonePos[bl.footR * 3 + 2]! - posedBonePos[bl.calfR * 3 + 2]!,
        state.limbSegs[SEG_CALF_R]!.len, env.thighR,
        62 * DEG, 98 * DEG, 0.002, 0.52,
      ),
    );
    // Anterior Left & Right Hip Inguinal Crease (only when flexed forward)
    if (leftHipFlexionRad > 68 * DEG) {
      maxCreaseCorrectionM = Math.max(
        maxCreaseCorrectionM,
        applyHingeCreaseContact(
          weldedPos, tpl.creaseHipL, wm.wTorsoCore, wm.wThighL, 1, restWeldedPos,
          posedBonePos[bl.thighL * 3]!, posedBonePos[bl.thighL * 3 + 1]!, posedBonePos[bl.thighL * 3 + 2]!,
          torsoUpX, torsoUpY, torsoUpZ,
          posedBonePos[bl.calfL * 3]! - posedBonePos[bl.thighL * 3]!,
          posedBonePos[bl.calfL * 3 + 1]! - posedBonePos[bl.thighL * 3 + 1]!,
          posedBonePos[bl.calfL * 3 + 2]! - posedBonePos[bl.thighL * 3 + 2]!,
          state.limbSegs[SEG_THIGH_L]!.len * 0.72, env.thighR * 1.15,
          68 * DEG, 102 * DEG, 0.002, 0.35,
        ),
      );
    }
    if (rightHipFlexionRad > 68 * DEG) {
      maxCreaseCorrectionM = Math.max(
        maxCreaseCorrectionM,
        applyHingeCreaseContact(
          weldedPos, tpl.creaseHipR, wm.wTorsoCore, wm.wThighR, -1, restWeldedPos,
          posedBonePos[bl.thighR * 3]!, posedBonePos[bl.thighR * 3 + 1]!, posedBonePos[bl.thighR * 3 + 2]!,
          torsoUpX, torsoUpY, torsoUpZ,
          posedBonePos[bl.calfR * 3]! - posedBonePos[bl.thighR * 3]!,
          posedBonePos[bl.calfR * 3 + 1]! - posedBonePos[bl.thighR * 3 + 1]!,
          posedBonePos[bl.calfR * 3 + 2]! - posedBonePos[bl.thighR * 3 + 2]!,
          state.limbSegs[SEG_THIGH_R]!.len * 0.72, env.thighR * 1.15,
          68 * DEG, 102 * DEG, 0.002, 0.35,
        ),
      );
    }

    // 3C. Tapered Limb-vs-Body & Hand-vs-Thigh Anti-Clipping Capsules (auto-scaled to BodyTypeId)
    const pPelX = posedBonePos[bl.pelvis * 3]!, pPelY = posedBonePos[bl.pelvis * 3 + 1]!, pPelZ = posedBonePos[bl.pelvis * 3 + 2]!;
    const pSp1X = posedBonePos[bl.spine01 * 3]!, pSp1Y = posedBonePos[bl.spine01 * 3 + 1]!, pSp1Z = posedBonePos[bl.spine01 * 3 + 2]!;
    const pSp2X = posedBonePos[bl.spine02 * 3]!, pSp2Y = posedBonePos[bl.spine02 * 3 + 1]!, pSp2Z = posedBonePos[bl.spine02 * 3 + 2]!;
    const pSp3X = posedBonePos[bl.spine03 * 3]!, pSp3Y = posedBonePos[bl.spine03 * 3 + 1]!, pSp3Z = posedBonePos[bl.spine03 * 3 + 2]!;
    const pHdX = posedBonePos[bl.head * 3]!, pHdY = posedBonePos[bl.head * 3 + 1]!, pHdZ = posedBonePos[bl.head * 3 + 2]!;

    // Anterior belly dome sphere center (offset along spine_01 +Z forward)
    const sp1FwdX = posedBoneRot9[bl.spine01 * 9 + 6]!;
    const sp1FwdY = posedBoneRot9[bl.spine01 * 9 + 7]!;
    const sp1FwdZ = posedBoneRot9[bl.spine01 * 9 + 8]!;
    const bellyMidX = 0.55 * pSp1X + 0.45 * pSp2X + env.bellyFrontOffsetZ * sp1FwdX;
    const bellyMidY = 0.55 * pSp1Y + 0.45 * pSp2Y + env.bellyFrontOffsetZ * sp1FwdY;
    const bellyMidZ = 0.55 * pSp1Z + 0.45 * pSp2Z + env.bellyFrontOffsetZ * sp1FwdZ;

    // Bust spheres (when bustRadius > 0, e.g. female / busty / chubby / fat / obese)
    const sp3RightX = posedBoneRot9[bl.spine03 * 9]!, sp3RightY = posedBoneRot9[bl.spine03 * 9 + 1]!, sp3RightZ = posedBoneRot9[bl.spine03 * 9 + 2]!;
    const sp3UpX = posedBoneRot9[bl.spine03 * 9 + 3]!, sp3UpY = posedBoneRot9[bl.spine03 * 9 + 4]!, sp3UpZ = posedBoneRot9[bl.spine03 * 9 + 5]!;
    const sp3FwdX = posedBoneRot9[bl.spine03 * 9 + 6]!, sp3FwdY = posedBoneRot9[bl.spine03 * 9 + 7]!, sp3FwdZ = posedBoneRot9[bl.spine03 * 9 + 8]!;

    const bustLX = pSp3X + env.bustOffsetX * sp3RightX + env.bustOffsetY * sp3UpX + env.bustOffsetZ * sp3FwdX;
    const bustLY = pSp3Y + env.bustOffsetX * sp3RightY + env.bustOffsetY * sp3UpY + env.bustOffsetZ * sp3FwdY;
    const bustLZ = pSp3Z + env.bustOffsetX * sp3RightZ + env.bustOffsetY * sp3UpZ + env.bustOffsetZ * sp3FwdZ;

    const bustRX = pSp3X - env.bustOffsetX * sp3RightX + env.bustOffsetY * sp3UpX + env.bustOffsetZ * sp3FwdX;
    const bustRY = pSp3Y - env.bustOffsetX * sp3RightY + env.bustOffsetY * sp3UpY + env.bustOffsetZ * sp3FwdY;
    const bustRZ = pSp3Z - env.bustOffsetX * sp3RightZ + env.bustOffsetY * sp3UpZ + env.bustOffsetZ * sp3FwdZ;

    const hdUpX = posedBoneRot9[bl.head * 9 + 3]!, hdUpY = posedBoneRot9[bl.head * 9 + 4]!, hdUpZ = posedBoneRot9[bl.head * 9 + 5]!;
    const headCenterX = pHdX + 0.08 * hdUpX;
    const headCenterY = pHdY + 0.08 * hdUpY;
    const headCenterZ = pHdZ + 0.08 * hdUpZ;

    const pelvisCapR = Math.min(env.pelvisRx, env.pelvisRz) * 0.94;
    const chestCapR = Math.min(env.chestRx, env.chestRz) * 0.94;
    const { distArmCandidates } = tpl;

    for (let dIdx = 0; dIdx < distArmCandidates.length; dIdx++) {
      const w = distArmCandidates[dIdx]!;
      const wDistArmL = wm.wLowerArmL[w]! + wm.wHandChainL[w]!;
      const wDistArmR = wm.wLowerArmR[w]! + wm.wHandChainR[w]!;
      const wDistArm = wDistArmL + wDistArmR;
      if (wDistArm < 0.35) continue;

      const armGate = smoothstep(0.35, 0.75, wDistArm);
      const w3 = w * 3;
      let vx = weldedPos[w3]!;
      let vy = weldedPos[w3 + 1]!;
      let vz = weldedPos[w3 + 2]!;
      let totalPush = 0;

      // 1. Torso core capsule (pelvis -> spine_03)
      let pen = pushOutOfTaperedCapsule(
        vx, vy, vz,
        pPelX, pPelY, pPelZ, pelvisCapR,
        pSp3X, pSp3Y, pSp3Z, chestCapR,
        armGate, _capDelta,
      );
      if (pen > 0) {
        vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
        totalPush += pen;
      }

      // 2. Anterior belly dome sphere
      pen = pushOutOfTaperedCapsule(
        vx, vy, vz,
        bellyMidX, bellyMidY, bellyMidZ, env.bellyRadius * 0.92,
        bellyMidX, bellyMidY, bellyMidZ, env.bellyRadius * 0.92,
        armGate, _capDelta,
      );
      if (pen > 0) {
        vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
        totalPush += pen;
      }

      // 3. Bust spheres (when present)
      if (env.bustRadius > 0.01) {
        pen = pushOutOfTaperedCapsule(
          vx, vy, vz,
          bustLX, bustLY, bustLZ, env.bustRadius,
          bustLX, bustLY, bustLZ, env.bustRadius,
          armGate, _capDelta,
        );
        if (pen > 0) {
          vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
          totalPush += pen;
        }
        pen = pushOutOfTaperedCapsule(
          vx, vy, vz,
          bustRX, bustRY, bustRZ, env.bustRadius,
          bustRX, bustRY, bustRZ, env.bustRadius,
          armGate, _capDelta,
        );
        if (pen > 0) {
          vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
          totalPush += pen;
        }
      }

      // 4. Head sphere (prevents hands clipping into enlarged chibi or regular head)
      pen = pushOutOfTaperedCapsule(
        vx, vy, vz,
        headCenterX, headCenterY, headCenterZ, env.headRadius,
        headCenterX, headCenterY, headCenterZ, env.headRadius,
        armGate, _capDelta,
      );
      if (pen > 0) {
        vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
        totalPush += pen;
      }

      // 5. Thigh capsules (prevents forearms/hands sinking into thighs in Seated / Crouch / Kneeling)
      pen = pushOutOfTaperedCapsule(
        vx, vy, vz,
        posedBonePos[bl.thighL * 3]!, posedBonePos[bl.thighL * 3 + 1]!, posedBonePos[bl.thighL * 3 + 2]!, env.thighR * 0.92,
        posedBonePos[bl.calfL * 3]!, posedBonePos[bl.calfL * 3 + 1]!, posedBonePos[bl.calfL * 3 + 2]!, env.calfR * 0.90,
        armGate, _capDelta,
      );
      if (pen > 0) {
        vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
        totalPush += pen;
      }
      pen = pushOutOfTaperedCapsule(
        vx, vy, vz,
        posedBonePos[bl.thighR * 3]!, posedBonePos[bl.thighR * 3 + 1]!, posedBonePos[bl.thighR * 3 + 2]!, env.thighR * 0.92,
        posedBonePos[bl.calfR * 3]!, posedBonePos[bl.calfR * 3 + 1]!, posedBonePos[bl.calfR * 3 + 2]!, env.calfR * 0.90,
        armGate, _capDelta,
      );
      if (pen > 0) {
        vx += _capDelta[0]!; vy += _capDelta[1]!; vz += _capDelta[2]!;
        totalPush += pen;
      }

      if (totalPush > 0) {
        weldedPos[w3] = vx;
        weldedPos[w3 + 1] = vy;
        weldedPos[w3 + 2] = vz;
        if (totalPush > maxCapsulePushoutM) maxCapsulePushoutM = totalPush;
      }
    }
    // Resolve the elbow fold last: a chest contact can otherwise push a
    // curled forearm straight back through the upper arm.
    for (const left of [true, false]) {
      const e = 3 * (left ? bl.lowerarmL : bl.lowerarmR);
      const s = 3 * (left ? bl.upperarmL : bl.upperarmR);
      const h = 3 * (left ? bl.handL : bl.handR);
      maxCreaseCorrectionM = Math.max(maxCreaseCorrectionM, applyHingeCreaseContact(
        weldedPos, left ? tpl.creaseElbL : tpl.creaseElbR,
        left ? wm.wUpperArmL : wm.wUpperArmR, left ? wm.wLowerArmL : wm.wLowerArmR, 0, restWeldedPos,
        posedBonePos[e]!, posedBonePos[e+1]!, posedBonePos[e+2]!,
        posedBonePos[s]! - posedBonePos[e]!, posedBonePos[s+1]! - posedBonePos[e+1]!, posedBonePos[s+2]! - posedBonePos[e+2]!,
        posedBonePos[h]! - posedBonePos[e]!, posedBonePos[h+1]! - posedBonePos[e+1]!, posedBonePos[h+2]! - posedBonePos[e+2]!,
        state.limbSegs[left ? SEG_LOWERARM_L : SEG_LOWERARM_R]!.len, env.upperArmR,
        65 * DEG, 100 * DEG, 0.0015, 0.48,
      ));
    }
  }

  // Step 4: Scatter welded positions to split UV vertices (100% seam coincidence) + compute welded smooth normals + fast AABB
  const posAttr = mainSkin.geometry.getAttribute('position') as T.BufferAttribute;
  const normAttr = mainSkin.geometry.getAttribute('normal') as T.BufferAttribute;
  const outPos = posAttr.array as Float32Array;
  const outNorm = normAttr.array as Float32Array;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let w = 0; w < weldCount; w++) {
    const w3 = w * 3;
    const x = weldedPos[w3]!, y = weldedPos[w3 + 1]!, z = weldedPos[w3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  if (normWeldCanon === vToWeld) {
    computeWeldedNormalsAndTangents(triIndices, vToWeld, weldedPos, weldCount, state.smoothWeldNorm);
    const { smoothWeldNorm } = state;
    for (let v = 0; v < splitCount; v++) {
      const w3 = vToWeld[v]! * 3;
      const v3 = v * 3;
      outPos[v3] = weldedPos[w3]!;
      outPos[v3 + 1] = weldedPos[w3 + 1]!;
      outPos[v3 + 2] = weldedPos[w3 + 2]!;
      outNorm[v3] = smoothWeldNorm[w3]!;
      outNorm[v3 + 1] = smoothWeldNorm[w3 + 1]!;
      outNorm[v3 + 2] = smoothWeldNorm[w3 + 2]!;
    }
  } else {
    for (let v = 0; v < splitCount; v++) {
      const w3 = vToWeld[v]! * 3;
      const v3 = v * 3;
      outPos[v3] = weldedPos[w3]!;
      outPos[v3 + 1] = weldedPos[w3 + 1]!;
      outPos[v3 + 2] = weldedPos[w3 + 2]!;
    }

    // Seam-welded area-weighted smooth normals
    const { normGroupAccum } = state;
    normGroupAccum.fill(0);
    const triCount = triIndices.length;
    for (let i = 0; i + 2 < triCount; i += 3) {
      const ia = triIndices[i]!, ib = triIndices[i + 1]!, ic = triIndices[i + 2]!;
      const ax = outPos[ia * 3]!, ay = outPos[ia * 3 + 1]!, az = outPos[ia * 3 + 2]!;
      const bx = outPos[ib * 3]!, by = outPos[ib * 3 + 1]!, bz = outPos[ib * 3 + 2]!;
      const cx = outPos[ic * 3]!, cy = outPos[ic * 3 + 1]!, cz = outPos[ic * 3 + 2]!;
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const fnx = e1y * e2z - e1z * e2y;
      const fny = e1z * e2x - e1x * e2z;
      const fnz = e1x * e2y - e1y * e2x;

      const ga = normWeldCanon[ia]! * 3;
      const gb = normWeldCanon[ib]! * 3;
      const gc = normWeldCanon[ic]! * 3;
      normGroupAccum[ga]! += fnx; normGroupAccum[ga + 1]! += fny; normGroupAccum[ga + 2]! += fnz;
      normGroupAccum[gb]! += fnx; normGroupAccum[gb + 1]! += fny; normGroupAccum[gb + 2]! += fnz;
      normGroupAccum[gc]! += fnx; normGroupAccum[gc + 1]! += fny; normGroupAccum[gc + 2]! += fnz;
    }

    for (let g = 0; g < normWeldGroupCount; g++) {
      const g3 = g * 3;
      const nx = normGroupAccum[g3]!, ny = normGroupAccum[g3 + 1]!, nz = normGroupAccum[g3 + 2]!;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-12) {
        const inv = 1 / len;
        normGroupAccum[g3] = nx * inv;
        normGroupAccum[g3 + 1] = ny * inv;
        normGroupAccum[g3 + 2] = nz * inv;
      } else {
        normGroupAccum[g3] = 0;
        normGroupAccum[g3 + 1] = 1;
        normGroupAccum[g3 + 2] = 0;
      }
    }

    for (let v = 0; v < splitCount; v++) {
      const g3 = normWeldCanon[v]! * 3;
      const v3 = v * 3;
      outNorm[v3] = normGroupAccum[g3]!;
      outNorm[v3 + 1] = normGroupAccum[g3 + 1]!;
      outNorm[v3 + 2] = normGroupAccum[g3 + 2]!;
    }
  }

  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  if (mainSkin.geometry.boundsTree) {
    mainSkin.geometry.disposeBoundsTree?.();
    mainSkin.geometry.boundsTree = undefined;
  }

  // Step 5: Configure world-transform-invariant identity pass-through skinning on `mainSkin.skeleton`
  // Setting boneInverses[b] = inv(bones[b].matrixWorld) * mainSkin.matrixWorld * inv(bindMatrix)
  // makes BOTH WebGLRenderer/BokehPass/ShadowMap (`skeleton.update()`) AND CPU `getVertexPosition()` / `groundPoseY()`
  // evaluate to exact identity on `mainSkin`, even if `figure.root` is subsequently moved in world space!
  _matB.copy(mainSkin.bindMatrix).invert();
  _matA.multiplyMatrices(mainSkin.matrixWorld, _matB);
  for (let b = 0; b < boneCount; b++) {
    const bone = mainSkin.skeleton.bones[b]!;
    mainSkin.skeleton.boneInverses[b]!.copy(bone.matrixWorld).invert().multiply(_matA);
  }
  mainSkin.skeleton.update();
  state.activePassThrough = true;
  mainSkin.userData.__skinDeformerPassThrough = true;

  if (Number.isFinite(minX)) {
    if (!mainSkin.boundingBox) mainSkin.boundingBox = new T.Box3();
    mainSkin.boundingBox.min.set(minX, minY, minZ);
    mainSkin.boundingBox.max.set(maxX, maxY, maxZ);

    // Compute tight posed bounding sphere around the posed AABB midpoint (avoids sqrt(3) corner bloat & zero allocations!)
    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const cz = 0.5 * (minZ + maxZ);
    let maxRadSq = 0;
    for (let w = 0; w < weldCount; w++) {
      const w3 = w * 3;
      const dx = weldedPos[w3]! - cx;
      const dy = weldedPos[w3 + 1]! - cy;
      const dz = weldedPos[w3 + 2]! - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > maxRadSq) maxRadSq = dSq;
    }
    if (!mainSkin.boundingSphere) mainSkin.boundingSphere = new T.Sphere();
    mainSkin.boundingSphere.center.set(cx, cy, cz);
    mainSkin.boundingSphere.radius = Math.sqrt(maxRadSq) + 1e-4;

    if (!mainSkin.geometry.boundingBox) mainSkin.geometry.boundingBox = new T.Box3();
    mainSkin.geometry.boundingBox.copy(mainSkin.boundingBox);
    if (!mainSkin.geometry.boundingSphere) mainSkin.geometry.boundingSphere = new T.Sphere();
    mainSkin.geometry.boundingSphere.copy(mainSkin.boundingSphere);
  }

  // Record bone skinning transform cache for fast unchanged-bone short-circuiting
  const cachedQT = state.lastDeformedBoneQuatTrans;
  for (let b = 0; b < boneCount; b++) {
    const off7 = b * 7;
    cachedQT[off7] = boneQuat[b * 4]!;
    cachedQT[off7 + 1] = boneQuat[b * 4 + 1]!;
    cachedQT[off7 + 2] = boneQuat[b * 4 + 2]!;
    cachedQT[off7 + 3] = boneQuat[b * 4 + 3]!;
    cachedQT[off7 + 4] = boneTrans[b * 3]!;
    cachedQT[off7 + 5] = boneTrans[b * 3 + 1]!;
    cachedQT[off7 + 6] = boneTrans[b * 3 + 2]!;
  }
  state.lastDeformedMetaKey = deformMetaKey;
  state.hasCachedDeformation = true;

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const diagResult: SkinDeformationDiagnostics = {
    coupled: state.lastCoupledDiagnostics,
    leftForearmTwistRad,
    rightForearmTwistRad,
    leftElbowFlexionRad,
    rightElbowFlexionRad,
    leftKneeFlexionRad,
    rightKneeFlexionRad,
    leftHipFlexionRad,
    rightHipFlexionRad,
    maxCreaseCorrectionM,
    maxMuscleBulgeM,
    maxCapsulePushoutM,
    elapsedMs: t1 - t0,
    skippedRedundant: false,
  };
  state.lastDeformationDiagnostics = diagResult;
  return diagResult;
}

function buildAppliedPoseMetaKey(
  effectiveBodyType: string | undefined,
  options: SkinDeformerOptions | undefined,
  proportionRevision: number,
  weldCount: number,
): string {
  const limitMode = options?.limitMode ?? 'anatomical';
  const enableCoupled = options?.enableCoupledJoints ?? true;
  const enableTwist = options?.enableTwistDistribution ?? true;
  const enableDqs = options?.enableHybridDqs ?? true;
  const enableDeltaMush = options?.enableDeltaMush ?? true;
  const enableContact = options?.enableContactAndBulge ?? effectiveBodyType !== 'chibi';
  const dmIters = resolveDeltaMushIterations(weldCount, options?.deltaMushIterations);
  return `${effectiveBodyType ?? ''}|${limitMode}|${enableCoupled ? 1 : 0}|${enableTwist ? 1 : 0}|${enableDqs ? 1 : 0}|${enableDeltaMush ? 1 : 0}|${enableContact ? 1 : 0}|${dmIters}|${proportionRevision}`;
}

function isAppliedPoseUnchanged(
  figure: Figure,
  pose: Pose,
  state: FigureSkinState,
  metaKey: string,
  effectiveBodyType: string | undefined,
): boolean {
  if (!state.hasCachedAppliedPose || state.lastAppliedMetaKey !== metaKey || !state.lastDeformationDiagnostics) {
    return false;
  }
  const expectedPassThrough = effectiveBodyType !== 'chibi';
  if (state.activePassThrough !== expectedPassThrough) {
    return false;
  }
  const lastPose = state.lastAppliedPose48;
  const lastQuats = state.lastAppliedJointQuats64;
  for (let i = 0; i < JOINTS.length; i++) {
    const j = JOINTS[i]!;
    const raw = pose[j] ?? [0, 0, 0];
    const p3 = i * 3;
    if (
      Math.abs(sanitizeAngle(raw[0]) - lastPose[p3]!) > POSE_DIRTY_EPSILON ||
      Math.abs(sanitizeAngle(raw[1]) - lastPose[p3 + 1]!) > POSE_DIRTY_EPSILON ||
      Math.abs(sanitizeAngle(raw[2]) - lastPose[p3 + 2]!) > POSE_DIRTY_EPSILON
    ) {
      return false;
    }
    const q = figure.bones[j].quaternion;
    const q4 = i * 4;
    if (
      Math.abs(q.x - lastQuats[q4]!) > POSE_DIRTY_EPSILON ||
      Math.abs(q.y - lastQuats[q4 + 1]!) > POSE_DIRTY_EPSILON ||
      Math.abs(q.z - lastQuats[q4 + 2]!) > POSE_DIRTY_EPSILON ||
      Math.abs(q.w - lastQuats[q4 + 3]!) > POSE_DIRTY_EPSILON
    ) {
      return false;
    }
  }
  return true;
}

function recordAppliedPoseSignature(
  figure: Figure,
  pose: Pose,
  state: FigureSkinState,
  metaKey: string,
): void {
  const lastPose = state.lastAppliedPose48;
  const lastQuats = state.lastAppliedJointQuats64;
  for (let i = 0; i < JOINTS.length; i++) {
    const j = JOINTS[i]!;
    const raw = pose[j] ?? [0, 0, 0];
    const p3 = i * 3;
    lastPose[p3] = sanitizeAngle(raw[0]);
    lastPose[p3 + 1] = sanitizeAngle(raw[1]);
    lastPose[p3 + 2] = sanitizeAngle(raw[2]);
    const q = figure.bones[j].quaternion;
    const q4 = i * 4;
    lastQuats[q4] = q.x;
    lastQuats[q4 + 1] = q.y;
    lastQuats[q4 + 2] = q.z;
    lastQuats[q4 + 3] = q.w;
  }
  state.lastAppliedMetaKey = metaKey;
  state.hasCachedAppliedPose = true;
}

/**
 * Full 3-Layer Extreme-Pose Skin, Muscle Volume & Anti-Clipping pipeline:
 * 1. `solveCoupledRigPose` (anatomical ROM clamp + scapulohumeral rhythm + 3-vertebra spine split + MTP toe hinge)
 * 2. `evaluateSkinDeformation` (continuous axial twist + antipodal-safe Hybrid DQS + selective welded Delta Mush +
 *    crease-bisector contact & Poisson lateral squish + agonist muscle bulges + body-type capsule anti-clipping)
 */
export function applyExtremePoseDeformer(
  figure: Figure,
  pose: Pose,
  options?: SkinDeformerOptions,
): SkinDeformationDiagnostics {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { root } = figure;
  const effectiveBodyType =
    options?.bodyType ??
    figure.deformation?.bodyType ??
    (isBodyTypeId(figure.root.userData?.bodyType) ? figure.root.userData.bodyType : undefined);

  // O(1) (< 0.005ms) dirty-pose short-circuit when pose, bodyType/proportion revision, and joint quaternions match!
  const existingState = figureSkinStates.get(root);
  if (existingState && !options?.onAfterPoseSolve) {
    const rev = (root.userData.__bodyProportionRevision as number) || 0;
    const bodyTypeMatches =
      !options?.bodyType || !isBodyTypeId(options.bodyType) || root.userData.bodyType === options.bodyType;
    if (bodyTypeMatches && rev === existingState.lastProportionRevision) {
      const metaKey = buildAppliedPoseMetaKey(
        effectiveBodyType,
        options,
        rev,
        existingState.topology.weldCount,
      );
      if (isAppliedPoseUnchanged(figure, pose, existingState, metaKey, effectiveBodyType)) {
        const tFast = typeof performance !== 'undefined' ? performance.now() : Date.now();
        return {
          ...existingState.lastDeformationDiagnostics!,
          coupled: existingState.lastCoupledDiagnostics,
          elapsedMs: tFast - t0,
          skippedRedundant: true,
        };
      }
    }
  }

  const needsRootNormalize =
    root.position.x !== 0 ||
    root.position.y !== 0 ||
    root.position.z !== 0 ||
    root.quaternion.x !== 0 ||
    root.quaternion.y !== 0 ||
    root.quaternion.z !== 0 ||
    root.quaternion.w !== 1 ||
    root.scale.x !== 1 ||
    root.scale.y !== 1 ||
    root.scale.z !== 1;
  if (needsRootNormalize) {
    _savedRootPos.copy(root.position);
    _savedRootQuat.copy(root.quaternion);
    _savedRootScale.copy(root.scale);
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
  }
  let coupled: CoupledRigDiagnostics;
  let res: SkinDeformationDiagnostics;
  try {
    if (effectiveBodyType === 'chibi') {
      // Anime Chibi (2.5-head compact torso) uses Layer 1 coupled biomechanical joints + clean GPU LBS skinning
      // (avoiding adult-proportioned CPU DQS/Delta-Mush foldovers on deep kneeling bends while maintaining 0 eye error at ~0 ms)
      const state = ensureFigureSkinState(figure, { ...options, bodyType: 'chibi' });
      restoreBindAttributesIfPassThrough(state);
      coupled = solveCoupledRigPose(figure, pose, { ...options, bodyType: 'chibi' });
      options?.onAfterPoseSolve?.();
      figure.root.updateMatrixWorld(true);
      figure.skins.forEach(skin => {
        skin.skeleton.update();
        skin.computeBoundingBox();
        skin.computeBoundingSphere();
      });
      res = {
        coupled,
        leftForearmTwistRad: 0,
        rightForearmTwistRad: 0,
        leftElbowFlexionRad: 0,
        rightElbowFlexionRad: 0,
        leftKneeFlexionRad: 0,
        rightKneeFlexionRad: 0,
        leftHipFlexionRad: 0,
        rightHipFlexionRad: 0,
        maxCreaseCorrectionM: 0,
        maxMuscleBulgeM: 0,
        maxCapsulePushoutM: 0,
        elapsedMs: 0,
        skippedRedundant: false,
      };
      state.lastDeformationDiagnostics = res;
    } else {
      coupled = solveCoupledRigPose(figure, pose, options);
      if (options?.onAfterPoseSolve) {
        options.onAfterPoseSolve();
        figure.root.updateMatrixWorld(true);
      }
      res = evaluateSkinDeformation(figure, options);
    }
  } finally {
    if (needsRootNormalize) {
      root.position.copy(_savedRootPos);
      root.quaternion.copy(_savedRootQuat);
      root.scale.copy(_savedRootScale);
      root.updateMatrixWorld(true);
      const curState = figureSkinStates.get(root);
      for (let i = 0; i < figure.skins.length; i++) {
        const skin = figure.skins[i]!;
        skin.skeleton.update();
        // mainSkin's exact tight local boundingBox & boundingSphere were already computed in evaluateSkinDeformation!
        if (!curState?.activePassThrough || skin !== curState.mainSkin) {
          skin.computeBoundingBox();
          skin.computeBoundingSphere();
        }
      }
    }
  }

  const finalState = figureSkinStates.get(root);
  if (finalState && !options?.onAfterPoseSolve) {
    const rev = (root.userData.__bodyProportionRevision as number) || 0;
    const metaKey = buildAppliedPoseMetaKey(effectiveBodyType, options, rev, finalState.topology.weldCount);
    recordAppliedPoseSignature(figure, pose, finalState, metaKey);
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  res.coupled = coupled;
  res.elapsedMs = t1 - t0;
  return res;
}

export const poseAndDeformFigure = applyExtremePoseDeformer;

/**
 * Stateful convenience wrapper around `applyExtremePoseDeformer` / `disableSkinDeformer`
 * for explicit OOP deformer lifecycle & cache management.
 */
export class SkinDeformer {
  readonly figure: Figure;
  private readonly defaultOptions?: SkinDeformerOptions;

  constructor(figure: Figure, defaultOptions?: SkinDeformerOptions) {
    this.figure = figure;
    this.defaultOptions = defaultOptions;
  }

  applyPose(pose: Pose, options?: SkinDeformerOptions): SkinDeformationDiagnostics {
    const merged = options
      ? this.defaultOptions
        ? { ...this.defaultOptions, ...options }
        : options
      : this.defaultOptions;
    return applyExtremePoseDeformer(this.figure, pose, merged);
  }

  deform(pose: Pose, options?: SkinDeformerOptions): SkinDeformationDiagnostics {
    return this.applyPose(pose, options);
  }

  apply(pose: Pose, options?: SkinDeformerOptions): SkinDeformationDiagnostics {
    return this.applyPose(pose, options);
  }

  invalidate(): void {
    const state = figureSkinStates.get(this.figure.root);
    if (state) {
      state.hasCachedAppliedPose = false;
      state.hasCachedDeformation = false;
    }
  }

  dispose(): void {
    disableSkinDeformer(this.figure);
  }
}

/**
 * Disables CPU pass-through deformation on `figure` and restores `mainSkin` to standard morphed bind-pose
 * attributes + `boneInverses` + neutral helper bone rotations.
 */
export function disableSkinDeformer(figure: Figure): void {
  const state = figureSkinStates.get(figure.root);
  if (!state) return;
  restoreBindAttributesIfPassThrough(state);
  if (state.clavicleL) state.clavicleL.quaternion.copy(state.clavicleLRestLocal);
  if (state.clavicleR) state.clavicleR.quaternion.copy(state.clavicleRRestLocal);
  if (state.spine02) state.spine02.quaternion.copy(state.spine02RestLocal);
  if (state.ballL) state.ballL.quaternion.copy(state.ballLRestLocal);
  if (state.ballR) state.ballR.quaternion.copy(state.ballRRestLocal);
  figure.root.updateMatrixWorld(true);
  state.mainSkin.skeleton.update();
  state.mainSkin.computeBoundingBox();
  state.mainSkin.computeBoundingSphere();
}
