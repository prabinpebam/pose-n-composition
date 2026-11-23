import * as T from 'three';
import { updateWardrobePose } from './mannequin-wardrobe';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JOINTS, clone, type Body, type CharacterHandPoses, type Joint, type Pose } from './model';
import type { HairStyle } from './hair';
import type { BodyTypeId } from './bodyProportions';
import { applyExtremePoseDeformer, clampPoseToAnatomicalLimits, solveCoupledRigPose, type PoseLimitMode } from './skinDeformer';
import {
  applyFigureHandPoses,
  solveForearmWristTwistShare,
  type CalibratedHandRigs,
} from './hand-rig';

export interface Figure {
  modelId?: import('./characterCatalog').ModelId;
  nativeRig?: boolean;
  body?: Body;
  root: T.Group; skin: T.SkinnedMesh; skins: T.SkinnedMesh[]; bones: Record<Joint, T.Bone>;
  restRotations: Record<Joint, T.Quaternion>; rotationBases: Record<Joint, T.Quaternion>;
  tintMaterials: T.MeshStandardMaterial[];
  outfitColorUniforms: Array<{ value: T.Color }>;
  outfitIsOriginalUniforms?: Array<{ value: number }>;
  hairMaterials: T.MeshStandardMaterial[];
  headFromNative?: T.Matrix4; hairStyle?: HairStyle;
  deformation?: { bodyType: BodyTypeId; limitMode: PoseLimitMode };
  morphology?: import('./morphology-rig').MorphologyProfile;
  handRigs?: CalibratedHandRigs;
}
const semanticPoses = new WeakMap<Figure, { pose: Pose; rotations: Record<Joint, T.Quaternion>; key: string }>();
// Legacy regression fixture; the live studio exclusively loads the CC0 source rigs.
export function makeFigure(body: Body, color: string, outfitColor = '#ffffff'): Figure {
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
  const outfitColorUniform = { value: new T.Color(outfitColor) };
  const outfitIsOriginalUniform = { value: outfitColor.trim().toLowerCase() === '#ffffff' ? 1 : 0 };
  material.customProgramCacheKey = () => 'pnc-procedural-figure-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.uOutfitColor = outfitColorUniform;
    shader.uniforms.uOutfitIsOriginal = outfitIsOriginalUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPncProcBindPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPncProcBindPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uOutfitColor;\nuniform float uOutfitIsOriginal;\nvarying vec3 vPncProcBindPos;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
if ( uOutfitIsOriginal < 0.5 ) {
  float procTorsoBand = smoothstep( 0.82, 0.85, vPncProcBindPos.y ) * ( 1.0 - smoothstep( 1.36, 1.39, vPncProcBindPos.y ) ) * ( 1.0 - smoothstep( 0.24, 0.28, abs( vPncProcBindPos.x ) ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, uOutfitColor, procTorsoBand );
}`,
      );
  };
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
  return {
    root,
    skin,
    skins: [skin],
    bones,
    restRotations: identityMap(),
    rotationBases: identityMap(),
    tintMaterials: [material],
    outfitColorUniforms: [outfitColorUniform],
    outfitIsOriginalUniforms: [outfitIsOriginalUniform],
    hairMaterials: [],
  };
}
export const FLOOR_ANCHOR_TOLERANCE_M = 0.03;

export function measureFigureMinWorldY(figure: Figure): number {
  figure.root.updateMatrixWorld(true);
  const skin = figure.skin;
  skin.skeleton.update();
  const pos = skin.geometry.getAttribute('position');
  // Fast path: when CPU skinDeformer pass-through is active and figure.root has pure vertical/uniform upright transform,
  // deformed local positions ARE bind-space positions, so world Y = root.matrixWorld.m13 + sy * localY!
  const me = skin.matrixWorld.elements;
  const isUpright = Math.abs(me[1]!) < 1e-7 && Math.abs(me[9]!) < 1e-7 && me[5]! > 0;
  if (
    isUpright &&
    !figure.nativeRig && figure.deformation &&
    figure.deformation.bodyType !== 'chibi' &&
    skin.geometry.boundingBox
  ) {
    return me[5]! * skin.geometry.boundingBox.min.y + me[13]!;
  }
  const vertex = new T.Vector3();
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = skin.getVertexPosition(i, vertex).applyMatrix4(skin.matrixWorld).y;
    if (y < minY) minY = y;
  }
  return minY;
}

export function computeAnchoredPositionY(
  currentPositionY: number,
  beforeMinWorldY: number,
  afterMinWorldY: number,
  floorSnapTolerance = FLOOR_ANCHOR_TOLERANCE_M,
): number {
  if (!Number.isFinite(beforeMinWorldY) || !Number.isFinite(afterMinWorldY)) {
    throw new Error('Cannot anchor the figure: deformed bounds are invalid.');
  }
  const targetMinWorldY = Math.abs(beforeMinWorldY) < floorSnapTolerance ? 0 : beforeMinWorldY;
  return Number((currentPositionY + (targetMinWorldY - afterMinWorldY)).toFixed(5));
}

export function setFigurePose(
  figure: Figure,
  pose: Pose,
  handPose?: CharacterHandPoses | null,
): void {
  if (figure.deformation && !figure.nativeRig) {
    const effective = clampPoseToAnatomicalLimits(
      pose,
      figure.deformation.limitMode,
      figure.morphology,
    );
    const preRev = (figure.root.userData.__bodyProportionRevision as number) || 0;
    const preKey = JSON.stringify([figure.deformation, effective, handPose ?? null, preRev]);
    const previous = semanticPoses.get(figure);
    if (
      previous?.key !== preKey ||
      JOINTS.some(j => !figure.bones[j].quaternion.equals(previous.rotations[j]))
    ) {
      const { root } = figure;
      const position = root.position.clone(), rotation = root.quaternion.clone(), scale = root.scale.clone();
      // Solve in character space: world reflections/nonuniform scales must not enter the rigid DQS solve.
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
      try {
        applyExtremePoseDeformer(figure, effective, {
          ...figure.deformation,
          onAfterPoseSolve: () => applyFigureHandPoses(figure, handPose),
        });
        updateWardrobePose(figure);
      } finally {
        root.position.copy(position); root.quaternion.copy(rotation); root.scale.copy(scale);
        root.updateMatrixWorld(true);
      }
      const postRev = (figure.root.userData.__bodyProportionRevision as number) || 0;
      const postKey = JSON.stringify([figure.deformation, effective, handPose ?? null, postRev]);
      semanticPoses.set(figure, {
        pose: clone(effective),
        key: postKey,
        rotations: Object.fromEntries(
          JOINTS.map(j => [j, figure.bones[j].quaternion.clone()]),
        ) as Record<Joint, T.Quaternion>,
      });
    }
    figure.root.updateMatrixWorld(true);
    figure.skins.forEach(skin => { skin.skeleton.update(); skin.computeBoundingBox(); skin.computeBoundingSphere(); });
    return;
  }

  const effective = figure.deformation
    ? clampPoseToAnatomicalLimits(pose, figure.deformation.limitMode, figure.morphology)
    : pose;

  applyNativePoseBones(figure, effective);
  applyFigureHandPoses(figure, handPose);

  semanticPoses.set(figure, {
    pose: clone(effective),
    key: 'native',
    rotations: Object.fromEntries(
      JOINTS.map(j => [j, figure.bones[j].quaternion.clone()]),
    ) as Record<Joint, T.Quaternion>,
  });

  figure.root.updateMatrixWorld(true);
  figure.skins.forEach(skin => {
    skin.skeleton.update(); skin.computeBoundingBox(); skin.computeBoundingSphere();
  });
}

function applyNativePoseBones(figure: Figure, effective: Pose) {
  const jointQuats = {} as Record<Joint, T.Quaternion>;
  for (const j of JOINTS) {
    jointQuats[j] = new T.Quaternion().setFromEuler(new T.Euler(...effective[j], 'XYZ'));
  }

  // Share 50% of axial wrist twist onto lowerarm_l / lowerarm_r on native LBS rigs
  // so +/-160°..180° pronation/supination preserves wrist cross-section volume with 0m wrist shift.
  if (figure.nativeRig && figure.handRigs) {
    const leftShared = solveForearmWristTwistShare(
      jointQuats.leftElbow,
      jointQuats.leftWrist,
      figure.handRigs.left.forearmShaftWorld,
      0.5,
    );
    jointQuats.leftElbow = leftShared.elbowQuat;
    jointQuats.leftWrist = leftShared.wristQuat;

    const rightShared = solveForearmWristTwistShare(
      jointQuats.rightElbow,
      jointQuats.rightWrist,
      figure.handRigs.right.forearmShaftWorld,
      0.5,
    );
    jointQuats.rightElbow = rightShared.elbowQuat;
    jointQuats.rightWrist = rightShared.wristQuat;
  }

  JOINTS.forEach(j => {
    const basis = figure.rotationBases[j];
    figure.bones[j].quaternion
      .copy(figure.restRotations[j])
      .multiply(basis)
      .multiply(jointQuats[j])
      .multiply(basis.clone().invert());
  });

}

/** Evaluate semantic FK without skinning vertices, recomputing bounds, or moving clothing. */
export function evaluatePoseBones(figure: Figure, pose: Pose): Pose {
  const effective = figure.deformation
    ? clampPoseToAnatomicalLimits(pose, figure.deformation.limitMode, figure.morphology)
    : pose;
  const { root } = figure;
  if (figure.deformation && !figure.nativeRig) {
    const pos = root.position.clone(), quat = root.quaternion.clone(), scale = root.scale.clone();
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1);
    try {
      solveCoupledRigPose(figure, effective, figure.deformation);
    } finally {
      root.position.copy(pos); root.quaternion.copy(quat); root.scale.copy(scale);
      root.updateMatrixWorld(true);
    }
  } else {
    applyNativePoseBones(figure, effective);
    root.updateMatrixWorld(true);
  }
  return effective;
}
export function getJointRotation(figure: Figure, joint: Joint): [number, number, number] {
  const basis = figure.rotationBases[joint];
  const reference = semanticPoses.get(figure);
  if (reference) {
    if (figure.bones[joint].quaternion.angleTo(reference.rotations[joint]) < 1e-7) {
      return [...reference.pose[joint]] as [number, number, number];
    }
    // Coupled helper bones or forearm twist-sharing compensate semantic joints; measure only the user's new FK delta.
    const localDelta = reference.rotations[joint].clone().invert().multiply(figure.bones[joint].quaternion);
    const semantic = new T.Quaternion().setFromEuler(new T.Euler(...reference.pose[joint], 'XYZ'))
      .multiply(basis.clone().invert()).multiply(localDelta).multiply(basis);
    const euler = new T.Euler().setFromQuaternion(semantic, 'XYZ');
    return [euler.x, euler.y, euler.z];
  }
  const delta = figure.restRotations[joint].clone().invert().multiply(figure.bones[joint].quaternion);
  const semantic = basis.clone().invert().multiply(delta).multiply(basis);
  const euler = new T.Euler().setFromQuaternion(semantic, 'XYZ');
  return [euler.x, euler.y, euler.z];
}
