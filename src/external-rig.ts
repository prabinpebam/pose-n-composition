import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_HAIR_COLOR, JOINTS, neutralPose, type Body, type Joint } from './model';
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
  // The source's Eyebrows surface includes both brows and modeled eyelashes.
  const brows = skins.find(s => s.name === 'Eyebrows');
  if (!brows) throw new Error(`The ${body} asset is missing its eyebrows and eyelashes.`);
  const hairMaterials = (Array.isArray(brows.material) ? brows.material : [brows.material]).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
  if (!hairMaterials.length) throw new Error(`The ${body} asset has no editable eyebrow material.`);
  hairMaterials.forEach(m => { m.map = null; m.color.set(DEFAULT_HAIR_COLOR); m.roughness = 0.8; m.metalness = 0; m.needsUpdate = true; });
  const scalp = makeScalp(body, skin, bones.head);
  bones.head.attach(scalp);
  hairMaterials.push(scalp.material);
  const figure = { root, skin, skins, bones, restRotations, rotationBases, tintMaterials, hairMaterials };
  setFigurePose(figure, neutralPose());
  return figure;
}

function makeScalp(body: Body, skin: T.SkinnedMesh, head: T.Bone): T.Mesh<T.BufferGeometry, T.MeshStandardMaterial> {
  skin.skeleton.update();
  const positions = skin.geometry.getAttribute('position'), joints = skin.geometry.getAttribute('skinIndex'), weights = skin.geometry.getAttribute('skinWeight');
  const headIndex = skin.skeleton.bones.indexOf(head), points: T.Vector3[] = [], headVertices: boolean[] = [];
  for (let i = 0; i < positions.count; i++) {
    let weight = 0;
    for (let j = 0; j < 4; j++) if (joints.getComponent(i, j) === headIndex) weight += weights.getComponent(i, j);
    headVertices.push(weight > 0.8);
    points.push(skin.getVertexPosition(i, new T.Vector3()).applyMatrix4(skin.matrixWorld));
  }
  const bounds = new T.Box3().setFromPoints(points.filter((_, i) => headVertices[i]));
  if (bounds.isEmpty()) throw new Error(`Cannot fit hair to the ${body} head geometry.`);
  const indices: number[] = [], source = skin.geometry.index;
  for (let i = 0; i < (source?.count ?? positions.count); i += 3) {
    const face = [0, 1, 2].map(j => source ? source.getX(i + j) : i + j);
    if (face.every(v => headVertices[v])) indices.push(...face);
  }
  const surface = new T.BufferGeometry();
  surface.setAttribute('position', new T.Float32BufferAttribute(points.flatMap(p => p.toArray()), 3));
  surface.setIndex(indices);
  const surfaceMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide });
  const mesh = new T.Mesh(surface, surfaceMaterial), center = bounds.getCenter(new T.Vector3());
  const ray = new T.Raycaster(), vertices: number[] = [], triangles: number[] = [];
  const segments = 64, rings = 20, female = body === 'female';
  try {
    for (let row = 0; row <= rings; row++) for (let col = 0; col <= segments; col++) {
      const phi = col / segments * Math.PI * 2, front = Math.cos(phi);
      const edge = front > 0
        ? T.MathUtils.lerp(1.45, 1.05, front * front)
        : T.MathUtils.lerp(1.45, female ? 2.45 : 2.2, front * front);
      const theta = Math.max(0.001, row / rings * edge);
      const direction = new T.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
      ray.set(center.clone().addScaledVector(direction, 0.4), direction.clone().negate());
      const hit = ray.intersectObject(mesh)[0];
      if (!hit) throw new Error(`Could not fit ${body} scalp hair to the source head surface.`);
      const volume = (female ? 0.012 : 0.006) + 0.004 * Math.sin(theta) + 0.008 * Math.max(0, front) * Math.sin(theta * 1.5);
      const strands = 0.0012 * Math.cos(phi * 44 + theta * 5) * Math.sin(theta);
      vertices.push(...hit.point.addScaledVector(direction, volume + strands).toArray());
      if (row > 0 && col > 0) {
        const a = row * (segments + 1) + col, b = a - segments - 1;
        triangles.push(b - 1, a - 1, b, b, a - 1, a);
      }
    }
  } finally { surface.dispose(); surfaceMaterial.dispose(); }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(triangles); geometry.computeVertexNormals();
  const parts = [geometry];
  for (let strand = 0; strand < 32; strand++) {
    const path: T.Vector3[] = [];
    for (let row = 3; row <= rings; row++) {
      const column = (strand * 2 + (1 - row / rings) * 5) % segments;
      const a = new T.Vector3().fromArray(vertices, (row * (segments + 1) + Math.floor(column)) * 3);
      const b = new T.Vector3().fromArray(vertices, (row * (segments + 1) + Math.floor(column) + 1) * 3);
      const point = a.lerp(b, column % 1);
      path.push(point.addScaledVector(point.clone().sub(center).normalize(), 0.0007));
    }
    const ridge = new T.TubeGeometry(new T.CatmullRomCurve3(path), 20, female ? 0.0012 : 0.001, 4, false);
    ridge.deleteAttribute('uv'); parts.push(ridge);
  }
  const combined = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!combined) throw new Error(`Could not assemble the ${body} scalp hair.`);
  const scalp = new T.Mesh(combined, new T.MeshStandardMaterial({ color: DEFAULT_HAIR_COLOR, roughness: 0.8, side: T.DoubleSide }));
  scalp.name = 'Scalp hair'; scalp.castShadow = true; scalp.receiveShadow = true;
  return scalp;
}
