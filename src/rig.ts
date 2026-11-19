import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JOINTS, type Body, type Joint, type Pose } from './model';
import type { HairStyle } from './hair';

export interface Figure {
  body?: Body;
  root: T.Group; skin: T.SkinnedMesh; skins: T.SkinnedMesh[]; bones: Record<Joint, T.Bone>;
  restRotations: Record<Joint, T.Quaternion>; rotationBases: Record<Joint, T.Quaternion>;
  tintMaterials: T.MeshStandardMaterial[]; hairMaterials: T.MeshStandardMaterial[];
  headFromNative?: T.Matrix4; hairStyle?: HairStyle;
}
// Legacy regression fixture; the live studio exclusively loads the CC0 source rigs.
export function makeFigure(body: Body, color: string): Figure {
  const female = body === 'female';
  const shoulder = female ? 0.195 : 0.25, hip = female ? 0.125 : 0.105;
  const bones = Object.fromEntries(JOINTS.map(j => { const b = new T.Bone(); b.name = j; return [j, b]; })) as Record<Joint, T.Bone>;
  const link = (name: Joint, parent: Joint | null, x: number, y: number, z = 0) => {
    bones[name].position.set(x, y, z); if (parent) bones[parent].add(bones[name]);
  };
  link('hips', null, 0, 0.98);
  link('spine', 'hips', 0, 0.15); link('chest', 'spine', 0, 0.2);
  link('neck', 'chest', 0, 0.235); link('head', 'neck', 0, 0.12);
  for (const [prefix, sign] of [['left', 1], ['right', -1]] as const) {
    link(`${prefix}Shoulder`, 'chest', sign * shoulder, 0.16);
    link(`${prefix}Elbow`, `${prefix}Shoulder`, sign * 0.035, -0.29);
    link(`${prefix}Wrist`, `${prefix}Elbow`, 0, -0.26);
    link(`${prefix}Hip`, 'hips', sign * hip, -0.055);
    link(`${prefix}Knee`, `${prefix}Hip`, 0, -0.435);
    link(`${prefix}Ankle`, `${prefix}Knee`, 0, -0.425);
  }
  const root = new T.Group(); root.add(bones.hips); root.updateMatrixWorld(true);
  const parts: T.BufferGeometry[] = [];
  const part = (joint: Joint, geometry: T.BufferGeometry, position: T.Vector3, scale: T.Vector3, blend?: Joint) => {
    geometry.applyMatrix4(new T.Matrix4().compose(position, new T.Quaternion(), scale));
    const localPositions = geometry.getAttribute('position');
    const weights: number[] = [], indices: number[] = [];
    for (let i = 0; i < localPositions.count; i++) {
      // Torso transitions share weights, keeping the waist continuous when bent.
      const t = blend ? T.MathUtils.clamp((localPositions.getY(i) + 0.02) / 0.2, 0, 1) : 0;
      indices.push(JOINTS.indexOf(joint), blend ? JOINTS.indexOf(blend) : 0, 0, 0);
      weights.push(1 - t, t, 0, 0);
    }
    geometry.applyMatrix4(bones[joint].matrixWorld);
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
    parts.push(geometry);
  };
  const ellipsoid = (j: Joint, p: [number, number, number], s: [number, number, number]) =>
    part(j, new T.SphereGeometry(1, 24, 16), new T.Vector3(...p), new T.Vector3(...s));
  const limb = (upper: Joint, lower: Joint, end: Joint, length: number, total: number, radius: number, profile: number[][], offset = 0) => {
    const positions: number[] = [], uv: number[] = [], indices: number[] = [], skinIndices: number[] = [], weights: number[] = [];
    const segments = 32;
    for (let r = 0; r < profile.length; r++) {
      const [distance, width, depth = width] = profile[r];
      let a = upper, b = lower, blend = T.MathUtils.clamp((distance - length + 0.065) / 0.13, 0, 1);
      if (distance > total - 0.035) { a = lower; b = end; blend = T.MathUtils.clamp((distance - total + 0.035) / 0.055, 0, 1); }
      for (let s = 0; s <= segments; s++) {
        const angle = s / segments * Math.PI * 2;
        positions.push(Math.cos(angle) * width * radius + offset * T.MathUtils.clamp(distance / length, 0, 1), -distance, Math.sin(angle) * depth * radius);
        uv.push(s / segments, r / (profile.length - 1));
        skinIndices.push(JOINTS.indexOf(a), JOINTS.indexOf(b), 0, 0); weights.push(1 - blend, blend, 0, 0);
        if (r > 0 && s < segments) {
          const i = r * (segments + 1) + s, prev = i - segments - 1;
          indices.push(prev, prev + 1, i, i, prev + 1, i + 1);
        }
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals();
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndices, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
    g.applyMatrix4(bones[upper].matrixWorld); parts.push(g);
  };
  const torsoProfile = female
    ? [[0.10, -0.11], [0.18, -0.07], [0.192, 0.01], [0.16, 0.10], [0.13, 0.18], [0.145, 0.26], [0.18, 0.36], [0.18, 0.43], [0.12, 0.47]]
    : [[0.10, -0.11], [0.165, -0.07], [0.17, 0.01], [0.15, 0.10], [0.15, 0.18], [0.19, 0.26], [0.235, 0.36], [0.225, 0.43], [0.13, 0.47]];
  const torso = new T.LatheGeometry(torsoProfile.map(([r, y]) => new T.Vector2(r, y)), 40);
  torso.scale(1, 1, female ? 0.67 : 0.58);
  const torsoPos = torso.getAttribute('position'), tw: number[] = [], ti: number[] = [];
  for (let i = 0; i < torsoPos.count; i++) {
    const y = torsoPos.getY(i);
    const lower = y < 0.15 ? 'hips' : 'spine', upper = y < 0.15 ? 'spine' : 'chest';
    const t = T.MathUtils.clamp(y < 0.15 ? y / 0.15 : (y - 0.15) / 0.2, 0, 1);
    ti.push(JOINTS.indexOf(lower), JOINTS.indexOf(upper), 0, 0); tw.push(1 - t, t, 0, 0);
  }
  torso.applyMatrix4(bones.hips.matrixWorld);
  torso.setAttribute('skinIndex', new T.Uint16BufferAttribute(ti, 4));
  torso.setAttribute('skinWeight', new T.Float32BufferAttribute(tw, 4)); parts.push(torso);
  ellipsoid('neck', [0, 0.015, 0], [0.067, 0.11, 0.065]);
  ellipsoid('chest', [0, 0.16, -0.003], [female ? 0.105 : 0.13, 0.085, 0.075]);
  ellipsoid('head', [0, 0.045, 0], [female ? 0.102 : 0.112, 0.143, 0.107]);
  ellipsoid('head', [0, -0.035, 0.04], [0.077, 0.075, 0.082]);
  ellipsoid('head', [0, 0.025, 0.105], [0.021, 0.033, 0.027]);
  for (const sign of [-1, 1]) {
    ellipsoid('head', [sign * 0.108, 0.028, 0], [0.022, 0.04, 0.024]);
    if (female) ellipsoid('chest', [sign * 0.077, 0.025, 0.089], [0.084, 0.07, 0.057]);
    else ellipsoid('chest', [sign * 0.095, 0.025, 0.064], [0.108, 0.064, 0.055]);
    const p = sign === 1 ? 'left' : 'right';
    const arm = female ? 0.051 : 0.069, thigh = female ? 0.103 : 0.096;
    ellipsoid('chest', [sign * shoulder * 0.68, 0.135, -0.005], [shoulder * 0.49, 0.066, 0.073]);
    // One continuous surface per limb; adjacent bones share the joint neighborhood.
    limb(`${p}Shoulder`, `${p}Elbow`, `${p}Wrist`, 0.29, 0.55, arm,
      [[-0.045, 0], [-0.025, 0.8], [0, 1.12], [0.05, 1.04], [0.12, 0.94], [0.20, 0.82], [0.25, 0.68], [0.29, 0.66], [0.33, 0.7], [0.38, 0.72], [0.44, 0.61], [0.5, 0.48], [0.55, 0.43], [0.57, 0]], sign * 0.035);
    ellipsoid(`${p}Wrist`, [0, -0.045, 0.009], [0.042, 0.075, 0.025]);
    ellipsoid(`${p}Wrist`, [-sign * 0.034, -0.025, 0.018], [0.018, 0.04, 0.022]);
    limb(`${p}Hip`, `${p}Knee`, `${p}Ankle`, 0.435, 0.86, thigh,
      [[-0.07, 0], [-0.025, 0.75], [0.04, 1], [0.13, 1.02], [0.22, 0.93], [0.31, 0.77], [0.38, 0.64], [0.415, 0.61], [0.435, 0.60], [0.465, 0.61], [0.51, 0.69], [0.59, 0.75, 0.83], [0.67, 0.66, 0.74], [0.75, 0.5], [0.82, 0.41], [0.86, 0.38], [0.88, 0]]);
    ellipsoid(`${p}Ankle`, [0, -0.015, 0.064], [0.054, 0.052, 0.125]);
  }
  const geometry = mergeGeometries(parts); parts.forEach(p => p.dispose());
  const material = new T.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 });
  const skin = new T.SkinnedMesh(geometry, material);
  skin.castShadow = true; skin.receiveShadow = true;
  skin.frustumCulled = false;
  root.add(skin); skin.bind(new T.Skeleton(JOINTS.map(j => bones[j])));
  // Eyes are original inset dark geometry, attached to the head rather than baked assets.
  for (const side of [-1, 1]) {
    const eye = new T.Mesh(new T.SphereGeometry(0.011, 12, 8), new T.MeshStandardMaterial({ color: '#44403c', roughness: 0.9 }));
    eye.position.set(side * 0.042, 0.055, 0.094); eye.scale.set(1, 0.55, 0.35); bones.head.add(eye);
  }
  const identityMap = () => Object.fromEntries(JOINTS.map(j => [j, new T.Quaternion()])) as Record<Joint, T.Quaternion>;
  return { root, skin, skins: [skin], bones, restRotations: identityMap(), rotationBases: identityMap(), tintMaterials: [material], hairMaterials: [] };
}
export function setFigurePose(figure: Figure, pose: Pose): void {
  JOINTS.forEach(j => {
    const basis = figure.rotationBases[j];
    const delta = new T.Quaternion().setFromEuler(new T.Euler(...pose[j]));
    figure.bones[j].quaternion.copy(figure.restRotations[j]).multiply(basis).multiply(delta).multiply(basis.clone().invert());
  });
  figure.root.updateMatrixWorld(true);
  figure.skins.forEach(skin => {
    skin.skeleton.update(); skin.computeBoundingBox(); skin.computeBoundingSphere();
  });
}
export function getJointRotation(figure: Figure, joint: Joint): [number, number, number] {
  const basis = figure.rotationBases[joint];
  const delta = figure.restRotations[joint].clone().invert().multiply(figure.bones[joint].quaternion);
  const semantic = basis.clone().invert().multiply(delta).multiply(basis);
  const euler = new T.Euler().setFromQuaternion(semantic, 'XYZ');
  return [euler.x, euler.y, euler.z];
}
