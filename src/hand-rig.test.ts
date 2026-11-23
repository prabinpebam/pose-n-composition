import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  buildExternalFigure,
  captureFkDragAnchor,
  computeAnchoredFkDragEuler,
  hasPoseableFingers,
  inspectorDegreesToPoseJoint,
  poseJointToInspectorDegrees,
  solveForearmWristTwistShare,
} from './external-rig';
import { CHARACTERS, type ModelId } from './characterCatalog';
import {
  FINGER_IDS,
  applyPose,
  clone,
  copyPoseNodes,
  createItem,
  defaultHandPose,
  degrees,
  handPreset,
  initialScene,
  mirrorCharacterPose,
  mirrorPose,
  neutralPose,
  parseFile,
  parsePoseFile,
  pastePoseNodes,
  poseFile,
  radians,
  swapItemBodyKind,
  type Body,
  type FingerId,
  type HandSide,
  type Pose,
} from './model';
import { getJointRotation, setFigurePose, type Figure } from './rig';
import { cleanSnappedEulerVec, resolveRotationSnapRad, ROTATION_SNAP_DEG } from './engine';
import { clampPoseToAnatomicalLimits } from './skinDeformer';
import { loadMannequinTestFixtures } from './testMannequinFixtures';

interface RawGltfJson {
  buffers?: Array<{ uri?: string }>;
  images?: unknown[];
  textures?: unknown[];
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
    normalTexture?: unknown;
    occlusionTexture?: unknown;
    emissiveTexture?: unknown;
  }>;
}

async function loadSuperheroTemplate(modelId: 'quaternius-superhero-male' | 'quaternius-superhero-female'): Promise<T.Group> {
  const relPath = CHARACTERS[modelId].path;
  const fullPath = resolve(process.cwd(), 'public', relPath);
  const dir = dirname(fullPath);
  const json = JSON.parse(readFileSync(fullPath, 'utf8')) as RawGltfJson;
  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:')) {
      const bytes = readFileSync(resolve(dir, buf.uri));
      buf.uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
    }
  }
  delete json.images;
  delete json.textures;
  for (const mat of json.materials ?? []) {
    if (mat.pbrMetallicRoughness) {
      delete mat.pbrMetallicRoughness.baseColorTexture;
      delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete mat.normalTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
  }
  const loader = new GLTFLoader();
  const parsed = await loader.parseAsync(JSON.stringify(json), '');
  return parsed.scene;
}

const SUPERHERO_MODELS = [
  { modelId: 'quaternius-superhero-male', body: 'male' },
  { modelId: 'quaternius-superhero-female', body: 'female' },
] as const satisfies ReadonlyArray<{ modelId: ModelId; body: Body }>;

const templates = new Map<ModelId, T.Group>();
let mannequinTemplates = new Map<Body, T.Group>();

beforeAll(async () => {
  mannequinTemplates = await loadMannequinTestFixtures();
  for (const { modelId } of SUPERHERO_MODELS) {
    templates.set(modelId, await loadSuperheroTemplate(modelId));
  }
});

function makeSuperhero(modelId: 'quaternius-superhero-male' | 'quaternius-superhero-female'): Figure {
  const body = CHARACTERS[modelId].body;
  const fig = buildExternalFigure(body, templates.get(modelId)!, '#ffffff', '#ffffff', modelId);
  fig.deformation = { bodyType: 'heroic', limitMode: 'anatomical' };
  return fig;
}

/**
 * Measures the mean perpendicular cross-section radius of wrist seam vertices around the posed forearm shaft axis
 * (`normalize(wristWorld - elbowWorld)`). Using true perpendicular point-to-line distance works identically
 * whether the arm is in horizontal T-pose or bent 95° at the elbow!
 */
function measureWristCrossSectionRadius(fig: Figure, side: HandSide): number {
  const wristName = side === 'left' ? 'hand_l' : 'hand_r';
  const forearmName = side === 'left' ? 'lowerarm_l' : 'lowerarm_r';
  const skin = fig.skin;
  skin.skeleton.update();
  const wristBoneIdx = skin.skeleton.bones.findIndex(b => b.name === wristName);
  const forearmBoneIdx = skin.skeleton.bones.findIndex(b => b.name === forearmName);
  expect(wristBoneIdx).toBeGreaterThanOrEqual(0);
  expect(forearmBoneIdx).toBeGreaterThanOrEqual(0);

  const wristWorld = fig.bones[side === 'left' ? 'leftWrist' : 'rightWrist'].getWorldPosition(new T.Vector3());
  const elbowWorld = fig.bones[side === 'left' ? 'leftElbow' : 'rightElbow'].getWorldPosition(new T.Vector3());
  const forearmAxis = wristWorld.clone().sub(elbowWorld).normalize();
  const posAttr = skin.geometry.getAttribute('position');
  const idxAttr = skin.geometry.getAttribute('skinIndex');
  const wgtAttr = skin.geometry.getAttribute('skinWeight');

  const seamVerts: number[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    let wHand = 0;
    let wFore = 0;
    for (let k = 0; k < 4; k++) {
      const bi = idxAttr.getComponent(i, k);
      const wt = wgtAttr.getComponent(i, k);
      if (bi === wristBoneIdx) wHand += wt;
      if (bi === forearmBoneIdx) wFore += wt;
    }
    if (wHand > 0.15 && wFore > 0.15) {
      seamVerts.push(i);
    }
  }
  expect(seamVerts.length).toBeGreaterThan(8);

  const v = new T.Vector3();
  const rel = new T.Vector3();
  let sumR = 0;
  for (const vi of seamVerts) {
    skin.getVertexPosition(vi, v).applyMatrix4(skin.matrixWorld);
    rel.subVectors(v, wristWorld);
    rel.addScaledVector(forearmAxis, -rel.dot(forearmAxis));
    sumR += rel.length();
  }
  return sumR / seamVerts.length;
}

function fingertipWorldPosition(fig: Figure, side: HandSide, finger: FingerId): T.Vector3 {
  const chain = fig.handRigs![side].fingers[finger]!;
  const distalPh = chain.phalanges[chain.phalanges.length - 1]!;
  // Advance slightly past the distal phalange pivot along its child/distal direction to represent the actual fingertip pad
  const tipBone = distalPh.bone;
  const childBone = tipBone.children.find((c): c is T.Bone => c instanceof T.Bone);
  if (childBone) {
    return childBone.getWorldPosition(new T.Vector3());
  }
  const p2 = tipBone.getWorldPosition(new T.Vector3());
  const p1 = chain.phalanges[chain.phalanges.length - 2]!.bone.getWorldPosition(new T.Vector3());
  return p2.clone().add(p2.clone().sub(p1).multiplyScalar(0.8));
}

function palmCenterWorldPosition(fig: Figure, side: HandSide): T.Vector3 {
  const wrist = fig.bones[side === 'left' ? 'leftWrist' : 'rightWrist'].getWorldPosition(new T.Vector3());
  const midMcp = fig.handRigs![side].fingers.middle!.phalanges[0]!.bone.getWorldPosition(new T.Vector3());
  return wrist.lerp(midMcp, 0.55);
}

describe.each(['mannequin-female', 'mannequin-male', ...SUPERHERO_MODELS.map(m => m.modelId)] as const)(
  '%s gesture silhouette',
  modelId => {
    it('keeps Thumbs Up outside four closed fingers on either hand without rotating the posed wrist', () => {
      const body = modelId.endsWith('female') ? 'female' : 'male';
      const template = templates.get(modelId) ?? mannequinTemplates.get(body)!;
      const fig = buildExternalFigure(body, template, '#ffffff', '#ffffff', modelId);
      const pose = neutralPose();
      for (const side of ['left', 'right'] as const) {
        const wrist = fig.handRigs![side].wristBone;
        const knuckle = (id: FingerId) =>
          fig.handRigs![side].fingers[id]!.phalanges[0]!.bone.getWorldPosition(new T.Vector3());
        pose[`${side}Wrist`] = inspectorDegreesToPoseJoint([25, -40, 10], `${side}Wrist`, fig.handRigs);
        setFigurePose(fig, pose, { [side]: handPreset('Open') });
        const wristBefore = wrist.matrixWorld.clone();
        const palm = palmCenterWorldPosition(fig, side);
        const fingers = ['index', 'middle', 'ring', 'pinky'] as const;
        const open = fingers.map(f => fingertipWorldPosition(fig, side, f).distanceTo(palm));
        const radial = knuckle('index').sub(knuckle('pinky')).normalize();
        const palmWidth = knuckle('index').distanceTo(knuckle('pinky'));
        const thumbOffset = () => fingertipWorldPosition(fig, side, 'thumb').sub(knuckle('index')).dot(radial);
        setFigurePose(fig, pose, { [side]: handPreset('Fist') });
        const tucked = thumbOffset();
        setFigurePose(fig, pose, { [side]: handPreset('Thumbs Up') });
        expect(thumbOffset()).toBeGreaterThan(0.2 * palmWidth);
        expect(thumbOffset() - tucked).toBeGreaterThan(0.4 * palmWidth);
        fingers.forEach((f, i) =>
          expect(fingertipWorldPosition(fig, side, f).distanceTo(palm)).toBeLessThan(open[i] * 0.65),
        );
        wrist.updateWorldMatrix(true, false);
        expect(wrist.matrixWorld.elements).toEqual(wristBefore.elements);
      }
    });
  },
);

describe.each(SUPERHERO_MODELS)('$modelId hand & finger articulation', ({ modelId }) => {
  it('allows unrestricted expressive wrist bend (±100°), tilt (±70°), Twist (±165°), and T-pose bicep curls without hitting false clamps', () => {
    const fig = makeSuperhero(modelId);

    for (const side of ['left', 'right'] as const) {
      const wristJoint = side === 'left' ? 'leftWrist' : 'rightWrist';
      const elbowJoint = side === 'left' ? 'leftElbow' : 'rightElbow';

      // 1. Test ±100° Flex/Extend, ±165° Pronate/Supinate Twist, and ±70° Radial/Ulnar Tilt with anatomicalLimits ON:
      const cases: Array<[number, number, number]> = [
        [95, 0, 0],
        [-95, 0, 0],
        [0, 165, 0],
        [0, -165, 0],
        [0, 0, 70],
        [0, 0, -70],
        [75, -135, 35], // Combined palm-up dramatic superhero push/spell pose
      ];

      for (const targetDeg of cases) {
        const pose = neutralPose();
        pose[wristJoint] = inspectorDegreesToPoseJoint(targetDeg, wristJoint, fig.handRigs);
        const clamped = clampPoseToAnatomicalLimits(pose, 'anatomical', fig.morphology);
        setFigurePose(fig, clamped);

        const roundTripDeg = poseJointToInspectorDegrees(
          getJointRotation(fig, wristJoint),
          wristJoint,
          fig.handRigs,
        );
        const qExpected = new T.Quaternion().setFromEuler(
          new T.Euler(radians(targetDeg[0]), radians(targetDeg[1]), radians(targetDeg[2]), 'YXZ'),
        );
        const qActual = new T.Quaternion().setFromEuler(
          new T.Euler(radians(roundTripDeg[0]), radians(roundTripDeg[1]), radians(roundTripDeg[2]), 'YXZ'),
        );
        expect(degrees(qActual.angleTo(qExpected))).toBeLessThan(0.5);
      }

      // 2. Test T-pose elbow curl around vertical Y (which previously hit a 12° Z clamp when shoulder rolled!):
      const curlPose = neutralPose();
      curlPose[elbowJoint] = [0, side === 'left' ? radians(115) : radians(-115), radians(40)];
      const clampedCurl = clampPoseToAnatomicalLimits(curlPose, 'anatomical', fig.morphology);
      setFigurePose(fig, clampedCurl);
      const qTarget = new T.Quaternion().setFromEuler(new T.Euler(...curlPose[elbowJoint], 'XYZ'));
      const qSolved = new T.Quaternion().setFromEuler(new T.Euler(...getJointRotation(fig, elbowJoint), 'XYZ'));
      expect(degrees(qSolved.angleTo(qTarget))).toBeLessThan(0.5);
    }
  });

  it('preserves >= 75% wrist cross-section volume at 160° pronation/supination twist with 0.000m wrist displacement', () => {
    const fig = makeSuperhero(modelId);
    setFigurePose(fig, neutralPose());

    for (const side of ['left', 'right'] as const) {
      const wristJoint = side === 'left' ? 'leftWrist' : 'rightWrist';
      const elbowJoint = side === 'left' ? 'leftElbow' : 'rightElbow';

      setFigurePose(fig, neutralPose());
      const restRadius = measureWristCrossSectionRadius(fig, side);

      // Bend elbow 95° AND twist wrist 160° simultaneously:
      const basePose = neutralPose();
      basePose[elbowJoint] = [0, side === 'left' ? radians(95) : radians(-95), 0];
      setFigurePose(fig, basePose);
      const wristPosBeforeTwist = fig.bones[wristJoint].getWorldPosition(new T.Vector3());

      const twistedPose = clone(basePose);
      twistedPose[wristJoint] = inspectorDegreesToPoseJoint([0, 160, 0], wristJoint, fig.handRigs);

      // Verify exact SO(3) algebraic identity of solveForearmWristTwistShare:
      const qEl = new T.Quaternion().setFromEuler(new T.Euler(...twistedPose[elbowJoint], 'XYZ'));
      const qWr = new T.Quaternion().setFromEuler(new T.Euler(...twistedPose[wristJoint], 'XYZ'));
      const shared = solveForearmWristTwistShare(
        qEl,
        qWr,
        fig.handRigs![side].forearmShaftWorld,
        0.5,
      );
      const prodBefore = qEl.clone().multiply(qWr);
      const prodAfter = shared.elbowQuat.clone().multiply(shared.wristQuat);
      expect(prodBefore.angleTo(prodAfter)).toBeLessThan(1e-6);

      setFigurePose(fig, twistedPose);
      const wristPosAfterTwist = fig.bones[wristJoint].getWorldPosition(new T.Vector3());
      const twistedRadius = measureWristCrossSectionRadius(fig, side);

      // Zero wrist joint translation (< 0.01 mm) and >= 75% preserved wrist radius (up from ~37% unshared LBS!)
      expect(wristPosAfterTwist.distanceTo(wristPosBeforeTwist)).toBeLessThan(1e-5);
      expect(twistedRadius / restRadius).toBeGreaterThan(0.75);
    }
  });

  it('rotates the 3D hand mesh in the exact world direction of every viewport FK gizmo ring (dot > 0.99 on X, Y, Z for Left & Right)', () => {
    const fig = makeSuperhero(modelId);

    // Test both neutral T-pose AND a posed bent-arm configuration
    const basePoses: Pose[] = [
      neutralPose(),
      (() => {
        const p = neutralPose();
        p.leftShoulder = [radians(20), radians(25), radians(-45)];
        p.leftElbow = [0, radians(70), 0];
        p.rightShoulder = [radians(20), radians(-25), radians(45)];
        p.rightElbow = [0, radians(-70), 0];
        return p;
      })(),
    ];

    const localAxes = [
      new T.Vector3(1, 0, 0),
      new T.Vector3(0, 1, 0),
      new T.Vector3(0, 0, 1),
    ];

    for (const basePose of basePoses) {
      for (const joint of ['leftWrist', 'rightWrist'] as const) {
        for (const axisLocal of localAxes) {
          setFigurePose(fig, basePose);
          const bone = fig.bones[joint];
          const startBoneLocal = bone.quaternion.clone();
          const startWorldQuat = bone.getWorldQuaternion(new T.Quaternion());

          // Exact world axis of TransformControls local rotation ring at pointerDown:
          const ringWorldAxis = axisLocal.clone().applyQuaternion(startWorldQuat).normalize();

          // Anchor captured on Studio transform mouseDown:
          const anchor = captureFkDragAnchor(
            joint,
            bone,
            fig.rotationBases[joint],
            getJointRotation(fig, joint),
          );

          // Simulate multi-frame TransformControls pointerMove (+12° then +24° along ring):
          for (const dragDeg of [12, 24]) {
            const dAngle = radians(dragDeg);
            // TransformControls local rotate equation: object.quaternion = _quaternionStart * R(axis, dAngle)
            bone.quaternion
              .copy(startBoneLocal)
              .multiply(new T.Quaternion().setFromAxisAngle(axisLocal, dAngle));

            const draggedPose = clone(basePose);
            draggedPose[joint] = computeAnchoredFkDragEuler(anchor, bone.quaternion);
            setFigurePose(fig, draggedPose);

            // Resulting world rotation delta Q_delta = Q_after * inv(Q_before):
            const afterWorldQuat = bone.getWorldQuaternion(new T.Quaternion());
            const worldDelta = afterWorldQuat.clone().multiply(startWorldQuat.clone().invert());
            if (worldDelta.w < 0) {
              worldDelta.x = -worldDelta.x;
              worldDelta.y = -worldDelta.y;
              worldDelta.z = -worldDelta.z;
              worldDelta.w = -worldDelta.w;
            }
            const visualAxis = new T.Vector3(worldDelta.x, worldDelta.y, worldDelta.z).normalize();
            const resolvedAngle = 2 * Math.atan2(
              Math.hypot(worldDelta.x, worldDelta.y, worldDelta.z),
              worldDelta.w,
            );

            expect(visualAxis.dot(ringWorldAxis)).toBeGreaterThan(0.995);
            expect(degrees(resolvedAngle)).toBeCloseTo(dragDeg, 1);
          }
        }
      }
    }
  });

  it('snaps Shift + FK wrist ring drags cleanly in 15° increments without fighting applyPose', () => {
    const fig = makeSuperhero(modelId);
    const snapRad = resolveRotationSnapRad(true)!;
    expect(snapRad).toBeCloseTo(radians(ROTATION_SNAP_DEG), 8);

    const localAxes = [
      new T.Vector3(1, 0, 0),
      new T.Vector3(0, 1, 0),
      new T.Vector3(0, 0, 1),
    ];

    for (const joint of ['leftWrist', 'rightWrist'] as const) {
      for (const axisLocal of localAxes) {
        setFigurePose(fig, neutralPose());
        const bone = fig.bones[joint];
        const startBoneLocal = bone.quaternion.clone();
        const startWorldQuat = bone.getWorldQuaternion(new T.Quaternion());
        const ringWorldAxis = axisLocal.clone().applyQuaternion(startWorldQuat).normalize();

        const anchor = captureFkDragAnchor(
          joint,
          bone,
          fig.rotationBases[joint],
          getJointRotation(fig, joint),
        );

        // Simulate continuous raw pointer angles (8°, 22°, 34°, -47°) with TransformControls Shift rotationSnap:
        for (const [rawPointerDeg, expectedSnapDeg] of [
          [8, 15],
          [22, 15],
          [34, 30],
          [-47, -45],
        ] as const) {
          const rawAngleRad = radians(rawPointerDeg);
          const snappedDeltaRad = Math.round(rawAngleRad / snapRad) * snapRad;

          bone.quaternion
            .copy(startBoneLocal)
            .multiply(new T.Quaternion().setFromAxisAngle(axisLocal, snappedDeltaRad));

          const draggedPose = neutralPose();
          draggedPose[joint] = cleanSnappedEulerVec(
            computeAnchoredFkDragEuler(anchor, bone.quaternion),
            true,
          );
          setFigurePose(fig, draggedPose);

          const afterWorldQuat = bone.getWorldQuaternion(new T.Quaternion());
          const worldDelta = afterWorldQuat.clone().multiply(startWorldQuat.clone().invert());
          if (worldDelta.w < 0) {
            worldDelta.x = -worldDelta.x;
            worldDelta.y = -worldDelta.y;
            worldDelta.z = -worldDelta.z;
            worldDelta.w = -worldDelta.w;
          }
          const sinHalf = Math.hypot(worldDelta.x, worldDelta.y, worldDelta.z);
          const visualAxis = new T.Vector3(worldDelta.x, worldDelta.y, worldDelta.z)
            .normalize()
            .multiplyScalar(expectedSnapDeg >= 0 ? 1 : -1);
          const signedResolvedDeg =
            Math.sign(expectedSnapDeg) * degrees(2 * Math.atan2(sinHalf, worldDelta.w));

          expect(visualAxis.dot(ringWorldAxis)).toBeGreaterThan(0.995);
          expect(signedResolvedDeg).toBeCloseTo(expectedSnapDeg, 2);
        }
      }
    }
  });

  it('calibrates all 30 finger bones and curls Fist, Point, and Spread cleanly without sideways corkscrewing', () => {
    const fig = makeSuperhero(modelId);
    expect(hasPoseableFingers(fig.handRigs, 'left')).toBe(true);
    expect(hasPoseableFingers(fig.handRigs, 'right')).toBe(true);

    for (const side of ['left', 'right'] as const) {
      for (const fId of FINGER_IDS) {
        expect(fig.handRigs![side].fingers[fId]?.phalanges).toHaveLength(3);
      }

      // 1. Neutral bind baseline
      setFigurePose(fig, neutralPose());
      const palmNeutral = palmCenterWorldPosition(fig, side);
      const neutralDist = Object.fromEntries(
        FINGER_IDS.map(f => [f, fingertipWorldPosition(fig, side, f).distanceTo(palmNeutral)]),
      ) as Record<FingerId, number>;
      const neutralSpan = fingertipWorldPosition(fig, side, 'index').distanceTo(
        fingertipWorldPosition(fig, side, 'pinky'),
      );

      // 2. Monotonic curl toward palm from 0 -> 0.5 -> 1.0 (Fist)
      const halfGrip = handPreset('Grip');
      setFigurePose(fig, neutralPose(), { [side]: halfGrip });
      const palmGrip = palmCenterWorldPosition(fig, side);
      const gripDist = Object.fromEntries(
        FINGER_IDS.map(f => [f, fingertipWorldPosition(fig, side, f).distanceTo(palmGrip)]),
      ) as Record<FingerId, number>;

      const fist = handPreset('Fist');
      setFigurePose(fig, neutralPose(), { [side]: fist });
      const palmFist = palmCenterWorldPosition(fig, side);
      for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
        const fistD = fingertipWorldPosition(fig, side, f).distanceTo(palmFist);
        expect(gripDist[f]).toBeLessThan(neutralDist[f] - 0.015);
        expect(fistD).toBeLessThan(gripDist[f]);
        expect(fistD).toBeLessThan(neutralDist[f] * 0.58);
      }
      expect(fingertipWorldPosition(fig, side, 'thumb').distanceTo(palmFist)).toBeLessThan(
        neutralDist.thumb - 0.01,
      );

      // 3. Point preset: Index stays extended while Middle, Ring, and Pinky curl tightly into palm
      setFigurePose(fig, neutralPose(), { [side]: handPreset('Point') });
      const palmPoint = palmCenterWorldPosition(fig, side);
      const pointIndexDist = fingertipWorldPosition(fig, side, 'index').distanceTo(palmPoint);
      expect(pointIndexDist).toBeGreaterThan(neutralDist.index * 0.94);
      for (const curledFinger of ['middle', 'ring', 'pinky'] as const) {
        const d = fingertipWorldPosition(fig, side, curledFinger).distanceTo(palmPoint);
        expect(d).toBeLessThan(neutralDist[curledFinger] * 0.6);
      }

      // 4. Spread preset: Index-to-Pinky span increases significantly over neutral
      setFigurePose(fig, neutralPose(), { [side]: handPreset('Spread') });
      const spreadSpan = fingertipWorldPosition(fig, side, 'index').distanceTo(
        fingertipWorldPosition(fig, side, 'pinky'),
      );
      expect(spreadSpan).toBeGreaterThan(neutralSpan * 1.35);

      // 5. Individual digit isolation: curling Middle alone leaves Index & Ring untouched
      const singleDigit = defaultHandPose();
      singleDigit.middle = 0.9;
      setFigurePose(fig, neutralPose(), { [side]: singleDigit });
      expect(
        fingertipWorldPosition(fig, side, 'index').distanceTo(palmNeutral),
      ).toBeCloseTo(neutralDist.index, 4);
      expect(
        fingertipWorldPosition(fig, side, 'ring').distanceTo(palmNeutral),
      ).toBeCloseTo(neutralDist.ring, 4);
      expect(
        fingertipWorldPosition(fig, side, 'middle').distanceTo(palmNeutral),
      ).toBeLessThan(neutralDist.middle * 0.65);
    }
  });

  it('mirrors wrist & finger poses symmetrically across the YZ plane (Mirror Pose L <-> R)', () => {
    const fig = makeSuperhero(modelId);
    const item = createItem(CHARACTERS[modelId].body, 0, 'heroic');
    item.modelId = modelId;
    item.pose = neutralPose();
    item.pose.leftShoulder = [radians(18), radians(22), radians(-38)];
    item.pose.leftElbow = [0, radians(65), radians(12)];
    item.pose.leftWrist = inspectorDegreesToPoseJoint([48, -115, 28], 'leftWrist', fig.handRigs);
    item.handPose = {
      left: handPreset('Point'),
      right: handPreset('Spread'),
    };

    setFigurePose(fig, item.pose, item.handPose);
    const leftWristBefore = fig.bones.leftWrist.getWorldPosition(new T.Vector3());
    const leftIndexTipBefore = fingertipWorldPosition(fig, 'left', 'index');
    const rightPinkyTipBefore = fingertipWorldPosition(fig, 'right', 'pinky');

    const mirrored = mirrorCharacterPose(item);
    expect(mirrored.handPose?.right).toEqual(handPreset('Point'));
    expect(mirrored.handPose?.left).toEqual(handPreset('Spread'));

    // Inspector degrees on rightWrist match leftWrist identically!
    const leftDegBefore = poseJointToInspectorDegrees(item.pose.leftWrist, 'leftWrist', fig.handRigs);
    const rightDegAfter = poseJointToInspectorDegrees(mirrored.pose!.rightWrist, 'rightWrist', fig.handRigs);
    expect(rightDegAfter[0]).toBeCloseTo(leftDegBefore[0], 2);
    expect(rightDegAfter[1]).toBeCloseTo(leftDegBefore[1], 2);
    expect(rightDegAfter[2]).toBeCloseTo(leftDegBefore[2], 2);

    setFigurePose(fig, mirrored.pose!, mirrored.handPose);
    const rightWristAfter = fig.bones.rightWrist.getWorldPosition(new T.Vector3());
    const rightIndexTipAfter = fingertipWorldPosition(fig, 'right', 'index');
    const leftPinkyTipAfter = fingertipWorldPosition(fig, 'left', 'pinky');

    // Exact sagittal reflection (-X, +Y, +Z) within model bind symmetry (~1 mm):
    expect(rightWristAfter.x).toBeCloseTo(-leftWristBefore.x, 2);
    expect(rightWristAfter.y).toBeCloseTo(leftWristBefore.y, 2);
    expect(rightWristAfter.z).toBeCloseTo(leftWristBefore.z, 2);

    expect(rightIndexTipAfter.x).toBeCloseTo(-leftIndexTipBefore.x, 2);
    expect(rightIndexTipAfter.y).toBeCloseTo(leftIndexTipBefore.y, 2);
    expect(rightIndexTipAfter.z).toBeCloseTo(leftIndexTipBefore.z, 2);

    expect(leftPinkyTipAfter.x).toBeCloseTo(-rightPinkyTipBefore.x, 2);
    expect(leftPinkyTipAfter.y).toBeCloseTo(rightPinkyTipBefore.y, 2);
    expect(leftPinkyTipAfter.z).toBeCloseTo(rightPinkyTipBefore.z, 2);

    // Double mirror is exact involution
    expect(mirrorPose(mirrored.pose!)).toEqual(item.pose);
  });
});

describe('handPose portable validation, backward compatibility, and mannequin articulation', () => {
  it('round-trips handPose through Scene JSON, PoseFile JSON, Copy/Paste Pose, and swapItemBodyKind with legacy compatibility', () => {
    const scene = initialScene();
    scene.items[0]!.modelId = 'quaternius-superhero-male';
    scene.items[0]!.handPose = {
      left: handPreset('Fist'),
      right: handPreset('Peace'),
    };

    // 1. Scene JSON round-trip
    const parsedScene = parseFile(JSON.stringify(scene));
    if (parsedScene.type !== 'scene') throw new Error('Expected scene');
    expect(parsedScene.items[0]!.handPose).toEqual({
      left: handPreset('Fist'),
      right: handPreset('Peace'),
    });
    // Legacy item without handPose stays undefined (clean minimal JSON)
    expect(parsedScene.items[1]!.handPose).toBeUndefined();

    // 2. PoseFile JSON round-trip & applyPose
    const exportedPose = poseFile(parsedScene.items[0]!, 'Hero Power Hands');
    const roundTrippedPose = parsePoseFile(JSON.stringify(exportedPose));
    expect(roundTrippedPose.handPose).toEqual({
      left: handPreset('Fist'),
      right: handPreset('Peace'),
    });

    const targetFemale = createItem('female', 0, 'heroic');
    const withApplied = applyPose(targetFemale, roundTrippedPose);
    expect(withApplied.handPose).toEqual({
      left: handPreset('Fist'),
      right: handPreset('Peace'),
    });

    // Applying a legacy PoseFile without handPose clears stale handPose cleanly
    const legacyPoseJson = JSON.stringify({
      schemaVersion: 1,
      rigVersion: 1,
      type: 'pose',
      name: 'Legacy Neutral',
      body: 'female',
      pose: neutralPose(),
    });
    const cleared = applyPose(withApplied, parsePoseFile(legacyPoseJson));
    expect(cleared.handPose).toBeUndefined();

    // 3. Partial Copy/Paste Pose copies only selected wrist handPose
    const clipLeftOnly = copyPoseNodes(parsedScene.items[0]!, ['leftShoulder', 'leftElbow', 'leftWrist']);
    expect(clipLeftOnly.handPose).toEqual({ left: handPreset('Fist') });
    const pastedLeft = pastePoseNodes(targetFemale, clipLeftOnly);
    expect(pastedLeft.handPose).toEqual({ left: handPreset('Fist') });

    // 4. Swapping base figure preserves handPose
    const swapped = swapItemBodyKind(pastedLeft, 'male', 0, 'quaternius-superhero-male');
    expect(swapped.handPose).toEqual({ left: handPreset('Fist') });
  });

  it('poses Mannequin finger bones cleanly alongside the CPU extreme-pose deformer', () => {
    const man = buildExternalFigure('male', mannequinTemplates.get('male')!, '#d99b78', '#2b4a78');
    man.deformation = { bodyType: 'heroic', limitMode: 'anatomical' };
    expect(hasPoseableFingers(man.handRigs, 'left')).toBe(true);

    setFigurePose(man, neutralPose());
    const palm0 = palmCenterWorldPosition(man, 'left');
    const dist0 = fingertipWorldPosition(man, 'left', 'middle').distanceTo(palm0);

    setFigurePose(man, neutralPose(), { left: handPreset('Fist') });
    const palm1 = palmCenterWorldPosition(man, 'left');
    const dist1 = fingertipWorldPosition(man, 'left', 'middle').distanceTo(palm1);
    expect(dist1).toBeLessThan(dist0 * 0.65);
  });
});
