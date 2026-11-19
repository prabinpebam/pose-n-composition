import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clone, createItem, initialScene, poseFile, preset, radians } from './model';
import {
  clearWorkingDraft,
  closeCachedStorage,
  deleteLocal,
  listSaved,
  loadWorkingDraft,
  sanitizeWorkingView,
  saveLocal,
  saveWorkingDraft,
  WORKING_SCENE_ID,
  WorkingDraftAutoSaver,
  type AutosaveStatus,
  type WorkingDraft,
} from './storage';

interface MockIdbHarness {
  factory: IDBFactory;
  rawRecords: Map<string, unknown>;
  setWriteDelayMs: (ms: number) => void;
  putCount: () => number;
}

function createMockIndexedDb(): MockIdbHarness {
  const rawRecords = new Map<string, unknown>();
  let writeDelayMs = 0;
  let puts = 0;
  let storeCreated = false;

  const storeNames: DOMStringList = {
    length: 0,
    contains: (name: string) => storeCreated && name === 'library',
    item: (index: number) => (storeCreated && index === 0 ? 'library' : null),
    [Symbol.iterator]: function* () {
      if (storeCreated) yield 'library';
    },
  } as DOMStringList;

  const scheduleComplete = (tx: { oncomplete: ((ev: Event) => unknown) | null }, delay: number) => {
    if (delay > 0) {
      setTimeout(() => tx.oncomplete?.(new Event('complete')), delay);
    } else {
      queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
    }
  };

  const makeDb = (): IDBDatabase => {
    let closed = false;
    const db = {
      objectStoreNames: storeNames,
      onversionchange: null as ((ev: IDBVersionChangeEvent) => unknown) | null,
      onclose: null as ((ev: Event) => unknown) | null,
      createObjectStore: (name: string) => {
        if (name === 'library') {
          storeCreated = true;
          (storeNames as { length: number }).length = 1;
        }
        return {} as IDBObjectStore;
      },
      close: () => {
        closed = true;
      },
      transaction: (_name: string, mode: IDBTransactionMode) => {
        if (closed) throw new Error('InvalidStateError: database connection is closing');
        const tx = {
          error: null as DOMException | null,
          oncomplete: null as ((ev: Event) => unknown) | null,
          onerror: null as ((ev: Event) => unknown) | null,
          onabort: null as ((ev: Event) => unknown) | null,
          abort: () => {
            queueMicrotask(() => tx.onabort?.(new Event('abort')));
          },
          objectStore: () => ({
            get: (key: string) => {
              const req = {
                result: rawRecords.has(key) ? clone(rawRecords.get(key)) : undefined,
                error: null,
              } as unknown as IDBRequest;
              scheduleComplete(tx, 0);
              return req;
            },
            getAll: () => {
              const req = {
                result: [...rawRecords.values()].map(v => clone(v)),
                error: null,
              } as unknown as IDBRequest;
              scheduleComplete(tx, 0);
              return req;
            },
            put: (value: { id: string }) => {
              if (mode !== 'readwrite') throw new Error('ReadOnlyError');
              puts += 1;
              const delay = writeDelayMs;
              const snapshot = clone(value);
              const req = { result: snapshot.id, error: null } as unknown as IDBRequest;
              if (delay > 0) {
                setTimeout(() => {
                  rawRecords.set(snapshot.id, snapshot);
                  tx.oncomplete?.(new Event('complete'));
                }, delay);
              } else {
                rawRecords.set(snapshot.id, snapshot);
                queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
              }
              return req;
            },
            delete: (key: string) => {
              if (mode !== 'readwrite') throw new Error('ReadOnlyError');
              rawRecords.delete(key);
              const req = { result: undefined, error: null } as unknown as IDBRequest;
              scheduleComplete(tx, 0);
              return req;
            },
          }),
        };
        return tx as unknown as IDBTransaction;
      },
    };
    return db as unknown as IDBDatabase;
  };

  const factory = {
    open: () => {
      const db = makeDb();
      const req = {
        result: db,
        error: null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => unknown) | null,
        onsuccess: null as ((ev: Event) => unknown) | null,
        onerror: null as ((ev: Event) => unknown) | null,
        onblocked: null as ((ev: IDBVersionChangeEvent) => unknown) | null,
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

  return {
    factory,
    rawRecords,
    setWriteDelayMs: (ms: number) => {
      writeDelayMs = ms;
    },
    putCount: () => puts,
  };
}

describe('IndexedDB immediate working-draft autosave and reload restoration', () => {
  const originalIndexedDb = globalThis.indexedDB;
  let harness: MockIdbHarness;

  beforeEach(() => {
    closeCachedStorage();
    harness = createMockIndexedDb();
    Object.defineProperty(globalThis, 'indexedDB', {
      value: harness.factory,
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

  it('round-trips full posed scene, props, hair, camera, and editor orbit viewport state', async () => {
    const empty = await loadWorkingDraft();
    expect(empty).toEqual({ draft: null, savedAt: null, corrupted: false });

    const scene = initialScene();
    scene.items[0]!.pose!.leftShoulder = [radians(-62), radians(24), radians(18)];
    scene.items[0]!.pose!.rightElbow = [radians(-94), radians(12), 0];
    scene.items[0]!.color = '#8d5524';
    scene.items[0]!.outfitColor = '#1e6b52';
    scene.items[0]!.hairStyle = 'buns';
    scene.items[0]!.hairColor = '#cc4422';
    scene.items[1]!.color = '#f5d0ba';
    scene.items[1]!.outfitColor = '#9b2c62';
    scene.items[1]!.pose = preset('Heroic');
    const chair = createItem('chair', 0);
    chair.position = [1.35, 0, -0.45];
    chair.rotation = [0, radians(35), 0];
    scene.items.push(chair);
    scene.background = '#1f2328';
    scene.camera.position = [1.85, 1.62, 3.15];
    scene.camera.target = [0.22, 1.08, -0.14];
    scene.camera.focalLength = 85;
    scene.camera.aspect = '4:5';
    scene.camera.dof = true;

    const draft: WorkingDraft = {
      scene,
      view: {
        editorCamera: { position: [4.8, 3.1, 2.9], target: [0.35, 1.15, -0.2] },
        selectedId: scene.items[0]!.id,
        selectedJoint: 'rightElbow',
        cameraView: true,
        transformMode: 'rotate',
      },
    };

    await saveWorkingDraft(draft);
    const restored = await loadWorkingDraft();
    expect(restored.corrupted).toBe(false);
    expect(restored.savedAt).toEqual(expect.any(String));
    expect(restored.draft?.scene).toEqual(scene);
    expect(restored.draft?.view).toEqual(draft.view);
  });

  it('keeps working-draft autosave strictly isolated from named Library studies', async () => {
    const namedScene = initialScene();
    namedScene.name = 'Portrait study';
    const namedPose = poseFile(namedScene.items[0]!, 'Dynamic reach');

    await saveLocal(namedScene);
    await saveLocal(namedPose);

    const editedWorking = initialScene();
    editedWorking.items[0]!.pose!.head = [0.3, -0.4, 0.1];
    await saveWorkingDraft({
      scene: editedWorking,
      view: { selectedId: editedWorking.items[0]!.id, selectedJoint: 'head' },
    });

    const listed = await listSaved();
    expect(listed.map(s => s.name).sort()).toEqual(['Dynamic reach', 'Portrait study']);
    expect(listed.some(s => s.id === WORKING_SCENE_ID || s.id.startsWith('__autosave__:'))).toBe(false);

    // Deleting a named study leaves the working draft intact.
    await deleteLocal('scene:Portrait study');
    expect((await listSaved()).map(s => s.name)).toEqual(['Dynamic reach']);
    const afterDelete = await loadWorkingDraft();
    expect(afterDelete.draft?.scene.items[0]!.pose!.head).toEqual([0.3, -0.4, 0.1]);

    // Refuses accidental deletion of internal autosave key via deleteLocal.
    await expect(deleteLocal(WORKING_SCENE_ID)).rejects.toThrow('internal autosave');

    await clearWorkingDraft();
    expect((await loadWorkingDraft()).draft).toBeNull();
    expect((await listSaved()).map(s => s.name)).toEqual(['Dynamic reach']);
  });

  it('gates autosave until markHydrated so boot never overwrites an existing saved working draft', async () => {
    const savedBeforeReload = initialScene();
    savedBeforeReload.items[0]!.pose!.leftShoulder = [0.75, -0.35, 0.25];
    savedBeforeReload.background = '#22262c';
    await saveWorkingDraft({
      scene: savedBeforeReload,
      view: { editorCamera: { position: [5.5, 2.8, 4.1], target: [0.1, 1.0, 0] } },
    });
    const putsAfterSetup = harness.putCount();

    // Simulate new page mount before async asset + IndexedDB hydration finishes.
    const saver = new WorkingDraftAutoSaver({ throttleMs: 20 });
    const freshDefaultScene = initialScene();
    await saver.saveNow({ scene: freshDefaultScene });
    saver.schedule({ scene: freshDefaultScene });
    await saver.flush();

    expect(harness.putCount()).toBe(putsAfterSetup);
    const loadedDuringBoot = await loadWorkingDraft();
    expect(loadedDuringBoot.draft?.scene.items[0]!.pose!.leftShoulder).toEqual([0.75, -0.35, 0.25]);
    expect(loadedDuringBoot.draft?.scene.background).toBe('#22262c');

    // Hydrating with the restored draft does not emit a redundant write, then subsequent manual edit writes immediately.
    saver.markHydrated(loadedDuringBoot.draft, true);
    await saver.saveNow(loadedDuringBoot.draft!);
    expect(harness.putCount()).toBe(putsAfterSetup);

    const postBootEdit = clone(loadedDuringBoot.draft!.scene);
    postBootEdit.items[0]!.pose!.leftElbow = [-1.1, 0.2, 0];
    await saver.saveNow({ scene: postBootEdit, view: loadedDuringBoot.draft!.view });
    expect(harness.putCount()).toBe(putsAfterSetup + 1);

    const reloadedAgain = await loadWorkingDraft();
    expect(reloadedAgain.draft?.scene.items[0]!.pose!.leftElbow).toEqual([-1.1, 0.2, 0]);
  });

  it('serializes rapid sequential updates (latest-wins) so slow IndexedDB writes never resolve out of order', async () => {
    harness.setWriteDelayMs(25);
    const statuses: AutosaveStatus[] = [];
    const saver = new WorkingDraftAutoSaver({
      throttleMs: 15,
      onStatus: s => statuses.push(s),
    });
    const base = initialScene();
    saver.markHydrated({ scene: base }, false);

    // Fire 15 rapid sequential pose edits while the first write is still in flight.
    const promises: Promise<void>[] = [];
    for (let step = 1; step <= 15; step++) {
      const next = clone(base);
      next.items[0]!.pose!.rightShoulder = [-0.08 * step, 0.04 * step, 0];
      promises.push(saver.saveNow({ scene: next }));
    }
    await Promise.all(promises);

    // First write ran immediately; steps 2..15 coalesced into one trailing write = 2 total IDB puts.
    expect(harness.putCount()).toBe(2);
    expect(statuses.at(-1)).toBe('saved');

    const finalLoaded = await loadWorkingDraft();
    expect(finalLoaded.draft?.scene.items[0]!.pose!.rightShoulder).toEqual([-0.08 * 15, 0.04 * 15, 0]);
  });

  it('throttles mid-drag 60fps updates and flushes immediately on pointerup/unload', async () => {
    vi.useFakeTimers();
    const writtenAngles: number[] = [];
    const saver = new WorkingDraftAutoSaver({
      throttleMs: 120,
      save: async draft => {
        writtenAngles.push(draft.scene.items[0]!.pose!.leftKnee[0]);
      },
    });
    const base = initialScene();
    saver.markHydrated({ scene: base }, false);

    for (let frame = 1; frame <= 5; frame++) {
      const midDrag = clone(base);
      midDrag.items[0]!.pose!.leftKnee = [frame * 0.1, 0, 0];
      saver.schedule({ scene: midDrag });
    }
    expect(writtenAngles).toEqual([]);

    // Advance partway (before 120ms timer expires) and flush on unload/pointerup.
    vi.advanceTimersByTime(50);
    expect(writtenAngles).toEqual([]);
    await saver.flush();
    expect(writtenAngles).toEqual([0.5]);
  });

  it('recovers gracefully from a corrupted working-draft record without crashing or losing named saves', async () => {
    const validNamed = initialScene();
    validNamed.name = 'Kept masterpiece';
    await saveLocal(validNamed);

    // Inject corrupted autosave payload directly into the underlying store.
    harness.rawRecords.set(WORKING_SCENE_ID, {
      id: WORKING_SCENE_ID,
      kind: 'working_scene',
      savedAt: '2026-11-19T00:00:00.000Z',
      scene: { schemaVersion: 1, rigVersion: 1, type: 'scene', name: 'Broken', items: [{ bad: true }] },
    });

    const result = await loadWorkingDraft();
    expect(result.draft).toBeNull();
    expect(result.corrupted).toBe(true);
    expect(result.warning).toContain('Named Library saves are untouched');

    // Named study remains intact, and sanitizing malformed view fields preserves valid scene data.
    expect((await listSaved()).map(s => s.name)).toEqual(['Kept masterpiece']);
    const sanitized = sanitizeWorkingView(
      {
        editorCamera: { position: [NaN, 1, 2], target: [0, 1, 0] },
        selectedId: 'missing-item-id',
        selectedJoint: 'notAJoint',
      },
      validNamed,
    );
    expect(sanitized.selectedId).toBe(validNamed.items[0]!.id);
    expect(sanitized.selectedJoint).toBeNull();
    expect(sanitized.editorCamera).toBeUndefined();
  });
});
