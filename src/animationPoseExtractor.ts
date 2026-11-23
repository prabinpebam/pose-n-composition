import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { JOINTS, type Body, type Joint, type Pose, type Vec3 } from './model';
import { adaptCanonicalPoseToMorphology } from './morphology-rig';
import type { Figure } from './rig';

export const ANIMATION_ACCEPT_EXTENSIONS = '.fbx,.glb,.gltf';
export const MAX_ANIMATION_FILE_BYTES = 50 * 1024 * 1024;
export const BUILTIN_ANIMATION_LICENSE = 'CC0 1.0 Universal (Quaternius Universal Animation Library [Standard])';

export type AnimationCycleCategory = 'Locomotion' | 'Idle & Gesture' | 'Stealth & Ground' | 'Action & Athletic';

export interface BuiltinAnimationCycleInfo {
  id: string;
  name: string;
  description: string;
  license: string;
  category: AnimationCycleCategory;
  sourceClipName: string;
  loop: boolean;
}

export interface AnimationCycleClip {
  id: string;
  name: string;
  source: 'builtin' | 'file';
  duration: number;
  fps: number;
  frameCount: number;
  loop: boolean;
  mappedJoints: readonly Joint[];
  rigFormat: 'quaternius' | 'mixamo' | 'humanoid';
  readonly _evaluator: InternalClipEvaluator;
}

export interface ExtractedFramePose {
  pose: Pose;
  frame: number;
  normalizedTime: number;
  timeSeconds: number;
  suggestedRootY?: number;
}

export interface ExtractPoseOptions {
  normalized?: boolean;
  body?: Body;
  figure?: Figure;
}

export const BUILTIN_ANIMATION_CYCLES: readonly BuiltinAnimationCycleInfo[] = [
  {
    id: 'walk-loop',
    name: 'Walk Cycle',
    description: 'Relaxed natural walking gait with contralateral arm and hip swing.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Locomotion',
    sourceClipName: 'Walk_Loop',
    loop: true,
  },
  {
    id: 'walk-formal',
    name: 'Confident Stride',
    description: 'Measured upright stride with poised chest and steady cadence.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Locomotion',
    sourceClipName: 'Walk_Formal_Loop',
    loop: true,
  },
  {
    id: 'jog-forward',
    name: 'Athletic Jog',
    description: 'Mid-tempo running cycle with clear contact, drive, and flight phases.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Locomotion',
    sourceClipName: 'Jog_Fwd_Loop',
    loop: true,
  },
  {
    id: 'sprint-loop',
    name: 'Full Sprint',
    description: 'High-speed forward lean with powerful knee drive and arm pump.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Locomotion',
    sourceClipName: 'Sprint_Loop',
    loop: true,
  },
  {
    id: 'idle-relaxed',
    name: 'Relaxed Breathing',
    description: 'Subtle standing weight shift and breathing motion.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Idle & Gesture',
    sourceClipName: 'Idle_Loop',
    loop: true,
  },
  {
    id: 'idle-talking',
    name: 'Conversational Gesture',
    description: 'Standing dialogue cycle with expressive hand and head gestures.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Idle & Gesture',
    sourceClipName: 'Idle_Talking_Loop',
    loop: true,
  },
  {
    id: 'sitting-talking',
    name: 'Seated Conversation',
    description: 'Chair-height seated dialogue cycle with natural upper-body articulation.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Idle & Gesture',
    sourceClipName: 'Sitting_Talking_Loop',
    loop: true,
  },
  {
    id: 'crouch-sneak',
    name: 'Stealth Crouch Walk',
    description: 'Low-center-of-gravity sneaking locomotion cycle.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Stealth & Ground',
    sourceClipName: 'Crouch_Fwd_Loop',
    loop: true,
  },
  {
    id: 'kneeling-work',
    name: 'Kneeling Action',
    description: 'Transition from standing into a grounded kneeling work posture.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Stealth & Ground',
    sourceClipName: 'Fixing_Kneeling',
    loop: false,
  },
  {
    id: 'jump-launch',
    name: 'Jump & Takeoff',
    description: 'Anticipation squat through explosive upward jump launch.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Action & Athletic',
    sourceClipName: 'Jump_Start',
    loop: false,
  },
  {
    id: 'sword-attack',
    name: 'Martial Slash',
    description: 'Dynamic lunging torso rotation and diagonal weapon swing.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Action & Athletic',
    sourceClipName: 'Sword_Attack',
    loop: false,
  },
  {
    id: 'dance-groove',
    name: 'Rhythmic Dance',
    description: 'Upbeat rhythmic step with contrapposto hip and shoulder counter-tilt.',
    license: BUILTIN_ANIMATION_LICENSE,
    category: 'Action & Athletic',
    sourceClipName: 'Dance_Loop',
    loop: true,
  },
];

type AuxBoneRole = 'spineMid';

const PRIMARY_LIMB_CHILD: Partial<Record<Joint, Joint>> = {
  leftShoulder: 'leftElbow',
  leftElbow: 'leftWrist',
  rightShoulder: 'rightElbow',
  rightElbow: 'rightWrist',
  leftHip: 'leftKnee',
  leftKnee: 'leftAnkle',
  rightHip: 'rightKnee',
  rightKnee: 'rightAnkle',
};

interface CalibratedNodeSpec {
  name: string;
  parent: string | null;
  pos: [number, number, number];
  quat: [number, number, number, number];
  scale: [number, number, number];
}

// Exact calibrated pre-arm-drop 23-node chains matching buildExternalFigure('male' | 'female') in src/external-rig.ts.
const TARGET_RIG_SPECS: Record<Body, readonly CalibratedNodeSpec[]> = {
  male: [
    { name: 'Scene', parent: null, pos: [0, 0.009669, 0.018003], quat: [0, 0, 0, 1], scale: [1.016715, 1.016715, 1.016715] },
    { name: 'Armature', parent: 'Scene', pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    { name: 'root', parent: 'Armature', pos: [0, 0, 0], quat: [-0.707107, 0, 0, 0.707107], scale: [1, 1, 1] },
    { name: 'pelvis', parent: 'root', pos: [0, 0.043, 0.9491], quat: [0.800571, 0, 0, 0.599238], scale: [1, 1, 1] },
    { name: 'spine_01', parent: 'pelvis', pos: [0, 0.128092, 0], quat: [-0.091856, 0, 0, 0.995772], scale: [1, 1, 1] },
    { name: 'spine_02', parent: 'spine_01', pos: [0, 0.10635, 0], quat: [-0.039585, 0, 0, 0.999216], scale: [1, 1, 1] },
    { name: 'spine_03', parent: 'spine_02', pos: [0, 0.133134, 0], quat: [-0.124189, 0, 0, 0.992259], scale: [1, 1, 1] },
    { name: 'neck_01', parent: 'spine_03', pos: [0, 0.215093, 0], quat: [0.257259, 0, 0, 0.966342], scale: [1, 1, 1] },
    { name: 'Head', parent: 'neck_01', pos: [0, 0.082852, 0], quat: [-0.13207, 0, 0, 0.99124], scale: [1, 1, 1] },
    { name: 'clavicle_l', parent: 'spine_03', pos: [0.0314, 0.173718, 0.067328], quat: [-0.528737, -0.329102, -0.413808, 0.663997], scale: [1, 1, 1] },
    { name: 'upperarm_l', parent: 'clavicle_l', pos: [-0.009136, 0.205739, -0.039671], quat: [0.149803, 0.691131, -0.149388, 0.691072], scale: [1, 0.999999, 1] },
    { name: 'lowerarm_l', parent: 'upperarm_l', pos: [0, 0.251115, 0], quat: [0.030732, 0.000042, -0.000001, 0.999528], scale: [1, 1, 1] },
    { name: 'hand_l', parent: 'lowerarm_l', pos: [0, 0.243594, 0], quat: [-0.015602, 0, 0, 0.999878], scale: [1, 1, 1] },
    { name: 'clavicle_r', parent: 'spine_03', pos: [-0.0314, 0.173718, 0.067328], quat: [-0.528737, 0.329102, 0.413808, 0.663997], scale: [1, 1, 1] },
    { name: 'upperarm_r', parent: 'clavicle_r', pos: [0.009136, 0.205739, -0.039671], quat: [0.149803, -0.691131, 0.149388, 0.691072], scale: [1, 0.999999, 1] },
    { name: 'lowerarm_r', parent: 'upperarm_r', pos: [0, 0.251115, 0], quat: [0.030732, -0.000042, 0.000001, 0.999528], scale: [1, 1, 1] },
    { name: 'hand_r', parent: 'lowerarm_r', pos: [0, 0.243594, 0], quat: [-0.015602, 0, 0, 0.999878], scale: [1, 1, 1] },
    { name: 'thigh_l', parent: 'pelvis', pos: [0.114305, 0.023177, 0.000488], quat: [0.989831, 0, 0, 0.142248], scale: [1, 1, 1.000002] },
    { name: 'calf_l', parent: 'thigh_l', pos: [0, 0.4288, 0], quat: [0.055989, 0, 0, 0.998431], scale: [1, 1, 1] },
    { name: 'foot_l', parent: 'calf_l', pos: [0, 0.458788, 0], quat: [-0.572168, 0, 0, 0.820136], scale: [1, 1, 1] },
    { name: 'thigh_r', parent: 'pelvis', pos: [-0.114305, 0.023177, 0.000488], quat: [0.989831, 0, 0, 0.142248], scale: [1, 1, 1.000002] },
    { name: 'calf_r', parent: 'thigh_r', pos: [0, 0.4288, 0], quat: [0.055989, 0, 0, 0.998431], scale: [1, 1, 1] },
    { name: 'foot_r', parent: 'calf_r', pos: [0, 0.458788, 0], quat: [-0.572168, 0, 0, 0.820136], scale: [1, 1, 1] },
  ],
  female: [
    { name: 'Scene', parent: null, pos: [0, 0.008288, 0.010964], quat: [0, 0, 0, 1], scale: [0.985887, 0.985887, 0.985887] },
    { name: 'Armature', parent: 'Scene', pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    { name: 'root', parent: 'Armature', pos: [0, 0, 0], quat: [-0.707107, 0, 0, 0.707107], scale: [1, 1, 1] },
    { name: 'pelvis', parent: 'root', pos: [0, 0.0457, 0.9318], quat: [0.78797, 0, 0, 0.615714], scale: [1, 1, 1] },
    { name: 'spine_01', parent: 'pelvis', pos: [0, 0.126555, 0], quat: [-0.063932, 0.00005, -0.000003, 0.997954], scale: [1, 1, 1] },
    { name: 'spine_02', parent: 'spine_01', pos: [0, 0.110345, 0], quat: [-0.055729, -0.00005, -0.000003, 0.998446], scale: [1, 1, 1] },
    { name: 'spine_03', parent: 'spine_02', pos: [0, 0.126401, 0], quat: [-0.100998, 0, 0, 0.994887], scale: [1, 1, 1] },
    { name: 'neck_01', parent: 'spine_03', pos: [0, 0.198156, 0], quat: [0.308837, 0, 0, 0.951115], scale: [1, 1, 1] },
    { name: 'Head', parent: 'neck_01', pos: [0, 0.071191, 0], quat: [-0.204675, 0, 0, 0.97883], scale: [1, 1, 1] },
    { name: 'clavicle_l', parent: 'spine_03', pos: [0.0293, 0.133703, 0.044819], quat: [-0.547132, -0.320428, -0.391278, 0.666989], scale: [1, 1, 1] },
    { name: 'upperarm_l', parent: 'clavicle_l', pos: [-0.001605, 0.141066, -0.012286], quat: [0.172326, 0.685859, -0.171794, 0.685848], scale: [1, 1, 1] },
    { name: 'lowerarm_l', parent: 'upperarm_l', pos: [0, 0.240342, 0], quat: [0.023802, 0.000082, -0.000002, 0.999717], scale: [1, 1, 1] },
    { name: 'hand_l', parent: 'lowerarm_l', pos: [0, 0.249304, 0], quat: [-0.022376, -0.000002, 0, 0.99975], scale: [1, 1, 1] },
    { name: 'clavicle_r', parent: 'spine_03', pos: [-0.0293, 0.133703, 0.044819], quat: [-0.547132, 0.320428, 0.391278, 0.666989], scale: [1, 1, 1] },
    { name: 'upperarm_r', parent: 'clavicle_r', pos: [0.001605, 0.141066, -0.012286], quat: [0.172326, -0.685859, 0.171794, 0.685848], scale: [1, 1, 1] },
    { name: 'lowerarm_r', parent: 'upperarm_r', pos: [0, 0.240342, 0], quat: [0.023802, -0.000082, 0.000002, 0.999717], scale: [1, 1, 1] },
    { name: 'hand_r', parent: 'lowerarm_r', pos: [0, 0.249304, 0], quat: [-0.022376, 0.000002, 0, 0.99975], scale: [1, 1, 1] },
    { name: 'thigh_l', parent: 'pelvis', pos: [0.1114, 0.01046, -0.008893], quat: [0.989375, 0, 0, 0.145386], scale: [1, 1, 1.000001] },
    { name: 'calf_l', parent: 'thigh_l', pos: [0, 0.409864, 0], quat: [0.071223, 0, 0, 0.99746], scale: [1, 1, 1] },
    { name: 'foot_l', parent: 'calf_l', pos: [0, 0.4661, 0], quat: [-0.597858, 0, 0, 0.801602], scale: [1, 1, 1] },
    { name: 'thigh_r', parent: 'pelvis', pos: [-0.1114, 0.01046, -0.008893], quat: [0.989375, 0, 0, 0.145386], scale: [1, 1, 1.000001] },
    { name: 'calf_r', parent: 'thigh_r', pos: [0, 0.409864, 0], quat: [0.071223, 0, 0, 0.99746], scale: [1, 1, 1] },
    { name: 'foot_r', parent: 'calf_r', pos: [0, 0.4661, 0], quat: [-0.597858, 0, 0, 0.801602], scale: [1, 1, 1] },
  ],
};

const QUATERNIUS_BONES: Record<Joint, string> = {
  hips: 'pelvis',
  spine: 'spine_01',
  chest: 'spine_03',
  neck: 'neck_01',
  head: 'Head',
  leftShoulder: 'upperarm_l',
  leftElbow: 'lowerarm_l',
  leftWrist: 'hand_l',
  rightShoulder: 'upperarm_r',
  rightElbow: 'lowerarm_r',
  rightWrist: 'hand_r',
  leftHip: 'thigh_l',
  leftKnee: 'calf_l',
  leftAnkle: 'foot_l',
  rightHip: 'thigh_r',
  rightKnee: 'calf_r',
  rightAnkle: 'foot_r',
};

interface TargetCalibration {
  root: T.Group;
  bones: Record<Joint, T.Bone>;
  tposeWorldQuat: Record<Joint, T.Quaternion>;
  tposeDirs: Partial<Record<Joint, T.Vector3>>;
  restRotations: Record<Joint, T.Quaternion>;
  rotationBases: Record<Joint, T.Quaternion>;
  standingPelvisY: number;
  standingAnkleY: number;
}

const targetCalibrations: Partial<Record<Body, TargetCalibration>> = {};

function getTargetCalibration(body: Body): TargetCalibration {
  const existing = targetCalibrations[body];
  if (existing) return existing;

  const root = new T.Group();
  const byName = new Map<string, T.Object3D>();
  for (const spec of TARGET_RIG_SPECS[body]) {
    const node = spec.name === 'Scene' || spec.name === 'Armature' ? new T.Group() : new T.Bone();
    node.name = spec.name;
    node.position.fromArray(spec.pos);
    node.quaternion.fromArray(spec.quat).normalize();
    node.scale.fromArray(spec.scale);
    const parent = spec.parent ? byName.get(spec.parent) ?? root : root;
    parent.add(node);
    byName.set(spec.name, node);
  }
  root.updateMatrixWorld(true);

  const bones = Object.fromEntries(
    JOINTS.map((j) => {
      const bone = byName.get(QUATERNIUS_BONES[j]);
      if (!(bone instanceof T.Bone)) throw new Error(`Missing target calibration bone for ${j}`);
      return [j, bone];
    }),
  ) as Record<Joint, T.Bone>;

  const tposeWorldQuat = Object.fromEntries(
    JOINTS.map((j) => [j, bones[j].getWorldQuaternion(new T.Quaternion())]),
  ) as Record<Joint, T.Quaternion>;
  const tposeWorldPos = Object.fromEntries(
    JOINTS.map((j) => [j, bones[j].getWorldPosition(new T.Vector3())]),
  ) as Record<Joint, T.Vector3>;
  const tposeDirs: Partial<Record<Joint, T.Vector3>> = {};
  for (const [joint, child] of Object.entries(PRIMARY_LIMB_CHILD) as [Joint, Joint][]) {
    tposeDirs[joint] = tposeWorldPos[child].clone().sub(tposeWorldPos[joint]).normalize();
  }

  const standingPelvisY = tposeWorldPos.hips.y;
  const standingAnkleY = Math.min(tposeWorldPos.leftAnkle.y, tposeWorldPos.rightAnkle.y);

  // Apply exact arm relaxation from buildExternalFigure (src/external-rig.ts) so neutral pose == zero Euler deltas.
  const align = (joint: Joint, child: Joint, direction: T.Vector3) => {
    const bone = bones[joint];
    const from = bones[child].getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();
    const world = bone.getWorldQuaternion(new T.Quaternion());
    const parent = bone.parent!.getWorldQuaternion(new T.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(new T.Quaternion().setFromUnitVectors(from, direction.normalize())).multiply(world));
    root.updateMatrixWorld(true);
  };
  for (const [prefix, sign] of [['left', 1], ['right', -1]] as const) {
    align(`${prefix}Shoulder`, `${prefix}Elbow`, new T.Vector3(sign * 0.12, -1, 0));
    align(`${prefix}Elbow`, `${prefix}Wrist`, new T.Vector3(0, -1, 0));
  }

  const restRotations = Object.fromEntries(JOINTS.map((j) => [j, bones[j].quaternion.clone()])) as Record<Joint, T.Quaternion>;
  const rotationBases = Object.fromEntries(
    JOINTS.map((j) => [j, bones[j].getWorldQuaternion(new T.Quaternion()).invert()]),
  ) as Record<Joint, T.Quaternion>;

  const cal: TargetCalibration = {
    root,
    bones,
    tposeWorldQuat,
    tposeDirs,
    restRotations,
    rotationBases,
    standingPelvisY,
    standingAnkleY,
  };
  targetCalibrations[body] = cal;
  return cal;
}

const BONE_ALIASES: Readonly<Record<string, Joint>> = {
  // Hips / Pelvis
  pelvis: 'hips',
  hips: 'hips',
  hip: 'hips',
  bip01pelvis: 'hips',
  bip001pelvis: 'hips',
  // Spine / Chest / Neck / Head
  spine_01: 'spine',
  spine01: 'spine',
  spine: 'spine',
  abdomen: 'spine',
  bip01spine: 'spine',
  bip001spine: 'spine',
  spine_03: 'chest',
  spine03: 'chest',
  spine2: 'chest',
  spine_2: 'chest',
  chest: 'chest',
  upperchest: 'chest',
  upper_chest: 'chest',
  thorax: 'chest',
  bip01spine2: 'chest',
  bip001spine2: 'chest',
  neck_01: 'neck',
  neck01: 'neck',
  neck: 'neck',
  bip01neck: 'neck',
  bip001neck: 'neck',
  head: 'head',
  bip01head: 'head',
  bip001head: 'head',
  // Left Arm
  upperarm_l: 'leftShoulder',
  upperarml: 'leftShoulder',
  upper_arm_l: 'leftShoulder',
  l_upperarm: 'leftShoulder',
  leftarm: 'leftShoulder',
  left_arm: 'leftShoulder',
  leftupperarm: 'leftShoulder',
  left_upper_arm: 'leftShoulder',
  bip01lupperarm: 'leftShoulder',
  bip001lupperarm: 'leftShoulder',
  lowerarm_l: 'leftElbow',
  lowerarml: 'leftElbow',
  lower_arm_l: 'leftElbow',
  l_forearm: 'leftElbow',
  l_lowerarm: 'leftElbow',
  leftforearm: 'leftElbow',
  left_forearm: 'leftElbow',
  leftlowerarm: 'leftElbow',
  left_lower_arm: 'leftElbow',
  bip01lforearm: 'leftElbow',
  bip001lforearm: 'leftElbow',
  hand_l: 'leftWrist',
  handl: 'leftWrist',
  l_hand: 'leftWrist',
  lefthand: 'leftWrist',
  left_hand: 'leftWrist',
  leftwrist: 'leftWrist',
  bip01lhand: 'leftWrist',
  bip001lhand: 'leftWrist',
  // Right Arm
  upperarm_r: 'rightShoulder',
  upperarmr: 'rightShoulder',
  upper_arm_r: 'rightShoulder',
  r_upperarm: 'rightShoulder',
  rightarm: 'rightShoulder',
  right_arm: 'rightShoulder',
  rightupperarm: 'rightShoulder',
  right_upper_arm: 'rightShoulder',
  bip01rupperarm: 'rightShoulder',
  bip001rupperarm: 'rightShoulder',
  lowerarm_r: 'rightElbow',
  lowerarmr: 'rightElbow',
  lower_arm_r: 'rightElbow',
  r_forearm: 'rightElbow',
  r_lowerarm: 'rightElbow',
  rightforearm: 'rightElbow',
  right_forearm: 'rightElbow',
  rightlowerarm: 'rightElbow',
  right_lower_arm: 'rightElbow',
  bip01rforearm: 'rightElbow',
  bip001rforearm: 'rightElbow',
  hand_r: 'rightWrist',
  handr: 'rightWrist',
  r_hand: 'rightWrist',
  righthand: 'rightWrist',
  right_hand: 'rightWrist',
  rightwrist: 'rightWrist',
  bip01rhand: 'rightWrist',
  bip001rhand: 'rightWrist',
  // Left Leg
  thigh_l: 'leftHip',
  thighl: 'leftHip',
  l_thigh: 'leftHip',
  leftupleg: 'leftHip',
  left_up_leg: 'leftHip',
  leftupperleg: 'leftHip',
  left_upper_leg: 'leftHip',
  leftthigh: 'leftHip',
  bip01lthigh: 'leftHip',
  bip001lthigh: 'leftHip',
  calf_l: 'leftKnee',
  calfl: 'leftKnee',
  l_calf: 'leftKnee',
  shin_l: 'leftKnee',
  leftleg: 'leftKnee',
  left_leg: 'leftKnee',
  leftlowerleg: 'leftKnee',
  left_lower_leg: 'leftKnee',
  leftcalf: 'leftKnee',
  leftshin: 'leftKnee',
  bip01lcalf: 'leftKnee',
  bip001lcalf: 'leftKnee',
  foot_l: 'leftAnkle',
  footl: 'leftAnkle',
  l_foot: 'leftAnkle',
  leftfoot: 'leftAnkle',
  left_foot: 'leftAnkle',
  leftankle: 'leftAnkle',
  bip01lfoot: 'leftAnkle',
  bip001lfoot: 'leftAnkle',
  // Right Leg
  thigh_r: 'rightHip',
  thighr: 'rightHip',
  r_thigh: 'rightHip',
  rightupleg: 'rightHip',
  right_up_leg: 'rightHip',
  rightupperleg: 'rightHip',
  right_upper_leg: 'rightHip',
  rightthigh: 'rightHip',
  bip01rthigh: 'rightHip',
  bip001rthigh: 'rightHip',
  calf_r: 'rightKnee',
  calfr: 'rightKnee',
  r_calf: 'rightKnee',
  shin_r: 'rightKnee',
  rightleg: 'rightKnee',
  right_leg: 'rightKnee',
  rightlowerleg: 'rightKnee',
  right_lower_leg: 'rightKnee',
  rightcalf: 'rightKnee',
  rightshin: 'rightKnee',
  bip01rcalf: 'rightKnee',
  bip001rcalf: 'rightKnee',
  foot_r: 'rightAnkle',
  footr: 'rightAnkle',
  r_foot: 'rightAnkle',
  rightfoot: 'rightAnkle',
  right_foot: 'rightAnkle',
  rightankle: 'rightAnkle',
  bip01rfoot: 'rightAnkle',
  bip001rfoot: 'rightAnkle',
};

const AUX_BONE_ALIASES: Readonly<Record<string, AuxBoneRole>> = {
  spine_02: 'spineMid',
  spine02: 'spineMid',
  spine1: 'spineMid',
  spine_1: 'spineMid',
  bip01spine1: 'spineMid',
  bip001spine1: 'spineMid',
};

function canonicalizeRawBoneToken(rawName: string): string {
  // Strip Three.js track property suffix (.quaternion, .position, .bones[foo]) and rig namespaces (Armature|, mixamorig:, DEF-, etc.)
  let token = rawName.trim();
  const bonesMatch = token.match(/\.bones\[([^\]]+)\]/);
  if (bonesMatch) {
    token = bonesMatch[1];
  } else {
    const dotIdx = token.indexOf('.');
    if (dotIdx > 0) token = token.slice(0, dotIdx);
  }
  token = token
    .replace(/^.*\|/, '')
    .replace(/^.*\//, '')
    .replace(/^mixamorig\d*[:_-]*/i, '')
    .replace(/^(?:character\d*|armature|skeleton|rig|def|org|mch)[:_-]+/i, '')
    .replace(/\.(l|r)$/i, '_$1')
    .replace(/-(l|r)$/i, '_$1')
    .toLowerCase();

  // Normalize Bip01 spaces/underscores while keeping standard snake_case aliases recognizable
  if (token.startsWith('bip0')) {
    return token.replace(/[\s_-]+/g, '');
  }
  return token;
}

/**
 * Maps Mixamo (`mixamorig:Hips`, `mixamorigLeftForeArm`, etc.), Quaternius (`pelvis`, `upperarm_l`),
 * Unity/VRM Humanoid (`LeftUpperArm`, `RightLowerLeg`), and Biped bone names to our 17 semantic joints.
 */
export function normalizeHumanoidBoneName(rawName: string): Joint | null {
  if (!rawName) return null;
  const token = canonicalizeRawBoneToken(rawName);
  return BONE_ALIASES[token] ?? BONE_ALIASES[token.replace(/[\s_-]+/g, '')] ?? null;
}

function normalizeAuxBoneName(rawName: string): AuxBoneRole | null {
  if (!rawName) return null;
  const token = canonicalizeRawBoneToken(rawName);
  return AUX_BONE_ALIASES[token] ?? AUX_BONE_ALIASES[token.replace(/[\s_-]+/g, '')] ?? null;
}

interface NodeTransformSnapshot {
  node: T.Object3D;
  pos: T.Vector3;
  quat: T.Quaternion;
  scale: T.Vector3;
}

interface SourceRigProfile {
  sourceRoot: T.Object3D;
  mixer: T.AnimationMixer;
  rigFormat: 'quaternius' | 'mixamo' | 'humanoid';
  mappedNodes: Partial<Record<Joint, T.Object3D>>;
  spineMidNode: T.Object3D | null;
  mappedJoints: readonly Joint[];
  snapshots: readonly NodeTransformSnapshot[];
  restWorldPos: Partial<Record<Joint, T.Vector3>>;
  restWorldQuat: Partial<Record<Joint, T.Quaternion>>;
  restSpineMidWorldQuat: T.Quaternion | null;
  qAlign: T.Quaternion;
  qAlignInv: T.Quaternion;
  standingPelvisHeight: number;
  restPelvisCanY: number;
}

export interface InternalClipEvaluator {
  profile: SourceRigProfile;
  clip: T.AnimationClip;
  action: T.AnimationAction;
}

interface FbxTransformData {
  translation?: number[];
  preRotation?: number[];
  rotation?: number[];
  postRotation?: number[];
  scale?: number[];
  eulerOrder?: T.EulerOrder;
}

function tryApplyFbxZeroRotationRestPose(sourceRoot: T.Object3D): (() => void) | null {
  const modified: { node: T.Object3D; prevQuat: T.Quaternion; prevPos: T.Vector3 }[] = [];
  let count = 0;
  sourceRoot.traverse((node) => {
    const td = (node.userData as { transformData?: FbxTransformData } | undefined)?.transformData;
    if (!td || (!(node instanceof T.Bone) && !normalizeHumanoidBoneName(node.name))) return;
    if (!td.preRotation && !td.postRotation && !td.rotation) return;
    count++;
    const prevQuat = node.quaternion.clone();
    const prevPos = node.position.clone();
    const qPre = td.preRotation
      ? new T.Quaternion().setFromEuler(
          new T.Euler(
            T.MathUtils.degToRad(td.preRotation[0] ?? 0),
            T.MathUtils.degToRad(td.preRotation[1] ?? 0),
            T.MathUtils.degToRad(td.preRotation[2] ?? 0),
            'ZYX',
          ),
        )
      : new T.Quaternion();
    const qPost = td.postRotation
      ? new T.Quaternion()
          .setFromEuler(
            new T.Euler(
              T.MathUtils.degToRad(td.postRotation[0] ?? 0),
              T.MathUtils.degToRad(td.postRotation[1] ?? 0),
              T.MathUtils.degToRad(td.postRotation[2] ?? 0),
              'ZYX',
            ),
          )
          .invert()
      : new T.Quaternion();
    node.quaternion.copy(qPre.multiply(qPost));
    if (td.translation && td.translation.length === 3) {
      node.position.set(td.translation[0], td.translation[1], td.translation[2]);
    }
    modified.push({ node, prevQuat, prevPos });
  });

  if (count === 0) return null;
  sourceRoot.updateMatrixWorld(true);
  return () => {
    for (const item of modified) {
      item.node.quaternion.copy(item.prevQuat);
      item.node.position.copy(item.prevPos);
    }
    sourceRoot.updateMatrixWorld(true);
  };
}

function detectRigFormat(sourceRoot: T.Object3D): 'quaternius' | 'mixamo' | 'humanoid' {
  let hasMixamo = false;
  let hasQuaternius = false;
  sourceRoot.traverse((n) => {
    if (/mixamorig/i.test(n.name)) hasMixamo = true;
    if (n.name === 'upperarm_l' || n.name === 'thigh_l' || n.name === 'spine_03') hasQuaternius = true;
  });
  if (hasMixamo) return 'mixamo';
  if (hasQuaternius) return 'quaternius';
  return 'humanoid';
}

function buildSourceRigProfile(sourceRoot: T.Object3D): SourceRigProfile {
  // Three.js PropertyBinding treats ':' as a sub-node delimiter; normalize literal Mixamo colons ('mixamorig:LeftArm') to '_'.
  sourceRoot.traverse((node) => {
    if (node.name.includes(':')) {
      node.name = node.name.replace(/:/g, '_');
    }
  });
  sourceRoot.updateMatrixWorld(true);

  const snapshots: NodeTransformSnapshot[] = [];
  const mappedNodes: Partial<Record<Joint, T.Object3D>> = {};
  let spineMidNode: T.Object3D | null = null;
  let primarySkin: T.SkinnedMesh | null = null;

  sourceRoot.traverse((node) => {
    snapshots.push({
      node,
      pos: node.position.clone(),
      quat: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
    if ((node as T.SkinnedMesh).isSkinnedMesh) {
      const candidate = node as T.SkinnedMesh;
      if (!primarySkin || (candidate.skeleton?.bones.length ?? 0) > (primarySkin.skeleton?.bones.length ?? 0)) {
        primarySkin = candidate;
      }
    }
    const joint = normalizeHumanoidBoneName(node.name);
    if (joint && (!mappedNodes[joint] || node instanceof T.Bone)) {
      // If both chest ('spine1'/'chest') and upperchest ('spine2') exist, prefer the deeper thoracic bone for 'chest'.
      if (joint === 'chest' && mappedNodes.chest) {
        const prevToken = canonicalizeRawBoneToken(mappedNodes.chest.name);
        const nextToken = canonicalizeRawBoneToken(node.name);
        if (prevToken === 'spine_03' || prevToken === 'spine2' || prevToken === 'upperchest') return;
        if (nextToken === 'spine_03' || nextToken === 'spine2' || nextToken === 'upperchest') {
          mappedNodes.chest = node;
          return;
        }
      }
      if (!mappedNodes[joint]) mappedNodes[joint] = node;
    }
    const aux = normalizeAuxBoneName(node.name);
    if (aux === 'spineMid' && !spineMidNode) {
      spineMidNode = node;
    }
  });

  // Fallback for 2-spine rigs that use `spine` + `spine1` without `spine2`: promote `spineMid` to `chest`.
  if (!mappedNodes.chest && spineMidNode) {
    mappedNodes.chest = spineMidNode;
    spineMidNode = null;
  }

  const mappedJoints = JOINTS.filter((j) => Boolean(mappedNodes[j]));
  if (mappedJoints.length < 5 || !mappedNodes.hips) {
    throw new Error('No recognizable humanoid skeleton found (expected Mixamo, Quaternius, or glTF humanoid bones).');
  }

  const restWorldPos: Partial<Record<Joint, T.Vector3>> = {};
  const restWorldQuat: Partial<Record<Joint, T.Quaternion>> = {};
  let restSpineMidWorldQuat: T.Quaternion | null = null;

  // Tier 1: Exact bind-pose world matrices from SkinnedMesh.skeleton.boneInverses when available.
  const skin = primarySkin as T.SkinnedMesh | null;
  if (skin?.skeleton) {
    const readFromSkin = (node: T.Object3D): { pos: T.Vector3; quat: T.Quaternion } | null => {
      const idx = skin.skeleton.bones.indexOf(node as T.Bone);
      if (idx < 0 || !skin.skeleton.boneInverses[idx]) return null;
      const worldMat = skin.skeleton.boneInverses[idx].clone().invert();
      const pos = new T.Vector3();
      const quat = new T.Quaternion();
      const scale = new T.Vector3();
      worldMat.decompose(pos, quat, scale);
      return { pos, quat: quat.normalize() };
    };
    for (const joint of mappedJoints) {
      const info = readFromSkin(mappedNodes[joint]!);
      if (info) {
        restWorldPos[joint] = info.pos;
        restWorldQuat[joint] = info.quat;
      }
    }
    if (spineMidNode) {
      restSpineMidWorldQuat = readFromSkin(spineMidNode)?.quat ?? null;
    }
  }

  // Tier 2: Skinless FBX ("Without Skin" Mixamo downloads) — reconstruct zero-Lcl_Rotation rest pose via PreRotation/PostRotation.
  let restoreFbxPose: (() => void) | null = null;
  if (!skin) {
    restoreFbxPose = tryApplyFbxZeroRotationRestPose(sourceRoot);
  }

  // Tier 3: Fill any remaining joints from current hierarchy rest state.
  for (const joint of mappedJoints) {
    const node = mappedNodes[joint]!;
    if (!restWorldPos[joint]) restWorldPos[joint] = node.getWorldPosition(new T.Vector3());
    if (!restWorldQuat[joint]) restWorldQuat[joint] = node.getWorldQuaternion(new T.Quaternion()).normalize();
  }
  if (spineMidNode && !restSpineMidWorldQuat) {
    restSpineMidWorldQuat = (spineMidNode as T.Object3D).getWorldQuaternion(new T.Quaternion()).normalize();
  }

  if (restoreFbxPose) restoreFbxPose();

  // Compute canonical rig-to-app basis alignment (+X anatomical left, +Y up, +Z forward).
  const hipsPos = restWorldPos.hips!;
  const topAnchor = restWorldPos.head ?? restWorldPos.neck ?? restWorldPos.chest ?? restWorldPos.spine;
  const upRaw = topAnchor ? topAnchor.clone().sub(hipsPos) : new T.Vector3(0, 1, 0);
  const upSrc = upRaw.lengthSq() > 1e-6 ? upRaw.normalize() : new T.Vector3(0, 1, 0);

  const leftAnchor = restWorldPos.leftShoulder ?? restWorldPos.leftHip;
  const rightAnchor = restWorldPos.rightShoulder ?? restWorldPos.rightHip;
  const leftRaw = leftAnchor && rightAnchor ? leftAnchor.clone().sub(rightAnchor) : new T.Vector3(1, 0, 0);
  leftRaw.addScaledVector(upSrc, -leftRaw.dot(upSrc));
  const leftSrc = leftRaw.lengthSq() > 1e-6 ? leftRaw.normalize() : new T.Vector3(1, 0, 0);
  const fwdSrc = new T.Vector3().crossVectors(leftSrc, upSrc).normalize();

  const basisSrc = new T.Matrix4().makeBasis(leftSrc, upSrc, fwdSrc);
  const qAlign = new T.Quaternion().setFromRotationMatrix(basisSrc.invert()).normalize();
  const qAlignInv = qAlign.clone().invert();

  const restPelvisCanY = hipsPos.clone().applyQuaternion(qAlign).y;
  const leftAnkleCanY = restWorldPos.leftAnkle ? restWorldPos.leftAnkle.clone().applyQuaternion(qAlign).y : 0;
  const rightAnkleCanY = restWorldPos.rightAnkle ? restWorldPos.rightAnkle.clone().applyQuaternion(qAlign).y : 0;
  const approxFloorY = restWorldPos.leftAnkle || restWorldPos.rightAnkle ? Math.min(leftAnkleCanY, rightAnkleCanY) - 0.08 : 0;
  const standingPelvisHeight = Math.max(0.35, restPelvisCanY - approxFloorY);

  return {
    sourceRoot,
    mixer: new T.AnimationMixer(sourceRoot),
    rigFormat: detectRigFormat(sourceRoot),
    mappedNodes,
    spineMidNode,
    mappedJoints,
    snapshots,
    restWorldPos,
    restWorldQuat,
    restSpineMidWorldQuat,
    qAlign,
    qAlignInv,
    standingPelvisHeight,
    restPelvisCanY,
  };
}

function restoreSourceSnapshots(profile: SourceRigProfile): void {
  for (const snap of profile.snapshots) {
    snap.node.position.copy(snap.pos);
    snap.node.quaternion.copy(snap.quat);
    snap.node.scale.copy(snap.scale);
  }
  profile.sourceRoot.updateMatrixWorld(true);
}

function inferClipFps(clip: T.AnimationClip): number {
  const deltas: number[] = [];
  for (const track of clip.tracks) {
    const times = track.times;
    for (let i = 1; i < Math.min(times.length, 25); i++) {
      const dt = times[i] - times[i - 1];
      if (dt > 1e-4 && dt < 0.5) deltas.push(dt);
    }
    if (deltas.length >= 20) break;
  }
  if (deltas.length === 0) return 30;
  deltas.sort((a, b) => a - b);
  const medianDt = deltas[Math.floor(deltas.length / 2)];
  const rawFps = Math.round(1 / medianDt);
  if (rawFps >= 23 && rawFps <= 25) return 24;
  if (rawFps >= 28 && rawFps <= 32) return 30;
  if (rawFps >= 58 && rawFps <= 62) return 60;
  return Math.min(120, Math.max(12, rawFps || 30));
}

function cleanClipDisplayName(rawName: string, fallback: string): string {
  const stripped = rawName
    .replace(/^.*\|/, '')
    .replace(/^mixamo\.com$/i, '')
    .trim();
  if (!stripped) return fallback;
  return stripped.replace(/_/g, ' ');
}

function slugifyId(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'clip'
  );
}

const profileCache = new WeakMap<T.Object3D, SourceRigProfile>();

export function createAnimationClipFromThree(
  sourceRoot: T.Object3D,
  clip: T.AnimationClip,
  options?: {
    id?: string;
    name?: string;
    source?: 'builtin' | 'file';
    fps?: number;
    loop?: boolean;
  },
): AnimationCycleClip {
  let profile = profileCache.get(sourceRoot);
  if (!profile) {
    profile = buildSourceRigProfile(sourceRoot);
    profileCache.set(sourceRoot, profile);
  }

  const duration = Math.max(0, Number.isFinite(clip.duration) ? clip.duration : 0);
  const fps = options?.fps ?? inferClipFps(clip);
  const frameCount = duration <= 1e-5 ? 1 : Math.max(2, Math.round(duration * fps) + 1);
  const displayName = options?.name ?? cleanClipDisplayName(clip.name, 'Imported Animation');
  const loop = options?.loop ?? /loop|walk|run|jog|sprint|idle|dance|crouch/i.test(clip.name || displayName);

  let safeClip = clip;
  if (clip.tracks.some((t) => t.name.includes(':'))) {
    const clonedTracks = clip.tracks.map((t) => {
      const cloned = t.clone();
      cloned.name = cloned.name.replace(/:/g, '_');
      return cloned;
    });
    safeClip = new T.AnimationClip(clip.name, clip.duration, clonedTracks);
  }

  const action = profile.mixer.clipAction(safeClip);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;

  return {
    id: options?.id ?? slugifyId(displayName),
    name: displayName,
    source: options?.source ?? 'file',
    duration,
    fps,
    frameCount,
    loop,
    mappedJoints: profile.mappedJoints,
    rigFormat: profile.rigFormat,
    _evaluator: {
      profile,
      clip: safeClip,
      action,
    },
  };
}

function clampAngleRad(rad: number): number {
  if (!Number.isFinite(rad) || Math.abs(rad) < 1e-12) return 0;
  return Math.max(-Math.PI * 2, Math.min(Math.PI * 2, rad));
}

/**
 * Samples an animation cycle at a discrete frame index (`0 .. frameCount - 1`) or normalized `[0..1]` time
 * and retargets it into our character's 17-joint semantic `Pose` space (relative to the arms-down neutral pose).
 */
export function extractPoseAtFrame(
  clip: AnimationCycleClip,
  frameOrNormalizedTime: number,
  options?: ExtractPoseOptions,
): ExtractedFramePose {
  const { profile, action } = clip._evaluator;
  const body: Body = options?.body ?? options?.figure?.body ?? 'male';
  const cal = getTargetCalibration(body);

  let frame: number;
  let normalizedTime: number;
  if (clip.frameCount <= 1 || clip.duration <= 1e-5) {
    frame = 0;
    normalizedTime = 0;
  } else if (options?.normalized) {
    normalizedTime = Math.max(0, Math.min(1, Number.isFinite(frameOrNormalizedTime) ? frameOrNormalizedTime : 0));
    frame = Math.round(normalizedTime * (clip.frameCount - 1));
  } else {
    const clampedFrame = Math.max(
      0,
      Math.min(clip.frameCount - 1, Math.round(Number.isFinite(frameOrNormalizedTime) ? frameOrNormalizedTime : 0)),
    );
    frame = clampedFrame;
    normalizedTime = frame / (clip.frameCount - 1);
  }
  const timeSeconds = normalizedTime * clip.duration;

  // Statelessly evaluate source skeleton at timeSeconds.
  profile.mixer.stopAllAction();
  restoreSourceSnapshots(profile);
  action.reset();
  action.play();
  profile.mixer.setTime(timeSeconds);
  profile.sourceRoot.updateMatrixWorld(true);

  // Reset target calibration rig to neutral rest pose before top-down solve.
  for (const joint of JOINTS) {
    cal.bones[joint].quaternion.copy(cal.restRotations[joint]);
  }
  cal.root.updateMatrixWorld(true);

  // Compute canonical delta for optional intermediate spine bone (`spine_02` / `mixamorigSpine1`) so waist and chest share bend smoothly.
  let spineMidDeltaCan: T.Quaternion | null = null;
  if (profile.spineMidNode && profile.restSpineMidWorldQuat) {
    const wMidAnim = profile.spineMidNode.getWorldQuaternion(new T.Quaternion());
    const dMidSrc = wMidAnim.multiply(profile.restSpineMidWorldQuat.clone().invert());
    spineMidDeltaCan = profile.qAlign.clone().multiply(dMidSrc).multiply(profile.qAlignInv).normalize();
  }

  const pose = {} as Pose;
  for (const joint of JOINTS) {
    const srcNode = profile.mappedNodes[joint];
    const srcRestQuat = profile.restWorldQuat[joint];
    if (!srcNode || !srcRestQuat) {
      pose[joint] = [0, 0, 0];
      continue;
    }

    const wSrcAnim = srcNode.getWorldQuaternion(new T.Quaternion());
    const deltaSrc = wSrcAnim.multiply(srcRestQuat.clone().invert());
    const deltaCan = profile.qAlign.clone().multiply(deltaSrc).multiply(profile.qAlignInv).normalize();

    if (joint === 'spine' && spineMidDeltaCan) {
      deltaCan.slerp(spineMidDeltaCan, 0.5).normalize();
    }

    // Account for any rest-pose limb angle difference (e.g. A-pose vs horizontal T-pose) on limb segments.
    const childJoint = PRIMARY_LIMB_CHILD[joint];
    let cRest = new T.Quaternion();
    if (childJoint && profile.restWorldPos[joint] && profile.restWorldPos[childJoint] && cal.tposeDirs[joint]) {
      const dirSrcCan = profile.restWorldPos[childJoint]!
        .clone()
        .sub(profile.restWorldPos[joint]!)
        .normalize()
        .applyQuaternion(profile.qAlign);
      if (dirSrcCan.lengthSq() > 0.5) {
        cRest = new T.Quaternion().setFromUnitVectors(cal.tposeDirs[joint]!, dirSrcCan);
      }
    }

    const desiredWorld = deltaCan.multiply(cRest).multiply(cal.tposeWorldQuat[joint]).normalize();
    const targetBone = cal.bones[joint];
    const parentWorld = targetBone.parent!.getWorldQuaternion(new T.Quaternion());
    targetBone.quaternion.copy(parentWorld.invert().multiply(desiredWorld).normalize());
    targetBone.updateMatrixWorld(true);

    const useMorphologyRetarget = Boolean(
      options?.figure?.morphology && !options.figure.morphology.isCanonicalMannequin,
    );
    const restRot = useMorphologyRetarget
      ? cal.restRotations[joint]
      : (options?.figure?.restRotations[joint] ?? cal.restRotations[joint]);
    const basis = useMorphologyRetarget
      ? cal.rotationBases[joint]
      : (options?.figure?.rotationBases[joint] ?? cal.rotationBases[joint]);
    const localDelta = restRot.clone().invert().multiply(targetBone.quaternion);
    const semanticQuat = basis.clone().invert().multiply(localDelta).multiply(basis).normalize();
    const euler = new T.Euler().setFromQuaternion(semanticQuat, 'XYZ');
    pose[joint] = [
      clampAngleRad(euler.x),
      clampAngleRad(euler.y),
      clampAngleRad(euler.z),
    ] as Vec3;
  }

  const targetMorphology = options?.figure?.morphology;
  const finalPose =
    targetMorphology && !targetMorphology.isCanonicalMannequin
      ? adaptCanonicalPoseToMorphology(pose, targetMorphology)
      : pose;

  cal.root.updateMatrixWorld(true);

  // Compute floor-grounded vertical root offset (`suggestedRootY`) from scaled pelvis vertical motion.
  let suggestedRootY = 0;
  const hipsNode = profile.mappedNodes.hips;
  if (hipsNode) {
    const animPelvisCanY = hipsNode.getWorldPosition(new T.Vector3()).applyQuaternion(profile.qAlign).y;
    const scaleRatio = cal.standingPelvisY / profile.standingPelvisHeight;
    const rawDeltaY = (animPelvisCanY - profile.restPelvisCanY) * scaleRatio;

    // Prevent posed ankles/knees from sinking below floor plane y = 0 on grounded cycles while preserving jump lift and crouch/sit drop.
    const posedLeftAnkleY = cal.bones.leftAnkle.getWorldPosition(new T.Vector3()).y - cal.standingAnkleY;
    const posedRightAnkleY = cal.bones.rightAnkle.getWorldPosition(new T.Vector3()).y - cal.standingAnkleY;
    const posedLeftKneeY = cal.bones.leftKnee.getWorldPosition(new T.Vector3()).y - 0.04;
    const posedRightKneeY = cal.bones.rightKnee.getWorldPosition(new T.Vector3()).y - 0.04;
    const posedHipsY = cal.bones.hips.getWorldPosition(new T.Vector3()).y - 0.08;
    const lowestLocalSupportY = Math.min(posedLeftAnkleY, posedRightAnkleY, posedLeftKneeY, posedRightKneeY, posedHipsY);

    suggestedRootY = Math.max(-lowestLocalSupportY, rawDeltaY);
    suggestedRootY = Math.max(-2, Math.min(5, Math.round(suggestedRootY * 10000) / 10000));
  }

  action.stop();
  restoreSourceSnapshots(profile);

  return {
    pose: finalPose,
    frame,
    normalizedTime,
    timeSeconds,
    suggestedRootY,
  };
}

function ensureProgressEventPolyfill(): void {
  const g = globalThis as { ProgressEvent?: unknown };
  if (typeof g.ProgressEvent === 'undefined') {
    class NodeProgressEvent extends Event {
      lengthComputable = false;
      loaded = 0;
      total = 0;
      constructor(type: string, init?: { lengthComputable?: boolean; loaded?: number; total?: number }) {
        super(type);
        if (init) {
          this.lengthComputable = Boolean(init.lengthComputable);
          this.loaded = init.loaded ?? 0;
          this.total = init.total ?? 0;
        }
      }
    }
    g.ProgressEvent = NodeProgressEvent;
  }
}

function detectFormatFromBuffer(buffer: ArrayBuffer, fileName: string): 'fbx' | 'gltf' {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.fbx')) return 'fbx';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'gltf';

  if (buffer.byteLength >= 18) {
    const headerBytes = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength));
    const headerAscii = String.fromCharCode(...headerBytes);
    if (headerAscii.startsWith('Kaydara FBX Binary')) return 'fbx';
    if (headerAscii.startsWith('glTF') || headerAscii.trimStart().startsWith('{')) return 'gltf';
    if (headerAscii.includes('FBXHeaderExtension')) return 'fbx';
  }
  throw new Error(`Unsupported animation file "${fileName}". Expected a Mixamo or humanoid .fbx, .glb, or .gltf file.`);
}

export async function parseAnimationBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options?: { source?: 'builtin' | 'file' },
): Promise<AnimationCycleClip[]> {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error(`Animation file "${fileName}" is empty.`);
  }
  if (buffer.byteLength > MAX_ANIMATION_FILE_BYTES) {
    throw new Error(`Animation file "${fileName}" exceeds the 50 MB limit.`);
  }

  ensureProgressEventPolyfill();
  const format = detectFormatFromBuffer(buffer, fileName);
  const baseLabel = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported Animation';

  let sourceRoot: T.Object3D;
  let rawClips: T.AnimationClip[];

  if (format === 'fbx') {
    const parsed = new FBXLoader().parse(buffer, '');
    sourceRoot = parsed;
    rawClips = parsed.animations ?? [];
  } else {
    const parsed = await new GLTFLoader().parseAsync(buffer, '');
    sourceRoot = parsed.scene;
    rawClips = parsed.animations ?? [];
  }

  if (rawClips.length === 0) {
    throw new Error(`No animation clips were found in "${fileName}". Export the Mixamo or glTF file with animation keyframes included.`);
  }

  return rawClips.map((clip, index) => {
    const fallbackName = rawClips.length === 1 ? baseLabel : `${baseLabel} ${index + 1}`;
    const cleaned = cleanClipDisplayName(clip.name, fallbackName);
    const id = `${slugifyId(baseLabel)}-${index}-${slugifyId(cleaned)}`;
    return createAnimationClipFromThree(sourceRoot, clip, {
      id,
      name: cleaned,
      source: options?.source ?? 'file',
    });
  });
}

export async function loadUserAnimationFile(file: File): Promise<AnimationCycleClip[]> {
  if (!file) throw new Error('No animation file provided.');
  if (file.size === 0) throw new Error(`Animation file "${file.name}" is empty.`);
  if (file.size > MAX_ANIMATION_FILE_BYTES) {
    throw new Error(`Animation file "${file.name}" exceeds the 50 MB limit.`);
  }
  const lower = file.name.trim().toLowerCase();
  if (!lower.endsWith('.fbx') && !lower.endsWith('.glb') && !lower.endsWith('.gltf')) {
    throw new Error(`Unsupported file "${file.name}". Choose a .fbx, .glb, or .gltf animation file.`);
  }
  const buffer = await file.arrayBuffer();
  return parseAnimationBuffer(buffer, file.name, { source: 'file' });
}

let builtinBundlePromise: Promise<Map<string, AnimationCycleClip>> | null = null;

async function fetchBuiltinUalBuffer(): Promise<ArrayBuffer> {
  const baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const assetUrl = `${normalizedBase}models/animations/quaternius-ual1/UAL1_Standard.glb`;

  // In Node / Vitest without a running HTTP server, read directly from public/models/animations/quaternius-ual1/.
  const proc = (globalThis as { process?: { versions?: { node?: string }; cwd?: () => string } }).process;
  if (proc?.versions?.node && typeof window === 'undefined') {
    const fsSpec = 'node:fs/promises';
    const pathSpec = 'node:path';
    const fsMod = (await import(/* @vite-ignore */ fsSpec)) as { readFile: (p: string) => Promise<Uint8Array> };
    const pathMod = (await import(/* @vite-ignore */ pathSpec)) as { resolve: (...parts: string[]) => string };
    const diskPath = pathMod.resolve(proc.cwd?.() ?? '.', 'public', 'models', 'animations', 'quaternius-ual1', 'UAL1_Standard.glb');
    const bytes = await fsMod.readFile(diskPath);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to load built-in animation library (${response.status} ${response.statusText}).`);
  }
  return response.arrayBuffer();
}

async function loadBuiltinBundleMap(): Promise<Map<string, AnimationCycleClip>> {
  if (!builtinBundlePromise) {
    builtinBundlePromise = (async () => {
      ensureProgressEventPolyfill();
      const buffer = await fetchBuiltinUalBuffer();
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      const byRawName = new Map<string, T.AnimationClip>();
      for (const clip of gltf.animations) {
        byRawName.set(clip.name, clip);
      }

      const result = new Map<string, AnimationCycleClip>();
      for (const info of BUILTIN_ANIMATION_CYCLES) {
        const rawClip = byRawName.get(info.sourceClipName);
        if (!rawClip) {
          throw new Error(`Built-in animation clip "${info.sourceClipName}" is missing from UAL1_Standard.glb.`);
        }
        result.set(
          info.id,
          createAnimationClipFromThree(gltf.scene, rawClip, {
            id: info.id,
            name: info.name,
            source: 'builtin',
            loop: info.loop,
          }),
        );
      }
      return result;
    })().catch((err) => {
      builtinBundlePromise = null;
      throw err;
    });
  }
  return builtinBundlePromise;
}

export async function loadBuiltinAnimationCycle(id: string): Promise<AnimationCycleClip> {
  const bundle = await loadBuiltinBundleMap();
  const clip = bundle.get(id);
  if (!clip) {
    const validIds = BUILTIN_ANIMATION_CYCLES.map((c) => c.id).join(', ');
    throw new Error(`Unknown built-in animation cycle "${id}". Available cycles: ${validIds}`);
  }
  return clip;
}

export async function loadAllBuiltinAnimationCycles(): Promise<AnimationCycleClip[]> {
  const bundle = await loadBuiltinBundleMap();
  return BUILTIN_ANIMATION_CYCLES.map((info) => bundle.get(info.id)!);
}
