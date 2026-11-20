import type { Body, Joint } from './model';

export const SOURCE_BONES: Record<Joint, string> = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
  leftShoulder: 'upperarm_l', leftElbow: 'lowerarm_l', leftWrist: 'hand_l',
  rightShoulder: 'upperarm_r', rightElbow: 'lowerarm_r', rightWrist: 'hand_r',
  leftHip: 'thigh_l', leftKnee: 'calf_l', leftAnkle: 'foot_l',
  rightHip: 'thigh_r', rightKnee: 'calf_r', rightAnkle: 'foot_r',
};

interface SourceRig {
  bones: Record<Joint, string>;
  bodyMesh: string;
  maskedMaterial: string;
  browMesh: string;
  height: number;
}
interface Character {
  body: Body; label: string; path: string; source?: SourceRig;
}
const folder = 'models/external/quaternius-universal-base/';
const catalog = {
  'mannequin-male': { body: 'male', label: 'Mannequin Male', path: 'models/mannequin/Mannequin_Male.glb' },
  'mannequin-female': { body: 'female', label: 'Mannequin Female', path: 'models/mannequin/Mannequin_Female.glb' },
  'quaternius-superhero-male': {
    body: 'male', label: 'Superhero Male', path: folder + 'Superhero_Male_FullBody.gltf',
    source: { bones: SOURCE_BONES, bodyMesh: 'SuperHero_Male', maskedMaterial: 'MI_Superhero_Male', browMesh: 'Eyebrows', height: 1.85 },
  },
  'quaternius-superhero-female': {
    body: 'female', label: 'Superhero Female', path: folder + 'Superhero_Female_FullBody.gltf',
    source: { bones: SOURCE_BONES, bodyMesh: 'Superhero_Female', maskedMaterial: 'MI_Superhero_Female', browMesh: 'Eyebrows', height: 1.75 },
  },
} satisfies Record<string, Character>;

export type ModelId = keyof typeof catalog;
export const CHARACTERS: Readonly<Record<ModelId, Character>> = catalog;
export const MODEL_IDS = Object.keys(catalog) as ModelId[];
export const defaultModelId = (body: Body): ModelId => `mannequin-${body}`;
export const isModelId = (v: unknown): v is ModelId => typeof v === 'string' && Object.hasOwn(catalog, v);
