import { validatePortable, type Portable } from './model';

export interface Saved { id: string; name: string; type: Portable['type']; savedAt: string; data: Portable }
const DB_NAME = 'pose-n-composition-v1';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore('library', { keyPath: 'id' });
    request.onerror = () => { failed = true; reject(new Error(`Storage unavailable: ${request.error?.message ?? 'IndexedDB error'}`)); };
    request.onblocked = () => { failed = true; reject(new Error('Storage upgrade blocked. Close other Pose & Composition tabs and retry.')); };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function listSaved(): Promise<Saved[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('library', 'readonly');
    const request = tx.objectStore('library').getAll();
    tx.oncomplete = () => { db.close(); resolve((request.result as Saved[]).sort((a, b) => b.savedAt.localeCompare(a.savedAt))); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error(`Could not read library: ${tx.error?.message ?? 'transaction aborted'}`)); };
  });
}
export async function saveLocal(data: Portable): Promise<void> {
  const validated = validatePortable(data);
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('library', 'readwrite');
    tx.objectStore('library').put({ id: `${data.type}:${data.name}`, name: data.name, type: data.type, savedAt: new Date().toISOString(), data: validated } satisfies Saved);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error(`Save failed: ${tx.error?.message ?? 'transaction aborted'}. Download a JSON backup instead.`)); };
  });
}
export async function deleteLocal(id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('library', 'readwrite');
    tx.objectStore('library').delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error(`Delete failed: ${tx.error?.message ?? 'transaction aborted'}`)); };
  });
}
export function download(data: Portable): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${data.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60)}.${data.type}.json`);
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
