import * as T from 'three';

export const BODY_TYPE_IDS = [
  'realistic',
  'heroic',
  'lean',
  'slender',
  'busty',
  'chubby',
  'fat',
  'obese',
  'chibi',
] as const;

export type BodyTypeId = (typeof BODY_TYPE_IDS)[number];

export interface BodyTypeMeta {
  readonly id: BodyTypeId;
  readonly label: string;
  readonly description: string;
  readonly proportionHint: string;
}

export const BODY_TYPES: readonly BodyTypeMeta[] = [
  {
    id: 'realistic',
    label: 'Realistic',
    description: 'Balanced 7.5-head natural human proportions with moderated shoulder taper.',
    proportionHint: '7.5 heads',
  },
  {
    id: 'heroic',
    label: 'Heroic',
    description: 'Classic athletic comic/superhero silhouette with broad shoulders and tapered waist.',
    proportionHint: '8.0 heads',
  },
  {
    id: 'lean',
    label: 'Lean',
    description: 'Agile swimmer/runner build with low body mass, trim waist, and defined limbs.',
    proportionHint: '7.8 heads',
  },
  {
    id: 'slender',
    label: 'Slender',
    description: 'Tall, narrow-framed silhouette with elongated limbs and slim torso.',
    proportionHint: '8.2 heads',
  },
  {
    id: 'busty',
    label: 'Busty',
    description: 'Fuller anterior chest/bust projection with supportive ribcage and curvy waist-hip contour.',
    proportionHint: '7.6 heads',
  },
  {
    id: 'chubby',
    label: 'Chubby',
    description: 'Soft, rounded build with fuller cheeks, belly, waist, hips, thighs, and upper arms.',
    proportionHint: '7.4 heads',
  },
  {
    id: 'fat',
    label: 'Fat',
    description: 'Heavyset build with pronounced abdominal dome, wide waist/hips, and thick limbs.',
    proportionHint: '7.3 heads',
  },
  {
    id: 'obese',
    label: 'Obese',
    description: 'High-mass silhouette with prominent torso/belly volume and broad hips and thighs.',
    proportionHint: '7.2 heads',
  },
  {
    id: 'chibi',
    label: 'Chibi',
    description: 'Stylized ~3-head chibi proportion with enlarged head/eyes and compact limbs.',
    proportionHint: '3.0 heads',
  },
] as const;

export const BODY_TYPE_LABELS: Record<BodyTypeId, string> = Object.fromEntries(
  BODY_TYPES.map(entry => [entry.id, entry.label]),
) as Record<BodyTypeId, string>;

export const BODY_TYPE_DESCRIPTIONS: Record<BodyTypeId, string> = Object.fromEntries(
  BODY_TYPES.map(entry => [entry.id, entry.description]),
) as Record<BodyTypeId, string>;

export const DEFAULT_BODY_TYPE: BodyTypeId = 'heroic';

export function isBodyTypeId(v: unknown): v is BodyTypeId {
  return typeof v === 'string' && (BODY_TYPE_IDS as readonly string[]).includes(v);
}

export function getBodyTypeMeta(bodyType: BodyTypeId): BodyTypeMeta {
  return BODY_TYPES.find(entry => entry.id === bodyType) ?? BODY_TYPES[1]!;
}

interface GenderedParams {
  headScale: number;
  torsoLengthScale: number;
  neckLengthScale: number;
  thighLengthScale: number;
  calfLengthScale: number;
  upperArmLengthScale: number;
  forearmLengthScale: number;
  shoulderDeltaX: number;
  hipStanceScale: number;
  handScale: number;
  footScale: number;

  // Torso width/depth modulation (additive fractions relative to baseline half-extents)
  chestWidth: number;
  chestBackDepth: number;
  chestFrontBase: number;
  bustProjection: number;
  bustLateral: number;
  bustDrop: number;

  waistWidth: number;
  waistFrontDepth: number;
  waistBackDepth: number;

  bellyProjection: number;
  bellyWidth: number;
  bellyDrop: number;

  hipWidth: number;
  gluteProjection: number;

  // Limb radial girth (additive scale deltas: 0 = baseline, -0.18 = 18% slimmer, +0.35 = 35% thicker)
  thighGirth: number;
  calfGirth: number;
  upperArmGirth: number;
  tricepHang: number;
  forearmGirth: number;
  extremityPlump: number;

  // Neck & lower-face fullness
  neckGirth: number;
  cheekFullness: number;
  submentalFullness: number;
}

function resolveParams(gender: 'male' | 'female', bodyType: BodyTypeId): GenderedParams {
  const isFemale = gender === 'female';
  switch (bodyType) {
    case 'heroic':
      return {
        headScale: 1,
        torsoLengthScale: 1,
        neckLengthScale: 1,
        thighLengthScale: 1,
        calfLengthScale: 1,
        upperArmLengthScale: 1,
        forearmLengthScale: 1,
        shoulderDeltaX: 0,
        hipStanceScale: 1,
        handScale: 1,
        footScale: 1,
        chestWidth: 0,
        chestBackDepth: 0,
        chestFrontBase: 0,
        bustProjection: 0,
        bustLateral: 0,
        bustDrop: 0,
        waistWidth: 0,
        waistFrontDepth: 0,
        waistBackDepth: 0,
        bellyProjection: 0,
        bellyWidth: 0,
        bellyDrop: 0,
        hipWidth: 0,
        gluteProjection: 0,
        thighGirth: 0,
        calfGirth: 0,
        upperArmGirth: 0,
        tricepHang: 0,
        forearmGirth: 0,
        extremityPlump: 0,
        neckGirth: 0,
        cheekFullness: 0,
        submentalFullness: 0,
      };

    case 'realistic':
      return {
        headScale: isFemale ? 1.045 : 1.055,
        torsoLengthScale: 0.99,
        neckLengthScale: 0.98,
        thighLengthScale: 0.97,
        calfLengthScale: 0.97,
        upperArmLengthScale: 0.98,
        forearmLengthScale: 0.98,
        shoulderDeltaX: isFemale ? -0.002 : -0.012,
        hipStanceScale: 1.0,
        handScale: 0.98,
        footScale: 0.99,
        chestWidth: isFemale ? -0.02 : -0.10,
        chestBackDepth: isFemale ? -0.02 : -0.08,
        chestFrontBase: isFemale ? -0.02 : -0.07,
        bustProjection: isFemale ? -0.006 : -0.008,
        bustLateral: 0,
        bustDrop: 0,
        waistWidth: isFemale ? 0.075 : 0.02,
        waistFrontDepth: isFemale ? 0.05 : 0.02,
        waistBackDepth: 0.02,
        bellyProjection: 0.006,
        bellyWidth: isFemale ? 0.04 : 0.02,
        bellyDrop: 0,
        hipWidth: isFemale ? -0.02 : 0.01,
        gluteProjection: isFemale ? -0.005 : -0.003,
        thighGirth: isFemale ? -0.03 : -0.05,
        calfGirth: -0.04,
        upperArmGirth: isFemale ? -0.02 : -0.11,
        tricepHang: 0,
        forearmGirth: isFemale ? -0.02 : -0.08,
        extremityPlump: 0,
        neckGirth: isFemale ? 0.01 : -0.06,
        cheekFullness: 0.0015,
        submentalFullness: 0,
      };

    case 'lean':
      return {
        headScale: 1.02,
        torsoLengthScale: 1.0,
        neckLengthScale: 1.02,
        thighLengthScale: 1.01,
        calfLengthScale: 1.01,
        upperArmLengthScale: 1.0,
        forearmLengthScale: 1.0,
        shoulderDeltaX: isFemale ? -0.006 : -0.014,
        hipStanceScale: 0.98,
        handScale: 0.98,
        footScale: 0.99,
        chestWidth: isFemale ? -0.06 : -0.08,
        chestBackDepth: -0.08,
        chestFrontBase: -0.07,
        bustProjection: isFemale ? -0.014 : -0.010,
        bustLateral: -0.003,
        bustDrop: 0,
        waistWidth: isFemale ? -0.04 : -0.08,
        waistFrontDepth: -0.09,
        waistBackDepth: -0.06,
        bellyProjection: -0.010,
        bellyWidth: -0.06,
        bellyDrop: 0,
        hipWidth: -0.065,
        gluteProjection: -0.012,
        thighGirth: -0.10,
        calfGirth: -0.08,
        upperArmGirth: isFemale ? -0.09 : -0.14,
        tricepHang: 0,
        forearmGirth: -0.09,
        extremityPlump: 0,
        neckGirth: -0.06,
        cheekFullness: -0.002,
        submentalFullness: -0.002,
      };

    case 'slender':
      return {
        headScale: 0.975,
        torsoLengthScale: 1.035,
        neckLengthScale: 1.07,
        thighLengthScale: 1.06,
        calfLengthScale: 1.065,
        upperArmLengthScale: 1.045,
        forearmLengthScale: 1.05,
        shoulderDeltaX: isFemale ? -0.014 : -0.030,
        hipStanceScale: 0.95,
        handScale: 0.95,
        footScale: 0.97,
        chestWidth: isFemale ? -0.12 : -0.16,
        chestBackDepth: -0.14,
        chestFrontBase: -0.12,
        bustProjection: isFemale ? -0.022 : -0.016,
        bustLateral: -0.006,
        bustDrop: 0,
        waistWidth: isFemale ? -0.12 : -0.16,
        waistFrontDepth: -0.15,
        waistBackDepth: -0.11,
        bellyProjection: -0.016,
        bellyWidth: -0.12,
        bellyDrop: 0,
        hipWidth: -0.13,
        gluteProjection: -0.020,
        thighGirth: -0.18,
        calfGirth: -0.15,
        upperArmGirth: isFemale ? -0.17 : -0.22,
        tricepHang: 0,
        forearmGirth: -0.16,
        extremityPlump: -0.04,
        neckGirth: -0.12,
        cheekFullness: -0.0035,
        submentalFullness: -0.003,
      };

    case 'busty':
      return {
        headScale: isFemale ? 1.02 : 1.02,
        torsoLengthScale: 1.0,
        neckLengthScale: 1.0,
        thighLengthScale: 1.0,
        calfLengthScale: 1.0,
        upperArmLengthScale: 1.0,
        forearmLengthScale: 1.0,
        shoulderDeltaX: isFemale ? 0.003 : 0.004,
        hipStanceScale: 1.01,
        handScale: 1.0,
        footScale: 1.0,
        chestWidth: isFemale ? 0.05 : 0.06,
        chestBackDepth: 0.03,
        chestFrontBase: isFemale ? 0.08 : 0.10,
        bustProjection: isFemale ? 0.052 : 0.038,
        bustLateral: isFemale ? 0.018 : 0.012,
        bustDrop: isFemale ? 0.012 : 0.004,
        waistWidth: isFemale ? -0.02 : -0.03,
        waistFrontDepth: -0.02,
        waistBackDepth: 0.01,
        bellyProjection: 0,
        bellyWidth: 0,
        bellyDrop: 0,
        hipWidth: isFemale ? 0.055 : 0.01,
        gluteProjection: isFemale ? 0.016 : 0.006,
        thighGirth: isFemale ? 0.05 : 0.02,
        calfGirth: 0.02,
        upperArmGirth: 0.02,
        tricepHang: 0,
        forearmGirth: 0,
        extremityPlump: 0,
        neckGirth: 0,
        cheekFullness: 0,
        submentalFullness: 0,
      };

    case 'chubby':
      return {
        headScale: 1.035,
        torsoLengthScale: 0.99,
        neckLengthScale: 0.95,
        thighLengthScale: 0.975,
        calfLengthScale: 0.975,
        upperArmLengthScale: 0.985,
        forearmLengthScale: 0.985,
        shoulderDeltaX: isFemale ? 0.036 : 0.028,
        hipStanceScale: 1.05,
        handScale: 1.01,
        footScale: 1.01,
        chestWidth: isFemale ? 0.12 : 0.06,
        chestBackDepth: 0.12,
        chestFrontBase: 0.14,
        bustProjection: isFemale ? 0.024 : 0.018,
        bustLateral: 0.010,
        bustDrop: 0.008,
        waistWidth: isFemale ? 0.25 : 0.16,
        waistFrontDepth: 0.22,
        waistBackDepth: 0.14,
        bellyProjection: 0.045,
        bellyWidth: 0.08,
        bellyDrop: 0.010,
        hipWidth: isFemale ? 0.13 : 0.12,
        gluteProjection: 0.028,
        thighGirth: 0.18,
        calfGirth: 0.12,
        upperArmGirth: isFemale ? 0.20 : 0.15,
        tricepHang: 0.008,
        forearmGirth: 0.10,
        extremityPlump: 0.04,
        neckGirth: 0.12,
        cheekFullness: 0.0065,
        submentalFullness: 0.007,
      };

    case 'fat':
      return {
        headScale: 1.04,
        torsoLengthScale: 0.985,
        neckLengthScale: 0.91,
        thighLengthScale: 0.965,
        calfLengthScale: 0.965,
        upperArmLengthScale: 0.98,
        forearmLengthScale: 0.98,
        shoulderDeltaX: isFemale ? 0.064 : 0.050,
        hipStanceScale: 1.10,
        handScale: 1.02,
        footScale: 1.02,
        chestWidth: isFemale ? 0.22 : 0.13,
        chestBackDepth: 0.22,
        chestFrontBase: 0.25,
        bustProjection: isFemale ? 0.038 : 0.032,
        bustLateral: 0.018,
        bustDrop: 0.016,
        waistWidth: isFemale ? 0.42 : 0.29,
        waistFrontDepth: 0.38,
        waistBackDepth: 0.24,
        bellyProjection: 0.090,
        bellyWidth: 0.14,
        bellyDrop: 0.022,
        hipWidth: isFemale ? 0.24 : 0.22,
        gluteProjection: 0.050,
        thighGirth: 0.33,
        calfGirth: 0.21,
        upperArmGirth: isFemale ? 0.36 : 0.27,
        tricepHang: 0.015,
        forearmGirth: 0.18,
        extremityPlump: 0.07,
        neckGirth: 0.22,
        cheekFullness: 0.011,
        submentalFullness: 0.013,
      };

    case 'obese':
      return {
        headScale: 1.045,
        torsoLengthScale: 0.98,
        neckLengthScale: 0.87,
        thighLengthScale: 0.955,
        calfLengthScale: 0.955,
        upperArmLengthScale: 0.975,
        forearmLengthScale: 0.975,
        shoulderDeltaX: isFemale ? 0.095 : 0.074,
        hipStanceScale: 1.16,
        handScale: 1.03,
        footScale: 1.03,
        chestWidth: isFemale ? 0.30 : 0.21,
        chestBackDepth: 0.34,
        chestFrontBase: 0.38,
        bustProjection: isFemale ? 0.054 : 0.048,
        bustLateral: 0.026,
        bustDrop: 0.026,
        waistWidth: isFemale ? 0.58 : 0.42,
        waistFrontDepth: 0.56,
        waistBackDepth: 0.36,
        bellyProjection: 0.145,
        bellyWidth: 0.20,
        bellyDrop: 0.038,
        hipWidth: isFemale ? 0.35 : 0.33,
        gluteProjection: 0.076,
        thighGirth: 0.48,
        calfGirth: 0.30,
        upperArmGirth: isFemale ? 0.52 : 0.39,
        tricepHang: 0.024,
        forearmGirth: 0.25,
        extremityPlump: 0.10,
        neckGirth: 0.32,
        cheekFullness: 0.0155,
        submentalFullness: 0.020,
      };

    case 'chibi':
      return {
        headScale: 1.78,
        torsoLengthScale: 0.50,
        neckLengthScale: 0.58,
        thighLengthScale: 0.44,
        calfLengthScale: 0.44,
        upperArmLengthScale: 0.48,
        forearmLengthScale: 0.48,
        shoulderDeltaX: isFemale ? 0.020 : -0.008,
        hipStanceScale: 0.86,
        handScale: 1.16,
        footScale: 0.90,
        chestWidth: isFemale ? -0.06 : -0.22,
        chestBackDepth: -0.08,
        chestFrontBase: isFemale ? -0.08 : -0.14,
        bustProjection: isFemale ? -0.018 : -0.014,
        bustLateral: -0.004,
        bustDrop: 0,
        waistWidth: isFemale ? 0.06 : -0.04,
        waistFrontDepth: 0.06,
        waistBackDepth: 0.02,
        bellyProjection: 0.014,
        bellyWidth: 0.06,
        bellyDrop: 0.002,
        hipWidth: isFemale ? -0.08 : -0.08,
        gluteProjection: 0.004,
        thighGirth: -0.04,
        calfGirth: 0.04,
        upperArmGirth: isFemale ? 0.04 : -0.10,
        tricepHang: 0,
        forearmGirth: 0.05,
        extremityPlump: 0.09,
        neckGirth: -0.08,
        cheekFullness: 0.0055,
        submentalFullness: 0.002,
      };
  }
}

interface SkinBaseline {
  skin: T.SkinnedMesh;
  isMainBody: boolean;
  basePositions: Float32Array;
  baseNormals: Float32Array;
  posWeldCanon: Int32Array;
  normWeldCanon: Int32Array;
  normWeldGroupCount: number;
  baseMinY: number;
}

interface ProportionBaseline {
  skins: SkinBaseline[];
  mainSkin: SkinBaseline;
  bones: T.Bone[];
  boneIndexByName: Map<string, number>;
  parentBoneIdx: Int32Array;
  baseLocalPos: T.Vector3[];
  baseLocalScale: T.Vector3[];
  baseBoneInverses: T.Matrix4[];
  baseBindPos: T.Vector3[];
  baseBindQuat: T.Quaternion[];
  baseLocalBindQuat: T.Quaternion[];
  boneGroupTag: Uint8Array;
}

const BASELINE_KEY = '__bodyProportionBaseline';

const TAG_OTHER = 0;
const TAG_PELVIS = 1;
const TAG_SPINE1 = 2;
const TAG_SPINE2 = 3;
const TAG_SPINE3 = 4;
const TAG_NECK = 5;
const TAG_HEAD = 6;
const TAG_CLAVICLE_L = 7;
const TAG_CLAVICLE_R = 8;
const TAG_UPPERARM_L = 9;
const TAG_UPPERARM_R = 10;
const TAG_LOWERARM_L = 11;
const TAG_LOWERARM_R = 12;
const TAG_HAND_L = 13;
const TAG_HAND_R = 14;
const TAG_THIGH_L = 15;
const TAG_THIGH_R = 16;
const TAG_CALF_L = 17;
const TAG_CALF_R = 18;
const TAG_FOOT_L = 19;
const TAG_FOOT_R = 20;

function classifyBoneTag(name: string): number {
  switch (name) {
    case 'pelvis': return TAG_PELVIS;
    case 'spine_01': return TAG_SPINE1;
    case 'spine_02': return TAG_SPINE2;
    case 'spine_03': return TAG_SPINE3;
    case 'neck_01': return TAG_NECK;
    case 'Head': return TAG_HEAD;
    case 'clavicle_l': return TAG_CLAVICLE_L;
    case 'clavicle_r': return TAG_CLAVICLE_R;
    case 'upperarm_l': return TAG_UPPERARM_L;
    case 'upperarm_r': return TAG_UPPERARM_R;
    case 'lowerarm_l': return TAG_LOWERARM_L;
    case 'lowerarm_r': return TAG_LOWERARM_R;
    case 'hand_l': return TAG_HAND_L;
    case 'hand_r': return TAG_HAND_R;
    case 'thigh_l': return TAG_THIGH_L;
    case 'thigh_r': return TAG_THIGH_R;
    case 'calf_l': return TAG_CALF_L;
    case 'calf_r': return TAG_CALF_R;
    case 'foot_l':
    case 'ball_l':
    case 'ball_leaf_l':
      return TAG_FOOT_L;
    case 'foot_r':
    case 'ball_r':
    case 'ball_leaf_r':
      return TAG_FOOT_R;
    default:
      if (/^(thumb|index|middle|ring|pinky)_.*_l$/.test(name)) return TAG_HAND_L;
      if (/^(thumb|index|middle|ring|pinky)_.*_r$/.test(name)) return TAG_HAND_R;
      return TAG_OTHER;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gauss(x: number, center: number, sigma: number): number {
  const u = (x - center) / sigma;
  return Math.exp(-0.5 * u * u);
}

function asymGauss(x: number, center: number, sigmaBelow: number, sigmaAbove: number): number {
  const sigma = x < center ? sigmaBelow : sigmaAbove;
  const u = (x - center) / sigma;
  return Math.exp(-0.5 * u * u);
}

function buildSkinBaseline(skin: T.SkinnedMesh, isMainBody: boolean): SkinBaseline {
  const posAttr = skin.geometry.getAttribute('position') as T.BufferAttribute;
  let normAttr = skin.geometry.getAttribute('normal') as T.BufferAttribute | undefined;
  if (!normAttr) {
    skin.geometry.computeVertexNormals();
    normAttr = skin.geometry.getAttribute('normal') as T.BufferAttribute;
  }
  const count = posAttr.count;
  const basePositions = new Float32Array(posAttr.array.slice(0, count * 3));
  const baseNormals = new Float32Array(normAttr.array.slice(0, count * 3));

  const posWeldCanon = new Int32Array(count);
  const normWeldCanon = new Int32Array(count);
  const posMap = new Map<string, number>();
  const normMap = new Map<string, number>();
  let normGroupCounter = 0;
  let baseMinY = Infinity;

  for (let i = 0; i < count; i++) {
    const px = basePositions[i * 3]!;
    const py = basePositions[i * 3 + 1]!;
    const pz = basePositions[i * 3 + 2]!;
    if (py < baseMinY) baseMinY = py;

    const pKey = `${Math.round(px * 1e6)},${Math.round(py * 1e6)},${Math.round(pz * 1e6)}`;
    let pCanon = posMap.get(pKey);
    if (pCanon === undefined) {
      pCanon = i;
      posMap.set(pKey, i);
    }
    posWeldCanon[i] = pCanon;

    const nx = baseNormals[i * 3]!;
    const ny = baseNormals[i * 3 + 1]!;
    const nz = baseNormals[i * 3 + 2]!;
    const nKey = `${pKey}|${Math.round(nx * 2e3)},${Math.round(ny * 2e3)},${Math.round(nz * 2e3)}`;
    let nGroup = normMap.get(nKey);
    if (nGroup === undefined) {
      nGroup = normGroupCounter++;
      normMap.set(nKey, nGroup);
    }
    normWeldCanon[i] = nGroup;
  }

  return {
    skin,
    isMainBody,
    basePositions,
    baseNormals,
    posWeldCanon,
    normWeldCanon,
    normWeldGroupCount: normGroupCounter,
    baseMinY,
  };
}

function captureBaseline(figureRoot: T.Object3D): ProportionBaseline {
  const existing = figureRoot.userData[BASELINE_KEY] as ProportionBaseline | undefined;
  if (existing) return existing;

  const skinnedMeshes: T.SkinnedMesh[] = [];
  figureRoot.traverse(node => {
    if (node instanceof T.SkinnedMesh) skinnedMeshes.push(node);
  });
  if (!skinnedMeshes.length) {
    throw new Error('applyBodyProportion requires a figure root containing at least one SkinnedMesh.');
  }

  // Three.js SkeletonUtils.clone shares the template's boneInverses Matrix4 instances across clones!
  // Clone them per-SkinnedMesh up front so deforming one figure never mutates templates or other figures.
  for (const mesh of skinnedMeshes) {
    mesh.skeleton.boneInverses = mesh.skeleton.boneInverses.map(m => m.clone());
  }

  const mainMesh = skinnedMeshes.reduce((a, b) =>
    a.geometry.getAttribute('position').count >= b.geometry.getAttribute('position').count ? a : b,
  );
  const skins = skinnedMeshes.map(mesh => buildSkinBaseline(mesh, mesh === mainMesh));
  const mainSkin = skins.find(s => s.isMainBody)!;

  const bones = mainMesh.skeleton.bones;
  const boneCount = bones.length;
  const boneIndexByName = new Map<string, number>();
  bones.forEach((b, idx) => boneIndexByName.set(b.name, idx));

  const parentBoneIdx = new Int32Array(boneCount);
  const baseLocalPos: T.Vector3[] = [];
  const baseLocalScale: T.Vector3[] = [];
  const baseBoneInverses: T.Matrix4[] = [];
  const baseBindPos: T.Vector3[] = [];
  const baseBindQuat: T.Quaternion[] = [];
  const baseLocalBindQuat: T.Quaternion[] = [];
  const boneGroupTag = new Uint8Array(boneCount);

  for (let i = 0; i < boneCount; i++) {
    const b = bones[i]!;
    parentBoneIdx[i] = b.parent instanceof T.Bone ? bones.indexOf(b.parent) : -1;
    baseLocalPos.push(b.position.clone());
    baseLocalScale.push(b.scale.clone());
    const inv = mainMesh.skeleton.boneInverses[i]!.clone();
    baseBoneInverses.push(inv);

    const bindMat = inv.clone().invert();
    const pos = new T.Vector3();
    const quat = new T.Quaternion();
    const scl = new T.Vector3();
    bindMat.decompose(pos, quat, scl);
    baseBindPos.push(pos);
    baseBindQuat.push(quat);
    boneGroupTag[i] = classifyBoneTag(b.name);
  }

  for (let i = 0; i < boneCount; i++) {
    const pIdx = parentBoneIdx[i]!;
    if (pIdx >= 0) {
      baseLocalBindQuat.push(baseBindQuat[pIdx]!.clone().invert().multiply(baseBindQuat[i]!));
    } else {
      baseLocalBindQuat.push(baseBindQuat[i]!.clone());
    }
  }

  const baseline: ProportionBaseline = {
    skins,
    mainSkin,
    bones,
    boneIndexByName,
    parentBoneIdx,
    baseLocalPos,
    baseLocalScale,
    baseBoneInverses,
    baseBindPos,
    baseBindQuat,
    baseLocalBindQuat,
    boneGroupTag,
  };
  figureRoot.userData[BASELINE_KEY] = baseline;
  return baseline;
}

function recomputeWeldedNormals(
  geometry: T.BufferGeometry,
  positions: Float32Array,
  normWeldCanon: Int32Array,
  normWeldGroupCount: number,
  outNormals: Float32Array,
): void {
  const groupSums = new Float64Array(normWeldGroupCount * 3);
  const indexAttr = geometry.getIndex();
  const vertCount = positions.length / 3;

  const accumTri = (ia: number, ib: number, ic: number) => {
    const ax = positions[ia * 3]!, ay = positions[ia * 3 + 1]!, az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!, by = positions[ib * 3 + 1]!, bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!, cy = positions[ic * 3 + 1]!, cz = positions[ic * 3 + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;

    const ga = normWeldCanon[ia]! * 3;
    const gb = normWeldCanon[ib]! * 3;
    const gc = normWeldCanon[ic]! * 3;
    groupSums[ga]! += fnx; groupSums[ga + 1]! += fny; groupSums[ga + 2]! += fnz;
    groupSums[gb]! += fnx; groupSums[gb + 1]! += fny; groupSums[gb + 2]! += fnz;
    groupSums[gc]! += fnx; groupSums[gc + 1]! += fny; groupSums[gc + 2]! += fnz;
  };

  if (indexAttr) {
    const triCount = indexAttr.count;
    for (let i = 0; i + 2 < triCount; i += 3) {
      accumTri(indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2));
    }
  } else {
    for (let i = 0; i + 2 < vertCount; i += 3) {
      accumTri(i, i + 1, i + 2);
    }
  }

  for (let g = 0; g < normWeldGroupCount; g++) {
    const base = g * 3;
    const nx = groupSums[base]!, ny = groupSums[base + 1]!, nz = groupSums[base + 2]!;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      groupSums[base] = nx / len;
      groupSums[base + 1] = ny / len;
      groupSums[base + 2] = nz / len;
    } else {
      groupSums[base] = 0;
      groupSums[base + 1] = 1;
      groupSums[base + 2] = 0;
    }
  }

  for (let i = 0; i < vertCount; i++) {
    const g = normWeldCanon[i]! * 3;
    outNormals[i * 3] = groupSums[g]!;
    outNormals[i * 3 + 1] = groupSums[g + 1]!;
    outNormals[i * 3 + 2] = groupSums[g + 2]!;
  }
}

function updateAttachedHeadMeshes(headBone: T.Bone | undefined, headScale: number): void {
  if (!headBone) return;
  for (const child of headBone.children) {
    if (child instanceof T.Bone) continue;
    if (child.userData && child.userData.joint) continue;
    if (child instanceof T.Mesh || child instanceof T.Group) {
      child.scale.setScalar(headScale);
    }
  }
}

function segWarp(
  vx: number, vy: number, vz: number,
  p0: T.Vector3, c0: T.Vector3,
  p1: T.Vector3, c1: T.Vector3,
  out: T.Vector3,
): void {
  const d0x = c0.x - p0.x, d0y = c0.y - p0.y, d0z = c0.z - p0.z;
  const lenSq = d0x * d0x + d0y * d0y + d0z * d0z;
  if (lenSq < 1e-10) {
    out.set(p1.x + (vx - p0.x), p1.y + (vy - p0.y), p1.z + (vz - p0.z));
    return;
  }
  const s = ((vx - p0.x) * d0x + (vy - p0.y) * d0y + (vz - p0.z) * d0z) / lenSq;
  const d1x = c1.x - p1.x, d1y = c1.y - p1.y, d1z = c1.z - p1.z;
  out.set(
    p1.x + (vx - p0.x) + s * (d1x - d0x),
    p1.y + (vy - p0.y) + s * (d1y - d0y),
    p1.z + (vz - p0.z) + s * (d1z - d0z),
  );
}

function radialLimbDisplacement(
  wx: number, wy: number, wz: number,
  a: T.Vector3, b: T.Vector3,
  out: T.Vector3,
): { s: number; radLen: number } {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const len = Math.hypot(ux, uy, uz);
  if (len < 1e-6) {
    out.set(0, 0, 0);
    return { s: 0, radLen: 0 };
  }
  const invLen = 1 / len;
  const ax = ux * invLen, ay = uy * invLen, az = uz * invLen;
  const dx = wx - a.x, dy = wy - a.y, dz = wz - a.z;
  const proj = dx * ax + dy * ay + dz * az;
  const s = proj * invLen;
  const rx = dx - proj * ax;
  const ry = dy - proj * ay;
  const rz = dz - proj * az;
  out.set(rx, ry, rz);
  return { s, radLen: Math.hypot(rx, ry, rz) };
}

export function applyBodyProportion(
  figureRoot: T.Object3D,
  gender: 'male' | 'female',
  bodyType: BodyTypeId,
): { headScale: number } {
  if (!isBodyTypeId(bodyType)) {
    throw new Error(`Invalid bodyType "${String(bodyType)}".`);
  }
  const baseline = captureBaseline(figureRoot);
  const { bones, boneIndexByName, parentBoneIdx, baseLocalPos, baseBindPos, baseBindQuat, baseLocalBindQuat } = baseline;
  const headIdx = boneIndexByName.get('Head');
  const headBone = headIdx !== undefined ? bones[headIdx] : undefined;

  // Fast exact restoration for baseline 'heroic'
  if (bodyType === 'heroic') {
    for (let i = 0; i < bones.length; i++) {
      bones[i]!.position.copy(baseLocalPos[i]!);
      bones[i]!.scale.copy(baseline.baseLocalScale[i]!);
    }
    for (const sb of baseline.skins) {
      const posAttr = sb.skin.geometry.getAttribute('position') as T.BufferAttribute;
      const normAttr = sb.skin.geometry.getAttribute('normal') as T.BufferAttribute;
      (posAttr.array as Float32Array).set(sb.basePositions);
      (normAttr.array as Float32Array).set(sb.baseNormals);
      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      for (let i = 0; i < bones.length; i++) {
        sb.skin.skeleton.boneInverses[i]!.copy(baseline.baseBoneInverses[i]!);
      }
    }
    updateAttachedHeadMeshes(headBone, 1);
    figureRoot.userData.bodyType = 'heroic';
    figureRoot.userData.bodyProportionHeadScale = 1;
    figureRoot.userData.__bodyProportionRevision = ((figureRoot.userData.__bodyProportionRevision as number) || 0) + 1;
    figureRoot.updateMatrixWorld(true);
    for (const sb of baseline.skins) {
      sb.skin.skeleton.update();
      sb.skin.computeBoundingBox();
      sb.skin.computeBoundingSphere();
    }
    return { headScale: 1 };
  }

  const p = resolveParams(gender, bodyType);
  const isFemale = gender === 'female';

  const idxPelvis = boneIndexByName.get('pelvis')!;
  const idxSpine1 = boneIndexByName.get('spine_01')!;
  const idxSpine2 = boneIndexByName.get('spine_02')!;
  const idxSpine3 = boneIndexByName.get('spine_03')!;
  const idxNeck = boneIndexByName.get('neck_01')!;
  const idxHead = boneIndexByName.get('Head')!;
  const idxClavL = boneIndexByName.get('clavicle_l')!;
  const idxClavR = boneIndexByName.get('clavicle_r')!;
  const idxUpperArmL = boneIndexByName.get('upperarm_l')!;
  const idxUpperArmR = boneIndexByName.get('upperarm_r')!;
  const idxLowerArmL = boneIndexByName.get('lowerarm_l')!;
  const idxLowerArmR = boneIndexByName.get('lowerarm_r')!;
  const idxHandL = boneIndexByName.get('hand_l')!;
  const idxHandR = boneIndexByName.get('hand_r')!;
  const idxThighL = boneIndexByName.get('thigh_l')!;
  const idxThighR = boneIndexByName.get('thigh_r')!;
  const idxCalfL = boneIndexByName.get('calf_l')!;
  const idxCalfR = boneIndexByName.get('calf_r')!;
  const idxFootL = boneIndexByName.get('foot_l')!;
  const idxFootR = boneIndexByName.get('foot_r')!;

  // Step 1: Compute new bone local positions in bind pose
  const newLocalPos = baseLocalPos.map(v => v.clone());

  newLocalPos[idxSpine1]!.multiplyScalar(p.torsoLengthScale);
  newLocalPos[idxSpine2]!.multiplyScalar(p.torsoLengthScale);
  newLocalPos[idxSpine3]!.multiplyScalar(p.torsoLengthScale);
  newLocalPos[idxNeck]!.multiplyScalar(p.torsoLengthScale);
  newLocalPos[idxClavL]!.multiplyScalar(p.torsoLengthScale);
  newLocalPos[idxClavR]!.multiplyScalar(p.torsoLengthScale);
  // Restore sternoclavicular medial X spacing so width comes from clavicle span
  newLocalPos[idxClavL]!.x = baseLocalPos[idxClavL]!.x;
  newLocalPos[idxClavR]!.x = baseLocalPos[idxClavR]!.x;

  newLocalPos[idxHead]!.multiplyScalar(p.neckLengthScale);

  // Shift upperarm laterally in Armature X via clavicle's inverse bind rotation
  if (p.shoulderDeltaX !== 0) {
    const invClavL = baseBindQuat[idxClavL]!.clone().invert();
    const invClavR = baseBindQuat[idxClavR]!.clone().invert();
    newLocalPos[idxUpperArmL]!.add(new T.Vector3(p.shoulderDeltaX, 0, 0).applyQuaternion(invClavL));
    newLocalPos[idxUpperArmR]!.add(new T.Vector3(-p.shoulderDeltaX, 0, 0).applyQuaternion(invClavR));
  }

  newLocalPos[idxLowerArmL]!.multiplyScalar(p.upperArmLengthScale);
  newLocalPos[idxLowerArmR]!.multiplyScalar(p.upperArmLengthScale);
  newLocalPos[idxHandL]!.multiplyScalar(p.forearmLengthScale);
  newLocalPos[idxHandR]!.multiplyScalar(p.forearmLengthScale);

  // Shift thigh laterally in Armature X via pelvis's inverse bind rotation
  if (p.hipStanceScale !== 1) {
    const dxL = baseBindPos[idxThighL]!.x * (p.hipStanceScale - 1);
    const dxR = baseBindPos[idxThighR]!.x * (p.hipStanceScale - 1);
    const invPelvis = baseBindQuat[idxPelvis]!.clone().invert();
    newLocalPos[idxThighL]!.add(new T.Vector3(dxL, 0, 0).applyQuaternion(invPelvis));
    newLocalPos[idxThighR]!.add(new T.Vector3(dxR, 0, 0).applyQuaternion(invPelvis));
  }

  newLocalPos[idxCalfL]!.multiplyScalar(p.thighLengthScale);
  newLocalPos[idxCalfR]!.multiplyScalar(p.thighLengthScale);
  newLocalPos[idxFootL]!.multiplyScalar(p.calfLengthScale);
  newLocalPos[idxFootR]!.multiplyScalar(p.calfLengthScale);

  for (let i = 0; i < bones.length; i++) {
    const tag = baseline.boneGroupTag[i]!;
    if ((tag === TAG_HAND_L && i !== idxHandL) || (tag === TAG_HAND_R && i !== idxHandR)) {
      newLocalPos[i]!.multiplyScalar(p.handScale);
    } else if ((tag === TAG_FOOT_L && i !== idxFootL) || (tag === TAG_FOOT_R && i !== idxFootR)) {
      newLocalPos[i]!.multiplyScalar(p.footScale);
    }
  }

  // Initial estimate of pelvis vertical drop so ankle stays near baseline height before exact ground pass
  const thighDropY = (1 - p.thighLengthScale) * (baseBindPos[idxThighL]!.y - baseBindPos[idxCalfL]!.y);
  const calfDropY = (1 - p.calfLengthScale) * (baseBindPos[idxCalfL]!.y - baseBindPos[idxFootL]!.y);
  const pelvisParentIdx = parentBoneIdx[idxPelvis]!;
  const pelvisParentInvQuat = pelvisParentIdx >= 0 ? baseBindQuat[pelvisParentIdx]!.clone().invert() : new T.Quaternion();
  newLocalPos[idxPelvis]!.add(new T.Vector3(0, -(thighDropY + calfDropY), 0).applyQuaternion(pelvisParentInvQuat));

  // Forward-propagate T-pose bind matrices
  const unitScale = new T.Vector3(1, 1, 1);
  const newBindMat: T.Matrix4[] = new Array(bones.length);
  const newBindPos: T.Vector3[] = new Array(bones.length);
  for (let i = 0; i < bones.length; i++) {
    const localM = new T.Matrix4().compose(newLocalPos[i]!, baseLocalBindQuat[i]!, unitScale);
    const pIdx = parentBoneIdx[i]!;
    const worldM = pIdx >= 0 ? new T.Matrix4().multiplyMatrices(newBindMat[pIdx]!, localM) : localM;
    newBindMat[i] = worldM;
    newBindPos[i] = new T.Vector3().setFromMatrixPosition(worldM);
  }

  // Step 2: Deform canonical vertices of mainSkin in bind space
  const mainSB = baseline.mainSkin;
  const mainGeo = mainSB.skin.geometry;
  const siAttr = mainGeo.getAttribute('skinIndex') as T.BufferAttribute;
  const swAttr = mainGeo.getAttribute('skinWeight') as T.BufferAttribute;
  const vertCount = mainSB.basePositions.length / 3;
  const sculptedPos = new Float32Array(vertCount * 3);

  const pPelvis0 = baseBindPos[idxPelvis]!, pPelvis1 = newBindPos[idxPelvis]!;
  const pSpine1_0 = baseBindPos[idxSpine1]!, pSpine1_1 = newBindPos[idxSpine1]!;
  const pSpine2_0 = baseBindPos[idxSpine2]!, pSpine2_1 = newBindPos[idxSpine2]!;
  const pSpine3_0 = baseBindPos[idxSpine3]!, pSpine3_1 = newBindPos[idxSpine3]!;
  const pNeck0 = baseBindPos[idxNeck]!, pNeck1 = newBindPos[idxNeck]!;
  const pHead0 = baseBindPos[idxHead]!, pHead1 = newBindPos[idxHead]!;
  const pClavL0 = baseBindPos[idxClavL]!, pClavL1 = newBindPos[idxClavL]!;
  const pClavR0 = baseBindPos[idxClavR]!, pClavR1 = newBindPos[idxClavR]!;
  const pUpperArmL0 = baseBindPos[idxUpperArmL]!, pUpperArmL1 = newBindPos[idxUpperArmL]!;
  const pUpperArmR0 = baseBindPos[idxUpperArmR]!, pUpperArmR1 = newBindPos[idxUpperArmR]!;
  const pLowerArmL0 = baseBindPos[idxLowerArmL]!, pLowerArmL1 = newBindPos[idxLowerArmL]!;
  const pLowerArmR0 = baseBindPos[idxLowerArmR]!, pLowerArmR1 = newBindPos[idxLowerArmR]!;
  const pHandL0 = baseBindPos[idxHandL]!, pHandL1 = newBindPos[idxHandL]!;
  const pHandR0 = baseBindPos[idxHandR]!, pHandR1 = newBindPos[idxHandR]!;
  const pThighL0 = baseBindPos[idxThighL]!, pThighL1 = newBindPos[idxThighL]!;
  const pThighR0 = baseBindPos[idxThighR]!, pThighR1 = newBindPos[idxThighR]!;
  const pCalfL0 = baseBindPos[idxCalfL]!, pCalfL1 = newBindPos[idxCalfL]!;
  const pCalfR0 = baseBindPos[idxCalfR]!, pCalfR1 = newBindPos[idxCalfR]!;
  const pFootL0 = baseBindPos[idxFootL]!, pFootL1 = newBindPos[idxFootL]!;
  const pFootR0 = baseBindPos[idxFootR]!, pFootR1 = newBindPos[idxFootR]!;

  const tmpBoneOut = new T.Vector3();
  const tmpRad = new T.Vector3();

  const evaluateBoneAffine = (tag: number, bIdx: number, vx: number, vy: number, vz: number, out: T.Vector3) => {
    switch (tag) {
      case TAG_PELVIS: {
        const h0 = pThighL0.y - pPelvis0.y;
        const s0 = pSpine1_0.y - pPelvis0.y;
        const xBlend = smoothstep(pThighL0.y, pSpine1_0.y, vy);
        const xScale = p.hipStanceScale + (1 - p.hipStanceScale) * xBlend;
        let ny: number;
        if (vy <= pThighL0.y || s0 - h0 < 1e-5) {
          ny = pPelvis1.y + (vy - pPelvis0.y);
        } else {
          const slope = (pSpine1_1.y - pPelvis1.y - h0) / (s0 - h0);
          ny = pPelvis1.y + h0 + slope * (vy - pThighL0.y);
        }
        out.set(pPelvis1.x + (vx - pPelvis0.x) * xScale, ny, pPelvis1.z + (vz - pPelvis0.z));
        return;
      }
      case TAG_SPINE1:
        segWarp(vx, vy, vz, pSpine1_0, pSpine2_0, pSpine1_1, pSpine2_1, out);
        return;
      case TAG_SPINE2:
        segWarp(vx, vy, vz, pSpine2_0, pSpine3_0, pSpine2_1, pSpine3_1, out);
        return;
      case TAG_SPINE3:
        out.set(
          pSpine3_1.x + (vx - pSpine3_0.x),
          pSpine3_1.y + (vy - pSpine3_0.y) * p.torsoLengthScale,
          pSpine3_1.z + (vz - pSpine3_0.z) * p.torsoLengthScale,
        );
        return;
      case TAG_NECK:
        segWarp(vx, vy, vz, pNeck0, pHead0, pNeck1, pHead1, out);
        return;
      case TAG_HEAD:
        out.set(
          pHead1.x + (vx - pHead0.x) * p.headScale,
          pHead1.y + (vy - pHead0.y) * p.headScale,
          pHead1.z + (vz - pHead0.z) * p.headScale,
        );
        return;
      case TAG_CLAVICLE_L:
        segWarp(vx, vy, vz, pClavL0, pUpperArmL0, pClavL1, pUpperArmL1, out);
        return;
      case TAG_CLAVICLE_R:
        segWarp(vx, vy, vz, pClavR0, pUpperArmR0, pClavR1, pUpperArmR1, out);
        return;
      case TAG_UPPERARM_L:
        segWarp(vx, vy, vz, pUpperArmL0, pLowerArmL0, pUpperArmL1, pLowerArmL1, out);
        return;
      case TAG_UPPERARM_R:
        segWarp(vx, vy, vz, pUpperArmR0, pLowerArmR0, pUpperArmR1, pLowerArmR1, out);
        return;
      case TAG_LOWERARM_L:
        segWarp(vx, vy, vz, pLowerArmL0, pHandL0, pLowerArmL1, pHandL1, out);
        return;
      case TAG_LOWERARM_R:
        segWarp(vx, vy, vz, pLowerArmR0, pHandR0, pLowerArmR1, pHandR1, out);
        return;
      case TAG_HAND_L:
        out.set(
          pHandL1.x + (vx - pHandL0.x) * p.handScale,
          pHandL1.y + (vy - pHandL0.y) * p.handScale,
          pHandL1.z + (vz - pHandL0.z) * p.handScale,
        );
        return;
      case TAG_HAND_R:
        out.set(
          pHandR1.x + (vx - pHandR0.x) * p.handScale,
          pHandR1.y + (vy - pHandR0.y) * p.handScale,
          pHandR1.z + (vz - pHandR0.z) * p.handScale,
        );
        return;
      case TAG_THIGH_L:
        segWarp(vx, vy, vz, pThighL0, pCalfL0, pThighL1, pCalfL1, out);
        return;
      case TAG_THIGH_R:
        segWarp(vx, vy, vz, pThighR0, pCalfR0, pThighR1, pCalfR1, out);
        return;
      case TAG_CALF_L:
        segWarp(vx, vy, vz, pCalfL0, pFootL0, pCalfL1, pFootL1, out);
        return;
      case TAG_CALF_R:
        segWarp(vx, vy, vz, pCalfR0, pFootR0, pCalfR1, pFootR1, out);
        return;
      case TAG_FOOT_L:
        out.set(
          pFootL1.x + (vx - pFootL0.x) * p.footScale,
          pFootL1.y + (vy - pFootL0.y) * p.footScale,
          pFootL1.z + (vz - pFootL0.z) * p.footScale,
        );
        return;
      case TAG_FOOT_R:
        out.set(
          pFootR1.x + (vx - pFootR0.x) * p.footScale,
          pFootR1.y + (vy - pFootR0.y) * p.footScale,
          pFootR1.z + (vz - pFootR0.z) * p.footScale,
        );
        return;
      default: {
        const bp0 = baseBindPos[bIdx]!, bp1 = newBindPos[bIdx]!;
        out.set(bp1.x + (vx - bp0.x), bp1.y + (vy - bp0.y), bp1.z + (vz - bp0.z));
      }
    }
  };

  let minSculptedY = Infinity;

  for (let i = 0; i < vertCount; i++) {
    const canon = mainSB.posWeldCanon[i]!;
    if (canon < i) {
      sculptedPos[i * 3] = sculptedPos[canon * 3]!;
      sculptedPos[i * 3 + 1] = sculptedPos[canon * 3 + 1]!;
      sculptedPos[i * 3 + 2] = sculptedPos[canon * 3 + 2]!;
      continue;
    }

    const x0 = mainSB.basePositions[i * 3]!;
    const y0 = mainSB.basePositions[i * 3 + 1]!;
    const z0 = mainSB.basePositions[i * 3 + 2]!;

    // Gather bone weights by anatomical group
    let wx = 0, wy = 0, wz = 0, wSum = 0;
    let wPelvis = 0, wSpine1 = 0, wSpine2 = 0, wSpine3 = 0, wNeck = 0, wHead = 0;
    let wClav = 0, wUpperArmL = 0, wUpperArmR = 0, wLowerArmL = 0, wLowerArmR = 0;
    let wHandL = 0, wHandR = 0, wThighL = 0, wThighR = 0, wCalfL = 0, wCalfR = 0, wFootL = 0, wFootR = 0;

    for (let k = 0; k < 4; k++) {
      const bw = swAttr.getComponent(i, k);
      if (bw <= 0) continue;
      const bIdx = siAttr.getComponent(i, k);
      const tag = baseline.boneGroupTag[bIdx]!;
      evaluateBoneAffine(tag, bIdx, x0, y0, z0, tmpBoneOut);
      wx += bw * tmpBoneOut.x;
      wy += bw * tmpBoneOut.y;
      wz += bw * tmpBoneOut.z;
      wSum += bw;

      switch (tag) {
        case TAG_PELVIS: wPelvis += bw; break;
        case TAG_SPINE1: wSpine1 += bw; break;
        case TAG_SPINE2: wSpine2 += bw; break;
        case TAG_SPINE3: wSpine3 += bw; break;
        case TAG_NECK: wNeck += bw; break;
        case TAG_HEAD: wHead += bw; break;
        case TAG_CLAVICLE_L:
        case TAG_CLAVICLE_R: wClav += bw; break;
        case TAG_UPPERARM_L: wUpperArmL += bw; break;
        case TAG_UPPERARM_R: wUpperArmR += bw; break;
        case TAG_LOWERARM_L: wLowerArmL += bw; break;
        case TAG_LOWERARM_R: wLowerArmR += bw; break;
        case TAG_HAND_L: wHandL += bw; break;
        case TAG_HAND_R: wHandR += bw; break;
        case TAG_THIGH_L: wThighL += bw; break;
        case TAG_THIGH_R: wThighR += bw; break;
        case TAG_CALF_L: wCalfL += bw; break;
        case TAG_CALF_R: wCalfR += bw; break;
        case TAG_FOOT_L: wFootL += bw; break;
        case TAG_FOOT_R: wFootR += bw; break;
      }
    }

    if (wSum > 0 && Math.abs(wSum - 1) > 1e-5) {
      const invW = 1 / wSum;
      wx *= invW; wy *= invW; wz *= invW;
    } else if (wSum === 0) {
      wx = x0; wy = y0; wz = z0;
    }

    // Lock face/eyelids/skull above jaw plane to exact rigid Head scale so Eyes & Eyebrows never drift
    const sJaw = (y0 - pHead0.y) + 0.42 * (z0 - pHead0.z);
    const headLock = smoothstep(-0.055, 0.002, sJaw) * smoothstep(0.05, 0.55, wHead + wNeck);
    if (headLock > 0) {
      const hx = pHead1.x + (x0 - pHead0.x) * p.headScale;
      const hy = pHead1.y + (y0 - pHead0.y) * p.headScale;
      const hz = pHead1.z + (z0 - pHead0.z) * p.headScale;
      wx += headLock * (hx - wx);
      wy += headLock * (hy - wy);
      wz += headLock * (hz - wz);
    }

    // Step 2b: Smooth anatomical soft-tissue sculpting in bind space
    let dx = 0, dy = 0, dz = 0;
    const signX = x0 >= 0 ? 1 : -1;
    const absX0 = Math.abs(x0);

    const wTorsoCore = wPelvis + wSpine1 + wSpine2 + wSpine3;
    const wArmTotal = wUpperArmL + wUpperArmR + wLowerArmL + wLowerArmR + wHandL + wHandR;
    const torsoGate = smoothstep(0.08, 0.72, wTorsoCore) * (1 - smoothstep(0.15, 0.65, wArmTotal));

    if (torsoGate > 1e-4) {
      // 1. Ribcage / Upper Torso breadth & depth (centered near spine_03)
      const chestBand = asymGauss(y0, pSpine3_0.y + 0.02, 0.088, 0.095) * (1 - smoothstep(pNeck0.y - 0.02, pNeck0.y + 0.03, y0));
      dx += torsoGate * chestBand * x0 * p.chestWidth;
      if (z0 >= pSpine3_0.z) {
        dz += torsoGate * chestBand * (z0 - pSpine3_0.z) * p.chestFrontBase;
      } else {
        dz += torsoGate * chestBand * (z0 - pSpine3_0.z) * p.chestBackDepth;
      }

      // 2. Bust / Pectoral anterior volume (strictly gated away from arms, neck, head, and outer clavicles)
      if (p.bustProjection !== 0) {
        const rawBustWeight = wSpine1 + wSpine2 + wSpine3 - 1.5 * (wArmTotal + wNeck + wHead) - 0.6 * wClav;
        const bustGate = Math.pow(Math.max(0, Math.min(1, rawBustWeight)), 2);
        const antMask = smoothstep(0.005, 0.075, z0 - pSpine3_0.z);
        if (bustGate > 1e-4 && antMask > 1e-4) {
          const yApex = pSpine3_0.y + (isFemale ? 0.018 : 0.026);
          const vProfile = asymGauss(y0, yApex, isFemale ? 0.050 : 0.058, isFemale ? 0.074 : 0.070);
          const moundX = isFemale ? 0.074 : 0.080;
          const sigmaX = isFemale ? 0.048 : 0.062;
          const mound = gauss(absX0, moundX, sigmaX);
          const bridge = gauss(absX0, 0, isFemale ? 0.065 : 0.085) * (isFemale ? 0.30 : 0.42);
          const latProfile = Math.min(1.08, mound + bridge);
          const wBust = bustGate * antMask * vProfile * latProfile;

          dz += wBust * p.bustProjection;
          const outerFactor = smoothstep(moundX * 0.45, moundX * 1.45, absX0) * gauss(absX0, moundX * 1.15, 0.055);
          dx += signX * bustGate * antMask * vProfile * outerFactor * p.bustLateral;
          dy -= wBust * p.bustDrop;
        }
      }

      // 3. Natural Waist width & depth (centered at spine_02)
      const waistBand = gauss(y0, pSpine2_0.y, 0.082);
      dx += torsoGate * waistBand * x0 * p.waistWidth;
      if (z0 >= pSpine2_0.z) {
        dz += torsoGate * waistBand * (z0 - pSpine2_0.z) * p.waistFrontDepth;
      } else {
        dz += torsoGate * waistBand * (z0 - pSpine2_0.z) * p.waistBackDepth;
      }

      // 4. Anterior Belly / Abdominal dome (centered between spine_01 and spine_02)
      if (p.bellyProjection !== 0 || p.bellyWidth !== 0) {
        const yBelly = 0.56 * pSpine1_0.y + 0.44 * pSpine2_0.y;
        const bellyV = asymGauss(y0, yBelly, 0.085, 0.110);
        const bellyAnt = smoothstep(-0.02, 0.065, z0 - pSpine1_0.z);
        const bellyDomeX = gauss(absX0, 0, isFemale ? 0.135 : 0.148);
        const wBelly = torsoGate * bellyV * bellyAnt * bellyDomeX;
        dz += wBelly * p.bellyProjection;
        dy -= wBelly * p.bellyDrop;
        // Gate lateral abdominal roundness toward the anterior belly so lateral ribs/waist stay controlled
        dx += torsoGate * bellyV * smoothstep(-0.03, 0.05, z0 - pSpine1_0.z) * x0 * p.bellyWidth * 0.35;
      }

      // 5. Pelvis / Hip lateral breadth & Gluteal posterior curve
      const hipBand = asymGauss(y0, pPelvis0.y - 0.012, 0.095, 0.078);
      dx += torsoGate * hipBand * x0 * p.hipWidth;
      if (p.gluteProjection !== 0) {
        const postMask = smoothstep(-0.01, -0.085, z0 - pPelvis0.z);
        const gluteV = asymGauss(y0, pPelvis0.y - 0.032, 0.078, 0.088);
        const gluteLobe = gauss(absX0, 0.082, 0.062) + 0.25 * gauss(absX0, 0, 0.05);
        dz -= torsoGate * postMask * gluteV * Math.min(1.05, gluteLobe) * p.gluteProjection;
      }
    }

    // Also blend hip breadth into proximal thigh weights near pelvis so hip-thigh transition is seamless
    const wThighTotal = wThighL + wThighR;
    if (wThighTotal > 1e-4 && p.hipWidth !== 0) {
      const proxHipBand = gauss(y0, pPelvis0.y - 0.012, 0.095) * smoothstep(pPelvis0.y - 0.14, pPelvis0.y + 0.02, y0);
      dx += wThighTotal * proxHipBand * x0 * p.hipWidth * 0.65;
      if (p.gluteProjection !== 0) {
        const postMask = smoothstep(-0.01, -0.085, z0 - pPelvis0.z);
        const gluteV = asymGauss(y0, pPelvis0.y - 0.032, 0.078, 0.088);
        const gluteLobe = gauss(absX0, 0.082, 0.062);
        dz -= wThighTotal * postMask * gluteV * gluteLobe * p.gluteProjection * 0.7;
      }
    }

    // 6. Limb radial girth sculpting around warped bone centerlines
    // Thighs (protect inner-thigh midline from crossing x = 0)
    if (p.thighGirth !== 0 && (wThighL > 1e-4 || wThighR > 1e-4)) {
      const isLeft = wThighL >= wThighR;
      const wT = isLeft ? wThighL : wThighR;
      const { s } = radialLimbDisplacement(
        wx, wy, wz,
        isLeft ? pThighL1 : pThighR1,
        isLeft ? pCalfL1 : pCalfR1,
        tmpRad,
      );
      const sClamped = Math.max(0, Math.min(1, s));
      const profile = 0.38 + 0.62 * Math.pow(Math.sin(Math.PI * sClamped), 0.72);
      const gain = wT * p.thighGirth * profile;
      const limbSign = isLeft ? 1 : -1;
      const isMedial = tmpRad.x * limbSign < 0;
      let rxScale = gain;
      if (isMedial && gain > 0) {
        const midlineClearance = smoothstep(0.010, 0.055, Math.abs(wx));
        rxScale *= 0.35 * midlineClearance;
      }
      dx += tmpRad.x * rxScale;
      dz += tmpRad.z * gain * 1.05;
    }

    // Calves (taper cleanly to ankle)
    if (p.calfGirth !== 0 && (wCalfL > 1e-4 || wCalfR > 1e-4)) {
      const isLeft = wCalfL >= wCalfR;
      const wC = isLeft ? wCalfL : wCalfR;
      const { s } = radialLimbDisplacement(
        wx, wy, wz,
        isLeft ? pCalfL1 : pCalfR1,
        isLeft ? pFootL1 : pFootR1,
        tmpRad,
      );
      const ankleTaper = 1 - smoothstep(0.72, 0.94, s);
      const gastrocBell = 0.35 + 0.75 * asymGauss(s, 0.32, 0.22, 0.28);
      const gain = wC * p.calfGirth * gastrocBell * ankleTaper;
      dx += tmpRad.x * gain;
      dz += tmpRad.z * gain * (tmpRad.z < 0 ? 1.18 : 0.88);
    }

    // Upper arms (in T-pose, arm axis is ±X; radial cross-section is Y-Z)
    if ((p.upperArmGirth !== 0 || p.tricepHang !== 0) && (wUpperArmL > 1e-4 || wUpperArmR > 1e-4)) {
      const isLeft = wUpperArmL >= wUpperArmR;
      const wU = isLeft ? wUpperArmL : wUpperArmR;
      const { s } = radialLimbDisplacement(
        wx, wy, wz,
        isLeft ? pUpperArmL1 : pUpperArmR1,
        isLeft ? pLowerArmL1 : pLowerArmR1,
        tmpRad,
      );
      const sClamped = Math.max(0, Math.min(1, s));
      const bell = 0.35 + 0.65 * Math.sin(Math.PI * sClamped);
      // In T-pose, +Y is lateral outer deltoid (becomes +X outer silhouette in A-pose)
      // while -Y is medial underarm (faces ribcage in A-pose)
      const armpitSafe = tmpRad.y < 0 && s < 0.35 ? smoothstep(0.05, 0.35, s) : 1;
      const baseGain = wU * p.upperArmGirth * bell;
      const yGain = baseGain > 0 && tmpRad.y < 0 ? baseGain * 0.22 * armpitSafe : baseGain * (baseGain > 0 ? 1.12 : 1.0);
      dy += tmpRad.y * yGain;
      dz += tmpRad.z * baseGain * (tmpRad.z < 0 ? 1.14 : 0.96);
      if (p.tricepHang > 0 && tmpRad.z < 0) {
        const tricepBell = Math.sin(Math.PI * sClamped) * smoothstep(0.12, 0.40, s);
        dz -= wU * p.tricepHang * tricepBell;
      }
    }

    // Forearms (taper cleanly to wrist)
    if (p.forearmGirth !== 0 && (wLowerArmL > 1e-4 || wLowerArmR > 1e-4)) {
      const isLeft = wLowerArmL >= wLowerArmR;
      const wF = isLeft ? wLowerArmL : wLowerArmR;
      const { s } = radialLimbDisplacement(
        wx, wy, wz,
        isLeft ? pLowerArmL1 : pLowerArmR1,
        isLeft ? pHandL1 : pHandR1,
        tmpRad,
      );
      const wristTaper = 1 - smoothstep(0.68, 0.92, s);
      const brachioBell = 0.30 + 0.70 * asymGauss(s, 0.28, 0.20, 0.30);
      const gain = wF * p.forearmGirth * brachioBell * wristTaper;
      const yGain = gain > 0 && tmpRad.y < 0 ? gain * 0.45 : gain * (gain > 0 ? 1.08 : 1.0);
      dy += tmpRad.y * yGain;
      dz += tmpRad.z * gain;
    }

    // Cute/soft extremity plumpness (palm & foot dorsum only; gentle so fingers stay separated)
    if (p.extremityPlump !== 0) {
      const wHand = wHandL + wHandR;
      if (wHand > 0.2) {
        const handAnchor = wHandL >= wHandR ? pHandL1 : pHandR1;
        const palmMask = 1 - smoothstep(0.05, 0.11, Math.abs(wx - handAnchor.x));
        dy += (wy - handAnchor.y) * wHand * p.extremityPlump * palmMask;
        dz += (wz - handAnchor.z) * wHand * p.extremityPlump * palmMask * 0.5;
      }
      const wFoot = wFootL + wFootR;
      if (wFoot > 0.2) {
        const footAnchor = wFootL >= wFootR ? pFootL1 : pFootR1;
        dx += (wx - footAnchor.x) * wFoot * p.extremityPlump * 0.75;
      }
    }

    // 7. Neck girth & soft cheek / submental contour (strictly below eyes/brows!)
    if (p.neckGirth !== 0 && (wNeck + wHead) > 0.05) {
      const neckBand =
        smoothstep(pSpine3_0.y + 0.12, pNeck0.y - 0.01, y0) *
        (1 - smoothstep(pHead0.y - 0.015, pHead0.y + 0.025, y0));
      if (neckBand > 1e-4) {
        const tNeck = Math.max(0, Math.min(1, (y0 - pNeck0.y) / Math.max(0.02, pHead0.y - pNeck0.y)));
        const nCenterZ = pNeck1.z + tNeck * (pHead1.z - pNeck1.z);
        dx += wx * neckBand * p.neckGirth;
        dz += (wz - nCenterZ) * neckBand * p.neckGirth * 0.85;
      }
    }

    if ((p.cheekFullness !== 0 || p.submentalFullness !== 0) && (wHead + wNeck) > 0.2) {
      // Strictly zero above pHead0.y + 0.068 (well below eye sockets at +0.084..+0.090)
      const belowEyesMask = 1 - smoothstep(pHead0.y + 0.050, pHead0.y + 0.068, y0);
      if (belowEyesMask > 1e-4) {
        if (p.cheekFullness !== 0) {
          const cheekY = gauss(y0, pHead0.y + 0.022, 0.024);
          const cheekZ = gauss(z0, pHead0.z + 0.048, 0.036);
          const cheekX = smoothstep(0.028, 0.062, absX0);
          const wCheek = belowEyesMask * cheekY * cheekZ * cheekX * p.headScale;
          dx += signX * wCheek * p.cheekFullness;
          dz += wCheek * p.cheekFullness * 0.25;
        }
        if (p.submentalFullness !== 0) {
          // Under-jaw/jowl fullness (lateral jowl + submental neck-chin angle; avoids front chin tip so beards never clip)
          const subY = gauss(y0, pHead0.y - 0.018, 0.026);
          const subZ = gauss(z0, pHead0.z + 0.032, 0.032) * (1 - smoothstep(pHead0.z + 0.065, pHead0.z + 0.090, z0));
          const wSub = belowEyesMask * subY * subZ * p.headScale;
          dy -= wSub * p.submentalFullness * 0.75;
          dz += wSub * p.submentalFullness * 0.55;
          dx += signX * smoothstep(0.015, 0.055, absX0) * wSub * p.submentalFullness * 0.65;
        }
      }
    }

    let fx = wx + dx;
    const fy = wy + dy;
    const fz = wz + dz;

    // Medial midline safety clamp: vertices clearly on left/right thigh never cross x = 0
    if (wThighTotal > 0.35 && absX0 > 0.004) {
      if (signX > 0 && fx < 0.003) fx = 0.003;
      if (signX < 0 && fx > -0.003) fx = -0.003;
    }

    sculptedPos[i * 3] = fx;
    sculptedPos[i * 3 + 1] = fy;
    sculptedPos[i * 3 + 2] = fz;
    if (fy < minSculptedY) minSculptedY = fy;
  }

  // Step 3: Exact ground-contact alignment so neutral soles stay planted at baseline minY
  const groundDeltaY = Number.isFinite(minSculptedY) ? mainSB.baseMinY - minSculptedY : 0;
  if (Math.abs(groundDeltaY) > 1e-9) {
    for (let i = 0; i < vertCount; i++) {
      sculptedPos[i * 3 + 1]! += groundDeltaY;
    }
    newLocalPos[idxPelvis]!.add(new T.Vector3(0, groundDeltaY, 0).applyQuaternion(pelvisParentInvQuat));
    for (let i = 0; i < bones.length; i++) {
      const localM = new T.Matrix4().compose(newLocalPos[i]!, baseLocalBindQuat[i]!, unitScale);
      const pIdx = parentBoneIdx[i]!;
      const worldM = pIdx >= 0 ? new T.Matrix4().multiplyMatrices(newBindMat[pIdx]!, localM) : localM;
      newBindMat[i] = worldM;
      newBindPos[i] = new T.Vector3().setFromMatrixPosition(worldM);
    }
  }

  // Step 4: Write mainSkin positions & seam-welded smooth normals
  const mainPosAttr = mainGeo.getAttribute('position') as T.BufferAttribute;
  const mainNormAttr = mainGeo.getAttribute('normal') as T.BufferAttribute;
  (mainPosAttr.array as Float32Array).set(sculptedPos);
  recomputeWeldedNormals(
    mainGeo,
    sculptedPos,
    mainSB.normWeldCanon,
    mainSB.normWeldGroupCount,
    mainNormAttr.array as Float32Array,
  );
  mainPosAttr.needsUpdate = true;
  mainNormAttr.needsUpdate = true;

  // Step 5: Transform auxiliary head-skinned meshes (Eyes, Eyebrows) with exact Head similarity transform
  const finalHeadPos = newBindPos[idxHead]!;
  for (const sb of baseline.skins) {
    if (sb.isMainBody) continue;
    const posAttr = sb.skin.geometry.getAttribute('position') as T.BufferAttribute;
    const normAttr = sb.skin.geometry.getAttribute('normal') as T.BufferAttribute;
    const outArr = posAttr.array as Float32Array;
    const cnt = sb.basePositions.length / 3;
    for (let i = 0; i < cnt; i++) {
      const canon = sb.posWeldCanon[i]!;
      if (canon < i) {
        outArr[i * 3] = outArr[canon * 3]!;
        outArr[i * 3 + 1] = outArr[canon * 3 + 1]!;
        outArr[i * 3 + 2] = outArr[canon * 3 + 2]!;
        continue;
      }
      const bx = sb.basePositions[i * 3]!;
      const by = sb.basePositions[i * 3 + 1]!;
      const bz = sb.basePositions[i * 3 + 2]!;
      outArr[i * 3] = finalHeadPos.x + (bx - pHead0.x) * p.headScale;
      outArr[i * 3 + 1] = finalHeadPos.y + (by - pHead0.y) * p.headScale;
      outArr[i * 3 + 2] = finalHeadPos.z + (bz - pHead0.z) * p.headScale;
    }
    (normAttr.array as Float32Array).set(sb.baseNormals);
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
  }

  // Step 6: Update bone rest local positions & inverse bind matrices while preserving current FK pose quaternions
  const newBoneInverses = newBindMat.map(m => m.clone().invert());
  for (let i = 0; i < bones.length; i++) {
    bones[i]!.position.copy(newLocalPos[i]!);
    bones[i]!.scale.set(1, 1, 1);
  }
  for (const sb of baseline.skins) {
    for (let i = 0; i < bones.length; i++) {
      sb.skin.skeleton.boneInverses[i]!.copy(newBoneInverses[i]!);
    }
  }

  updateAttachedHeadMeshes(headBone, p.headScale);

  figureRoot.userData.bodyType = bodyType;
  figureRoot.userData.bodyProportionHeadScale = p.headScale;
  figureRoot.userData.__bodyProportionRevision = ((figureRoot.userData.__bodyProportionRevision as number) || 0) + 1;

  figureRoot.updateMatrixWorld(true);
  for (const sb of baseline.skins) {
    sb.skin.skeleton.update();
    sb.skin.computeBoundingBox();
    sb.skin.computeBoundingSphere();
  }

  return { headScale: p.headScale };
}
