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
  getFigureMorphedSkullEnvelope,
  loadMannequinArchetypeBundle,
  registerProportionPostHook,
  setMaterialMannequinMaps,
} from './bodyProportions';
import { setFigurePose, type Figure } from './rig';

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
  material.userData.hasOutfitMask = true;
  material.customProgramCacheKey = () => 'pnc-body-skin-outfit-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.uOutfitColor = outfitUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uOutfitColor;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	vec3 pncRegionTint = mix( diffuse, uOutfitColor, sampledDiffuseColor.a );
	diffuseColor.rgb = sampledDiffuseColor.rgb * pncRegionTint;
#endif`,
      );
  };
  material.needsUpdate = true;
  return outfitUniform;
}

export const SOURCE_BONES: Record<Joint, string> = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
  leftShoulder: 'upperarm_l', leftElbow: 'lowerarm_l', leftWrist: 'hand_l',
  rightShoulder: 'upperarm_r', rightElbow: 'lowerarm_r', rightWrist: 'hand_r',
  leftHip: 'thigh_l', leftKnee: 'calf_l', leftAnkle: 'foot_l',
  rightHip: 'thigh_r', rightKnee: 'calf_r', rightAnkle: 'foot_r',
};
const templates = new Map<Body, T.Group>();
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
  const style = figure.hairStyle ?? defaultHairStyle(body);
  const scalp = figure.root.getObjectByName('Scalp hair');
  if (!(scalp instanceof T.Mesh)) return;

  const headRestInv = getFigureHeadRestBindInverse(figure.root) ?? figure.headFromNative;
  if (!headRestInv) return;
  figure.headFromNative = headRestInv.clone();
  const targetSkull = getFigureMorphedSkullEnvelope(figure.root);

  const oldMat = scalp.material as T.MeshStandardMaterial;
  const currentHex = `#${oldMat.color.getHexString()}`;
  const built = buildHairGeometryAndMaterial(body, style, figure.headFromNative, currentHex, targetSkull);
  if (!built) return;

  const oldGeo = scalp.geometry;
  const idx = figure.hairMaterials.indexOf(oldMat);
  if (idx >= 0) figure.hairMaterials[idx] = built.material;
  else figure.hairMaterials.push(built.material);

  scalp.geometry = built.geometry;
  scalp.material = built.material;
  scalp.visible = built.visible;
  figure.root.userData.__hairProportionRevision =
    (figure.root.userData.__bodyProportionRevision as number) || 0;
  oldGeo.dispose();
  oldMat.dispose();
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
    loadMannequinRgbaTextures(baseUrl),
    ...(['male', 'female'] as const).map(async body => {
      if (templates.has(body)) return;
      const name = body === 'male' ? 'Male' : 'Female';
      const path = `${baseUrl}models/mannequin/Mannequin_${name}.glb`;
      try {
        const gltf = await loader.loadAsync(path);
        templates.set(body, gltf.scene);
      } catch (error) {
        throw new Error(`Could not load ${body} figure assets. Check the connection and retry. ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  ]).then(() => undefined).catch(error => { loading = null; throw error; });
  return loading;
}
export function makeExternalFigure(body: Body, color: string, outfitColor = defaultOutfitColor(body)): Figure {
  const template = templates.get(body);
  if (!template) throw new Error(`${body} figure assets are not loaded. Retry loading the studio.`);
  return buildExternalFigure(body, template, color, outfitColor);
}
export function buildExternalFigure(
  body: Body,
  template: T.Group,
  color: string,
  outfitColor = defaultOutfitColor(body),
): Figure {
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

  // CRITICAL: Give Body, Eyes, and Eyebrows independent Skeleton & boneInverses arrays
  // referencing the shared Bone hierarchy so CPU pass-through on Body never detaches GPU-skinned Eyes/Eyebrows!
  for (const s of skins) {
    const indepInverses = s.skeleton.boneInverses.map(m => m.clone());
    const indepSkeleton = new T.Skeleton([...s.skeleton.bones], indepInverses);
    s.bind(indepSkeleton, s.bindMatrix.clone());
  }

  const bones = Object.fromEntries(JOINTS.map(j => {
    const bone = allBones.get(SOURCE_BONES[j]);
    if (!bone) throw new Error(`The ${body} asset is missing required joint ${SOURCE_BONES[j]}.`);
    return [j, bone];
  })) as Record<Joint, T.Bone>;

  const isMannequin =
    model.getObjectByName('Mannequin') != null ||
    skins.some(s => {
      const m = Array.isArray(s.material) ? s.material[0] : s.material;
      return Boolean(m?.userData?.pncOutfitMask);
    });

  root.updateMatrixWorld(true);
  if (!isMannequin) {
    const left = bones.leftShoulder.getWorldPosition(new T.Vector3()).sub(bones.rightShoulder.getWorldPosition(new T.Vector3()));
    model.rotateOnWorldAxis(new T.Vector3(0, 1, 0), Math.atan2(left.z, left.x));
    root.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(root), nativeHeight = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) throw new Error(`The ${body} asset has invalid dimensions.`);
    model.scale.multiplyScalar((body === 'male' ? 1.85 : 1.75) / nativeHeight);
    root.updateMatrixWorld(true);
    bounds.setFromObject(root);
    model.position.add(new T.Vector3(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2));
    root.updateMatrixWorld(true);
    const align = (joint: Joint, child: Joint, direction: T.Vector3) => {
      const bone = bones[joint];
      const from = bones[child].getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();
      const world = bone.getWorldQuaternion(new T.Quaternion());
      const parent = bone.parent!.getWorldQuaternion(new T.Quaternion());
      bone.quaternion.copy(parent.invert().multiply(new T.Quaternion().setFromUnitVectors(from, direction.normalize())).multiply(world));
      root.updateMatrixWorld(true);
    };
    for (const [prefix, sign] of [['left', 1], ['right', -1]] as const) {
      align(`${prefix}Shoulder`, `${prefix}Elbow`, new T.Vector3(sign * 0.12, -1, 0));
      align(`${prefix}Elbow`, `${prefix}Wrist`, new T.Vector3(0, -1, 0));
    }
  } else {
    const bounds = new T.Box3().setFromObject(root), nativeHeight = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(nativeHeight) || nativeHeight <= 0) throw new Error(`The ${body} asset has invalid dimensions.`);
    root.userData.gender = body;
    root.userData.bodyType = 'realistic';
  }

  const restRotations = Object.fromEntries(JOINTS.map(j => [j, bones[j].quaternion.clone()])) as Record<Joint, T.Quaternion>;
  const rotationBases = Object.fromEntries(JOINTS.map(j => [j, bones[j].getWorldQuaternion(new T.Quaternion()).invert()])) as Record<Joint, T.Quaternion>;
  const skin = skins.reduce((a, b) => a.geometry.getAttribute('position').count > b.geometry.getAttribute('position').count ? a : b);
  const tintMaterials = (Array.isArray(skin.material) ? skin.material : [skin.material]).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);

  if (isMannequin) {
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
  // The source's Eyebrows surface includes both brows and modeled eyelashes.
  const brows = skins.find(s => s.name === 'Eyebrows');
  if (!brows) throw new Error(`The ${body} asset is missing its eyebrows and eyelashes.`);
  const hairMaterials = (Array.isArray(brows.material) ? brows.material : [brows.material]).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
  if (!hairMaterials.length) throw new Error(`The ${body} asset has no editable eyebrow material.`);
  hairMaterials.forEach(m => prepareEyebrowMaterial(m, DEFAULT_HAIR_COLOR));

  const baseline = isMannequin ? captureBodyProportionBaseline(root) : null;
  const targetSkull = baseline ? baseline.baseSkullEnvelope : undefined;
  const headFromNative =
    (isMannequin ? getFigureHeadRestBindInverse(root) : undefined) ??
    bones.head.matrixWorld.clone().invert().multiply(model.matrixWorld);

  const initialStyle = defaultHairStyle(body);
  const builtHair = buildHairGeometryAndMaterial(body, initialStyle, headFromNative, DEFAULT_HAIR_COLOR, targetSkull);
  let scalp: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  if (builtHair) {
    scalp = new T.Mesh(builtHair.geometry, builtHair.material);
    scalp.name = 'Scalp hair';
    scalp.visible = builtHair.visible;
    scalp.castShadow = true;
    scalp.receiveShadow = true;
    bones.head.add(scalp);
  } else {
    scalp = buildProceduralFallbackHair(body, skin, bones.head, DEFAULT_HAIR_COLOR);
  }
  hairMaterials.push(scalp.material);
  const figure: Figure = {
    body, root, skin, skins, bones, restRotations, rotationBases, tintMaterials, outfitColorUniforms, hairMaterials,
    headFromNative, hairStyle: initialStyle,
  };
  figureRefs.set(root, figure);
  root.userData.__hairProportionRevision = (root.userData.__bodyProportionRevision as number) || 0;
  setFigurePose(figure, neutralPose());
  return figure;
}

export function setFigureColors(
  figure: Figure,
  skinColor: string,
  outfitColor: string,
  hairColor?: string,
): void {
  figure.tintMaterials.forEach(m => m.color.set(skinColor));
  figure.outfitColorUniforms.forEach(u => u.value.set(outfitColor));
  if (hairColor !== undefined) {
    figure.hairMaterials.forEach(m => m.color.set(hairColor));
  }
}

export function setFigureHairStyle(figure: Figure, body: Body, requestedStyle?: HairStyle, color = DEFAULT_HAIR_COLOR): void {
  const style = requestedStyle ?? defaultHairStyle(body);
  const curPropRev = (figure.root.userData.__bodyProportionRevision as number) || 0;
  const hairPropRev = (figure.root.userData.__hairProportionRevision as number) ?? -1;
  if (figure.hairStyle === style && curPropRev === hairPropRev) return;
  const headRestInv = getFigureHeadRestBindInverse(figure.root) ?? figure.headFromNative;
  if (!headRestInv) return;
  figure.headFromNative = headRestInv.clone();
  const targetSkull = getFigureMorphedSkullEnvelope(figure.root);
  const scalp = figure.root.getObjectByName('Scalp hair');
  if (!(scalp instanceof T.Mesh)) return;
  const built = buildHairGeometryAndMaterial(body, style, figure.headFromNative, color, targetSkull);
  if (!built) return;
  const oldGeo = scalp.geometry;
  const oldMat = scalp.material as T.MeshStandardMaterial;
  const idx = figure.hairMaterials.indexOf(oldMat);
  if (idx >= 0) figure.hairMaterials[idx] = built.material;
  else figure.hairMaterials.push(built.material);
  scalp.geometry = built.geometry;
  scalp.material = built.material;
  scalp.visible = built.visible;
  figure.hairStyle = style;
  figure.root.userData.__hairProportionRevision = curPropRev;
  oldGeo.dispose();
  oldMat.dispose();
}
