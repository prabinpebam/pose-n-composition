import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  disposeObjectTreeBvh,
  ensureGeometryBvh,
  ensureObjectTreeBvh,
  installBvhRaycastAcceleration,
  isBvhRaycastAccelerationInstalled,
  uninstallBvhRaycastAcceleration,
  withFirstHitRaycaster,
} from './bvhRaycaster';
import { FrameGovernor } from './frameGovernor';
import { PerfMonitor } from './perfMetrics';
import { SkinDeformer, applyExtremePoseDeformer } from '../skinDeformer';
import { buildExternalFigure } from '../external-rig';
import { loadMannequinTestFixtures } from '../testMannequinFixtures';
import {
  clearBooleanCache,
  evaluateBoolean,
  evaluateBooleanChain,
  getBooleanCacheStats,
} from '../modeling/booleans';
import { evaluateModelingNode } from '../modeling/evaluator';
import type { BooleanModelingNode } from '../modeling/types';
import {
  clearWorkingDraft,
  closeCachedStorage,
  flushScheduledWorkingSceneSave,
  getScheduledWorkingSceneSaveStats,
  loadWorkingDraft,
  saveWorkingScene,
  scheduleSaveWorkingScene,
} from '../storage';
import { clone, initialScene, preset, radians, type Body } from '../model';

let characterTemplates = new Map<Body, THREE.Group>();

beforeAll(async () => {
  characterTemplates = await loadMannequinTestFixtures();
});

describe('MeshBVH raycasting acceleration (bvhRaycaster.ts)', () => {
  afterEach(() => {
    uninstallBvhRaycastAcceleration();
  });

  it('builds cleanly without warnings, matches brute-force hit points/normals, and speeds up multi-ray intersection on 20k+ triangle meshes by >= 5x', () => {
    // 180 x 120 UV sphere = 42,840 triangles (> 20k requirement)
    const denseGeo = new THREE.SphereGeometry(2.0, 180, 120);
    // Modulate surface radially so hits exercise varied triangle normals & depths
    const pos = denseGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ripple = 1 + 0.08 * Math.sin(x * 4) * Math.cos(y * 5);
      pos.setXYZ(i, x * ripple, y * ripple, z * ripple);
    }
    denseGeo.computeVertexNormals();
    denseGeo.computeBoundingBox();
    denseGeo.computeBoundingSphere();

    const triCount = denseGeo.index
      ? denseGeo.index.count / 3
      : pos.count / 3;
    expect(triCount).toBeGreaterThan(20_000);

    const mesh = new THREE.Mesh(denseGeo, new THREE.MeshStandardMaterial());
    mesh.position.set(0.35, 1.1, -0.25);
    mesh.rotation.set(0.2, 0.55, -0.15);
    mesh.updateMatrixWorld(true);

    // Build 144 deterministic rays aimed across the mesh bounds
    const rays: Array<{ origin: THREE.Vector3; dir: THREE.Vector3 }> = [];
    for (let gy = 0; gy < 12; gy++) {
      for (let gx = 0; gx < 12; gx++) {
        const tx = -2.2 + (gx / 11) * 4.4 + 0.35;
        const ty = -2.2 + (gy / 11) * 4.4 + 1.1;
        const origin = new THREE.Vector3(tx, ty, 6.0);
        const dir = new THREE.Vector3(tx * 0.05, -ty * 0.04, -1).normalize();
        rays.push({ origin, dir });
      }
    }

    // 1. Brute-force raycasting baseline (ensure BVH prototype patch is uninstalled)
    uninstallBvhRaycastAcceleration();
    const raycaster = new THREE.Raycaster();
    // Warm up JIT
    for (let i = 0; i < 8; i++) {
      raycaster.set(rays[i]!.origin, rays[i]!.dir);
      raycaster.intersectObject(mesh, false);
    }

    const bruteHits: Array<{ distance: number; point: THREE.Vector3; normal: THREE.Vector3 } | null> = [];
    const tBrute0 = performance.now();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < rays.length; i++) {
        raycaster.set(rays[i]!.origin, rays[i]!.dir);
        const res = raycaster.intersectObject(mesh, false);
        if (pass === 0) {
          bruteHits.push(
            res[0]
              ? {
                  distance: res[0].distance,
                  point: res[0].point.clone(),
                  normal: res[0].face!.normal.clone(),
                }
              : null,
          );
        }
      }
    }
    const bruteMs = performance.now() - tBrute0;

    // 2. Install BVH acceleration & build boundsTree
    const warnSpy = vi.spyOn(console, 'warn');
    installBvhRaycastAcceleration();
    expect(isBvhRaycastAccelerationInstalled()).toBe(true);
    const bvhTree = ensureGeometryBvh(denseGeo);
    expect(bvhTree).not.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();

    // Warm up BVH path
    for (let i = 0; i < 8; i++) {
      raycaster.set(rays[i]!.origin, rays[i]!.dir);
      withFirstHitRaycaster(raycaster, () => raycaster.intersectObject(mesh, false));
    }

    const bvhHits: Array<{ distance: number; point: THREE.Vector3; normal: THREE.Vector3 } | null> = [];
    const tBvh0 = performance.now();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < rays.length; i++) {
        raycaster.set(rays[i]!.origin, rays[i]!.dir);
        const res = withFirstHitRaycaster(raycaster, () => raycaster.intersectObject(mesh, false));
        if (pass === 0) {
          bvhHits.push(
            res[0]
              ? {
                  distance: res[0].distance,
                  point: res[0].point.clone(),
                  normal: res[0].face!.normal.clone(),
                }
              : null,
          );
        }
      }
    }
    const bvhMs = performance.now() - tBvh0;

    // Verify exact closest-hit parity across all 144 rays
    let nonNullMatches = 0;
    for (let i = 0; i < rays.length; i++) {
      const a = bruteHits[i]!;
      const b = bvhHits[i]!;
      if (a === null) {
        expect(b).toBeNull();
      } else {
        expect(b).not.toBeNull();
        nonNullMatches++;
        expect(b!.distance).toBeCloseTo(a.distance, 4);
        expect(b!.point.distanceTo(a.point)).toBeLessThan(1e-4);
        expect(b!.normal.distanceTo(a.normal)).toBeLessThan(1e-4);
      }
    }
    expect(nonNullMatches).toBeGreaterThan(60);

    const speedup = bruteMs / Math.max(bvhMs, 0.01);
    expect(speedup).toBeGreaterThanOrEqual(5);

    // Clean disposal removes boundsTree without leaks
    const disposedCount = disposeObjectTreeBvh(mesh);
    expect(disposedCount).toBe(1);
    expect(denseGeo.boundsTree).toBeUndefined();
    denseGeo.dispose();
  });

  it('accelerates pass-through posed SkinnedMesh via lazy version-tracked BVH while skipping standard GPU-skinned meshes in eager tree build', () => {
    installBvhRaycastAcceleration();
    const fig = buildExternalFigure('male', characterTemplates.get('male')!, '#d9a17c');
    applyExtremePoseDeformer(fig, preset('Heroic'));
    fig.root.updateMatrixWorld(true);

    // Eager tree build skips SkinnedMesh instances (lazy path builds on raycast instead)
    ensureObjectTreeBvh(fig.root);
    expect(fig.skin.geometry.boundsTree).toBeUndefined();

    // Raycasting against pass-through SkinnedMesh builds & caches BVH on demand
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 1.05, 3.0),
      new THREE.Vector3(0, 0, -1),
    );
    const hit1 = withFirstHitRaycaster(raycaster, () => raycaster.intersectObject(fig.root, true));
    expect(hit1.length).toBeGreaterThan(0);
    expect(fig.skin.geometry.boundsTree).toBeDefined();

    // Subsequent 32 rays reuse cached BVH in < 2ms total (vs ~800ms brute-force SkinnedMesh raycast)
    const t0 = performance.now();
    for (let i = 0; i < 32; i++) {
      raycaster.set(
        new THREE.Vector3((i - 16) * 0.02, 0.9 + (i % 5) * 0.08, 3.0),
        new THREE.Vector3(0, 0, -1),
      );
      withFirstHitRaycaster(raycaster, () => raycaster.intersectObject(fig.root, true));
    }
    const elapsed32 = performance.now() - t0;
    expect(elapsed32).toBeLessThan(25);

    disposeObjectTreeBvh(fig.root);
    expect(fig.skin.geometry.boundsTree).toBeUndefined();
  });
});

describe('FrameGovernor & PerfMonitor (frameGovernor.ts, perfMetrics.ts)', () => {
  it('renders while dirty, settles to idlePaused === true (0 renders) after the settle window, and wakes in < 1 frame on invalidate()', () => {
    let nowMs = 1_000;
    let nextRafId = 1;
    const pendingRafs = new Map<number, (ts: number) => void>();
    const appliedDprs: number[] = [];
    let renderCount = 0;
    let simulatedWorkMs = 4;

    const perfMonitor = new PerfMonitor(60);
    const governor = new FrameGovernor({
      settleFrames: 6,
      settleMs: 120,
      frameBudgetMs: 20,
      perfMonitor,
      now: () => nowMs,
      getDevicePixelRatio: () => 2,
      onPixelRatioChange: dpr => appliedDprs.push(dpr),
      requestFrame: cb => {
        const id = nextRafId++;
        pendingRafs.set(id, cb);
        return id;
      },
      cancelFrame: id => {
        pendingRafs.delete(id);
      },
      onRender: () => {
        renderCount++;
        nowMs += simulatedWorkMs;
      },
    });

    const stepOneVsync = (deltaMs = 16.67): boolean => {
      if (pendingRafs.size === 0) {
        nowMs += deltaMs;
        return false;
      }
      const [[id, cb]] = [...pendingRafs.entries()];
      pendingRafs.delete(id);
      nowMs += deltaMs;
      cb(nowMs);
      return true;
    };

    governor.start();
    expect(governor.isIdlePaused()).toBe(false);

    // Step through settle frames + settleMs until governor pauses completely
    let activeSteps = 0;
    for (let i = 0; i < 30; i++) {
      if (stepOneVsync(25)) activeSteps++;
    }
    expect(activeSteps).toBeGreaterThanOrEqual(6);
    expect(governor.isIdlePaused()).toBe(true);
    expect(perfMonitor.getSnapshot().idlePaused).toBe(true);
    expect(pendingRafs.size).toBe(0);

    // Verify 0 renders occur across 60 additional idle vsync intervals (1 full second)
    const rendersAtIdle = renderCount;
    for (let i = 0; i < 60; i++) {
      expect(stepOneVsync(16.67)).toBe(false);
    }
    expect(renderCount).toBe(rendersAtIdle);

    // Wake immediately (< 1 frame) on invalidate('scene')
    governor.invalidate('scene');
    expect(governor.isIdlePaused()).toBe(false);
    expect(pendingRafs.size).toBe(1);
    expect(stepOneVsync(16.67)).toBe(true);
    expect(renderCount).toBe(rendersAtIdle + 1);

    // Adaptive DPR step-down during heavy continuous interaction (> 20ms frames) & crisp snap-back on settle
    simulatedWorkMs = 26;
    governor.beginInteraction('gizmo');
    for (let i = 0; i < 6; i++) {
      stepOneVsync(28);
    }
    expect(governor.getPixelRatio()).toBeLessThan(2);

    simulatedWorkMs = 3;
    governor.endInteraction('gizmo');
    for (let i = 0; i < 20; i++) {
      stepOneVsync(25);
    }
    expect(governor.isIdlePaused()).toBe(true);
    expect(governor.getPixelRatio()).toBe(2);
    expect(appliedDprs.at(-1)).toBe(2);

    // Pointer-hover raycast rate limiter: <= 1 per frame, 0 for unchanged coords or active drag
    expect(governor.queueHoverPointer(120, 240)).toBe(true);
    expect(governor.queueHoverPointer(125, 245)).toBe(true); // Coalesces latest coords into 1 pending sample
    const consumed1 = governor.consumeHoverRaycast();
    expect(consumed1).toEqual({ x: 125, y: 245 });
    expect(governor.consumeHoverRaycast()).toBeNull(); // <= 1 hover raycast per animation frame!
    stepOneVsync(16.67);
    expect(governor.queueHoverPointer(125, 245)).toBe(false); // Unchanged pointer coords -> 0 work!
    expect(governor.queueHoverPointer(140, 260)).toBe(true);
    governor.beginInteraction('camera');
    expect(governor.queueHoverPointer(180, 300)).toBe(false); // Suppressed during orbit drag
    expect(governor.consumeHoverRaycast()).toBeNull();
    governor.dispose();
  });
});

describe('SkinDeformer pose-dirty O(1) cache & tight posed bounds (skinDeformer.ts)', () => {
  it('skips redundant vertex deformation on unchanged pose (cachedCallMs << firstCallMs) with byte-identical positions and recomputes when pose changes', () => {
    const fig = buildExternalFigure('male', characterTemplates.get('male')!, '#d9a17c');
    fig.root.position.set(0.8, 0, -0.4);
    const deformer = new SkinDeformer(fig);
    const actionPose = preset('Heroic');

    const tFirst0 = performance.now();
    const firstDiag = deformer.applyPose(actionPose);
    const firstCallMs = performance.now() - tFirst0;
    expect(firstDiag.skippedRedundant).toBe(false);

    const posAttr = fig.skin.geometry.getAttribute('position') as THREE.BufferAttribute;
    const firstBytes = new Uint8Array((posAttr.array as Float32Array).slice().buffer);
    const firstVersion = posAttr.version;

    // Bounding sphere must tightly enclose every posed vertex without clipping limbs
    const sphere = fig.skin.geometry.boundingSphere!;
    expect(sphere).not.toBeNull();
    expect(sphere.radius).toBeGreaterThan(0.4);
    expect(sphere.radius).toBeLessThan(2.5);
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i += 37) {
      v.fromBufferAttribute(posAttr, i);
      expect(v.distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-3);
    }

    // Second call with identical pose value (even a cloned Pose object) returns in O(1)
    const clonedSamePose = clone(actionPose);
    const tSecond0 = performance.now();
    const secondDiag = deformer.applyPose(clonedSamePose);
    const secondCallMs = performance.now() - tSecond0;

    expect(secondDiag.skippedRedundant).toBe(true);
    // Keep scheduler/JIT outliers from deciding a sub-millisecond cache budget.
    const cachedTimings = [secondCallMs];
    for (let i = 0; i < 8; i++) {
      const cachedPose = clone(actionPose);
      const start = performance.now();
      const diagnostic = deformer.applyPose(cachedPose);
      cachedTimings.push(performance.now() - start);
      expect(diagnostic.skippedRedundant).toBe(true);
    }
    const cachedCallMs = cachedTimings.sort((a, b) => a - b)[4];
    expect(cachedCallMs).toBeLessThan(0.25);
    expect(cachedCallMs).toBeLessThan(firstCallMs * 0.05);
    expect(posAttr.version).toBe(firstVersion); // Zero redundant GPU buffer re-upload!

    const secondBytes = new Uint8Array((posAttr.array as Float32Array).slice().buffer);
    expect(Buffer.compare(Buffer.from(firstBytes), Buffer.from(secondBytes))).toBe(0);

    // Mutating a joint angle immediately invalidates the cache and updates vertices
    const modifiedPose = clone(actionPose);
    modifiedPose.leftShoulder = [radians(-85), radians(30), radians(15)];
    const thirdDiag = deformer.applyPose(modifiedPose);
    expect(thirdDiag.skippedRedundant).toBe(false);
    const thirdBytes = new Uint8Array((posAttr.array as Float32Array).slice().buffer);
    expect(Buffer.compare(Buffer.from(firstBytes), Buffer.from(thirdBytes))).not.toBe(0);
  });
});

describe('CSG Boolean structural/content LRU memoization (booleans.ts)', () => {
  beforeEach(() => {
    clearBooleanCache();
  });

  it('returns cached geometry in O(1) on identical operand inputs and recomputes immediately when cutter transform or radius changes', () => {
    const boxA = new THREE.BoxGeometry(1.1, 1.1, 1.1, 4, 4, 4);
    const cutterSphere = new THREE.SphereGeometry(0.55, 32, 24);
    const transformA = {
      position: [0, 0.55, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    const transformB = {
      position: [0.3, 0.85, 0.3] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };

    const tCold0 = performance.now();
    const geo1 = evaluateBoolean(boxA, transformA, cutterSphere, transformB, 'subtract');
    const coldMs = performance.now() - tCold0;
    expect(getBooleanCacheStats()).toMatchObject({ hits: 0, misses: 1, size: 1 });

    // Repeat call with identical operands hits LRU cache in O(1)
    const tWarm0 = performance.now();
    const geo2 = evaluateBoolean(boxA, transformA, cutterSphere, transformB, 'subtract');
    const warmMs = performance.now() - tWarm0;

    expect(geo2).toBe(geo1);
    expect(getBooleanCacheStats()).toMatchObject({ hits: 1, misses: 1, size: 1 });
    expect(warmMs).toBeLessThan(0.25);
    expect(warmMs).toBeLessThan(coldMs * 0.1);

    // Freshly constructed BufferGeometry instances with identical parameters ALSO hit the content-hash cache
    const freshBoxA = new THREE.BoxGeometry(1.1, 1.1, 1.1, 4, 4, 4);
    const freshSphere = new THREE.SphereGeometry(0.55, 32, 24);
    const geo3 = evaluateBoolean(freshBoxA, transformA, freshSphere, transformB, 'subtract');
    expect(geo3).toBe(geo1);
    expect(getBooleanCacheStats().hits).toBe(2);

    // Changing cutter transform recomputes immediately
    const shiftedTransformB = {
      ...transformB,
      position: [0.52, 0.85, 0.3] as [number, number, number],
    };
    const geoShifted = evaluateBoolean(boxA, transformA, cutterSphere, shiftedTransformB, 'subtract');
    expect(geoShifted).not.toBe(geo1);
    expect(getBooleanCacheStats().misses).toBe(2);

    // Changing cutter radius recomputes immediately
    const largerSphere = new THREE.SphereGeometry(0.72, 32, 24);
    const geoLargerCut = evaluateBoolean(boxA, transformA, largerSphere, transformB, 'subtract');
    expect(geoLargerCut).not.toBe(geo1);
    expect(geoLargerCut).not.toBe(geoShifted);
    expect(getBooleanCacheStats().misses).toBe(3);

    // Multi-operand Boole generator node chain also memoizes across evaluateModelingNode
    const booleNode: BooleanModelingNode = {
      id: 'boole-perf-1',
      nodeType: 'boolean',
      name: 'Boole Test',
      operation: 'subtract',
      operands: [
        {
          id: 'op-cube',
          nodeType: 'primitive',
          name: 'Base Cube',
          primitive: {
            kind: 'cube',
            params: {
              width: 1,
              height: 1,
              depth: 1,
              segX: 2,
              segY: 2,
              segZ: 2,
              fillet: false,
              filletRadius: 0.05,
              filletSubdivisions: 1,
            },
          },
          transform: transformA,
          modifiers: [],
        },
        {
          id: 'op-sphere',
          nodeType: 'primitive',
          name: 'Cutter Sphere',
          primitive: {
            kind: 'sphere',
            params: {
              radius: 0.45,
              widthSegments: 24,
              heightSegments: 18,
              hemisphere: false,
              sliceDeg: 360,
            },
          },
          transform: transformB,
          modifiers: [],
        },
      ],
      transform: transformA,
      modifiers: [],
    };
    const hitsBeforeNode = getBooleanCacheStats().hits;
    const eval1 = evaluateModelingNode(booleNode);
    const eval2 = evaluateModelingNode(booleNode);
    expect(getBooleanCacheStats().hits).toBe(hitsBeforeNode + 1);
    expect(eval2.editableMesh.vertices.length).toBe(eval1.editableMesh.vertices.length);
    eval1.geometry.dispose();
    eval1.wireframeGeometry.dispose();
    eval2.geometry.dispose();
    eval2.wireframeGeometry.dispose();

    // Direct evaluateBooleanChain cache verification
    const chainOps = [
      { mesh: boxA, transform: transformA },
      { mesh: cutterSphere, transform: transformB },
    ];
    const chain1 = evaluateBooleanChain(chainOps, 'subtract');
    const chain2 = evaluateBooleanChain(chainOps, 'subtract');
    expect(chain2).toBe(chain1);

    boxA.dispose();
    cutterSphere.dispose();
    freshBoxA.dispose();
    freshSphere.dispose();
    largerSphere.dispose();
  });
});

describe('Non-blocking debounced IndexedDB persistence (storage.ts)', () => {
  const originalIndexedDb = globalThis.indexedDB;
  let putCount = 0;
  let records = new Map<string, unknown>();

  beforeEach(() => {
    closeCachedStorage();
    putCount = 0;
    records = new Map<string, unknown>();
    let storeCreated = false;
    const storeNames = {
      length: 0,
      contains: (n: string) => storeCreated && n === 'library',
      item: (i: number) => (storeCreated && i === 0 ? 'library' : null),
      [Symbol.iterator]: function* () {
        if (storeCreated) yield 'library';
      },
    } as unknown as DOMStringList;

    const factory = {
      open: () => {
        const db = {
          objectStoreNames: storeNames,
          onversionchange: null,
          onclose: null,
          createObjectStore: () => {
            storeCreated = true;
            (storeNames as { length: number }).length = 1;
            return {} as IDBObjectStore;
          },
          close: () => {},
          transaction: (_name: string, mode: IDBTransactionMode) => {
            const tx = {
              error: null,
              oncomplete: null as ((ev: Event) => unknown) | null,
              onerror: null,
              onabort: null,
              abort: () => {},
              objectStore: () => ({
                get: (key: string) => {
                  const req = {
                    result: records.has(key) ? clone(records.get(key)) : undefined,
                    error: null,
                  } as unknown as IDBRequest;
                  queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
                  return req;
                },
                put: (val: { id: string }) => {
                  if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                  putCount++;
                  const snap = clone(val);
                  records.set(snap.id, snap);
                  const req = { result: snap.id, error: null } as unknown as IDBRequest;
                  queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
                  return req;
                },
                delete: (key: string) => {
                  records.delete(key);
                  const req = { result: undefined, error: null } as unknown as IDBRequest;
                  queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
                  return req;
                },
              }),
            };
            return tx as unknown as IDBTransaction;
          },
        } as unknown as IDBDatabase;
        const req = {
          result: db,
          error: null,
          onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => unknown) | null,
          onsuccess: null as ((ev: Event) => unknown) | null,
          onerror: null,
          onblocked: null,
        };
        queueMicrotask(() => {
          if (!storeCreated) {
            req.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
          }
          req.onsuccess?.(new Event('success'));
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    Object.defineProperty(globalThis, 'indexedDB', {
      value: factory,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    closeCachedStorage();
    Object.defineProperty(globalThis, 'indexedDB', {
      value: originalIndexedDb,
      configurable: true,
      writable: true,
    });
  });

  it('coalesces 20 rapid scheduleSaveWorkingScene updates into 1 IndexedDB write and commits immediately on flushScheduledWorkingSceneSave', async () => {
    vi.useFakeTimers();
    const base = initialScene();

    // Fire 20 rapid slider updates spaced 10ms apart (< 280ms debounce window)
    for (let step = 1; step <= 20; step++) {
      const next = clone(base);
      next.camera.focalLength = 35 + step * 2;
      scheduleSaveWorkingScene(next, 280);
      vi.advanceTimersByTime(10);
    }

    // Still inside trailing 280ms settle window -> 0 IndexedDB writes so far
    expect(putCount).toBe(0);
    expect(getScheduledWorkingSceneSaveStats().hasPending).toBe(true);

    // Advance past 280ms debounce + idle callback dispatch
    await vi.advanceTimersByTimeAsync(320);

    expect(putCount).toBe(1);
    expect(getScheduledWorkingSceneSaveStats().hasPending).toBe(false);
    const loadedAfterCoalesce = await loadWorkingDraft();
    expect(loadedAfterCoalesce.draft?.scene.camera.focalLength).toBe(75);

    // Schedule another update and flush immediately before debounce timer expires
    const urgent = clone(base);
    urgent.camera.focalLength = 105;
    scheduleSaveWorkingScene(urgent, 280);
    expect(putCount).toBe(1);

    await flushScheduledWorkingSceneSave();
    expect(putCount).toBe(2);
    const loadedAfterFlush = await loadWorkingDraft();
    expect(loadedAfterFlush.draft?.scene.camera.focalLength).toBe(105);

    // Direct saveWorkingScene remains immediately awaitable
    const directScene = clone(base);
    directScene.camera.focalLength = 135;
    await saveWorkingScene(directScene);
    expect(putCount).toBe(3);
    expect((await loadWorkingDraft()).draft?.scene.camera.focalLength).toBe(135);

    await clearWorkingDraft();
  });
});
