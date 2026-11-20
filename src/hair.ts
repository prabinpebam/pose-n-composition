import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_HAIR_COLOR, type Body } from './model';
import type { SkullEnvelope } from './bodyProportions';

export const HAIR_STYLES = ['parted', 'long', 'buns', 'buzz', 'partedBeard', 'none'] as const;
export type HairStyle = typeof HAIR_STYLES[number];

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  parted: 'Side parted',
  long: 'Long waves',
  buns: 'Twin buns',
  buzz: 'Short crop',
  partedBeard: 'Parted + beard',
  none: 'None (bald)',
};

export const defaultHairStyle = (body: Body): HairStyle => (body === 'female' ? 'long' : 'parted');

export type HairAssetId = 'SimpleParted' | 'Long' | 'Buns' | 'Buzzed' | 'BuzzedFemale' | 'Beard';

interface HairTemplate {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
  authoredBody: Body;
}

const ASSET_AUTHORED_BODY: Record<HairAssetId, Body> = {
  SimpleParted: 'male',
  Buzzed: 'male',
  Beard: 'male',
  Long: 'female',
  Buns: 'female',
  BuzzedFemale: 'female',
};

// Measured native skull envelopes in the authored Quaternius Hair_*.gltf coordinate frame
export const NATIVE_SKULL: Record<Body, SkullEnvelope> = {
  male: { center: [0, 1.7131, 0.00455], half: [0.0906, 0.097, 0.11065], crownY: 1.8101, chinY: 1.6161 },
  female: { center: [0, 1.65985, -0.0005], half: [0.0889, 0.10675, 0.1124], crownY: 1.7666, chinY: 1.5531 },
};

// Upper-cranium band envelopes (excluding protruding ears & nose tip) matching measureHeadSkullFromPositions
const NATIVE_CRANIUM: Record<Body, SkullEnvelope> = {
  male: { center: [0, 1.6933, -0.0066], half: [0.0740, 0.1168, 0.0995], crownY: 1.8101, chinY: 1.5766 },
  female: { center: [0, 1.6524, -0.0113], half: [0.0742, 0.1143, 0.1006], crownY: 1.7666, chinY: 1.5381 },
};

const templates = new Map<HairAssetId, HairTemplate>();
const normalizedMaps = new WeakSet<T.Texture>();
let loadingPromise: Promise<void> | null = null;

function normalizeHairAlbedoMap(texture: T.Texture | null): T.Texture | null {
  if (!texture || normalizedMaps.has(texture)) return texture;
  if (typeof document === 'undefined') return texture;
  const img = texture.image as { width?: number; height?: number } | undefined;
  if (!img || !img.width || !img.height) return texture;
  try {
    const w = Math.min(img.width, 1024), h = Math.min(img.height, 1024);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return texture;
    ctx.drawImage(texture.image as CanvasImageSource, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < px.length; i += 16) {
      const lum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      if (lum < lo) lo = lum;
      if (lum > hi) hi = lum;
    }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const lum = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
      const v = Math.round(158 + Math.min(1, Math.max(0, (lum - lo) / span)) * 97);
      px[i] = v; px[i + 1] = v; px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    const next = new T.CanvasTexture(canvas);
    next.colorSpace = T.SRGBColorSpace;
    next.flipY = texture.flipY;
    next.wrapS = texture.wrapS;
    next.wrapT = texture.wrapT;
    next.needsUpdate = true;
    normalizedMaps.add(next);
    return next;
  } catch {
    return texture;
  }
}

export function extractHairTemplateFromScene(id: HairAssetId, scene: T.Group): HairTemplate {
  scene.updateMatrixWorld(true);
  const parts: T.BufferGeometry[] = [];
  let sourceMat: T.MeshStandardMaterial | null = null;
  scene.traverse(node => {
    if (!(node instanceof T.Mesh)) return;
    const g = node.geometry.clone();
    g.applyMatrix4(node.matrixWorld);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    parts.push(g);
    const m = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!sourceMat && m instanceof T.MeshStandardMaterial) sourceMat = m;
  });
  if (!parts.length) throw new Error(`Hair asset ${id} contains no mesh geometry.`);
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) parts.forEach(p => p.dispose());
  if (!merged) throw new Error(`Could not merge geometry for hair asset ${id}.`);

  const mat = new T.MeshStandardMaterial({
    color: DEFAULT_HAIR_COLOR,
    roughness: 0.64,
    metalness: 0.02,
    side: T.DoubleSide,
  });
  if (sourceMat) {
    const sm = sourceMat as T.MeshStandardMaterial;
    mat.map = normalizeHairAlbedoMap(sm.map);
    mat.normalMap = sm.normalMap;
    if (mat.normalMap) mat.normalScale = new T.Vector2(1.05, 1.05);
  }
  return { geometry: merged, material: mat, authoredBody: ASSET_AUTHORED_BODY[id] };
}

export function registerHairTemplate(id: HairAssetId, scene: T.Group): void {
  templates.set(id, extractHairTemplateFromScene(id, scene));
}

export function hasHairTemplates(): boolean {
  return templates.size === Object.keys(ASSET_AUTHORED_BODY).length;
}

export function loadHairTemplates(baseUrl = import.meta.env.BASE_URL): Promise<void> {
  if (hasHairTemplates()) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  const manager = new T.LoadingManager();
  manager.setURLModifier(url =>
    /T_Hair_1_Normal\.png$/.test(url) ? url.replace(/T_Hair_1_Normal\.png$/, 'T_Hair_1_Normal_png.png') : url,
  );
  const loader = new GLTFLoader(manager);
  const ids = Object.keys(ASSET_AUTHORED_BODY) as HairAssetId[];
  loadingPromise = Promise.all(ids.map(async id => {
    if (templates.has(id)) return;
    const path = `${baseUrl}models/external/quaternius-universal-base/Hair_${id}.gltf`;
    const gltf = await loader.loadAsync(path);
    registerHairTemplate(id, gltf.scene);
  })).then(() => undefined).catch(err => {
    loadingPromise = null;
    throw new Error(`Could not load figure hair assets. ${err instanceof Error ? err.message : String(err)}`);
  });
  return loadingPromise;
}

function crossBodyMatrix(from: Body, to: Body): T.Matrix4 {
  if (from === to) return new T.Matrix4();
  const src = NATIVE_SKULL[from], dst = NATIVE_SKULL[to];
  const sx = dst.half[0] / src.half[0];
  const sy = 1.0;
  const sz = dst.half[2] / src.half[2];
  const m = new T.Matrix4();
  const toOrigin = new T.Matrix4().makeTranslation(-src.center[0], -src.crownY, -src.center[2]);
  const scale = new T.Matrix4().makeScale(sx, sy, sz);
  const toTarget = new T.Matrix4().makeTranslation(dst.center[0], dst.crownY, dst.center[2]);
  return m.multiply(toTarget).multiply(scale).multiply(toOrigin);
}

function cloneStandaloneHairGeometry(src: T.BufferGeometry): T.BufferGeometry {
  const dst = new T.BufferGeometry();
  if (src.index) {
    const idxArr = src.index.array;
    const copyIdx =
      idxArr instanceof Uint32Array ? new Uint32Array(idxArr) : new Uint16Array(idxArr as ArrayLike<number>);
    dst.setIndex(new T.BufferAttribute(copyIdx, 1, src.index.normalized));
  }
  for (const [name, attr] of Object.entries(src.attributes)) {
    const count = attr.count;
    const itemSize = attr.itemSize;
    if (attr instanceof T.InterleavedBufferAttribute) {
      const Ctor = attr.array.constructor as { new (length: number): T.TypedArray };
      const copy = new Ctor(count * itemSize);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < itemSize; k++) {
          copy[i * itemSize + k] = attr.getComponent(i, k);
        }
      }
      dst.setAttribute(name, new T.BufferAttribute(copy, itemSize, attr.normalized));
    } else {
      const Ctor = attr.array.constructor as { new (src: ArrayLike<number>): T.TypedArray };
      const copy = new Ctor(attr.array as unknown as ArrayLike<number>);
      dst.setAttribute(name, new T.BufferAttribute(copy, itemSize, attr.normalized));
    }
  }
  return dst;
}

function warpHairGeometryToTargetSkull(
  geometry: T.BufferGeometry,
  authoredBody: Body,
  targetSkull: SkullEnvelope,
): void {
  const src = NATIVE_CRANIUM[authoredBody];
  // Match upper-cranium band 1:1 (excluding ear/nose flare) with radial scalp clearance
  const sx = (targetSkull.half[0] / src.half[0]) * 1.07;
  const sz = (targetSkull.half[2] / src.half[2]) * 1.07;
  const syHead = targetSkull.half[1] / src.half[1];
  const isChibiScale = sx > 1.45;
  // On 2.5-head Anime Chibi, large eyes sit higher in the face than adult proportions: keep bangs slightly higher above the large iris/brows!
  const sy = syHead * (isChibiScale ? 0.87 : 1.02);
  const dstCrownY = targetSkull.crownY + (isChibiScale ? 0.008 : 0.004) * syHead;
  const jawDropSrc = src.half[1] * 1.48;

  // Inner scalp ellipsoid guard so deep center partings (e.g. Long waves on wide Chibi skull) never dip inside the scalp dome
  const domeCy = targetSkull.crownY - targetSkull.half[1] * 0.60;
  const domeRx = targetSkull.half[0] * 1.025;
  const domeRy = targetSkull.half[1] * 0.625;
  const domeRz = targetSkull.half[2] * 1.025;

  const pos = geometry.getAttribute('position') as T.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);
    const dx = x0 - src.center[0];
    const dz = z0 - src.center[2];
    const drop = src.crownY - y0;

    let x1: number;
    let y1: number;
    let z1: number;
    if (isChibiScale && drop > jawDropSrc) {
      const below = drop - jawDropSrc;
      const t = Math.min(1, below / 0.14);
      const smooth = t * t * (3 - 2 * t);
      const latFactor = 1 - 0.30 * smooth;
      x1 = targetSkull.center[0] + dx * sx * latFactor;
      y1 = dstCrownY - jawDropSrc * sy - below * sy * 0.48;
      z1 = targetSkull.center[2] + dz * sz * (1 - 0.18 * smooth);
    } else {
      x1 = targetSkull.center[0] + dx * sx;
      y1 = dstCrownY - drop * sy;
      z1 = targetSkull.center[2] + dz * sz;
    }

    // Upper-scalp dome anti-clipping pushout (excludes beard / lower neck hair)
    if (y1 > domeCy && drop < jawDropSrc * 0.92) {
      const nx = (x1 - targetSkull.center[0]) / domeRx;
      const ny = (y1 - domeCy) / domeRy;
      const nz = (z1 - targetSkull.center[2]) / domeRz;
      const rSq = nx * nx + ny * ny + nz * nz;
      if (rSq > 1e-6 && rSq < 1.0) {
        const invR = 1.0 / Math.sqrt(rSq);
        x1 = targetSkull.center[0] + nx * invR * domeRx;
        y1 = domeCy + ny * invR * domeRy;
        z1 = targetSkull.center[2] + nz * invR * domeRz;
      }
    }

    pos.setXYZ(i, x1, y1, z1);
  }
  pos.needsUpdate = true;
}

function assetsForStyle(body: Body, style: HairStyle): HairAssetId[] {
  switch (style) {
    case 'parted': return ['SimpleParted'];
    case 'long': return ['Long'];
    case 'buns': return ['Buns'];
    case 'buzz': return [body === 'female' ? 'BuzzedFemale' : 'Buzzed'];
    case 'partedBeard': return ['SimpleParted', 'Beard'];
    case 'none': return [];
  }
}

export function buildHairGeometryAndMaterial(
  body: Body,
  style: HairStyle,
  headFromNative: T.Matrix4,
  color: string,
  targetSkull?: SkullEnvelope,
): { geometry: T.BufferGeometry; material: T.MeshStandardMaterial; visible: boolean } | null {
  if (style === 'none') {
    const empty = new T.SphereGeometry(0.001, 4, 3);
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.02, side: T.DoubleSide });
    return { geometry: empty, material: mat, visible: false };
  }
  const ids = assetsForStyle(body, style);
  if (!ids.every(id => templates.has(id))) return null;

  const geos: T.BufferGeometry[] = [];
  let primaryTemplate: HairTemplate | null = null;
  for (const id of ids) {
    const tpl = templates.get(id)!;
    if (!primaryTemplate) primaryTemplate = tpl;
    const g = cloneStandaloneHairGeometry(tpl.geometry);
    if (targetSkull) {
      warpHairGeometryToTargetSkull(g, tpl.authoredBody, targetSkull);
      g.applyMatrix4(headFromNative);
      g.computeVertexNormals();
    } else {
      const xform = headFromNative.clone().multiply(crossBodyMatrix(tpl.authoredBody, body));
      g.applyMatrix4(xform);
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    geos.push(g);
  }
  const combined = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) geos.forEach(g => g.dispose());
  if (!combined || !primaryTemplate) return null;

  const material = primaryTemplate.material.clone();
  material.color.set(color);
  return { geometry: combined, material, visible: true };
}

export function prepareEyebrowMaterial(material: T.MeshStandardMaterial, color: string): void {
  if (material.map) {
    material.map = normalizeHairAlbedoMap(material.map);
  }
  material.color.set(color);
  material.roughness = 0.68;
  material.metalness = 0.02;
  material.needsUpdate = true;
}

// Sculpted procedural fallback used only when buildExternalFigure runs standalone without preloaded hair glTFs.
export function buildProceduralFallbackHair(
  body: Body,
  skin: T.SkinnedMesh,
  head: T.Bone,
  color: string,
): T.Mesh<T.BufferGeometry, T.MeshStandardMaterial> {
  skin.skeleton.update();
  const positions = skin.geometry.getAttribute('position');
  const joints = skin.geometry.getAttribute('skinIndex');
  const weights = skin.geometry.getAttribute('skinWeight');
  const headIndex = skin.skeleton.bones.indexOf(head);
  const headPts: T.Vector3[] = [];
  for (let i = 0; i < positions.count; i++) {
    let w = 0;
    for (let j = 0; j < 4; j++) if (joints.getComponent(i, j) === headIndex) w += weights.getComponent(i, j);
    if (w > 0.8) headPts.push(skin.getVertexPosition(i, new T.Vector3()).applyMatrix4(skin.matrixWorld));
  }
  const bounds = new T.Box3().setFromPoints(headPts);
  if (bounds.isEmpty()) throw new Error(`Cannot fit hair to the ${body} head geometry.`);
  const center = bounds.getCenter(new T.Vector3());
  const size = bounds.getSize(new T.Vector3());
  const female = body === 'female';
  const parts: T.BufferGeometry[] = [];
  const cap = new T.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, female ? Math.PI * 0.62 : Math.PI * 0.56);
  cap.scale(size.x * 0.54, size.y * 0.52, size.z * 0.54);
  cap.translate(center.x, bounds.max.y - size.y * 0.46, center.z - 0.006);
  parts.push(cap);
  const combined = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  if (!combined) throw new Error(`Could not assemble ${body} hair.`);
  const mesh = new T.Mesh(combined, new T.MeshStandardMaterial({ color, roughness: 0.66, side: T.DoubleSide }));
  mesh.name = 'Scalp hair';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  head.attach(mesh);
  return mesh;
}
