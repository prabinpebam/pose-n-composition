import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { JOINTS, neutralPose, type Body, type Joint } from './model';
import { setFigurePose, type Figure } from './rig';

export const SOURCE_BONES: Record<Joint, string> = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
  leftShoulder: 'upperarm_l', leftElbow: 'lowerarm_l', leftWrist: 'hand_l',
  rightShoulder: 'upperarm_r', rightElbow: 'lowerarm_r', rightWrist: 'hand_r',
  leftHip: 'thigh_l', leftKnee: 'calf_l', leftAnkle: 'foot_l',
  rightHip: 'thigh_r', rightKnee: 'calf_r', rightAnkle: 'foot_r',
};
const templates = new Map<Body, T.Group>();
let loading: Promise<void> | null = null;
export function loadExternalFigures(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all((['male', 'female'] as const).map(async body => {
    if (templates.has(body)) return;
    const name = body === 'male' ? 'Male' : 'Female';
    const path = `${import.meta.env.BASE_URL}models/external/quaternius-universal-base/Superhero_${name}_FullBody.gltf`;
    try {
      const gltf = await loader.loadAsync(path);
      templates.set(body, gltf.scene);
    } catch (error) {
      throw new Error(`Could not load ${body} figure assets. Check the connection and retry. ${error instanceof Error ? error.message : String(error)}`);
    }
  })).then(() => undefined).catch(error => { loading = null; throw error; });
  return loading;
}
export function makeExternalFigure(body: Body, color: string): Figure {
  const template = templates.get(body);
  if (!template) throw new Error(`${body} figure assets are not loaded. Retry loading the studio.`);
  return buildExternalFigure(body, template, color);
}
export function buildExternalFigure(body: Body, template: T.Group, color: string): Figure {
  const root = new T.Group(), model = cloneSkeleton(template);
  root.add(model);
  const allBones = new Map<string, T.Bone>(), skins: T.SkinnedMesh[] = [];
  model.traverse(node => {
    if (node instanceof T.Bone) allBones.set(node.name, node);
    if (node instanceof T.Mesh) {
      node.geometry = node.geometry.clone();
      node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
      node.castShadow = true; node.receiveShadow = true;
    }
    if (node instanceof T.SkinnedMesh) { node.frustumCulled = false; skins.push(node); }
  });
  if (!skins.length) throw new Error(`The ${body} asset contains no skinned body mesh.`);
  const bones = Object.fromEntries(JOINTS.map(j => {
    const bone = allBones.get(SOURCE_BONES[j]);
    if (!bone) throw new Error(`The ${body} asset is missing required joint ${SOURCE_BONES[j]}.`);
    return [j, bone];
  })) as Record<Joint, T.Bone>;
  root.updateMatrixWorld(true);
  const left = bones.leftShoulder.getWorldPosition(new T.Vector3()).sub(bones.rightShoulder.getWorldPosition(new T.Vector3()));
  model.rotateOnWorldAxis(new T.Vector3(0, 1, 0), Math.atan2(left.z, left.x));
  root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(root), nativeHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) throw new Error(`The ${body} asset has invalid dimensions.`);
  model.scale.multiplyScalar((body === 'male' ? 1.85 : 1.75) / nativeHeight);
  root.updateMatrixWorld(true);
  bounds.setFromObject(root);
  model.position.add(new T.Vector3(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2));
  root.updateMatrixWorld(true);
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
  const restRotations = Object.fromEntries(JOINTS.map(j => [j, bones[j].quaternion.clone()])) as Record<Joint, T.Quaternion>;
  const rotationBases = Object.fromEntries(JOINTS.map(j => [j, bones[j].getWorldQuaternion(new T.Quaternion()).invert()])) as Record<Joint, T.Quaternion>;
  const skin = skins.reduce((a, b) => a.geometry.getAttribute('position').count > b.geometry.getAttribute('position').count ? a : b);
  const tintMaterials = (Array.isArray(skin.material) ? skin.material : [skin.material]).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
  tintMaterials.forEach(m => { m.color.set(color); m.roughness = 0.8; m.metalness = 0; });
  const figure = { root, skin, skins, bones, restRotations, rotationBases, tintMaterials };
  setFigurePose(figure, neutralPose());
  return figure;
}
