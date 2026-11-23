import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { CHARACTERS, defaultModelId, isModelId, type ModelId } from './characterCatalog';
import { DEFAULT_BODY_TYPE, isBodyTypeId, type BodyTypeId } from './bodyProportions';
import {
  DEFAULT_MANNEQUIN_DRESS_ID,
  MANNEQUIN_DRESS_PRESET_IDS,
  isMannequinDressPresetId,
  type MannequinDressPresetId,
} from './mannequin-dress';
import { isRoomId, type RoomId } from './roomCatalog';
import {
  BOOLEAN_OP_TYPES,
  MODIFIER_TYPES,
  PLATONIC_TYPES,
  PRIMITIVE_KINDS,
  type AxisId,
  type BooleanOpType,
  type EditableMeshData,
  type ModifierSpec,
  type ModifierType,
  type PrimitiveKind,
  type PrimitiveSpec,
} from './modeling/types';
import { createDefaultPrimitiveSpec, getPrimitiveGroundY } from './modeling/primitives';
import { createModifierSpec } from './modeling/modifiers';
import type { ImportFormat3D } from './importers/import3d';

export const IMPORT_FORMATS_3D = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae', '3ds'] as const;

export function createDefaultModifierSpec<K extends ModifierType>(type: K): Extract<ModifierSpec, { type: K }> {
  return createModifierSpec(type, crypto.randomUUID());
}

export {
  BOOLEAN_OP_TYPES,
  DEFAULT_MANNEQUIN_DRESS_ID,
  MANNEQUIN_DRESS_PRESET_IDS,
  MODIFIER_TYPES,
  PLATONIC_TYPES,
  PRIMITIVE_KINDS,
  createDefaultPrimitiveSpec,
  getPrimitiveGroundY,
  isMannequinDressPresetId,
  type AxisId,
  type BooleanOpType,
  type EditableMeshData,
  type ImportFormat3D,
  type MannequinDressPresetId,
  type ModifierSpec,
  type ModifierType,
  type PrimitiveKind,
  type PrimitiveSpec,
};

export type Vec3 = [number, number, number];
export const MODELING_KINDS = ['primitive', 'mesh', 'boole', 'imported'] as const;
export type ModelingItemKind = typeof MODELING_KINDS[number];
export const isModelingKind = (kind: string): kind is ModelingItemKind =>
  (MODELING_KINDS as readonly string[]).includes(kind);

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  pyramid: 'Pyramid',
  torus: 'Torus',
  capsule: 'Capsule',
  tube: 'Tube',
  plane: 'Plane',
  disc: 'Disc',
  platonic: 'Platonic',
};

export const MODIFIER_LABELS: Record<ModifierType, string> = {
  bevel: 'Bevel',
  subdivision: 'Subdivision Surface',
  mirror: 'Symmetry',
  solidify: 'Solidify',
  bend: 'Bend',
  twist: 'Twist',
  taper: 'Taper',
  array: 'Array',
};

export const BOOLEAN_OP_LABELS: Record<BooleanOpType, string> = {
  union: 'A ∪ B (Union)',
  subtract: 'A − B (Subtract)',
  intersect: 'A ∩ B (Intersect)',
};
export const RENDER_MODES = ['realistic', 'illustration', 'outline', 'clay', 'flat'] as const;
export type RenderModeId = typeof RENDER_MODES[number];
export interface RenderStyleState {
  mode: RenderModeId;
  inkColor: string; inkWidth: number; interiorDetail: number;
  shadowSteps: 2 | 3; shadowTemp: 'cool' | 'warm' | 'neutral';
  outlinePaper: 'warm' | 'white' | 'scene' | 'transparent';
  clayFinish: 'terracotta' | 'grey' | 'plaster'; clayOutlines: boolean;
}
export const DEFAULT_RENDER_STYLE: Readonly<RenderStyleState> = {
  mode: 'realistic', inkColor: '#1f1b18', inkWidth: 1.5, interiorDetail: 0.65,
  shadowSteps: 2, shadowTemp: 'cool', outlinePaper: 'warm',
  clayFinish: 'terracotta', clayOutlines: false,
};
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist', 'leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle'] as const;
export type Joint = typeof JOINTS[number];
export type Pose = Record<Joint, Vec3>;
export type Body = 'male' | 'female';
export const DEFAULT_HAIR_COLOR = '#3b2720';
export const DEFAULT_MALE_SKIN_COLOR = '#d9a17c';
export const DEFAULT_FEMALE_SKIN_COLOR = '#e8b896';
export const DEFAULT_MALE_OUTFIT_COLOR = '#2f435e';
export const DEFAULT_FEMALE_OUTFIT_COLOR = '#8f304d';
export const defaultSkinColor = (body: Body): string =>
  body === 'female' ? DEFAULT_FEMALE_SKIN_COLOR : DEFAULT_MALE_SKIN_COLOR;
export const defaultOutfitColor = (body: Body): string =>
  body === 'female' ? DEFAULT_FEMALE_OUTFIT_COLOR : DEFAULT_MALE_OUTFIT_COLOR;
export const HAIR_STYLE_IDS = ['parted', 'long', 'buns', 'buzz', 'partedBeard', 'none'] as const;
export type HairStyleId = typeof HAIR_STYLE_IDS[number];
export const isExternalCharacter = (modelId?: ModelId): boolean =>
  Boolean(modelId && CHARACTERS[modelId]?.source);
export const isMannequinCharacter = (modelId?: ModelId): boolean =>
  !isExternalCharacter(modelId);
export const hasCharacterOutfitSlot = (modelId?: ModelId): boolean =>
  !modelId || !CHARACTERS[modelId]?.source || (CHARACTERS[modelId]!.source!.authored.outfit.length > 0);
export const hasAuthoredHair = (modelId?: ModelId): boolean =>
  Boolean(modelId && CHARACTERS[modelId]?.source?.authored.hair.length);
export const defaultCharacterSkinColor = (body: Body, modelId?: ModelId): string =>
  isExternalCharacter(modelId) ? '#ffffff' : defaultSkinColor(body);
export const defaultCharacterOutfitColor = (body: Body, modelId?: ModelId): string =>
  isExternalCharacter(modelId) ? '#ffffff' : defaultOutfitColor(body);
export const defaultCharacterHairColor = (modelId?: ModelId): string =>
  hasAuthoredHair(modelId) ? '#ffffff' : DEFAULT_HAIR_COLOR;
export const defaultCharacterHairStyle = (body: Body, modelId?: ModelId): HairStyleId =>
  (modelId ? CHARACTERS[modelId]?.source?.defaultHairStyle : undefined) ?? (body === 'female' ? 'long' : 'parted');
export const PROP_KINDS = ['lamp', 'table', 'chair', 'desk', 'couch', 'bed', 'room'] as const;
export type PropKind = typeof PROP_KINDS[number];
export interface RoomObjectOverride {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  visible?: boolean;
  locked?: boolean;
  deleted?: boolean;
}
export type LightType = 'spot' | 'directional' | 'point';
export const LIGHT_TYPES = ['spot', 'directional', 'point'] as const;
export type LightPart = 'source' | 'target';
export const LIGHT_PARTS = ['source', 'target'] as const;
export const LIGHT_TYPE_LABELS: Record<LightType, string> = {
  spot: 'Spotlight',
  directional: 'Parallel light',
  point: 'Omni light',
};
export const DEFAULT_LIGHT_TYPE: LightType = 'spot';
export const LIGHT_DEFAULTS = {
  lightType: DEFAULT_LIGHT_TYPE,
  intensity: 30,
  directionalIntensity: 3,
  castShadow: true,
  angle: 60,
  penumbra: 0.65,
  distance: 70,
  decay: 1.3,
  shadowExtent: 10,
} as const;

export interface HandPoseSpec {
  /** Normalized curl per digit: 0 = bind neutral, -0.35 = hyper-extended (~-30°), +1 = full fist curl */
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
  /** Splay / abduction across fingers: -0.6 = adducted together, 0 = neutral, +1 = wide spread */
  spread: number;
  /** Thumb opposition / radial abduction: -1 = wide open/abducted, 0 = neutral, +1 = opposed across palm */
  thumbOpposition: number;
}
export interface CharacterHandPoses {
  left?: HandPoseSpec;
  right?: HandPoseSpec;
}
export const FINGER_IDS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerId = typeof FINGER_IDS[number];
export const HAND_SIDES = ['left', 'right'] as const;
export type HandSide = typeof HAND_SIDES[number];
export const HAND_CURL_MIN = -0.35;
export const HAND_CURL_MAX = 1.0;
export const HAND_SPREAD_MIN = -0.6;
export const HAND_SPREAD_MAX = 1.0;
export const HAND_OPPOSITION_MIN = -1.0;
export const HAND_OPPOSITION_MAX = 1.0;

export const HAND_PRESETS = [
  'Open',
  'Fist',
  'Thumbs Up',
  'Grip',
  'Relaxed',
  'Spread',
  'Point',
  'Peace',
  'Pinch',
] as const;
export type HandPresetName = typeof HAND_PRESETS[number];

export function defaultHandPose(): HandPoseSpec {
  return {
    thumb: 0,
    index: 0,
    middle: 0,
    ring: 0,
    pinky: 0,
    spread: 0,
    thumbOpposition: 0,
  };
}

export function isNeutralHandPose(spec?: HandPoseSpec | null): boolean {
  if (!spec) return true;
  return (
    Math.abs(spec.thumb) < 1e-6 &&
    Math.abs(spec.index) < 1e-6 &&
    Math.abs(spec.middle) < 1e-6 &&
    Math.abs(spec.ring) < 1e-6 &&
    Math.abs(spec.pinky) < 1e-6 &&
    Math.abs(spec.spread) < 1e-6 &&
    Math.abs(spec.thumbOpposition) < 1e-6
  );
}

export function normalizeCharacterHandPoses(
  handPose?: CharacterHandPoses | null,
): CharacterHandPoses | undefined {
  if (!handPose) return undefined;
  const out: CharacterHandPoses = {};
  if (handPose.left && !isNeutralHandPose(handPose.left)) out.left = clone(handPose.left);
  if (handPose.right && !isNeutralHandPose(handPose.right)) out.right = clone(handPose.right);
  return out.left || out.right ? out : undefined;
}

export function handPreset(name: HandPresetName): HandPoseSpec {
  switch (name) {
    case 'Relaxed':
      return {
        thumb: 0.22,
        index: 0.20,
        middle: 0.28,
        ring: 0.36,
        pinky: 0.44,
        spread: 0.06,
        thumbOpposition: 0.18,
      };
    case 'Open':
      return {
        thumb: -0.05,
        index: -0.04,
        middle: -0.04,
        ring: -0.04,
        pinky: -0.04,
        spread: 0.12,
        thumbOpposition: -0.25,
      };
    case 'Spread':
      return {
        thumb: -0.18,
        index: -0.12,
        middle: -0.12,
        ring: -0.12,
        pinky: -0.14,
        spread: 1.0,
        thumbOpposition: -0.75,
      };
    case 'Fist':
      return {
        thumb: 0.72,
        index: 0.95,
        middle: 0.98,
        ring: 1.0,
        pinky: 1.0,
        spread: -0.22,
        thumbOpposition: 0.78,
      };
    case 'Thumbs Up':
      return {
        thumb: -0.24,
        index: 0.94,
        middle: 0.98,
        ring: 1,
        pinky: 1,
        spread: 0,
        thumbOpposition: -0.95,
      };
    case 'Point':
      return {
        thumb: 0.65,
        index: 0,
        middle: 0.92,
        ring: 0.96,
        pinky: 0.98,
        spread: -0.12,
        thumbOpposition: 0.65,
      };
    case 'Grip':
      return {
        thumb: 0.58,
        index: 0.66,
        middle: 0.70,
        ring: 0.74,
        pinky: 0.78,
        spread: -0.1,
        thumbOpposition: 0.62,
      };
    case 'Peace':
      return {
        thumb: 0.68,
        index: -0.04,
        middle: -0.04,
        ring: 0.94,
        pinky: 0.98,
        spread: 0.72,
        thumbOpposition: 0.72,
      };
    case 'Pinch':
      return {
        thumb: 0.52,
        index: 0.55,
        middle: 0.28,
        ring: 0.36,
        pinky: 0.44,
        spread: 0.12,
        thumbOpposition: 0.88,
      };
  }
}

export function computeMasterHandCurl(spec?: HandPoseSpec | null): number {
  if (!spec) return 0;
  return (spec.thumb + spec.index + spec.middle + spec.ring + spec.pinky) / 5;
}

export function applyMasterHandCurl(prev: HandPoseSpec | undefined, masterCurl: number): HandPoseSpec {
  const c = Math.max(HAND_CURL_MIN, Math.min(HAND_CURL_MAX, masterCurl));
  const base = prev ? clone(prev) : defaultHandPose();
  return {
    ...base,
    thumb: Math.max(HAND_CURL_MIN, Math.min(HAND_CURL_MAX, c * 0.78)),
    index: c,
    middle: c,
    ring: c,
    pinky: c,
    thumbOpposition: c > 0 ? Math.max(base.thumbOpposition, c * 0.75) : base.thumbOpposition,
  };
}

const MIRROR_JOINT_PAIRS: ReadonlyArray<readonly [Joint, Joint]> = [
  ['leftShoulder', 'rightShoulder'],
  ['leftElbow', 'rightElbow'],
  ['leftWrist', 'rightWrist'],
  ['leftHip', 'rightHip'],
  ['leftKnee', 'rightKnee'],
  ['leftAnkle', 'rightAnkle'],
];
const AXIAL_JOINTS: readonly Joint[] = ['hips', 'spine', 'chest', 'neck', 'head'];

export function mirrorJointVec3(v: Vec3): Vec3 {
  const cleanZero = (n: number) => (Object.is(n, -0) || Math.abs(n) < 1e-12 ? 0 : n);
  return [cleanZero(v[0]), cleanZero(-v[1]), cleanZero(-v[2])];
}

export function mirrorPose(pose: Pose): Pose {
  const out = neutralPose();
  for (const j of AXIAL_JOINTS) {
    out[j] = mirrorJointVec3(pose[j]);
  }
  for (const [l, r] of MIRROR_JOINT_PAIRS) {
    out[l] = mirrorJointVec3(pose[r]);
    out[r] = mirrorJointVec3(pose[l]);
  }
  return out;
}

export function mirrorHandPoses(handPose?: CharacterHandPoses): CharacterHandPoses | undefined {
  if (!handPose) return undefined;
  const out: CharacterHandPoses = {};
  if (handPose.right && !isNeutralHandPose(handPose.right)) out.left = clone(handPose.right);
  if (handPose.left && !isNeutralHandPose(handPose.left)) out.right = clone(handPose.left);
  return out.left || out.right ? out : undefined;
}

export function mirrorCharacterPose(item: Item): Item {
  if (!isBody(item.kind) || !item.pose) return clone(item);
  const next = clone(item);
  next.pose = mirrorPose(item.pose);
  const mirroredHands = mirrorHandPoses(item.handPose);
  if (mirroredHands) next.handPose = mirroredHands;
  else delete next.handPose;
  return next;
}

export const GARMENT_COLORS = { tank: '#83b8ad', jacket: '#425773', trench: '#bc9369', trenchHeld: '#bc9369', skirt: '#5c485a' } as const;
export type Garment = keyof typeof GARMENT_COLORS;
export type GarmentFit = Partial<Record<Garment, Record<string, Vec3>>>;
export const garmentFitLimit = (id: Garment): number =>
  ({tank: .075, jacket: .10, skirt: .12, trench: .16, trenchHeld: .16})[id];
export function isGarmentEquipped(w: Item['wardrobe'], id: Garment): boolean {
  return id === 'tank' || id === 'skirt' ? !!w?.[id] : w?.outer === id;
}
export function setFitOffset(w: NonNullable<Item['wardrobe']>, id: Garment, node: string, offset?: Vec3) {
  const fit = {...w.fit}, layer = {...fit[id]};
  if (offset && Math.hypot(...offset) > 1e-6) layer[node] = offset;
  else delete layer[node];
  if (Object.keys(layer).length) fit[id] = layer;
  else delete fit[id];
  return {...w, fit: Object.keys(fit).length ? fit : undefined, drape: undefined};
}
export const TRENCH_GRIPS = {
  both:{label:'Both hands — matching lapels', bindings:[['left','left'],['right','right']]},
  left:{label:'Left hand — left lapel', bindings:[['left','left']]},
  right:{label:'Right hand — right lapel', bindings:[['right','right']]},
  leftCross:{label:'Left hand — right lapel', bindings:[['left','right']]},
  rightCross:{label:'Right hand — left lapel', bindings:[['right','left']]},
} as const;
export type TrenchGrip = keyof typeof TRENCH_GRIPS;
export function heldTrenchGesture(grip:TrenchGrip='both'): Required<Pick<Item,'pose'|'handPose'>> {
  const pose = neutralPose();
  const handPose: CharacterHandPoses = {};
  pose.leftElbow = pose.rightElbow = [-.12,0,0];
  for(const [hand,edge] of TRENCH_GRIPS[grip].bindings) {
    const s=hand==='left'?1:-1;
    pose[`${hand}Shoulder`]=hand===edge?[.17,-.42*s,.65*s]:[-.91,-1.38*s,-.22*s];
    pose[`${hand}Elbow`]=hand===edge?[-2.36,-.56*s,0]:[-1.86,.12*s,0];
    pose[`${hand}Wrist`]=[.04,-.32*s,.10*s];
    handPose[hand]={thumb:.68,index:.77,middle:.82,ring:.84,pinky:.85,spread:0,thumbOpposition:.82};
  }
  pose.head = [0,.08,0];
  return {pose,handPose};
}
export interface SettledDrape {
  poseKey: string;
  layers: Partial<Record<Garment, { pattern: string; offsets: string }>>;
}
export function clothPoseKey(i: Item): string {
  const w = i.wardrobe, hands = normalizeCharacterHandPoses(i.handPose);
  const hand = (side: HandSide) => {
    const h = hands?.[side];
    return h ? [h.thumb,h.index,h.middle,h.ring,h.pinky,h.spread,h.thumbOpposition] : null;
  };
  // Fixed field order survives portable-scene normalization. Translation does not change gravity.
  const edited = (Object.keys(GARMENT_COLORS) as Garment[]).filter(id => isGarmentEquipped(w,id) && w?.fit?.[id] && Object.keys(w.fit[id]!).length);
  const text = JSON.stringify([i.modelId, i.bodyType ?? DEFAULT_BODY_TYPE, i.anatomicalLimits !== false,
    JOINTS.map(j => i.pose?.[j]), hand('left'), hand('right'),
    i.rotation, i.scale, !!w?.tank, !!w?.skirt, w?.outer ?? null,
    ...(w?.outer==='trenchHeld'?[w.grip??'both']:[]),
    ...edited.map(id => [id,w!.fit![id]])]);
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619);
  return (h >>> 0).toString(16);
}

export interface Item {
  id: string; name: string; kind: Body | PropKind | 'light' | ModelingItemKind; color: string;
  position: Vec3; rotation: Vec3; scale: Vec3; pose?: Pose; handPose?: CharacterHandPoses; outfitColor?: string; hairColor?: string; hairStyle?: HairStyleId;
  dressMapId?: MannequinDressPresetId;
  /** Independent polygon clothing; absent in legacy scenes. */
  wardrobe?: { tank?: true; skirt?: true; outer?: 'jacket' | 'trench' | 'trenchHeld';
    grip?:TrenchGrip; colors?: Partial<Record<Garment, string>>; fit?: GarmentFit; drape?: SettledDrape };
  customDressMapDataUrl?: string;
  intensity?: number; target?: Vec3; targetObjectId?: string; lightType?: LightType; castShadow?: boolean;
  angle?: number; penumbra?: number; distance?: number; decay?: number; shadowExtent?: number;
  modelId?: ModelId; bodyType?: BodyTypeId; anatomicalLimits?: boolean;
  roomId?: RoomId; visible?: boolean; cutaway?: boolean; locked?: boolean;
  roomObjects?: Record<string, RoomObjectOverride>;
  /** Parametric C4D primitive (`kind === 'primitive'`) */
  primitive?: PrimitiveSpec;
  /** Quad/N-gon editable polygon mesh (`kind === 'mesh'`) */
  editableMesh?: EditableMeshData;
  /** Live C4D CSG Boole generator (`kind === 'boole'`) */
  booleanOp?: BooleanOpType;
  booleanEnabled?: boolean;
  operands?: Item[];
  /** Imported 3D asset (`kind === 'imported'`) */
  assetId?: string;
  sourceFormat?: ImportFormat3D;
  fileName?: string;
  embeddedGlbBase64?: string;
  boundsSize?: Vec3;
  vertexCount?: number;
  faceCount?: number;
  /** Non-destructive C4D modifier / deformer stack */
  modifiers?: ModifierSpec[];
  /** Surface shading controls */
  phongAngleDeg?: number;
  roughness?: number;
  metalness?: number;
}
export interface CameraState {
  position: Vec3; target: Vec3; focalLength: number; near: number; far: number;
  aspect: '3:2' | '16:9' | '1:1' | '4:5'; dof: boolean; focus: number; aperture: number; maxBlur: number;
}
export const RENDER_QUALITY_MODES = ['performance', 'balanced', 'ultra'] as const;
export type RenderQualityMode = (typeof RENDER_QUALITY_MODES)[number];
export const RENDER_QUALITY_LABELS: Record<RenderQualityMode, string> = {
  performance: 'Performance',
  balanced: 'Balanced',
  ultra: 'Ultra',
};
export const DEFAULT_RENDER_QUALITY: RenderQualityMode = 'balanced';
export const DEFAULT_GI_ENABLED = true;
export const DEFAULT_GI_INTENSITY = 1.0;
export const DEFAULT_AO_ENABLED = true;
export const DEFAULT_SHADOW_SOFTNESS = 1.0;

export interface SceneState {
  schemaVersion: 1; rigVersion: 1; type: 'scene'; name: string; items: Item[];
  background: string; camera: CameraState; renderStyle?: RenderStyleState;
  sceneLightsOnly?: boolean;
  renderQuality?: RenderQualityMode;
  giEnabled?: boolean;
  giIntensity?: number;
  aoEnabled?: boolean;
  shadowSoftness?: number;
}
export interface PoseFile { schemaVersion: 1; rigVersion: 1; type: 'pose'; name: string; body: Body; pose: Pose; handPose?: CharacterHandPoses }
export type Portable = SceneState | PoseFile;
export const isBody = (kind: string): kind is Body => kind === 'male' || kind === 'female';
export const neutralPose = (): Pose => Object.fromEntries(JOINTS.map(j => [j, [0, 0, 0]])) as Pose;
export const clone = <T>(value: T): T => structuredClone(value);
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (r: number) => {
  const raw = (r * 180) / Math.PI;
  const rounded = Math.round(raw * 1e6) / 1e6;
  const v = Math.abs(raw - rounded) < 1e-9 ? rounded : raw;
  return Object.is(v, -0) ? 0 : v;
};
export const PRESETS = [
  'Neutral',
  'Relaxed',
  'Contrapposto',
  'Heroic',
  'Walking',
  'Running',
  'Seated',
  'Kneeling',
  'Crouch',
  'Reach',
] as const;
export type PresetName = typeof PRESETS[number];

export function preset(name: PresetName): Pose {
  const p = neutralPose();
  const set = (j: Joint, x = 0, y = 0, z = 0) => { p[j] = [x, y, z].map(radians) as Vec3; };
  if (name === 'Relaxed') {
    set('hips', 0, -4, -3);
    set('spine', 2, 2, 2);
    set('chest', -2, 3, 2);
    set('neck', 2, 3, -1);
    set('head', -2, 5, -2);
    set('leftShoulder', 3, 4, 5);
    set('leftElbow', -12, -8, 0);
    set('leftWrist', 0, 0, -4);
    set('rightShoulder', -2, -4, -5);
    set('rightElbow', -10, 8, 0);
    set('rightWrist', 0, 0, 4);
    set('leftHip', -5, 7, 4);
    set('leftKnee', 10, 0, 0);
    set('leftAnkle', 4, 0, -2);
    set('rightHip', 1, -5, 2);
    set('rightKnee', 3, 0, 0);
    set('rightAnkle', -1, 0, -2);
  } else if (name === 'Contrapposto') {
    set('hips', 0, -6, -7);
    set('spine', 1, 4, 5);
    set('chest', -3, 6, 6);
    set('neck', 2, -5, -3);
    set('head', -3, -10, -4);
    set('leftShoulder', 46, -35, 31);
    set('leftElbow', -75, -10, 0);
    set('leftWrist', -12, 0, 0);
    set('rightShoulder', 5, -6, -7);
    set('rightElbow', -14, 8, 0);
    set('rightWrist', 0, 0, 5);
    set('rightHip', 2, -5, 6);
    set('rightKnee', 3, 0, 0);
    set('rightAnkle', -2, 0, 1);
    set('leftHip', -16, 10, 10);
    set('leftKnee', 28, 0, 0);
    set('leftAnkle', 14, 0, -3);
  } else if (name === 'Heroic') {
    set('hips', -2, 0, 0);
    set('spine', -4, 0, 0);
    set('chest', -7, 0, 0);
    set('neck', 4, 0, 0);
    set('head', 3, -8, 0);
    set('leftShoulder', 46, -35, 31);
    set('leftElbow', -75, -10, 0);
    set('leftWrist', -12, 0, 0);
    set('rightShoulder', 46, 35, -31);
    set('rightElbow', -75, 10, 0);
    set('rightWrist', -12, 0, 0);
    set('leftHip', -4, 10, 11);
    set('leftKnee', 6, 0, 0);
    set('leftAnkle', -2, 0, -9);
    set('rightHip', 2, -10, -11);
    set('rightKnee', 5, 0, 0);
    set('rightAnkle', -3, 0, 9);
  } else if (name === 'Walking') {
    set('hips', 2, -8, -3);
    set('spine', 2, 4, 2);
    set('chest', 3, 8, 2);
    set('neck', -2, -3, 0);
    set('head', -2, -3, 0);
    set('leftHip', -24, 3, 2);
    set('leftKnee', 8, 0, 0);
    set('leftAnkle', -10, 0, 0);
    set('rightHip', 20, -3, -2);
    set('rightKnee', 26, 0, 0);
    set('rightAnkle', 16, 0, 0);
    set('rightShoulder', -22, 4, -6);
    set('rightElbow', -24, 8, 0);
    set('leftShoulder', 18, -4, 6);
    set('leftElbow', -18, -6, 0);
  } else if (name === 'Running') {
    set('hips', 12, -14, -4);
    set('spine', 8, 8, 2);
    set('chest', 8, 14, 3);
    set('neck', -10, -4, 0);
    set('head', -12, -4, 0);
    set('leftHip', -58, 4, 3);
    set('leftKnee', 68, 0, 0);
    set('leftAnkle', -12, 0, 0);
    set('rightHip', 32, -4, -3);
    set('rightKnee', 42, 0, 0);
    set('rightAnkle', 24, 0, 0);
    set('rightShoulder', -46, 10, -10);
    set('rightElbow', -88, 10, 0);
    set('leftShoulder', 38, -8, 12);
    set('leftElbow', -82, -8, 0);
  } else if (name === 'Seated') {
    set('hips', -6, 0, 0);
    set('spine', 6, 0, 0);
    set('chest', 4, -3, 0);
    set('neck', -2, 3, 0);
    set('head', -2, 5, -2);
    set('leftHip', -86, 8, 7);
    set('leftKnee', 88, 0, 0);
    set('leftAnkle', 2, 0, -4);
    set('rightHip', -86, -8, -7);
    set('rightKnee', 88, 0, 0);
    set('rightAnkle', 2, 0, 4);
    set('leftShoulder', -18, -22, 10);
    set('leftElbow', -52, -35, 0);
    set('leftWrist', 8, 0, 0);
    set('rightShoulder', -18, 22, -10);
    set('rightElbow', -52, 35, 0);
    set('rightWrist', 8, 0, 0);
  } else if (name === 'Kneeling') {
    set('hips', 8, -5, 0);
    set('spine', 12, 3, 0);
    set('chest', 8, 4, 0);
    set('neck', -12, -3, 0);
    set('head', -10, -4, 0);
    set('leftHip', -112, 8, 6);
    set('leftKnee', 102, 0, 0);
    set('leftAnkle', 2, 0, -4);
    set('rightHip', 4, -4, -3);
    set('rightKnee', 88, 0, 0);
    set('rightAnkle', 56, 0, 0);
    set('leftShoulder', -34, -18, 8);
    set('leftElbow', -42, -24, 0);
    set('leftWrist', 16, 0, 0);
    set('rightShoulder', 12, -8, -10);
    set('rightElbow', -24, 10, 0);
  } else if (name === 'Crouch') {
    set('hips', 20, -8, 0);
    set('spine', 14, 4, 0);
    set('chest', 10, 6, 0);
    set('neck', -18, -2, 0);
    set('head', -18, -4, 0);
    set('leftHip', -78, 14, 14);
    set('leftKnee', 92, 0, 0);
    set('leftAnkle', -34, 0, -10);
    set('rightHip', -68, -14, -14);
    set('rightKnee', 86, 0, 0);
    set('rightAnkle', -38, 0, 10);
    set('leftShoulder', -36, -12, 24);
    set('leftElbow', -68, -15, 0);
    set('rightShoulder', -22, 12, -26);
    set('rightElbow', -58, 15, 0);
  } else if (name === 'Reach') {
    set('hips', -2, -8, -4);
    set('spine', -4, 6, 4);
    set('chest', -6, 10, 6);
    set('neck', -8, 8, -4);
    set('head', -14, 10, -4);
    set('leftShoulder', -126, 12, 26);
    set('leftElbow', -14, -10, 0);
    set('leftWrist', -8, 0, 0);
    set('rightShoulder', 18, -10, -18);
    set('rightElbow', -22, 8, 0);
    set('leftHip', -8, 6, 5);
    set('leftKnee', 8, 0, 0);
    set('leftAnkle', 0, 0, -3);
    set('rightHip', 6, -6, 3);
    set('rightKnee', 10, 0, 0);
    set('rightAnkle', 6, 0, 2);
  }
  return p;
}
export function createItem(kind: Item['kind'], index = 0, bodyType: BodyTypeId = DEFAULT_BODY_TYPE): Item {
  const body = isBody(kind);
  return {
    id: crypto.randomUUID(), name: `${kind[0].toUpperCase()}${kind.slice(1)} ${index + 1}`, kind,
    color: body ? defaultSkinColor(kind) : kind === 'light' ? '#fff1db' : '#a59987',
    position: [index * 0.6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    ...(body
      ? {
          pose: neutralPose(),
          modelId: defaultModelId(kind),
          bodyType,
          anatomicalLimits: true,
          outfitColor: defaultOutfitColor(kind),
          hairColor: DEFAULT_HAIR_COLOR,
          hairStyle: (kind === 'female' ? 'long' : 'parted') as HairStyleId,
        }
      : {}),
    ...(kind === 'light'
      ? {
          position: [3, 5, 3] as Vec3,
          target: [0, 1, 0] as Vec3,
          intensity: LIGHT_DEFAULTS.intensity,
          lightType: LIGHT_DEFAULTS.lightType,
          castShadow: LIGHT_DEFAULTS.castShadow,
          angle: LIGHT_DEFAULTS.angle,
          penumbra: LIGHT_DEFAULTS.penumbra,
          distance: LIGHT_DEFAULTS.distance,
          decay: LIGHT_DEFAULTS.decay,
          shadowExtent: LIGHT_DEFAULTS.shadowExtent,
        }
      : {}),
    ...(kind === 'primitive'
      ? (() => {
          const primitive = createDefaultPrimitiveSpec('cube');
          return {
            name: `Cube ${index + 1}`,
            color: '#c4beb4',
            position: [index * 0.5, getPrimitiveGroundY(primitive), 0] as Vec3,
            primitive,
            phongAngleDeg: 40,
            roughness: 0.65,
            metalness: 0.08,
          };
        })()
      : {}),
    ...(kind === 'boole'
      ? {
          name: `Boole ${index + 1}`,
          color: '#c4beb4',
          position: [0, 0.5, 0] as Vec3,
          booleanOp: 'subtract' as BooleanOpType,
          booleanEnabled: true,
          operands: [],
          phongAngleDeg: 40,
          roughness: 0.65,
          metalness: 0.08,
        }
      : {}),
  };
}

export function createPrimitiveItem(primKind: PrimitiveKind, index = 0): Item {
  const primitive = createDefaultPrimitiveSpec(primKind) as PrimitiveSpec;
  const label = PRIMITIVE_LABELS[primKind];
  return {
    id: crypto.randomUUID(),
    name: `${label} ${index + 1}`,
    kind: 'primitive',
    color: '#c4beb4',
    position: [index * 0.45, getPrimitiveGroundY(primitive), 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    primitive,
    phongAngleDeg: 40,
    roughness: 0.65,
    metalness: 0.08,
  };
}

export function canAttachModifiers(item: Pick<Item, 'kind'> | null | undefined): boolean {
  if (!item) return false;
  if (isModelingKind(item.kind)) return true;
  return (PROP_KINDS as readonly string[]).includes(item.kind) && item.kind !== 'room';
}

export function canBeBooleOperand(item: Pick<Item, 'kind'> | null | undefined): boolean {
  return canAttachModifiers(item);
}

export function canMakeEditable(item: Pick<Item, 'kind'> | null | undefined): boolean {
  return canAttachModifiers(item);
}

function itemMatrix4(item: Pick<Item, 'position' | 'rotation' | 'scale'>): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...item.position),
    new Quaternion().setFromEuler(new Euler(...item.rotation)),
    new Vector3(...item.scale),
  );
}

function decomposeMatrixToItemTransform(mat: Matrix4): Pick<Item, 'position' | 'rotation' | 'scale'> {
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  mat.decompose(pos, quat, scl);
  const eul = new Euler().setFromQuaternion(quat);
  return {
    position: [pos.x, pos.y, pos.z],
    rotation: [eul.x, eul.y, eul.z],
    scale: [scl.x, scl.y, scl.z],
  };
}

/**
 * Wraps 0, 1, or 2+ selected scene items into a live C4D `Boole` generator while preserving exact world transforms.
 */
export function groupItemsIntoBoole(
  items: readonly Item[],
  selectedIds: readonly string[],
  op: BooleanOpType = 'subtract',
  existingBooleCount = 0,
): { items: Item[]; booleItem: Item } {
  const selectedSet = new Set(selectedIds);
  const chosen: Item[] = [];
  for (const id of selectedIds) {
    const found = items.find(i => i.id === id && canBeBooleOperand(i));
    if (found && !chosen.some(c => c.id === found.id)) {
      chosen.push(clone(found));
    }
  }

  const anchorPos: Vec3 = chosen.length > 0 ? [...chosen[0].position] : [0, 0.5, 0];
  const booleWorld = new Matrix4().makeTranslation(anchorPos[0], anchorPos[1], anchorPos[2]);
  const booleWorldInv = booleWorld.clone().invert();

  const operands: Item[] = chosen.map(opItem => {
    const localMat = booleWorldInv.clone().multiply(itemMatrix4(opItem));
    const localTf = decomposeMatrixToItemTransform(localMat);
    return {
      ...opItem,
      ...localTf,
    };
  });

  const booleItem: Item = {
    id: crypto.randomUUID(),
    name: `Boole ${existingBooleCount + 1}`,
    kind: 'boole',
    color: chosen[0]?.color ?? '#c4beb4',
    position: anchorPos,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    locked: false,
    booleanOp: op,
    booleanEnabled: true,
    operands,
    phongAngleDeg: chosen[0]?.phongAngleDeg ?? 40,
    roughness: chosen[0]?.roughness ?? 0.65,
    metalness: chosen[0]?.metalness ?? 0.08,
  };

  const chosenIds = new Set(chosen.map(c => c.id));
  const nextItems: Item[] = [];
  let inserted = false;
  for (const item of items) {
    if (chosenIds.has(item.id)) {
      if (!inserted) {
        nextItems.push(booleItem);
        inserted = true;
      }
      continue;
    }
    nextItems.push(clone(item));
  }
  if (!inserted) {
    nextItems.push(booleItem);
    // suppress unused var lint
    void selectedSet;
  }

  return { items: nextItems, booleItem };
}

/**
 * Moves a top-level scene item into `booleId`'s operands list, preserving its world transform.
 */
export function addOperandToBoole(
  items: readonly Item[],
  booleId: string,
  operandItemId: string,
): Item[] {
  if (booleId === operandItemId) return clone(items as Item[]);
  const boole = items.find(i => i.id === booleId && i.kind === 'boole');
  const operand = items.find(i => i.id === operandItemId && canBeBooleOperand(i));
  if (!boole || !operand) return clone(items as Item[]);

  const booleWorldInv = itemMatrix4(boole).invert();
  const localTf = decomposeMatrixToItemTransform(booleWorldInv.multiply(itemMatrix4(operand)));
  const childOperand: Item = {
    ...clone(operand),
    ...localTf,
  };

  return items
    .filter(i => i.id !== operandItemId)
    .map(i =>
      i.id === booleId
        ? {
            ...clone(i),
            operands: [...clone(i.operands ?? []), childOperand],
          }
        : clone(i),
    );
}

/**
 * Swaps the first two operands (`Operand A <-> Operand B`) inside a `Boole` item.
 */
export function swapBooleOperands(booleItem: Item): Item {
  const next = clone(booleItem);
  if (!next.operands || next.operands.length < 2) return next;
  const [a, b, ...rest] = next.operands;
  next.operands = [b, a, ...rest];
  return next;
}

/**
 * Ungroups a `Boole` item back into top-level scene items at their exact world transforms.
 */
export function extractBooleOperands(
  items: readonly Item[],
  booleId: string,
): { items: Item[]; extractedIds: string[] } {
  const boole = items.find(i => i.id === booleId && i.kind === 'boole');
  if (!boole) return { items: clone(items as Item[]), extractedIds: [] };

  const booleWorld = itemMatrix4(boole);
  const extracted = (boole.operands ?? []).map(op => {
    const worldMat = booleWorld.clone().multiply(itemMatrix4(op));
    const worldTf = decomposeMatrixToItemTransform(worldMat);
    return {
      ...clone(op),
      ...worldTf,
    };
  });
  const extractedIds = extracted.map(e => e.id);

  const nextItems: Item[] = [];
  for (const item of items) {
    if (item.id === booleId) {
      nextItems.push(...extracted);
    } else {
      nextItems.push(clone(item));
    }
  }
  return { items: nextItems, extractedIds };
}

export function findItemOrOperand(
  items: readonly Item[],
  id: string | null | undefined,
): { item: Item; parentBoole: Item | null; operandIndex: number } | null {
  if (!id) return null;
  for (const item of items) {
    if (item.id === id) return { item, parentBoole: null, operandIndex: -1 };
    if (item.kind === 'boole' && item.operands) {
      const idx = item.operands.findIndex(op => op.id === id);
      if (idx !== -1) {
        return { item: item.operands[idx], parentBoole: item, operandIndex: idx };
      }
    }
  }
  return null;
}

export function updateItemOrOperand(
  items: Item[],
  id: string,
  updater: (target: Item) => void,
): boolean {
  for (const item of items) {
    if (item.id === id) {
      updater(item);
      return true;
    }
    if (item.kind === 'boole' && item.operands) {
      const child = item.operands.find(op => op.id === id);
      if (child) {
        updater(child);
        return true;
      }
    }
  }
  return false;
}
export function switchLightType(item: Item, nextType: LightType): Partial<Item> {
  const prevType = item.lightType ?? LIGHT_DEFAULTS.lightType;
  let intensity = item.intensity ?? (prevType === 'directional' ? LIGHT_DEFAULTS.directionalIntensity : LIGHT_DEFAULTS.intensity);
  if (prevType !== 'directional' && nextType === 'directional' && intensity > 10) {
    intensity = Math.min(20, Math.max(0.5, Number((intensity / 10).toFixed(1))));
  } else if (prevType === 'directional' && nextType !== 'directional' && intensity <= 10) {
    intensity = Math.min(200, Math.round(intensity * 10));
  }
  return {
    lightType: nextType,
    intensity,
    castShadow: item.castShadow ?? LIGHT_DEFAULTS.castShadow,
    target: item.target ?? [0, 1, 0],
    ...(item.targetObjectId ? { targetObjectId: item.targetObjectId } : {}),
    angle: item.angle ?? LIGHT_DEFAULTS.angle,
    penumbra: item.penumbra ?? LIGHT_DEFAULTS.penumbra,
    distance: item.distance ?? LIGHT_DEFAULTS.distance,
    decay: item.decay ?? LIGHT_DEFAULTS.decay,
    shadowExtent: item.shadowExtent ?? LIGHT_DEFAULTS.shadowExtent,
  };
}

export type ParsedTargetObjectRef =
  | { kind: 'item'; itemId: string }
  | { kind: 'room-object'; roomId: string; objectId: string };

export function isTargetedLight(item: Pick<Item, 'kind' | 'lightType'> | null | undefined): boolean {
  if (!item || item.kind !== 'light') return false;
  const lt = item.lightType ?? LIGHT_DEFAULTS.lightType;
  return lt === 'spot' || lt === 'directional';
}

export function resolveLightPartForItem(
  item: Pick<Item, 'kind' | 'lightType'> | null | undefined,
  part: LightPart,
): LightPart {
  return isTargetedLight(item) && part === 'target' ? 'target' : 'source';
}

export function resolveLightActiveVector(item: Item, part: LightPart): Vec3 {
  return resolveLightPartForItem(item, part) === 'target'
    ? clone(item.target ?? ([0, 1, 0] as Vec3))
    : clone(item.position);
}

export function applyLightPartPosition(item: Item, part: LightPart, nextPosition: Vec3): Partial<Item> {
  if (resolveLightPartForItem(item, part) === 'target') {
    if (item.targetObjectId) return {};
    return { target: clone(nextPosition) };
  }
  return { position: clone(nextPosition) };
}

export function formatRoomObjectTargetRef(roomId: string, objectId: string): string {
  return `room:${encodeURIComponent(roomId)}:${objectId}`;
}

export function parseTargetObjectRef(ref: string | null | undefined): ParsedTargetObjectRef | null {
  if (!ref || typeof ref !== 'string') return null;
  if (ref.startsWith('room:')) {
    const sep = ref.indexOf(':', 5);
    if (sep <= 5 || sep >= ref.length - 1) return null;
    try {
      const roomId = decodeURIComponent(ref.slice(5, sep));
      const objectId = ref.slice(sep + 1);
      if (!roomId || !objectId) return null;
      return { kind: 'room-object', roomId, objectId };
    } catch {
      return null;
    }
  }
  return { kind: 'item', itemId: ref };
}

export function computeRoomObjectWorldPosition(roomItem: Item, basePosition: Vec3, objectId: string): Vec3 {
  const ov = roomItem.roomObjects?.[objectId];
  const offset = ov?.position ?? [0, 0, 0];
  const local = new Vector3(
    basePosition[0] + offset[0],
    basePosition[1] + offset[1],
    basePosition[2] + offset[2],
  );
  const roomMatrix = new Matrix4().compose(
    new Vector3(...roomItem.position),
    new Quaternion().setFromEuler(new Euler(...roomItem.rotation)),
    new Vector3(...roomItem.scale),
  );
  return local.applyMatrix4(roomMatrix).toArray() as Vec3;
}

function clampTargetCoordinate(coord: Vec3): Vec3 {
  return coord.map(n => Math.max(-100, Math.min(100, n))) as Vec3;
}

export function syncLinkedLightTargets(
  items: Item[],
  resolveRoomObjectBasePos?: (roomId: string, objectId: string) => Vec3 | null,
): void {
  for (const light of items) {
    if (light.kind !== 'light' || light.targetObjectId === undefined) continue;
    const parsed = parseTargetObjectRef(light.targetObjectId);
    if (!parsed) {
      delete light.targetObjectId;
      continue;
    }
    if (parsed.kind === 'item') {
      if (parsed.itemId === light.id) {
        delete light.targetObjectId;
        continue;
      }
      const targetItem = items.find(i => i.id === parsed.itemId);
      if (!targetItem) {
        delete light.targetObjectId;
        continue;
      }
      if (isTargetedLight(light)) {
        light.target = clampTargetCoordinate(targetItem.position);
      }
    } else {
      const roomItem = items.find(i => i.id === parsed.roomId && Boolean(i.roomId));
      if (!roomItem || roomItem.roomObjects?.[parsed.objectId]?.deleted) {
        delete light.targetObjectId;
        continue;
      }
      if (isTargetedLight(light) && resolveRoomObjectBasePos) {
        const basePos = resolveRoomObjectBasePos(parsed.roomId, parsed.objectId);
        if (basePos) {
          light.target = clampTargetCoordinate(computeRoomObjectWorldPosition(roomItem, basePos, parsed.objectId));
        }
      }
    }
  }
}

export function linkLightTarget(
  items: Item[],
  lightId: string,
  targetObjectId: string | null | undefined,
  resolveRoomObjectBasePos?: (roomId: string, objectId: string) => Vec3 | null,
): void {
  const light = items.find(i => i.id === lightId && i.kind === 'light');
  if (!light) return;
  if (!targetObjectId) {
    delete light.targetObjectId;
    return;
  }
  if (targetObjectId === light.id) {
    throw new Error('A light cannot link its target to itself.');
  }
  light.targetObjectId = targetObjectId;
  syncLinkedLightTargets(items, resolveRoomObjectBasePos);
}
export function swapItemBodyKind(item: Item, nextKind: Body, anchoredY?: number, modelId = defaultModelId(nextKind)): Item {
  if (!isBody(item.kind)) {
    throw new Error('Only character figures can swap base figure kind.');
  }
  const prevKind = item.kind;
  const preservedOutfitColor = item.outfitColor ?? defaultCharacterOutfitColor(prevKind, item.modelId);
  const preservedHairStyle: HairStyleId = item.hairStyle ?? (prevKind === 'female' ? 'long' : 'parted');
  const preservedHairColor = item.hairColor ?? DEFAULT_HAIR_COLOR;
  const preservedBodyType = item.bodyType ?? DEFAULT_BODY_TYPE;
  const preservedLimits = item.anatomicalLimits ?? true;
  const preservedPose = item.pose ? clone(item.pose) : neutralPose();
  return {
    ...clone(item),
    kind: nextKind,
    modelId,
    position: [item.position[0], anchoredY ?? item.position[1], item.position[2]],
    pose: preservedPose,
    bodyType: preservedBodyType,
    outfitColor: preservedOutfitColor,
    hairStyle: preservedHairStyle,
    hairColor: preservedHairColor,
    anatomicalLimits: preservedLimits,
  };
}
const LEGACY_SYNTHETIC_SKIN_HEX = new Set([
  DEFAULT_MALE_SKIN_COLOR.toLowerCase(),
  DEFAULT_FEMALE_SKIN_COLOR.toLowerCase(),
]);
const LEGACY_SYNTHETIC_OUTFIT_HEX = new Set([
  DEFAULT_MALE_OUTFIT_COLOR.toLowerCase(),
  DEFAULT_FEMALE_OUTFIT_COLOR.toLowerCase(),
]);
const LEGACY_SYNTHETIC_HAIR_HEX = new Set([
  DEFAULT_HAIR_COLOR.toLowerCase(),
  '#888783',
  '#bd718a',
  '#271b16',
]);

export function applyCharacterModelColorTransition(
  item: Item,
  prevModelId: ModelId,
  nextModelId: ModelId,
): void {
  if (!isBody(item.kind)) return;
  const nextKind = CHARACTERS[nextModelId].body;
  if (nextModelId !== 'mannequin-female') delete item.wardrobe;
  const prevExternal = isExternalCharacter(prevModelId);
  const nextExternal = isExternalCharacter(nextModelId);
  const prevOutfitSlot = hasCharacterOutfitSlot(prevModelId);
  const nextOutfitSlot = hasCharacterOutfitSlot(nextModelId);
  const prevAuthHair = hasAuthoredHair(prevModelId);
  const nextAuthHair = hasAuthoredHair(nextModelId);

  if (nextExternal) {
    delete item.dressMapId;
    delete item.customDressMapDataUrl;
    if (!prevExternal || LEGACY_SYNTHETIC_SKIN_HEX.has(item.color.toLowerCase())) {
      item.color = '#ffffff';
    }
  } else if (prevExternal && item.color.toLowerCase() === '#ffffff') {
    item.color = defaultSkinColor(nextKind);
  }

  if (!nextOutfitSlot) {
    item.outfitColor = '#ffffff';
  } else if (nextExternal) {
    if (
      !prevExternal ||
      !prevOutfitSlot ||
      LEGACY_SYNTHETIC_OUTFIT_HEX.has((item.outfitColor ?? '').toLowerCase())
    ) {
      item.outfitColor = '#ffffff';
    }
  } else if ((prevExternal || !prevOutfitSlot) && (item.outfitColor ?? '').toLowerCase() === '#ffffff') {
    item.outfitColor = defaultOutfitColor(nextKind);
  }

  if (nextAuthHair) {
    if (!prevAuthHair || LEGACY_SYNTHETIC_HAIR_HEX.has((item.hairColor ?? '').toLowerCase())) {
      item.hairColor = '#ffffff';
    }
  } else if (prevAuthHair && (item.hairColor ?? '').toLowerCase() === '#ffffff') {
    item.hairColor = DEFAULT_HAIR_COLOR;
  }

  const prevDefaultHairStyle = CHARACTERS[prevModelId].source?.defaultHairStyle;
  const nextDefaultHairStyle = CHARACTERS[nextModelId].source?.defaultHairStyle;
  if (!nextAuthHair) {
    if (nextDefaultHairStyle) {
      item.hairStyle = nextDefaultHairStyle;
    } else if (prevDefaultHairStyle && item.hairStyle === prevDefaultHairStyle) {
      item.hairStyle = defaultCharacterHairStyle(nextKind, nextModelId);
    }
  }
}

export function sanitizeWorkingDraftCharacterColors(scene: SceneState): SceneState {
  for (const item of scene.items) {
    if (!isBody(item.kind)) continue;
    const modelId = item.modelId ?? defaultModelId(item.kind);
    if (!isExternalCharacter(modelId)) continue;
    if (LEGACY_SYNTHETIC_SKIN_HEX.has(item.color.toLowerCase())) {
      item.color = '#ffffff';
    }
    if (!hasCharacterOutfitSlot(modelId)) {
      item.outfitColor = '#ffffff';
    } else if (LEGACY_SYNTHETIC_OUTFIT_HEX.has((item.outfitColor ?? '').toLowerCase())) {
      item.outfitColor = '#ffffff';
    }
    if (hasAuthoredHair(modelId) && LEGACY_SYNTHETIC_HAIR_HEX.has((item.hairColor ?? '').toLowerCase())) {
      item.hairColor = '#ffffff';
    }
  }
  return scene;
}

export function initialScene(): SceneState {
  const male = createItem('male'); male.position = [-0.5, -0.013, 0]; male.pose = preset('Contrapposto');
  const female = createItem('female'); female.position = [0.55, -0.005, 0.05]; female.pose = preset('Relaxed'); female.rotation[1] = -0.15;
  return {
    schemaVersion: 1, rigVersion: 1, type: 'scene', name: 'Untitled study',
    items: [male, female, createItem('light')], background: '#343231', renderStyle: { ...DEFAULT_RENDER_STYLE },
    sceneLightsOnly: false,
    renderQuality: DEFAULT_RENDER_QUALITY,
    giEnabled: DEFAULT_GI_ENABLED,
    giIntensity: DEFAULT_GI_INTENSITY,
    aoEnabled: DEFAULT_AO_ENABLED,
    shadowSoftness: DEFAULT_SHADOW_SOFTNESS,
    camera: { position: [3.4, 2.3, 5.7], target: [0, 1, 0], focalLength: 50, near: 0.05, far: 100, aspect: '3:2', dof: false, focus: 6.7, aperture: 0.0015, maxBlur: 0.012 },
  };
}
export const createDefaultScene = initialScene;

/**
 * Chibi uses anime proportions and large anime eyes that require cel-shading + ink
 * outlines (`illustration`) by default when the scene is still in default `realistic` PBR mode.
 */
export function applyChibiDefaultRenderStyle(scene: SceneState, bodyType?: BodyTypeId): void {
  if (bodyType !== 'chibi') return;
  const currentMode = scene.renderStyle?.mode ?? DEFAULT_RENDER_STYLE.mode;
  if (currentMode === 'realistic') {
    scene.renderStyle = { ...DEFAULT_RENDER_STYLE, ...scene.renderStyle, mode: 'illustration' };
  }
}

const fail = (message: string): never => { throw new Error(`Invalid file: ${message}`); };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('expected an object');
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 80): string => typeof v === 'string' && v.length > 0 && v.length <= max ? v : fail('invalid or too-long text');
const num = (v: unknown, lo: number, hi: number): number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(`number must be finite and between ${lo} and ${hi}`);
const vec = (v: unknown, lo = -100, hi = 100): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3) return fail('expected three coordinates');
  return v.map(n => num(n, lo, hi)) as Vec3;
};
const color = (v: unknown): string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v : fail('expected #rrggbb color');
const enumValue = <T extends string>(v: unknown, values: readonly T[]): T => typeof v === 'string' && values.includes(v as T) ? v as T : fail('unknown kind or option');
export function validateHandPoseSpec(value: unknown): HandPoseSpec {
  const h = obj(value);
  return {
    thumb: h.thumb === undefined ? 0 : num(h.thumb, -1, 1.5),
    index: h.index === undefined ? 0 : num(h.index, -1, 1.5),
    middle: h.middle === undefined ? 0 : num(h.middle, -1, 1.5),
    ring: h.ring === undefined ? 0 : num(h.ring, -1, 1.5),
    pinky: h.pinky === undefined ? 0 : num(h.pinky, -1, 1.5),
    spread: h.spread === undefined ? 0 : num(h.spread, -1.5, 1.5),
    thumbOpposition: h.thumbOpposition === undefined ? 0 : num(h.thumbOpposition, -1.5, 1.5),
  };
}
export function validateCharacterHandPoses(value: unknown): CharacterHandPoses | undefined {
  if (value === undefined) return undefined;
  const hp = obj(value);
  const out: CharacterHandPoses = {};
  if (hp.left !== undefined) out.left = validateHandPoseSpec(hp.left);
  if (hp.right !== undefined) out.right = validateHandPoseSpec(hp.right);
  return normalizeCharacterHandPoses(out);
}
export function validatePose(value: unknown): Pose {
  const p = obj(value);
  if (Object.keys(p).length !== JOINTS.length) fail('pose must contain every semantic joint exactly once');
  return Object.fromEntries(JOINTS.map(j => [j, vec(p[j], -Math.PI * 2, Math.PI * 2)])) as Pose;
}
const boolVal = (v: unknown, label: string): boolean =>
  typeof v === 'boolean' ? v : fail(`${label} must be boolean`);

function validatePrimitiveSpec(raw: unknown): PrimitiveSpec {
  const r = obj(raw);
  const kind = enumValue(r.kind, PRIMITIVE_KINDS);
  const p = obj(r.params);
  const def = createDefaultPrimitiveSpec(kind).params as unknown as Record<string, unknown>;
  const n = (k: string, lo: number, hi: number) =>
    p[k] === undefined ? (def[k] as number) : num(p[k], lo, hi);
  const b = (k: string) =>
    p[k] === undefined ? Boolean(def[k]) : boolVal(p[k], k);

  switch (kind) {
    case 'cube':
      return {
        kind,
        params: {
          width: n('width', 0.02, 50),
          height: n('height', 0.02, 50),
          depth: n('depth', 0.02, 50),
          segX: Math.round(n('segX', 1, 64)),
          segY: Math.round(n('segY', 1, 64)),
          segZ: Math.round(n('segZ', 1, 64)),
          fillet: b('fillet'),
          filletRadius: n('filletRadius', 0, 25),
          filletSubdivisions: Math.round(n('filletSubdivisions', 1, 16)),
        },
      };
    case 'sphere':
      return {
        kind,
        params: {
          radius: n('radius', 0.02, 50),
          widthSegments: Math.round(n('widthSegments', 4, 128)),
          heightSegments: Math.round(n('heightSegments', 3, 128)),
          hemisphere: b('hemisphere'),
          sliceDeg: n('sliceDeg', 10, 360),
        },
      };
    case 'cylinder':
      return {
        kind,
        params: {
          radiusTop: n('radiusTop', 0, 50),
          radiusBottom: n('radiusBottom', 0, 50),
          height: n('height', 0.02, 50),
          radialSegments: Math.round(n('radialSegments', 3, 128)),
          heightSegments: Math.round(n('heightSegments', 1, 64)),
          fillet: b('fillet'),
          filletRadius: n('filletRadius', 0, 25),
          filletSubdivisions: Math.round(n('filletSubdivisions', 1, 16)),
        },
      };
    case 'cone':
      return {
        kind,
        params: {
          radiusBottom: n('radiusBottom', 0.01, 50),
          radiusTop: n('radiusTop', 0, 50),
          height: n('height', 0.02, 50),
          radialSegments: Math.round(n('radialSegments', 3, 128)),
          heightSegments: Math.round(n('heightSegments', 1, 64)),
          fillet: b('fillet'),
          filletRadius: n('filletRadius', 0, 25),
          filletSubdivisions: Math.round(n('filletSubdivisions', 1, 16)),
        },
      };
    case 'pyramid':
      return {
        kind,
        params: {
          width: n('width', 0.02, 50),
          height: n('height', 0.02, 50),
          depth: n('depth', 0.02, 50),
          segments: Math.round(n('segments', 1, 64)),
          fillet: b('fillet'),
          filletRadius: n('filletRadius', 0, 25),
          filletSubdivisions: Math.round(n('filletSubdivisions', 1, 16)),
        },
      };
    case 'torus':
      return {
        kind,
        params: {
          radius: n('radius', 0.02, 50),
          tube: n('tube', 0.005, 25),
          radialSegments: Math.round(n('radialSegments', 3, 128)),
          tubularSegments: Math.round(n('tubularSegments', 3, 128)),
          arcDeg: n('arcDeg', 10, 360),
        },
      };
    case 'capsule':
      return {
        kind,
        params: {
          radius: n('radius', 0.02, 50),
          height: n('height', 0.04, 50),
          radialSegments: Math.round(n('radialSegments', 4, 128)),
          capSegments: Math.round(n('capSegments', 1, 32)),
        },
      };
    case 'tube':
      return {
        kind,
        params: {
          innerRadius: n('innerRadius', 0.005, 49),
          outerRadius: n('outerRadius', 0.02, 50),
          height: n('height', 0.02, 50),
          radialSegments: Math.round(n('radialSegments', 3, 128)),
          heightSegments: Math.round(n('heightSegments', 1, 64)),
          fillet: b('fillet'),
          filletRadius: n('filletRadius', 0, 25),
          filletSubdivisions: Math.round(n('filletSubdivisions', 1, 16)),
        },
      };
    case 'plane':
      return {
        kind,
        params: {
          width: n('width', 0.02, 100),
          depth: n('depth', 0.02, 100),
          segX: Math.round(n('segX', 1, 128)),
          segZ: Math.round(n('segZ', 1, 128)),
        },
      };
    case 'disc':
      return {
        kind,
        params: {
          innerRadius: n('innerRadius', 0, 50),
          outerRadius: n('outerRadius', 0.02, 50),
          radialSegments: Math.round(n('radialSegments', 3, 128)),
          ringSegments: Math.round(n('ringSegments', 1, 64)),
        },
      };
    case 'platonic':
      return {
        kind,
        params: {
          polyhedron: p.polyhedron === undefined ? 'dodecahedron' : enumValue(p.polyhedron, PLATONIC_TYPES),
          radius: n('radius', 0.02, 50),
          subdivisions: Math.round(n('subdivisions', 0, 4)),
          fillet: b('fillet'),
          filletRadius: n('filletRadius', 0, 25),
          filletSubdivisions: Math.round(n('filletSubdivisions', 1, 16)),
        },
      };
  }
}

function validateModifierSpec(raw: unknown): ModifierSpec {
  const m = obj(raw);
  const type = enumValue(m.type, MODIFIER_TYPES);
  const id = text(m.id, 80);
  const name = text(m.name, 80);
  const enabled = m.enabled === undefined ? true : boolVal(m.enabled, 'modifier enabled');
  const p = obj(m.params ?? {});
  const def = createDefaultModifierSpec(type).params as unknown as Record<string, unknown>;
  const n = (k: string, lo: number, hi: number) =>
    p[k] === undefined ? (def[k] as number) : num(p[k], lo, hi);
  const axis = (k: string): AxisId =>
    p[k] === undefined ? (def[k] as AxisId) : enumValue(p[k], ['x', 'y', 'z'] as const);

  switch (type) {
    case 'bevel':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          width: n('width', 0.0005, 10),
          segments: Math.round(n('segments', 1, 12)),
          angleThresholdDeg: n('angleThresholdDeg', 0, 180),
          ...(p.profile !== undefined ? { profile: n('profile', 0, 1) } : {}),
        },
      };
    case 'subdivision': {
      const lv = Math.round(n('levels', 1, 3)) as 1 | 2 | 3;
      return {
        id,
        type,
        name,
        enabled,
        params: {
          levels: lv,
          smooth: p.smooth === undefined ? true : boolVal(p.smooth, 'subdivision smooth'),
        },
      };
    }
    case 'mirror':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          axis: axis('axis'),
          offset: n('offset', -50, 50),
          bisect: p.bisect === undefined ? true : boolVal(p.bisect, 'mirror bisect'),
          mergeThreshold: n('mergeThreshold', 0, 1),
        },
      };
    case 'solidify':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          thickness: n('thickness', -10, 10),
          evenThickness: p.evenThickness === undefined ? true : boolVal(p.evenThickness, 'evenThickness'),
        },
      };
    case 'bend':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          angleDeg: n('angleDeg', -720, 720),
          axis: axis('axis'),
          directionDeg: n('directionDeg', -360, 360),
        },
      };
    case 'twist':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          angleDeg: n('angleDeg', -1440, 1440),
          axis: axis('axis'),
        },
      };
    case 'taper':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          strength: n('strength', -5, 5),
          axis: axis('axis'),
          curvature: n('curvature', -5, 5),
        },
      };
    case 'array':
      return {
        id,
        type,
        name,
        enabled,
        params: {
          mode: p.mode === undefined ? 'linear' : enumValue(p.mode, ['linear', 'radial'] as const),
          count: Math.round(n('count', 1, 32)),
          offset: p.offset === undefined ? [0.8, 0, 0] : vec(p.offset, -50, 50),
          radius: n('radius', 0, 50),
          stepRotationDeg: p.stepRotationDeg === undefined ? [0, 0, 0] : vec(p.stepRotationDeg, -360, 360),
        },
      };
  }
}

function validateEditableMeshData(raw: unknown): EditableMeshData {
  const m = obj(raw);
  if (!Array.isArray(m.vertices) || m.vertices.length > 80_000) {
    fail('editableMesh vertices must be an array of at most 80000 points');
  }
  if (!Array.isArray(m.faces) || m.faces.length > 100_000) {
    fail('editableMesh faces must be an array of at most 100000 faces');
  }
  const rawVertices = m.vertices as unknown[];
  const rawFaces = m.faces as unknown[];
  const vCount = rawVertices.length;
  const vertices: Vec3[] = rawVertices.map((v: unknown) => vec(v, -500, 500));
  const faces = rawFaces.map((rawFace: unknown) => {
    const f = obj(rawFace);
    if (!Array.isArray(f.verts) || f.verts.length < 3 || f.verts.length > 64) {
      fail('face must have 3 to 64 vertex indices');
    }
    const rawVerts = f.verts as unknown[];
    const verts: number[] = rawVerts.map((vi: unknown): number => {
      if (typeof vi !== 'number' || !Number.isInteger(vi) || vi < 0 || vi >= vCount) {
        fail('face vertex index out of bounds');
      }
      return vi as number;
    });
    const out: EditableMeshData['faces'][number] = { verts };
    if (f.materialIndex !== undefined) {
      out.materialIndex = Math.round(num(f.materialIndex, 0, 64));
    }
    if (f.uvs !== undefined) {
      if (!Array.isArray(f.uvs) || f.uvs.length !== verts.length) {
        fail('face uvs length must match verts length');
      }
      const rawUvs = f.uvs as unknown[];
      out.uvs = rawUvs.map((uv: unknown) => {
        if (!Array.isArray(uv) || uv.length !== 2) fail('expected [u,v] pair');
        const pair = uv as unknown[];
        return [num(pair[0], -100, 100), num(pair[1], -100, 100)] as [number, number];
      });
    }
    return out;
  });
  return {
    vertices,
    faces,
    ...(m.phongAngleDeg !== undefined ? { phongAngleDeg: num(m.phongAngleDeg, 0, 180) } : {}),
  };
}

function validateSceneItem(raw: unknown, ids: Set<string>, depth = 0): Item {
  if (depth > 3) fail('nested boole depth exceeds maximum (3)');
  const i = obj(raw);
  const id = text(i.id);
  if (ids.has(id)) fail('duplicate item ID');
  ids.add(id);
  const kind = enumValue(i.kind, ['male', 'female', ...PROP_KINDS, 'light', ...MODELING_KINDS]);
  const scale = vec(i.scale, -10, 10);
  if (scale.some(n => Math.abs(n) < 0.05)) fail('scale magnitude must be at least 0.05');
  const item: Item = {
    id,
    kind,
    name: text(i.name),
    color: color(i.color),
    position: vec(i.position),
    rotation: vec(i.rotation, -Math.PI * 2, Math.PI * 2),
    scale,
  };
  if (i.visible !== undefined) {
    item.visible = typeof i.visible === 'boolean' ? i.visible : fail('item visibility must be boolean');
  }
  if (i.locked !== undefined) {
    item.locked = typeof i.locked === 'boolean' ? i.locked : fail('item lock must be boolean');
  }
  if (i.phongAngleDeg !== undefined) item.phongAngleDeg = num(i.phongAngleDeg, 0, 180);
  if (i.roughness !== undefined) item.roughness = num(i.roughness, 0, 1);
  if (i.metalness !== undefined) item.metalness = num(i.metalness, 0, 1);
  if (i.modifiers !== undefined) {
    if (!Array.isArray(i.modifiers) || i.modifiers.length > 16) {
      fail('item can have at most 16 modifiers');
    }
    item.modifiers = (i.modifiers as unknown[]).map(validateModifierSpec);
  }
  if (i.roomId !== undefined) {
    item.roomId = kind === 'room' && isRoomId(i.roomId) ? i.roomId : fail('unknown or incompatible preset room');
    item.visible = i.visible === undefined ? true : item.visible;
    item.cutaway = i.cutaway === undefined ? true : typeof i.cutaway === 'boolean' ? i.cutaway : fail('room cutaway must be boolean');
    if (i.roomObjects !== undefined) {
      const rawMap = obj(i.roomObjects);
      const roomObjects: Record<string, RoomObjectOverride> = {};
      for (const [objId, rawOverride] of Object.entries(rawMap)) {
        text(objId, 120);
        const ov = obj(rawOverride);
        const parsed: RoomObjectOverride = {};
        if (ov.position !== undefined) parsed.position = vec(ov.position);
        if (ov.rotation !== undefined) parsed.rotation = vec(ov.rotation, -Math.PI * 2, Math.PI * 2);
        if (ov.scale !== undefined) {
          parsed.scale = vec(ov.scale, -10, 10);
          if (parsed.scale.some(n => Math.abs(n) < 0.05)) fail('room object scale magnitude must be at least 0.05');
        }
        if (ov.visible !== undefined) parsed.visible = typeof ov.visible === 'boolean' ? ov.visible : fail('room object visibility must be boolean');
        if (ov.locked !== undefined) parsed.locked = typeof ov.locked === 'boolean' ? ov.locked : fail('room object lock must be boolean');
        if (ov.deleted !== undefined) parsed.deleted = typeof ov.deleted === 'boolean' ? ov.deleted : fail('room object deleted must be boolean');
        roomObjects[objId] = parsed;
      }
      item.roomObjects = roomObjects;
    }
  }
  if (isBody(kind)) {
    item.modelId = i.modelId === undefined ? defaultModelId(kind) :
      isModelId(i.modelId) && CHARACTERS[i.modelId].body === kind ? i.modelId : fail('unknown or incompatible character model');
    item.pose = validatePose(i.pose);
    const parsedHandPose = validateCharacterHandPoses(i.handPose);
    if (parsedHandPose) item.handPose = parsedHandPose;
    item.bodyType = i.bodyType === undefined ? DEFAULT_BODY_TYPE : isBodyTypeId(i.bodyType) ? i.bodyType : fail('unknown body proportion');
    item.anatomicalLimits = i.anatomicalLimits === undefined ? true : typeof i.anatomicalLimits === 'boolean' ? i.anatomicalLimits : fail('anatomical limits must be boolean');
    item.outfitColor = i.outfitColor === undefined ? defaultCharacterOutfitColor(kind, item.modelId) : color(i.outfitColor);
    item.hairColor = i.hairColor === undefined ? defaultCharacterHairColor(item.modelId) : color(i.hairColor);
    item.hairStyle = i.hairStyle === undefined ? defaultCharacterHairStyle(kind, item.modelId) : enumValue(i.hairStyle, HAIR_STYLE_IDS);
    if (isMannequinCharacter(item.modelId)) {
      if (item.modelId === 'mannequin-female' && i.wardrobe !== undefined) {
        const w = obj(i.wardrobe);
        const slots: NonNullable<Item['wardrobe']> = {};
        for (const key of ['tank', 'skirt'] as const) {
          if (w[key] !== undefined) slots[key] = w[key] === true ? true : fail('invalid wardrobe slot');
        }
        if (w.outer !== undefined) slots.outer = enumValue(w.outer, ['jacket', 'trench', 'trenchHeld'] as const);
        if(slots.outer==='trenchHeld' && w.grip!==undefined) slots.grip=enumValue(w.grip,Object.keys(TRENCH_GRIPS) as TrenchGrip[]);
        if (w.colors !== undefined) {
          const tint = obj(w.colors);
          slots.colors = {};
          for (const id of Object.keys(GARMENT_COLORS) as Garment[]) {
            if (tint[id] !== undefined) slots.colors[id] = color(tint[id]);
          }
        }
        if (w.fit !== undefined) {
          for (const [key, value] of Object.entries(obj(w.fit))) {
            const id = enumValue(key, Object.keys(GARMENT_COLORS) as Garment[]);
            const nodes = Object.entries(obj(value));
            if (nodes.length > 256) fail('too many garment fit nodes');
            const layer: Record<string,Vec3> = {};
            for (const [node, raw] of nodes) {
              if (!/^(0|[1-9]\d{0,4})$/.test(node) || Number(node) >= 65536) fail('invalid garment node');
              const offset = vec(raw);
              if (Math.hypot(...offset) > garmentFitLimit(id)+1e-7) fail('garment offset exceeds fit limit');
              if (Math.hypot(...offset) > 1e-6) layer[node] = offset;
            }
            if (Object.keys(layer).length) (slots.fit ??= {})[id] = layer;
          }
        }
        // Old arbitrary attachments are not part of any garment. Drop their baked
        // deformation too; an unrelated unequipped attachment did not affect it.
        const obsoleteBake = w.pins !== undefined && (!Array.isArray(w.pins) ||
          w.pins.some(p => p && (p.garment === slots.outer || (p.garment === 'tank' || p.garment === 'skirt') && slots[p.garment as 'tank'|'skirt'])));
        if (w.drape !== undefined && !obsoleteBake) {
          const d = obj(w.drape), ls = obj(d.layers);
          const key = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{1,8}$/.test(v) ? v : fail('invalid drape fingerprint');
          slots.drape = { poseKey: key(d.poseKey), layers: {} };
          for (const id of Object.keys(GARMENT_COLORS) as Garment[]) {
            if (!(id === slots.outer || (id === 'tank' || id === 'skirt') && slots[id])) continue;
            const layer = obj(ls[id]), s = layer.offsets;
            // Three int16 offsets per vertex, maximum uint16 mesh indices. No padding needed.
            if (typeof s !== 'string' || !s.length || s.length > 65536*8 || s.length%8 || /[^A-Za-z0-9+/]/.test(s)) fail('invalid drape offsets');
            slots.drape.layers[id] = { pattern: key(layer.pattern), offsets: s as string };
          }
        }
        if (Object.keys(slots).length) item.wardrobe = slots;
      }
      if (i.dressMapId !== undefined) {
        item.dressMapId = enumValue(i.dressMapId, MANNEQUIN_DRESS_PRESET_IDS);
      }
      if (i.customDressMapDataUrl !== undefined) {
        if (
          typeof i.customDressMapDataUrl !== 'string' ||
          i.customDressMapDataUrl.length > 24_000_000 ||
          !/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(i.customDressMapDataUrl)
        ) {
          fail('invalid custom dress map data URL');
        } else {
          item.customDressMapDataUrl = i.customDressMapDataUrl;
        }
      }
    }
  }
  if (kind === 'light') {
    item.lightType = i.lightType === undefined ? LIGHT_DEFAULTS.lightType : enumValue(i.lightType, LIGHT_TYPES);
    item.intensity = num(i.intensity, 0, 200);
    item.target = i.target === undefined ? [0, 1, 0] : vec(i.target);
    if (i.targetObjectId !== undefined) {
      const targetRef = text(i.targetObjectId, 220);
      if (targetRef === id) fail('light cannot link target to itself');
      if (!parseTargetObjectRef(targetRef)) fail('invalid light targetObjectId');
      item.targetObjectId = targetRef;
    }
    item.castShadow = i.castShadow === undefined
      ? LIGHT_DEFAULTS.castShadow
      : typeof i.castShadow === 'boolean'
        ? i.castShadow
        : fail('light castShadow must be boolean');
    item.angle = i.angle === undefined ? LIGHT_DEFAULTS.angle : num(i.angle, 5, 85);
    item.penumbra = i.penumbra === undefined ? LIGHT_DEFAULTS.penumbra : num(i.penumbra, 0, 1);
    item.distance = i.distance === undefined ? LIGHT_DEFAULTS.distance : num(i.distance, 0, 200);
    item.decay = i.decay === undefined ? LIGHT_DEFAULTS.decay : num(i.decay, 0, 3);
    item.shadowExtent = i.shadowExtent === undefined ? LIGHT_DEFAULTS.shadowExtent : num(i.shadowExtent, 2, 40);
  }
  if (kind === 'primitive') {
    item.primitive = validatePrimitiveSpec(i.primitive ?? createDefaultPrimitiveSpec('cube'));
  }
  if (kind === 'mesh') {
    item.editableMesh = validateEditableMeshData(i.editableMesh);
  }
  if (kind === 'boole') {
    item.booleanOp = i.booleanOp === undefined ? 'subtract' : enumValue(i.booleanOp, BOOLEAN_OP_TYPES);
    item.booleanEnabled = i.booleanEnabled === undefined ? true : boolVal(i.booleanEnabled, 'booleanEnabled');
    if (i.operands !== undefined) {
      if (!Array.isArray(i.operands) || i.operands.length > 16) {
        fail('boole can have at most 16 operands');
      }
      item.operands = (i.operands as unknown[]).map((child: unknown) => validateSceneItem(child, ids, depth + 1));
    } else {
      item.operands = [];
    }
  }
  if (kind === 'imported') {
    item.assetId = text(i.assetId, 160);
    item.sourceFormat = enumValue(i.sourceFormat, IMPORT_FORMATS_3D);
    item.fileName = text(i.fileName, 200);
    if (i.embeddedGlbBase64 !== undefined) {
      if (typeof i.embeddedGlbBase64 !== 'string' || i.embeddedGlbBase64.length > 40_000_000) {
        fail('invalid embeddedGlbBase64');
      }
      item.embeddedGlbBase64 = i.embeddedGlbBase64 as string;
    }
    if (i.boundsSize !== undefined) item.boundsSize = vec(i.boundsSize, 0, 500);
    if (i.vertexCount !== undefined) item.vertexCount = Math.round(num(i.vertexCount, 0, 5_000_000));
    if (i.faceCount !== undefined) item.faceCount = Math.round(num(i.faceCount, 0, 5_000_000));
  }
  if (item.wardrobe?.drape && item.wardrobe.drape.poseKey !== clothPoseKey(item)) delete item.wardrobe.drape;
  return item;
}

export function validatePortable(value: unknown): Portable {
  const v = obj(value);
  if (v.schemaVersion !== 1 || v.rigVersion !== 1) fail('unsupported schemaVersion or rigVersion');
  const name = text(v.name);
  if (v.type === 'pose') {
    const handPose = validateCharacterHandPoses(v.handPose);
    return {
      schemaVersion: 1,
      rigVersion: 1,
      type: 'pose',
      name,
      body: enumValue(v.body, ['male', 'female']),
      pose: validatePose(v.pose),
      ...(handPose ? { handPose } : {}),
    };
  }
  if (v.type !== 'scene' || !Array.isArray(v.items) || v.items.length > 64) return fail('scene must have at most 64 items');
  const ids = new Set<string>();
  const items = v.items.map(raw => validateSceneItem(raw, ids, 0));
  if (items.filter(i => i.kind === 'light').length > 8) fail('at most 8 lights');
  syncLinkedLightTargets(items);
  const c = obj(v.camera);
  const near = num(c.near, 0.01, 10), far = num(c.far, 1, 500);
  if (far <= near) fail('far clipping must exceed near clipping');
  const dof = typeof c.dof === 'boolean' ? c.dof : fail('DOF must be boolean');
  return {
    schemaVersion: 1, rigVersion: 1, type: 'scene', name, items, background: color(v.background),
    renderStyle: validateRenderStyle(v.renderStyle),
    sceneLightsOnly: v.sceneLightsOnly === undefined ? false : boolVal(v.sceneLightsOnly, 'sceneLightsOnly'),
    renderQuality: v.renderQuality === undefined ? DEFAULT_RENDER_QUALITY : enumValue(v.renderQuality, RENDER_QUALITY_MODES),
    giEnabled: v.giEnabled === undefined ? DEFAULT_GI_ENABLED : boolVal(v.giEnabled, 'giEnabled'),
    giIntensity: v.giIntensity === undefined ? DEFAULT_GI_INTENSITY : num(v.giIntensity, 0, 2.5),
    aoEnabled: v.aoEnabled === undefined ? DEFAULT_AO_ENABLED : boolVal(v.aoEnabled, 'aoEnabled'),
    shadowSoftness: v.shadowSoftness === undefined ? DEFAULT_SHADOW_SOFTNESS : num(v.shadowSoftness, 0, 2.5),
    camera: { position: vec(c.position), target: vec(c.target), focalLength: num(c.focalLength, 15, 150), near, far, aspect: enumValue(c.aspect, ['3:2', '16:9', '1:1', '4:5']), dof, focus: num(c.focus, 0.1, 100), aperture: num(c.aperture, 0.00001, 0.005), maxBlur: num(c.maxBlur, 0.001, 0.05) },
  };
}
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_RICH_SCENE_FILE_BYTES = 40_000_000;
export function validatePoseFile(value: unknown): PoseFile {
  const v = obj(value);
  if (v.schemaVersion !== 1 || v.rigVersion !== 1) fail('unsupported schemaVersion or rigVersion');
  if (v.type !== 'pose') fail('expected a pose JSON file (type "pose")');
  const handPose = validateCharacterHandPoses(v.handPose);
  return {
    schemaVersion: 1,
    rigVersion: 1,
    type: 'pose',
    name: text(v.name),
    body: enumValue(v.body, ['male', 'female']),
    pose: validatePose(v.pose),
    ...(handPose ? { handPose } : {}),
  };
}
export function parseFile(source: string, maxBytes = MAX_FILE_BYTES): Portable {
  if (new TextEncoder().encode(source).length > maxBytes) {
    fail(maxBytes === MAX_FILE_BYTES ? 'file exceeds 1 MB' : `file exceeds ${Math.round(maxBytes / 1_000_000)} MB`);
  }
  let value: unknown;
  try { value = JSON.parse(source); } catch { return fail('not valid JSON'); }
  return validatePortable(value);
}
export function parsePoseFile(source: string): PoseFile {
  if (new TextEncoder().encode(source).length > MAX_FILE_BYTES) fail('file exceeds 1 MB');
  let value: unknown;
  try { value = JSON.parse(source); } catch { return fail('not valid JSON'); }
  return validatePoseFile(value);
}
export function poseFile(item: Item, name: string): PoseFile {
  if (!isBody(item.kind) || !item.pose) throw new Error('Select a figure to save a pose.');
  const handPose = normalizeCharacterHandPoses(item.handPose);
  return {
    schemaVersion: 1,
    rigVersion: 1,
    type: 'pose',
    name,
    body: item.kind,
    pose: clone(item.pose),
    ...(handPose ? { handPose } : {}),
  };
}
export function applyPose(item: Item, file: PoseFile): Item {
  if (!isBody(item.kind)) throw new Error('Select a male or female figure before applying a pose.');
  const next: Item = { ...clone(item), pose: clone(file.pose) };
  const handPose = normalizeCharacterHandPoses(file.handPose);
  if (handPose) next.handPose = handPose;
  else delete next.handPose;
  return next;
}

export function validateRenderStyle(value: unknown): RenderStyleState {
  const s = { ...DEFAULT_RENDER_STYLE, ...(value === undefined ? {} : obj(value)) };
  if (typeof s.clayOutlines !== 'boolean') fail('clay outlines must be boolean');
  if (s.shadowSteps !== 2 && s.shadowSteps !== 3) fail('shadow steps must be 2 or 3');
  return {
    mode: enumValue(s.mode, RENDER_MODES), inkColor: color(s.inkColor),
    inkWidth: num(s.inkWidth, 0.5, 3), interiorDetail: num(s.interiorDetail, 0, 1),
    shadowSteps: s.shadowSteps, shadowTemp: enumValue(s.shadowTemp, ['cool', 'warm', 'neutral']),
    outlinePaper: enumValue(s.outlinePaper, ['warm', 'white', 'scene', 'transparent']),
    clayFinish: enumValue(s.clayFinish, ['terracotta', 'grey', 'plaster']), clayOutlines: s.clayOutlines,
  };
}

export interface PoseClipboard {
  source: string;
  joints: Joint[];
  pose: Pose;
  handPose?: CharacterHandPoses;
  sourceModelId?: ModelId;
}
export function copyPoseNodes(item: Item, joints: readonly Joint[] = JOINTS): PoseClipboard {
  if (!item.pose || !isBody(item.kind) || !joints.length) throw new Error('Select a figure and at least one joint to copy.');
  const uniqueJoints = [...new Set(joints)];
  const handPose: CharacterHandPoses = {};
  if (uniqueJoints.includes('leftWrist') && item.handPose?.left && !isNeutralHandPose(item.handPose.left)) {
    handPose.left = clone(item.handPose.left);
  }
  if (uniqueJoints.includes('rightWrist') && item.handPose?.right && !isNeutralHandPose(item.handPose.right)) {
    handPose.right = clone(item.handPose.right);
  }
  const normalizedHandPose = normalizeCharacterHandPoses(handPose);
  return {
    source: item.name,
    joints: uniqueJoints,
    pose: clone(item.pose),
    ...(normalizedHandPose ? { handPose: normalizedHandPose } : {}),
    sourceModelId: item.modelId ?? defaultModelId(item.kind),
  };
}
export function pastePoseNodes(item: Item, clipboard: PoseClipboard): Item {
  if (!item.pose || !isBody(item.kind)) throw new Error('Select a figure to paste a pose.');
  const pose = clone(item.pose);
  clipboard.joints.forEach(j => { pose[j] = clone(clipboard.pose[j]); });
  const nextHand: CharacterHandPoses = item.handPose ? clone(item.handPose) : {};
  if (clipboard.joints.includes('leftWrist')) {
    if (clipboard.handPose?.left && !isNeutralHandPose(clipboard.handPose.left)) {
      nextHand.left = clone(clipboard.handPose.left);
    } else {
      delete nextHand.left;
    }
  }
  if (clipboard.joints.includes('rightWrist')) {
    if (clipboard.handPose?.right && !isNeutralHandPose(clipboard.handPose.right)) {
      nextHand.right = clone(clipboard.handPose.right);
    } else {
      delete nextHand.right;
    }
  }
  const normalized = normalizeCharacterHandPoses(nextHand);
  const out: Item = { ...clone(item), pose };
  if (normalized) out.handPose = normalized;
  else delete out.handPose;
  return out;
}
export function selectionCentroid(items: readonly Item[]): Vec3 {
  if (!items.length) return [0, 0, 0];
  return [0, 1, 2].map(axis => items.reduce((sum, i) => sum + i.position[axis], 0) / items.length) as Vec3;
}
export function transformItems(items: readonly Item[], ids: readonly string[], delta: Matrix4, reflectionAxis: 0 | 1 | 2 = 0): Item[] {
  const transformed = items.map(item => {
    if (!ids.includes(item.id)) return clone(item);
    const matrix = new Matrix4().compose(new Vector3(...item.position), new Quaternion().setFromEuler(new Euler(...item.rotation)), new Vector3(...item.scale));
    matrix.premultiply(delta);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    matrix.decompose(p, q, s);
    const signs = item.scale.map(Math.sign) as Vec3;
    if (delta.determinant() < 0) signs[reflectionAxis] *= -1;
    s.set(Math.abs(s.x) * signs[0], Math.abs(s.y) * signs[1], Math.abs(s.z) * signs[2]);
    q.setFromRotationMatrix(matrix.clone().scale(new Vector3(1 / s.x, 1 / s.y, 1 / s.z)));
    const result = { ...clone(item), position: p.toArray() as Vec3, rotation: new Euler().setFromQuaternion(q).toArray().slice(0, 3) as Vec3, scale: s.toArray() as Vec3 };
    if (result.target && !result.targetObjectId) {
      result.target = new Vector3(...result.target).applyMatrix4(delta).toArray() as Vec3;
    }
    return result;
  });
  syncLinkedLightTargets(transformed);
  return transformed;
}
export function flipItems(items: readonly Item[], ids: readonly string[], axis: 0 | 1 | 2): Item[] {
  const center = selectionCentroid(items.filter(i => ids.includes(i.id)));
  const scale: Vec3 = [1, 1, 1]; scale[axis] = -1;
  const delta = new Matrix4().makeTranslation(...center)
    .multiply(new Matrix4().makeScale(...scale))
    .multiply(new Matrix4().makeTranslation(-center[0], -center[1], -center[2]));
  return transformItems(items, ids, delta, axis);
}
