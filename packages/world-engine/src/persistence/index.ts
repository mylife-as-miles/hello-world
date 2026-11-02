/**
 * Browser persistence for standalone/local worlds (dev harness, offline demo).
 * In the integrated product the SERVER persists snapshots; Codex's web client
 * keeps its own Dexie cache. This module gives the engine a versioned,
 * self-contained store with an in-memory fallback (tests, private browsing).
 */
import Dexie, { type Table } from 'dexie';
import type { WorldSnapshot } from '@hello-world/contracts';
import { createWorldRuntime, type WorldEngineRuntime, type WorldEngineRuntimeOptions } from '../runtime/createWorldRuntime';
import { migrateSnapshot } from '../runtime/migrate';

export interface SnapshotStorage {
  readonly kind: 'indexeddb' | 'memory';
  load(worldId: string): Promise<WorldSnapshot | null>;
  save(snapshot: WorldSnapshot): Promise<void>;
  clear(worldId: string): Promise<void>;
}

interface SaveRow { worldId: string; engineSaveVersion: number; savedAt: number; snapshot: WorldSnapshot }
/** Bump when the stored row format changes; migrateSnapshot handles snapshot schema changes. */
export const ENGINE_SAVE_VERSION = 1;

class EngineDb extends Dexie {
  saves!: Table<SaveRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ saves: 'worldId,savedAt' });
  }
}

export function createMemorySnapshotStorage(): SnapshotStorage {
  const rows = new Map<string, string>();
  return {
    kind: 'memory',
    async load(worldId) { const raw = rows.get(worldId); return raw ? migrateSnapshot(JSON.parse(raw)) : null; },
    async save(snapshot) { rows.set(snapshot.worldId, JSON.stringify(snapshot)); },
    async clear(worldId) { rows.delete(worldId); },
  };
}

/** IndexedDB (Dexie) storage; falls back to memory when IndexedDB is unavailable. */
export function createIndexedDbSnapshotStorage(dbName = 'hello-world-engine'): SnapshotStorage {
  if (typeof indexedDB === 'undefined') return createMemorySnapshotStorage();
  const db = new EngineDb(dbName);
  const memory = createMemorySnapshotStorage();
  let broken = false;
  return {
    kind: 'indexeddb',
    async load(worldId) {
      if (broken) return memory.load(worldId);
      try {
        const row = await db.saves.get(worldId);
        if (!row || row.engineSaveVersion > ENGINE_SAVE_VERSION) return null;
        return migrateSnapshot(row.snapshot);
      } catch { broken = true; return memory.load(worldId); }
    },
    async save(snapshot) {
      if (broken) return memory.save(snapshot);
      try {
        // Snapshots are frozen; store a structured clone-able plain copy.
        await db.saves.put({ worldId: snapshot.worldId, engineSaveVersion: ENGINE_SAVE_VERSION, savedAt: Date.now(), snapshot: JSON.parse(JSON.stringify(snapshot)) });
      } catch { broken = true; await memory.save(snapshot); }
    },
    async clear(worldId) { try { await db.saves.delete(worldId); } catch { /* ignore */ } await memory.clear(worldId); },
  };
}

export interface PersistentRuntimeOptions extends WorldEngineRuntimeOptions {
  storage?: SnapshotStorage;
  /** Debounce between saves (ms). Default 1500. */
  saveDebounceMs?: number;
}

export interface PersistentWorldRuntime extends WorldEngineRuntime {
  readonly storage: SnapshotStorage;
  /** Resolves once the last pending save has been written. */
  flush(): Promise<void>;
  /** True when this runtime restored an existing save. */
  readonly restored: boolean;
}

/**
 * Load a saved world (if any), create a runtime from it, and save debounced
 * snapshots back. Use for standalone/local worlds; the server has its own.
 */
export async function createPersistentWorldRuntime(options: PersistentRuntimeOptions = {}): Promise<PersistentWorldRuntime> {
  const storage = options.storage ?? createIndexedDbSnapshotStorage();
  const worldId = options.worldId ?? 'hello-neighborhood';
  const saved = options.initialSnapshot ?? await storage.load(worldId);
  const runtime = createWorldRuntime({ ...options, worldId, initialSnapshot: saved ?? undefined });
  const debounce = options.saveDebounceMs ?? 1500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const saveNow = () => { timer = undefined; pending = pending.then(() => storage.save(runtime.getSnapshot())).catch(() => {}); };
  const unsub = runtime.subscribe(() => { if (!timer) timer = setTimeout(saveNow, debounce); });
  const onHide = () => { if (timer) { clearTimeout(timer); saveNow(); } };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
  saveNow();
  const baseDispose = runtime.dispose.bind(runtime);
  return Object.assign(runtime, {
    storage,
    restored: Boolean(saved),
    flush: async () => { if (timer) clearTimeout(timer); saveNow(); await pending; },
    dispose: () => {
      unsub();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
      if (timer) clearTimeout(timer);
      saveNow();
      baseDispose();
    },
  });
}
