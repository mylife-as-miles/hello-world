/**
 * SceneStore — bridges a contract WorldRuntime (local or remote read-only
 * snapshot adapter) to the render loop WITHOUT React re-rendering per tick.
 *
 *  - Holds the latest snapshot + previous snapshot + client receive times.
 *  - Detects events that are NEW to this client (by id) and fans them out to
 *    reaction listeners (gestures, bubbles, confetti, portal...).
 *  - Notifies "structure" listeners only when the resident set or any
 *    resident's appearance/name changes (that is when React must re-render).
 * Render code should read `store.current` inside useFrame.
 */
import type { ResidentProfile, WorldEvent, WorldRuntime, WorldSnapshot } from '@hello-world/contracts';

export interface ResidentStructure { id: string; displayName: string; appearanceKey: string; resident: ResidentProfile }

export interface FreshEvent {
  event: WorldEvent;
  /** performance.now() when this client first saw it. */
  receivedAt: number;
}

type Listener<T> = (value: T) => void;

/** Events older than this (relative to the newest event in the first snapshot) are not replayed on load. */
const REPLAY_WINDOW_MS = 4000;

export class SceneStore {
  current: WorldSnapshot;
  previous: WorldSnapshot | null = null;
  /** performance.now() of the latest snapshot. */
  receivedAt = 0;
  /** Average interval between snapshots (ms), used for interpolation. */
  snapshotInterval = 500;
  private residentIndex = new Map<string, ResidentProfile>();
  private seenEvents = new Set<string>();
  private seenOrder: string[] = [];
  private eventListeners = new Set<Listener<FreshEvent>>();
  private structureListeners = new Set<Listener<ResidentStructure[]>>();
  private snapshotListeners = new Set<Listener<WorldSnapshot>>();
  private structureKey = '';
  private structure: ResidentStructure[] = [];
  private unsubscribe: (() => void) | null = null;
  /** Recent events (newest last) for UI lookups such as "who is X talking to". */
  recentEvents: FreshEvent[] = [];

  constructor(readonly runtime: WorldRuntime) {
    const first = runtime.getSnapshot();
    this.current = first;
    const newest = Math.max(0, ...first.eventHistory.map(e => e.timestamp));
    const t = nowMs();
    for (const e of first.eventHistory) {
      this.markSeen(e.id);
      if (newest - e.timestamp <= REPLAY_WINDOW_MS && first.eventHistory.length > 0) {
        this.recentEvents.push({ event: e, receivedAt: t - (newest - e.timestamp) });
      }
    }
    this.ingest(first, true);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.runtime.subscribe(s => this.ingest(s, false));
    // A remote adapter may already hold a newer snapshot.
    const latest = this.runtime.getSnapshot();
    if (latest !== this.current) this.ingest(latest, false);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getResident(id: string): ResidentProfile | undefined { return this.residentIndex.get(id); }
  getStructure(): ResidentStructure[] { return this.structure; }

  onEvent(l: Listener<FreshEvent>): () => void { this.eventListeners.add(l); return () => { this.eventListeners.delete(l); }; }
  onStructure(l: Listener<ResidentStructure[]>): () => void { this.structureListeners.add(l); return () => { this.structureListeners.delete(l); }; }
  onSnapshot(l: Listener<WorldSnapshot>): () => void { this.snapshotListeners.add(l); return () => { this.snapshotListeners.delete(l); }; }

  /** Latest event (within maxAgeMs) involving a resident, e.g. to face a conversation partner. */
  latestEventFor(residentId: string, maxAgeMs = 8000): FreshEvent | undefined {
    const t = nowMs();
    for (let i = this.recentEvents.length - 1; i >= 0; i--) {
      const fe = this.recentEvents[i]!;
      if (t - fe.receivedAt > maxAgeMs) break;
      if (fe.event.actorId === residentId || fe.event.targetId === residentId) return fe;
    }
    return undefined;
  }

  private markSeen(id: string) {
    this.seenEvents.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > 1000) this.seenEvents.delete(this.seenOrder.shift()!);
  }

  private ingest(snapshot: WorldSnapshot, initial: boolean) {
    const t = nowMs();
    if (!initial) {
      if (snapshot === this.current) return;
      const dt = t - this.receivedAt;
      if (dt > 16 && dt < 5000) this.snapshotInterval = this.snapshotInterval * 0.8 + dt * 0.2;
      this.previous = this.current;
    }
    this.current = snapshot;
    this.receivedAt = t;
    this.residentIndex = new Map(snapshot.residents.map(r => [r.id, r]));

    const key = snapshot.residents.map(r => `${r.id}\u0001${r.displayName}\u0001${appearanceKey(r)}`).join('\u0002');
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.structure = snapshot.residents.map(r => ({ id: r.id, displayName: r.displayName, appearanceKey: appearanceKey(r), resident: r }));
      if (!initial) for (const l of [...this.structureListeners]) l(this.structure);
    }

    if (!initial) {
      // A remote adapter starts from an empty bootstrap snapshot; on (re)connect a
      // full history arrives at once. Only react to events that are genuinely recent
      // relative to the newest one; mark the rest as seen silently.
      const unseen = snapshot.eventHistory.filter(e => !this.seenEvents.has(e.id));
      const bulk = unseen.length > 12 || (this.previous !== null && this.previous.residents.length === 0 && this.previous.eventHistory.length === 0);
      const newest = unseen.reduce((m, e) => Math.max(m, e.timestamp), 0);
      const fresh: FreshEvent[] = [];
      for (const e of unseen) {
        this.markSeen(e.id);
        if (bulk && newest - e.timestamp > REPLAY_WINDOW_MS) continue;
        fresh.push({ event: e, receivedAt: t });
      }
      if (fresh.length) {
        this.recentEvents.push(...fresh);
        if (this.recentEvents.length > 120) this.recentEvents.splice(0, this.recentEvents.length - 120);
        for (const fe of fresh) for (const l of [...this.eventListeners]) { try { l(fe); } catch { /* keep rendering */ } }
      }
      for (const l of [...this.snapshotListeners]) { try { l(snapshot); } catch { /* keep rendering */ } }
    }
  }
}

export function appearanceKey(r: ResidentProfile): string {
  return JSON.stringify(r.appearance);
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
