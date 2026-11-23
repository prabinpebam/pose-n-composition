import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { DEFAULT_HAIR_COLOR, defaultOutfitColor, JOINTS, neutralPose, type Body, type Joint } from './model';
import {
  buildHairGeometryAndMaterial,
  buildProceduralFallbackHair,
  defaultHairStyle,
  loadHairTemplates,
  prepareEyebrowMaterial,
  type HairStyle,
} from './hair';
import {
  captureBodyProportionBaseline,
  getFigureHeadRestBindInverse,
  getFigureMorphedBodyRestPositions,
  getFigureMorphedSkullEnvelope,
  loadMannequinArchetypeBundle,
  registerProportionPostHook,
  setMaterialMannequinMaps,
} from './bodyProportions';
import {
  buildMannequinFittedHair,
  loadMannequinHairBundle,
  MANNEQUIN_EXTENDED_HAIR_STYLES,
  type MannequinHairStyle,
} from './mannequin-hair';
import {
  AI_DRESS_PROMPT_GUIDE,
  DEFAULT_MANNEQUIN_DRESS_ID,
  downloadMannequinDressTemplate,
  ensureMannequinDressAttribute,
  getEmptyDressTexture,
  getMannequinDressTemplateUrl,
  getMannequinPresetDressUrl,
  MANNEQUIN_DRESS_PRESET_IDS,
  MANNEQUIN_DRESS_PRESETS,
  preloadDefaultMannequinDressMaps,
  setFigureDressMap,
  type MannequinDressPresetId,
  type MannequinDressShaderUniforms,
} from './mannequin-dress';
import { setFigurePose, type Figure } from './rig';
import {
  CHARACTERS,
  MODEL_IDS,
  defaultModelId,
  SOURCE_BONES,
  type ModelId,
  type SharedOutfitProfile,
} from './characterCatalog';
import { measureFigureMorphology, type MorphologyProfile } from './morphology-rig';
import { calibrateFigureHandRigs } from './hand-rig';
export {
  applyFigureHandPoses,
  calibrateFigureHandRigs,
  captureFkDragAnchor,
  computeAnchoredFkDragEuler,
  hasPoseableFingers,
  inspectorDegreesToPoseJoint,
  poseJointToInspectorDegrees,
  solveForearmWristTwistShare,
  type CalibratedFingerChain,
  type CalibratedFingerPhalange,
  type CalibratedHandRig,
  type CalibratedHandRigs,
  type FkDragAnchor,
} from './hand-rig';
export { SOURCE_BONES } from './characterCatalog';
export {
  AI_DRESS_PROMPT_GUIDE,
  DEFAULT_MANNEQUIN_DRESS_ID,
  downloadMannequinDressTemplate,
  getMannequinDressTemplateUrl,
  getMannequinPresetDressUrl,
  MANNEQUIN_DRESS_PRESET_IDS,
  MANNEQUIN_DRESS_PRESETS,
  MANNEQUIN_EXTENDED_HAIR_STYLES,
  setFigureDressMap,
  type MannequinDressPresetId,
  type MannequinHairStyle,
};

export interface NormalizedBodyOutfitResult {
  rgba: Uint8ClampedArray;
  skinMedianLum: number;
  outfitMedianLum: number;
  outfitCoverage: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function reverseSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (edge1 - x) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function medianOf(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length & 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) * 0.5;
}

export function buildNormalizedBodyOutfitRgba(
  baseRgba: ArrayLike<number>,
  width: number,
  height: number,
  roughnessRgba?: ArrayLike<number> | null,
): NormalizedBodyOutfitResult {
  const pixelCount = width * height;
  const hasRough = Boolean(roughnessRgba && roughnessRgba.length >= pixelCount * 4);
  const skinSamples: number[] = [];
  const nonOutfitSamples: number[] = [];
  const outfitSamples: number[] = [];
  const sampleStride = Math.max(1, Math.floor(pixelCount / 65536));

  for (let p = 0; p < pixelCount; p += sampleStride) {
    const o = p * 4;
    const r = baseRgba[o]!;
    const g = baseRgba[o + 1]!;
    const b = baseRgba[o + 2]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    const chroma = hi - lo;
    const roughG = hasRough ? roughnessRgba![o + 1]! : 255;

    if (chroma <= 12 && lum <= 75 && (!hasRough || roughG >= 225)) {
      outfitSamples.push(lum);
    } else {
      if (lum > 85) nonOutfitSamples.push(lum);
      if (chroma >= 45 && lum >= 95 && (!hasRough || roughG <= 205)) {
        skinSamples.push(lum);
      }
    }
  }

  const skinMedianLum = medianOf(skinSamples.length ? skinSamples : nonOutfitSamples, 129);
  const outfitMedianLum = medianOf(outfitSamples, 54);
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  let outfitSum = 0;

  for (let p = 0; p < pixelCount; p++) {
    const o = p * 4;
    const r = baseRgba[o]!;
    const g = baseRgba[o + 1]!;
    const b = baseRgba[o + 2]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    const chroma = hi - lo;
    const roughG = hasRough ? roughnessRgba![o + 1]! : 255;

    const wChroma = reverseSmoothstep(8, 42, chroma);
    const wLum = reverseSmoothstep(68, 102, lum);
    const wRough = hasRough ? smoothstep(200, 240, roughG) : 1;
    const mask = wChroma * wLum * wRough;
    outfitSum += mask;

    const baseLum = (1 - mask) * skinMedianLum + mask * outfitMedianLum;
    const ratio = lum / Math.max(1, baseLum);
    const mid = 244 * (1 - mask) + 230 * mask;
    const exp = 0.72 * (1 - mask) + 0.88 * mask;
    const minGray = 152 * (1 - mask) + 96 * mask;
    const gray = Math.min(255, Math.max(Math.round(minGray), Math.round(mid * Math.pow(Math.max(0.05, ratio), exp))));

    rgba[o] = gray;
    rgba[o + 1] = gray;
    rgba[o + 2] = gray;
    rgba[o + 3] = Math.round(mask * 255);
  }

  return {
    rgba,
    skinMedianLum,
    outfitMedianLum,
    outfitCoverage: pixelCount > 0 ? outfitSum / pixelCount : 0,
  };
}

const normalizedBodyMaps = new WeakMap<T.Texture, T.DataTexture>();
const alreadyNormalizedBodyMaps = new WeakSet<T.Texture>();

function normalizeBodyAlbedoAndOutfitMap(
  baseTexture: T.Texture | null,
  roughnessTexture: T.Texture | null,
): T.Texture | null {
  if (!baseTexture || alreadyNormalizedBodyMaps.has(baseTexture)) return baseTexture;
  const cached = normalizedBodyMaps.get(baseTexture);
  if (cached) return cached;
  if (typeof document === 'undefined') return baseTexture;
  const img = baseTexture.image as { width?: number; height?: number } | undefined;
  if (!img || !img.width || !img.height) return baseTexture;

  try {
    const w = Math.min(img.width, 2048);
    const h = Math.min(img.height, 2048);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return baseTexture;

    ctx.drawImage(baseTexture.image as CanvasImageSource, 0, 0, w, h);
    const baseData = ctx.getImageData(0, 0, w, h);

    let roughPixels: Uint8ClampedArray | null = null;
    const roughImg = roughnessTexture?.image as { width?: number; height?: number } | undefined;
    if (roughImg && roughImg.width && roughImg.height) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(roughnessTexture!.image as CanvasImageSource, 0, 0, w, h);
      roughPixels = ctx.getImageData(0, 0, w, h).data;
    }

    const { rgba } = buildNormalizedBodyOutfitRgba(baseData.data, w, h, roughPixels);
    // Use DataTexture (unpremultiplied RGBA) so Canvas2D never zeroes RGB where outfit mask alpha === 0.
    const next = new T.DataTexture(
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      w,
      h,
      T.RGBAFormat,
      T.UnsignedByteType,
    );
    next.colorSpace = T.SRGBColorSpace;
    next.flipY = baseTexture.flipY;
    next.premultiplyAlpha = false;
    next.wrapS = baseTexture.wrapS;
    next.wrapT = baseTexture.wrapT;
    next.generateMipmaps = true;
    next.minFilter = T.LinearMipmapLinearFilter;
    next.magFilter = T.LinearFilter;
    next.needsUpdate = true;

    normalizedBodyMaps.set(baseTexture, next);
    alreadyNormalizedBodyMaps.add(next);
    return next;
  } catch {
    return baseTexture;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function inflateZlibBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const chunk = new Uint8Array(compressed.byteLength);
    chunk.set(compressed);
    void writer.write(chunk);
    void writer.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(ab);
  }
  const { inflateSync } = await import('node:zlib');
  const out = inflateSync(compressed);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Decodes an 8-bit RGB/RGBA PNG directly into an unpremultiplied `THREE.DataTexture`
 * (`premultiplyAlpha = false`), bypassing Canvas2D so pixels with `alpha === 0` (skin mask)
 * preserve 100% of their cavity-AO grayscale RGB values.
 */
export async function decodeUnpremultipliedPngDataTexture(pngBytes: Uint8Array): Promise<T.DataTexture> {
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  if (pngBytes.byteLength < 33 || view.getUint32(0) !== 0x89504e47) {
    throw new Error('Invalid PNG header in mannequin outfit-mask texture.');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];
  let totalIdat = 0;
  let offset = 8;
  while (offset + 8 <= pngBytes.byteLength) {
    const length = view.getUint32(offset);
    const type =
      String.fromCharCode(pngBytes[offset + 4]!) +
      String.fromCharCode(pngBytes[offset + 5]!) +
      String.fromCharCode(pngBytes[offset + 6]!) +
      String.fromCharCode(pngBytes[offset + 7]!);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = pngBytes[dataStart + 8]!;
      colorType = pngBytes[dataStart + 9]!;
    } else if (type === 'IDAT') {
      const part = pngBytes.subarray(dataStart, dataStart + length);
      idatChunks.push(part);
      totalIdat += part.byteLength;
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format (${width}x${height}, depth=${bitDepth}, colorType=${colorType}).`);
  }
  const compressed = new Uint8Array(totalIdat);
  let writePos = 0;
  for (const part of idatChunks) {
    compressed.set(part, writePos);
    writePos += part.byteLength;
  }
  const raw = await inflateZlibBytes(compressed);
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
        case 4: unfiltered[dstOff + x] = (byte + paethPredictor(a, b, c)) & 0xff; break;
        default: throw new Error(`Unsupported PNG scanline filter ${filter}`);
      }
    }
  }

  let rgba: Uint8Array;
  if (channels === 4) {
    rgba = unfiltered;
  } else {
    rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4] = unfiltered[p * 3]!;
      rgba[p * 4 + 1] = unfiltered[p * 3 + 1]!;
      rgba[p * 4 + 2] = unfiltered[p * 3 + 2]!;
      rgba[p * 4 + 3] = 255;
    }
  }

  const tex = new T.DataTexture(rgba, width, height, T.RGBAFormat, T.UnsignedByteType);
  tex.colorSpace = T.SRGBColorSpace;
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  tex.wrapS = T.ClampToEdgeWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.userData.pncOutfitMask = true;
  tex.userData.skipAlbedoNormalization = true;
  tex.needsUpdate = true;
  alreadyNormalizedBodyMaps.add(tex);
  return tex;
}

export function configureSkinAndOutfitMaterial(
  material: T.MeshStandardMaterial,
  skinColor: string,
  outfitColor: string,
): { value: T.Color } {
  const skipNorm = Boolean(
    material.userData?.pncOutfitMask ||
    material.userData?.skipAlbedoNormalization ||
    material.map?.userData?.pncOutfitMask,
  );
  if (!skipNorm) {
    material.map = normalizeBodyAlbedoAndOutfitMap(material.map, material.roughnessMap);
  } else if (material.map) {
    material.map.premultiplyAlpha = false;
    material.map.colorSpace = T.SRGBColorSpace;
  }
  material.color.set(skinColor);
  material.vertexColors = false;
  material.transparent = false;
  material.roughness = material.roughnessMap ? 0.88 : 0.8;
  material.metalness = 0;

  const outfitUniform = { value: new T.Color(outfitColor) };
  const outfitIsOriginalUniform = { value: isOriginalOutfitHex(outfitColor) ? 1 : 0 };
  const dressUniforms: MannequinDressShaderUniforms = {
    uOutfitColor: outfitUniform,
    uOutfitIsOriginal: outfitIsOriginalUniform,
    uDressMap: { value: getEmptyDressTexture() },
    uHasDressMap: { value: 0 },
    uDressEnabled: { value: 1 },
  };
  material.userData.hasOutfitMask = true;
  material.userData.outfitColorUniform = outfitUniform;
  material.userData.pncOutfitIsOriginalUniform = outfitIsOriginalUniform;
  material.userData.pncDressUniforms = dressUniforms;
  material.customProgramCacheKey = () => 'pnc-body-skin-outfit-v3-split-dressmap';
  material.onBeforeCompile = shader => {
    shader.uniforms.uOutfitColor = dressUniforms.uOutfitColor;
    shader.uniforms.uOutfitIsOriginal = dressUniforms.uOutfitIsOriginal;
    shader.uniforms.uDressMap = dressUniforms.uDressMap;
    shader.uniforms.uHasDressMap = dressUniforms.uHasDressMap;
    shader.uniforms.uDressEnabled = dressUniforms.uDressEnabled;

    const hasRealVertex = shader.vertexShader.includes('#include <begin_vertex>');
    if (hasRealVertex) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 _pnc_dress;\nvarying vec4 vPncDress;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvPncDress = _pnc_dress;',
        );
    }

    const dressVaryingDecl = hasRealVertex
      ? 'varying vec4 vPncDress;'
      : 'const vec4 vPncDress = vec4( 0.25, 0.50, 1.0, 1.0 );';

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uOutfitColor;
uniform float uOutfitIsOriginal;
uniform sampler2D uDressMap;
uniform float uHasDressMap;
uniform float uDressEnabled;
${dressVaryingDecl}`,
      )
      .replace(
        '#include <map_fragment>',
        `float pncActiveDressAlpha = 0.0;
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	vec3 pncSkinRgb = sampledDiffuseColor.rgb * diffuse;
	if ( uDressEnabled < 0.5 ) {
		diffuseColor.rgb = pncSkinRgb;
	} else if ( uHasDressMap > 0.5 && vPncDress.w > 0.001 ) {
		vec2 pncDressUv = vec2( clamp( vPncDress.x, 0.001, 0.999 ), clamp( vPncDress.y, 0.001, 0.999 ) );
		vec4 pncDressSample = texture2D( uDressMap, pncDressUv );
		pncActiveDressAlpha = clamp( pncDressSample.a * vPncDress.w, 0.0, 1.0 );
		float pncDressLum = dot( pncDressSample.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		vec3 pncTintedDress = clamp(
			uOutfitColor * ( 0.36 + 0.98 * pow( max( pncDressLum, 0.0001 ), 0.86 ) ) +
			( pncDressSample.rgb - vec3( pncDressLum ) ) * 0.46,
			0.0,
			1.0
		);
		vec3 pncFinalDress = ( uOutfitIsOriginal > 0.5 ) ? pncDressSample.rgb : pncTintedDress;
		float pncHemShadow = 1.0 - 0.065 * sin( pncActiveDressAlpha * 3.14159265 );
		diffuseColor.rgb = mix( pncSkinRgb * pncHemShadow, pncFinalDress, pncActiveDressAlpha );
	} else {
		vec3 pncRegionTint = mix( diffuse, uOutfitColor, sampledDiffuseColor.a );
		diffuseColor.rgb = sampledDiffuseColor.rgb * pncRegionTint;
	}
#endif`,
      );

    if (shader.fragmentShader.includes('#include <roughnessmap_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.60, pncActiveDressAlpha * 0.65 );`,
      );
    }
  };
  material.needsUpdate = true;
  return outfitUniform;
}

export interface SkinAtlasAnalysis {
  refLinear: [number, number, number];
  hasDarkNonSkinIslands: boolean;
}

interface AuthoredSkinUniforms {
  uSkinAuthoredBase: { value: T.Color };
  uSkinRefColor: { value: T.Color };
  uSkinIsOriginal: { value: number };
  uSkinDarkLumaFloor: { value: number };
}

const AUTHORED_SKIN_REF_DEFAULTS: Partial<Record<ModelId, { refHex: string; darkIslands: boolean }>> = {
  'pseudonym-nightgown': { refHex: '#c19d83', darkIslands: false },
  'quaternius-superhero-male': { refHex: '#a97350', darkIslands: false },
  'quaternius-superhero-female': { refHex: '#aa7652', darkIslands: false },
  'local-bailarina': { refHex: '#ac7051', darkIslands: true },
  'local-stylized-women': { refHex: '#bf8d80', darkIslands: false },
  'local-base-mesh-female-with-rig-and-textures': { refHex: '#c0866b', darkIslands: false },
  'local-base-mesh-fat-male': { refHex: '#c99b85', darkIslands: false },
  'local-base-mesh-fat-female': { refHex: '#c1856a', darkIslands: false },
  'local-creepy-skinny-dancing-guy': { refHex: '#b38774', darkIslands: false },
  'local-fat-king': { refHex: '#986f57', darkIslands: false },
  'local-babar-azam-pakistans-star-cricketer': { refHex: '#b98568', darkIslands: false },
  'local-hotfemale-1': { refHex: '#d9ad8f', darkIslands: false },
};

const skinAtlasAnalysisCache = new WeakMap<object, SkinAtlasAnalysis>();

export function isOriginalSkinHex(hex: string): boolean {
  return hex.trim().toLowerCase() === '#ffffff';
}

export function isOriginalOutfitHex(hex: string): boolean {
  return hex.trim().toLowerCase() === '#ffffff';
}

export type SharedOutfitModeId = 0 | 1 | 2 | 3 | 4;

export const SHARED_OUTFIT_PROFILE_MODES: Readonly<Record<SharedOutfitProfile, 1 | 2 | 3 | 4>> = {
  'superhero-male': 1,
  'superhero-female': 2,
  'bailarina': 3,
  'stylized-women': 4,
};

const OUTFIT_MATERIAL_REF_DEFAULTS: Readonly<Record<string, string>> = {
  Luna_night_gown: '#d9d9d9',
  Bra: '#f77a9f',
  Underwear_Bottoms: '#e26b8d',
  Fit_shirts: '#576788',
  Slim_fit_pants: '#222222',
};

const SHARED_OUTFIT_REF_DEFAULTS: Readonly<Record<SharedOutfitProfile, string>> = {
  'superhero-male': '#353535',
  'superhero-female': '#363636',
  'bailarina': '#120d0b',
  'stylized-women': '#5a5c78',
};

export interface SharedOutfitShaderSpec {
  profile: SharedOutfitProfile;
  outfitColor: string;
  bindToRoot: T.Matrix4;
  bodyCenterX: number;
  bodyMinY: number;
  bodySpanY: number;
}

export interface AuthoredOutfitBinding {
  colorUniform: { value: T.Color };
  isOriginalUniform: { value: number };
}

function srgbToLinearChannel(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function analyzeSkinTextureRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): SkinAtlasAnalysis | null {
  const count = width * height;
  if (count <= 0 || rgba.length < count * 4) return null;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let darkCount = 0;
  const stride = Math.max(1, Math.floor(count / 4096));
  let sampledTotal = 0;

  for (let p = 0; p < count; p += stride) {
    const o = p * 4;
    if (rgba[o + 3]! < 32) continue;
    sampledTotal++;
    const r = rgba[o]! / 255;
    const g = rgba[o + 1]! / 255;
    const b = rgba[o + 2]! / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = (mx - mn) / Math.max(mx, 1e-4);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 0.165) darkCount++;
    if (
      r > g + 0.02 &&
      g >= b - 0.025 &&
      r > b + 0.045 &&
      sat >= 0.12 &&
      sat <= 0.70 &&
      lum >= 0.32 &&
      lum <= 0.93
    ) {
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }

  if (rs.length < 8) return null;
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = rs.length >> 1;
  return {
    refLinear: [
      srgbToLinearChannel(rs[mid]!),
      srgbToLinearChannel(gs[mid]!),
      srgbToLinearChannel(bs[mid]!),
    ],
    hasDarkNonSkinIslands: sampledTotal > 0 && darkCount / sampledTotal > 0.12,
  };
}

function defaultSkinAnalysisForModel(modelId: ModelId): SkinAtlasAnalysis {
  const presetRef = AUTHORED_SKIN_REF_DEFAULTS[modelId] ?? { refHex: '#b88468', darkIslands: false };
  const c = new T.Color(presetRef.refHex);
  return {
    refLinear: [c.r, c.g, c.b],
    hasDarkNonSkinIslands: presetRef.darkIslands,
  };
}

function analyzeMaterialSkinMap(texture: T.Texture | null, modelId: ModelId): SkinAtlasAnalysis {
  const fallback = defaultSkinAnalysisForModel(modelId);
  if (!texture || !texture.image) return fallback;
  const imgObj = texture.image as object;
  const cached = skinAtlasAnalysisCache.get(imgObj);
  if (cached) return cached;

  const rawImg = texture.image as { width?: number; height?: number; data?: Uint8Array | Uint8ClampedArray };
  if (rawImg.data && rawImg.width && rawImg.height && rawImg.width * rawImg.height > 1) {
    const analyzed = analyzeSkinTextureRgba(rawImg.data, rawImg.width, rawImg.height);
    if (analyzed) {
      skinAtlasAnalysisCache.set(imgObj, analyzed);
      return analyzed;
    }
  }

  if (typeof document !== 'undefined' && rawImg.width && rawImg.height && rawImg.width > 1 && rawImg.height > 1) {
    try {
      const sampleSize = 64;
      const canvas = document.createElement('canvas');
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(texture.image as CanvasImageSource, 0, 0, sampleSize, sampleSize);
        const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
        const analyzed = analyzeSkinTextureRgba(pixels, sampleSize, sampleSize);
        if (analyzed) {
          skinAtlasAnalysisCache.set(imgObj, analyzed);
          return analyzed;
        }
      }
    } catch {
      // Fall back to calibrated model reference when canvas extraction is unavailable.
    }
  }

  return fallback;
}

export function evaluateNormalizedSkinToneLinear(
  origLinear: readonly [number, number, number],
  refLinear: readonly [number, number, number],
  targetLinear: readonly [number, number, number],
  isOriginal: boolean,
  hasDarkNonSkinIslands = false,
): [number, number, number] {
  if (isOriginal) {
    return [origLinear[0], origLinear[1], origLinear[2]];
  }

  const pr = Math.pow(Math.max(origLinear[0], 0), 1 / 2.2);
  const pg = Math.pow(Math.max(origLinear[1], 0), 1 / 2.2);
  const pb = Math.pow(Math.max(origLinear[2], 0), 1 / 2.2);
  const mx = Math.max(pr, pg, pb);
  const mn = Math.min(pr, pg, pb);
  const sat = (mx - mn) / Math.max(mx, 1e-4);
  const plum = 0.299 * pr + 0.587 * pg + 0.114 * pb;

  const hiWhite = glslSmoothstep(0.62, 0.74, plum);
  const satLo = 0.045 + (0.145 - 0.045) * hiWhite;
  const satHi = 0.095 + (0.195 - 0.095) * hiWhite;
  const wSat = glslSmoothstep(satLo, satHi, sat) * (1 - glslSmoothstep(0.70, 0.82, sat));
  const wWarmRb = glslSmoothstep(0.018, 0.055, pr - pb);
  const wNotPink = glslSmoothstep(-0.065, -0.025, pg - pb);
  const hueRatioGb = (pg - pb) / Math.max(pr - pb, 1e-4);
  const wNotGold = 1 - glslSmoothstep(0.68, 0.80, hueRatioGb) * glslSmoothstep(0.32, 0.45, sat);

  const prefR = Math.pow(Math.max(refLinear[0], 0), 1 / 2.2);
  const prefG = Math.pow(Math.max(refLinear[1], 0), 1 / 2.2);
  const prefB = Math.pow(Math.max(refLinear[2], 0), 1 / 2.2);
  const prefLum = 0.299 * prefR + 0.587 * prefG + 0.114 * prefB;
  const darkFloor = hasDarkNonSkinIslands ? 1 : 0;
  const lumaLo = 0.06 + (prefLum * 0.34 - 0.06) * darkFloor;
  const lumaHi = 0.14 + (prefLum * 0.50 - 0.14) * darkFloor;
  const wLuma = glslSmoothstep(lumaLo, lumaHi, plum) * (1 - glslSmoothstep(0.94, 0.99, plum));
  const skinMask = wSat * wWarmRb * wNotPink * wNotGold * wLuma;

  const lTex = 0.2126 * origLinear[0] + 0.7152 * origLinear[1] + 0.0722 * origLinear[2];
  const lRef = Math.max(0.2126 * refLinear[0] + 0.7152 * refLinear[1] + 0.0722 * refLinear[2], 0.02);
  const lTgt = Math.max(0.2126 * targetLinear[0] + 0.7152 * targetLinear[1] + 0.0722 * targetLinear[2], 0.005);

  const ratio = lTex / lRef;
  const gamma = lTgt > lRef ? 0.82 : 0.92;
  const shadedRatio = Math.pow(Math.max(ratio, 1e-4), gamma);

  const denomTex = Math.max(lTex, 0.015);
  const dR = Math.max(-0.35, Math.min(0.35, origLinear[0] / denomTex - refLinear[0] / lRef));
  const dG = Math.max(-0.35, Math.min(0.35, origLinear[1] / denomTex - refLinear[1] / lRef));
  const dB = Math.max(-0.35, Math.min(0.35, origLinear[2] / denomTex - refLinear[2] / lRef));

  let recR = Math.max(0, targetLinear[0] * shadedRatio + dR * lTgt * 0.28);
  let recG = Math.max(0, targetLinear[1] * shadedRatio + dG * lTgt * 0.28);
  let recB = Math.max(0, targetLinear[2] * shadedRatio + dB * lTgt * 0.28);

  const maxC = Math.max(recR, recG, recB);
  if (maxC > 1) {
    const over = Math.max(0, Math.min(0.65, (maxC - 1) / (maxC + 0.35))) * 0.35;
    recR = Math.min(recR, 1) * (1 - over) + over;
    recG = Math.min(recG, 1) * (1 - over) + over;
    recB = Math.min(recB, 1) * (1 - over) + over;
  }

  recR = Math.max(0, Math.min(1, recR));
  recG = Math.max(0, Math.min(1, recG));
  recB = Math.max(0, Math.min(1, recB));

  return [
    origLinear[0] * (1 - skinMask) + recR * skinMask,
    origLinear[1] * (1 - skinMask) + recG * skinMask,
    origLinear[2] * (1 - skinMask) + recB * skinMask,
  ];
}

export function evaluateNormalizedSkinToneSrgb(
  origSrgb255: readonly [number, number, number],
  refSrgbHex: string,
  targetHex: string,
  hasDarkNonSkinIslands = false,
): [number, number, number] {
  const origLin: [number, number, number] = [
    srgbToLinearChannel(origSrgb255[0] / 255),
    srgbToLinearChannel(origSrgb255[1] / 255),
    srgbToLinearChannel(origSrgb255[2] / 255),
  ];
  const refColor = new T.Color(refSrgbHex);
  const tgtColor = new T.Color(targetHex);
  const outLin = evaluateNormalizedSkinToneLinear(
    origLin,
    [refColor.r, refColor.g, refColor.b],
    [tgtColor.r, tgtColor.g, tgtColor.b],
    isOriginalSkinHex(targetHex),
    hasDarkNonSkinIslands,
  );
  return [
    linearToSrgbChannel(outLin[0]) * 255,
    linearToSrgbChannel(outLin[1]) * 255,
    linearToSrgbChannel(outLin[2]) * 255,
  ];
}

const outfitAtlasAnalysisCache = new WeakMap<object, [number, number, number]>();

export function analyzeOutfitTextureRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] | null {
  const count = width * height;
  if (count <= 0 || rgba.length < count * 4) return null;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const stride = Math.max(1, Math.floor(count / 4096));
  for (let p = 0; p < count; p += stride) {
    const idx = p * 4;
    const a = rgba[idx + 3]!;
    if (a < 96) continue;
    const r = rgba[idx]! / 255;
    const g = rgba[idx + 1]! / 255;
    const b = rgba[idx + 2]! / 255;
    // Skip pure black UV gutter padding (`rgb == 0`) unless texture has non-zero fabric luma
    if (r + g + b < 0.015) continue;
    rs.push(srgbToLinearChannel(r));
    gs.push(srgbToLinearChannel(g));
    bs.push(srgbToLinearChannel(b));
  }
  if (rs.length < 16) return null;
  rs.sort((x, y) => x - y);
  gs.sort((x, y) => x - y);
  bs.sort((x, y) => x - y);
  const mid = rs.length >> 1;
  return [rs[mid]!, gs[mid]!, bs[mid]!];
}

function resolveOutfitMaterialRefLinear(material: T.MeshStandardMaterial): [number, number, number] {
  const presetHex = OUTFIT_MATERIAL_REF_DEFAULTS[material.name];
  if (presetHex) {
    const c = new T.Color(presetHex);
    return [c.r, c.g, c.b];
  }
  const texture = material.map;
  if (texture?.image) {
    const imgObj = texture.image as object;
    const cached = outfitAtlasAnalysisCache.get(imgObj);
    if (cached) return cached;
    const rawImg = texture.image as { width?: number; height?: number; data?: Uint8Array | Uint8ClampedArray };
    if (rawImg.data && rawImg.width && rawImg.height && rawImg.width * rawImg.height > 1) {
      const analyzed = analyzeOutfitTextureRgba(rawImg.data, rawImg.width, rawImg.height);
      if (analyzed) {
        outfitAtlasAnalysisCache.set(imgObj, analyzed);
        return analyzed;
      }
    }
    if (typeof document !== 'undefined' && rawImg.width && rawImg.height && rawImg.width > 1 && rawImg.height > 1) {
      try {
        const sampleSize = 64;
        const canvas = document.createElement('canvas');
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(texture.image as CanvasImageSource, 0, 0, sampleSize, sampleSize);
          const analyzed = analyzeOutfitTextureRgba(
            ctx.getImageData(0, 0, sampleSize, sampleSize).data,
            sampleSize,
            sampleSize,
          );
          if (analyzed) {
            outfitAtlasAnalysisCache.set(imgObj, analyzed);
            return analyzed;
          }
        }
      } catch {
        // Fall back to neutral midtone reference.
      }
    }
  }
  const fallback = new T.Color('#808080');
  return [fallback.r, fallback.g, fallback.b];
}

export function evaluateNormalizedOutfitColorLinear(
  origLinear: readonly [number, number, number],
  refLinear: readonly [number, number, number],
  targetLinear: readonly [number, number, number],
  isOriginal: boolean,
): [number, number, number] {
  if (isOriginal) {
    return [origLinear[0], origLinear[1], origLinear[2]];
  }
  const lTex = Math.max(0.2126 * origLinear[0] + 0.7152 * origLinear[1] + 0.0722 * origLinear[2], 0);
  const lRef = Math.max(0.2126 * refLinear[0] + 0.7152 * refLinear[1] + 0.0722 * refLinear[2], 0);
  const lTgt = Math.max(0.2126 * targetLinear[0] + 0.7152 * targetLinear[1] + 0.0722 * targetLinear[2], 0.0005);

  const pTex = Math.pow(lTex, 1 / 2.2);
  const pRef = Math.max(Math.pow(lRef, 1 / 2.2), 0.045);
  const pTgt = Math.max(0.04, Math.min(1, Math.pow(lTgt, 1 / 2.2)));

  // Smooth dark-fabric cushion so jet-black lace/pants (`pRef ~ 0.05..0.18`) lift cleanly into
  // pastels/ivory without crushing creases, while mid/light fabrics keep full dynamic contrast.
  const cushion = 0.12 * (1 - glslSmoothstep(0.05, 0.22, pRef));
  const pRatio = (pTex + cushion) / (pRef + cushion);
  const gamma = pTgt > pRef ? 0.85 : 1.02;
  const pOut = Math.max(0, pTgt * Math.pow(Math.max(pRatio, 0.02), gamma));
  const linearScale = Math.pow(pOut, 2.2) / lTgt;

  let recR = Math.max(0, targetLinear[0] * linearScale);
  let recG = Math.max(0, targetLinear[1] * linearScale);
  let recB = Math.max(0, targetLinear[2] * linearScale);

  const maxC = Math.max(recR, recG, recB);
  if (maxC > 1) {
    const over = Math.max(0, Math.min(0.7, (maxC - 1) / (maxC + 0.4))) * 0.4;
    recR = Math.min(recR, 1) * (1 - over) + over;
    recG = Math.min(recG, 1) * (1 - over) + over;
    recB = Math.min(recB, 1) * (1 - over) + over;
  }

  return [
    Math.max(0, Math.min(1, recR)),
    Math.max(0, Math.min(1, recG)),
    Math.max(0, Math.min(1, recB)),
  ];
}

export function evaluateNormalizedOutfitColorSrgb(
  origSrgb255: readonly [number, number, number],
  refSrgbHex: string,
  targetHex: string,
): [number, number, number] {
  const origLin: [number, number, number] = [
    srgbToLinearChannel(origSrgb255[0] / 255),
    srgbToLinearChannel(origSrgb255[1] / 255),
    srgbToLinearChannel(origSrgb255[2] / 255),
  ];
  const refColor = new T.Color(refSrgbHex);
  const tgtColor = new T.Color(targetHex);
  const outLin = evaluateNormalizedOutfitColorLinear(
    origLin,
    [refColor.r, refColor.g, refColor.b],
    [tgtColor.r, tgtColor.g, tgtColor.b],
    isOriginalOutfitHex(targetHex),
  );
  return [
    linearToSrgbChannel(outLin[0]) * 255,
    linearToSrgbChannel(outLin[1]) * 255,
    linearToSrgbChannel(outLin[2]) * 255,
  ];
}

export function evaluateSharedAtlasOutfitMaskLinear(
  origLinear: readonly [number, number, number],
  bindNorm: readonly [number, number],
  mode: SharedOutfitModeId,
): number {
  if (mode === 0) return 0;
  const xAbs = bindNorm[0];
  const yNorm = bindNorm[1];
  const pr = Math.pow(Math.max(origLinear[0], 0), 1 / 2.2);
  const pg = Math.pow(Math.max(origLinear[1], 0), 1 / 2.2);
  const pb = Math.pow(Math.max(origLinear[2], 0), 1 / 2.2);
  const mx = Math.max(pr, pg, pb);
  const mn = Math.min(pr, pg, pb);
  const sat = (mx - mn) / Math.max(mx, 1e-4);
  const plum = 0.299 * pr + 0.587 * pg + 0.114 * pb;

  if (mode === 1) {
    // Superhero Male: charcoal briefs
    const wY = glslSmoothstep(0.42, 0.435, yNorm) * (1 - glslSmoothstep(0.61, 0.625, yNorm));
    const wX = 1 - glslSmoothstep(0.132, 0.145, xAbs);
    const wCol = (1 - glslSmoothstep(0.34, 0.42, plum)) * (1 - glslSmoothstep(0.05, 0.12, pr - pb));
    return wY * wX * wCol;
  }
  if (mode === 2) {
    // Superhero Female: charcoal sports bra + briefs
    const wBra = glslSmoothstep(0.675, 0.69, yNorm) * (1 - glslSmoothstep(0.81, 0.825, yNorm));
    const wBriefs = glslSmoothstep(0.42, 0.435, yNorm) * (1 - glslSmoothstep(0.61, 0.625, yNorm));
    const wX = 1 - glslSmoothstep(0.132, 0.145, xAbs);
    const wCol = (1 - glslSmoothstep(0.34, 0.42, plum)) * (1 - glslSmoothstep(0.05, 0.12, pr - pb));
    return Math.max(wBra, wBriefs) * wX * wCol;
  }
  if (mode === 3) {
    // Bailarina: black lace/mesh bra, briefs, garters, fishnet stockings & heels below neck (`yNorm <= 0.805`)
    const wY = 1 - glslSmoothstep(0.795, 0.812, yNorm);
    const wX = 1 - glslSmoothstep(0.148, 0.165, xAbs);
    const wDark = 1 - glslSmoothstep(0.26, 0.32, plum);
    const wTrim = (1 - glslSmoothstep(0.075, 0.125, pr - pb)) * (1 - glslSmoothstep(0.52, 0.62, plum));
    return wY * wX * Math.max(wDark, wTrim);
  }
  // mode === 4 — Stylized Women: navy/gold/white two-piece bikini + halter straps + hip bows
  const wTop =
    glslSmoothstep(0.65, 0.665, yNorm) *
    (1 - glslSmoothstep(0.815, 0.83, yNorm)) *
    (1 - glslSmoothstep(0.115, 0.128, xAbs));
  const wBot =
    glslSmoothstep(0.42, 0.435, yNorm) *
    (1 - glslSmoothstep(0.60, 0.615, yNorm)) *
    (1 - glslSmoothstep(0.168, 0.182, xAbs));
  const wSpatial = Math.max(wTop, wBot);
  const wNavy = (1 - glslSmoothstep(-0.01, 0.05, pr - pb)) * (1 - glslSmoothstep(0.55, 0.68, plum));
  const wGold = glslSmoothstep(0.09, 0.135, pg - pb) * glslSmoothstep(0.24, 0.32, sat);
  const wStrapBow = (1 - glslSmoothstep(0.075, 0.115, pr - pb)) * (1 - glslSmoothstep(0.12, 0.18, sat));
  const wDarkTie = 1 - glslSmoothstep(0.30, 0.38, plum);
  return wSpatial * Math.max(Math.max(wNavy, wDarkTie), Math.max(wGold, wStrapBow));
}

export function evaluateSharedAtlasCharacterSrgb(
  origSrgb255: readonly [number, number, number],
  skinRefHex: string,
  skinTargetHex: string,
  outfitRefHex: string,
  outfitTargetHex: string,
  bindNorm: readonly [number, number],
  profile: SharedOutfitProfile,
  hasDarkNonSkinIslands = false,
): [number, number, number] {
  const origLin: [number, number, number] = [
    srgbToLinearChannel(origSrgb255[0] / 255),
    srgbToLinearChannel(origSrgb255[1] / 255),
    srgbToLinearChannel(origSrgb255[2] / 255),
  ];
  const skinRef = new T.Color(skinRefHex);
  const skinTgt = new T.Color(skinTargetHex);
  const outfitRef = new T.Color(outfitRefHex);
  const outfitTgt = new T.Color(outfitTargetHex);
  const outfitMask = evaluateSharedAtlasOutfitMaskLinear(
    origLin,
    bindNorm,
    SHARED_OUTFIT_PROFILE_MODES[profile],
  );
  const skinLin = evaluateNormalizedSkinToneLinear(
    origLin,
    [skinRef.r, skinRef.g, skinRef.b],
    [skinTgt.r, skinTgt.g, skinTgt.b],
    isOriginalSkinHex(skinTargetHex),
    hasDarkNonSkinIslands,
  );
  const outfitLin = evaluateNormalizedOutfitColorLinear(
    origLin,
    [outfitRef.r, outfitRef.g, outfitRef.b],
    [outfitTgt.r, outfitTgt.g, outfitTgt.b],
    isOriginalOutfitHex(outfitTargetHex),
  );
  return [
    linearToSrgbChannel(skinLin[0] * (1 - outfitMask) + outfitLin[0] * outfitMask) * 255,
    linearToSrgbChannel(skinLin[1] * (1 - outfitMask) + outfitLin[1] * outfitMask) * 255,
    linearToSrgbChannel(skinLin[2] * (1 - outfitMask) + outfitLin[2] * outfitMask) * 255,
  ];
}

const GLSL_NORMALIZED_OUTFIT_FN = `
vec3 pncEvaluateNormalizedOutfitColor( vec3 origLin, vec3 refLin, vec3 targetLin, float isOriginal ) {
	if ( isOriginal > 0.5 ) {
		return origLin;
	}
	float lTex = max( dot( origLin, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0 );
	float lRef = max( dot( refLin, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0 );
	float lTgt = max( dot( targetLin, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0005 );

	float pTex = pow( lTex, 1.0 / 2.2 );
	float pRef = max( pow( lRef, 1.0 / 2.2 ), 0.045 );
	float pTgt = clamp( pow( lTgt, 1.0 / 2.2 ), 0.04, 1.0 );

	float cushion = 0.12 * ( 1.0 - smoothstep( 0.05, 0.22, pRef ) );
	float pRatio = ( pTex + cushion ) / ( pRef + cushion );
	float gamma = ( pTgt > pRef ) ? 0.85 : 1.02;
	float pOut = max( pTgt * pow( max( pRatio, 0.02 ), gamma ), 0.0 );
	float linearScale = pow( pOut, 2.2 ) / lTgt;

	vec3 recolored = max( targetLin * linearScale, vec3( 0.0 ) );
	float maxC = max( max( recolored.r, recolored.g ), recolored.b );
	if ( maxC > 1.0 ) {
		float over = clamp( ( maxC - 1.0 ) / ( maxC + 0.40 ), 0.0, 0.70 ) * 0.40;
		recolored = mix( min( recolored, vec3( 1.0 ) ), vec3( 1.0 ), over );
	}
	return clamp( recolored, 0.0, 1.0 );
}`;

const GLSL_SHARED_OUTFIT_MASK_FN = `
float pncEvaluateSharedOutfitMask( vec3 origLin, vec2 bindNorm, int mode ) {
	if ( mode == 0 ) return 0.0;
	float xAbs = bindNorm.x;
	float yNorm = bindNorm.y;
	vec3 p = pow( max( origLin, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
	float mx = max( max( p.r, p.g ), p.b );
	float mn = min( min( p.r, p.g ), p.b );
	float sat = ( mx - mn ) / max( mx, 0.0001 );
	float plum = dot( p, vec3( 0.299, 0.587, 0.114 ) );

	if ( mode == 1 ) {
		float wY = smoothstep( 0.42, 0.435, yNorm ) * ( 1.0 - smoothstep( 0.61, 0.625, yNorm ) );
		float wX = 1.0 - smoothstep( 0.132, 0.145, xAbs );
		float wCol = ( 1.0 - smoothstep( 0.34, 0.42, plum ) ) * ( 1.0 - smoothstep( 0.05, 0.12, p.r - p.b ) );
		return wY * wX * wCol;
	}
	if ( mode == 2 ) {
		float wBra = smoothstep( 0.675, 0.69, yNorm ) * ( 1.0 - smoothstep( 0.81, 0.825, yNorm ) );
		float wBriefs = smoothstep( 0.42, 0.435, yNorm ) * ( 1.0 - smoothstep( 0.61, 0.625, yNorm ) );
		float wX = 1.0 - smoothstep( 0.132, 0.145, xAbs );
		float wCol = ( 1.0 - smoothstep( 0.34, 0.42, plum ) ) * ( 1.0 - smoothstep( 0.05, 0.12, p.r - p.b ) );
		return max( wBra, wBriefs ) * wX * wCol;
	}
	if ( mode == 3 ) {
		float wY = 1.0 - smoothstep( 0.795, 0.812, yNorm );
		float wX = 1.0 - smoothstep( 0.148, 0.165, xAbs );
		float wDark = 1.0 - smoothstep( 0.26, 0.32, plum );
		float wTrim = ( 1.0 - smoothstep( 0.075, 0.125, p.r - p.b ) ) * ( 1.0 - smoothstep( 0.52, 0.62, plum ) );
		return wY * wX * max( wDark, wTrim );
	}
	float wTop = smoothstep( 0.65, 0.665, yNorm ) * ( 1.0 - smoothstep( 0.815, 0.83, yNorm ) ) * ( 1.0 - smoothstep( 0.115, 0.128, xAbs ) );
	float wBot = smoothstep( 0.42, 0.435, yNorm ) * ( 1.0 - smoothstep( 0.60, 0.615, yNorm ) ) * ( 1.0 - smoothstep( 0.168, 0.182, xAbs ) );
	float wSpatial = max( wTop, wBot );
	float wNavy = ( 1.0 - smoothstep( -0.01, 0.05, p.r - p.b ) ) * ( 1.0 - smoothstep( 0.55, 0.68, plum ) );
	float wGold = smoothstep( 0.09, 0.135, p.g - p.b ) * smoothstep( 0.24, 0.32, sat );
	float wStrapBow = ( 1.0 - smoothstep( 0.075, 0.115, p.r - p.b ) ) * ( 1.0 - smoothstep( 0.12, 0.18, sat ) );
	float wDarkTie = 1.0 - smoothstep( 0.30, 0.38, plum );
	return wSpatial * max( max( wNavy, wDarkTie ), max( wGold, wStrapBow ) );
}`;

export function configureAuthoredOutfitMaterial(
  material: T.MeshStandardMaterial,
  outfitColor: string,
  refLinear = resolveOutfitMaterialRefLinear(material),
): AuthoredOutfitBinding {
  if (material.map) {
    material.map.colorSpace = T.SRGBColorSpace;
  }
  const authoredBase = material.color.clone();
  material.color.set('#ffffff');
  const uOutfitAuthoredBase = { value: authoredBase };
  const uOutfitRefColor = {
    value: new T.Color().setRGB(refLinear[0], refLinear[1], refLinear[2], T.LinearSRGBColorSpace),
  };
  const uOutfitColor = { value: new T.Color(outfitColor) };
  const uOutfitIsOriginal = { value: isOriginalOutfitHex(outfitColor) ? 1 : 0 };
  material.userData.outfitColorUniform = uOutfitColor;
  material.userData.pncOutfitIsOriginalUniform = uOutfitIsOriginal;
  material.customProgramCacheKey = () => 'pnc-authored-outfit-norm-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.uOutfitAuthoredBase = uOutfitAuthoredBase;
    shader.uniforms.uOutfitRefColor = uOutfitRefColor;
    shader.uniforms.uOutfitColor = uOutfitColor;
    shader.uniforms.uOutfitIsOriginal = uOutfitIsOriginal;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uOutfitAuthoredBase;
uniform vec3 uOutfitRefColor;
uniform vec3 uOutfitColor;
uniform float uOutfitIsOriginal;
${GLSL_NORMALIZED_OUTFIT_FN}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor.a *= sampledDiffuseColor.a;
	vec3 pncOrigOutfit = sampledDiffuseColor.rgb * uOutfitAuthoredBase;
	diffuseColor.rgb = pncEvaluateNormalizedOutfitColor( pncOrigOutfit, uOutfitRefColor, uOutfitColor, uOutfitIsOriginal );
#else
	diffuseColor.rgb = ( uOutfitIsOriginal > 0.5 ) ? uOutfitAuthoredBase : uOutfitColor;
#endif`,
      );
  };
  material.needsUpdate = true;
  return { colorUniform: uOutfitColor, isOriginalUniform: uOutfitIsOriginal };
}

export function configureAuthoredSkinMaterial(
  material: T.MeshStandardMaterial,
  skinColor: string,
  analysis: SkinAtlasAnalysis,
  sharedOutfit?: SharedOutfitShaderSpec,
): AuthoredOutfitBinding | null {
  if (material.map) {
    material.map.colorSpace = T.SRGBColorSpace;
  }
  const authoredBase = material.color.clone();
  const uniforms: AuthoredSkinUniforms = {
    uSkinAuthoredBase: { value: authoredBase },
    uSkinRefColor: { value: new T.Color().setRGB(analysis.refLinear[0], analysis.refLinear[1], analysis.refLinear[2], T.LinearSRGBColorSpace) },
    uSkinIsOriginal: { value: isOriginalSkinHex(skinColor) ? 1 : 0 },
    uSkinDarkLumaFloor: { value: analysis.hasDarkNonSkinIslands ? 1 : 0 },
  };
  const sharedMode: SharedOutfitModeId = sharedOutfit
    ? SHARED_OUTFIT_PROFILE_MODES[sharedOutfit.profile]
    : 0;
  const outfitBinding: AuthoredOutfitBinding | null = sharedOutfit
    ? {
        colorUniform: { value: new T.Color(sharedOutfit.outfitColor) },
        isOriginalUniform: { value: isOriginalOutfitHex(sharedOutfit.outfitColor) ? 1 : 0 },
      }
    : null;
  const sharedOutfitRef = sharedOutfit
    ? { value: new T.Color(SHARED_OUTFIT_REF_DEFAULTS[sharedOutfit.profile]) }
    : null;
  const uPncBindToRoot = sharedOutfit ? { value: sharedOutfit.bindToRoot.clone() } : null;
  const uPncBodyCenterX = sharedOutfit ? { value: sharedOutfit.bodyCenterX } : null;
  const uPncBodyMinY = sharedOutfit ? { value: sharedOutfit.bodyMinY } : null;
  const uPncBodySpanY = sharedOutfit ? { value: Math.max(sharedOutfit.bodySpanY, 1e-4) } : null;
  const uSharedOutfitMode = { value: sharedMode };

  if (outfitBinding) {
    material.userData.outfitColorUniform = outfitBinding.colorUniform;
    material.userData.pncOutfitIsOriginalUniform = outfitBinding.isOriginalUniform;
  }
  material.userData.pncSkinUniforms = uniforms;
  material.color.set(skinColor);
  material.customProgramCacheKey = () => `pnc-authored-skin-norm-v3-outfit-${sharedMode}`;
  material.onBeforeCompile = shader => {
    shader.uniforms.uSkinAuthoredBase = uniforms.uSkinAuthoredBase;
    shader.uniforms.uSkinRefColor = uniforms.uSkinRefColor;
    shader.uniforms.uSkinIsOriginal = uniforms.uSkinIsOriginal;
    shader.uniforms.uSkinDarkLumaFloor = uniforms.uSkinDarkLumaFloor;
    const hasRealVertexShader = Boolean(sharedOutfit && shader.vertexShader.includes('#include <begin_vertex>'));
    if (sharedOutfit && outfitBinding && sharedOutfitRef && uPncBindToRoot && uPncBodyCenterX && uPncBodyMinY && uPncBodySpanY) {
      shader.uniforms.uOutfitColor = outfitBinding.colorUniform;
      shader.uniforms.uOutfitIsOriginal = outfitBinding.isOriginalUniform;
      shader.uniforms.uOutfitRefColor = sharedOutfitRef;
      shader.uniforms.uSharedOutfitMode = uSharedOutfitMode;
      shader.uniforms.uPncBindToRoot = uPncBindToRoot;
      shader.uniforms.uPncBodyCenterX = uPncBodyCenterX;
      shader.uniforms.uPncBodyMinY = uPncBodyMinY;
      shader.uniforms.uPncBodySpanY = uPncBodySpanY;
      if (hasRealVertexShader) {
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
uniform mat4 uPncBindToRoot;
uniform float uPncBodyCenterX;
uniform float uPncBodyMinY;
uniform float uPncBodySpanY;
varying vec2 vPncBindNorm;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
vec3 pncRootBindPos = ( uPncBindToRoot * vec4( transformed, 1.0 ) ).xyz;
vPncBindNorm = vec2(
	abs( pncRootBindPos.x - uPncBodyCenterX ) / uPncBodySpanY,
	( pncRootBindPos.y - uPncBodyMinY ) / uPncBodySpanY
);`,
          );
      }
    }
    const sharedFragmentHeader = sharedOutfit
      ? `uniform vec3 uOutfitColor;
uniform vec3 uOutfitRefColor;
uniform float uOutfitIsOriginal;
uniform int uSharedOutfitMode;
${hasRealVertexShader ? 'varying vec2 vPncBindNorm;' : 'const vec2 vPncBindNorm = vec2( 0.0, 0.52 );'}
${GLSL_NORMALIZED_OUTFIT_FN}
${GLSL_SHARED_OUTFIT_MASK_FN}`
      : '';
    const sharedMapApply = sharedOutfit
      ? `	float pncOutfitWeight = pncEvaluateSharedOutfitMask( pncOrigAlbedo, vPncBindNorm, uSharedOutfitMode );
	vec3 pncSkinResult = ( uSkinIsOriginal > 0.5 )
		? pncOrigAlbedo
		: pncEvaluateNormalizedSkinTone( pncOrigAlbedo, uSkinRefColor, diffuse, uSkinDarkLumaFloor );
	vec3 pncOutfitResult = pncEvaluateNormalizedOutfitColor( pncOrigAlbedo, uOutfitRefColor, uOutfitColor, uOutfitIsOriginal );
	diffuseColor.rgb = mix( pncSkinResult, pncOutfitResult, pncOutfitWeight );`
      : `	if ( uSkinIsOriginal > 0.5 ) {
		diffuseColor.rgb = pncOrigAlbedo;
	} else {
		diffuseColor.rgb = pncEvaluateNormalizedSkinTone( pncOrigAlbedo, uSkinRefColor, diffuse, uSkinDarkLumaFloor );
	}`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSkinAuthoredBase;
uniform vec3 uSkinRefColor;
uniform float uSkinIsOriginal;
uniform float uSkinDarkLumaFloor;
${sharedFragmentHeader}
vec3 pncEvaluateNormalizedSkinTone( vec3 origLin, vec3 refLin, vec3 targetLin, float darkFloor ) {
	vec3 p = pow( max( origLin, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
	float mx = max( max( p.r, p.g ), p.b );
	float mn = min( min( p.r, p.g ), p.b );
	float sat = ( mx - mn ) / max( mx, 0.0001 );
	float plum = dot( p, vec3( 0.299, 0.587, 0.114 ) );

	float hiWhite = smoothstep( 0.62, 0.74, plum );
	float satLo = mix( 0.045, 0.145, hiWhite );
	float satHi = mix( 0.095, 0.195, hiWhite );
	float wSat = smoothstep( satLo, satHi, sat ) * ( 1.0 - smoothstep( 0.70, 0.82, sat ) );
	float wWarmRb = smoothstep( 0.018, 0.055, p.r - p.b );
	float wNotPink = smoothstep( -0.065, -0.025, p.g - p.b );
	float hueRatioGb = ( p.g - p.b ) / max( p.r - p.b, 0.0001 );
	float wNotGold = 1.0 - smoothstep( 0.68, 0.80, hueRatioGb ) * smoothstep( 0.32, 0.45, sat );

	vec3 pref = pow( max( refLin, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
	float prefLum = dot( pref, vec3( 0.299, 0.587, 0.114 ) );
	float lumaLo = mix( 0.06, prefLum * 0.34, darkFloor );
	float lumaHi = mix( 0.14, prefLum * 0.50, darkFloor );
	float wLuma = smoothstep( lumaLo, lumaHi, plum ) * ( 1.0 - smoothstep( 0.94, 0.99, plum ) );
	float skinMask = wSat * wWarmRb * wNotPink * wNotGold * wLuma;

	float lTex = dot( origLin, vec3( 0.2126, 0.7152, 0.0722 ) );
	float lRef = max( dot( refLin, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.02 );
	float lTgt = max( dot( targetLin, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.005 );

	float ratio = lTex / lRef;
	float gamma = lTgt > lRef ? 0.82 : 0.92;
	float shadedRatio = pow( max( ratio, 0.0001 ), gamma );

	vec3 texNorm = origLin / max( lTex, 0.015 );
	vec3 refNorm = refLin / lRef;
	vec3 subDelta = clamp( texNorm - refNorm, vec3( -0.35 ), vec3( 0.35 ) );
	vec3 recolored = max( targetLin * shadedRatio + subDelta * lTgt * 0.28, vec3( 0.0 ) );

	float maxC = max( max( recolored.r, recolored.g ), recolored.b );
	if ( maxC > 1.0 ) {
		float over = clamp( ( maxC - 1.0 ) / ( maxC + 0.35 ), 0.0, 0.65 ) * 0.35;
		recolored = mix( min( recolored, vec3( 1.0 ) ), vec3( 1.0 ), over );
	}
	return mix( origLin, clamp( recolored, 0.0, 1.0 ), skinMask );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor.a *= sampledDiffuseColor.a;
	vec3 pncOrigAlbedo = sampledDiffuseColor.rgb * uSkinAuthoredBase;
${sharedMapApply}
#else
	if ( uSkinIsOriginal > 0.5 ) {
		diffuseColor.rgb = uSkinAuthoredBase;
	} else {
		diffuseColor.rgb = diffuse;
	}
#endif`,
      );
  };
  material.needsUpdate = true;
  return outfitBinding;
}

const templates = new Map<ModelId, T.Group>();
const mannequinMaps = new Map<Body, { defaultMap: T.DataTexture; chibiMap: T.DataTexture }>();
let loading: Promise<void> | null = null;

async function fetchMannequinPngBytes(fileName: string, baseUrl: string): Promise<Uint8Array> {
  const url = `${baseUrl}models/mannequin/${fileName}`;
  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (isNode && typeof window === 'undefined' && !/^https?:\/\//i.test(url)) {
    const [{ readFile }, pathMod] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    const buf = await readFile(pathMod.resolve(process.cwd(), 'public', 'models', 'mannequin', fileName));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${fileName} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadMannequinRgbaTextures(baseUrl = import.meta.env.BASE_URL): Promise<void> {
  await Promise.all(
    (['male', 'female'] as const).map(async body => {
      if (mannequinMaps.has(body)) return;
      const title = body === 'male' ? 'Male' : 'Female';
      const [defBytes, chibiBytes] = await Promise.all([
        fetchMannequinPngBytes(`Mannequin_${title}.png`, baseUrl),
        fetchMannequinPngBytes(`Mannequin_${title}_Chibi.png`, baseUrl),
      ]);
      const [defaultMap, chibiMap] = await Promise.all([
        decodeUnpremultipliedPngDataTexture(defBytes),
        decodeUnpremultipliedPngDataTexture(chibiBytes),
      ]);
      mannequinMaps.set(body, { defaultMap, chibiMap });
    }),
  );
}

export function registerMannequinRgbaTextures(
  body: Body,
  defaultMap: T.DataTexture,
  chibiMap: T.DataTexture,
): void {
  mannequinMaps.set(body, { defaultMap, chibiMap });
}

const figureRefs = new WeakMap<T.Object3D, Figure>();

function cloneIndependentGeometry(src: T.BufferGeometry): T.BufferGeometry {
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
  for (const g of src.groups) {
    dst.addGroup(g.start, g.count, g.materialIndex);
  }
  if (src.boundingBox) dst.boundingBox = src.boundingBox.clone();
  if (src.boundingSphere) dst.boundingSphere = src.boundingSphere.clone();
  return dst;
}

function refitFigureScalpHair(figure: Figure): void {
  const body = figure.body ?? ((figure.root.userData?.gender as Body | undefined) ?? 'female');
  const style =
    (figure.root.userData.__activeHairStyle as MannequinHairStyle | undefined) ??
    figure.hairStyle ??
    defaultHairStyle(body);
  const scalp = figure.root.getObjectByName('Scalp hair');
  if (!(scalp instanceof T.Mesh)) return;

  const headRestInv = getFigureHeadRestBindInverse(figure.root) ?? figure.headFromNative;
  if (!headRestInv) return;
  figure.headFromNative = headRestInv.clone();

  const oldMat = scalp.material as T.MeshStandardMaterial;
  const currentHex = `#${oldMat.color.getHexString()}`;
  const isMannequin = Boolean(figure.modelId && !CHARACTERS[figure.modelId].source);
  const curPropRev = (figure.root.userData.__bodyProportionRevision as number) || 0;

  let nextGeo: T.BufferGeometry | null = null;
  let nextMat: T.MeshStandardMaterial | null = null;
  let nextDepthMat: T.MeshDepthMaterial | undefined;
  let nextVisible = false;

  if (isMannequin) {
    const fitted = buildMannequinFittedHair(figure.skin, figure.bones.head, body, style, currentHex, {
      restPositions: getFigureMorphedBodyRestPositions(figure.root),
      skinToHeadRest: figure.headFromNative,
      cacheOwner: figure.root,
      proportionRev: curPropRev,
    });
    if (fitted) {
      nextGeo = fitted.geometry;
      nextMat = fitted.material;
      nextDepthMat = fitted.depthMaterial;
      nextVisible = true;
    } else if (style === 'none') {
      scalp.visible = false;
      figure.root.userData.__hairProportionRevision = curPropRev;
      return;
    }
  } else {
    const targetSkull = getFigureMorphedSkullEnvelope(figure.root);
    const built = buildHairGeometryAndMaterial(body, style as HairStyle, figure.headFromNative, currentHex, targetSkull);
    if (built) {
      nextGeo = built.geometry;
      nextMat = built.material;
      nextVisible = built.visible;
    }
  }

  if (!nextGeo || !nextMat) return;

  const oldGeo = scalp.geometry;
  const oldDepth = scalp.customDepthMaterial;
  const idx = figure.hairMaterials.indexOf(oldMat);
  if (idx >= 0) figure.hairMaterials[idx] = nextMat;
  else figure.hairMaterials.push(nextMat);

  scalp.geometry = nextGeo;
  scalp.material = nextMat;
  scalp.customDepthMaterial = nextDepthMat ?? undefined;
  scalp.visible = nextVisible;
  figure.root.userData.__hairProportionRevision = curPropRev;
  oldGeo.dispose();
  oldMat.dispose();
  oldDepth?.dispose();
}

registerProportionPostHook(figureRoot => {
  const fig = figureRefs.get(figureRoot);
  if (fig) refitFigureScalpHair(fig);
});

export function loadExternalFigures(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const baseUrl = import.meta.env.BASE_URL;
  loading = Promise.all([
    loadHairTemplates(baseUrl),
    loadMannequinArchetypeBundle(baseUrl),
    loadMannequinHairBundle(baseUrl),
    loadMannequinRgbaTextures(baseUrl),
    preloadDefaultMannequinDressMaps(baseUrl),
    ...MODEL_IDS.map(async id => {
      if (templates.has(id)) return;
      const {path, label} = CHARACTERS[id];
      try {
        const gltf = await loader.loadAsync(`${baseUrl}${path}`);
        templates.set(id, gltf.scene);
      } catch (error) {
        throw new Error(`Could not load ${label}. Check the connection and retry. ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  ]).then(() => undefined).catch(error => { loading = null; throw error; });
  return loading;
}
export function makeExternalFigure(body: Body, color: string, outfitColor = defaultOutfitColor(body), id = defaultModelId(body)): Figure {
  const template = templates.get(id);
  if (!template || CHARACTERS[id].body !== body) throw new Error(`${id} is not loaded or incompatible with ${body}.`);
  return buildExternalFigure(body, template, color, outfitColor, id);
}

const morphologyCache = new Map<ModelId, MorphologyProfile>();

export function getCharacterMorphology(modelId: ModelId): MorphologyProfile | null {
  const cached = morphologyCache.get(modelId);
  if (cached) return cached;
  const template = templates.get(modelId);
  if (!template) return null;
  const character = CHARACTERS[modelId];
  const probe = buildExternalFigure(character.body, template, '#ffffff', '#ffffff', modelId);
  return probe.morphology ?? null;
}

export function buildExternalFigure(
  body: Body,
  template: T.Group,
  color: string,
  outfitColor = defaultOutfitColor(body),
  modelId = defaultModelId(body),
): Figure {
  const source = CHARACTERS[modelId].source;
  const isMannequin = !source;
  const root = new T.Group(), model = cloneSkeleton(template);
  root.add(model);
  const allBones = new Map<string, T.Bone>(), skins: T.SkinnedMesh[] = [];
  model.traverse(node => {
    if (node instanceof T.Bone) allBones.set(node.name, node);
    if (node instanceof T.Mesh) {
      node.geometry = cloneIndependentGeometry(node.geometry);
      node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
      node.castShadow = true; node.receiveShadow = true;
    }
    if (node instanceof T.SkinnedMesh) { node.frustumCulled = false; skins.push(node); }
  });
  if (!skins.length) throw new Error(`The ${body} asset contains no skinned body mesh.`);
  root.updateMatrixWorld(true);

  // CRITICAL: Give Body, Eyes, and Eyebrows independent Skeleton & boneInverses arrays
  // referencing the shared Bone hierarchy so CPU pass-through on Body never detaches GPU-skinned Eyes/Eyebrows!
  // Reconcile float32 inverse-bind rounding with the exact authored rest transforms so every
  // source character preserves 0.000 mm surface displacement in its sculpted rest posture.
  for (const s of skins) {
    const indepInverses = s.skeleton.boneInverses.map(m => m.clone());
    const indepSkeleton = new T.Skeleton([...s.skeleton.bones], indepInverses);
    if (source?.preserveAuthoredRest) indepSkeleton.calculateInverses();
    s.bind(indepSkeleton, s.bindMatrix.clone());
  }

  const bones = Object.fromEntries(JOINTS.map(j => {
    const name = (source?.bones ?? SOURCE_BONES)[j];
    const bone = allBones.get(name);
    if (!bone) throw new Error(`The ${modelId} asset is missing required joint ${name}.`);
    return [j, bone];
  })) as Record<Joint, T.Bone>;

  root.updateMatrixWorld(true);
  if (!isMannequin) {
    const left = bones.leftShoulder.getWorldPosition(new T.Vector3()).sub(bones.rightShoulder.getWorldPosition(new T.Vector3()));
    model.rotateOnWorldAxis(new T.Vector3(0, 1, 0), Math.atan2(left.z, left.x));
    root.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(root), nativeHeight = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) throw new Error(`The ${body} asset has invalid dimensions.`);
    model.scale.multiplyScalar(source.height / nativeHeight);
    root.updateMatrixWorld(true);
    bounds.setFromObject(root);
    model.position.add(new T.Vector3(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2));
    root.updateMatrixWorld(true);
  } else {
    const bounds = new T.Box3().setFromObject(root), nativeHeight = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) throw new Error(`The ${body} asset has invalid dimensions.`);
    root.userData.gender = body;
    root.userData.bodyType = 'realistic';
  }

  const restRotations = Object.fromEntries(JOINTS.map(j => [j, bones[j].quaternion.clone()])) as Record<Joint, T.Quaternion>;
  const rotationBases = Object.fromEntries(JOINTS.map(j => [j, bones[j].getWorldQuaternion(new T.Quaternion()).invert()])) as Record<Joint, T.Quaternion>;
  const mappedBody = source && model.getObjectByName(source.bodyMesh);
  const bodyParts = mappedBody ? skins.filter(mesh => mesh === mappedBody || mesh.parent === mappedBody) : [];
  const skin = source ? bodyParts.find(m =>
    (Array.isArray(m.material) ? m.material : [m.material]).some(mat => mat.name === source.groundMaterial)) ?? bodyParts[0] :
    skins.reduce((a, b) => a.geometry.getAttribute('position').count > b.geometry.getAttribute('position').count ? a : b);
  if (!skin) throw new Error(`${modelId} is missing the mapped body mesh.`);
  const attachMorphology = (fig: Figure): Figure => {
    let profile = morphologyCache.get(modelId);
    if (!profile) {
      profile = measureFigureMorphology(fig, {
        isCanonicalMannequin: isMannequin,
        preserveAuthoredNeutral: !isMannequin,
      });
      if (templates.get(modelId) === template) {
        morphologyCache.set(modelId, profile);
      }
    }
    fig.morphology = profile;
    fig.handRigs = calibrateFigureHandRigs(fig.root, fig.bones, profile, fig.restRotations);
    return fig;
  };
  if (source?.authored) {
    const materials = skins.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
    const resolve = (names: string[]) => names.flatMap(name => {
      const matches = materials.filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial && m.name === name);
      if (!matches.length) throw new Error(`${modelId}: missing material ${name}`);
      return matches;
    });
    const tintMaterials = Array.from(new Set(resolve(source.authored.skin)));
    const resolvedOutfitMaterials = Array.from(new Set(resolve(source.authored.outfit)));
    const resolvedOutfitSet = new Set(resolvedOutfitMaterials);
    const tintMaterialSet = new Set(tintMaterials);
    const mapAnalyses = tintMaterials
      .filter(m => Boolean(m.map))
      .map(m => analyzeMaterialSkinMap(m.map, modelId));
    const figureSkinAnalysis: SkinAtlasAnalysis = mapAnalyses.length
      ? {
          refLinear: [
            mapAnalyses.reduce((s, a) => s + a.refLinear[0], 0) / mapAnalyses.length,
            mapAnalyses.reduce((s, a) => s + a.refLinear[1], 0) / mapAnalyses.length,
            mapAnalyses.reduce((s, a) => s + a.refLinear[2], 0) / mapAnalyses.length,
          ],
          hasDarkNonSkinIslands: mapAnalyses.some(a => a.hasDarkNonSkinIslands),
        }
      : defaultSkinAnalysisForModel(modelId);

    const measureMeshBindBoundsInRoot = (targetMesh: T.SkinnedMesh) => {
      const bindToRoot = root.matrixWorld.clone().invert().multiply(targetMesh.matrixWorld);
      const posAttr = targetMesh.geometry.getAttribute('position');
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const tmpV = new T.Vector3();
      for (let vi = 0; vi < posAttr.count; vi++) {
        tmpV.fromBufferAttribute(posAttr, vi).applyMatrix4(bindToRoot);
        if (tmpV.x < minX) minX = tmpV.x;
        if (tmpV.x > maxX) maxX = tmpV.x;
        if (tmpV.y < minY) minY = tmpV.y;
        if (tmpV.y > maxY) maxY = tmpV.y;
      }
      return {
        bindToRoot,
        bodyCenterX: 0.5 * (minX + maxX),
        bodyMinY: minY,
        bodySpanY: Math.max(maxY - minY, 1e-4),
      };
    };

    const sharedBindingsByMaterial = new Map<T.MeshStandardMaterial, AuthoredOutfitBinding>();
    tintMaterials.forEach(m => {
      let sharedSpec: SharedOutfitShaderSpec | undefined;
      if (source.sharedOutfitProfile && resolvedOutfitSet.has(m)) {
        const ownerMesh =
          skins.find(mesh =>
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).includes(m),
          ) ?? skin;
        const measured = measureMeshBindBoundsInRoot(ownerMesh);
        sharedSpec = {
          profile: source.sharedOutfitProfile,
          outfitColor,
          ...measured,
        };
      }
      const binding = configureAuthoredSkinMaterial(m, color, figureSkinAnalysis, sharedSpec);
      if (binding) {
        sharedBindingsByMaterial.set(m, binding);
      }
    });

    const outfitColorUniforms: Array<{ value: T.Color }> = [];
    const outfitIsOriginalUniforms: Array<{ value: number }> = [];
    for (const outfitMat of resolvedOutfitMaterials) {
      const sharedBinding = sharedBindingsByMaterial.get(outfitMat);
      if (sharedBinding) {
        outfitColorUniforms.push(sharedBinding.colorUniform);
        outfitIsOriginalUniforms.push(sharedBinding.isOriginalUniform);
      } else if (!tintMaterialSet.has(outfitMat)) {
        const dedicatedBinding = configureAuthoredOutfitMaterial(outfitMat, outfitColor);
        outfitColorUniforms.push(dedicatedBinding.colorUniform);
        outfitIsOriginalUniforms.push(dedicatedBinding.isOriginalUniform);
      }
    }

    const hairMaterials = resolve(source.authored.hair);
    const figure: Figure = {
      modelId,
      body,
      nativeRig: true,
      root,
      skin,
      skins,
      bones,
      restRotations,
      rotationBases,
      tintMaterials,
      outfitColorUniforms,
      outfitIsOriginalUniforms,
      hairMaterials,
    };
    if (!source.authored.hair.length) {
      if (source.browMesh) {
        const brows = skins.find(s => s.name === source.browMesh);
        if (!brows) throw new Error(`The ${modelId} asset is missing its eyebrows and eyelashes.`);
        const browMaterials = (Array.isArray(brows.material) ? brows.material : [brows.material])
          .filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
        browMaterials.forEach(m => prepareEyebrowMaterial(m, DEFAULT_HAIR_COLOR));
        figure.hairMaterials.push(...browMaterials);
      }
      if (source.fittedSkull || source.browMesh) {
        figure.headFromNative = bones.head.matrixWorld.clone().invert().multiply(model.matrixWorld);
        figure.hairStyle = source.defaultHairStyle ?? defaultHairStyle(body);
        const built = buildHairGeometryAndMaterial(body, figure.hairStyle, figure.headFromNative, DEFAULT_HAIR_COLOR, source.fittedSkull);
        const headSkin = bodyParts.find(mesh => {
          const index = mesh.skeleton.bones.indexOf(bones.head);
          const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
          for (let i=0;i<joints.count;i++) if (joints.getX(i) === index && weights.getX(i) > .5) return true;
          return false;
        }) ?? skin;
        const scalp = built ? new T.Mesh(built.geometry, built.material) : buildProceduralFallbackHair(body, headSkin, bones.head, DEFAULT_HAIR_COLOR);
        scalp.name = scalp.name || 'Scalp hair';
        scalp.visible = built ? built.visible : figure.hairStyle !== 'none';
        scalp.castShadow = true;
        scalp.receiveShadow = true;
        bones.head.add(scalp);
        figure.hairMaterials.push(scalp.material);
      }
    }
    figureRefs.set(root, figure);
    root.userData.__hairProportionRevision = (root.userData.__bodyProportionRevision as number) || 0;
    setFigureColors(figure, color, outfitColor);
    attachMorphology(figure);
    setFigurePose(figure, neutralPose());
    return figure;
  }
  const tintMaterials = (Array.isArray(skin.material) ? skin.material : [skin.material]).filter((m): m is T.MeshStandardMaterial =>
    m instanceof T.MeshStandardMaterial);
  if (!tintMaterials.length) throw new Error(`${modelId} is missing the mapped skin/outfit material.`);

  if (isMannequin) {
    ensureMannequinDressAttribute(skin, body);
    const maps = mannequinMaps.get(body);
    for (const m of tintMaterials) {
      m.userData.pncOutfitMask = true;
      m.userData.skipAlbedoNormalization = true;
      if (maps) {
        m.map = maps.defaultMap;
        setMaterialMannequinMaps(m, maps);
      }
    }
  }

  const outfitColorUniforms = tintMaterials.map(m => configureSkinAndOutfitMaterial(m, color, outfitColor));
  const outfitIsOriginalUniforms = tintMaterials
    .map(m => m.userData.pncOutfitIsOriginalUniform as { value: number } | undefined)
    .filter((u): u is { value: number } => Boolean(u));
  // The source's Eyebrows surface includes both brows and modeled eyelashes.
  const brows = skins.find(s => s.name === (source?.browMesh ?? 'Eyebrows'));
  if (!brows && !source?.fittedSkull) throw new Error(`The ${body} asset is missing its eyebrows and eyelashes.`);
  const hairMaterials = (brows ? Array.isArray(brows.material) ? brows.material : [brows.material] : []).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
  hairMaterials.forEach(m => prepareEyebrowMaterial(m, DEFAULT_HAIR_COLOR));

  const baseline = isMannequin ? captureBodyProportionBaseline(root) : null;
  const targetSkull = baseline?.baseSkullEnvelope ?? source?.fittedSkull;
  const headFromNative =
    (isMannequin ? getFigureHeadRestBindInverse(root) : undefined) ??
    bones.head.matrixWorld.clone().invert().multiply(model.matrixWorld);

  const initialStyle = source?.defaultHairStyle ?? defaultHairStyle(body);
  let scalp: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  if (isMannequin) {
    const fitted = buildMannequinFittedHair(skin, bones.head, body, initialStyle, DEFAULT_HAIR_COLOR, {
      restPositions: getFigureMorphedBodyRestPositions(root),
      skinToHeadRest: headFromNative,
      cacheOwner: root,
      proportionRev: 0,
    });
    if (fitted) {
      scalp = new T.Mesh(fitted.geometry, fitted.material);
      if (fitted.depthMaterial) scalp.customDepthMaterial = fitted.depthMaterial;
      scalp.name = 'Scalp hair';
      scalp.visible = true;
    } else {
      scalp = new T.Mesh(new T.BufferGeometry(), new T.MeshStandardMaterial({ color: DEFAULT_HAIR_COLOR }));
      scalp.name = 'Scalp hair';
      scalp.visible = false;
    }
    scalp.castShadow = true;
    scalp.receiveShadow = true;
    bones.head.add(scalp);
  } else {
    const builtHair = buildHairGeometryAndMaterial(body, initialStyle, headFromNative, DEFAULT_HAIR_COLOR, targetSkull);
    if (builtHair) {
      scalp = new T.Mesh(builtHair.geometry, builtHair.material);
      scalp.name = scalp.name || 'Scalp hair';
      scalp.visible = builtHair.visible;
      scalp.castShadow = true;
      scalp.receiveShadow = true;
      bones.head.add(scalp);
    } else {
      scalp = buildProceduralFallbackHair(body, skin, bones.head, DEFAULT_HAIR_COLOR);
    }
  }
  hairMaterials.push(scalp.material);
  const figure: Figure = {
    modelId,
    nativeRig: !!source,
    body,
    root,
    skin,
    skins,
    bones,
    restRotations,
    rotationBases,
    tintMaterials,
    outfitColorUniforms,
    outfitIsOriginalUniforms,
    hairMaterials,
    headFromNative,
    hairStyle: initialStyle,
  };
  figureRefs.set(root, figure);
  root.userData.__hairProportionRevision = (root.userData.__bodyProportionRevision as number) || 0;
  if (isMannequin) {
    void setFigureDressMap(figure, DEFAULT_MANNEQUIN_DRESS_ID).catch(() => undefined);
  }
  attachMorphology(figure);
  setFigurePose(figure, neutralPose());
  return figure;
}

export function setFigureColors(
  figure: Figure,
  skinColor: string,
  outfitColor: string,
  hairColor?: string,
): void {
  const isOrigSkin = isOriginalSkinHex(skinColor);
  const isOrigOutfit = isOriginalOutfitHex(outfitColor);
  figure.tintMaterials.forEach(m => {
    m.color.set(skinColor);
    const skinUniforms = m.userData?.pncSkinUniforms as AuthoredSkinUniforms | undefined;
    if (skinUniforms) {
      skinUniforms.uSkinIsOriginal.value = isOrigSkin ? 1 : 0;
    }
  });
  figure.outfitColorUniforms.forEach(u => u.value.set(outfitColor));
  figure.outfitIsOriginalUniforms?.forEach(u => {
    u.value = isOrigOutfit ? 1 : 0;
  });
  if (hairColor !== undefined) {
    figure.hairMaterials.forEach(m => m.color.set(hairColor));
  }
}

export function setFigureHairStyle(
  figure: Figure,
  body: Body,
  requestedStyle?: MannequinHairStyle,
  color = DEFAULT_HAIR_COLOR,
): void {
  const source = figure.modelId && CHARACTERS[figure.modelId].source;
  if (source?.authored?.hair.length) return;
  const style = (requestedStyle ?? source?.defaultHairStyle ?? defaultHairStyle(body)) as MannequinHairStyle;
  const curPropRev = (figure.root.userData.__bodyProportionRevision as number) || 0;
  const hairPropRev = (figure.root.userData.__hairProportionRevision as number) ?? -1;
  const activeStyle = (figure.root.userData.__activeHairStyle as string | undefined) ?? figure.hairStyle;
  if (activeStyle === style && curPropRev === hairPropRev) {
    figure.hairMaterials.forEach(m => m.color.set(color));
    return;
  }
  const headRestInv = getFigureHeadRestBindInverse(figure.root) ?? figure.headFromNative;
  if (!headRestInv) return;
  figure.headFromNative = headRestInv.clone();
  const scalp = figure.root.getObjectByName('Scalp hair');
  if (!(scalp instanceof T.Mesh)) return;

  const isMannequin = Boolean(figure.modelId && !CHARACTERS[figure.modelId].source);
  let nextGeo: T.BufferGeometry | null = null;
  let nextMat: T.MeshStandardMaterial | null = null;
  let nextDepthMat: T.MeshDepthMaterial | undefined;
  let nextVisible = false;

  if (isMannequin) {
    if (style === 'none') {
      scalp.visible = false;
      figure.hairStyle = 'none';
      figure.root.userData.__activeHairStyle = 'none';
      figure.root.userData.__hairProportionRevision = curPropRev;
      figure.hairMaterials.forEach(m => m.color.set(color));
      return;
    }
    const fitted = buildMannequinFittedHair(figure.skin, figure.bones.head, body, style, color, {
      restPositions: getFigureMorphedBodyRestPositions(figure.root),
      skinToHeadRest: figure.headFromNative,
      cacheOwner: figure.root,
      proportionRev: curPropRev,
    });
    if (!fitted) return;
    nextGeo = fitted.geometry;
    nextMat = fitted.material;
    nextDepthMat = fitted.depthMaterial;
    nextVisible = true;
  } else {
    const targetSkull = getFigureMorphedSkullEnvelope(figure.root) ?? (figure.modelId && CHARACTERS[figure.modelId].source?.fittedSkull);
    const built = buildHairGeometryAndMaterial(body, style as HairStyle, figure.headFromNative, color, targetSkull);
    if (!built) return;
    nextGeo = built.geometry;
    nextMat = built.material;
    nextVisible = built.visible;
  }

  const oldGeo = scalp.geometry;
  const oldMat = scalp.material as T.MeshStandardMaterial;
  const oldDepth = scalp.customDepthMaterial;
  const idx = figure.hairMaterials.indexOf(oldMat);
  if (idx >= 0) figure.hairMaterials[idx] = nextMat;
  else figure.hairMaterials.push(nextMat);
  scalp.geometry = nextGeo;
  scalp.material = nextMat;
  scalp.customDepthMaterial = nextDepthMat ?? undefined;
  scalp.visible = nextVisible;
  figure.hairStyle = (
    ['parted', 'long', 'buns', 'buzz', 'partedBeard', 'none'].includes(style) ? style : figure.hairStyle
  ) as HairStyle | undefined;
  figure.root.userData.__activeHairStyle = style;
  figure.root.userData.__hairProportionRevision = curPropRev;
  figure.hairMaterials.forEach(m => m.color.set(color));
  oldGeo.dispose();
  oldMat.dispose();
  oldDepth?.dispose();
}
