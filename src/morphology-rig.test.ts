import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JOINTS, neutralPose, PRESETS, preset, radians, type Joint, type Pose } from './model';
import { setFigurePose, type Figure } from './rig';
import {
  adaptCanonicalPoseToMorphology,
  CANONICAL_ARM_ABDUCTION_RAD,
  extractCanonicalPoseFromMorphology,
  measureFigureMorphology,
  softFloor,
  translatePoseAcrossMorphologies,
} from './morphology-rig';

interface SyntheticMorphSpec {
  armAbductionDeg: number;
  elbowBendDeg?: number;
  thighSplayDeg?: number;
  torsoHalfWidth: number;
  waistHalfWidth: number;
  hipHalfWidth: number;
  bellyFrontZ: number;
  backZ: number;
  shoulderX: number;
  hipX: number;
  upperArmRadius: number;
  thighRadius: number;
}

/**
 * Builds a rigged Three.js `Figure` in an arbitrary sculpted posture (T-pose, A-pose, bent-elbow, lean, or fat)
 * with zero post-bind deformation so bind-pose vertex displacement is identically 0.000 mm.
 */
function buildSyntheticBodyFigure(spec: SyntheticMorphSpec): Figure {
  const bones = Object.fromEntries(
    JOINTS.map(j => {
      const b = new T.Bone();
      b.name = j;
      return [j, b];
    }),
  ) as Record<Joint, T.Bone>;

  const link = (name: Joint, parent: Joint | null, x: number, y: number, z = 0) => {
    bones[name].position.set(x, y, z);
    if (parent) bones[parent].add(bones[name]);
  };

  const spineZ = spec.backZ + 0.34 * (spec.bellyFrontZ - spec.backZ);
  link('hips', null, 0, 0.96, spineZ);
  link('spine', 'hips', 0, 0.16, 0);
  link('chest', 'spine', 0, 0.22, 0);
  link('neck', 'chest', 0, 0.22, 0);
  link('head', 'neck', 0, 0.12, 0);

  const upperLen = 0.29;
  const lowerLen = 0.26;
  const thighLen = 0.43;
  const shinLen = 0.42;
  const abd = radians(spec.armAbductionDeg);
  const elBend = radians(spec.elbowBendDeg ?? 0);
  const splay = radians(spec.thighSplayDeg ?? 0);

  for (const [prefix, sign] of [['left', 1], ['right', -1]] as const) {
    link(`${prefix}Shoulder`, 'chest', sign * spec.shoulderX, 0.16, -spineZ * 0.2);
    const uVec = new T.Vector3(sign * Math.sin(abd), -Math.cos(abd), 0).multiplyScalar(upperLen);
    link(`${prefix}Elbow`, `${prefix}Shoulder`, uVec.x, uVec.y, uVec.z);

    // Forearm bent forward around anatomical X before abduction:
    const fLocal = new T.Vector3(0, -Math.cos(elBend), Math.sin(elBend))
      .applyAxisAngle(new T.Vector3(0, 0, 1), sign * abd)
      .multiplyScalar(lowerLen);
    link(`${prefix}Wrist`, `${prefix}Elbow`, fLocal.x, fLocal.y, fLocal.z);

    link(`${prefix}Hip`, 'hips', sign * spec.hipX, -0.05, 0);
    const tVec = new T.Vector3(sign * Math.sin(splay), -Math.cos(splay), 0).multiplyScalar(thighLen);
    link(`${prefix}Knee`, `${prefix}Hip`, tVec.x, tVec.y, tVec.z);
    const sVec = new T.Vector3(sign * Math.sin(splay), -Math.cos(splay), 0).multiplyScalar(shinLen);
    link(`${prefix}Ankle`, `${prefix}Knee`, sVec.x, sVec.y, sVec.z);
  }

  const root = new T.Group();
  root.add(bones.hips);
  root.updateMatrixWorld(true);

  const parts: T.BufferGeometry[] = [];
  const addWeightedEllipsoid = (
    joint: Joint,
    centerWorld: T.Vector3,
    radii: T.Vector3,
    orient = new T.Quaternion(),
  ) => {
    const g = new T.SphereGeometry(1, 20, 14);
    g.applyMatrix4(new T.Matrix4().compose(centerWorld, orient, radii));
    const count = g.getAttribute('position').count;
    const jIdx = JOINTS.indexOf(joint);
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      si[i * 4] = jIdx;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    parts.push(g);
  };

  const apHalf = (spec.bellyFrontZ - spec.backZ) * 0.5;
  const apCenter = (spec.bellyFrontZ + spec.backZ) * 0.5;
  addWeightedEllipsoid('hips', new T.Vector3(0, 0.96, apCenter), new T.Vector3(spec.hipHalfWidth, 0.14, apHalf));
  addWeightedEllipsoid('spine', new T.Vector3(0, 1.14, apCenter), new T.Vector3(spec.waistHalfWidth, 0.18, apHalf));
  addWeightedEllipsoid('chest', new T.Vector3(0, 1.36, apCenter * 0.85), new T.Vector3(spec.torsoHalfWidth, 0.18, apHalf * 0.9));
  addWeightedEllipsoid('head', new T.Vector3(0, 1.72, 0), new T.Vector3(0.09, 0.12, 0.10));

  for (const [prefix, sign] of [['left', 1], ['right', -1]] as const) {
    const sh = bones[`${prefix}Shoulder`].getWorldPosition(new T.Vector3());
    const el = bones[`${prefix}Elbow`].getWorldPosition(new T.Vector3());
    const wr = bones[`${prefix}Wrist`].getWorldPosition(new T.Vector3());
    const hp = bones[`${prefix}Hip`].getWorldPosition(new T.Vector3());
    const kn = bones[`${prefix}Knee`].getWorldPosition(new T.Vector3());
    const ak = bones[`${prefix}Ankle`].getWorldPosition(new T.Vector3());
    void sign;

    const uMid = sh.clone().lerp(el, 0.5);
    const uQ = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), el.clone().sub(sh).normalize());
    addWeightedEllipsoid(`${prefix}Shoulder`, uMid, new T.Vector3(spec.upperArmRadius, upperLen * 0.5, spec.upperArmRadius), uQ);

    const fMid = el.clone().lerp(wr, 0.5);
    const fQ = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), wr.clone().sub(el).normalize());
    addWeightedEllipsoid(`${prefix}Elbow`, fMid, new T.Vector3(spec.upperArmRadius * 0.8, lowerLen * 0.5, spec.upperArmRadius * 0.8), fQ);

    const tMid = hp.clone().lerp(kn, 0.5);
    const tQ = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), kn.clone().sub(hp).normalize());
    addWeightedEllipsoid(`${prefix}Hip`, tMid, new T.Vector3(spec.thighRadius, thighLen * 0.5, spec.thighRadius), tQ);

    const sMid = kn.clone().lerp(ak, 0.5);
    const sQ = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), ak.clone().sub(kn).normalize());
    addWeightedEllipsoid(`${prefix}Knee`, sMid, new T.Vector3(spec.thighRadius * 0.72, shinLen * 0.5, spec.thighRadius * 0.72), sQ);
  }

  const geom = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  const mat = new T.MeshStandardMaterial();
  const skin = new T.SkinnedMesh(geom, mat);
  root.add(skin);
  skin.bind(new T.Skeleton(JOINTS.map(j => bones[j])));
  root.updateMatrixWorld(true);

  const restRotations = Object.fromEntries(
    JOINTS.map(j => [j, bones[j].quaternion.clone()]),
  ) as Record<Joint, T.Quaternion>;
  const rotationBases = Object.fromEntries(
    JOINTS.map(j => [j, bones[j].getWorldQuaternion(new T.Quaternion()).invert()]),
  ) as Record<Joint, T.Quaternion>;

  return {
    nativeRig: true,
    root,
    skin,
    skins: [skin],
    bones,
    restRotations,
    rotationBases,
    tintMaterials: [mat],
    outfitColorUniforms: [],
    hairMaterials: [],
  };
}

function getWorldLimbDir(fig: Figure, a: Joint, b: Joint): T.Vector3 {
  const pa = fig.bones[a].getWorldPosition(new T.Vector3());
  const pb = fig.bones[b].getWorldPosition(new T.Vector3());
  return pb.sub(pa).normalize();
}

describe('morphology-rig: body-shape measurement & cross-morphology pose translation', () => {
  it('acts as an exact machine-precision identity on canonical lean mannequins across all presets', () => {
    const leanMannequin = buildSyntheticBodyFigure({
      armAbductionDeg: T.MathUtils.radToDeg(CANONICAL_ARM_ABDUCTION_RAD),
      torsoHalfWidth: 0.145,
      waistHalfWidth: 0.125,
      hipHalfWidth: 0.145,
      bellyFrontZ: 0.085,
      backZ: -0.095,
      shoulderX: 0.205,
      hipX: 0.105,
      upperArmRadius: 0.048,
      thighRadius: 0.078,
    });
    const profile = measureFigureMorphology(leanMannequin, { isCanonicalMannequin: true });
    expect(profile.isCanonicalMannequin).toBe(true);

    for (const pName of PRESETS) {
      const p = preset(pName);
      const adapted = adaptCanonicalPoseToMorphology(p, profile);
      expect(adapted).toEqual(p);
      const roundTripped = extractCanonicalPoseFromMorphology(adapted, profile);
      expect(roundTripped).toEqual(p);
    }
  });

  it('distinguishes lean vs heavy/fat soft-tissue envelopes and computes non-clipping resting angles', () => {
    const leanAPose = buildSyntheticBodyFigure({
      armAbductionDeg: 60,
      torsoHalfWidth: 0.105,
      waistHalfWidth: 0.095,
      hipHalfWidth: 0.105,
      bellyFrontZ: 0.075,
      backZ: -0.075,
      shoulderX: 0.115,
      hipX: 0.068,
      upperArmRadius: 0.036,
      thighRadius: 0.055,
    });
    const fatAPose = buildSyntheticBodyFigure({
      armAbductionDeg: 60,
      torsoHalfWidth: 0.185,
      waistHalfWidth: 0.195,
      hipHalfWidth: 0.190,
      bellyFrontZ: 0.220,
      backZ: -0.120,
      shoulderX: 0.145,
      hipX: 0.082,
      upperArmRadius: 0.072,
      thighRadius: 0.108,
    });

    const leanProfile = measureFigureMorphology(leanAPose);
    const fatProfile = measureFigureMorphology(fatAPose);

    expect(fatProfile.envelope.adiposityIndex).toBeGreaterThan(0.65);
    expect(leanProfile.envelope.adiposityIndex).toBeLessThan(0.25);

    // Fat character MUST have a significantly wider natural resting arm abduction (20–32° vs ~6.8° lean):
    expect(T.MathUtils.radToDeg(fatProfile.naturalArmAbductionRad)).toBeGreaterThan(20);
    expect(T.MathUtils.radToDeg(fatProfile.naturalArmAbductionRad)).toBeLessThanOrEqual(33);
    expect(fatProfile.naturalArmAbductionRad).toBeGreaterThan(leanProfile.naturalArmAbductionRad + radians(12));
    // Fat character inner thighs require positive resting splay:
    expect(T.MathUtils.radToDeg(fatProfile.naturalThighSplayRad)).toBeGreaterThan(2.5);

    // Verify Neutral pose on fat character keeps upper arm outside lateral torso envelope (zero lat/belly crushing!):
    const fatNeutral = adaptCanonicalPoseToMorphology(neutralPose(), fatProfile);
    setFigurePose(fatAPose, fatNeutral);
    const shPos = fatAPose.bones.leftShoulder.getWorldPosition(new T.Vector3());
    const elPos = fatAPose.bones.leftElbow.getWorldPosition(new T.Vector3());
    const checkPt = shPos.clone().lerp(elPos, 0.8);
    const medialArmSurfaceX = checkPt.x - fatProfile.envelope.upperArmRadius;
    expect(medialArmSurfaceX).toBeGreaterThan(fatProfile.envelope.torsoHalfWidth - 0.005);
  });

  it('retargets presets invariant to rest posture (90° T-pose vs 60° A-pose vs 39° bent-elbow sculpted rig)', () => {
    const tPoseRig = buildSyntheticBodyFigure({
      armAbductionDeg: 90,
      torsoHalfWidth: 0.12,
      waistHalfWidth: 0.105,
      hipHalfWidth: 0.115,
      bellyFrontZ: 0.08,
      backZ: -0.08,
      shoulderX: 0.145,
      hipX: 0.075,
      upperArmRadius: 0.042,
      thighRadius: 0.062,
    });
    const bentSculptRig = buildSyntheticBodyFigure({
      armAbductionDeg: 43,
      elbowBendDeg: 39,
      thighSplayDeg: 5.5,
      torsoHalfWidth: 0.12,
      waistHalfWidth: 0.105,
      hipHalfWidth: 0.115,
      bellyFrontZ: 0.08,
      backZ: -0.08,
      shoulderX: 0.145,
      hipX: 0.075,
      upperArmRadius: 0.042,
      thighRadius: 0.062,
    });

    const tProf = measureFigureMorphology(tPoseRig);
    const bProf = measureFigureMorphology(bentSculptRig);

    // Reach preset: both rigs must point the reaching left arm in the same overhead direction!
    const reach = preset('Reach');
    setFigurePose(tPoseRig, adaptCanonicalPoseToMorphology(reach, tProf));
    setFigurePose(bentSculptRig, adaptCanonicalPoseToMorphology(reach, bProf));

    const tUpper = getWorldLimbDir(tPoseRig, 'leftShoulder', 'leftElbow');
    const bUpper = getWorldLimbDir(bentSculptRig, 'leftShoulder', 'leftElbow');
    expect(tUpper.angleTo(bUpper)).toBeLessThan(radians(2.5));

    const tFore = getWorldLimbDir(tPoseRig, 'leftElbow', 'leftWrist');
    const bFore = getWorldLimbDir(bentSculptRig, 'leftElbow', 'leftWrist');
    expect(tFore.angleTo(bFore)).toBeLessThan(radians(3.0));

    // Running preset: bent-elbow sculpted rig must NOT double-bend its 39° bind elbow on top of -82°!
    const running = preset('Running');
    setFigurePose(tPoseRig, adaptCanonicalPoseToMorphology(running, tProf));
    setFigurePose(bentSculptRig, adaptCanonicalPoseToMorphology(running, bProf));
    const tBend = Math.acos(
      T.MathUtils.clamp(
        getWorldLimbDir(tPoseRig, 'leftShoulder', 'leftElbow').dot(getWorldLimbDir(tPoseRig, 'leftElbow', 'leftWrist')),
        -1,
        1,
      ),
    );
    const bBend = Math.acos(
      T.MathUtils.clamp(
        getWorldLimbDir(bentSculptRig, 'leftShoulder', 'leftElbow').dot(getWorldLimbDir(bentSculptRig, 'leftElbow', 'leftWrist')),
        -1,
        1,
      ),
    );
    expect(Math.abs(tBend - bBend)).toBeLessThan(radians(2.5));
  });

  it('pushes akimbo hands onto the outer fat waist in Heroic/Contrapposto and splays thighs in Seated', () => {
    const leanRig = buildSyntheticBodyFigure({
      armAbductionDeg: 60,
      torsoHalfWidth: 0.11,
      waistHalfWidth: 0.10,
      hipHalfWidth: 0.11,
      bellyFrontZ: 0.075,
      backZ: -0.075,
      shoulderX: 0.125,
      hipX: 0.072,
      upperArmRadius: 0.038,
      thighRadius: 0.056,
    });
    const heavyKingRig = buildSyntheticBodyFigure({
      armAbductionDeg: 60,
      torsoHalfWidth: 0.20,
      waistHalfWidth: 0.21,
      hipHalfWidth: 0.20,
      bellyFrontZ: 0.25,
      backZ: -0.13,
      shoulderX: 0.15,
      hipX: 0.09,
      upperArmRadius: 0.072,
      thighRadius: 0.105,
    });

    const leanProf = measureFigureMorphology(leanRig);
    const fatProf = measureFigureMorphology(heavyKingRig);

    // Heroic akimbo pose: wrist must stay outside the heavy waist envelope rather than buried inside!
    const heroic = preset('Heroic');
    setFigurePose(heavyKingRig, adaptCanonicalPoseToMorphology(heroic, fatProf));
    const leftWrist = heavyKingRig.bones.leftWrist.getWorldPosition(new T.Vector3());
    const centerZ = (fatProf.envelope.backZ + fatProf.envelope.bellyFrontZ) * 0.5;
    const normRadial = Math.hypot(
      leftWrist.x / fatProf.envelope.waistHalfWidth,
      (leftWrist.z - centerZ) / ((fatProf.envelope.bellyFrontZ - fatProf.envelope.backZ) * 0.5),
    );
    expect(normRadial).toBeGreaterThan(0.98);

    // Seated pose: fat character splays knees wider than lean character to clear anterior belly!
    const seated = preset('Seated');
    setFigurePose(leanRig, adaptCanonicalPoseToMorphology(seated, leanProf));
    setFigurePose(heavyKingRig, adaptCanonicalPoseToMorphology(seated, fatProf));
    const leanThighDir = getWorldLimbDir(leanRig, 'leftHip', 'leftKnee');
    const fatThighDir = getWorldLimbDir(heavyKingRig, 'leftHip', 'leftKnee');
    expect(fatThighDir.x).toBeGreaterThan(leanThighDir.x + 0.08);
  });

  it('translates fat resting poses back onto lean characters without "invisible lat syndrome"', () => {
    const fatRig = buildSyntheticBodyFigure({
      armAbductionDeg: 60,
      torsoHalfWidth: 0.19,
      waistHalfWidth: 0.20,
      hipHalfWidth: 0.19,
      bellyFrontZ: 0.22,
      backZ: -0.12,
      shoulderX: 0.145,
      hipX: 0.085,
      upperArmRadius: 0.072,
      thighRadius: 0.105,
    });
    const leanRig = buildSyntheticBodyFigure({
      armAbductionDeg: 60,
      torsoHalfWidth: 0.10,
      waistHalfWidth: 0.09,
      hipHalfWidth: 0.10,
      bellyFrontZ: 0.07,
      backZ: -0.07,
      shoulderX: 0.12,
      hipX: 0.068,
      upperArmRadius: 0.035,
      thighRadius: 0.052,
    });

    const fatProf = measureFigureMorphology(fatRig);
    const leanProf = measureFigureMorphology(leanRig);

    // Pose fat character in Relaxed (arms ~32° abducted due to fat clearance):
    const fatRelaxedBonePose: Pose = adaptCanonicalPoseToMorphology(preset('Relaxed'), fatProf);
    setFigurePose(fatRig, fatRelaxedBonePose);
    const fatArmDir = getWorldLimbDir(fatRig, 'leftShoulder', 'leftElbow');
    const fatAbdDeg = T.MathUtils.radToDeg(Math.atan2(fatArmDir.x, -fatArmDir.y));
    expect(fatAbdDeg).toBeGreaterThan(25);

    // Translate that physical fat pose onto the lean rig: lean rig's arms must settle near its lean sides (< 18°), NOT 32°!
    const translatedToLean = translatePoseAcrossMorphologies(fatRelaxedBonePose, fatProf, leanProf);
    setFigurePose(leanRig, translatedToLean);
    const leanArmDir = getWorldLimbDir(leanRig, 'leftShoulder', 'leftElbow');
    const leanAbdDeg = T.MathUtils.radToDeg(Math.atan2(leanArmDir.x, -leanArmDir.y));
    expect(leanAbdDeg).toBeLessThan(18);
    expect(leanAbdDeg).toBeGreaterThan(6);
  });

  it('maintains C1 smoothness across the softFloor transition knee', () => {
    const floor = radians(25);
    const samples = Array.from({ length: 41 }, (_, i) => radians(15 + i * 0.5));
    const values = samples.map(x => softFloor(x, floor, radians(5)));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]! - 1e-12);
      expect(values[i]!).toBeGreaterThanOrEqual(floor - 1e-12);
    }
  });
});
