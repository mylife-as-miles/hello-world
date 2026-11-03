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
  /**
   * Minimum interval between saves of routine simulation changes (ms). Default 5000:
   * the world ticks every 500 ms, and rewriting the whole snapshot that often is wasted work.
   */
  saveDebounceMs?: number;
  /**
   * Delay before saving after a `dispatch` (viewer/server action such as join, avatar update, gift), in ms.
   * Default 300 (never longer than `saveDebounceMs`), so deliberate changes persist almost immediately.
   */
  eventSaveDelayMs?: number;
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
  const interval = Math.max(0, options.saveDebounceMs ?? 5000);
  const eventDelay = Math.min(interval, Math.max(0, options.eventSaveDelayMs ?? 300));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = Infinity;
  let pending: Promise<void> = Promise.resolve();
  const saveNow = () => {
    if (timer) clearTimeout(timer);
    timer = undefined; due = Infinity;
    pending = pending.then(() => storage.save(runtime.getSnapshot())).catch(() => {});
  };
  /** Throttle: a pending save is only ever brought forward, never postponed (no starvation while the world ticks). */
  const schedule = (ms: number) => {
    const at = Date.now() + ms;
    if (timer && at >= due) return;
    if (timer) clearTimeout(timer);
    due = at;
    timer = setTimeout(saveNow, ms);
  };
  const unsub = runtime.subscribe(() => schedule(interval));
  const onHide = () => { if (timer) saveNow(); };
  const onVisibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') onHide(); };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  saveNow();
  const baseDispose = runtime.dispose.bind(runtime);
  const baseDispatch = runtime.dispatch.bind(runtime);
  return Object.assign(runtime, {
    storage,
    restored: Boolean(saved),
    // dispatch applies the event synchronously, so the next save already contains it
    dispatch: (event: Parameters<typeof baseDispatch>[0]) => { baseDispatch(event); schedule(eventDelay); },
    flush: async () => { saveNow(); await pending; },
    dispose: () => {
      unsub();
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      saveNow();
      baseDispose();
    },
  });
}
