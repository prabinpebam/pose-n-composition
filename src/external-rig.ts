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

export function configureSkinAndOutfitMaterial(
  material: T.MeshStandardMaterial,
  skinColor: string,
  outfitColor: string,
): { value: T.Color } {
  material.map = normalizeBodyAlbedoAndOutfitMap(material.map, material.roughnessMap);
  material.color.set(skinColor);
  material.vertexColors = false;
  material.transparent = false;
  material.roughness = material.roughnessMap ? 0.88 : 0.8;
  material.metalness = 0;

  const outfitUniform = { value: new T.Color(outfitColor) };
  material.userData.outfitColorUniform = outfitUniform;
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
let loading: Promise<void> | null = null;
export function loadExternalFigures(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all([
    loadHairTemplates(),
    ...(['male', 'female'] as const).map(async body => {
      if (templates.has(body)) return;
      const name = body === 'male' ? 'Male' : 'Female';
      const path = `${import.meta.env.BASE_URL}models/external/quaternius-universal-base/Superhero_${name}_FullBody.gltf`;
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
      node.geometry = node.geometry.clone();
      node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
      node.castShadow = true; node.receiveShadow = true;
    }
    if (node instanceof T.SkinnedMesh) { node.frustumCulled = false; skins.push(node); }
  });
  if (!skins.length) throw new Error(`The ${body} asset contains no skinned body mesh.`);
  const bones = Object.fromEntries(JOINTS.map(j => {
    const bone = allBones.get(SOURCE_BONES[j]);
    if (!bone) throw new Error(`The ${body} asset is missing required joint ${SOURCE_BONES[j]}.`);
    return [j, bone];
  })) as Record<Joint, T.Bone>;
  root.updateMatrixWorld(true);
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
  const restRotations = Object.fromEntries(JOINTS.map(j => [j, bones[j].quaternion.clone()])) as Record<Joint, T.Quaternion>;
  const rotationBases = Object.fromEntries(JOINTS.map(j => [j, bones[j].getWorldQuaternion(new T.Quaternion()).invert()])) as Record<Joint, T.Quaternion>;
  const skin = skins.reduce((a, b) => a.geometry.getAttribute('position').count > b.geometry.getAttribute('position').count ? a : b);
  const tintMaterials = (Array.isArray(skin.material) ? skin.material : [skin.material]).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
  const outfitColorUniforms = tintMaterials.map(m => configureSkinAndOutfitMaterial(m, color, outfitColor));
  // The source's Eyebrows surface includes both brows and modeled eyelashes.
  const brows = skins.find(s => s.name === 'Eyebrows');
  if (!brows) throw new Error(`The ${body} asset is missing its eyebrows and eyelashes.`);
  const hairMaterials = (Array.isArray(brows.material) ? brows.material : [brows.material]).filter((m): m is T.MeshStandardMaterial => m instanceof T.MeshStandardMaterial);
  if (!hairMaterials.length) throw new Error(`The ${body} asset has no editable eyebrow material.`);
  hairMaterials.forEach(m => prepareEyebrowMaterial(m, DEFAULT_HAIR_COLOR));
  const headFromNative = bones.head.matrixWorld.clone().invert().multiply(model.matrixWorld);
  const initialStyle = defaultHairStyle(body);
  const builtHair = buildHairGeometryAndMaterial(body, initialStyle, headFromNative, DEFAULT_HAIR_COLOR);
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
  if (figure.hairStyle === style || !figure.headFromNative) return;
  const scalp = figure.root.getObjectByName('Scalp hair');
  if (!(scalp instanceof T.Mesh)) return;
  const built = buildHairGeometryAndMaterial(body, style, figure.headFromNative, color);
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
  oldGeo.dispose();
  oldMat.dispose();
}
