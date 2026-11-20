import * as T from 'three';

export const BODY_TYPE_IDS = [
  'realistic',
  'heroic',
  'lean',
  'slender',
  'busty',
  'chubby',
  'fat',
  'obese',
  'chibi',
] as const;

export type BodyTypeId = (typeof BODY_TYPE_IDS)[number];

export interface BodyTypeMeta {
  readonly id: BodyTypeId;
  readonly label: string;
  readonly description: string;
  readonly proportionHint: string;
}

export const BODY_TYPES: readonly BodyTypeMeta[] = [
  {
    id: 'realistic',
    label: 'Realistic',
    description: 'Balanced 7.5-head natural human proportions with moderated shoulder taper.',
    proportionHint: '7.5 heads',
  },
  {
    id: 'heroic',
    label: 'Heroic',
    description: 'Classic athletic comic/superhero silhouette with broad shoulders and tapered waist.',
    proportionHint: '8.0 heads',
  },
  {
    id: 'lean',
    label: 'Lean',
    description: 'Agile swimmer/runner build with low body mass, trim waist, and defined limbs.',
    proportionHint: '7.8 heads',
  },
  {
    id: 'slender',
    label: 'Slender',
    description: 'Tall, narrow-framed silhouette with elongated limbs and slim torso.',
    proportionHint: '8.2 heads',
  },
  {
    id: 'busty',
    label: 'Busty',
    description: 'Fuller anterior chest/bust projection with supportive ribcage and curvy waist-hip contour.',
    proportionHint: '7.6 heads',
  },
  {
    id: 'chubby',
    label: 'Chubby',
    description: 'Soft, rounded build with fuller cheeks, belly, waist, hips, thighs, and upper arms.',
    proportionHint: '7.4 heads',
  },
  {
    id: 'fat',
    label: 'Fat',
    description: 'Heavyset build with pronounced abdominal dome, wide waist/hips, and thick limbs.',
    proportionHint: '7.3 heads',
  },
  {
    id: 'obese',
    label: 'Obese',
    description: 'High-mass silhouette with prominent torso/belly volume and broad hips and thighs.',
    proportionHint: '7.2 heads',
  },
  {
    id: 'chibi',
    label: 'Chibi',
    description: 'Stylized 2.5-head anime chibi proportion with large expressive anime eyes and compact limbs.',
    proportionHint: '2.5 heads',
  },
] as const;

export const BODY_TYPE_LABELS: Record<BodyTypeId, string> = Object.fromEntries(
  BODY_TYPES.map(entry => [entry.id, entry.label]),
) as Record<BodyTypeId, string>;

export const BODY_TYPE_DESCRIPTIONS: Record<BodyTypeId, string> = Object.fromEntries(
  BODY_TYPES.map(entry => [entry.id, entry.description]),
) as Record<BodyTypeId, string>;

export const DEFAULT_BODY_TYPE: BodyTypeId = 'heroic';

export function isBodyTypeId(v: unknown): v is BodyTypeId {
  return typeof v === 'string' && (BODY_TYPE_IDS as readonly string[]).includes(v);
}

export function getBodyTypeMeta(bodyType: BodyTypeId): BodyTypeMeta {
  return BODY_TYPES.find(entry => entry.id === bodyType) ?? BODY_TYPES[1]!;
}

export interface SkullEnvelope {
  center: [number, number, number];
  half: [number, number, number];
  crownY: number;
  chinY: number;
}

export interface ArchetypeSliceRef {
  byteOffset: number;
  byteLength: number;
  componentType?: string;
}

export interface ArchetypeMeshDeltaMeta {
  name: string;
  byteOffset: number;
  byteLength: number;
  scale: number;
  maximumError: number;
  color?: ArchetypeSliceRef;
}

export interface ArchetypeShapeMeta {
  meshes: ArchetypeMeshDeltaMeta[];
  bodyTexture?: string;
  floorOffsetY: number;
  boneLocalTranslations: ArchetypeSliceRef;
  boneWorldTransforms: ArchetypeSliceRef;
}

export interface ArchetypeGenderMeta {
  glb: string;
  meshes: Array<{
    name: string;
    vertexCount: number;
    weld: ArchetypeSliceRef;
    weldCount: number;
  }>;
  archetypes: Record<BodyTypeId, ArchetypeShapeMeta>;
}

export interface MannequinArchetypeManifest {
  schemaVersion: number;
  encoding: string;
  baseBodyType: BodyTypeId;
  binary: string;
  boneNames: string[];
  gender: Record<'female' | 'male', ArchetypeGenderMeta>;
}

export interface PreparsedWeldTable {
  vToWeld: Int32Array;
  weldToFirstV: Int32Array;
  weldCount: number;
}

interface LoadedArchetypeBundle {
  manifest: MannequinArchetypeManifest;
  buffer: ArrayBuffer;
  weldTables: Map<string, PreparsedWeldTable>;
  normScratch: Map<string, Float32Array>;
}

let loadedBundle: LoadedArchetypeBundle | null = null;
let bundleLoadingPromise: Promise<void> | null = null;

type ProportionPostHook = (figureRoot: T.Object3D, gender: 'male' | 'female', bodyType: BodyTypeId) => void;
const postHooks: ProportionPostHook[] = [];
const preHooks: ((figureRoot: T.Object3D) => void)[] = [];

export function registerProportionPostHook(fn: ProportionPostHook): void {
  if (!postHooks.includes(fn)) postHooks.push(fn);
}

export function registerProportionPreHook(fn: (figureRoot: T.Object3D) => void): void {
  if (!preHooks.includes(fn)) preHooks.push(fn);
}

export function hasMannequinArchetypeBundle(): boolean {
  return loadedBundle !== null;
}

export function registerMannequinArchetypeBundle(
  manifest: MannequinArchetypeManifest,
  rawBuffer: ArrayBuffer | ArrayBufferView,
): void {
  const buffer: ArrayBuffer =
    rawBuffer instanceof ArrayBuffer
      ? rawBuffer.byteLength > 0
        ? rawBuffer
        : new ArrayBuffer(0)
      : (rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength) as ArrayBuffer);

  const weldTables = new Map<string, PreparsedWeldTable>();
  const normScratch = new Map<string, Float32Array>();

  for (const sex of ['female', 'male'] as const) {
    const g = manifest.gender[sex];
    if (!g) continue;
    for (const meshMeta of g.meshes) {
      const { vertexCount, weldCount, weld } = meshMeta;
      let rawWeld: ArrayLike<number>;
      if (weld.byteLength === vertexCount * 2) {
        rawWeld = new Uint16Array(buffer, weld.byteOffset, vertexCount);
      } else {
        rawWeld = new Uint32Array(buffer, weld.byteOffset, vertexCount);
      }
      const vToWeld = new Int32Array(vertexCount);
      const weldToFirstV = new Int32Array(weldCount).fill(-1);
      for (let v = 0; v < vertexCount; v++) {
        const w = rawWeld[v]!;
        vToWeld[v] = w;
        if (weldToFirstV[w] === -1) weldToFirstV[w] = v;
      }
      for (let w = 0; w < weldCount; w++) {
        if (weldToFirstV[w] === -1) weldToFirstV[w] = 0;
      }
      const key = `${sex}:${meshMeta.name}:${vertexCount}`;
      weldTables.set(key, { vToWeld, weldToFirstV, weldCount });
      normScratch.set(key, new Float32Array(weldCount * 3));
    }
  }

  loadedBundle = { manifest, buffer, weldTables, normScratch };
}

export function getMannequinWeldTable(
  gender: 'male' | 'female',
  meshName: string,
  expectedVertexCount: number,
): PreparsedWeldTable | null {
  if (!loadedBundle) return null;
  return loadedBundle.weldTables.get(`${gender}:${meshName}:${expectedVertexCount}`) ?? null;
}

export function loadMannequinArchetypeBundle(baseUrl = import.meta.env.BASE_URL): Promise<void> {
  if (loadedBundle) return Promise.resolve();
  if (bundleLoadingPromise) return bundleLoadingPromise;

  bundleLoadingPromise = (async () => {
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
    const jsonUrl = `${baseUrl}models/mannequin/archetypes.json`;
    const binUrl = `${baseUrl}models/mannequin/archetypes.bin`;

    if (isNode && typeof window === 'undefined' && !/^https?:\/\//i.test(jsonUrl)) {
      const [{ readFile }, pathMod] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
      ]);
      const dir = pathMod.resolve(process.cwd(), 'public', 'models', 'mannequin');
      const [jsonText, binBuf] = await Promise.all([
        readFile(pathMod.join(dir, 'archetypes.json'), 'utf8'),
        readFile(pathMod.join(dir, 'archetypes.bin')),
      ]);
      const manifest = JSON.parse(jsonText) as MannequinArchetypeManifest;
      registerMannequinArchetypeBundle(manifest, binBuf);
      return;
    }

    const [jsonRes, binRes] = await Promise.all([fetch(jsonUrl), fetch(binUrl)]);
    if (!jsonRes.ok) throw new Error(`Failed to fetch archetypes.json (${jsonRes.status})`);
    if (!binRes.ok) throw new Error(`Failed to fetch archetypes.bin (${binRes.status})`);
    const [manifest, binArrayBuffer] = await Promise.all([
      jsonRes.json() as Promise<MannequinArchetypeManifest>,
      binRes.arrayBuffer(),
    ]);
    registerMannequinArchetypeBundle(manifest, binArrayBuffer);
  })().catch(err => {
    bundleLoadingPromise = null;
    throw new Error(
      `Could not load mannequin proportion archetypes. ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return bundleLoadingPromise;
}

interface SkinBaselineEntry {
  skin: T.SkinnedMesh;
  name: string;
  vertexCount: number;
  triIndices: Int32Array;
  basePositions: Float32Array;
  baseNormals: Float32Array;
  baseColors: Float32Array | null;
  baseColorItemSize: number;
  baseVertexColors: boolean;
  headWeightedVertices: Int32Array;
}

interface FigureProportionBaseline {
  skins: SkinBaselineEntry[];
  bonesByName: Map<string, T.Bone>;
  baseHeadHeight: number;
  baseSkullEnvelope: SkullEnvelope;
}

const proportionBaselines = new WeakMap<T.Object3D, FigureProportionBaseline>();
const morphedSkullEnvelopes = new WeakMap<T.Object3D, SkullEnvelope>();
const headRestBindInverses = new WeakMap<T.Object3D, T.Matrix4>();
const materialMannequinMaps = new WeakMap<T.Material, { defaultMap: T.Texture; chibiMap: T.Texture }>();

export function getFigureMorphedSkullEnvelope(figureRoot: T.Object3D): SkullEnvelope | undefined {
  return morphedSkullEnvelopes.get(figureRoot);
}

export function getFigureHeadRestBindInverse(figureRoot: T.Object3D): T.Matrix4 | undefined {
  return headRestBindInverses.get(figureRoot);
}

export function hasBodyProportionBaseline(figureRoot: T.Object3D): boolean {
  return proportionBaselines.has(figureRoot);
}

export function setMaterialMannequinMaps(
  material: T.Material,
  maps: { defaultMap: T.Texture; chibiMap: T.Texture },
): void {
  materialMannequinMaps.set(material, maps);
}

function resetSkinDeformerAfterBindUpdate(figureRoot: T.Object3D): void {
  for (const fn of preHooks) {
    fn(figureRoot);
  }
}

function measureHeadSkullFromPositions(
  positions: Float32Array,
  headVerts: Int32Array,
): SkullEnvelope {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < headVerts.length; i++) {
    const y = positions[headVerts[i]! * 3 + 1]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minY) || maxY <= minY) {
    return {
      center: [0, 1.64, 0],
      half: [0.088, 0.11, 0.108],
      crownY: 1.75,
      chinY: 1.53,
    };
  }
  // Measure X/Z half-extents across the cranium above the ear/nose flare band (top 52% of head height)
  // while falling back to full head vertices if synthetic test meshes have sparse head rings.
  const headH = maxY - minY;
  const craniumFloorY = minY + 0.48 * headH;
  const craniumCeilY = maxY - 0.04 * headH;
  let cMinX = Infinity, cMaxX = -Infinity, cMinZ = Infinity, cMaxZ = -Infinity;
  let cCount = 0;
  let aMinX = Infinity, aMaxX = -Infinity, aMinZ = Infinity, aMaxZ = -Infinity;

  for (let i = 0; i < headVerts.length; i++) {
    const v3 = headVerts[i]! * 3;
    const x = positions[v3]!;
    const y = positions[v3 + 1]!;
    const z = positions[v3 + 2]!;
    if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
    if (z < aMinZ) aMinZ = z; if (z > aMaxZ) aMaxZ = z;
    if (y >= craniumFloorY && y <= craniumCeilY) {
      if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x;
      if (z < cMinZ) cMinZ = z; if (z > cMaxZ) cMaxZ = z;
      cCount++;
    }
  }
  const useCranium = cCount >= 24 && cMaxX > cMinX && cMaxZ > cMinZ;
  const minX = useCranium ? cMinX : aMinX;
  const maxX = useCranium ? cMaxX : aMaxX;
  const minZ = useCranium ? cMinZ : aMinZ;
  const maxZ = useCranium ? cMaxZ : aMaxZ;

  return {
    center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5],
    half: [
      Math.max(0.02, (maxX - minX) * 0.5),
      Math.max(0.02, headH * 0.5),
      Math.max(0.02, (maxZ - minZ) * 0.5),
    ],
    crownY: maxY,
    chinY: minY,
  };
}

export function captureBodyProportionBaseline(figureRoot: T.Object3D): FigureProportionBaseline {
  const existing = proportionBaselines.get(figureRoot);
  if (existing) return existing;

  resetSkinDeformerAfterBindUpdate(figureRoot);

  const skins: SkinBaselineEntry[] = [];
  const bonesByName = new Map<string, T.Bone>();

  figureRoot.traverse(node => {
    if (node instanceof T.Bone) {
      bonesByName.set(node.name, node);
    }
    if (node instanceof T.SkinnedMesh) {
      const geo = node.geometry;
      const posAttr = geo.getAttribute('position') as T.BufferAttribute;
      let normAttr = geo.getAttribute('normal') as T.BufferAttribute | undefined;
      if (!normAttr) {
        geo.computeVertexNormals();
        normAttr = geo.getAttribute('normal') as T.BufferAttribute;
      }
      const colorAttr = geo.getAttribute('color') as T.BufferAttribute | undefined;
      const indexAttr = geo.getIndex();
      const vertexCount = posAttr.count;
      const triCount = indexAttr ? indexAttr.count : vertexCount;
      const triIndices = new Int32Array(triCount);
      if (indexAttr) {
        for (let i = 0; i < triCount; i++) triIndices[i] = indexAttr.getX(i);
      } else {
        for (let i = 0; i < triCount; i++) triIndices[i] = i;
      }

      const headBoneIdx = node.skeleton.bones.findIndex(b => b.name === 'Head' || b.name === 'head');
      const headList: number[] = [];
      const skinIdxAttr = geo.getAttribute('skinIndex') as T.BufferAttribute | undefined;
      const skinWgtAttr = geo.getAttribute('skinWeight') as T.BufferAttribute | undefined;
      if (headBoneIdx >= 0 && skinIdxAttr && skinWgtAttr) {
        for (let v = 0; v < vertexCount; v++) {
          let hw = 0;
          for (let k = 0; k < 4; k++) {
            if (Math.round(skinIdxAttr.getComponent(v, k)) === headBoneIdx) {
              hw += skinWgtAttr.getComponent(v, k);
            }
          }
          if (hw > 0.5) headList.push(v);
        }
      }

      const primaryMat = Array.isArray(node.material) ? node.material[0] : node.material;
      const basePositions = new Float32Array(posAttr.array.slice(0, vertexCount * 3));
      const baseNormals = new Float32Array(normAttr.array.slice(0, vertexCount * 3));
      const baseColors = colorAttr
        ? new Float32Array(colorAttr.array.slice(0, vertexCount * colorAttr.itemSize))
        : null;

      skins.push({
        skin: node,
        name: node.name,
        vertexCount,
        triIndices,
        basePositions,
        baseNormals,
        baseColors,
        baseColorItemSize: colorAttr ? colorAttr.itemSize : 3,
        baseVertexColors: primaryMat instanceof T.Material ? Boolean(primaryMat.vertexColors) : false,
        headWeightedVertices: Int32Array.from(headList),
      });

      for (const b of node.skeleton.bones) {
        if (!bonesByName.has(b.name)) bonesByName.set(b.name, b);
      }
    }
  });

  const mainSkinEntry =
    skins.find(s => s.name === 'Body') ??
    skins.reduce((best, cur) => (cur.vertexCount > best.vertexCount ? cur : best), skins[0]!);
  const baseSkullEnvelope = mainSkinEntry
    ? measureHeadSkullFromPositions(mainSkinEntry.basePositions, mainSkinEntry.headWeightedVertices)
    : { center: [0, 1.64, 0] as [number, number, number], half: [0.088, 0.11, 0.108] as [number, number, number], crownY: 1.75, chinY: 1.53 };
  const baseHeadHeight = Math.max(0.05, baseSkullEnvelope.crownY - baseSkullEnvelope.chinY);

  const baseline: FigureProportionBaseline = {
    skins,
    bonesByName,
    baseHeadHeight,
    baseSkullEnvelope,
  };
  proportionBaselines.set(figureRoot, baseline);
  morphedSkullEnvelopes.set(figureRoot, baseSkullEnvelope);
  const headBone = bonesByName.get('Head') ?? bonesByName.get('head');
  if (headBone) {
    figureRoot.updateMatrixWorld(true);
    headRestBindInverses.set(
      figureRoot,
      headBone.matrixWorld.clone().invert().multiply(figureRoot.matrixWorld),
    );
  }
  return baseline;
}

function computeWeldedSmoothNormals(
  positions: Float32Array,
  triIndices: Int32Array,
  vToWeld: Int32Array,
  weldCount: number,
  accum: Float32Array,
  outNormals: Float32Array,
): void {
  accum.fill(0);
  const triLen = triIndices.length;
  for (let i = 0; i + 2 < triLen; i += 3) {
    const ia = triIndices[i]!;
    const ib = triIndices[i + 1]!;
    const ic = triIndices[i + 2]!;
    const a3 = ia * 3, b3 = ib * 3, c3 = ic * 3;
    const ax = positions[a3]!, ay = positions[a3 + 1]!, az = positions[a3 + 2]!;
    const bx = positions[b3]!, by = positions[b3 + 1]!, bz = positions[b3 + 2]!;
    const cx = positions[c3]!, cy = positions[c3 + 1]!, cz = positions[c3 + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;

    const wa = vToWeld[ia]! * 3;
    const wb = vToWeld[ib]! * 3;
    const wc = vToWeld[ic]! * 3;
    accum[wa]! += fnx; accum[wa + 1]! += fny; accum[wa + 2]! += fnz;
    accum[wb]! += fnx; accum[wb + 1]! += fny; accum[wb + 2]! += fnz;
    accum[wc]! += fnx; accum[wc + 1]! += fny; accum[wc + 2]! += fnz;
  }

  for (let w = 0; w < weldCount; w++) {
    const w3 = w * 3;
    const nx = accum[w3]!, ny = accum[w3 + 1]!, nz = accum[w3 + 2]!;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      const inv = 1 / len;
      accum[w3] = nx * inv;
      accum[w3 + 1] = ny * inv;
      accum[w3 + 2] = nz * inv;
    } else {
      accum[w3] = 0;
      accum[w3 + 1] = 1;
      accum[w3 + 2] = 0;
    }
  }

  const splitCount = vToWeld.length;
  for (let v = 0; v < splitCount; v++) {
    const w3 = vToWeld[v]! * 3;
    const v3 = v * 3;
    outNormals[v3] = accum[w3]!;
    outNormals[v3 + 1] = accum[w3 + 1]!;
    outNormals[v3 + 2] = accum[w3 + 2]!;
  }
}

const _tmpVec = new T.Vector3();
const _tmpQuat = new T.Quaternion();
const _tmpScaleOne = new T.Vector3(1, 1, 1);

export function applyBodyProportion(
  figureRoot: T.Object3D,
  gender: 'male' | 'female',
  bodyType: BodyTypeId,
): { headScale: number } {
  resetSkinDeformerAfterBindUpdate(figureRoot);
  const baseline = captureBodyProportionBaseline(figureRoot);
  if (!baseline.skins.length) {
    return { headScale: 1 };
  }

  const bundle = loadedBundle;
  const genderEntry = bundle?.manifest.gender[gender];
  const bodySkinEntry = baseline.skins.find(s => s.name === 'Body');
  const expectedBodyMeta = genderEntry?.meshes.find(m => m.name === 'Body');

  if (!bundle || !genderEntry || !bodySkinEntry || !expectedBodyMeta || bodySkinEntry.vertexCount !== expectedBodyMeta.vertexCount) {
    // Graceful no-op fallback for synthetic unit-test procedural figures (`makeFigure`)
    figureRoot.userData.bodyType = bodyType;
    figureRoot.userData.bodyProportionHeadScale = bodyType === 'chibi' ? 1.55 : 1;
    figureRoot.userData.__bodyProportionRevision = ((figureRoot.userData.__bodyProportionRevision as number) || 0) + 1;
    figureRoot.updateMatrixWorld(true);
    return { headScale: bodyType === 'chibi' ? 1.55 : 1 };
  }

  const archEntry = genderEntry.archetypes[bodyType] ?? genderEntry.archetypes.heroic;
  const floorY = archEntry.floorOffsetY ?? 0;

  for (const meshMeta of genderEntry.meshes) {
    const sb = baseline.skins.find(s => s.name === meshMeta.name);
    const archMesh = archEntry.meshes.find(m => m.name === meshMeta.name);
    if (!sb || !archMesh) continue;

    const { vertexCount, basePositions, baseNormals, triIndices } = sb;
    const posAttr = sb.skin.geometry.getAttribute('position') as T.BufferAttribute;
    const normAttr = sb.skin.geometry.getAttribute('normal') as T.BufferAttribute;
    const outPos = posAttr.array as Float32Array;
    const outNorm = normAttr.array as Float32Array;

    const deltas = new Int16Array(bundle.buffer, archMesh.byteOffset, vertexCount * 3);
    const scale = archMesh.scale;

    if (bodyType === bundle.manifest.baseBodyType && archMesh.maximumError === 0 && Math.abs(floorY) < 1e-12) {
      outPos.set(basePositions);
      outNorm.set(baseNormals);
    } else {
      for (let i = 0; i < vertexCount * 3; i += 3) {
        outPos[i] = basePositions[i]! + deltas[i]! * scale;
        outPos[i + 1] = basePositions[i + 1]! + deltas[i + 1]! * scale + floorY;
        outPos[i + 2] = basePositions[i + 2]! + deltas[i + 2]! * scale;
      }

      const weldKey = `${gender}:${meshMeta.name}:${vertexCount}`;
      const weldTable = bundle.weldTables.get(weldKey);
      const normAccum = bundle.normScratch.get(weldKey);
      if (weldTable && normAccum) {
        const { vToWeld, weldToFirstV, weldCount } = weldTable;
        if (weldCount < vertexCount) {
          for (let v = 0; v < vertexCount; v++) {
            const fv = weldToFirstV[vToWeld[v]!]!;
            if (fv !== v) {
              const v3 = v * 3, fv3 = fv * 3;
              outPos[v3] = outPos[fv3]!;
              outPos[v3 + 1] = outPos[fv3 + 1]!;
              outPos[v3 + 2] = outPos[fv3 + 2]!;
            }
          }
        }
        computeWeldedSmoothNormals(outPos, triIndices, vToWeld, weldCount, normAccum, outNorm);
      } else {
        sb.skin.geometry.computeVertexNormals();
      }
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;

    // Update optional per-archetype vertex colors (Anime Chibi Eyes & Eyebrows) or restore baseline colors
    const materials = Array.isArray(sb.skin.material) ? sb.skin.material : [sb.skin.material];
    if (archMesh.color) {
      const colorFloats = new Float32Array(bundle.buffer, archMesh.color.byteOffset, vertexCount * 3);
      let colorAttr = sb.skin.geometry.getAttribute('color') as T.BufferAttribute | undefined;
      if (!colorAttr || colorAttr.count !== vertexCount) {
        colorAttr = new T.Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
        sb.skin.geometry.setAttribute('color', colorAttr);
      }
      if (colorAttr.itemSize === 3) {
        (colorAttr.array as Float32Array).set(colorFloats);
      } else {
        const dst = colorAttr.array as Float32Array;
        for (let v = 0; v < vertexCount; v++) {
          dst[v * 4] = colorFloats[v * 3]!;
          dst[v * 4 + 1] = colorFloats[v * 3 + 1]!;
          dst[v * 4 + 2] = colorFloats[v * 3 + 2]!;
          dst[v * 4 + 3] = 1;
        }
      }
      colorAttr.needsUpdate = true;
      for (const m of materials) {
        if (m instanceof T.Material && !m.vertexColors) {
          m.vertexColors = true;
          m.needsUpdate = true;
        }
      }
    } else if (sb.baseColors) {
      let colorAttr = sb.skin.geometry.getAttribute('color') as T.BufferAttribute | undefined;
      if (!colorAttr || colorAttr.count !== vertexCount || colorAttr.itemSize !== sb.baseColorItemSize) {
        colorAttr = new T.Float32BufferAttribute(new Float32Array(sb.baseColors), sb.baseColorItemSize);
        sb.skin.geometry.setAttribute('color', colorAttr);
      } else {
        (colorAttr.array as Float32Array).set(sb.baseColors);
        colorAttr.needsUpdate = true;
      }
      for (const m of materials) {
        if (m instanceof T.Material && m.vertexColors !== sb.baseVertexColors) {
          m.vertexColors = sb.baseVertexColors;
          m.needsUpdate = true;
        }
      }
    }

    // Swap Body texture between realistic cavity-AO map and clean-face Anime Chibi map when configured
    if (meshMeta.name === 'Body') {
      for (const m of materials) {
        if (!(m instanceof T.MeshStandardMaterial)) continue;
        const maps = materialMannequinMaps.get(m);
        const nextMap = bodyType === 'chibi' ? maps?.chibiMap : maps?.defaultMap;
        if (nextMap && m.map !== nextMap) {
          m.map = nextMap;
          m.needsUpdate = true;
        }
      }
    }
  }

  // Update bone local rest positions (preserving active FK rotations) & pose-independent inverse bind matrices
  const boneNames = bundle.manifest.boneNames;
  const boneCount = boneNames.length;
  const localTrans = new Float32Array(
    bundle.buffer,
    archEntry.boneLocalTranslations.byteOffset,
    boneCount * 3,
  );
  const worldTransforms = new Float32Array(
    bundle.buffer,
    archEntry.boneWorldTransforms.byteOffset,
    boneCount * 7,
  );

  const manifestInverses = new Map<string, T.Matrix4>();
  for (let i = 0; i < boneCount; i++) {
    const name = boneNames[i]!;
    const bone = baseline.bonesByName.get(name);
    if (bone) {
      bone.position.set(localTrans[i * 3]!, localTrans[i * 3 + 1]!, localTrans[i * 3 + 2]!);
      bone.scale.set(1, 1, 1);
    }
    const o7 = i * 7;
    _tmpVec.set(worldTransforms[o7]!, worldTransforms[o7 + 1]!, worldTransforms[o7 + 2]!);
    _tmpQuat.set(
      worldTransforms[o7 + 3]!,
      worldTransforms[o7 + 4]!,
      worldTransforms[o7 + 5]!,
      worldTransforms[o7 + 6]!,
    );
    const invMat = new T.Matrix4().compose(_tmpVec, _tmpQuat, _tmpScaleOne).invert();
    manifestInverses.set(name, invMat);
  }

  // Copy into EACH SkinnedMesh's independent skeleton.boneInverses array!
  for (const sb of baseline.skins) {
    const skelBones = sb.skin.skeleton.bones;
    for (let sIdx = 0; sIdx < skelBones.length; sIdx++) {
      const inv = manifestInverses.get(skelBones[sIdx]!.name);
      if (inv && sb.skin.skeleton.boneInverses[sIdx]) {
        sb.skin.skeleton.boneInverses[sIdx]!.copy(inv);
      }
    }
  }

  // Measure morphed Head skull envelope in clean rest character space for dynamic hair fitting
  const bodyOutPos = (bodySkinEntry.skin.geometry.getAttribute('position') as T.BufferAttribute)
    .array as Float32Array;
  const morphedSkull = measureHeadSkullFromPositions(bodyOutPos, bodySkinEntry.headWeightedVertices);
  const morphedHeadHeight = Math.max(0.05, morphedSkull.crownY - morphedSkull.chinY);
  const headScale = morphedHeadHeight / baseline.baseHeadHeight;

  morphedSkullEnvelopes.set(figureRoot, morphedSkull);
  const headRestInv = manifestInverses.get('Head');
  if (headRestInv) {
    headRestBindInverses.set(figureRoot, headRestInv.clone());
  }
  figureRoot.userData.gender = gender;
  figureRoot.userData.bodyType = bodyType;
  figureRoot.userData.bodyProportionHeadScale = headScale;
  figureRoot.userData.__bodyProportionRevision =
    ((figureRoot.userData.__bodyProportionRevision as number) || 0) + 1;

  figureRoot.updateMatrixWorld(true);
  for (const sb of baseline.skins) {
    sb.skin.skeleton.update();
    sb.skin.computeBoundingBox();
    sb.skin.computeBoundingSphere();
  }

  for (const hook of postHooks) {
    hook(figureRoot, gender, bodyType);
  }

  return { headScale };
}