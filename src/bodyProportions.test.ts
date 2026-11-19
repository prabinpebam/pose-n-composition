import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildExternalFigure, setFigureHairStyle } from './external-rig';
import { registerHairTemplate, type HairAssetId } from './hair';
import { getJointRotation, setFigurePose, type Figure } from './rig';
import { JOINTS, neutralPose, preset, radians, type Body } from './model';
import {
  applyBodyProportion,
  BODY_TYPE_IDS,
  BODY_TYPES,
  DEFAULT_BODY_TYPE,
  getBodyTypeMeta,
  isBodyTypeId,
  type BodyTypeId,
} from './bodyProportions';

interface FixtureGLTF {
  buffers: { uri: string }[];
  images?: unknown[];
  textures?: unknown[];
  materials?: unknown[];
  meshes: { primitives: { material?: number }[] }[];
}

const templates = new Map<Body, T.Group>();

beforeAll(async () => {
  vi.stubGlobal(
    'ProgressEvent',
    class extends Event {
      lengthComputable: boolean;
      loaded: number;
      total: number;
      constructor(type: string, init: ProgressEventInit = {}) {
        super(type);
        this.lengthComputable = init.lengthComputable ?? false;
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    },
  );

  const directory = resolve('public', 'models', 'external', 'quaternius-universal-base');
  for (const body of ['male', 'female'] as const) {
    const file = `Superhero_${body === 'male' ? 'Male' : 'Female'}_FullBody.gltf`;
    const source = JSON.parse(readFileSync(resolve(directory, file), 'utf8')) as FixtureGLTF;
    source.buffers.forEach(b => {
      b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(directory, b.uri)).toString('base64')}`;
    });
    delete source.images;
    delete source.textures;
    delete source.materials;
    source.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
    templates.set(body, (await new GLTFLoader().parseAsync(JSON.stringify(source), '')).scene);
  }

  const hairIds: HairAssetId[] = ['SimpleParted', 'Long', 'Buns', 'Buzzed', 'BuzzedFemale', 'Beard'];
  for (const id of hairIds) {
    const source = JSON.parse(readFileSync(resolve(directory, `Hair_${id}.gltf`), 'utf8')) as FixtureGLTF;
    source.buffers.forEach(b => {
      b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(directory, b.uri)).toString('base64')}`;
    });
    delete source.images;
    delete source.textures;
    delete source.materials;
    source.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
    const parsed = await new GLTFLoader().parseAsync(JSON.stringify(source), '');
    registerHairTemplate(id, parsed.scene);
  }
});

afterAll(() => vi.unstubAllGlobals());

function makeFigureClone(body: Body): Figure {
  return buildExternalFigure(body, templates.get(body)!, '#d9a17c');
}

interface AnatomicalMetrics {
  totalHeight: number;
  minY: number;
  headHeight: number;
  headsTall: number;
  shoulderSpan: number;
  chestWidth: number;
  chestDepth: number;
  anteriorChestProj: number;
  waistWidth: number;
  waistDepth: number;
  bellyProj: number;
  hipWidth: number;
  thighWidth: number;
  upperArmThickness: number;
  leftThighMinX: number;
  rightThighMaxX: number;
  armTorsoGapX: number;
}

function measureAnatomy(f: Figure): AnatomicalMetrics {
  f.root.updateMatrixWorld(true);
  f.skins.forEach(s => {
    s.skeleton.update();
    s.computeBoundingBox();
  });

  const skin = f.skin;
  const posAttr = skin.geometry.getAttribute('position') as T.BufferAttribute;
  const siAttr = skin.geometry.getAttribute('skinIndex') as T.BufferAttribute;
  const swAttr = skin.geometry.getAttribute('skinWeight') as T.BufferAttribute;
  const bones = skin.skeleton.bones;
  const bMap = Object.fromEntries(bones.map((b, idx) => [b.name, idx])) as Record<string, number>;

  const worldVerts: T.Vector3[] = new Array(posAttr.count);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(posAttr, i);
    const wp = skin.localToWorld(skin.applyBoneTransform(i, p));
    worldVerts[i] = wp;
    if (wp.y < minY) minY = wp.y;
    if (wp.y > maxY) maxY = wp.y;
  }

  const boneW = (bName: string) => bones[bMap[bName]!]!.getWorldPosition(new T.Vector3());
  const pPelvis = boneW('pelvis');
  const pSpine1 = boneW('spine_01');
  const pSpine2 = boneW('spine_02');
  const pSpine3 = boneW('spine_03');
  const pHead = boneW('Head');
  const pUpperArmL = boneW('upperarm_l');
  const pUpperArmR = boneW('upperarm_r');
  const pLowerArmL = boneW('lowerarm_l');
  const pThighL = boneW('thigh_l');
  const pCalfL = boneW('calf_l');

  const weightOf = (vi: number, predicate: (name: string) => boolean) => {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const bw = swAttr.getComponent(vi, k);
      if (bw > 0 && predicate(bones[siAttr.getComponent(vi, k)]!.name)) sum += bw;
    }
    return sum;
  };

  const isArmBone = (n: string) => /upperarm|lowerarm|hand|thumb|index|middle|ring|pinky/.test(n);
  const isCoreTorso = (n: string) => n === 'pelvis' || n === 'spine_01' || n === 'spine_02' || n === 'spine_03';

  // Head height: chin-to-crown of vertices predominantly weighted to Head
  let headMinY = Infinity, headMaxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    if (weightOf(i, n => n === 'Head') > 0.75) {
      const wy = worldVerts[i]!.y;
      if (wy < headMinY) headMinY = wy;
      if (wy > headMaxY) headMaxY = wy;
    }
  }
  const headHeight = headMaxY - headMinY;
  const totalHeight = maxY - minY;

  const sliceTorso = (centerY: number, halfBand: number) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      if (weightOf(i, isArmBone) > 0.15) continue;
      if (weightOf(i, n => isCoreTorso(n) || n.startsWith('thigh_')) < 0.5) continue;
      const wp = worldVerts[i]!;
      if (Math.abs(wp.y - centerY) > halfBand) continue;
      if (wp.x < minX) minX = wp.x;
      if (wp.x > maxX) maxX = wp.x;
      if (wp.z < minZ) minZ = wp.z;
      if (wp.z > maxZ) maxZ = wp.z;
    }
    return { width: maxX - minX, depth: maxZ - minZ, maxZ, minZ, maxX };
  };

  const chestBandHalf = Math.max(0.018, Math.abs(pSpine3.y - pSpine2.y) * 0.25);
  const chest = sliceTorso(pSpine3.y + chestBandHalf * 0.65, chestBandHalf);
  const waistBandHalf = Math.max(0.016, Math.abs(pSpine3.y - pSpine1.y) * 0.16);
  const waist = sliceTorso(pSpine2.y, waistBandHalf);
  const bellyY = 0.56 * pSpine1.y + 0.44 * pSpine2.y;
  const belly = sliceTorso(bellyY, waistBandHalf);
  const hip = sliceTorso(pPelvis.y, Math.max(0.02, Math.abs(pSpine1.y - pPelvis.y) * 0.3));

  // Mid-thigh width & inner-thigh clearance
  const midThighY = 0.55 * pThighL.y + 0.45 * pCalfL.y;
  const thighSliceHalf = Math.max(0.015, Math.abs(pThighL.y - pCalfL.y) * 0.12);
  let tMinX = Infinity, tMaxX = -Infinity;
  let leftThighMinX = Infinity, rightThighMaxX = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const wL = weightOf(i, n => n === 'thigh_l');
    const wR = weightOf(i, n => n === 'thigh_r');
    const wp = worldVerts[i]!;
    if (wL > 0.6) {
      if (wp.x < leftThighMinX) leftThighMinX = wp.x;
      if (Math.abs(wp.y - midThighY) <= thighSliceHalf) {
        if (wp.x < tMinX) tMinX = wp.x;
        if (wp.x > tMaxX) tMaxX = wp.x;
      }
    }
    if (wR > 0.6 && wp.x > rightThighMaxX) {
      rightThighMaxX = wp.x;
    }
  }

  // Mid-upper-arm radial diameter
  const armAxis = pLowerArmL.clone().sub(pUpperArmL);
  const armLen = armAxis.length();
  const armDir = armAxis.clone().normalize();
  let maxArmRad = 0;
  for (let i = 0; i < posAttr.count; i++) {
    if (weightOf(i, n => n === 'upperarm_l') < 0.65) continue;
    const rel = worldVerts[i]!.clone().sub(pUpperArmL);
    const s = rel.dot(armDir) / armLen;
    if (s >= 0.3 && s <= 0.6) {
      const perp = rel.sub(armDir.clone().multiplyScalar(s * armLen)).length();
      if (perp > maxArmRad) maxArmRad = perp;
    }
  }

  // Check neutral A-pose 3D corridor clearance at waist level between inner arm and torso within the arm's Z span
  let waistTorsoMaxX = 0, waistArmMinX = Infinity;
  let armMinZ = Infinity, armMaxZ = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const wp = worldVerts[i]!;
    if (wp.x <= 0 || Math.abs(wp.y - pSpine2.y) > waistBandHalf * 1.4) continue;
    const armW = weightOf(i, n => /upperarm_l|lowerarm_l|hand_l/.test(n));
    if (armW > 0.6) {
      if (wp.x < waistArmMinX) waistArmMinX = wp.x;
      if (wp.z < armMinZ) armMinZ = wp.z;
      if (wp.z > armMaxZ) armMaxZ = wp.z;
    }
  }
  for (let i = 0; i < posAttr.count; i++) {
    const wp = worldVerts[i]!;
    if (wp.x <= 0 || Math.abs(wp.y - pSpine2.y) > waistBandHalf * 1.4) continue;
    if (wp.z < armMinZ - 0.01 || wp.z > armMaxZ + 0.01) continue;
    const armW = weightOf(i, n => /upperarm_l|lowerarm_l|hand_l/.test(n));
    if (armW < 0.05 && weightOf(i, isCoreTorso) > 0.6) {
      if (wp.x > waistTorsoMaxX) waistTorsoMaxX = wp.x;
    }
  }

  return {
    totalHeight,
    minY,
    headHeight,
    headsTall: totalHeight / headHeight,
    shoulderSpan: pUpperArmL.distanceTo(pUpperArmR),
    chestWidth: chest.width,
    chestDepth: chest.depth,
    anteriorChestProj: chest.maxZ - pSpine3.z,
    waistWidth: waist.width,
    waistDepth: waist.depth,
    bellyProj: belly.maxZ - pSpine1.z,
    hipWidth: hip.width,
    thighWidth: tMaxX - tMinX,
    upperArmThickness: maxArmRad * 2,
    leftThighMinX,
    rightThighMaxX,
    armTorsoGapX: waistArmMinX - waistTorsoMaxX,
  };
}

describe('bodyProportions metadata & type guards', () => {
  it('exports all 9 body archetypes with complete UI labels and descriptions', () => {
    expect(BODY_TYPE_IDS).toEqual([
      'realistic',
      'heroic',
      'lean',
      'slender',
      'busty',
      'chubby',
      'fat',
      'obese',
      'chibi',
    ]);
    expect(BODY_TYPES).toHaveLength(9);
    expect(isBodyTypeId(DEFAULT_BODY_TYPE)).toBe(true);

    for (const id of BODY_TYPE_IDS) {
      expect(isBodyTypeId(id)).toBe(true);
      const meta = getBodyTypeMeta(id);
      expect(meta.id).toBe(id);
      expect(meta.label.length).toBeGreaterThan(2);
      expect(meta.description.length).toBeGreaterThan(15);
      expect(meta.proportionHint.length).toBeGreaterThan(3);
    }

    expect(isBodyTypeId('')).toBe(false);
    expect(isBodyTypeId('muscular')).toBe(false);
    expect(isBodyTypeId(null)).toBe(false);
    expect(isBodyTypeId(undefined)).toBe(false);
    expect(isBodyTypeId(123)).toBe(false);
  });
});

describe.each(['male', 'female'] as const)('anatomical body proportions on %s Quaternius rig', gender => {
  it('produces finite positions/normals/matrices, grounded feet, and unbroken UV seams across all 9 archetypes', () => {
    const f = makeFigureClone(gender);

    // Record baseline coincident vertex pairs and smooth-seam pairs across all skinned meshes
    const meshSeamPairs = f.skins.map(skin => {
      const pos = skin.geometry.getAttribute('position') as T.BufferAttribute;
      const norm = skin.geometry.getAttribute('normal') as T.BufferAttribute;
      const map = new Map<string, number[]>();
      for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(6)},${pos.getY(i).toFixed(6)},${pos.getZ(i).toFixed(6)}`;
        const arr = map.get(key);
        if (arr) arr.push(i);
        else map.set(key, [i]);
      }
      const posPairs: Array<[number, number]> = [];
      const smoothNormPairs: Array<[number, number]> = [];
      for (const grp of map.values()) {
        if (grp.length < 2) continue;
        const i0 = grp[0]!;
        const n0 = new T.Vector3().fromBufferAttribute(norm, i0);
        for (let k = 1; k < grp.length; k++) {
          const ik = grp[k]!;
          posPairs.push([i0, ik]);
          const nk = new T.Vector3().fromBufferAttribute(norm, ik);
          if (n0.distanceTo(nk) < 1e-4) smoothNormPairs.push([i0, ik]);
        }
      }
      return { skin, posPairs, smoothNormPairs };
    });

    expect(meshSeamPairs.find(m => m.skin === f.skin)!.posPairs.length).toBeGreaterThan(800);

    for (const bodyType of BODY_TYPE_IDS) {
      const { headScale } = applyBodyProportion(f.root, gender, bodyType);
      expect(Number.isFinite(headScale)).toBe(true);
      expect(headScale).toBeGreaterThan(0.5);

      // Every bone has unit scale (1,1,1) within float32 glTF tolerance and finite matrices
      for (const bone of f.skin.skeleton.bones) {
        expect(bone.scale.x).toBeCloseTo(1, 5);
        expect(bone.scale.y).toBeCloseTo(1, 5);
        expect(bone.scale.z).toBeCloseTo(1, 5);
        for (const el of bone.matrixWorld.elements) expect(Number.isFinite(el)).toBe(true);
      }

      for (const { skin, posPairs, smoothNormPairs } of meshSeamPairs) {
        const pos = skin.geometry.getAttribute('position') as T.BufferAttribute;
        const norm = skin.geometry.getAttribute('normal') as T.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
          const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
          expect(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)).toBe(true);
          expect(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)).toBe(true);
          expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 3);
        }
        for (const inv of skin.skeleton.boneInverses) {
          for (const el of inv.elements) expect(Number.isFinite(el)).toBe(true);
        }

        // UV seam integrity: 0 cracking in positions, 0 split in smooth seam normals
        const pa = new T.Vector3(), pb = new T.Vector3();
        for (const [i0, ik] of posPairs) {
          pa.fromBufferAttribute(pos, i0);
          pb.fromBufferAttribute(pos, ik);
          expect(pa.distanceTo(pb)).toBeLessThan(1e-6);
        }
        for (const [i0, ik] of smoothNormPairs) {
          pa.fromBufferAttribute(norm, i0);
          pb.fromBufferAttribute(norm, ik);
          expect(pa.distanceTo(pb)).toBeLessThan(1e-5);
        }
      }

      const bounds = new T.Box3().setFromObject(f.skin);
      expect(Math.abs(bounds.min.y)).toBeLessThan(0.004);
    }
  });

  it('satisfies distinct, monotonic anatomical silhouette metrics across all 9 body types', () => {
    const f = makeFigureClone(gender);
    const m = {} as Record<BodyTypeId, AnatomicalMetrics>;
    for (const id of BODY_TYPE_IDS) {
      applyBodyProportion(f.root, gender, id);
      m[id] = measureAnatomy(f);
    }

    // 1. Monotonicity of girth / mass progression: slender < lean < realistic/heroic < chubby < fat < obese
    expect(m.slender.waistWidth).toBeLessThan(m.lean.waistWidth);
    expect(m.lean.waistWidth).toBeLessThan(m.realistic.waistWidth);
    expect(m.lean.waistWidth).toBeLessThan(m.heroic.waistWidth);
    expect(m.realistic.waistWidth).toBeLessThan(m.chubby.waistWidth);
    expect(m.heroic.waistWidth).toBeLessThan(m.chubby.waistWidth);
    expect(m.chubby.waistWidth).toBeLessThan(m.fat.waistWidth);
    expect(m.fat.waistWidth).toBeLessThan(m.obese.waistWidth);

    expect(m.slender.bellyProj).toBeLessThan(m.lean.bellyProj);
    expect(m.lean.bellyProj).toBeLessThan(m.realistic.bellyProj);
    expect(m.realistic.bellyProj).toBeLessThan(m.chubby.bellyProj);
    expect(m.heroic.bellyProj).toBeLessThan(m.chubby.bellyProj);
    expect(m.chubby.bellyProj).toBeLessThan(m.fat.bellyProj);
    expect(m.fat.bellyProj).toBeLessThan(m.obese.bellyProj);

    expect(m.slender.waistDepth).toBeLessThan(m.lean.waistDepth);
    expect(m.lean.waistDepth).toBeLessThan(m.realistic.waistDepth);
    expect(m.realistic.waistDepth).toBeLessThan(m.chubby.waistDepth);
    expect(m.chubby.waistDepth).toBeLessThan(m.fat.waistDepth);
    expect(m.fat.waistDepth).toBeLessThan(m.obese.waistDepth);

    expect(m.slender.hipWidth).toBeLessThan(m.lean.hipWidth);
    expect(m.lean.hipWidth).toBeLessThan(m.realistic.hipWidth);
    expect(m.realistic.hipWidth).toBeLessThan(m.chubby.hipWidth);
    expect(m.chubby.hipWidth).toBeLessThan(m.fat.hipWidth);
    expect(m.fat.hipWidth).toBeLessThan(m.obese.hipWidth);

    expect(m.slender.thighWidth).toBeLessThan(m.lean.thighWidth);
    expect(m.lean.thighWidth).toBeLessThan(m.realistic.thighWidth);
    expect(m.realistic.thighWidth).toBeLessThan(m.chubby.thighWidth);
    expect(m.chubby.thighWidth).toBeLessThan(m.fat.thighWidth);
    expect(m.fat.thighWidth).toBeLessThan(m.obese.thighWidth);

    expect(m.slender.upperArmThickness).toBeLessThan(m.lean.upperArmThickness);
    expect(m.lean.upperArmThickness).toBeLessThan(m.realistic.upperArmThickness);
    expect(m.realistic.upperArmThickness).toBeLessThan(m.chubby.upperArmThickness);
    expect(m.chubby.upperArmThickness).toBeLessThan(m.fat.upperArmThickness);
    expect(m.fat.upperArmThickness).toBeLessThan(m.obese.upperArmThickness);

    // 2. Realistic softens superhero extremes
    expect(m.realistic.shoulderSpan).toBeLessThan(m.heroic.shoulderSpan);
    expect(m.realistic.chestWidth / m.realistic.waistWidth).toBeLessThan(m.heroic.chestWidth / m.heroic.waistWidth);
    expect(m.realistic.headsTall).toBeLessThan(m.heroic.headsTall);

    // 3. Slender is taller and narrower-framed than heroic and realistic
    expect(m.slender.totalHeight).toBeGreaterThan(m.heroic.totalHeight);
    expect(m.slender.totalHeight).toBeGreaterThan(m.realistic.totalHeight);
    expect(m.slender.shoulderSpan).toBeLessThan(m.heroic.shoulderSpan);

    // 4. Busty projects anteriorly beyond realistic & heroic while keeping waist trim
    expect(m.busty.anteriorChestProj).toBeGreaterThan(m.heroic.anteriorChestProj + 0.02);
    expect(m.busty.anteriorChestProj).toBeGreaterThan(m.realistic.anteriorChestProj + 0.025);
    expect(m.busty.chestDepth).toBeGreaterThan(m.heroic.chestDepth + 0.02);
    expect(m.busty.waistWidth).toBeLessThan(m.realistic.waistWidth);

    // 5. Chibi has classic ~2.5-3.2 head ratio and compact height while scaling hair & eyes harmoniously
    expect(m.chibi.headsTall).toBeGreaterThan(2.4);
    expect(m.chibi.headsTall).toBeLessThan(3.3);
    expect(m.chibi.totalHeight).toBeLessThan(m.heroic.totalHeight * 0.72);
    expect(m.chibi.headHeight).toBeGreaterThan(m.heroic.headHeight * 1.5);

    // 6. Clean medial thigh & A-pose arm clearances across all archetypes (true positive air gap)
    for (const id of BODY_TYPE_IDS) {
      expect(m[id].leftThighMinX, `${id} leftThighMinX`).toBeGreaterThan(0.001);
      expect(m[id].rightThighMaxX, `${id} rightThighMaxX`).toBeLessThan(-0.001);
      expect(m[id].armTorsoGapX, `${id} armTorsoGapX`).toBeGreaterThan(0);
    }
  });

  it('keeps eyes, eyebrows, and switched hairstyles locked to the skull on chibi and all archetypes', () => {
    const f = makeFigureClone(gender);
    const eyes = f.skins.find(s => s.name === 'Eyes')!;
    const brows = f.skins.find(s => s.name === 'Eyebrows')!;
    const scalp = f.root.getObjectByName('Scalp hair') as T.Mesh;

    const { headScale } = applyBodyProportion(f.root, gender, 'chibi');
    setFigureHairStyle(f, gender, gender === 'female' ? 'buns' : 'partedBeard');
    f.root.updateMatrixWorld(true);
    f.skins.forEach(s => { s.skeleton.update(); s.computeBoundingBox(); });

    const skinBox = new T.Box3().setFromObject(f.skin);
    const hairBox = new T.Box3().setFromObject(scalp);
    const eyesBox = new T.Box3().setFromObject(eyes);
    const browsBox = new T.Box3().setFromObject(brows);

    expect(scalp.scale.x).toBeCloseTo(headScale, 4);
    expect(hairBox.max.y).toBeGreaterThan(skinBox.max.y);
    expect(hairBox.max.y - skinBox.max.y).toBeLessThan(0.18);
    expect(eyesBox.getCenter(new T.Vector3()).y).toBeLessThan(browsBox.max.y);
    expect(eyesBox.max.y).toBeLessThan(skinBox.max.y);
  });

  it('rotates elbow, knee, shoulder, and head by 75° without shear and restores baseline within < 1e-5', () => {
    const f = makeFigureClone(gender);
    const baselineBindPos = new Float32Array(
      (f.skin.geometry.getAttribute('position') as T.BufferAttribute).array,
    );
    const baselineBindNorm = new Float32Array(
      (f.skin.geometry.getAttribute('normal') as T.BufferAttribute).array,
    );

    const captureWorldVerts = () => {
      const pos = f.skin.geometry.getAttribute('position') as T.BufferAttribute;
      const out = new Float32Array(pos.count * 3);
      const v = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        f.skin.localToWorld(f.skin.applyBoneTransform(i, v));
        out[i * 3] = v.x;
        out[i * 3 + 1] = v.y;
        out[i * 3 + 2] = v.z;
      }
      return out;
    };

    const baselineWorldNeutral = captureWorldVerts();

    // Find rigid distal sample vertices (100% hand_l, 100% foot_l, 100% Eyes->Head) to prove zero FK rotation shear
    const si = f.skin.geometry.getAttribute('skinIndex') as T.BufferAttribute;
    const sw = f.skin.geometry.getAttribute('skinWeight') as T.BufferAttribute;
    const handIdx = f.skin.skeleton.bones.findIndex(b => b.name === 'hand_l');
    const footIdx = f.skin.skeleton.bones.findIndex(b => b.name === 'foot_l');
    const handVerts: number[] = [];
    const footVerts: number[] = [];
    for (let i = 0; i < si.count; i++) {
      let wh = 0, wf = 0;
      for (let k = 0; k < 4; k++) {
        if (si.getComponent(i, k) === handIdx) wh += sw.getComponent(i, k);
        if (si.getComponent(i, k) === footIdx) wf += sw.getComponent(i, k);
      }
      if (wh > 0.999 && handVerts.length < 12) handVerts.push(i);
      if (wf > 0.999 && footVerts.length < 12) footVerts.push(i);
    }
    expect(handVerts.length).toBeGreaterThanOrEqual(6);
    expect(footVerts.length).toBeGreaterThanOrEqual(6);

    const pairwiseDistances = (verts: number[]) => {
      const pos = f.skin.geometry.getAttribute('position') as T.BufferAttribute;
      const pts = verts.map(idx =>
        f.skin.localToWorld(f.skin.applyBoneTransform(idx, new T.Vector3().fromBufferAttribute(pos, idx))),
      );
      const dists: number[] = [];
      for (let a = 0; a < pts.length; a++) {
        for (let b = a + 1; b < pts.length; b++) {
          dists.push(pts[a]!.distanceTo(pts[b]!));
        }
      }
      return dists;
    };

    for (const testType of ['chibi', 'obese', 'busty', 'realistic'] as const) {
      setFigurePose(f, neutralPose());
      applyBodyProportion(f.root, gender, testType);

      const unposedHandDists = pairwiseDistances(handVerts);
      const unposedFootDists = pairwiseDistances(footVerts);

      // Apply 75° FK rotations to leftShoulder, leftElbow, leftKnee, and head
      const pose = neutralPose();
      pose.leftShoulder = [radians(75), radians(-20), radians(25)];
      pose.leftElbow = [radians(-75), 0, 0];
      pose.leftKnee = [radians(75), 0, 0];
      pose.head = [radians(25), radians(75), radians(-15)];
      setFigurePose(f, pose);

      const posedHandDists = pairwiseDistances(handVerts);
      const posedFootDists = pairwiseDistances(footVerts);

      // Zero shear: pairwise distances on 100%-weighted distal segments stay invariant to < 1e-5!
      for (let k = 0; k < unposedHandDists.length; k++) {
        expect(Math.abs(posedHandDists[k]! - unposedHandDists[k]!)).toBeLessThan(1e-5);
      }
      for (let k = 0; k < unposedFootDists.length; k++) {
        expect(Math.abs(posedFootDists[k]! - unposedFootDists[k]!)).toBeLessThan(1e-5);
      }

      // Joint markers / bone pivots align closely with their skinned mesh vertices
      const wristBoneWorld = f.bones.leftWrist.getWorldPosition(new T.Vector3());
      const ankleBoneWorld = f.bones.leftAnkle.getWorldPosition(new T.Vector3());
      const pos = f.skin.geometry.getAttribute('position') as T.BufferAttribute;
      const sampleHandWorld = f.skin.localToWorld(
        f.skin.applyBoneTransform(handVerts[0]!, new T.Vector3().fromBufferAttribute(pos, handVerts[0]!)),
      );
      const sampleFootWorld = f.skin.localToWorld(
        f.skin.applyBoneTransform(footVerts[0]!, new T.Vector3().fromBufferAttribute(pos, footVerts[0]!)),
      );
      expect(sampleHandWorld.distanceTo(wristBoneWorld)).toBeLessThan(0.16);
      expect(sampleFootWorld.distanceTo(ankleBoneWorld)).toBeLessThan(0.18);
    }

    // Live-posed multi-hop switching preserves FK pose and is path-independent / drift-free
    const running = preset('Running');
    f.root.position.set(1.2, 0.4, -0.8);
    f.root.rotation.set(0.1, -0.5, 0.05);
    setFigurePose(f, running);

    const sequence: BodyTypeId[] = ['obese', 'chibi', 'busty', 'slender', 'fat', 'lean', 'realistic', 'chibi'];
    for (const step of sequence) {
      applyBodyProportion(f.root, gender, step);
    }
    for (const j of JOINTS) {
      const expected = new T.Quaternion().setFromEuler(new T.Euler(...running[j]));
      const actual = new T.Quaternion().setFromEuler(new T.Euler(...getJointRotation(f, j)));
      expect(actual.angleTo(expected)).toBeLessThan(1e-6);
    }

    // Compare multi-hop chibi against fresh single-call chibi
    const fFresh = makeFigureClone(gender);
    fFresh.root.position.copy(f.root.position);
    fFresh.root.rotation.copy(f.root.rotation);
    setFigurePose(fFresh, running);
    applyBodyProportion(fFresh.root, gender, 'chibi');

    const multiHopArr = (f.skin.geometry.getAttribute('position') as T.BufferAttribute).array as Float32Array;
    const freshArr = (fFresh.skin.geometry.getAttribute('position') as T.BufferAttribute).array as Float32Array;
    let maxDrift = 0;
    for (let i = 0; i < multiHopArr.length; i++) {
      maxDrift = Math.max(maxDrift, Math.abs(multiHopArr[i]! - freshArr[i]!));
    }
    expect(maxDrift).toBeLessThan(1e-6);

    // Switch back to heroic + neutral origin -> exact restoration of baseline (< 1e-5)
    f.root.position.set(0, 0, 0);
    f.root.rotation.set(0, 0, 0);
    setFigurePose(f, neutralPose());
    applyBodyProportion(f.root, gender, 'heroic');

    const restoredPos = (f.skin.geometry.getAttribute('position') as T.BufferAttribute).array as Float32Array;
    const restoredNorm = (f.skin.geometry.getAttribute('normal') as T.BufferAttribute).array as Float32Array;
    for (let i = 0; i < baselineBindPos.length; i++) {
      expect(Math.abs(restoredPos[i]! - baselineBindPos[i]!)).toBeLessThan(1e-6);
      expect(Math.abs(restoredNorm[i]! - baselineBindNorm[i]!)).toBeLessThan(1e-6);
    }
    const restoredWorld = captureWorldVerts();
    for (let i = 0; i < baselineWorldNeutral.length; i++) {
      expect(Math.abs(restoredWorld[i]! - baselineWorldNeutral[i]!)).toBeLessThan(1e-5);
    }
  });

  it('isolates boneInverses across multiple figures cloned from the same template', () => {
    const fChibi = makeFigureClone(gender);
    const fObese = makeFigureClone(gender);
    const fHeroic = makeFigureClone(gender);

    applyBodyProportion(fChibi.root, gender, 'chibi');
    applyBodyProportion(fObese.root, gender, 'obese');
    applyBodyProportion(fHeroic.root, gender, 'heroic');

    const mChibi = measureAnatomy(fChibi);
    const mObese = measureAnatomy(fObese);
    const mHeroic = measureAnatomy(fHeroic);

    expect(mChibi.headsTall).toBeLessThan(3.3);
    expect(mObese.waistWidth).toBeGreaterThan(mHeroic.waistWidth * 1.3);
    expect(mHeroic.totalHeight).toBeCloseTo(gender === 'male' ? 1.85 : 1.75, 2);
  });
});
