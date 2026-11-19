import {
  clone,
  isBody,
  JOINTS,
  validatePortable,
  type Joint,
  type Portable,
  type SceneState,
  type Vec3,
} from './model';

export interface Saved { id: string; name: string; type: Portable['type']; savedAt: string; data: Portable }
export const WORKING_SCENE_ID = '__autosave__:working_scene' as const;
export const DEFAULT_ORBIT_VIEW: OrbitViewState = { position: [3.2, 2.4, 5.2], target: [0, 0.95, 0] };

export interface OrbitViewState {
  position: Vec3;
  target: Vec3;
}

export interface WorkingViewState {
  editorCamera?: OrbitViewState;
  selectedId?: string | null;
  selectedJoint?: Joint | null;
  cameraView?: boolean;
  transformMode?: 'translate' | 'rotate' | 'scale';
}

export interface WorkingDraft {
  scene: SceneState;
  view?: WorkingViewState;
}

export interface WorkingDraftLoadResult {
  draft: WorkingDraft | null;
  savedAt: string | null;
  corrupted: boolean;
  warning?: string;
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface StoredWorkingRecord {
  id: typeof WORKING_SCENE_ID;
  kind: 'working_scene';
  savedAt: string;
  scene: SceneState;
  view: WorkingViewState;
}

const DB_NAME = 'pose-n-composition-v1';
let cachedDb: IDBDatabase | null = null;
let cachedDbPromise: Promise<IDBDatabase> | null = null;
let cachedFactory: IDBFactory | undefined;

function clearCachedDb(target?: IDBDatabase): void {
  if (!target || cachedDb === target) {
    cachedDb = null;
    cachedDbPromise = null;
  }
}

export function closeCachedStorage(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      // Ignore already-closed handles.
    }
  }
  cachedDb = null;
  cachedDbPromise = null;
  cachedFactory = undefined;
}

function getDb(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) {
    return Promise.reject(new Error('Storage unavailable: IndexedDB is not supported in this environment.'));
  }
  if (cachedFactory !== factory) {
    closeCachedStorage();
    cachedFactory = factory;
  }
  if (cachedDb) return Promise.resolve(cachedDb);
  if (cachedDbPromise) return cachedDbPromise;

  cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, 1);
    } catch (err) {
      cachedDbPromise = null;
      reject(new Error(`Storage unavailable: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    let failed = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('library')) {
        request.result.createObjectStore('library', { keyPath: 'id' });
      }
    };
    request.onerror = () => {
      failed = true;
      cachedDbPromise = null;
      reject(new Error(`Storage unavailable: ${request.error?.message ?? 'IndexedDB error'}`));
    };
    request.onblocked = () => {
      failed = true;
      cachedDbPromise = null;
      reject(new Error('Storage upgrade blocked. Close other Pose & Composition tabs and retry.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        clearCachedDb(db);
      };
      db.onclose = () => {
        clearCachedDb(db);
      };
      cachedDb = db;
      resolve(db);
    };
  });
  return cachedDbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T> | void,
  errorPrefix: string,
): Promise<T> {
  const executeOnDb = (db: IDBDatabase, allowRetry: boolean): Promise<T> => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction('library', mode);
    } catch (err) {
      clearCachedDb(db);
      if (allowRetry) return getDb().then(fresh => executeOnDb(fresh, false));
      return Promise.reject(new Error(`${errorPrefix}: ${err instanceof Error ? err.message : String(err)}`));
    }
    return new Promise<T>((resolve, reject) => {
      let req: IDBRequest<T> | undefined;
      try {
        req = executor(tx.objectStore('library')) ?? undefined;
      } catch (err) {
        try {
          tx.abort();
        } catch {
          // Ignore abort errors after synchronous failure.
        }
        reject(new Error(`${errorPrefix}: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
      tx.onerror = tx.onabort = () =>
        reject(new Error(`${errorPrefix}: ${tx.error?.message ?? req?.error?.message ?? 'transaction aborted'}`));
    });
  };

  if (cachedDb && cachedFactory === globalThis.indexedDB) {
    return executeOnDb(cachedDb, true);
  }
  return getDb().then(db => executeOnDb(db, false));
}

function isInternalRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const rec = value as { id?: unknown; kind?: unknown };
  return (typeof rec.id === 'string' && rec.id.startsWith('__autosave__:')) || rec.kind === 'working_scene';
}

function parseBoundedVec3(value: unknown, min: number, max: number): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const out: number[] = [];
  for (const coord of value) {
    if (typeof coord !== 'number' || !Number.isFinite(coord) || coord < min || coord > max) return undefined;
    out.push(coord);
  }
  return out as Vec3;
}

export function sanitizeWorkingView(rawView: unknown, scene: SceneState): WorkingViewState {
  const fallbackSelected = scene.items[0]?.id ?? null;
  if (!rawView || typeof rawView !== 'object' || Array.isArray(rawView)) {
    return { selectedId: fallbackSelected, selectedJoint: null, cameraView: false, transformMode: 'translate' };
  }
  const v = rawView as Record<string, unknown>;
  let editorCamera: OrbitViewState | undefined;
  if (v.editorCamera && typeof v.editorCamera === 'object' && !Array.isArray(v.editorCamera)) {
    const ec = v.editorCamera as Record<string, unknown>;
    const position = parseBoundedVec3(ec.position, -500, 500);
    const target = parseBoundedVec3(ec.target, -500, 500);
    if (position && target) editorCamera = { position, target };
  }
  let selectedId: string | null = fallbackSelected;
  if (v.selectedId === null) {
    selectedId = null;
  } else if (typeof v.selectedId === 'string' && scene.items.some(i => i.id === v.selectedId)) {
    selectedId = v.selectedId;
  }
  const selectedItem = selectedId ? scene.items.find(i => i.id === selectedId) : undefined;
  let selectedJoint: Joint | null = null;
  if (
    selectedItem &&
    isBody(selectedItem.kind) &&
    typeof v.selectedJoint === 'string' &&
    (JOINTS as readonly string[]).includes(v.selectedJoint)
  ) {
    selectedJoint = v.selectedJoint as Joint;
  }
  const cameraView = typeof v.cameraView === 'boolean' ? v.cameraView : false;
  const transformMode =
    v.transformMode === 'translate' || v.transformMode === 'rotate' || v.transformMode === 'scale'
      ? v.transformMode
      : 'translate';
  return {
    ...(editorCamera ? { editorCamera } : {}),
    selectedId,
    selectedJoint,
    cameraView,
    transformMode,
  };
}

function normalizeSceneForWorkingDraft(scene: SceneState): SceneState {
  const next = clone(scene);
  if (!next.name || !next.name.trim()) next.name = 'Untitled study';
  next.items = next.items.map((item, idx) => ({
    ...item,
    name: item.name && item.name.trim() ? item.name.slice(0, 80) : `${item.kind[0]!.toUpperCase()}${item.kind.slice(1)} ${idx + 1}`,
  }));
  const validated = validatePortable(next);
  if (validated.type !== 'scene') throw new Error('Working draft must be a scene.');
  return validated;
}

export async function saveWorkingDraft(draft: WorkingDraft): Promise<void> {
  const validatedScene = normalizeSceneForWorkingDraft(draft.scene);
  const sanitizedView = sanitizeWorkingView(draft.view, validatedScene);
  const record: StoredWorkingRecord = {
    id: WORKING_SCENE_ID,
    kind: 'working_scene',
    savedAt: new Date().toISOString(),
    scene: validatedScene,
    view: sanitizedView,
  };
  await runTransaction(
    'readwrite',
    store => store.put(record),
    'Autosave failed',
  );
}

export async function loadWorkingDraft(): Promise<WorkingDraftLoadResult> {
  const raw = await runTransaction<unknown>(
    'readonly',
    store => store.get(WORKING_SCENE_ID),
    'Could not read working draft',
  );
  if (raw === undefined || raw === null) {
    return { draft: null, savedAt: null, corrupted: false };
  }
  try {
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Malformed working draft record');
    }
    const rec = raw as Record<string, unknown>;
    const validated = validatePortable(rec.scene);
    if (validated.type !== 'scene') {
      throw new Error('Working draft does not contain a scene');
    }
    const view = sanitizeWorkingView(rec.view, validated);
    return {
      draft: { scene: validated, view },
      savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : null,
      corrupted: false,
    };
  } catch {
    return {
      draft: null,
      savedAt: null,
      corrupted: true,
      warning: 'Previous autosaved draft could not be read; opened default studio scene. Named Library saves are untouched.',
    };
  }
}

export async function clearWorkingDraft(): Promise<void> {
  await runTransaction('readwrite', store => store.delete(WORKING_SCENE_ID), 'Could not clear working draft');
}

function serializeDraft(draft: WorkingDraft): string {
  return JSON.stringify({ scene: draft.scene, view: draft.view ?? null });
}

export interface WorkingDraftAutoSaverOptions {
  save?: (draft: WorkingDraft) => Promise<void>;
  throttleMs?: number;
  onStatus?: (status: AutosaveStatus, error?: unknown) => void;
}

export class WorkingDraftAutoSaver {
  private readonly saveFn: (draft: WorkingDraft) => Promise<void>;
  private readonly throttleMs: number;
  private readonly onStatus?: (status: AutosaveStatus, error?: unknown) => void;
  private hydrated = false;
  private disposed = false;
  private inFlight: Promise<void> | null = null;
  private pending: WorkingDraft | null = null;
  private pendingSerialized: string | null = null;
  private lastSavedSerialized: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleResolvers: Array<() => void> = [];

  constructor(options: WorkingDraftAutoSaverOptions = {}) {
    this.saveFn = options.save ?? saveWorkingDraft;
    this.throttleMs = options.throttleMs ?? 120;
    this.onStatus = options.onStatus;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  markHydrated(initialDraft?: WorkingDraft | null, restoredFromStorage = false): void {
    if (this.disposed) return;
    this.hydrated = true;
    if (initialDraft) {
      this.lastSavedSerialized = serializeDraft(initialDraft);
    }
    this.onStatus?.(restoredFromStorage ? 'saved' : 'idle');
  }

  saveNow(draft: WorkingDraft): Promise<void> {
    if (!this.hydrated || this.disposed) return Promise.resolve();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = clone(draft);
    const serialized = serializeDraft(snapshot);
    if (this.inFlight === null && this.pending === null && serialized === this.lastSavedSerialized) {
      return Promise.resolve();
    }
    if (this.pending !== null && serialized === this.pendingSerialized && this.inFlight !== null) {
      return this.whenIdle();
    }
    this.pending = snapshot;
    this.pendingSerialized = serialized;
    this.pump();
    return this.whenIdle();
  }

  schedule(draft: WorkingDraft): void {
    if (!this.hydrated || this.disposed) return;
    const snapshot = clone(draft);
    const serialized = serializeDraft(snapshot);
    if (this.inFlight === null && this.timer === null && this.pending === null && serialized === this.lastSavedSerialized) {
      return;
    }
    this.pending = snapshot;
    this.pendingSerialized = serialized;
    this.onStatus?.('saving');
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, this.throttleMs);
    }
  }

  flush(): Promise<void> {
    if (!this.hydrated || this.disposed) return Promise.resolve();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending !== null) {
      this.pump();
    }
    return this.whenIdle();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.pendingSerialized = null;
    this.resolveIdle();
  }

  private whenIdle(): Promise<void> {
    if (this.inFlight === null && this.pending === null && this.timer === null) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdle(): void {
    if (this.idleResolvers.length === 0) return;
    const resolvers = this.idleResolvers.splice(0, this.idleResolvers.length);
    for (const resolve of resolvers) resolve();
  }

  private pump(): void {
    if (this.inFlight !== null || this.pending === null || this.disposed) return;
    const next = this.pending;
    const nextSerialized = this.pendingSerialized;
    this.pending = null;
    this.pendingSerialized = null;
    this.onStatus?.('saving');

    let rawWrite: Promise<void>;
    try {
      rawWrite = this.saveFn(next);
    } catch (err) {
      rawWrite = Promise.reject(err);
    }

    this.inFlight = rawWrite.then(
      () => {
        this.lastSavedSerialized = nextSerialized;
        this.inFlight = null;
        if (this.disposed) {
          this.resolveIdle();
          return;
        }
        if (this.pending !== null) {
          if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
          }
          this.pump();
        } else if (this.timer === null) {
          this.onStatus?.('saved');
          this.resolveIdle();
        }
      },
      err => {
        this.inFlight = null;
        if (this.disposed) {
          this.resolveIdle();
          return;
        }
        if (this.pending !== null) {
          if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
          }
          this.pump();
        } else {
          this.onStatus?.('error', err);
          this.resolveIdle();
        }
      },
    );
  }
}

export async function listSaved(): Promise<Saved[]> {
  const records = await runTransaction<unknown[]>(
    'readonly',
    store => store.getAll(),
    'Could not read library',
  );
  return records
    .filter(
      (entry): entry is Saved =>
        Boolean(
          entry &&
            typeof entry === 'object' &&
            !isInternalRecord(entry) &&
            'data' in entry &&
            'savedAt' in entry &&
            typeof (entry as Saved).savedAt === 'string',
        ),
    )
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function saveLocal(data: Portable): Promise<void> {
  const validated = validatePortable(data);
  await runTransaction(
    'readwrite',
    store =>
      store.put({
        id: `${data.type}:${data.name}`,
        name: data.name,
        type: data.type,
        savedAt: new Date().toISOString(),
        data: validated,
      } satisfies Saved),
    'Save failed. Download a JSON backup instead',
  );
}
export async function deleteLocal(id: string): Promise<void> {
  if (id.startsWith('__autosave__:')) {
    throw new Error('Delete failed: cannot delete internal autosave state via Library');
  }
  await runTransaction('readwrite', store => store.delete(id), 'Delete failed');
}
export function download(data: Portable): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${data.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}.${data.type}.json`);
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
