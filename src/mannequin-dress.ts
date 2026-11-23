import * as T from 'three';
import type { Body } from './model';
import type { Figure } from './rig';

export const MANNEQUIN_DRESS_PRESET_IDS = [
  'studio-briefs',
  'athletic-sportswear',
  'casual-tee-jeans',
  'fitted-bodysuit',
  'patterned-signature',
  'none',
] as const;

export type MannequinDressPresetId = (typeof MANNEQUIN_DRESS_PRESET_IDS)[number];

export const DEFAULT_MANNEQUIN_DRESS_ID: MannequinDressPresetId = 'studio-briefs';

export interface MannequinDressPresetMeta {
  id: MannequinDressPresetId;
  label: string;
  shortLabel: string;
  description: string;
  /** Whether `#ffffff` ("Original") is recommended to showcase multi-color patterns/denim without monochrome tinting. */
  recommendsOriginalColor: boolean;
}

export const MANNEQUIN_DRESS_PRESETS: readonly MannequinDressPresetMeta[] = [
  {
    id: 'studio-briefs',
    label: 'Studio Briefs / Active Two-Piece',
    shortLabel: 'Studio',
    description: 'Tailored studio briefs (Male) or scoop bralette & high-waist active briefs (Female) with flatlock seams.',
    recommendsOriginalColor: false,
  },
  {
    id: 'athletic-sportswear',
    label: 'Athletic Raglan / Crossover Set',
    shortLabel: 'Athletic',
    description: 'Raglan training tee & track shorts (Male) or crossover sports top & bike shorts (Female).',
    recommendsOriginalColor: true,
  },
  {
    id: 'casual-tee-jeans',
    label: 'Cotton Tee & Denim Jeans',
    shortLabel: 'Tee & Jeans',
    description: 'Crewneck cotton jersey tee with ribbed collar & twin-needle hems over dark indigo twill jeans.',
    recommendsOriginalColor: true,
  },
  {
    id: 'fitted-bodysuit',
    label: 'Rib-Knit Bodysuit / Camp Shirt',
    shortLabel: 'Rib / Linen',
    description: 'Open-collar woven linen shirt & chinos (Male) or fine rib-knit scoop bodysuit & tailored trousers (Female).',
    recommendsOriginalColor: true,
  },
  {
    id: 'patterned-signature',
    label: 'Rugger Polo / Botanical Wrap Dress',
    shortLabel: 'Patterned',
    description: 'Horizontal striped Rugger polo & chinos (Male) or DVF-inspired V-neck wrap dress & Breton stripe detail (Female).',
    recommendsOriginalColor: true,
  },
  {
    id: 'none',
    label: 'None (Anatomy Study)',
    shortLabel: 'None',
    description: 'Unclothed studio mannequin surface for pure anatomical proportion and muscle-flow study.',
    recommendsOriginalColor: false,
  },
];

export const AI_DRESS_PROMPT_GUIDE =
  'Paint a 2048x2048 RGBA outfit inside the LEFT (FRONT) and RIGHT (BACK) mannequin silhouettes of this template. Keep the background outside the garment transparent (alpha = 0), align Front and Back hem heights horizontally, and avoid painting above the collar guide onto the head/face.';

export interface MannequinDressShaderUniforms {
  uOutfitColor: { value: T.Color };
  uOutfitIsOriginal: { value: number };
  uDressMap: { value: T.Texture };
  uHasDressMap: { value: number };
  uDressEnabled: { value: number };
}

export interface DecodedPngInfo {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const EMPTY_DRESS_PIXEL = new Uint8Array([255, 255, 255, 0]);
let sharedEmptyDressTexture: T.DataTexture | null = null;

export function getEmptyDressTexture(): T.DataTexture {
  if (!sharedEmptyDressTexture) {
    sharedEmptyDressTexture = new T.DataTexture(EMPTY_DRESS_PIXEL, 1, 1, T.RGBAFormat, T.UnsignedByteType);
    sharedEmptyDressTexture.colorSpace = T.SRGBColorSpace;
    sharedEmptyDressTexture.needsUpdate = true;
  }
  return sharedEmptyDressTexture;
}

export function isMannequinDressPresetId(value: string): value is MannequinDressPresetId {
  return (MANNEQUIN_DRESS_PRESET_IDS as readonly string[]).includes(value);
}

export function getMannequinDressTemplateUrl(body: Body, baseUrl = import.meta.env.BASE_URL): string {
  const prefix = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${prefix}dress-templates/mannequin-${body}-dress-template.png`;
}

export function getMannequinPresetDressUrl(
  body: Body,
  presetId: MannequinDressPresetId,
  baseUrl = import.meta.env.BASE_URL,
): string | null {
  if (presetId === 'none') return null;
  const prefix = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${prefix}dress-maps/mannequin-${body}-${presetId}.png`;
}

export function downloadMannequinDressTemplate(body: Body, baseUrl = import.meta.env.BASE_URL): string {
  const url = getMannequinDressTemplateUrl(body, baseUrl);
  if (typeof document !== 'undefined') {
    const link = document.createElement('a');
    link.href = url;
    link.download = `mannequin-${body}-dress-template.png`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  return url;
}

function configureHighResDressTexture<Tex extends T.Texture>(tex: Tex): Tex {
  tex.colorSpace = T.SRGBColorSpace;
  tex.flipY = true;
  tex.premultiplyAlpha = false;
  tex.wrapS = T.ClampToEdgeWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

async function inflateBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    void writer.write(copy);
    void writer.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  const { inflateSync } = await import('node:zlib');
  const out = inflateSync(compressed);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Decodes an 8-bit RGB/RGBA PNG into raw RGBA bytes + exact `(width, height)` dimensions
 * (used for deterministic validation and headless/Node texture loading).
 */
export async function decodePngRgbaBytes(pngBytes: Uint8Array): Promise<DecodedPngInfo> {
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  if (pngBytes.byteLength < 33 || view.getUint32(0) !== 0x89504e47) {
    throw new Error('Invalid PNG header in dress image map.');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts: Uint8Array[] = [];
  let totalIdat = 0;
  let offset = 8;

  while (offset + 8 <= pngBytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      pngBytes[offset + 4]!,
      pngBytes[offset + 5]!,
      pngBytes[offset + 6]!,
      pngBytes[offset + 7]!,
    );
    const start = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = pngBytes[start + 8]!;
      colorType = pngBytes[start + 9]!;
    } else if (type === 'IDAT') {
      const slice = pngBytes.subarray(start, start + length);
      idatParts.push(slice);
      totalIdat += slice.byteLength;
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format (${width}x${height}, bitDepth=${bitDepth}, colorType=${colorType}).`);
  }

  const compressed = new Uint8Array(totalIdat);
  let pos = 0;
  for (const part of idatParts) {
    compressed.set(part, pos);
    pos += part.byteLength;
  }
  const raw = await inflateBytes(compressed);
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const stride = rowBytes + 1;
  const unfiltered = new Uint8Array(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride]!;
    const srcOff = y * stride + 1;
    const dstOff = y * rowBytes;
    const prevOff = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const byte = raw[srcOff + x]!;
      const a = x >= channels ? unfiltered[dstOff + x - channels]! : 0;
      const b = y > 0 ? unfiltered[prevOff + x]! : 0;
      const c = y > 0 && x >= channels ? unfiltered[prevOff + x - channels]! : 0;
      switch (filter) {
        case 0: unfiltered[dstOff + x] = byte; break;
        case 1: unfiltered[dstOff + x] = (byte + a) & 0xff; break;
        case 2: unfiltered[dstOff + x] = (byte + b) & 0xff; break;
        case 3: unfiltered[dstOff + x] = (byte + ((a + b) >> 1)) & 0xff; break;
        case 4: unfiltered[dstOff + x] = (byte + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`Unsupported PNG scanline filter ${filter}.`);
      }
    }
  }

  if (channels === 4) {
    return { width, height, rgba: unfiltered };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = unfiltered[i * 3]!;
    rgba[i * 4 + 1] = unfiltered[i * 3 + 1]!;
    rgba[i * 4 + 2] = unfiltered[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

const dressTextureCache = new Map<string, T.Texture>();
const dressTextureInflight = new Map<string, Promise<T.Texture>>();

function decodeBase64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Loads and caches a `2048x2048` (or arbitrary resolution) RGBA dress image map from a URL,
 * preset path, `blob:` URL, or `data:image/(png|jpeg|webp);base64,...` data URL.
 */
export async function loadMannequinDressTexture(urlOrDataUrl: string): Promise<T.Texture> {
  const cached = dressTextureCache.get(urlOrDataUrl);
  if (cached) return cached;
  const inflight = dressTextureInflight.get(urlOrDataUrl);
  if (inflight) return inflight;

  const task = (async (): Promise<T.Texture> => {
    const isBrowserDom = typeof window !== 'undefined' && typeof Image !== 'undefined';

    if (isBrowserDom) {
      const loader = new T.TextureLoader();
      const tex = await loader.loadAsync(urlOrDataUrl);
      configureHighResDressTexture(tex);
      dressTextureCache.set(urlOrDataUrl, tex);
      return tex;
    }

    // Headless / Vitest Node fallback: decode `data:image/png;base64,...` or local `public/` PNG directly
    let bytes: Uint8Array;
    if (urlOrDataUrl.startsWith('data:')) {
      const commaIdx = urlOrDataUrl.indexOf(',');
      if (commaIdx < 0) throw new Error('Malformed data URL for dress image map.');
      const meta = urlOrDataUrl.slice(0, commaIdx);
      const payload = urlOrDataUrl.slice(commaIdx + 1);
      bytes = meta.includes(';base64')
        ? decodeBase64ToBytes(payload)
        : new TextEncoder().encode(decodeURIComponent(payload));
    } else {
      const [{ readFile }, pathMod] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
      ]);
      const cleanRel = urlOrDataUrl.replace(/^\/+/, '');
      const fullPath = pathMod.resolve(process.cwd(), 'public', cleanRel);
      const buf = await readFile(fullPath);
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    const { width, height, rgba } = await decodePngRgbaBytes(bytes);
    const dataTex = new T.DataTexture(rgba, width, height, T.RGBAFormat, T.UnsignedByteType);
    configureHighResDressTexture(dataTex);
    dressTextureCache.set(urlOrDataUrl, dataTex);
    return dataTex;
  })();

  dressTextureInflight.set(urlOrDataUrl, task);
  try {
    return await task;
  } finally {
    dressTextureInflight.delete(urlOrDataUrl);
  }
}

export function getCachedMannequinDressTexture(urlOrDataUrl: string): T.Texture | undefined {
  return dressTextureCache.get(urlOrDataUrl);
}

export function preloadDefaultMannequinDressMaps(baseUrl = import.meta.env.BASE_URL): Promise<void> {
  return Promise.all(
    (['male', 'female'] as const).map(async body => {
      const defaultUrl = getMannequinPresetDressUrl(body, DEFAULT_MANNEQUIN_DRESS_ID, baseUrl);
      if (defaultUrl) await loadMannequinDressTexture(defaultUrl);
    }),
  ).then(() => undefined);
}

/**
 * Ensures the Mannequin's `Body` geometry exposes the `_pnc_dress` `VEC4` attribute
 * `(uFront, vPaper, frontness, eligibility)`. `Mannequin_Male.glb` and `Mannequin_Female.glb`
 * already ship with `_pnc_dress` baked in; this fallback also supports synthetic test meshes.
 */
export function ensureMannequinDressAttribute(skin: T.SkinnedMesh, body: Body): void {
  const geom = skin.geometry;
  if (geom.getAttribute('_pnc_dress')) return;
  const upper = geom.getAttribute('_PNC_DRESS');
  if (upper) {
    geom.setAttribute('_pnc_dress', upper);
    return;
  }

  const pos = geom.getAttribute('position');
  const nrm = geom.getAttribute('normal');
  if (!pos) return;
  const nominalH = body === 'male' ? 1.80 : 1.75;
  const scaleV = 0.91 / nominalH;
  const arr = new Float32Array(pos.count * 4);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nz = nrm ? nrm.getZ(i) : 1;
    const uFront = Math.min(0.488, Math.max(0.012, 0.25 + x * scaleV));
    const uIsland = nz < 0 ? 1.0 - uFront : uFront;
    const vPaper = Math.min(0.988, Math.max(0.012, 0.045 + y * scaleV));
    const elig = y > nominalH * 0.875 ? 0 : 1;
    arr[i * 4] = uIsland;
    arr[i * 4 + 1] = vPaper;
    arr[i * 4 + 2] = nz < 0 ? -1 : 1;
    arr[i * 4 + 3] = elig;
  }
  geom.setAttribute('_pnc_dress', new T.BufferAttribute(arr, 4));
}

function getFigureDressUniforms(figure: Figure): MannequinDressShaderUniforms[] {
  const list: MannequinDressShaderUniforms[] = [];
  for (const mat of figure.tintMaterials) {
    const u = mat.userData?.pncDressUniforms as MannequinDressShaderUniforms | undefined;
    if (u) list.push(u);
  }
  return list;
}

/**
 * Updates a Mannequin's `2048x2048` dress image map at 60fps without rebuilding its skeleton,
 * pose, body-proportion morphs, `skinColor`, or `outfitColor`.
 *
 * Accepts:
 * - `null` or `'none'` -> disables the dress map cleanly (unclothed anatomical study)
 * - Preset ID (`'studio-briefs'`, `'athletic-sportswear'`, `'casual-tee-jeans'`, `'fitted-bodysuit'`, `'patterned-signature'`)
 * - Custom image URL / `blob:` URL / `FileReader` `data:image/(png|jpeg|webp);base64,...` data URL
 * - A pre-built `THREE.Texture` instance
 */
export async function setFigureDressMap(
  figure: Figure,
  dressSource: MannequinDressPresetId | string | T.Texture | null,
  baseUrl = import.meta.env.BASE_URL,
  onApplied?: () => void,
): Promise<T.Texture | null> {
  const uniformsList = getFigureDressUniforms(figure);
  if (!uniformsList.length) return null;

  const body: Body = figure.body ?? ((figure.root.userData?.gender as Body | undefined) ?? 'female');
  ensureMannequinDressAttribute(figure.skin, body);

  const normalizedKey =
    dressSource === null || dressSource === 'none' || dressSource === ''
      ? 'none'
      : dressSource instanceof T.Texture
        ? dressSource
        : dressSource;

  if (
    figure.root.userData.__activeDressSource === normalizedKey &&
    figure.root.userData.__activeDressLoaded === true
  ) {
    return normalizedKey === 'none'
      ? null
      : normalizedKey instanceof T.Texture
        ? normalizedKey
        : (uniformsList[0]?.uDressMap.value ?? null);
  }

  const reqToken = ((figure.root.userData.__dressRequestToken as number | undefined) ?? 0) + 1;
  figure.root.userData.__dressRequestToken = reqToken;
  figure.root.userData.__activeDressSource = normalizedKey;
  figure.root.userData.__activeDressLoaded = false;

  if (normalizedKey === 'none') {
    figure.root.userData.dressMapId = 'none';
    figure.root.userData.__activeDressLoaded = true;
    for (const u of uniformsList) {
      u.uDressEnabled.value = 0;
    }
    onApplied?.();
    return null;
  }

  if (dressSource instanceof T.Texture) {
    configureHighResDressTexture(dressSource);
    figure.root.userData.dressMapId = 'custom-texture';
    figure.root.userData.__activeDressLoaded = true;
    for (const u of uniformsList) {
      u.uDressMap.value = dressSource;
      u.uHasDressMap.value = 1;
      u.uDressEnabled.value = 1;
    }
    onApplied?.();
    return dressSource;
  }

  const resolvedUrl = isMannequinDressPresetId(dressSource as string)
    ? getMannequinPresetDressUrl(body, dressSource as MannequinDressPresetId, baseUrl)
    : (dressSource as string);

  if (!resolvedUrl) {
    figure.root.userData.dressMapId = 'none';
    figure.root.userData.__activeDressLoaded = true;
    for (const u of uniformsList) {
      u.uDressEnabled.value = 0;
    }
    onApplied?.();
    return null;
  }

  figure.root.userData.dressMapId = dressSource;
  const cached = getCachedMannequinDressTexture(resolvedUrl);
  if (cached) {
    figure.root.userData.__activeDressLoaded = true;
    for (const u of uniformsList) {
      u.uDressMap.value = cached;
      u.uHasDressMap.value = 1;
      u.uDressEnabled.value = 1;
    }
    onApplied?.();
    return cached;
  }

  const loaded = await loadMannequinDressTexture(resolvedUrl);
  if (figure.root.userData.__dressRequestToken !== reqToken) {
    return loaded;
  }
  figure.root.userData.__activeDressLoaded = true;
  for (const u of uniformsList) {
    u.uDressMap.value = loaded;
    u.uHasDressMap.value = 1;
    u.uDressEnabled.value = 1;
  }
  onApplied?.();
  return loaded;
}

/**
 * Pure CPU reference evaluator matching the Mannequin paper-doll fragment shader,
 * useful for deterministic unit testing of `#ffffff` Original vs tinted `outfitColor` and `skinColor` blending.
 */
export function evaluateMannequinDressPixelLinear(
  skinLinear: readonly [number, number, number],
  dressSampleLinear: readonly [number, number, number, number],
  outfitColorLinear: readonly [number, number, number],
  isOriginalOutfit: boolean,
  dressEnabled: boolean,
  eligibility = 1,
): [number, number, number] {
  if (!dressEnabled || eligibility <= 0.001) {
    return [skinLinear[0], skinLinear[1], skinLinear[2]];
  }
  const alpha = Math.max(0, Math.min(1, dressSampleLinear[3] * eligibility));
  const lum = 0.2126 * dressSampleLinear[0] + 0.7152 * dressSampleLinear[1] + 0.0722 * dressSampleLinear[2];
  const scale = 0.36 + 0.98 * Math.pow(Math.max(lum, 1e-4), 0.86);
  const tintR = Math.max(0, Math.min(1, outfitColorLinear[0] * scale + (dressSampleLinear[0] - lum) * 0.46));
  const tintG = Math.max(0, Math.min(1, outfitColorLinear[1] * scale + (dressSampleLinear[1] - lum) * 0.46));
  const tintB = Math.max(0, Math.min(1, outfitColorLinear[2] * scale + (dressSampleLinear[2] - lum) * 0.46));

  const finalDressR = isOriginalOutfit ? dressSampleLinear[0] : tintR;
  const finalDressG = isOriginalOutfit ? dressSampleLinear[1] : tintG;
  const finalDressB = isOriginalOutfit ? dressSampleLinear[2] : tintB;

  const hemShadow = 1 - 0.065 * Math.sin(alpha * Math.PI);
  return [
    skinLinear[0] * hemShadow * (1 - alpha) + finalDressR * alpha,
    skinLinear[1] * hemShadow * (1 - alpha) + finalDressG * alpha,
    skinLinear[2] * hemShadow * (1 - alpha) + finalDressB * alpha,
  ];
}
