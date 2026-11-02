/**
 * createWorldRuntime — contract `WorldRuntime` implementation.
 * Node-safe (the server runs this exact runtime). No React/DOM/Three imports.
 *
 * Responsibilities: validation, bounded de-duplication, per-actor cooldowns,
 * a bounded event queue, bounded history, immutable snapshots, coalesced
 * subscriber notification, fixed-step auto ticking, and dispose().
 * World behaviour itself lives in ../simulation.
 */
import { SCHEMA_VERSION, type WorldEvent, type WorldRuntime, type WorldRuntimeOptions, type WorldSnapshot } from '@hello-world/contracts';
import { createSimulation } from '../simulation';
import type { Simulation } from '../simulation/types';
import { validateEvent } from './validate';
import { migrateSnapshot } from './migrate';

export const HISTORY_LIMIT = 100;
export const POPULATION_LIMIT = 50;
export const DEDUPE_LIMIT = 2000;
export const QUEUE_LIMIT = 200;
/** Events applied per dispatch/tick before the rest wait for the next tick. */
export const EVENTS_PER_DRAIN = 40;
export const DEFAULT_TICK_MS = 500;
/** Max extra fixed steps per timer callback when the host fell behind. */
export const MAX_CATCHUP_STEPS = 4;

/** Minimum spacing (ms, by event timestamp) between same-kind events from one actor. */
const ACTOR_COOLDOWN_MS: Record<WorldEvent['kind'], number> = {
  join: 1500, chat: 400, wave: 1000, dance: 1500, gift: 2000, social: 1000,
  weather: 1500, confetti: 1000, raid: 3000, custom: 750,
};

export interface WorldEngineRuntimeOptions extends WorldRuntimeOptions {
  /** Injectable clock (Unix ms) used only for timestamps. Default Date.now. */
  now?: () => number;
  /** Population cap (<= 50). */
  maxResidents?: number;
  /**
   * Bounded offline catch-up when restoring: simulate up to this many seconds
   * of elapsed wall time since the snapshot's latest activity. Default 0 (off).
   * This is a coarse fast-forward, not proof of continuous running.
   */
  catchUpMaxSeconds?: number;
  /** Called when an event is rejected (malformed, duplicate, cooldown, queue full). */
  onReject?: (reason: string, event: unknown) => void;
}

export interface WorldEngineRuntime extends WorldRuntime {
  /** Advance the world by one fixed tick (or `seconds`). Useful when autoTick is false. */
  tick(seconds?: number): void;
  /** Pause/resume autonomous ticking (events still apply). */
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  /** Stop timers and drop listeners. */
  dispose(): void;
  /** Events rejected so far (for diagnostics/QA). */
  readonly stats: { accepted: number; rejected: number; duplicates: number; generated: number };
}

export function createWorldRuntime(options: WorldEngineRuntimeOptions = {}): WorldEngineRuntime {
  const now = options.now ?? (() => Date.now());
  // Snapshots restored from disk/IndexedDB/network are untrusted: repair + validate.
  const initial = options.initialSnapshot ? migrateSnapshot(options.initialSnapshot) ?? undefined : undefined;
  const worldId = options.worldId ?? initial?.worldId ?? 'hello-neighborhood';
  const tickMs = Math.max(50, Math.min(5000, options.tickIntervalMs ?? DEFAULT_TICK_MS));
  const maxResidents = Math.max(1, Math.min(POPULATION_LIMIT, options.maxResidents ?? POPULATION_LIMIT));

  const sim: Simulation = createSimulation({
    worldId,
    initialSnapshot: initial,
    seedResidents: options.seedResidents ?? true,
    now: now(),
    maxResidents,
  });

  let history: WorldEvent[] = initial ? initial.eventHistory.slice(-HISTORY_LIMIT).map(e => ({ ...e })) : [];
  const seen = new Set<string>(history.map(e => e.id));
  const seenOrder: string[] = history.map(e => e.id);
  const lastByActorKind = new Map<string, number>();
  const queue: WorldEvent[] = [];
  const listeners = new Set<(snapshot: WorldSnapshot) => void>();
  const stats = { accepted: 0, rejected: 0, duplicates: 0, generated: 0 };
  let snapshot: WorldSnapshot | null = null;
  let dirty = true;
  let notifyScheduled = false;
  let paused = false;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const remember = (id: string) => {
    seen.add(id);
    seenOrder.push(id);
    while (seenOrder.length > DEDUPE_LIMIT) seen.delete(seenOrder.shift()!);
  };

  const pushHistory = (events: WorldEvent[]) => {
    if (!events.length) return;
    history = [...history, ...events].slice(-HISTORY_LIMIT);
  };

  const reject = (reason: string, event: unknown) => {
    stats.rejected++;
    options.onReject?.(reason, event);
  };

  const build = (): WorldSnapshot => {
    const state = sim.exportState();
    const snap: WorldSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      worldId,
      residents: state.residents,
      relationships: state.relationships,
      weather: state.weather,
      eventHistory: history.map(e => ({ ...e, ...(e.payload ? { payload: { ...e.payload } } : {}) })),
      simulationTime: state.simulationTime,
    };
    return deepFreeze(snap);
  };

  const markDirty = () => {
    dirty = true;
    if (notifyScheduled || disposed) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      if (disposed || listeners.size === 0) return;
      const snap = getSnapshot();
      for (const l of [...listeners]) {
        try { l(snap); } catch (err) { /* a faulty listener must not break the world */ void err; }
      }
    });
  };

  const getSnapshot = (): WorldSnapshot => {
    if (dirty || !snapshot) { snapshot = build(); dirty = false; }
    return snapshot;
  };

  const drain = (budget = EVENTS_PER_DRAIN) => {
    let applied = 0;
    while (queue.length && applied < budget) {
      const event = queue.shift()!;
      let generated: WorldEvent[] = [];
      try {
        generated = sim.applyEvent(event, now());
      } catch (err) {
        reject(`apply failed: ${(err as Error)?.message ?? String(err)}`, event);
        continue;
      }
      stats.accepted++;
      applied++;
      for (const g of generated) remember(g.id);
      stats.generated += generated.length;
      pushHistory([event, ...generated]);
    }
    if (applied) markDirty();
  };

  const dispatch = (input: WorldEvent) => {
    if (disposed) return;
    const result = validateEvent(input);
    if (!result.ok) { reject(result.reason, input); return; }
    const event = result.event;
    if (seen.has(event.id)) { stats.duplicates++; return; }
    const key = `${event.actorId}|${event.kind}`;
    const last = lastByActorKind.get(key);
    const cooldown = event.source === 'simulation' ? 0 : ACTOR_COOLDOWN_MS[event.kind];
    if (last !== undefined && event.timestamp >= last && event.timestamp - last < cooldown) {
      reject('cooldown', event);
      remember(event.id);
      return;
    }
    if (queue.length >= QUEUE_LIMIT) {
      // Shed the oldest low-priority chat first; otherwise reject the newcomer.
      const idx = queue.findIndex(q => q.kind === 'chat');
      if (idx >= 0 && event.kind !== 'chat') queue.splice(idx, 1);
      else { reject('queue full', event); return; }
    }
    lastByActorKind.set(key, event.timestamp);
    if (lastByActorKind.size > 4000) lastByActorKind.delete(lastByActorKind.keys().next().value!);
    remember(event.id);
    queue.push(event);
    drain();
  };

  const tick = (seconds = tickMs / 1000) => {
    if (disposed) return;
    drain();
    const generated = sim.step(Math.max(0.001, Math.min(60, seconds)), now());
    for (const g of generated) remember(g.id);
    stats.generated += generated.length;
    pushHistory(generated);
    markDirty();
  };

  // Bounded offline catch-up (opt-in).
  if (initial && (options.catchUpMaxSeconds ?? 0) > 0) {
    const lastActive = Math.max(0, ...initial.residents.map(r => r.lastActiveAt), ...initial.eventHistory.map(e => e.timestamp));
    const elapsed = lastActive > 0 ? Math.max(0, (now() - lastActive) / 1000) : 0;
    let remaining = Math.min(elapsed, options.catchUpMaxSeconds!);
    while (remaining > 0) { const step = Math.min(2, remaining); sim.step(step, now()); remaining -= step; }
  }

  if (options.autoTick) {
    // Fixed-size steps scheduled against a monotonic clock: when the host is busy and
    // intervals fire late, run a bounded number of catch-up steps instead of drifting.
    // (Each step is still exactly tickMs, so results stay deterministic per step count.)
    const mono = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let baseline = mono();
    let done = 0;
    timer = setInterval(() => {
      if (paused || disposed) { baseline = mono(); done = 0; return; }
      const due = Math.floor((mono() - baseline) / tickMs);
      let behind = due - done;
      if (behind > MAX_CATCHUP_STEPS * 8) { baseline = mono(); done = 0; behind = 1; } // long suspension: resync, don't spiral
      const steps = Math.max(1, Math.min(MAX_CATCHUP_STEPS, behind));
      for (let i = 0; i < steps; i++) tick();
      done += steps;
    }, tickMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return {
    dispatch,
    getSnapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    tick,
    setPaused(p) { paused = p; },
    isPaused: () => paused,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      listeners.clear();
      queue.length = 0;
    },
    stats,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
