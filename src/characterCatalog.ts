import type { Body, HairStyleId, Joint } from './model';

export const SOURCE_BONES: Record<Joint, string> = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
  leftShoulder: 'upperarm_l', leftElbow: 'lowerarm_l', leftWrist: 'hand_l',
  rightShoulder: 'upperarm_r', rightElbow: 'lowerarm_r', rightWrist: 'hand_r',
  leftHip: 'thigh_l', leftKnee: 'calf_l', leftAnkle: 'foot_l',
  rightHip: 'thigh_r', rightKnee: 'calf_r', rightAnkle: 'foot_r',
};

export type SharedOutfitProfile =
  | 'superhero-male'
  | 'superhero-female'
  | 'bailarina'
  | 'stylized-women';

interface SourceRig {
  bones: Record<Joint, string>;
  bodyMesh: string;
  groundMaterial?: string;
  preserveAuthoredRest?: boolean;
  defaultHairStyle?: HairStyleId;
  fittedSkull?: import('./bodyProportions').SkullEnvelope;
  browMesh?: string;
  sharedOutfitProfile?: SharedOutfitProfile;
  authored: { skin: string[]; outfit: string[]; hair: string[] };
  height: number;
}
interface Character {
  body: Body; label: string; path: string; source?: SourceRig;
}
const folder = 'models/external/quaternius-universal-base/';
const catalog = {
  'thanhhuy-old-man': {
    body: 'male', label: 'Old Man', path: 'models/unique/old-man/OldMan.glb',
    source: { bodyMesh: 'OldMan', height: 1.814,
      authored: { skin: ['Skin'], outfit: [], hair: ['SculptedHair'] },
      bones: { hips:'hips', spine:'spine', chest:'chest', neck:'neck', head:'head',
        leftShoulder:'leftShoulder', leftElbow:'leftElbow', leftWrist:'leftWrist', rightShoulder:'rightShoulder', rightElbow:'rightElbow', rightWrist:'rightWrist',
        leftHip:'leftHip', leftKnee:'leftKnee', leftAnkle:'leftAnkle', rightHip:'rightHip', rightKnee:'rightKnee', rightAnkle:'rightAnkle' } }
  },
  'pseudonym-nightgown': {
    body: 'female', label: 'Women in Nightgown', path: 'models/unique/nightgown/Nightgown.glb',
    source: { bodyMesh: 'luna', height: 1.77,
      authored: {skin: ['Luna_luna','Luna_head'], outfit: ['Luna_night_gown'], hair: ['Luna_hair']},
      bones: { hips: 'spine', spine: 'spine001', chest: 'spine003', neck: 'spine004', head: 'spine006',
        leftShoulder: 'upper_armL', leftElbow: 'forearmL', leftWrist: 'handL', rightShoulder: 'upper_armR', rightElbow: 'forearmR', rightWrist: 'handR',
        leftHip: 'thighL', leftKnee: 'shinL', leftAnkle: 'footL', rightHip: 'thighR', rightKnee: 'shinR', rightAnkle: 'footR' } }
  },
  'mannequin-male': { body: 'male', label: 'Mannequin Male', path: 'models/mannequin/Mannequin_Male.glb' },
  'mannequin-female': { body: 'female', label: 'Mannequin Female', path: 'models/mannequin/Mannequin_Female.glb' },
  'quaternius-superhero-male': {
    body: 'male', label: 'Superhero Male', path: folder + 'Superhero_Male_FullBody.gltf',
    source: {
      bones: SOURCE_BONES,
      bodyMesh: 'SuperHero_Male',
      sharedOutfitProfile: 'superhero-male',
      authored: { skin: ['MI_Superhero_Male'], outfit: ['MI_Superhero_Male'], hair: [] },
      browMesh: 'Eyebrows',
      height: 1.85,
    },
  },
  'quaternius-superhero-female': {
    body: 'female', label: 'Superhero Female', path: folder + 'Superhero_Female_FullBody.gltf',
    source: {
      bones: SOURCE_BONES,
      bodyMesh: 'Superhero_Female',
      sharedOutfitProfile: 'superhero-female',
      authored: { skin: ['MI_Superhero_Female'], outfit: ['MI_Superhero_Female'], hair: [] },
      browMesh: 'Eyebrows',
      height: 1.75,
    },
  },
} satisfies Record<string, Character>;

const local = import.meta.env.DEV
  ? import.meta.glob<Record<`local-${string}`,Character>>('../local-characters/catalog.json', {eager:true,import:'default'})['../local-characters/catalog.json']
  : undefined;
export type ModelId = keyof typeof catalog | `local-${string}`;
export const CHARACTERS: Readonly<Record<ModelId, Character>> = {...catalog, ...local};
export const MODEL_IDS = Object.keys(CHARACTERS) as ModelId[];
export const defaultModelId = (body: Body): ModelId => `mannequin-${body}`;
export const isModelId = (v: unknown): v is ModelId => typeof v === 'string' && Object.hasOwn(CHARACTERS, v);
