// Where saved heroes live.
//
// The game used to put its whole state in one localStorage key. That is a string quota of about
// five megabytes for the entire origin, and with the persistent-levels option every level visited
// is kept -- three typed arrays of w*h bytes each, base64'd on the way out. A deep run can reach
// the quota, and a failed setItem is silent, so the player loses the save without being told.
//
// So: IndexedDB, which is orders of magnitude larger and asynchronous, several named slots instead
// of one, a migration for the old key, and a fallback to localStorage when IndexedDB is missing or
// blocked (private windows, embedded webviews). Failures are reported, never swallowed.
const DB_NAME = 'gauntlet-of-angband';
const DB_VERSION = 1;
const STORE = 'saves';
/** Where the fallback writes, one key per slot. */
const LS_PREFIX = 'gauntlet-of-angband.slot.';
/** The single key the game used before slots existed. */
export const LEGACY_SAVE_KEY = 'gauntlet-of-angband.save.v1';

/** What the title screen shows about a slot, without loading the whole thing. */
export interface SaveMeta {
  id: string;
  name: string;
  race: string;
  cls: string;
  lev: number;
  depth: number;
  maxDepth: number;
  turn: number;
  savedAt: number;
  dead?: boolean;
}
export interface SaveRecord extends SaveMeta { data: string; }

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(db => {
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      try {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(null);
        t.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  });
}

/** True when IndexedDB is actually usable; the fallback is in play otherwise. */
export async function storageReady(): Promise<boolean> { return (await openDb()) !== null; }

// ---------------------------------------------------------------------------------------------
// The localStorage fallback

function lsList(): SaveRecord[] {
  const out: SaveRecord[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try { out.push(JSON.parse(raw) as SaveRecord); } catch { /* a corrupt slot is skipped, not fatal */ }
    }
  } catch { /* storage disabled entirely */ }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The API the game uses

/**
 * Every slot, from both stores. The two must be read TOGETHER, not one or the other: a write falls
 * back to localStorage whenever an individual IndexedDB operation fails, and whether IndexedDB
 * works can change between sessions (a private window, a storage permission, an embedded webview).
 * Reading only IndexedDB when it happens to be available would leave every hero saved during a
 * fallback session intact on disk and permanently invisible.
 */
export async function listSaves(): Promise<SaveMeta[]> {
  const rows = (await tx<SaveRecord[]>('readonly', s => s.getAll())) ?? [];
  const spare = lsList().filter(r => !rows.some(x => x.id === r.id));
  return [...rows, ...spare]
    .map(({ data: _data, ...meta }) => meta as SaveMeta)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function readSave(id: string): Promise<string | null> {
  // IDBObjectStore.get resolves undefined for a missing key and tx resolves null when the database
  // is unusable, so anything but a row means "look in the other store".
  const row = await tx<SaveRecord | undefined>('readonly', s => s.get(id));
  if (row) return row.data;
  try { const raw = localStorage.getItem(LS_PREFIX + id); if (raw) return (JSON.parse(raw) as SaveRecord).data; } catch { /* nothing there either */ }
  return null;
}

/** Returns null on success, or a short reason the player can be told. */
export async function writeSave(rec: SaveRecord): Promise<string | null> {
  const done = await tx<IDBValidKey>('readwrite', s => s.put(rec));
  if (done !== null) return null;
  try {
    localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify(rec));
    return null;
  } catch (e) {
    const name = (e as { name?: string }).name;
    return name === 'QuotaExceededError' ? 'there is no room left in this browser' : 'this browser will not let the game save';
  }
}

export async function deleteSave(id: string): Promise<void> {
  // Remove it from both stores: a slot can exist in either, and a delete that missed one would
  // bring the hero back the next time the lists are merged.
  await tx<undefined>('readwrite', s => s.delete(id));
  try { localStorage.removeItem(LS_PREFIX + id); } catch { /* ignore */ }
}

/**
 * Move a save written by the old single-key version into a slot, once. Returns the slot id if one
 * was imported. The old key is only removed after the new record is safely written.
 */
export async function migrateLegacySave(meta: (json: string) => Omit<SaveMeta, 'id' | 'savedAt'> | null): Promise<string | null> {
  let json: string | null = null;
  try { json = localStorage.getItem(LEGACY_SAVE_KEY); } catch { return null; }
  if (!json) return null;
  const m = meta(json);
  if (!m) { try { localStorage.removeItem(LEGACY_SAVE_KEY); } catch { /* ignore */ } return null; }
  const id = newSlotId();
  const err = await writeSave({ ...m, id, savedAt: Date.now(), data: json });
  if (err) return null;
  try { localStorage.removeItem(LEGACY_SAVE_KEY); } catch { /* ignore */ }
  return id;
}

let slotCounter = 0;
export function newSlotId(): string {
  slotCounter++;
  return `s${Date.now().toString(36)}${slotCounter.toString(36)}`;
}
