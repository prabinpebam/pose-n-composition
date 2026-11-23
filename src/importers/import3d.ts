import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { bufferGeometryToEditableMesh, compactEditableMesh } from '../modeling/editableMesh';
import type { EditableMeshData, Vec3 } from '../modeling/types';

export const SUPPORTED_3D_EXTENSIONS = [
  '.glb',
  '.gltf',
  '.obj',
  '.fbx',
  '.stl',
  '.ply',
  '.dae',
  '.3ds',
] as const;

export const COMPANION_ASSET_EXTENSIONS = [
  '.mtl',
  '.bin',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
] as const;

export type Supported3DExtension = (typeof SUPPORTED_3D_EXTENSIONS)[number];

export type ImportFormat3D = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'ply' | 'dae' | '3ds';

export const IMPORT_FILE_ACCEPT = [
  ...SUPPORTED_3D_EXTENSIONS,
  ...COMPANION_ASSET_EXTENSIONS,
].join(',');

export interface MemoryFileInput {
  name: string;
  data: ArrayBuffer | Uint8Array | string;
  type?: string;
}

export type ImportFileSource = File | MemoryFileInput;

export interface Import3DOptions {
  /** Explicit scale override; when omitted, `autoScale` normalizes extreme CAD mm/cm exports. */
  scaleFactor?: number;
  /** Automatically scale assets larger than 25 m or smaller than 0.02 m into stage meters (default true). */
  autoScale?: boolean;
  /** Center X/Z bounds around 0 and place `minY = 0` on the stage floor (default true). */
  groundAndCenter?: boolean;
  /** Fallback hex color when geometry has no embedded material (default `'#c7c2b8'`). */
  defaultColor?: string;
  /** Optional Draco decoder path if loading Draco-compressed `.glb`/`.gltf` assets. */
  dracoDecoderPath?: string;
}

export interface Imported3DAsset {
  name: string;
  format: ImportFormat3D;
  root: THREE.Group;
  appliedScale: number;
  boundsSize: Vec3;
  meshCount: number;
  vertexCount: number;
  faceCount: number;
}

export interface SerializedImportedAsset {
  version: 1;
  name: string;
  sourceFormat: ImportFormat3D;
  glb: ArrayBuffer;
  appliedScale: number;
  boundsSize: Vec3;
  vertexCount: number;
  faceCount: number;
}

export interface PortableSerializedImportedAsset {
  version: 1;
  name: string;
  sourceFormat: ImportFormat3D;
  glbBase64: string;
  appliedScale: number;
  boundsSize: Vec3;
  vertexCount: number;
  faceCount: number;
}

/**
 * Ensures `globalThis.FileReader` exists in headless Node/Vitest environments
 * so `GLTFExporter` binary `.glb` serialization works identically in Node and browsers.
 */
function ensureFileReaderPolyfill(): void {
  if (typeof globalThis.FileReader !== 'undefined') return;

  class MinimalNodeFileReader {
    result: ArrayBuffer | string | null = null;
    error: unknown = null;
    onloadend: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;

    readAsArrayBuffer(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onload?.();
          this.onloadend?.();
        })
        .catch((err: unknown) => {
          this.error = err;
          this.onerror?.(err);
        });
    }

    readAsDataURL(blob: Blob): void {
      blob
        .arrayBuffer()
        .then((buf) => {
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const b64 =
            typeof Buffer !== 'undefined'
              ? Buffer.from(buf).toString('base64')
              : btoa(binary);
          const mime = blob.type || 'application/octet-stream';
          this.result = `data:${mime};base64,${b64}`;
          this.onload?.();
          this.onloadend?.();
        })
        .catch((err: unknown) => {
          this.error = err;
          this.onerror?.(err);
        });
    }
  }

  (globalThis as unknown as { FileReader: unknown }).FileReader = MinimalNodeFileReader;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function stripExtension(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function detect3DFormat(filename: string): ImportFormat3D | null {
  switch (getExtension(filename)) {
    case '.glb':
      return 'glb';
    case '.gltf':
      return 'gltf';
    case '.obj':
      return 'obj';
    case '.fbx':
      return 'fbx';
    case '.stl':
      return 'stl';
    case '.ply':
      return 'ply';
    case '.dae':
      return 'dae';
    case '.3ds':
      return '3ds';
    default:
      return null;
  }
}

function isBrowserFile(src: ImportFileSource): src is File {
  return typeof File !== 'undefined' && src instanceof File;
}

async function readAsArrayBuffer(src: ImportFileSource): Promise<ArrayBuffer> {
  if (isBrowserFile(src)) {
    return src.arrayBuffer();
  }
  if (typeof src.data === 'string') {
    return new TextEncoder().encode(src.data).buffer as ArrayBuffer;
  }
  if (src.data instanceof Uint8Array) {
    return src.data.buffer.slice(
      src.data.byteOffset,
      src.data.byteOffset + src.data.byteLength,
    ) as ArrayBuffer;
  }
  return src.data;
}

async function readAsText(src: ImportFileSource): Promise<string> {
  if (isBrowserFile(src)) {
    return src.text();
  }
  if (typeof src.data === 'string') {
    return src.data;
  }
  return new TextDecoder().decode(src.data);
}

async function createCompanionManager(companions: readonly ImportFileSource[]): Promise<{
  manager: THREE.LoadingManager;
  dispose: () => void;
}> {
  const manager = new THREE.LoadingManager();
  const objectUrls: string[] = [];
  const urlByBasename = new Map<string, string>();

  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    for (const comp of companions) {
      const baseName = comp.name.replace(/^.*[\\/]/, '').toLowerCase();
      let blob: Blob;
      if (isBrowserFile(comp)) {
        blob = comp;
      } else if (typeof comp.data === 'string') {
        blob = new Blob([comp.data], { type: comp.type ?? 'text/plain' });
      } else {
        const ab = await readAsArrayBuffer(comp);
        blob = new Blob([ab], { type: comp.type ?? 'application/octet-stream' });
      }
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      urlByBasename.set(baseName, url);
    }
  }

  if (urlByBasename.size > 0) {
    manager.setURLModifier((requestedUrl) => {
      const clean = decodeURIComponent(requestedUrl).replace(/^.*[\\/]/, '').toLowerCase();
      return urlByBasename.get(clean) ?? requestedUrl;
    });
  }

  return {
    manager,
    dispose: () => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const u of objectUrls) URL.revokeObjectURL(u);
      }
    },
  };
}

function createDefaultMaterial(color: string, vertexColors = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.08,
    vertexColors,
  });
}

function sanitizeGeometryAndMaterials(root: THREE.Object3D, defaultColor: string): {
  meshCount: number;
  vertexCount: number;
  faceCount: number;
} {
  let meshCount = 0;
  let vertexCount = 0;
  let faceCount = 0;

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geo = obj.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return;

    const posAttr = geo.getAttribute('position');
    if (!posAttr || posAttr.count === 0) return;

    // Sanitize any NaN/Infinity coordinates from raw CAD exports
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        posAttr.setXYZ(
          i,
          Number.isFinite(x) ? x : 0,
          Number.isFinite(y) ? y : 0,
          Number.isFinite(z) ? z : 0,
        );
      }
    }

    // Compute vertex normals ONLY when missing so authored smoothing groups stay intact
    if (!geo.getAttribute('normal')) {
      geo.computeVertexNormals();
    }

    const hasVertexColors = Boolean(geo.getAttribute('color'));
    if (!obj.material) {
      obj.material = createDefaultMaterial(defaultColor, hasVertexColors);
    } else if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => {
        if (!m) return createDefaultMaterial(defaultColor, hasVertexColors);
        if (hasVertexColors && 'vertexColors' in m) {
          m.vertexColors = true;
          m.needsUpdate = true;
        }
        return m;
      });
    } else if (hasVertexColors && 'vertexColors' in obj.material) {
      obj.material.vertexColors = true;
      obj.material.needsUpdate = true;
    }

    obj.castShadow = true;
    obj.receiveShadow = true;

    meshCount++;
    vertexCount += posAttr.count;
    const indexAttr = geo.getIndex();
    faceCount += Math.floor((indexAttr ? indexAttr.count : posAttr.count) / 3);
  });

  return { meshCount, vertexCount, faceCount };
}

/**
 * Computes auto-unit normalization (`maxDim > 25 m` or `< 0.02 m`), centers X/Z at 0,
 * and grounds `minY = 0` inside a clean wrapper `THREE.Group`.
 */
export function normalizeImportedObject3D(
  rawObject: THREE.Object3D,
  options?: Import3DOptions,
): {
  root: THREE.Group;
  appliedScale: number;
  boundsSize: Vec3;
  meshCount: number;
  vertexCount: number;
  faceCount: number;
} {
  const defaultColor = options?.defaultColor ?? '#c7c2b8';
  const autoScale = options?.autoScale ?? true;
  const groundAndCenter = options?.groundAndCenter ?? true;

  const stats = sanitizeGeometryAndMaterials(rawObject, defaultColor);
  rawObject.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(rawObject);
  const rawSize = new THREE.Vector3();
  if (box.isEmpty()) {
    const emptyGroup = new THREE.Group();
    emptyGroup.add(rawObject);
    return {
      root: emptyGroup,
      appliedScale: 1,
      boundsSize: [0, 0, 0],
      ...stats,
    };
  }

  box.getSize(rawSize);
  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);

  let scale = 1;
  if (options?.scaleFactor !== undefined && Number.isFinite(options.scaleFactor) && options.scaleFactor > 0) {
    scale = options.scaleFactor;
  } else if (autoScale && maxDim > 0) {
    if (maxDim > 250) {
      // Millimeter CAD/FBX export -> meters
      scale = 0.001;
      if (maxDim * scale > 25) scale = 2.0 / maxDim;
    } else if (maxDim > 25) {
      // Centimeter FBX/OBJ export -> meters
      scale = 0.01;
      if (maxDim * scale < 0.05) scale = 2.0 / maxDim;
    } else if (maxDim < 0.02) {
      // Micro-scaled unitless export -> meters
      scale = maxDim * 100 >= 0.05 && maxDim * 100 <= 25 ? 100 : 1.0 / maxDim;
    }
  }

  const pivotGroup = new THREE.Group();
  pivotGroup.name = rawObject.name || 'ImportedModel';
  rawObject.scale.multiplyScalar(scale);
  rawObject.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(rawObject);
  const scaledSize = new THREE.Vector3();
  const scaledCenter = new THREE.Vector3();
  scaledBox.getSize(scaledSize);
  scaledBox.getCenter(scaledCenter);

  if (groundAndCenter) {
    rawObject.position.x -= scaledCenter.x;
    rawObject.position.z -= scaledCenter.z;
    rawObject.position.y -= scaledBox.min.y;
    rawObject.updateMatrixWorld(true);
  }

  pivotGroup.add(rawObject);
  pivotGroup.updateMatrixWorld(true);

  return {
    root: pivotGroup,
    appliedScale: scale,
    boundsSize: [scaledSize.x, scaledSize.y, scaledSize.z],
    ...stats,
  };
}

/**
 * Imports one or more selected/dropped files (`.glb`, `.gltf`, `.obj` + `.mtl` + textures,
 * `.fbx`, `.stl`, `.ply`, `.dae`, `.3ds`) into a normalized Three.js scene hierarchy.
 */
export async function import3dFiles(
  filesInput: Iterable<ImportFileSource> | ArrayLike<ImportFileSource>,
  options?: Import3DOptions,
): Promise<Imported3DAsset> {
  const files = Array.from(filesInput);
  if (files.length === 0) {
    throw new Error('No files provided for 3D import.');
  }

  // Locate primary 3D geometry file; treat remaining `.mtl` / `.bin` / images as companions
  const primaryIndex = files.findIndex((f) => detect3DFormat(f.name) !== null);
  if (primaryIndex === -1) {
    const names = files.map((f) => f.name).join(', ');
    throw new Error(
      `Unsupported 3D file format (${names}). Supported formats: ${SUPPORTED_3D_EXTENSIONS.join(', ')}`,
    );
  }

  const primary = files[primaryIndex];
  const format = detect3DFormat(primary.name)!;
  const assetName = stripExtension(primary.name) || 'Imported Object';
  const companions = files.filter((_, i) => i !== primaryIndex);

  const { manager, dispose } = await createCompanionManager(companions);
  try {
    let rawRoot: THREE.Object3D;

    switch (format) {
      case 'glb':
      case 'gltf': {
        const loader = new GLTFLoader(manager);
        let draco: DRACOLoader | null = null;
        if (options?.dracoDecoderPath) {
          draco = new DRACOLoader(manager);
          draco.setDecoderPath(options.dracoDecoderPath);
          loader.setDRACOLoader(draco);
        }
        try {
          const data =
            format === 'glb' ? await readAsArrayBuffer(primary) : await readAsText(primary);
          const gltf = await loader.parseAsync(data, '');
          rawRoot = gltf.scene || new THREE.Group();
        } finally {
          draco?.dispose();
        }
        break;
      }

      case 'obj': {
        const objLoader = new OBJLoader(manager);
        const mtlFile = companions.find((c) => getExtension(c.name) === '.mtl');
        if (mtlFile) {
          const mtlText = await readAsText(mtlFile);
          const mtlLoader = new MTLLoader(manager);
          const materials = mtlLoader.parse(mtlText, '');
          materials.preload();
          objLoader.setMaterials(materials);
        }
        const objText = await readAsText(primary);
        rawRoot = objLoader.parse(objText);
        break;
      }

      case 'fbx': {
        const fbxLoader = new FBXLoader(manager);
        const buffer = await readAsArrayBuffer(primary);
        rawRoot = fbxLoader.parse(buffer, '');
        break;
      }

      case 'stl': {
        const stlLoader = new STLLoader(manager);
        const buffer = await readAsArrayBuffer(primary);
        const geo = stlLoader.parse(buffer);
        const mesh = new THREE.Mesh(
          geo,
          createDefaultMaterial(options?.defaultColor ?? '#c7c2b8', Boolean(geo.getAttribute('color'))),
        );
        mesh.name = assetName;
        const group = new THREE.Group();
        group.add(mesh);
        rawRoot = group;
        break;
      }

      case 'ply': {
        const plyLoader = new PLYLoader(manager);
        const buffer = await readAsArrayBuffer(primary);
        const geo = plyLoader.parse(buffer);
        const hasColors = Boolean(geo.getAttribute('color'));
        const mesh = new THREE.Mesh(
          geo,
          createDefaultMaterial(hasColors ? '#ffffff' : (options?.defaultColor ?? '#c7c2b8'), hasColors),
        );
        mesh.name = assetName;
        const group = new THREE.Group();
        group.add(mesh);
        rawRoot = group;
        break;
      }

      case 'dae': {
        if (typeof DOMParser === 'undefined') {
          throw new Error('Collada (.dae) parsing requires DOMParser in a browser environment.');
        }
        const colladaLoader = new ColladaLoader(manager);
        const xmlText = await readAsText(primary);
        const collada = colladaLoader.parse(xmlText, '');
        rawRoot = collada.scene;
        break;
      }

      case '3ds': {
        const tdsLoader = new TDSLoader(manager);
        const buffer = await readAsArrayBuffer(primary);
        rawRoot = tdsLoader.parse(buffer, '');
        break;
      }
    }

    rawRoot.name = assetName;
    const normalized = normalizeImportedObject3D(rawRoot, options);
    normalized.root.name = assetName;

    return {
      name: assetName,
      format,
      root: normalized.root,
      appliedScale: normalized.appliedScale,
      boundsSize: normalized.boundsSize,
      meshCount: normalized.meshCount,
      vertexCount: normalized.vertexCount,
      faceCount: normalized.faceCount,
    };
  } finally {
    dispose();
  }
}

/**
 * Convenience single-file importer wrapper around `import3dFiles`.
 */
export async function importSingle3dFile(
  file: ImportFileSource,
  options?: Import3DOptions,
): Promise<Imported3DAsset> {
  return import3dFiles([file], options);
}

/**
 * Serializes any `Imported3DAsset` or `THREE.Object3D` to a compact binary `.glb` `ArrayBuffer`
 * so imported `.obj`, `.fbx`, `.stl`, `.ply`, `.dae`, `.3ds`, and `.glb` models survive
 * page reloads in IndexedDB with embedded materials and textures intact.
 */
export async function serializeImportedAsset(
  source: Imported3DAsset | THREE.Object3D,
  meta?: {
    name?: string;
    sourceFormat?: ImportFormat3D;
    appliedScale?: number;
    boundsSize?: Vec3;
  },
): Promise<SerializedImportedAsset> {
  ensureFileReaderPolyfill();

  const isAssetRecord = 'root' in source && 'format' in source;
  const object = isAssetRecord ? source.root : source;
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, {
    binary: true,
    onlyVisible: false,
    embedImages: true,
  });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return a binary GLB ArrayBuffer.');
  }

  let vertexCount = isAssetRecord ? source.vertexCount : 0;
  let faceCount = isAssetRecord ? source.faceCount : 0;
  let boundsSize: Vec3 = isAssetRecord ? source.boundsSize : (meta?.boundsSize ?? [0, 0, 0]);

  if (!isAssetRecord) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      const sz = new THREE.Vector3();
      box.getSize(sz);
      boundsSize = [sz.x, sz.y, sz.z];
    }
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const p = child.geometry.getAttribute('position');
        if (p) {
          vertexCount += p.count;
          const idx = child.geometry.getIndex();
          faceCount += Math.floor((idx ? idx.count : p.count) / 3);
        }
      }
    });
  }

  return {
    version: 1,
    name: meta?.name ?? (isAssetRecord ? source.name : object.name || 'Imported Object'),
    sourceFormat: meta?.sourceFormat ?? (isAssetRecord ? source.format : 'glb'),
    glb: result,
    appliedScale: meta?.appliedScale ?? (isAssetRecord ? source.appliedScale : 1),
    boundsSize,
    vertexCount,
    faceCount,
  };
}

/**
 * Restores a `SerializedImportedAsset` from IndexedDB back into a live `Imported3DAsset`.
 */
export async function deserializeImportedAsset(
  record: SerializedImportedAsset,
  options?: { defaultColor?: string },
): Promise<Imported3DAsset> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(record.glb, '');
  const root = new THREE.Group();
  root.name = record.name;
  root.add(gltf.scene);

  const stats = sanitizeGeometryAndMaterials(root, options?.defaultColor ?? '#c7c2b8');
  root.updateMatrixWorld(true);

  return {
    name: record.name,
    format: record.sourceFormat,
    root,
    appliedScale: record.appliedScale,
    boundsSize: [...record.boundsSize] as Vec3,
    meshCount: stats.meshCount,
    vertexCount: stats.vertexCount || record.vertexCount,
    faceCount: stats.faceCount || record.faceCount,
  };
}

/** Encodes `SerializedImportedAsset` into JSON-safe Base64 for portable `.json` scene export. */
export function serializedAssetToPortableJson(
  record: SerializedImportedAsset,
): PortableSerializedImportedAsset {
  const bytes = new Uint8Array(record.glb);
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64');
  } else {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    b64 = btoa(bin);
  }
  return {
    version: 1,
    name: record.name,
    sourceFormat: record.sourceFormat,
    glbBase64: b64,
    appliedScale: record.appliedScale,
    boundsSize: [...record.boundsSize] as Vec3,
    vertexCount: record.vertexCount,
    faceCount: record.faceCount,
  };
}

/** Decodes `PortableSerializedImportedAsset` back to `SerializedImportedAsset` (`ArrayBuffer`). */
export function portableJsonToSerializedAsset(
  portable: PortableSerializedImportedAsset,
): SerializedImportedAsset {
  let glb: ArrayBuffer;
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(portable.glbBase64, 'base64');
    glb = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } else {
    const bin = atob(portable.glbBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    glb = bytes.buffer as ArrayBuffer;
  }
  return {
    version: 1,
    name: portable.name,
    sourceFormat: portable.sourceFormat,
    glb,
    appliedScale: portable.appliedScale,
    boundsSize: [...portable.boundsSize] as Vec3,
    vertexCount: portable.vertexCount,
    faceCount: portable.faceCount,
  };
}

/**
 * Converts any imported `THREE.Object3D` hierarchy into a unified quad-merged `EditableMeshData`
 * so imported `.obj` / `.fbx` / `.stl` / `.ply` / `.dae` / `.3ds` / `.glb` assets support
 * `Make Editable (C)`, CSG `Boole`, Modifiers, and Point/Edge/Polygon modeling!
 */
export function extractEditableMeshFromObject3D(
  object: THREE.Object3D,
  options?: { weldTolerance?: number; mergeCoplanarQuads?: boolean },
): EditableMeshData {
  object.updateMatrixWorld(true);
  const invRootMatrix = object.matrixWorld.clone().invert();

  const mergedVertices: Vec3[] = [];
  const mergedFaces: EditableMeshData['faces'] = [];
  let materialSlotOffset = 0;

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.visible || !child.geometry) return;
    const clonedGeo = (child.geometry as THREE.BufferGeometry).clone();
    const relMatrix = invRootMatrix.clone().multiply(child.matrixWorld);
    clonedGeo.applyMatrix4(relMatrix);

    const subMesh = bufferGeometryToEditableMesh(clonedGeo, {
      weldTolerance: options?.weldTolerance ?? 1e-5,
      mergeCoplanarQuads: options?.mergeCoplanarQuads ?? true,
    });
    clonedGeo.dispose();

    const vOffset = mergedVertices.length;
    for (const v of subMesh.vertices) mergedVertices.push(v);

    let maxMatIdx = 0;
    for (const f of subMesh.faces) {
      const localMat = f.materialIndex ?? 0;
      if (localMat > maxMatIdx) maxMatIdx = localMat;
      mergedFaces.push({
        verts: f.verts.map((vi) => vi + vOffset),
        materialIndex: materialSlotOffset + localMat,
        ...(f.uvs ? { uvs: f.uvs } : {}),
      });
    }
    materialSlotOffset += maxMatIdx + 1;
  });

  if (mergedFaces.length <= 1 || materialSlotOffset <= 1) {
    for (const f of mergedFaces) {
      if (f.materialIndex === 0) delete f.materialIndex;
    }
  }

  return compactEditableMesh({
    vertices: mergedVertices,
    faces: mergedFaces,
  });
}
