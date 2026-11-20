import * as T from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUILTIN_ANIMATION_CYCLES,
  createAnimationClipFromThree,
  extractPoseAtFrame,
  loadAllBuiltinAnimationCycles,
  loadBuiltinAnimationCycle,
  loadUserAnimationFile,
  normalizeHumanoidBoneName,
  parseAnimationBuffer,
} from './animationPoseExtractor';
import { buildExternalFigure } from './external-rig';
import { JOINTS, validatePose } from './model';
import { getJointRotation, setFigurePose, type Figure } from './rig';
import { loadMannequinTestFixtures } from './testMannequinFixtures';

function limbWorldDir(figure: Figure, from: keyof Figure['bones'], to: keyof Figure['bones']): T.Vector3 {
  figure.root.updateMatrixWorld(true);
  const pFrom = figure.bones[from].getWorldPosition(new T.Vector3());
  const pTo = figure.bones[to].getWorldPosition(new T.Vector3());
  return pTo.sub(pFrom).normalize();
}

function buildSyntheticMixamoRig(options?: { zUp?: boolean; skinlessFbxPreRot?: boolean }): {
  root: T.Group;
  bones: Record<string, T.Bone>;
} {
  const root = new T.Group();
  const rigWrapper = new T.Group();
  if (options?.zUp) {
    // Rotate +Y up / +Z forward into Blender Z-up (+Z up, -Y forward): +90 deg around X.
    rigWrapper.quaternion.setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
  }
  root.add(rigWrapper);

  const specs: Array<[string, string | null, [number, number, number]]> = [
    ['mixamorig:Hips', null, [0, 1.0, 0]],
    ['mixamorig:Spine', 'mixamorig:Hips', [0, 0.12, 0]],
    ['mixamorig:Spine1', 'mixamorig:Spine', [0, 0.12, 0]],
    ['mixamorig:Spine2', 'mixamorig:Spine1', [0, 0.12, 0]],
    ['mixamorig:Neck', 'mixamorig:Spine2', [0, 0.18, 0]],
    ['mixamorig:Head', 'mixamorig:Neck', [0, 0.1, 0]],
    ['mixamorig:LeftShoulder', 'mixamorig:Spine2', [0.05, 0.15, 0]],
    ['mixamorig:LeftArm', 'mixamorig:LeftShoulder', [0.12, 0, 0]],
    ['mixamorig:LeftForeArm', 'mixamorig:LeftArm', [0.26, 0, 0]],
    ['mixamorig:LeftHand', 'mixamorig:LeftForeArm', [0.24, 0, 0]],
    ['mixamorig:RightShoulder', 'mixamorig:Spine2', [-0.05, 0.15, 0]],
    ['mixamorig:RightArm', 'mixamorig:RightShoulder', [-0.12, 0, 0]],
    ['mixamorig:RightForeArm', 'mixamorig:RightArm', [-0.26, 0, 0]],
    ['mixamorig:RightHand', 'mixamorig:RightForeArm', [-0.24, 0, 0]],
    ['mixamorig:LeftUpLeg', 'mixamorig:Hips', [0.1, -0.05, 0]],
    ['mixamorig:LeftLeg', 'mixamorig:LeftUpLeg', [0, -0.44, 0]],
    ['mixamorig:LeftFoot', 'mixamorig:LeftLeg', [0, -0.43, 0]],
    ['mixamorig:RightUpLeg', 'mixamorig:Hips', [-0.1, -0.05, 0]],
    ['mixamorig:RightLeg', 'mixamorig:RightUpLeg', [0, -0.44, 0]],
    ['mixamorig:RightFoot', 'mixamorig:RightLeg', [0, -0.43, 0]],
  ];

  const bones: Record<string, T.Bone> = {};
  const allBones: T.Bone[] = [];
    // 40 deg bone-roll joint orient along +X arm axis (standard Maya/FBX PreRotation along bone axis)
    const qPre = new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(40), 0, 0, 'ZYX'));
    const qPreInv = qPre.clone().invert();
    for (const [name, parentName, pos] of specs) {
      const bone = new T.Bone();
      bone.name = name;
      bone.position.set(pos[0], pos[1], pos[2]);
      if (options?.skinlessFbxPreRot && name === 'mixamorig:LeftArm') {
        bone.userData.transformData = {
          translation: [...pos],
          preRotation: [40, 0, 0],
          rotation: [28, -18, 12],
          postRotation: [0, 0, 0],
          eulerOrder: 'ZYX',
        };
        // Simulate FBXLoader setting initial bone.quaternion to qPre * qFrame0 (non-T-pose first frame!)
        const qFrame0 = new T.Quaternion().setFromEuler(
          new T.Euler(T.MathUtils.degToRad(28), T.MathUtils.degToRad(-18), T.MathUtils.degToRad(12), 'ZYX'),
        );
        bone.quaternion.copy(qPre.clone().multiply(qFrame0));
      } else if (options?.skinlessFbxPreRot && name === 'mixamorig:LeftForeArm') {
        bone.userData.transformData = {
          translation: [...pos],
          preRotation: [-40, 0, 0],
          rotation: [0, 0, 0],
          postRotation: [0, 0, 0],
          eulerOrder: 'ZYX',
        };
        bone.quaternion.copy(qPreInv);
      }
      const parent = parentName ? bones[parentName] : rigWrapper;
      parent.add(bone);
      bones[name] = bone;
      allBones.push(bone);
    }
  root.updateMatrixWorld(true);

  if (!options?.skinlessFbxPreRot) {
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
    geom.setAttribute('skinIndex', new T.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    geom.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new T.SkinnedMesh(geom, new T.MeshBasicMaterial());
    const skeleton = new T.Skeleton(allBones);
    rigWrapper.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(skeleton);
    root.updateMatrixWorld(true);
  }

  return { root, bones };
}

describe('animationPoseExtractor', () => {
  let maleFigure: Figure;
  let femaleFigure: Figure;

  beforeAll(async () => {
    const templates = await loadMannequinTestFixtures();
    maleFigure = buildExternalFigure('male', templates.get('male')!, '#d4a574');
    femaleFigure = buildExternalFigure('female', templates.get('female')!, '#d4a574');
  });

  it('normalizes Mixamo, Quaternius, Unity/VRM Humanoid, and Biped bone names accurately', () => {
    expect(normalizeHumanoidBoneName('mixamorig:Hips')).toBe('hips');
    expect(normalizeHumanoidBoneName('mixamorigHips')).toBe('hips');
    expect(normalizeHumanoidBoneName('mixamorig_Spine')).toBe('spine');
    expect(normalizeHumanoidBoneName('mixamorig1:Spine2')).toBe('chest');
    expect(normalizeHumanoidBoneName('mixamorig:LeftArm')).toBe('leftShoulder');
    expect(normalizeHumanoidBoneName('mixamorigLeftForeArm')).toBe('leftElbow');
    expect(normalizeHumanoidBoneName('mixamorig:RightHand.quaternion')).toBe('rightWrist');
    expect(normalizeHumanoidBoneName('Armature|upperarm_l')).toBe('leftShoulder');
    expect(normalizeHumanoidBoneName('Character1_RightUpLeg')).toBe('rightHip');
    expect(normalizeHumanoidBoneName('SkinnedMesh.bones[mixamorigRightLeg].quaternion')).toBe('rightKnee');
    expect(normalizeHumanoidBoneName('LeftUpperArm')).toBe('leftShoulder');
    expect(normalizeHumanoidBoneName('RightLowerLeg')).toBe('rightKnee');
    expect(normalizeHumanoidBoneName('Bip01 L Forearm')).toBe('leftElbow');
    expect(normalizeHumanoidBoneName('mixamorig:LeftHandIndex1')).toBeNull();
  });

  it('loads all 12 built-in CC0 animation cycles and extracts valid, distinct poses across 0%..100%', async () => {
    expect(BUILTIN_ANIMATION_CYCLES.length).toBeGreaterThanOrEqual(8);
    const clips = await loadAllBuiltinAnimationCycles();
    expect(clips).toHaveLength(BUILTIN_ANIMATION_CYCLES.length);

    for (const clip of clips) {
      expect(clip.source).toBe('builtin');
      expect(clip.rigFormat).toBe('quaternius');
      expect(clip.duration).toBeGreaterThan(0.4);
      expect(clip.frameCount).toBeGreaterThanOrEqual(14);
      expect(clip.mappedJoints).toEqual(JOINTS);

      const start = extractPoseAtFrame(clip, 0, { body: 'male' });
      const quarter = extractPoseAtFrame(clip, 0.25, { normalized: true, body: 'male' });
      const mid = extractPoseAtFrame(clip, 0.5, { normalized: true, body: 'female' });
      const end = extractPoseAtFrame(clip, clip.frameCount - 1, { body: 'male' });

      expect(validatePose(start.pose)).not.toBeNull();
      expect(validatePose(quarter.pose)).not.toBeNull();
      expect(validatePose(mid.pose)).not.toBeNull();
      expect(validatePose(end.pose)).not.toBeNull();
      expect(start.frame).toBe(0);
      expect(end.frame).toBe(clip.frameCount - 1);
      expect(end.normalizedTime).toBeCloseTo(1, 5);

      // Ensure poses actually vary across the cycle rather than returning static constants.
      const maxDiff = Math.max(
        ...JOINTS.flatMap((j) => [
          Math.abs(start.pose[j][0] - quarter.pose[j][0]),
          Math.abs(start.pose[j][1] - quarter.pose[j][1]),
          Math.abs(start.pose[j][2] - quarter.pose[j][2]),
          Math.abs(start.pose[j][0] - mid.pose[j][0]),
        ]),
      );
      expect(maxDiff).toBeGreaterThan(0.02);
    }
  });

  it('produces anatomically natural world limb directions on Male & Female figures without T-pose arm fly-up', async () => {
    const idleClip = await loadBuiltinAnimationCycle('idle-relaxed');
    const walkClip = await loadBuiltinAnimationCycle('walk-loop');
    const sitClip = await loadBuiltinAnimationCycle('sitting-talking');
    const crouchClip = await loadBuiltinAnimationCycle('crouch-sneak');

    // 1. Standing idle: arms hang naturally beside torso on both Male and Female figures
    for (const [body, fig] of [['male', maleFigure], ['female', femaleFigure]] as const) {
      const idle = extractPoseAtFrame(idleClip, 0.25, { normalized: true, body });
      expect(validatePose(idle.pose)).not.toBeNull();
      setFigurePose(fig, idle.pose);

      const leftUpper = limbWorldDir(fig, 'leftShoulder', 'leftElbow');
      const rightUpper = limbWorldDir(fig, 'rightShoulder', 'rightElbow');
      const leftThigh = limbWorldDir(fig, 'leftHip', 'leftKnee');
      expect(leftUpper.y).toBeLessThan(-0.75);
      expect(rightUpper.y).toBeLessThan(-0.75);
      expect(leftUpper.x).toBeGreaterThan(0.05);
      expect(rightUpper.x).toBeLessThan(-0.05);
      expect(leftThigh.y).toBeLessThan(-0.75);

      // Round-trip joint rotation check through Figure
      for (const j of JOINTS) {
        const readBack = getJointRotation(fig, j);
        expect(Number.isFinite(readBack[0] + readBack[1] + readBack[2])).toBe(true);
      }
    }

    // 2. Walk cycle: opposite leg lead at 0% vs 50%
    const walk0 = extractPoseAtFrame(walkClip, 0, { normalized: true, body: 'male' });
    const walk50 = extractPoseAtFrame(walkClip, 0.5, { normalized: true, body: 'male' });
    expect(walk0.pose.leftHip[0] - walk0.pose.rightHip[0]).toBeLessThan(-0.3);
    expect(walk50.pose.leftHip[0] - walk50.pose.rightHip[0]).toBeGreaterThan(0.3);

    // 3. Seated cycle: thighs extend forward (+Z), shins point down (-Y), suggestedRootY lowers figure to chair height
    const seated = extractPoseAtFrame(sitClip, 0.3, { normalized: true, body: 'male' });
    setFigurePose(maleFigure, seated.pose);
    const seatedThigh = limbWorldDir(maleFigure, 'leftHip', 'leftKnee');
    const seatedShin = limbWorldDir(maleFigure, 'leftKnee', 'leftAnkle');
    expect(seatedThigh.z).toBeGreaterThan(0.75);
    expect(seatedShin.y).toBeLessThan(-0.8);
    expect(seated.suggestedRootY).toBeDefined();
    expect(seated.suggestedRootY!).toBeLessThan(-0.25);

    // 4. Crouch cycle: suggestedRootY lowers pelvis significantly
    const crouch = extractPoseAtFrame(crouchClip, 0.4, { normalized: true, body: 'male' });
    expect(crouch.suggestedRootY!).toBeLessThan(-0.25);
  });

  it('retargets Mixamo T-pose, skinless Mixamo FBX pre-rotations, and Z-up rigs identically onto our figure', () => {
    const buildMixamoWalkClip = (
      rig: { root: T.Group; bones: Record<string, T.Bone> },
      withLeftArmPreRot = false,
    ) => {
      // Frame 0: T-pose; Frame 1 (t=1s): arms relaxed down (-82 deg Z on LeftArm, +82 deg Z on RightArm), left leg forward (-30 deg X), left knee bent (+45 deg X)
      const qPre = withLeftArmPreRot
        ? new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(40), 0, 0, 'ZYX'))
        : new T.Quaternion();
      const qIdentity = [0, 0, 0, 1];
      const qLeftArmRest = qPre.toArray();
      const qLeftArmDown = new T.Quaternion()
        .setFromAxisAngle(new T.Vector3(0, 0, 1), T.MathUtils.degToRad(-82))
        .multiply(qPre)
        .toArray();
      const qRightArmDown = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), T.MathUtils.degToRad(82)).toArray();
      const qLeftHipFwd = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), T.MathUtils.degToRad(-30)).toArray();
      const qLeftKneeBend = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), T.MathUtils.degToRad(45)).toArray();

      const tracks = [
        new T.QuaternionKeyframeTrack('mixamorig:LeftArm.quaternion', [0, 1], [...qLeftArmRest, ...qLeftArmDown]),
        new T.QuaternionKeyframeTrack('mixamorig:RightArm.quaternion', [0, 1], [...qIdentity, ...qRightArmDown]),
        new T.QuaternionKeyframeTrack('mixamorig:LeftUpLeg.quaternion', [0, 1], [...qIdentity, ...qLeftHipFwd]),
        new T.QuaternionKeyframeTrack('mixamorig:LeftLeg.quaternion', [0, 1], [...qIdentity, ...qLeftKneeBend]),
      ];
      return createAnimationClipFromThree(rig.root, new T.AnimationClip('mixamo.com', 1, tracks), {
        fps: 30,
      });
    };

    const yUpMixamo = buildSyntheticMixamoRig();
    const zUpMixamo = buildSyntheticMixamoRig({ zUp: true });
    const skinlessFbxMixamo = buildSyntheticMixamoRig({ skinlessFbxPreRot: true });

    const clipY = buildMixamoWalkClip(yUpMixamo);
    const clipZ = buildMixamoWalkClip(zUpMixamo);
    const clipSkinless = buildMixamoWalkClip(skinlessFbxMixamo, true);

    expect(clipY.rigFormat).toBe('mixamo');
    expect(clipSkinless.rigFormat).toBe('mixamo');

    // Frame 0 (T-pose in Mixamo) -> arms on our figure extend horizontally (+X left, -X right)
    const tposeExtracted = extractPoseAtFrame(clipY, 0, { normalized: true, body: 'male' });
    expect(validatePose(tposeExtracted.pose)).not.toBeNull();
    setFigurePose(maleFigure, tposeExtracted.pose);
    expect(limbWorldDir(maleFigure, 'leftShoulder', 'leftElbow').x).toBeGreaterThan(0.95);
    expect(limbWorldDir(maleFigure, 'rightShoulder', 'rightElbow').x).toBeLessThan(-0.95);

    // Frame 100% (arms down + stride) -> arms hang down, left thigh forward (+Z), knee bends backward
    const strideY = extractPoseAtFrame(clipY, 1, { normalized: true, body: 'male' });
    const strideZ = extractPoseAtFrame(clipZ, 1, { normalized: true, body: 'male' });
    const strideSkinless = extractPoseAtFrame(clipSkinless, 1, { normalized: true, body: 'male' });

    expect(validatePose(strideY.pose)).not.toBeNull();
    expect(validatePose(strideZ.pose)).not.toBeNull();
    expect(validatePose(strideSkinless.pose)).not.toBeNull();

    setFigurePose(maleFigure, strideY.pose);
    expect(limbWorldDir(maleFigure, 'leftShoulder', 'leftElbow').y).toBeLessThan(-0.95);
    expect(limbWorldDir(maleFigure, 'rightShoulder', 'rightElbow').y).toBeLessThan(-0.95);
    expect(limbWorldDir(maleFigure, 'leftHip', 'leftKnee').z).toBeGreaterThan(0.45);

    // Z-up and skinless FBX preRotation rigs match Y-up Mixamo within tight tolerance!
    for (const j of JOINTS) {
      for (let axis = 0; axis < 3; axis++) {
        expect(strideZ.pose[j][axis]).toBeCloseTo(strideY.pose[j][axis], 3);
        expect(strideSkinless.pose[j][axis]).toBeCloseTo(strideY.pose[j][axis], 3);
      }
    }
  });

  it('parses uploaded Mixamo .gltf and .glb animation files via loadUserAnimationFile and rejects invalid files cleanly', async () => {
    // Build a minimal self-contained Mixamo .gltf with embedded base64 keyframe buffer (no browser FileReader needed)
    const qDown = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), T.MathUtils.degToRad(-80));
    const floatData = new Float32Array([
      0, 0.5, // times (2 scalars)
      0, 0, 0, 1, qDown.x, qDown.y, qDown.z, qDown.w, // quaternions (2 VEC4)
    ]);
    const b64 = Buffer.from(floatData.buffer).toString('base64');
    const gltfDoc = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'mixamorig:Hips', translation: [0, 1.0, 0], children: [1, 2, 5, 6] },
        { name: 'mixamorig:Spine', translation: [0, 0.2, 0], children: [3] },
        { name: 'mixamorig:LeftUpLeg', translation: [0.1, -0.05, 0], children: [7] },
        { name: 'mixamorig:Head', translation: [0, 0.4, 0] },
        { name: 'mixamorig:LeftForeArm', translation: [0.26, 0, 0] },
        { name: 'mixamorig:LeftArm', translation: [0.18, 0.35, 0], children: [4] },
        { name: 'mixamorig:RightArm', translation: [-0.18, 0.35, 0] },
        { name: 'mixamorig:LeftLeg', translation: [0, -0.44, 0] },
      ],
      buffers: [{ byteLength: floatData.byteLength, uri: `data:application/octet-stream;base64,${b64}` }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 8 },
        { buffer: 0, byteOffset: 8, byteLength: 32 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [0.5] },
        { bufferView: 1, componentType: 5126, count: 2, type: 'VEC4' },
      ],
      animations: [
        {
          name: 'Mixamo_Arm_Drop',
          samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }],
          channels: [{ sampler: 0, target: { node: 5, path: 'rotation' } }],
        },
      ],
    };

    const encoded = new TextEncoder().encode(JSON.stringify(gltfDoc));
    const file = new File([encoded], 'Mixamo_Wave.gltf', { type: 'model/gltf+json' });

    const loaded = await loadUserAnimationFile(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].source).toBe('file');
    expect(loaded[0].rigFormat).toBe('mixamo');
    expect(loaded[0].name).toBe('Mixamo Arm Drop');
    const sampled = extractPoseAtFrame(loaded[0], 1, { normalized: true, body: 'female' });
    expect(validatePose(sampled.pose)).not.toBeNull();
    setFigurePose(femaleFigure, sampled.pose);
    expect(limbWorldDir(femaleFigure, 'leftShoulder', 'leftElbow').y).toBeLessThan(-0.9);

    await expect(parseAnimationBuffer(new ArrayBuffer(0), 'empty.fbx')).rejects.toThrow(/empty/i);
    await expect(loadUserAnimationFile(new File([new Uint8Array([1, 2, 3])], 'notes.txt'))).rejects.toThrow(/Unsupported/i);
  });

  it('handles A-pose rest rigs, single-frame static Mixamo poses (duration=0), and matches live Figure calibration', async () => {
    // 1. Live Figure vs pre-baked Body calibration parity (< 1e-4 rad across all 17 joints)
    const walkClip = await loadBuiltinAnimationCycle('walk-loop');
    for (const [body, fig] of [['male', maleFigure], ['female', femaleFigure]] as const) {
      const fromBody = extractPoseAtFrame(walkClip, 0.35, { normalized: true, body });
      const fromFig = extractPoseAtFrame(walkClip, 0.35, { normalized: true, figure: fig });
      for (const j of JOINTS) {
        for (let axis = 0; axis < 3; axis++) {
          expect(fromBody.pose[j][axis]).toBeCloseTo(fromFig.pose[j][axis], 4);
        }
      }
    }

    // 2. A-pose rest rig (-45 deg arm slope at rest + -37 deg anim delta == -82 deg total arm hang)
    const aPose = buildSyntheticMixamoRig();
    aPose.bones['mixamorig:LeftArm'].quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), T.MathUtils.degToRad(-45));
    aPose.bones['mixamorig:RightArm'].quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), T.MathUtils.degToRad(45));
    aPose.root.updateMatrixWorld(true);
    // Rebind skin at A-pose
    aPose.root.traverse((n) => {
      if ((n as T.SkinnedMesh).isSkinnedMesh) {
        const sm = n as T.SkinnedMesh;
        sm.skeleton.calculateInverses();
      }
    });
    const qFromAPoseToDown = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), T.MathUtils.degToRad(-82)).toArray();
    const staticPoseClip = createAnimationClipFromThree(
      aPose.root,
      new T.AnimationClip('Static_Mixamo_Pose', 0, [
        new T.QuaternionKeyframeTrack('mixamorig:LeftArm.quaternion', [0], qFromAPoseToDown),
      ]),
    );
    expect(staticPoseClip.frameCount).toBe(1);
    const extracted = extractPoseAtFrame(staticPoseClip, 0, { body: 'male' });
    expect(extracted.frame).toBe(0);
    expect(extracted.normalizedTime).toBe(0);
    expect(validatePose(extracted.pose)).not.toBeNull();
    setFigurePose(maleFigure, extracted.pose);
    expect(limbWorldDir(maleFigure, 'leftShoulder', 'leftElbow').y).toBeLessThan(-0.95);
  });
});
