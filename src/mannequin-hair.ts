import * as T from 'three';
import type { Body } from './model';
import type { HairStyle } from './hair';

export const MANNEQUIN_EXTENDED_HAIR_STYLES = [
  'parted',
  'short',
  'curly',
  'long',
  'buns',
  'bun',
  'bob',
  'buzz',
  'partedBeard',
  'none',
] as const;

export type MannequinHairStyle = HairStyle | (typeof MANNEQUIN_EXTENDED_HAIR_STYLES)[number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface MannequinCraniumField {
  center: T.Vector3;
  crownY: number;
  chinY: number;
  headHeight: number;
  halfWidth: number;
  halfDepth: number;
  neckY: number;
  earThetaMin: number;
  earThetaMax: number;
  earPsiMin: number;
  earPsiMax: number;
  nTheta: number;
  nPsi: number;
  psiMax: number;
  /** Exact outer skin surface radius from `center` (includes ears, nose, jaw, neck). */
  exactRadius: Float32Array;
  /** Conservative 3x3 dilated outer skin radius so hair vertices never clip triangles between grid samples. */
  safeRadius: Float32Array;
  /** Smooth ear-bridged cranial dome radius for sleek scalp cap & lock flow lines. */
  scalpRadius: Float32Array;
}

function wrapThetaIndex(idx: number, nTheta: number): number {
  const m = idx % nTheta;
  return m < 0 ? m + nTheta : m;
}

const craniumCache = new WeakMap<object, { rev: number; field: MannequinCraniumField }>();

/**
 * Samples the actual `Body` head/neck triangle surface of `Mannequin_Male` or `Mannequin_Female`
 * (including any active body-proportion morph such as `realistic`, `heroic`, `slender`, `obese`, or `chibi`)
 * into a dense spherical surface field `(theta, psi)` centered inside the cranial vault.
 */
export function sampleMannequinCranium(
  skin: T.SkinnedMesh,
  restPositions?: Float32Array,
  cacheOwner?: T.Object3D,
  proportionRev = 0,
): MannequinCraniumField {
  if (cacheOwner) {
    const hit = craniumCache.get(cacheOwner);
    if (hit && hit.rev === proportionRev) return hit.field;
  }
  const geom = skin.geometry;
  const pos = geom.getAttribute('position') as T.BufferAttribute;
  const skinIdx = geom.getAttribute('skinIndex') as T.BufferAttribute | undefined;
  const skinWt = geom.getAttribute('skinWeight') as T.BufferAttribute | undefined;
  const indexAttr = geom.getIndex();
  const bones = skin.skeleton?.bones ?? [];
  const hasRest = Boolean(restPositions && restPositions.length >= pos.count * 3);
  const getX = (i: number) => (hasRest ? restPositions![i * 3]! : pos.getX(i));
  const getY = (i: number) => (hasRest ? restPositions![i * 3 + 1]! : pos.getY(i));
  const getZ = (i: number) => (hasRest ? restPositions![i * 3 + 2]! : pos.getZ(i));

  let headBoneIdx = -1;
  let neckBoneIdx = -1;
  let spine3BoneIdx = -1;
  for (let i = 0; i < bones.length; i++) {
    const n = bones[i]!.name;
    if (n === 'Head' || n === 'head') headBoneIdx = i;
    else if (n === 'neck_01' || n === 'neck') neckBoneIdx = i;
    else if (n === 'spine_03') spine3BoneIdx = i;
  }

  const vCount = pos.count;
  const isHeadRegion = new Uint8Array(vCount);
  let crownY = -Infinity;
  let chinY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vCount; i++) {
    let hw = 0;
    let nw = 0;
    if (skinIdx && skinWt && headBoneIdx >= 0) {
      for (let k = 0; k < 4; k++) {
        const bi = skinIdx.getX(i * 4 < 0 ? i : i); // Type-safe per-component below
        void bi;
      }
      const b0 = skinIdx.getX(i), b1 = skinIdx.getY(i), b2 = skinIdx.getZ(i), b3 = skinIdx.getW(i);
      const w0 = skinWt.getX(i), w1 = skinWt.getY(i), w2 = skinWt.getZ(i), w3 = skinWt.getW(i);
      if (b0 === headBoneIdx) hw += w0;
      if (b1 === headBoneIdx) hw += w1;
      if (b2 === headBoneIdx) hw += w2;
      if (b3 === headBoneIdx) hw += w3;
      if (b0 === neckBoneIdx || b0 === spine3BoneIdx) nw += w0;
      if (b1 === neckBoneIdx || b1 === spine3BoneIdx) nw += w1;
      if (b2 === neckBoneIdx || b2 === spine3BoneIdx) nw += w2;
      if (b3 === neckBoneIdx || b3 === spine3BoneIdx) nw += w3;
    } else {
      hw = getY(i) > 1.42 ? 1 : 0;
    }

    if (hw + nw > 0.12) {
      isHeadRegion[i] = 1;
    }
    if (hw > 0.45) {
      const x = getX(i);
      const y = getY(i);
      const z = getZ(i);
      crownY = Math.max(crownY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      if (Math.abs(x) < 0.024 && z > 0.015) {
        chinY = Math.min(chinY, y);
      }
    }
  }

  if (!Number.isFinite(crownY) || !Number.isFinite(chinY) || crownY <= chinY + 0.04) {
    crownY = 1.78;
    chinY = 1.54;
    minX = -0.088;
    maxX = 0.088;
    minZ = -0.102;
    maxZ = 0.125;
  }

  const headHeight = crownY - chinY;
  const halfWidth = (maxX - minX) * 0.5;
  const halfDepth = (maxZ - minZ) * 0.5;
  const neckY = neckBoneIdx >= 0
    ? bones[neckBoneIdx]!.getWorldPosition(new T.Vector3()).y - skin.getWorldPosition(new T.Vector3()).y
    : chinY - headHeight * 0.08;

  // Cranial vault center sits slightly posterior to nose tip, centered on parietal/temporal vault
  const center = new T.Vector3(
    0,
    chinY + headHeight * 0.55,
    lerp(minZ, maxZ, 0.44),
  );

  const nTheta = 112;
  const nPsi = 72;
  const psiMax = Math.PI * 0.88; // 0 = +Y crown apex, ~158 deg covers chin, jaw, nape, and upper shoulders
  const exactRadius = new Float32Array(nTheta * nPsi);

  // Bin head/neck/upper-shoulder triangles by angular bounding box for fast exact ray-triangle intersection
  const bins: number[][][] = Array.from({ length: nPsi }, () =>
    Array.from({ length: nTheta }, () => []),
  );
  const triVerts: number[] = [];
  const pA = new T.Vector3(), pB = new T.Vector3(), pC = new T.Vector3();
  const vA = new T.Vector3(), vB = new T.Vector3(), vC = new T.Vector3();

  const triCount = indexAttr ? indexAttr.count / 3 : Math.floor(vCount / 3);
  const cutoffY = chinY - headHeight * 0.65;

  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
    if (!isHeadRegion[i0] && !isHeadRegion[i1] && !isHeadRegion[i2]) {
      if (getY(i0) < cutoffY && getY(i1) < cutoffY && getY(i2) < cutoffY) continue;
    }
    pA.set(getX(i0), getY(i0), getZ(i0));
    pB.set(getX(i1), getY(i1), getZ(i1));
    pC.set(getX(i2), getY(i2), getZ(i2));
    if (pA.y < cutoffY && pB.y < cutoffY && pC.y < cutoffY) continue;

    vA.copy(pA).sub(center);
    vB.copy(pB).sub(center);
    vC.copy(pC).sub(center);
    const rA = vA.length(), rB = vB.length(), rC = vC.length();
    if (rA < 1e-4 || rB < 1e-4 || rC < 1e-4) continue;
    // Skip internal eye-socket / mouth-bag backfaces that are deep inside (< 42% of cranial width)
    const minRef = Math.min(halfWidth, halfDepth) * 0.36;
    if (rA < minRef && rB < minRef && rC < minRef) continue;

    const triId = triVerts.length / 9;
    triVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);

    const psis = [
      Math.acos(clamp(vA.y / rA, -1, 1)),
      Math.acos(clamp(vB.y / rB, -1, 1)),
      Math.acos(clamp(vC.y / rC, -1, 1)),
    ];
    const pMin = Math.max(0, Math.floor((Math.min(...psis) / psiMax) * (nPsi - 1)) - 1);
    const pMax = Math.min(nPsi - 1, Math.ceil((Math.max(...psis) / psiMax) * (nPsi - 1)) + 1);

    // Near the crown pole (`psi < 0.28`), a triangle can span wide azimuths, so broadcast across theta
    if (Math.min(...psis) < 0.28) {
      for (let pi = pMin; pi <= pMax; pi++) {
        for (let ti = 0; ti < nTheta; ti++) bins[pi]![ti]!.push(triId);
      }
    } else {
      const ths = [Math.atan2(vA.x, vA.z), Math.atan2(vB.x, vB.z), Math.atan2(vC.x, vC.z)];
      // Unwrap around seam at +-PI
      const ref = ths[0]!;
      for (let k = 1; k < 3; k++) {
        while (ths[k]! - ref > Math.PI) ths[k]! -= Math.PI * 2;
        while (ths[k]! - ref < -Math.PI) ths[k]! += Math.PI * 2;
      }
      const t0 = Math.floor(((Math.min(...ths) + Math.PI) / (Math.PI * 2)) * nTheta) - 1;
      const t1 = Math.ceil(((Math.max(...ths) + Math.PI) / (Math.PI * 2)) * nTheta) + 1;
      for (let pi = pMin; pi <= pMax; pi++) {
        for (let ti = t0; ti <= t1; ti++) {
          bins[pi]![wrapThetaIndex(ti, nTheta)]!.push(triId);
        }
      }
    }
  }

  // Möller–Trumbore ray-triangle intersection from `center` (origin 0,0,0 in v-space) along unit ray D
  const e1 = new T.Vector3(), e2 = new T.Vector3(), hVec = new T.Vector3(), qVec = new T.Vector3(), sVec = new T.Vector3();
  const rayDir = new T.Vector3();
  const fallbackR = Math.max(halfWidth, halfDepth) * 0.88;

  for (let pi = 0; pi < nPsi; pi++) {
    const psi = (pi / (nPsi - 1)) * psiMax;
    const sinPsi = Math.sin(psi);
    const cosPsi = Math.cos(psi);
    for (let ti = 0; ti < nTheta; ti++) {
      const theta = -Math.PI + (ti / nTheta) * Math.PI * 2;
      rayDir.set(sinPsi * Math.sin(theta), cosPsi, sinPsi * Math.cos(theta));
      let maxT = 0;
      const cell = bins[pi]![ti]!;
      for (let c = 0; c < cell.length; c++) {
        const base = cell[c]! * 9;
        const ax = triVerts[base]!, ay = triVerts[base + 1]!, az = triVerts[base + 2]!;
        e1.set(triVerts[base + 3]! - ax, triVerts[base + 4]! - ay, triVerts[base + 5]! - az);
        e2.set(triVerts[base + 6]! - ax, triVerts[base + 7]! - ay, triVerts[base + 8]! - az);
        hVec.crossVectors(rayDir, e2);
        const det = e1.dot(hVec);
        if (Math.abs(det) < 1e-10) continue;
        const invDet = 1 / det;
        sVec.set(-ax, -ay, -az);
        const u = invDet * sVec.dot(hVec);
        if (u < -1e-4 || u > 1.0001) continue;
        qVec.crossVectors(sVec, e1);
        const v = invDet * rayDir.dot(qVec);
        if (v < -1e-4 || u + v > 1.0001) continue;
        const tHit = invDet * e2.dot(qVec);
        if (tHit > maxT && tHit < headHeight * 1.45) {
          maxT = tHit;
        }
      }
      exactRadius[pi * nTheta + ti] = maxT > 0.01 ? maxT : fallbackR;
    }
  }

  // Fill any rare missed cells from neighbors
  for (let pass = 0; pass < 3; pass++) {
    for (let pi = 0; pi < nPsi; pi++) {
      for (let ti = 0; ti < nTheta; ti++) {
        const idx = pi * nTheta + ti;
        if (exactRadius[idx]! > 0.02) continue;
        const l = exactRadius[pi * nTheta + wrapThetaIndex(ti - 1, nTheta)]!;
        const r = exactRadius[pi * nTheta + wrapThetaIndex(ti + 1, nTheta)]!;
        exactRadius[idx] = Math.max(l, r, fallbackR);
      }
    }
  }

  // Build smooth ear-bridged cranial dome (`scalpRadius`) and detect exact ear angular bounds
  let smooth1 = Float32Array.from(exactRadius);
  let scratch = new Float32Array(nTheta * nPsi);
  const blurPass = (src: Float32Array, dst: Float32Array) => {
    for (let pi = 0; pi < nPsi; pi++) {
      const pUp = Math.max(0, pi - 1);
      const pDn = Math.min(nPsi - 1, pi + 1);
      for (let ti = 0; ti < nTheta; ti++) {
        const tL = wrapThetaIndex(ti - 1, nTheta);
        const tR = wrapThetaIndex(ti + 1, nTheta);
        dst[pi * nTheta + ti] = (
          src[pi * nTheta + ti]! * 4 +
          src[pi * nTheta + tL]! * 2 +
          src[pi * nTheta + tR]! * 2 +
          src[pUp * nTheta + ti]! * 2 +
          src[pDn * nTheta + ti]! * 2 +
          src[pUp * nTheta + tL]! +
          src[pUp * nTheta + tR]! +
          src[pDn * nTheta + tL]! +
          src[pDn * nTheta + tR]!
        ) / 16;
      }
    }
  };

  for (let k = 0; k < 10; k++) {
    blurPass(smooth1, scratch);
    [smooth1, scratch] = [scratch, smooth1];
  }

  // Detect localized ear pinna protrusion (`|theta|` near +-95 deg, mid elevation) and bridge over ear spikes for `scalpRadius`
  let earThetaMin = 1.32;
  let earThetaMax = 1.92;
  let earPsiMin = 1.24;
  let earPsiMax = 1.88;
  let foundEarCells = 0;
  let eTMin = Infinity, eTMax = -Infinity, ePMin = Infinity, ePMax = -Infinity;

  const deEared = Float32Array.from(exactRadius);
  for (let pi = 0; pi < nPsi; pi++) {
    const psi = (pi / (nPsi - 1)) * psiMax;
    for (let ti = 0; ti < nTheta; ti++) {
      const theta = -Math.PI + (ti / nTheta) * Math.PI * 2;
      const aTheta = Math.abs(theta);
      const idx = pi * nTheta + ti;
      const diff = exactRadius[idx]! - smooth1[idx]!;
      if (aTheta > 1.15 && aTheta < 2.15 && psi > 1.05 && psi < 2.05 && diff > headHeight * 0.016) {
        deEared[idx] = smooth1[idx]!;
        eTMin = Math.min(eTMin, aTheta);
        eTMax = Math.max(eTMax, aTheta);
        ePMin = Math.min(ePMin, psi);
        ePMax = Math.max(ePMax, psi);
        foundEarCells++;
      }
    }
  }
  if (foundEarCells >= 4) {
    earThetaMin = clamp(eTMin - 0.05, 1.18, 1.55);
    earThetaMax = clamp(eTMax + 0.06, 1.68, 2.15);
    earPsiMin = clamp(ePMin - 0.06, 1.05, 1.52);
    earPsiMax = clamp(ePMax + 0.05, 1.62, 2.12);
  }

  let scalpRadius = Float32Array.from(deEared);
  for (let k = 0; k < 5; k++) {
    blurPass(scalpRadius, scratch);
    [scalpRadius, scratch] = [scratch, scalpRadius];
  }
  // Ensure `scalpRadius` never dips below `deEared` on the upper cranium
  for (let i = 0; i < scalpRadius.length; i++) {
    scalpRadius[i] = Math.max(scalpRadius[i]!, deEared[i]!);
  }

  // Conservative 3x3 max-pooled `safeRadius` guarantees 0 triangle penetration even across triangle chords
  const safeRadius = new Float32Array(nTheta * nPsi);
  for (let pi = 0; pi < nPsi; pi++) {
    const p0 = Math.max(0, pi - 1), p1 = Math.min(nPsi - 1, pi + 1);
    for (let ti = 0; ti < nTheta; ti++) {
      let m = exactRadius[pi * nTheta + ti]!;
      for (let dp = p0; dp <= p1; dp++) {
        for (let dt = -1; dt <= 1; dt++) {
          m = Math.max(m, exactRadius[dp * nTheta + wrapThetaIndex(ti + dt, nTheta)]!);
        }
      }
      safeRadius[pi * nTheta + ti] = m;
    }
  }

  const field: MannequinCraniumField = {
    center,
    crownY,
    chinY,
    headHeight,
    halfWidth,
    halfDepth,
    neckY,
    earThetaMin,
    earThetaMax,
    earPsiMin,
    earPsiMax,
    nTheta,
    nPsi,
    psiMax,
    exactRadius,
    safeRadius,
    scalpRadius,
  };
  if (cacheOwner) {
    craniumCache.set(cacheOwner, { rev: proportionRev, field });
  }
  return field;
}

function sampleGridBilinear(grid: Float32Array, field: MannequinCraniumField, theta: number, psi: number): number {
  const { nTheta, nPsi, psiMax } = field;
  let wrapped = theta;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  while (wrapped >= Math.PI) wrapped -= Math.PI * 2;
  const ft = ((wrapped + Math.PI) / (Math.PI * 2)) * nTheta;
  const fp = clamp((psi / psiMax) * (nPsi - 1), 0, nPsi - 1.0001);
  const t0 = wrapThetaIndex(Math.floor(ft), nTheta);
  const t1 = wrapThetaIndex(t0 + 1, nTheta);
  const tx = ft - Math.floor(ft);
  const p0 = Math.floor(fp);
  const p1 = Math.min(nPsi - 1, p0 + 1);
  const px = fp - p0;
  const v00 = grid[p0 * nTheta + t0]!;
  const v10 = grid[p0 * nTheta + t1]!;
  const v01 = grid[p1 * nTheta + t0]!;
  const v11 = grid[p1 * nTheta + t1]!;
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), px);
}

function pointOnField(field: MannequinCraniumField, theta: number, psi: number, radius: number, out = new T.Vector3()): T.Vector3 {
  const sinPsi = Math.sin(psi);
  return out.set(
    field.center.x + radius * sinPsi * Math.sin(theta),
    field.center.y + radius * Math.cos(psi),
    field.center.z + radius * sinPsi * Math.cos(theta),
  );
}

/**
 * Enforces that a candidate 3D point `p` stays strictly outside `field.safeRadius + minClearance`
 * anywhere within the cranial/jaw/neck spherical field (`psi <= field.psiMax`).
 */
export function enforceSafeClearance(field: MannequinCraniumField, p: T.Vector3, minClearance: number): void {
  const dx = p.x - field.center.x;
  const dy = p.y - field.center.y;
  const dz = p.z - field.center.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return;
  const psi = Math.acos(clamp(dy / d, -1, 1));
  if (psi > field.psiMax) return;
  const theta = Math.atan2(dx, dz);
  const minR = sampleGridBilinear(field.safeRadius, field, theta, psi) + minClearance;
  if (d < minR) {
    const s = minR / d;
    p.set(field.center.x + dx * s, field.center.y + dy * s, field.center.z + dz * s);
  }
}

export interface MannequinHairBufferSlice {
  byteOffset: number;
  byteLength: number;
  count: number;
}

export interface MannequinHairGenderMeshEntry {
  vertexCount: number;
  triangleCount: number;
  positions: MannequinHairBufferSlice;
  normals: MannequinHairBufferSlice;
  uvs: MannequinHairBufferSlice;
  indices: MannequinHairBufferSlice;
}

export interface MannequinHairAssetEntry {
  id: string;
  alphaMode: 'opaque' | 'mask';
  albedoPath: string;
  normalPath: string;
  author: string;
  license: string;
  licenseHeader: string;
  meshes: Record<'female' | 'male', MannequinHairGenderMeshEntry>;
}

export interface MannequinHairManifest {
  version: number;
  binary: string;
  styleMap: Record<'female' | 'male', Record<string, string>>;
  restHead: Record<
    'female' | 'male',
    { crownY: number; center: [number, number, number]; halfWidth: number; headHeight: number }
  >;
  assets: Record<string, MannequinHairAssetEntry>;
}

export interface MannequinHairTextureSet {
  map: T.Texture;
  normalMap?: T.Texture;
}

let hairManifest: MannequinHairManifest | null = null;
let hairBinary: ArrayBuffer | null = null;
const hairTextures = new Map<string, MannequinHairTextureSet>();
let hairBundlePromise: Promise<void> | null = null;
const restBaseFieldCache = new WeakMap<T.BufferGeometry, MannequinCraniumField>();
const restBaseFieldByGender = new Map<'female' | 'male', MannequinCraniumField>();

function configureHairTexture(tex: T.Texture, isAlbedo: boolean): T.Texture {
  tex.flipY = false;
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = isAlbedo ? T.SRGBColorSpace : T.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function registerMannequinHairBundle(
  manifest: MannequinHairManifest,
  bin: ArrayBuffer,
  textures?: Record<string, MannequinHairTextureSet>,
): void {
  hairManifest = manifest;
  hairBinary = bin;
  if (textures) {
    for (const [id, set] of Object.entries(textures)) {
      configureHairTexture(set.map, true);
      if (set.normalMap) configureHairTexture(set.normalMap, false);
      hairTextures.set(id, set);
    }
  }
}

export function loadMannequinHairBundle(baseUrl = '/'): Promise<void> {
  if (hairManifest && hairBinary && hairTextures.size > 0) return Promise.resolve();
  if (hairBundlePromise) return hairBundlePromise;

  const prefix = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  hairBundlePromise = (async () => {
    const manifestRes = await fetch(`${prefix}models/mannequin/hair/mannequin-hair.json`);
    if (!manifestRes.ok) {
      throw new Error(`Could not load Mannequin CC0 hair manifest (${manifestRes.status})`);
    }
    const manifest = (await manifestRes.json()) as MannequinHairManifest;
    const binRes = await fetch(`${prefix}${manifest.binary}`);
    if (!binRes.ok) {
      throw new Error(`Could not load Mannequin CC0 hair binary (${binRes.status})`);
    }
    const bin = await binRes.arrayBuffer();

    const texLoader = new T.TextureLoader();
    const assetEntries = Object.values(manifest.assets);
    const loadedTextures: Record<string, MannequinHairTextureSet> = {};
    await Promise.all(
      assetEntries.map(async asset => {
        const [map, normalMap] = await Promise.all([
          texLoader.loadAsync(`${prefix}${asset.albedoPath}`),
          texLoader.loadAsync(`${prefix}${asset.normalPath}`).catch(() => undefined),
        ]);
        loadedTextures[asset.id] = { map, normalMap };
      }),
    );
    registerMannequinHairBundle(manifest, bin, loadedTextures);
  })().catch(err => {
    hairBundlePromise = null;
    throw err;
  });

  return hairBundlePromise;
}

function buildJawBeardBuffers(field: MannequinCraniumField): {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
} {
  const scale = field.headHeight / 0.235;
  const innerClear = 0.0009 * scale;
  const segT = 40;
  const segV = 10;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const pushV = (p: T.Vector3, u: number, v: number): number => {
    const idx = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uvs.push(u, v);
    return idx;
  };

  const outIdx: number[][] = [];
  const inIdx: number[][] = [];
  for (let rv = 0; rv < segV; rv++) {
    const v = rv / (segV - 1);
    const oRow: number[] = [];
    const iRow: number[] = [];
    for (let ti = 0; ti < segT; ti++) {
      const s = (ti / (segT - 1)) * 2 - 1;
      const theta = s * 1.16;
      const aTheta = Math.abs(theta);
      const upperPsi = lerp(2.08, 1.40, Math.pow(smoothstep(0.18, 1.16, aTheta), 1.15));
      const lowerPsi = lerp(2.38, 1.88, Math.pow(smoothstep(0.15, 1.16, aTheta), 1.25));
      const psi = clamp(lerp(upperPsi, lowerPsi, v), 1.32, field.psiMax - 0.02);
      const rSafe = sampleGridBilinear(field.safeRadius, field, theta, psi);
      const edgeTaper = Math.sin(v * Math.PI) * Math.sin(((ti + 0.5) / segT) * Math.PI);
      const chinFullness = (1 - smoothstep(0.0, 0.65, aTheta)) * 0.0038 * scale;
      const thick = 0.0014 * scale + (0.0042 * scale + chinFullness) * Math.pow(edgeTaper, 0.55);
      oRow.push(pushV(pointOnField(field, theta, psi, rSafe + thick), (s + 1) * 0.5, v));
      iRow.push(pushV(pointOnField(field, theta, psi, rSafe + innerClear), (s + 1) * 0.5, v));
    }
    outIdx.push(oRow);
    inIdx.push(iRow);
  }

  for (let rv = 0; rv < segV - 1; rv++) {
    for (let ti = 0; ti < segT - 1; ti++) {
      const a0 = outIdx[rv]![ti]!, a1 = outIdx[rv]![ti + 1]!;
      const b0 = outIdx[rv + 1]![ti]!, b1 = outIdx[rv + 1]![ti + 1]!;
      indices.push(a0, b0, b1, a0, b1, a1);
      const ia0 = inIdx[rv]![ti]!, ia1 = inIdx[rv]![ti + 1]!;
      const ib0 = inIdx[rv + 1]![ti]!, ib1 = inIdx[rv + 1]![ti + 1]!;
      indices.push(ia0, ia1, ib1, ia0, ib1, ib0);
    }
  }
  for (let ti = 0; ti < segT - 1; ti++) {
    indices.push(outIdx[0]![ti]!, outIdx[0]![ti + 1]!, inIdx[0]![ti + 1]!, outIdx[0]![ti]!, inIdx[0]![ti + 1]!, inIdx[0]![ti]!);
    const b = segV - 1;
    indices.push(outIdx[b]![ti + 1]!, outIdx[b]![ti]!, inIdx[b]![ti]!, outIdx[b]![ti + 1]!, inIdx[b]![ti]!, inIdx[b]![ti + 1]!);
  }

  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as T.BufferAttribute;
  const outNormals = new Float32Array(nrm.array);
  g.dispose();

  return {
    positions: new Float32Array(positions),
    normals: outNormals,
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

export interface MannequinHairBuildOptions {
  restPositions?: Float32Array;
  skinToHeadRest?: T.Matrix4;
  cacheOwner?: T.Object3D;
  proportionRev?: number;
}

export interface MannequinFittedHairResult {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
  depthMaterial?: T.MeshDepthMaterial;
}

/**
 * Builds artist-authored CC0 polygon hair geometry + strand-mapped material fitted via
 * MakeHuman `.mhclo` correspondence directly to `Mannequin_Female` & `Mannequin_Male` in `Head`-bone local space.
 */
export function buildMannequinFittedHair(
  skin: T.SkinnedMesh,
  headBone: T.Bone,
  body: Body,
  style: MannequinHairStyle,
  hairColor: string,
  options?: MannequinHairBuildOptions,
): MannequinFittedHairResult | null {
  if (style === 'none') return null;
  if (!hairManifest || !hairBinary) return null;

  const genderKey: 'female' | 'male' = body === 'female' ? 'female' : 'male';
  const defaultKey = genderKey === 'female' ? 'long' : 'parted';
  const assetId = hairManifest.styleMap[genderKey][style] ?? hairManifest.styleMap[genderKey][defaultKey];
  const asset = assetId ? hairManifest.assets[assetId] : undefined;
  if (!asset) return null;

  const meshEntry = asset.meshes[genderKey];
  const srcPos = new Float32Array(
    hairBinary,
    meshEntry.positions.byteOffset,
    meshEntry.positions.count * 3,
  );
  const srcNrm = new Float32Array(
    hairBinary,
    meshEntry.normals.byteOffset,
    meshEntry.normals.count * 3,
  );
  const srcUv = new Float32Array(
    hairBinary,
    meshEntry.uvs.byteOffset,
    meshEntry.uvs.count * 2,
  );
  const srcIdx = new Uint16Array(
    hairBinary,
    meshEntry.indices.byteOffset,
    meshEntry.indices.count,
  );

  let baseField = restBaseFieldCache.get(skin.geometry) ?? restBaseFieldByGender.get(genderKey);
  if (!baseField) {
    baseField = sampleMannequinCranium(skin, undefined, undefined, 0);
    restBaseFieldCache.set(skin.geometry, baseField);
    if (!options?.restPositions && (options?.proportionRev ?? 0) === 0) {
      restBaseFieldByGender.set(genderKey, baseField);
    }
  } else if (!restBaseFieldCache.has(skin.geometry) && !options?.restPositions && (options?.proportionRev ?? 0) === 0) {
    restBaseFieldCache.set(skin.geometry, baseField);
  }
  const field = sampleMannequinCranium(
    skin,
    options?.restPositions,
    options?.cacheOwner,
    options?.proportionRev ?? 0,
  );

  const sx = field.halfWidth / Math.max(1e-4, baseField.halfWidth);
  const sy = field.headHeight / Math.max(1e-4, baseField.headHeight);
  const sz = field.halfDepth / Math.max(1e-4, baseField.halfDepth);
  const isMorphed =
    Math.abs(sx - 1) > 1e-3 ||
    Math.abs(sy - 1) > 1e-3 ||
    Math.abs(sz - 1) > 1e-3 ||
    field.center.distanceToSquared(baseField.center) > 1e-6;

  const minCranialClear = 0.00095 * sy;

  let totalVerts = meshEntry.vertexCount;
  let totalIndices = srcIdx.length;
  let beard: ReturnType<typeof buildJawBeardBuffers> | null = null;
  if (style === 'partedBeard') {
    beard = buildJawBeardBuffers(field);
    totalVerts += beard.positions.length / 3;
    totalIndices += beard.indices.length;
  }

  const posArray = new Float32Array(totalVerts * 3);
  const nrmArray = new Float32Array(totalVerts * 3);
  const uvArray = new Float32Array(totalVerts * 2);
  const idxArray = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let skinToHead: T.Matrix4;
  if (options?.skinToHeadRest) {
    skinToHead = options.skinToHeadRest;
  } else {
    skin.updateWorldMatrix(true, false);
    headBone.updateWorldMatrix(true, false);
    skinToHead = headBone.matrixWorld.clone().invert().multiply(skin.matrixWorld);
  }
  const nrmMat = new T.Matrix3().getNormalMatrix(skinToHead);

  const tmpP = new T.Vector3();
  const tmpN = new T.Vector3();

  for (let i = 0; i < meshEntry.vertexCount; i++) {
    const i3 = i * 3;
    const i2 = i * 2;
    if (isMorphed) {
      tmpP.set(
        field.center.x + (srcPos[i3]! - baseField.center.x) * sx,
        field.center.y + (srcPos[i3 + 1]! - baseField.center.y) * sy,
        field.center.z + (srcPos[i3 + 2]! - baseField.center.z) * sz,
      );
    } else {
      tmpP.set(srcPos[i3]!, srcPos[i3 + 1]!, srcPos[i3 + 2]!);
    }

    const dx = tmpP.x - field.center.x;
    const dy = tmpP.y - field.center.y;
    const dz = tmpP.z - field.center.z;
    const r = Math.hypot(dx, dy, dz);
    if (r > 1e-6) {
      const psi = Math.acos(clamp(dy / r, -1, 1));
      const theta = Math.atan2(dx, dz);
      const inEarCutout =
        Math.abs(theta) >= field.earThetaMin - 0.14 &&
        Math.abs(theta) <= field.earThetaMax + 0.14 &&
        psi >= field.earPsiMin - 0.12;
      const onFacialFront = Math.abs(theta) < 0.78 && psi > 1.05;
      if (psi <= 1.40 && !inEarCutout && !onFacialFront) {
        const minR = sampleGridBilinear(field.safeRadius, field, theta, psi) + minCranialClear;
        if (r < minR) {
          const scaleOut = minR / r;
          tmpP.set(
            field.center.x + dx * scaleOut,
            field.center.y + dy * scaleOut,
            field.center.z + dz * scaleOut,
          );
        }
      }
    }

    tmpP.applyMatrix4(skinToHead);
    posArray[i3] = tmpP.x;
    posArray[i3 + 1] = tmpP.y;
    posArray[i3 + 2] = tmpP.z;

    tmpN.set(srcNrm[i3]!, srcNrm[i3 + 1]!, srcNrm[i3 + 2]!);
    if (isMorphed) {
      tmpN.set(tmpN.x / sx, tmpN.y / sy, tmpN.z / sz);
    }
    tmpN.applyMatrix3(nrmMat).normalize();
    nrmArray[i3] = tmpN.x;
    nrmArray[i3 + 1] = tmpN.y;
    nrmArray[i3 + 2] = tmpN.z;

    uvArray[i2] = srcUv[i2]!;
    uvArray[i2 + 1] = srcUv[i2 + 1]!;
  }

  idxArray.set(srcIdx, 0);

  if (beard) {
    const bVerts = beard.positions.length / 3;
    const vBase = meshEntry.vertexCount;
    for (let i = 0; i < bVerts; i++) {
      const s3 = i * 3;
      const d3 = (vBase + i) * 3;
      const d2 = (vBase + i) * 2;
      tmpP.set(beard.positions[s3]!, beard.positions[s3 + 1]!, beard.positions[s3 + 2]!).applyMatrix4(skinToHead);
      posArray[d3] = tmpP.x;
      posArray[d3 + 1] = tmpP.y;
      posArray[d3 + 2] = tmpP.z;

      tmpN.set(beard.normals[s3]!, beard.normals[s3 + 1]!, beard.normals[s3 + 2]!).applyMatrix3(nrmMat).normalize();
      nrmArray[d3] = tmpN.x;
      nrmArray[d3 + 1] = tmpN.y;
      nrmArray[d3 + 2] = tmpN.z;

      uvArray[d2] = beard.uvs[i * 2]!;
      uvArray[d2 + 1] = beard.uvs[i * 2 + 1]!;
    }
    for (let i = 0; i < beard.indices.length; i++) {
      idxArray[srcIdx.length + i] = beard.indices[i]! + vBase;
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(posArray, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(nrmArray, 3));
  geometry.setAttribute('uv', new T.BufferAttribute(uvArray, 2));
  geometry.setIndex(new T.BufferAttribute(idxArray, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.mannequinFittedHair = true;
  geometry.userData.mannequinHairStyle = style;
  geometry.userData.mannequinHairAssetId = asset.id;

  const texSet = hairTextures.get(asset.id);
  const isMask = asset.alphaMode === 'mask' && Boolean(texSet?.map);

  const material = new T.MeshStandardMaterial({
    name: `Mannequin CC0 hair (${asset.id})`,
    color: new T.Color(hairColor),
    map: texSet?.map ?? null,
    normalMap: texSet?.normalMap ?? null,
    normalScale: new T.Vector2(0.45, 0.45),
    alphaTest: isMask ? 0.42 : 0,
    roughness: 0.58,
    metalness: 0.01,
    side: T.DoubleSide,
    shadowSide: T.DoubleSide,
  });

  const depthMaterial = isMask && texSet?.map
    ? new T.MeshDepthMaterial({
        depthPacking: T.RGBADepthPacking,
        map: texSet.map,
        alphaTest: 0.42,
      })
    : undefined;

  return { geometry, material, depthMaterial };
}
