import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import * as T from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyBodyProportion,
  DEFAULT_BODY_TYPE,
} from './bodyProportions';
import { CHARACTERS, MODEL_IDS } from './characterCatalog';
import {
  buildExternalFigure,
  DEFAULT_MANNEQUIN_DRESS_ID,
  getMannequinDressTemplateUrl,
  getMannequinPresetDressUrl,
  MANNEQUIN_DRESS_PRESET_IDS,
  MANNEQUIN_DRESS_PRESETS,
  MANNEQUIN_EXTENDED_HAIR_STYLES,
  setFigureColors,
  setFigureDressMap,
  setFigureHairStyle,
} from './external-rig';
import { evaluateMannequinDressPixelLinear } from './mannequin-dress';
import { sampleMannequinCranium, type MannequinCraniumField } from './mannequin-hair';
import {
  applyCharacterModelColorTransition,
  initialScene,
  isMannequinCharacter,
  neutralPose,
  radians,
  validatePortable,
  type Body,
} from './model';
import { setFigurePose, type Figure } from './rig';
import { loadMannequinTestFixtures } from './testMannequinFixtures';

const REPO_ROOT = resolve(__dirname, '..');

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

function readPngSync(relPath: string): DecodedPng {
  const fullPath = resolve(REPO_ROOT, relPath);
  expect(existsSync(fullPath), `Expected PNG at ${relPath}`).toBe(true);
  const bytes = new Uint8Array(readFileSync(fullPath));
  expect(bytes[0]).toBe(137);
  expect(bytes[1]).toBe(80);
  expect(bytes[2]).toBe(78);
  expect(bytes[3]).toBe(71);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idatParts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const chunk = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      colorType = chunk[9]!;
    } else if (type === 'IDAT') {
      idatParts.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const totalLen = idatParts.reduce((s, p) => s + p.length, 0);
  const compressed = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of idatParts) {
    compressed.set(p, pos);
    pos += p.length;
  }
  const raw = new Uint8Array(inflateSync(compressed));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const curr = new Uint8Array(stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[src++]!;
      const a = i >= bpp ? curr[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (x + paeth(a, b, c)) & 0xff;
      curr[i] = val;
    }
    const rowBase = y * width * 4;
    for (let px = 0; px < width; px++) {
      rgba[rowBase + px * 4] = curr[px * bpp]!;
      rgba[rowBase + px * 4 + 1] = curr[px * bpp + 1]!;
      rgba[rowBase + px * 4 + 2] = curr[px * bpp + 2]!;
      rgba[rowBase + px * 4 + 3] = bpp === 4 ? curr[px * 4 + 3]! : 255;
    }
    prev.set(curr);
  }
  return { width, height, data: rgba };
}

function encodeMinimalRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 4, 'ascii');
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (1 + stride) + 1);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw)),
    makeChunk('IEND', new Uint8Array(0)),
  ]);
}

function lookupCraniumExactRadius(field: MannequinCraniumField, theta: number, psi: number): number {
  const wrappedTheta = ((theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const u = ((wrappedTheta + Math.PI) / (2 * Math.PI)) * field.nTheta;
  const v = Math.max(0, Math.min(field.nPsi - 1.0001, (psi / field.psiMax) * (field.nPsi - 1)));
  const i0 = ((Math.floor(u) % field.nTheta) + field.nTheta) % field.nTheta;
  const i1 = (i0 + 1) % field.nTheta;
  const fu = u - Math.floor(u);
  const j0 = Math.floor(v);
  const j1 = Math.min(field.nPsi - 1, j0 + 1);
  const fv = v - j0;
  const r00 = field.exactRadius[j0 * field.nTheta + i0]!;
  const r10 = field.exactRadius[j0 * field.nTheta + i1]!;
  const r01 = field.exactRadius[j1 * field.nTheta + i0]!;
  const r11 = field.exactRadius[j1 * field.nTheta + i1]!;
  const r0 = r00 + (r10 - r00) * fu;
  const r1 = r01 + (r11 - r01) * fu;
  return r0 + (r1 - r0) * fv;
}

function measureHairClearance(figure: Figure): {
  penetratingSkullVerts: number;
  crownLoftMm: number;
  vertexCount: number;
} {
  figure.root.updateMatrixWorld(true);
  const scalp = figure.root.getObjectByName('Scalp hair') as T.Mesh;
  expect(scalp).toBeInstanceOf(T.Mesh);
  expect(scalp.visible).toBe(true);

  const field = sampleMannequinCranium(figure.skin);
  const headToSkin = figure.skin.matrixWorld.clone().invert().multiply(scalp.matrixWorld);
  const pos = scalp.geometry.getAttribute('position') as T.BufferAttribute;
  const v = new T.Vector3();

  let penetratingSkullVerts = 0;
  let maxHairY = -Infinity;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(headToSkin);
    if (v.y > maxHairY) maxHairY = v.y;

    const dx = v.x - field.center.x;
    const dy = v.y - field.center.y;
    const dz = v.z - field.center.z;
    const r = Math.hypot(dx, dy, dz);
    if (r < 1e-6) continue;
    const psi = Math.acos(Math.max(-1, Math.min(1, dy / r)));
    const theta = Math.atan2(dx, dz);

    // Cranial dome & temple/occipital zone above the ear-canal / jaw line:
    // skip the intentional ear-arch cutout rim and lower ponytail/drape locks below the skull base.
    const inEarCutout =
      Math.abs(theta) >= field.earThetaMin - 0.14 &&
      Math.abs(theta) <= field.earThetaMax + 0.14 &&
      psi >= field.earPsiMin - 0.12;
    const onFacialFront = Math.abs(theta) < 0.78 && psi > 1.05;

    if (psi <= 1.38 && !inEarCutout && !onFacialFront) {
      const skullR = lookupCraniumExactRadius(field, theta, psi);
      // Allow at most 0.4mm numerical interpolation tolerance = 0 actual skull penetration
      if (r < skullR - 0.0004) {
        penetratingSkullVerts++;
      }
    }
  }

  return {
    penetratingSkullVerts,
    crownLoftMm: (maxHairY - field.crownY) * 1000,
    vertexCount: pos.count,
  };
}

function makeCustomTestDressDataUrl(): string {
  const data = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = (y * 64 + x) * 4;
      const inGarmentBand = y >= 10 && y <= 46;
      const isFrontHalf = x < 32;
      if (!inGarmentBand) {
        data[idx + 3] = 0;
      } else if (isFrontHalf) {
        // Vibrant coral front
        data[idx] = 236;
        data[idx + 1] = 72;
        data[idx + 2] = 153;
        data[idx + 3] = 255;
      } else {
        // Deep teal back
        data[idx] = 20;
        data[idx + 1] = 184;
        data[idx + 2] = 166;
        data[idx + 3] = 255;
      }
    }
  }
  const encoded = encodeMinimalRgbaPng(64, 64, data).toString('base64');
  return `data:image/png;base64,${encoded}`;
}

function measureStudioProportions(fig: Figure) {
  fig.root.updateMatrixWorld(true);
  fig.skins.forEach(s => s.skeleton.update());
  const pos = fig.skin.geometry.getAttribute('position') as T.BufferAttribute;
  const si = fig.skin.geometry.getAttribute('skinIndex') as T.BufferAttribute;
  const sw = fig.skin.geometry.getAttribute('skinWeight') as T.BufferAttribute;
  const bones = fig.skin.skeleton.bones;
  const isArm = (n: string) => /upperarm|lowerarm|hand|thumb|index|middle|ring|pinky/.test(n);

  let minY = Infinity;
  let maxY = -Infinity;
  let headMinY = Infinity;
  let headMaxY = -Infinity;
  let shoulderHalfX = 0;
  let waistHalfX = 0;
  let hipHalfX = 0;

  const pPelvisY = fig.bones.hips.getWorldPosition(new T.Vector3()).y;
  const pWaistY = fig.bones.spine.getWorldPosition(new T.Vector3()).y;
  const pChestY = fig.bones.chest.getWorldPosition(new T.Vector3()).y;

  const tmp = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    const wp = fig.skin.localToWorld(fig.skin.applyBoneTransform(i, tmp));
    if (wp.y < minY) minY = wp.y;
    if (wp.y > maxY) maxY = wp.y;

    let headW = 0;
    let armW = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      const bName = bones[si.getComponent(i, k)]?.name ?? '';
      if (bName === 'Head') headW += w;
      if (isArm(bName)) armW += w;
    }
    if (headW > 0.5) {
      if (wp.y < headMinY) headMinY = wp.y;
      if (wp.y > headMaxY) headMaxY = wp.y;
    }
    if (Math.abs(wp.y - (pChestY + 0.08)) < 0.04) {
      shoulderHalfX = Math.max(shoulderHalfX, Math.abs(wp.x));
    }
    if (armW < 0.15) {
      if (Math.abs(wp.y - (pWaistY + 0.04)) < 0.025) waistHalfX = Math.max(waistHalfX, Math.abs(wp.x));
      if (Math.abs(wp.y - (pPelvisY - 0.065)) < 0.04) hipHalfX = Math.max(hipHalfX, Math.abs(wp.x));
    }
  }

  const totalHeight = maxY - minY;
  const headHeight = headMaxY - headMinY;
  const biacromialWidth = fig.bones.leftShoulder
    .getWorldPosition(new T.Vector3())
    .distanceTo(fig.bones.rightShoulder.getWorldPosition(new T.Vector3()));
  return {
    minY,
    totalHeight,
    headCount: totalHeight / headHeight,
    biacromialWidth,
    deltoidSpan: shoulderHalfX * 2,
    waistWidth: waistHalfX * 2,
    hipWidth: hipHalfX * 2,
  };
}

describe('Mannequin Male & Female: Proportions, Scalp-Fitted 3D Hair & 2048x2048 AI Dress Map System', () => {
  let templates = new Map<Body, T.Group>();
  let maleTemplateScene: T.Group;
  let femaleTemplateScene: T.Group;

  beforeAll(async () => {
    templates = await loadMannequinTestFixtures();
    maleTemplateScene = templates.get('male')!;
    femaleTemplateScene = templates.get('female')!;
  });

  describe('1. Upgraded Mannequin Male & Female Models, Proportions & Paper-Doll UV Attributes', () => {
    it('defaults Mannequin body proportions to balanced studio realistic (~7.6-head canon)', () => {
      expect(DEFAULT_BODY_TYPE).toBe('realistic');

      const maleFig = buildExternalFigure('male', maleTemplateScene, '#d4a574');
      const femaleFig = buildExternalFigure('female', femaleTemplateScene, '#d4a574');

      applyBodyProportion(maleFig.root, 'male', DEFAULT_BODY_TYPE);
      applyBodyProportion(femaleFig.root, 'female', DEFAULT_BODY_TYPE);

      const m = measureStudioProportions(maleFig);
      const f = measureStudioProportions(femaleFig);

      expect(m.headCount).toBeGreaterThanOrEqual(7.35);
      expect(m.headCount).toBeLessThanOrEqual(7.95);
      expect(f.headCount).toBeGreaterThanOrEqual(7.35);
      expect(f.headCount).toBeLessThanOrEqual(7.95);

      // Balanced studio shoulders & sexual dimorphism without exaggerated superhero V-taper
      expect(m.biacromialWidth / m.hipWidth).toBeGreaterThan(0.95);
      expect(m.biacromialWidth / m.hipWidth).toBeLessThan(1.42);
      expect(f.waistWidth / f.hipWidth).toBeGreaterThan(0.62);
      expect(f.waistWidth / f.hipWidth).toBeLessThan(0.86);
      expect(Math.abs(m.minY)).toBeLessThan(0.002);
      expect(Math.abs(f.minY)).toBeLessThan(0.002);

      // And heroic archetype remains broader than realistic studio default
      applyBodyProportion(maleFig.root, 'male', 'heroic');
      const mHeroic = measureStudioProportions(maleFig);
      expect(mHeroic.deltoidSpan).toBeGreaterThan(m.deltoidSpan);
    });

    it('bakes distortion-free Front (U: 0..0.5) & Back (U: 0.5..1.0) Paper-Doll dress attributes on both GLBs', () => {
      for (const [gender, scene] of [
        ['male', maleTemplateScene],
        ['female', femaleTemplateScene],
      ] as const) {
        const bodyMesh = scene.getObjectByName('Body') as T.SkinnedMesh;
        expect(bodyMesh, `${gender} Body mesh`).toBeInstanceOf(T.SkinnedMesh);

        const uv1 = bodyMesh.geometry.getAttribute('uv1') as T.BufferAttribute;
        const dressAttr = (bodyMesh.geometry.getAttribute('_pnc_dress') ??
          bodyMesh.geometry.getAttribute('_PNC_DRESS')) as T.BufferAttribute;
        const pos = bodyMesh.geometry.getAttribute('position') as T.BufferAttribute;

        expect(uv1, `${gender} uv1 attribute`).toBeDefined();
        expect(dressAttr, `${gender} _pnc_dress attribute`).toBeDefined();
        expect(dressAttr.itemSize).toBe(4);
        expect(dressAttr.count).toBe(pos.count);

        let frontEligible = 0;
        let backEligible = 0;
        for (let i = 0; i < pos.count; i++) {
          const uIsland = dressAttr.getX(i);
          const vPaper = dressAttr.getY(i);
          const frontness = dressAttr.getZ(i);
          const eligibility = dressAttr.getW(i);

          expect(Number.isFinite(uIsland)).toBe(true);
          expect(Number.isFinite(vPaper)).toBe(true);
          expect(vPaper).toBeGreaterThanOrEqual(0.03);
          expect(vPaper).toBeLessThanOrEqual(0.97);
          expect(eligibility).toBeGreaterThanOrEqual(0);
          expect(eligibility).toBeLessThanOrEqual(1);

          const u1 = uv1.getX(i);
          if (frontness >= 0) {
            expect(uIsland).toBeGreaterThanOrEqual(0.01);
            expect(uIsland).toBeLessThanOrEqual(0.49);
            expect(u1).toBeGreaterThanOrEqual(0.01);
            expect(u1).toBeLessThanOrEqual(0.49);
            if (eligibility > 0.5) frontEligible++;
          } else {
            expect(uIsland).toBeGreaterThanOrEqual(0.51);
            expect(uIsland).toBeLessThanOrEqual(0.99);
            expect(u1).toBeGreaterThanOrEqual(0.51);
            expect(u1).toBeLessThanOrEqual(0.99);
            if (eligibility > 0.5) backEligible++;
          }
        }
        expect(frontEligible).toBeGreaterThan(5000);
        expect(backEligible).toBeGreaterThan(5000);

        // Zero triangles may straddle the Front (`u < 0.5`) and Back (`u > 0.5`) UV islands!
        const idxAttr = bodyMesh.geometry.getIndex()!;
        expect(idxAttr).toBeTruthy();
        let straddlingTris = 0;
        for (let t = 0; t < idxAttr.count; t += 3) {
          const a = dressAttr.getX(idxAttr.getX(t)) < 0.5;
          const b = dressAttr.getX(idxAttr.getX(t + 1)) < 0.5;
          const c = dressAttr.getX(idxAttr.getX(t + 2)) < 0.5;
          if (!(a === b && b === c)) straddlingTris++;
        }
        expect(straddlingTris, `${gender} straddling coronal UV triangles`).toBe(0);
      }
    });

    it('sculpts an anatomically accurate female teardrop bust with gradual upper-pole slope, inframammary fold, and sternum separation', () => {
      const bodyMesh = femaleTemplateScene.getObjectByName('Body') as T.SkinnedMesh;
      const pos = bodyMesh.geometry.getAttribute('position') as T.BufferAttribute;

      const maxFrontZInBand = (yTarget: number, xMin: number, xMax: number) => {
        let maxZ = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          const ax = Math.abs(pos.getX(i));
          const y = pos.getY(i);
          const z = pos.getZ(i);
          if (z > 0 && Math.abs(y - yTarget) < 0.008 && ax >= xMin && ax <= xMax) {
            if (z > maxZ) maxZ = z;
          }
        }
        return maxZ;
      };

      const zSubClavicle = maxFrontZInBand(1.36, 0.05, 0.11);
      const zUpperPole = maxFrontZInBand(1.31, 0.06, 0.12);
      const zBustApex = maxFrontZInBand(1.26, 0.07, 0.12);
      const zInframammary = maxFrontZInBand(1.20, 0.06, 0.11);
      const zSternumValley = maxFrontZInBand(1.26, 0.0, 0.012);

      // Gradual monotonic teardrop slope from sub-clavicular ribcage down to 4th-5th rib bust apex
      expect(zUpperPole).toBeGreaterThan(zSubClavicle + 0.010);
      expect(zBustApex).toBeGreaterThan(zUpperPole + 0.015);
      // Natural inframammary crease tucking cleanly back toward the ribcage underneath
      expect(zBustApex).toBeGreaterThan(zInframammary + 0.032);
      // Clean ~2cm medial sternum separation (never fused into a uniboob!)
      expect(zBustApex - zSternumValley).toBeGreaterThan(0.034);
      // Require fullness off-axis and below the apex, not just a taller tip.
      const lowerLateral = maxFrontZInBand(1.225, 0.115, 0.13);
      expect(lowerLateral - zSternumValley).toBeGreaterThan(0.05);
      expect(zBustApex - lowerLateral).toBeLessThan(0.025);
    });
  });

  describe('2. 2048x2048 AI Dress UV Template Maps & Preset Dress Image Maps', () => {
    it('provides valid 2048x2048 RGBA AI UV template PNGs for Male & Female with Front/Back guides and transparent margins', () => {
      for (const gender of ['male', 'female'] as const) {
        const rel = `public${getMannequinDressTemplateUrl(gender, '/')}`;
        const png = readPngSync(rel);
        expect(png.width).toBe(2048);
        expect(png.height).toBe(2048);
        expect(png.data.length).toBe(2048 * 2048 * 4);

        let frontPixels = 0;
        let backPixels = 0;
        let transparentExteriorPixels = 0;
        for (let i = 0; i < png.data.length; i += 4) {
          const a = png.data[i + 3]!;
          const px = (i / 4) % 2048;
          const py = Math.floor(i / 4 / 2048);
          if (a === 0 && py > 120) transparentExteriorPixels++;
          if (a > 180 && py > 200 && py < 1950) {
            if (px < 1024) frontPixels++;
            else backPixels++;
          }
        }

        expect(frontPixels).toBeGreaterThan(150_000);
        expect(backPixels).toBeGreaterThan(150_000);
        expect(transparentExteriorPixels).toBeGreaterThan(1_500_000);
      }
    });

    it('provides 5 distinct 2048x2048 RGBA preset dress maps per gender with clean Front/Back alpha coverage', () => {
      const nonEmptyPresetIds = MANNEQUIN_DRESS_PRESETS.filter(p => p.id !== 'none').map(p => p.id);
      expect(nonEmptyPresetIds.length).toBeGreaterThanOrEqual(5);

      for (const gender of ['male', 'female'] as const) {
        const coverageByPreset = new Map<string, number>();

        for (const presetId of nonEmptyPresetIds) {
          const url = getMannequinPresetDressUrl(gender, presetId, '/');
          expect(url).toBeTruthy();
          const png = readPngSync(`public${url}`);
          expect(png.width).toBe(2048);
          expect(png.height).toBe(2048);
          expect(png.data.length).toBe(2048 * 2048 * 4);

          let frontOpaque = 0;
          let backOpaque = 0;
          let softAntialiasedEdge = 0;
          let chromaSum = 0;

          for (let i = 0; i < png.data.length; i += 4) {
            const r = png.data[i]!;
            const g = png.data[i + 1]!;
            const b = png.data[i + 2]!;
            const a = png.data[i + 3]!;
            const px = (i / 4) % 2048;
            if (a >= 200) {
              if (px < 1024) frontOpaque++;
              else backOpaque++;
              chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
            } else if (a > 8 && a < 245) {
              softAntialiasedEdge++;
            }
          }

          expect(frontOpaque, `${gender}/${presetId} front coverage`).toBeGreaterThan(30_000);
          expect(backOpaque, `${gender}/${presetId} back coverage`).toBeGreaterThan(25_000);
          expect(softAntialiasedEdge, `${gender}/${presetId} antialiased alpha hem`).toBeGreaterThan(1_500);
          coverageByPreset.set(presetId, frontOpaque + backOpaque);

          if (presetId === 'patterned-signature') {
            const avgChroma = chromaSum / (frontOpaque + backOpaque);
            expect(avgChroma).toBeGreaterThan(18);
          }
        }

        // Verify progressive garment coverage across outfits purely via the 2048x2048 image map!
        expect(coverageByPreset.get('athletic-sportswear')!).toBeGreaterThan(
          coverageByPreset.get('studio-briefs')!,
        );
        expect(coverageByPreset.get('casual-tee-jeans')!).toBeGreaterThan(
          coverageByPreset.get('athletic-sportswear')!,
        );
        expect(coverageByPreset.get('fitted-bodysuit')!).toBeGreaterThan(
          coverageByPreset.get('athletic-sportswear')!,
        );
      }
    });

    it.each(['studio-briefs', 'patterned-signature'] as const)('joins the female %s lower hem at the two UV islands', preset => {
      const geom = (femaleTemplateScene.getObjectByName('Body') as T.SkinnedMesh).geometry;
      const pos = geom.getAttribute('position');
      const dress = geom.getAttribute('_pnc_dress');
      const png = readPngSync(`public${getMannequinPresetDressUrl('female', preset, '/')}`);
      const frontAlpha = new Map<string, number>();
      const key = (i: number) => `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
      const alpha = (i: number) => {
        const x = Math.floor(dress.getX(i) * png.width);
        const y = Math.floor((1 - dress.getY(i)) * png.height);
        return png.data[(y * png.width + x) * 4 + 3]!;
      };
      for (let i = 0; i < pos.count; i++) {
        if (dress.getZ(i) > 0 && pos.getY(i) < 1.0) frontAlpha.set(key(i), alpha(i));
      }
      let checked = 0, opaque = 0, bare = 0, worstJump = 0;
      for (let i = 0; i < pos.count; i++) {
        if (dress.getZ(i) >= 0) continue;
        const front = frontAlpha.get(key(i));
        if (front === undefined) continue;
        const back = alpha(i);
        checked++;
        if (front > 245 && back > 245) opaque++;
        if (front < 10 && back < 10) bare++;
        worstJump = Math.max(worstJump, Math.abs(front - back));
      }
      expect(checked).toBeGreaterThan(100);
      expect(opaque).toBeGreaterThan(10);
      expect(bare).toBeGreaterThan(10);
      // Independent rasterization can move the antialiased edge by a texel;
      // it cannot turn solid fabric on one panel into bare skin on the other.
      expect(worstJump).toBeLessThan(128);
    });

    it('guarantees 100% continuous opaque shoulder coverage (alpha === 255) across Front & Back coronal seam vertices', () => {
      for (const [gender, scene] of [
        ['male', maleTemplateScene],
        ['female', femaleTemplateScene],
      ] as const) {
        const bodyMesh = scene.getObjectByName('Body') as T.SkinnedMesh;
        const pos = bodyMesh.geometry.getAttribute('position') as T.BufferAttribute;
        const dressAttr = (bodyMesh.geometry.getAttribute('_pnc_dress') ??
          bodyMesh.geometry.getAttribute('_PNC_DRESS')) as T.BufferAttribute;
        const shoulderFloorY = gender === 'male' ? 1.50 : 1.43;
        const shoulderCeilY = gender === 'male' ? 1.56 : 1.49;

        const sleevedPresets = ['casual-tee-jeans', 'fitted-bodysuit', 'patterned-signature'] as const;
        for (const presetId of sleevedPresets) {
          const url = getMannequinPresetDressUrl(gender, presetId, '/')!;
          const png = readPngSync(`public${url}`);
          let checkedVerts = 0;
          let missingShoulderVerts = 0;

          for (let i = 0; i < pos.count; i++) {
            const ax = Math.abs(pos.getX(i));
            const y = pos.getY(i);
            // Sample right across the top-of-shoulder / acromion / trapezius ridge (`|x| in [10cm, 17cm]`)
            if (ax >= 0.10 && ax <= 0.17 && y >= shoulderFloorY && y <= shoulderCeilY) {
              const u = dressAttr.getX(i);
              const v = dressAttr.getY(i);
              const px = Math.min(2047, Math.max(0, Math.round(u * 2047)));
              const py = Math.min(2047, Math.max(0, Math.round((1 - v) * 2047)));
              const a = png.data[(py * 2048 + px) * 4 + 3]!;
              checkedVerts++;
              if (a < 250) missingShoulderVerts++;
            }
          }
          expect(checkedVerts, `${gender}/${presetId} sampled top-shoulder vertices`).toBeGreaterThan(80);
          expect(
            missingShoulderVerts,
            `${gender}/${presetId} must have 0 disappearing shoulder vertices`,
          ).toBe(0);
        }
      }
    });
  });

  describe('3. Artist-Authored CC0 Polygon Hair Fitted to Mannequin Male & Female', () => {
    it('equips genuinely distinct CC0 polygon hairstyles by default and fits all variants with 0 skull penetration', () => {
      const maleFig = buildExternalFigure('male', maleTemplateScene, '#d4a574');
      const femaleFig = buildExternalFigure('female', femaleTemplateScene, '#d4a574');

      const maleDefaultScalp = maleFig.root.getObjectByName('Scalp hair') as T.Mesh;
      const femaleDefaultScalp = femaleFig.root.getObjectByName('Scalp hair') as T.Mesh;
      expect(maleDefaultScalp.geometry.userData.mannequinHairAssetId).toBe('culturalibre_parted');
      expect(femaleDefaultScalp.geometry.userData.mannequinHairAssetId).toBe('faydaen_updo');
      expect(maleDefaultScalp.geometry.userData.mannequinHairAssetId).not.toBe(
        femaleDefaultScalp.geometry.userData.mannequinHairAssetId,
      );
      expect(maleDefaultScalp.geometry.getAttribute('position').count).toBeGreaterThan(2000);
      expect(femaleDefaultScalp.geometry.getAttribute('position').count).toBeGreaterThan(2000);

      // Verify single scalp hair mesh attachment (zero duplicate caps)
      for (const fig of [maleFig, femaleFig]) {
        let scalpMeshCount = 0;
        fig.bones.head.traverse(obj => {
          if (obj instanceof T.Mesh && obj.name === 'Scalp hair') scalpMeshCount++;
        });
        expect(scalpMeshCount).toBe(1);
      }

      for (const [gender, fig] of [
        ['male', maleFig],
        ['female', femaleFig],
      ] as const) {
        for (const style of MANNEQUIN_EXTENDED_HAIR_STYLES) {
          setFigureHairStyle(fig, gender, style, '#3b281e');
          const scalp = fig.root.getObjectByName('Scalp hair') as T.Mesh;
          if (style === 'none') {
            expect(scalp.visible).toBe(false);
            continue;
          }
          expect(scalp.geometry.userData.mannequinFittedHair).toBe(true);
          expect(typeof scalp.geometry.userData.mannequinHairAssetId).toBe('string');
          const clearance = measureHairClearance(fig);
          expect(
            clearance.penetratingSkullVerts,
            `${gender} hair style '${style}' should have 0 skull penetration`,
          ).toBe(0);
          expect(
            clearance.crownLoftMm,
            `${gender} hair style '${style}' crown loft should be > 2.0mm`,
          ).toBeGreaterThan(2.0);
          expect(
            clearance.crownLoftMm,
            `${gender} hair style '${style}' crown loft should be < 52mm`,
          ).toBeLessThan(52);
          expect(clearance.vertexCount).toBeGreaterThan(120);
        }
      }
    });

    it('re-conforms hair cleanly across body archetypes and remains pose-invariant when head is rotated', () => {
      const femaleFig = buildExternalFigure('female', femaleTemplateScene, '#d4a574');
      setFigureHairStyle(femaleFig, 'female', 'bob', '#2d1c14');

      // Snapshot unposed bob hair bounds in Head-bone local space
      const scalpBefore = femaleFig.root.getObjectByName('Scalp hair') as T.Mesh;
      scalpBefore.geometry.computeBoundingBox();
      const restBox = scalpBefore.geometry.boundingBox!.clone();

      // Rotate head/neck aggressively and switch styles back & forth: head-local geometry must not drift!
      const posed = neutralPose();
      posed.neck = [radians(22), radians(-28), radians(14)];
      posed.head = [radians(-18), radians(34), radians(-12)];
      setFigurePose(femaleFig, posed);
      setFigureHairStyle(femaleFig, 'female', 'curly', '#2d1c14');
      setFigureHairStyle(femaleFig, 'female', 'bob', '#5a3826');

      const scalpAfter = femaleFig.root.getObjectByName('Scalp hair') as T.Mesh;
      scalpAfter.geometry.computeBoundingBox();
      expect(scalpAfter.geometry.boundingBox!.min.distanceTo(restBox.min)).toBeLessThan(1e-5);
      expect(scalpAfter.geometry.boundingBox!.max.distanceTo(restBox.max)).toBeLessThan(1e-5);

      // Reset pose and test archetype morphing (`heroic` and `chibi`)
      setFigurePose(femaleFig, neutralPose());
      for (const archetype of ['heroic', 'chibi', 'realistic'] as const) {
        applyBodyProportion(femaleFig.root, 'female', archetype);
        const clearance = measureHairClearance(femaleFig);
        expect(clearance.penetratingSkullVerts, `female ${archetype} skull penetration`).toBe(0);
        const maxLoft = archetype === 'chibi' ? 68 : 52;
        expect(clearance.crownLoftMm).toBeLessThan(maxLoft);
      }
    });
  });

  describe('4. Live Dress Image-Map Switching, Custom Data-URL Upload & Non-Mannequin Isolation', () => {
    it('swaps across all built-in dress maps, none, and custom PNG data URLs while preserving pose, skinColor, and outfitColor', async () => {
      const fig = buildExternalFigure(
        'female',
        femaleTemplateScene,
        '#d9a17c',
        '#ffffff',
      );
      const customPose = neutralPose();
      customPose.leftShoulder = [radians(-35), radians(18), radians(-42)];
      customPose.rightHip = [radians(28), radians(-10), radians(12)];
      customPose.rightKnee = [radians(-48), 0, 0];
      setFigurePose(fig, customPose);
      const shoulderQuatBefore = fig.bones.leftShoulder.quaternion.clone();
      const kneeQuatBefore = fig.bones.rightKnee.quaternion.clone();

      const bodyMat = fig.tintMaterials[0]!;
      const dressUniforms = bodyMat.userData.pncDressUniforms;
      expect(dressUniforms).toBeDefined();

      // Cycle through all built-in presets
      for (const presetId of MANNEQUIN_DRESS_PRESET_IDS) {
        await setFigureDressMap(fig, presetId);
        if (presetId === 'none') {
          expect(dressUniforms.uDressEnabled.value).toBe(0);
          expect(fig.root.userData.dressMapId).toBe('none');
        } else {
          expect(dressUniforms.uDressEnabled.value).toBe(1);
          expect(dressUniforms.uHasDressMap.value).toBe(1);
          const tex = dressUniforms.uDressMap.value as T.Texture;
          expect(tex.colorSpace).toBe(T.SRGBColorSpace);
          expect(tex.anisotropy).toBe(16);
          expect(tex.generateMipmaps).toBe(true);
          expect((tex.image as { width: number }).width).toBe(2048);
          expect((tex.image as { height: number }).height).toBe(2048);
        }
      }

      // Apply a user-uploaded custom PNG data URL!
      const customDataUrl = makeCustomTestDressDataUrl();
      await setFigureDressMap(fig, customDataUrl);
      expect(dressUniforms.uDressEnabled.value).toBe(1);
      expect(dressUniforms.uHasDressMap.value).toBe(1);
      expect(fig.root.userData.dressMapId).toBe(customDataUrl);
      expect((dressUniforms.uDressMap.value.image as { width: number }).width).toBe(64);

      // Pose must be 100% untouched!
      expect(fig.bones.leftShoulder.quaternion.angleTo(shoulderQuatBefore)).toBeLessThan(1e-6);
      expect(fig.bones.rightKnee.quaternion.angleTo(kneeQuatBefore)).toBeLessThan(1e-6);

      // Verify #ffffff ('Original') vs tinted swatch behavior in both uniforms and shader evaluation
      setFigureColors(fig, '#c68b63', '#ffffff');
      expect(dressUniforms.uOutfitIsOriginal.value).toBe(1);
      expect(`#${bodyMat.color.getHexString()}`).toBe('#c68b63');

      const skinLin: [number, number, number] = [0.85 * 0.55, 0.72 * 0.34, 0.65 * 0.21];
      const origEval = evaluateMannequinDressPixelLinear(
        skinLin,
        [0.85, 0.08, 0.32, 1.0],
        [1, 1, 1],
        true,
        true,
        1.0,
      );
      expect(origEval[0]).toBeCloseTo(0.85, 3);
      expect(origEval[1]).toBeCloseTo(0.08, 3);
      expect(origEval[2]).toBeCloseTo(0.32, 3);

      setFigureColors(fig, '#c68b63', '#2563eb');
      expect(dressUniforms.uOutfitIsOriginal.value).toBe(0);
      expect(`#${dressUniforms.uOutfitColor.value.getHexString()}`).toBe('#2563eb');

      const tintedEval = evaluateMannequinDressPixelLinear(
        skinLin,
        [0.7, 0.7, 0.7, 1.0],
        [0.04, 0.22, 0.82],
        false,
        true,
        1.0,
      );
      expect(tintedEval[2]).toBeGreaterThan(tintedEval[0] * 3);

      const noneEval = evaluateMannequinDressPixelLinear(
        skinLin,
        [0.85, 0.08, 0.32, 1.0],
        [1, 1, 1],
        true,
        false,
        1.0,
      );
      expect(noneEval[0]).toBeCloseTo(skinLin[0], 4);
      expect(noneEval[1]).toBeCloseTo(skinLin[1], 4);
      expect(noneEval[2]).toBeCloseTo(skinLin[2], 4);

      expect(DEFAULT_MANNEQUIN_DRESS_ID).toBe('studio-briefs');
    });

    it.each(MODEL_IDS.filter(id => Boolean(CHARACTERS[id].source)))('keeps %s untouched with zero synthetic dress maps', extId => {
      // Calling setFigureDressMap on a non-mannequin figure is a strict no-op
      const fakeExternalRoot = new T.Group();
      const fakeMat = new T.MeshStandardMaterial();
      const fakeSkin = new T.SkinnedMesh(new T.BufferGeometry(), fakeMat);
      const fakeHead = new T.Bone();
      const fakeExtFigure = {
        modelId: extId,
        nativeRig: true,
        body: 'male',
        root: fakeExternalRoot,
        skin: fakeSkin,
        skins: [fakeSkin],
        bones: { head: fakeHead } as unknown as Figure['bones'],
        restRotations: {} as Figure['restRotations'],
        rotationBases: {} as Figure['rotationBases'],
        tintMaterials: [fakeMat],
        outfitColorUniforms: [],
        hairMaterials: [],
      } as unknown as Figure;

      return setFigureDressMap(fakeExtFigure, 'casual-tee-jeans').then(applied => {
        expect(applied).toBeNull();
        expect(fakeMat.userData.pncDressUniforms).toBeUndefined();
      });
    });

    it('round-trips dressMapId and customDressMapDataUrl in Scene JSON and strips them when switching to external characters', () => {
      const scene = initialScene();
      const male = scene.items[0]!;
      const female = scene.items[1]!;
      expect(isMannequinCharacter(male.modelId)).toBe(true);
      expect(isMannequinCharacter(female.modelId)).toBe(true);

      const customPngDataUrl = makeCustomTestDressDataUrl();
      male.dressMapId = 'casual-tee-jeans';
      female.dressMapId = 'patterned-signature';
      female.customDressMapDataUrl = customPngDataUrl;

      const parsed = validatePortable(scene);
      expect(parsed.type).toBe('scene');
      if (parsed.type === 'scene') {
        expect(parsed.items[0]!.dressMapId).toBe('casual-tee-jeans');
        expect(parsed.items[1]!.dressMapId).toBe('patterned-signature');
        expect(parsed.items[1]!.customDressMapDataUrl).toBe(customPngDataUrl);
      }

      // Malformed dressMapId or customDressMapDataUrl is rejected cleanly
      expect(() =>
        validatePortable({
          ...scene,
          items: [{ ...male, dressMapId: 'not-a-valid-dress' }],
        }),
      ).toThrow();

      expect(() =>
        validatePortable({
          ...scene,
          items: [{ ...female, customDressMapDataUrl: 'javascript:alert(1)' }],
        }),
      ).toThrow(/invalid custom dress map data URL/);

      // Switching from Mannequin Female -> external character clears synthetic dress maps cleanly
      female.modelId = 'pseudonym-nightgown';
      applyCharacterModelColorTransition(female, 'mannequin-female', 'pseudonym-nightgown');
      expect(isMannequinCharacter(female.modelId)).toBe(false);
      expect(female.dressMapId).toBeUndefined();
      expect(female.customDressMapDataUrl).toBeUndefined();
    });
  });
});
