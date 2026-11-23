import * as THREE from 'three';
import {
  ADDITION,
  Brush,
  Evaluator,
  INTERSECTION,
  SUBTRACTION,
  type CSGOperation,
} from 'three-bvh-csg';
import {
  bufferGeometryToEditableMesh,
  editableMeshToBufferGeometry,
} from './editableMesh';
import type {
  BooleanOpType,
  EditableMeshData,
  TransformSpec,
} from './types';

export type BooleanGeometryInput = THREE.BufferGeometry | EditableMeshData;
export type BooleanTransformInput = THREE.Matrix4 | TransformSpec | null | undefined;

export interface BooleanCacheStats {
  size: number;
  hits: number;
  misses: number;
  maxEntries: number;
}

interface CachedBooleanEntry {
  geometry: THREE.BufferGeometry;
  posSnapshot: Float32Array;
  normSnapshot: Float32Array;
  uvSnapshot: Float32Array;
  posVersion: number;
  firstFloat: number;
  lastFloat: number;
}

interface CachedGeoSig {
  posVersion: number;
  idxVersion: number;
  count: number;
  quickProbe: number;
  sig: string;
}

const MAX_BOOLEAN_CACHE_ENTRIES = 64;
const booleanResultLru = new Map<string, CachedBooleanEntry>();
const geometrySigCache = new WeakMap<THREE.BufferGeometry, CachedGeoSig>();
let booleanCacheHits = 0;
let booleanCacheMisses = 0;

const _f64Scratch = new Float64Array(1);
const _u32Scratch = new Uint32Array(_f64Scratch.buffer);

function hashNumberPair(h1: number, h2: number, value: number): [number, number] {
  _f64Scratch[0] = value === 0 ? 0 : value;
  const lo = _u32Scratch[0]!;
  const hi = _u32Scratch[1]!;
  const n1 = Math.imul((h1 ^ lo) >>> 0, 16777619) >>> 0;
  const n2 = Math.imul((h2 ^ hi) >>> 0, 16777619) >>> 0;
  return [
    Math.imul((n1 ^ hi) >>> 0, 16777619) >>> 0,
    Math.imul((n2 ^ lo) >>> 0, 16777619) >>> 0,
  ];
}

function hashFloat32Buffer(arr: Float32Array, seed1 = 2166136261, seed2 = 374761393): string {
  const u32 = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
  let h1 = (seed1 ^ arr.length) >>> 0;
  let h2 = (seed2 ^ arr.length) >>> 0;
  for (let i = 0; i < u32.length; i++) {
    let word = u32[i]!;
    if (word === 0x80000000) word = 0; // Normalize -0.0 === +0.0
    h1 = Math.imul((h1 ^ word) >>> 0, 16777619) >>> 0;
    h2 = (Math.imul(h2, 2246822519) + word) >>> 0;
  }
  return `${arr.length}:${h1.toString(36)}_${h2.toString(36)}`;
}

function computeQuickProbe(arr: ArrayLike<number>): number {
  const len = arr.length;
  if (len === 0) return 0;
  const i1 = len >> 2;
  const i2 = len >> 1;
  const i3 = (len * 3) >> 2;
  return (
    (arr[0] ?? 0) * 1.13 +
    (arr[i1] ?? 0) * 2.17 +
    (arr[i2] ?? 0) * 3.31 +
    (arr[i3] ?? 0) * 5.09 +
    (arr[len - 1] ?? 0) * 7.23
  );
}

function computeGeometryInputSignature(input: BooleanGeometryInput): string {
  if (isEditableMeshData(input)) {
    let h1 = (2166136261 ^ input.vertices.length) >>> 0;
    let h2 = (374761393 ^ input.faces.length) >>> 0;
    for (let i = 0; i < input.vertices.length; i++) {
      const v = input.vertices[i]!;
      [h1, h2] = hashNumberPair(h1, h2, v[0]);
      [h1, h2] = hashNumberPair(h1, h2, v[1]);
      [h1, h2] = hashNumberPair(h1, h2, v[2]);
    }
    for (let f = 0; f < input.faces.length; f++) {
      const verts = input.faces[f]!.verts;
      h1 = Math.imul((h1 ^ verts.length) >>> 0, 16777619) >>> 0;
      for (let k = 0; k < verts.length; k++) {
        const idx = verts[k]! >>> 0;
        h1 = Math.imul((h1 ^ idx) >>> 0, 16777619) >>> 0;
        h2 = (Math.imul(h2, 2246822519) + idx) >>> 0;
      }
    }
    return `E:${input.vertices.length}:${input.faces.length}:${h1.toString(36)}_${h2.toString(36)}`;
  }

  const posAttr = input.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return 'G:empty';
  }
  const posVer =
    'version' in posAttr ? posAttr.version : posAttr.data.version;
  const idxAttr = input.index;
  const idxVer = idxAttr ? idxAttr.version : -1;
  const arr = posAttr.array;
  const probe = computeQuickProbe(arr);

  const cached = geometrySigCache.get(input);
  if (
    cached &&
    cached.posVersion === posVer &&
    cached.idxVersion === idxVer &&
    cached.count === posAttr.count &&
    cached.quickProbe === probe
  ) {
    return cached.sig;
  }

  let posSig: string;
  if (arr instanceof Float32Array) {
    posSig = hashFloat32Buffer(arr);
  } else {
    const tmp = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      tmp[i * 3] = posAttr.getX(i);
      tmp[i * 3 + 1] = posAttr.getY(i);
      tmp[i * 3 + 2] = posAttr.getZ(i);
    }
    posSig = hashFloat32Buffer(tmp);
  }

  let idxSig = 'noindex';
  if (idxAttr) {
    const iArr = idxAttr.array;
    let ih1 = (2166136261 ^ iArr.length) >>> 0;
    let ih2 = (374761393 ^ iArr.length) >>> 0;
    for (let i = 0; i < iArr.length; i++) {
      const v = iArr[i]! >>> 0;
      ih1 = Math.imul((ih1 ^ v) >>> 0, 16777619) >>> 0;
      ih2 = (Math.imul(ih2, 2246822519) + v) >>> 0;
    }
    idxSig = `${iArr.length}:${ih1.toString(36)}_${ih2.toString(36)}`;
  }

  const sig = `G:${posSig}|${idxSig}`;
  geometrySigCache.set(input, {
    posVersion: posVer,
    idxVersion: idxVer,
    count: posAttr.count,
    quickProbe: probe,
    sig,
  });
  return sig;
}

function computeTransformSignature(spec: BooleanTransformInput): string {
  if (!spec) return 'I';
  if (spec instanceof THREE.Matrix4) {
    const e = spec.elements;
    let s = 'M';
    for (let i = 0; i < 16; i++) {
      const v = Math.abs(e[i]!) < 1e-12 ? 0 : e[i]!;
      s += `:${v}`;
    }
    return s;
  }
  const p = spec.position;
  const r = spec.rotation;
  const sc = spec.scale;
  const norm = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);
  return `T:${norm(p[0])},${norm(p[1])},${norm(p[2])}|${norm(r[0])},${norm(r[1])},${norm(r[2])}|${norm(sc[0])},${norm(sc[1])},${norm(sc[2])}`;
}

function getFromBooleanCache(key: string): THREE.BufferGeometry | null {
  const entry = booleanResultLru.get(key);
  if (!entry) return null;

  // Refresh LRU recency
  booleanResultLru.delete(key);

  const posAttr = entry.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const arr = posAttr?.array as Float32Array | undefined;
  const unmutated =
    posAttr !== undefined &&
    arr !== undefined &&
    posAttr.version === entry.posVersion &&
    arr.length === entry.posSnapshot.length &&
    (arr.length === 0 ||
      (arr[0] === entry.firstFloat && arr[arr.length - 1] === entry.lastFloat));

  if (unmutated) {
    booleanResultLru.set(key, entry);
    booleanCacheHits++;
    return entry.geometry;
  }

  // Previous caller mutated cached geometry in-place; rebuild clean geometry from immutable snapshots
  const rebuilt = new THREE.BufferGeometry();
  rebuilt.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(entry.posSnapshot), 3));
  rebuilt.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(entry.normSnapshot), 3));
  rebuilt.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(entry.uvSnapshot), 2));
  rebuilt.computeBoundingBox();
  rebuilt.computeBoundingSphere();

  const rebuiltPos = rebuilt.getAttribute('position') as THREE.BufferAttribute;
  const rebuiltArr = rebuiltPos.array as Float32Array;
  entry.geometry = rebuilt;
  entry.posVersion = rebuiltPos.version;
  entry.firstFloat = rebuiltArr.length > 0 ? rebuiltArr[0]! : 0;
  entry.lastFloat = rebuiltArr.length > 0 ? rebuiltArr[rebuiltArr.length - 1]! : 0;

  booleanResultLru.set(key, entry);
  booleanCacheHits++;
  return rebuilt;
}

function storeInBooleanCache(key: string, geometry: THREE.BufferGeometry): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const posArr = (posAttr?.array as Float32Array | undefined) ?? new Float32Array(0);
  const normArr = (normAttr?.array as Float32Array | undefined) ?? new Float32Array(0);
  const uvArr = (uvAttr?.array as Float32Array | undefined) ?? new Float32Array(0);

  if (booleanResultLru.size >= MAX_BOOLEAN_CACHE_ENTRIES && !booleanResultLru.has(key)) {
    const oldestKey = booleanResultLru.keys().next().value;
    if (oldestKey !== undefined) {
      booleanResultLru.delete(oldestKey);
    }
  }

  booleanResultLru.set(key, {
    geometry,
    posSnapshot: new Float32Array(posArr),
    normSnapshot: new Float32Array(normArr),
    uvSnapshot: new Float32Array(uvArr),
    posVersion: posAttr?.version ?? 0,
    firstFloat: posArr.length > 0 ? posArr[0]! : 0,
    lastFloat: posArr.length > 0 ? posArr[posArr.length - 1]! : 0,
  });
}

export function getBooleanCacheStats(): BooleanCacheStats {
  return {
    size: booleanResultLru.size,
    hits: booleanCacheHits,
    misses: booleanCacheMisses,
    maxEntries: MAX_BOOLEAN_CACHE_ENTRIES,
  };
}

export function clearBooleanCache(): void {
  booleanResultLru.clear();
  booleanCacheHits = 0;
  booleanCacheMisses = 0;
}

const sharedEvaluator = new Evaluator();
sharedEvaluator.attributes = ['position', 'normal', 'uv'];
sharedEvaluator.useGroups = false;

function mapOperation(op: BooleanOpType): CSGOperation {
  switch (op) {
    case 'union':
      return ADDITION;
    case 'subtract':
      return SUBTRACTION;
    case 'intersect':
      return INTERSECTION;
  }
}

export function transformSpecToMatrix4(spec: BooleanTransformInput): THREE.Matrix4 {
  if (!spec) return new THREE.Matrix4();
  if (spec instanceof THREE.Matrix4) return spec.clone();

  const pos = new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
  const euler = new THREE.Euler(spec.rotation[0], spec.rotation[1], spec.rotation[2], 'XYZ');
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(
    Math.abs(spec.scale[0]) < 1e-6 ? 1e-6 : spec.scale[0],
    Math.abs(spec.scale[1]) < 1e-6 ? 1e-6 : spec.scale[1],
    Math.abs(spec.scale[2]) < 1e-6 ? 1e-6 : spec.scale[2],
  );
  return new THREE.Matrix4().compose(pos, quat, scale);
}

function isEditableMeshData(input: BooleanGeometryInput): input is EditableMeshData {
  return 'vertices' in input && 'faces' in input && Array.isArray(input.vertices);
}

/**
 * Normalizes any `BufferGeometry` or `EditableMeshData` so `three-bvh-csg` always receives
 * consistent `position` (vec3), `normal` (vec3), and `uv` (vec2) attributes without throwing.
 */
export function prepareGeometryForBoolean(input: BooleanGeometryInput): THREE.BufferGeometry {
  const srcGeo = isEditableMeshData(input)
    ? editableMeshToBufferGeometry(input)
    : input.clone();

  // Convert indexed or interleaved geometry to clean non-indexed Float32 attributes
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo;
  if (geo !== srcGeo) srcGeo.dispose();

  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    return empty;
  }

  // Ensure standard Float32BufferAttribute for position
  if (!(posAttr instanceof THREE.Float32BufferAttribute)) {
    const arr = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      arr[i * 3] = posAttr.getX(i);
      arr[i * 3 + 1] = posAttr.getY(i);
      arr[i * 3 + 2] = posAttr.getZ(i);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  }

  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  } else {
    const nAttr = geo.getAttribute('normal');
    if (!(nAttr instanceof THREE.Float32BufferAttribute)) {
      const arr = new Float32Array(nAttr.count * 3);
      for (let i = 0; i < nAttr.count; i++) {
        arr[i * 3] = nAttr.getX(i);
        arr[i * 3 + 1] = nAttr.getY(i);
        arr[i * 3 + 2] = nAttr.getZ(i);
      }
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr, 3));
    }
  }

  if (!geo.getAttribute('uv')) {
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const uvs = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const ax = Math.abs(n.getX(i));
      const ay = Math.abs(n.getY(i));
      const az = Math.abs(n.getZ(i));
      if (ay >= ax && ay >= az) {
        uvs[i * 2] = x * 0.5 + 0.5;
        uvs[i * 2 + 1] = z * 0.5 + 0.5;
      } else if (ax >= ay && ax >= az) {
        uvs[i * 2] = z * 0.5 + 0.5;
        uvs[i * 2 + 1] = y * 0.5 + 0.5;
      } else {
        uvs[i * 2] = x * 0.5 + 0.5;
        uvs[i * 2 + 1] = y * 0.5 + 0.5;
      }
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  } else {
    const uvAttr = geo.getAttribute('uv');
    if (!(uvAttr instanceof THREE.Float32BufferAttribute) || uvAttr.itemSize !== 2) {
      const arr = new Float32Array(posAttr.count * 2);
      const count = Math.min(posAttr.count, uvAttr.count);
      for (let i = 0; i < count; i++) {
        arr[i * 2] = uvAttr.getX(i);
        arr[i * 2 + 1] = uvAttr.getY(i);
      }
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(arr, 2));
    }
  }

  // Strip extra attributes so both operands share the exact attribute schema
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') {
      geo.deleteAttribute(name);
    }
  }
  geo.clearGroups();
  return geo;
}

/**
 * Evaluates a binary CSG Boolean (`union`, `subtract`, `intersect`) on two meshes + transforms.
 * Memoized by operand geometry content + transform + operation in an LRU cache (< 0.01ms hit).
 */
export function evaluateBoolean(
  meshA: BooleanGeometryInput,
  transformA: BooleanTransformInput,
  meshB: BooleanGeometryInput,
  transformB: BooleanTransformInput,
  operation: BooleanOpType,
): THREE.BufferGeometry {
  const cacheKey = `B|${operation}|${computeGeometryInputSignature(meshA)}@${computeTransformSignature(transformA)}|${computeGeometryInputSignature(meshB)}@${computeTransformSignature(transformB)}`;
  const cached = getFromBooleanCache(cacheKey);
  if (cached) {
    return cached;
  }
  booleanCacheMisses++;

  const outGeo = evaluateBooleanUncached(meshA, transformA, meshB, transformB, operation);
  storeInBooleanCache(cacheKey, outGeo);
  return outGeo;
}

function evaluateBooleanUncached(
  meshA: BooleanGeometryInput,
  transformA: BooleanTransformInput,
  meshB: BooleanGeometryInput,
  transformB: BooleanTransformInput,
  operation: BooleanOpType,
): THREE.BufferGeometry {
  const geoA = prepareGeometryForBoolean(meshA);
  const geoB = prepareGeometryForBoolean(meshB);

  const countA = geoA.getAttribute('position')?.count ?? 0;
  const countB = geoB.getAttribute('position')?.count ?? 0;

  if (countA < 3 && countB < 3) {
    geoB.dispose();
    geoA.computeBoundingBox();
    geoA.computeBoundingSphere();
    return geoA;
  }
  if (countA < 3) {
    geoA.dispose();
    if (operation === 'union') {
      geoB.applyMatrix4(transformSpecToMatrix4(transformB));
      geoB.computeBoundingBox();
      geoB.computeBoundingSphere();
      return geoB;
    }
    geoB.dispose();
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    empty.computeBoundingBox();
    empty.computeBoundingSphere();
    return empty;
  }
  if (countB < 3) {
    geoB.dispose();
    if (operation === 'intersect') {
      geoA.dispose();
      const empty = new THREE.BufferGeometry();
      empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
      empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
      empty.computeBoundingBox();
      empty.computeBoundingSphere();
      return empty;
    }
    geoA.applyMatrix4(transformSpecToMatrix4(transformA));
    geoA.computeBoundingBox();
    geoA.computeBoundingSphere();
    return geoA;
  }

  const brushA = new Brush(geoA);
  brushA.applyMatrix4(transformSpecToMatrix4(transformA));
  brushA.updateMatrixWorld(true);

  const brushB = new Brush(geoB);
  brushB.applyMatrix4(transformSpecToMatrix4(transformB));
  brushB.updateMatrixWorld(true);

  const resultBrush = sharedEvaluator.evaluate(brushA, brushB, mapOperation(operation));
  const outGeo = resultBrush.geometry.clone();
  outGeo.computeBoundingBox();
  outGeo.computeBoundingSphere();

  brushA.disposeCacheData();
  brushB.disposeCacheData();
  resultBrush.disposeCacheData();
  geoA.dispose();
  geoB.dispose();
  resultBrush.geometry.dispose();

  return outGeo;
}

export interface BooleanChainOperand {
  mesh: BooleanGeometryInput;
  transform?: BooleanTransformInput;
  /** Optional per-operand override; defaults to the generator's `operation`. */
  operation?: BooleanOpType;
}

/**
 * Evaluates a multi-operand Cinema 4D `Boole` chain `[baseOperand, ...cuttersOrUnions]`.
 * Memoized across the full operand chain so unrelated scene updates reuse the cached geometry in O(1).
 */
export function evaluateBooleanChain(
  operands: readonly BooleanChainOperand[],
  defaultOperation: BooleanOpType = 'subtract',
): THREE.BufferGeometry {
  if (operands.length === 0) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    return empty;
  }

  let chainKey = `C|${defaultOperation}|${computeGeometryInputSignature(operands[0].mesh)}@${computeTransformSignature(operands[0].transform)}`;
  for (let i = 1; i < operands.length; i++) {
    const opSpec = operands[i]!;
    chainKey += `|${opSpec.operation ?? defaultOperation}:${computeGeometryInputSignature(opSpec.mesh)}@${computeTransformSignature(opSpec.transform)}`;
  }

  const cachedChain = getFromBooleanCache(chainKey);
  if (cachedChain) {
    return cachedChain;
  }
  booleanCacheMisses++;

  let accGeo = prepareGeometryForBoolean(operands[0].mesh);
  accGeo.applyMatrix4(transformSpecToMatrix4(operands[0].transform));

  for (let i = 1; i < operands.length; i++) {
    const opSpec = operands[i]!;
    const nextGeo = evaluateBooleanUncached(
      accGeo,
      null,
      opSpec.mesh,
      opSpec.transform,
      opSpec.operation ?? defaultOperation,
    );
    accGeo.dispose();
    accGeo = nextGeo;
  }

  accGeo.computeBoundingBox();
  accGeo.computeBoundingSphere();
  storeInBooleanCache(chainKey, accGeo);
  return accGeo;
}

/** Converts a CSG Boolean `BufferGeometry` into a clean quad-merged `EditableMeshData` ("Make Editable"). */
export function booleanResultToEditableMesh(geometry: THREE.BufferGeometry): EditableMeshData {
  return bufferGeometryToEditableMesh(geometry, {
    weldTolerance: 1e-5,
    mergeCoplanarQuads: true,
    coplanarAngleDeg: 1.5,
  });
}
