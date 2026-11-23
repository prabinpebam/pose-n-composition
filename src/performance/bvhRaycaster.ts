import * as THREE from 'three';
import {
  MeshBVH,
  SAH,
  CENTER,
  AVERAGE,
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  type MeshBVHOptions,
} from 'three-mesh-bvh';

export type BvhStrategy = typeof CENTER | typeof AVERAGE | typeof SAH;

export interface BvhBuildOptions {
  strategy?: BvhStrategy;
  maxDepth?: number;
  targetLeafSize?: number;
  forceRebuild?: boolean;
}

export interface BvhTreeOptions extends BvhBuildOptions {
  includeSkinnedMeshes?: boolean;
  includeDynamicGeometries?: boolean;
}

interface BvhGeometryUserData {
  __bvhPosVersion?: number;
  __bvhIndexVersion?: number;
  __bvhCount?: number;
  dynamicGeometry?: boolean;
  skipBvh?: boolean;
}

const DEFAULT_MAX_DEPTH = 40;
const DEFAULT_TARGET_LEAF_SIZE = 10;
const SKINNED_LAZY_LEAF_SIZE = 12;

let installed = false;
let originalMeshRaycast: typeof THREE.Mesh.prototype.raycast | null = null;
let originalSkinnedMeshRaycast: typeof THREE.SkinnedMesh.prototype.raycast | null = null;

const _inverseMatrix = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _worldSphere = new THREE.Sphere();

function getPositionVersion(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  if (!pos) return -1;
  return 'version' in pos ? pos.version : pos.data.version;
}

function getIndexVersion(geometry: THREE.BufferGeometry): number {
  return geometry.index ? geometry.index.version : -1;
}

function getVertexCount(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  return pos ? pos.count : 0;
}

function isBvhUpToDate(geometry: THREE.BufferGeometry): boolean {
  if (!geometry.boundsTree) return false;
  const ud = geometry.userData as BvhGeometryUserData;
  if (ud.__bvhPosVersion === undefined) {
    // BoundsTree was constructed directly via geometry.computeBoundsTree(); stamp current versions.
    ud.__bvhPosVersion = getPositionVersion(geometry);
    ud.__bvhIndexVersion = getIndexVersion(geometry);
    ud.__bvhCount = getVertexCount(geometry);
    return true;
  }
  return (
    ud.__bvhPosVersion === getPositionVersion(geometry) &&
    ud.__bvhIndexVersion === getIndexVersion(geometry) &&
    ud.__bvhCount === getVertexCount(geometry)
  );
}

/**
 * Returns true when eager scene-tree BVH generation should skip this mesh
 * (e.g., per-frame CPU-skinned characters or explicitly dynamic meshes where
 * rebuilding a BVH on every edit frame would cost more than raycasting).
 */
export function shouldSkipEagerBvh(
  object: THREE.Object3D,
  geometry?: THREE.BufferGeometry | null,
): boolean {
  if (object.userData?.skipBvh === true || object.userData?.dynamicGeometry === true) {
    return true;
  }
  if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
    return true;
  }
  const geo = geometry ?? (object as THREE.Mesh).geometry;
  if (!geo) return true;
  const ud = geo.userData as BvhGeometryUserData | undefined;
  if (ud?.skipBvh === true || ud?.dynamicGeometry === true) {
    return true;
  }
  const pos = geo.getAttribute('position');
  if (!pos || pos.count < 3) return true;
  if ((pos as THREE.BufferAttribute).usage === THREE.DynamicDrawUsage) {
    return true;
  }
  return false;
}

/**
 * Ensures a valid, version-synced `MeshBVH` exists on `geometry`.
 * Uses `targetLeafSize` (not deprecated `maxLeafTris`/`maxLeafSize`) for clean builds.
 */
export function ensureGeometryBvh(
  geometry: THREE.BufferGeometry | null | undefined,
  options?: BvhBuildOptions,
): MeshBVH | null {
  if (!geometry) return null;
  const ud = geometry.userData as BvhGeometryUserData;
  if (ud.skipBvh === true) return null;

  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 3) return null;

  if (!options?.forceRebuild && isBvhUpToDate(geometry)) {
    return (geometry.boundsTree as MeshBVH | undefined) ?? null;
  }

  if (geometry.boundsTree) {
    disposeBoundsTree.call(geometry);
  }

  const bvhOptions: MeshBVHOptions = {
    strategy: options?.strategy ?? CENTER,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    targetLeafSize: options?.targetLeafSize ?? DEFAULT_TARGET_LEAF_SIZE,
  };

  const tree = new MeshBVH(geometry, bvhOptions);
  geometry.boundsTree = tree;
  ud.__bvhPosVersion = getPositionVersion(geometry);
  ud.__bvhIndexVersion = getIndexVersion(geometry);
  ud.__bvhCount = getVertexCount(geometry);
  return tree;
}

/**
 * Builds cached `MeshBVH` structures across all eligible static meshes in `root`,
 * skipping CPU-skinned/dynamic geometries unless explicitly requested.
 * Returns the number of geometries whose BVH was newly built or refreshed.
 */
export function ensureObjectTreeBvh(
  root: THREE.Object3D | null | undefined,
  options?: BvhTreeOptions,
): number {
  if (!root) return 0;
  let builtCount = 0;
  const seen = new Set<THREE.BufferGeometry>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (seen.has(mesh.geometry)) return;
    seen.add(mesh.geometry);

    if (!options?.includeSkinnedMeshes && (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      return;
    }
    if (!options?.includeDynamicGeometries && shouldSkipEagerBvh(mesh, mesh.geometry)) {
      return;
    }

    const wasCurrent = isBvhUpToDate(mesh.geometry);
    const tree = ensureGeometryBvh(mesh.geometry, options);
    if (tree && (!wasCurrent || options?.forceRebuild)) {
      builtCount++;
    }
  });

  return builtCount;
}

/**
 * Disposes a single geometry's cached `MeshBVH` and clears version tracking metadata.
 */
export function disposeGeometryBvh(geometry: THREE.BufferGeometry | null | undefined): void {
  if (!geometry) return;
  if (geometry.boundsTree) {
    disposeBoundsTree.call(geometry);
    geometry.boundsTree = undefined;
  }
  const ud = geometry.userData as BvhGeometryUserData;
  delete ud.__bvhPosVersion;
  delete ud.__bvhIndexVersion;
  delete ud.__bvhCount;
}

/**
 * Traverses `root` and disposes all `MeshBVH` instances for leak-free RAM cleanup
 * when scene entries (rooms, props, primitives, booleans, characters) are removed.
 */
export function disposeObjectTreeBvh(root: THREE.Object3D | null | undefined): number {
  if (!root) return 0;
  let disposedCount = 0;
  const seen = new Set<THREE.BufferGeometry>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || seen.has(mesh.geometry)) return;
    seen.add(mesh.geometry);
    if (mesh.geometry.boundsTree) {
      disposeGeometryBvh(mesh.geometry);
      disposedCount++;
    }
  });

  return disposedCount;
}

/**
 * Runs `fn` with `raycaster.firstHitOnly = true` and restores the previous flag afterward.
 */
export function withFirstHitRaycaster<T>(
  raycaster: THREE.Raycaster,
  fn: (raycaster: THREE.Raycaster) => T,
): T {
  const previous = raycaster.firstHitOnly === true;
  raycaster.firstHitOnly = true;
  try {
    return fn(raycaster);
  } finally {
    raycaster.firstHitOnly = previous;
  }
}

function bvhAwareMeshRaycast(
  this: THREE.Mesh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): void {
  const geometry = this.geometry;
  if (!geometry) return;

  if (geometry.boundsTree && !isBvhUpToDate(geometry)) {
    if (shouldSkipEagerBvh(this, geometry)) {
      disposeGeometryBvh(geometry);
    } else {
      ensureGeometryBvh(geometry);
    }
  }

  if (geometry.boundsTree) {
    acceleratedRaycast.call(this, raycaster, intersects);
    return;
  }

  if (originalMeshRaycast) {
    originalMeshRaycast.call(this, raycaster, intersects);
  }
}

function bvhAwareSkinnedMeshRaycast(
  this: THREE.SkinnedMesh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): void {
  const geometry = this.geometry;
  if (!geometry || !this.material) return;

  // When SkinDeformer is in pass-through mode, deformed mesh-space positions live directly
  // in `geometry.attributes.position` and bone matrices are identity. Perform an O(1) tight
  // bounds check first, and lazily build a version-tracked BVH only when a ray enters the AABB.
  if (
    this.userData?.__skinDeformerPassThrough === true &&
    this.userData?.skipBvh !== true &&
    (geometry.userData as BvhGeometryUserData | undefined)?.skipBvh !== true
  ) {
    if (this.boundingSphere === null) this.computeBoundingSphere();
    if (this.boundingSphere) {
      _worldSphere.copy(this.boundingSphere).applyMatrix4(this.matrixWorld);
      if (!raycaster.ray.intersectsSphere(_worldSphere)) return;
    }

    _inverseMatrix.copy(this.matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_inverseMatrix);

    if (this.boundingBox !== null && !_localRay.intersectsBox(this.boundingBox)) {
      return;
    }

    const tree = ensureGeometryBvh(geometry, {
      strategy: CENTER,
      targetLeafSize: SKINNED_LAZY_LEAF_SIZE,
    });
    if (tree) {
      acceleratedRaycast.call(this, raycaster, intersects);
      return;
    }
  } else if (geometry.boundsTree) {
    // Non-pass-through GPU LBS SkinnedMesh must not raycast against bind-pose BVH.
    disposeGeometryBvh(geometry);
  }

  if (originalSkinnedMeshRaycast) {
    originalSkinnedMeshRaycast.call(this, raycaster, intersects);
  }
}

/**
 * Patches `THREE.BufferGeometry` and `THREE.Mesh` / `THREE.SkinnedMesh` prototypes
 * idempotently to accelerate raycasting with `three-mesh-bvh`.
 */
export function installBvhRaycastAcceleration(): void {
  if (installed) return;
  originalMeshRaycast = THREE.Mesh.prototype.raycast;
  originalSkinnedMeshRaycast = THREE.SkinnedMesh.prototype.raycast;

  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = bvhAwareMeshRaycast;
  THREE.SkinnedMesh.prototype.raycast = bvhAwareSkinnedMeshRaycast;
  installed = true;
}

/**
 * Restores original Three.js raycast methods (primarily for isolated testing/teardown).
 */
export function uninstallBvhRaycastAcceleration(): void {
  if (!installed) return;
  if (originalMeshRaycast) {
    THREE.Mesh.prototype.raycast = originalMeshRaycast;
  }
  if (originalSkinnedMeshRaycast) {
    THREE.SkinnedMesh.prototype.raycast = originalSkinnedMeshRaycast;
  }
  originalMeshRaycast = null;
  originalSkinnedMeshRaycast = null;
  installed = false;
}

export function isBvhRaycastAccelerationInstalled(): boolean {
  return installed;
}

export { SAH, CENTER, AVERAGE, MeshBVH };
