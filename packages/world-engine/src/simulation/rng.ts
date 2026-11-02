/**
 * Deterministic, hash-based randomness. NEVER Math.random / Date.now.
 * Every draw hashes (seed, tick, per-tick counter, purpose, id), so the same
 * snapshot + events + steps always reproduce the same world.
 */
import { hashString } from '../avatars/catalog';

/** murmur3 finalizer: spreads FNV-1a output so nearby keys look unrelated. */
export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stable value in [0, 1) for a key (no stream state). */
export function hashUnit(key: string): number {
  return mix32(hashString(key)) / 4294967296;
}

export interface Rng {
  /** Select the stream for a simulation tick (resets the per-tick counter when it changes). */
  setTick(tick: number): void;
  float(purpose: string, id?: string): number;
  range(lo: number, hi: number, purpose: string, id?: string): number;
  int(n: number, purpose: string, id?: string): number;
  chance(p: number, purpose: string, id?: string): boolean;
  pick<T>(list: readonly T[], purpose: string, id?: string): T;
}

export function createRng(seed: string): Rng {
  let tick = 0;
  let counter = 0;
  const float = (purpose: string, id = ''): number => {
    counter++;
    return hashUnit(`${seed}|${tick}|${counter}|${purpose}|${id}`);
  };
  return {
    setTick(t) { if (t !== tick) { tick = t; counter = 0; } },
    float,
    range: (lo, hi, purpose, id) => lo + (hi - lo) * float(purpose, id),
    int: (n, purpose, id) => Math.max(0, Math.min(n - 1, Math.floor(float(purpose, id) * n))),
    chance: (p, purpose, id) => float(purpose, id) < p,
    pick: (list, purpose, id) => list[Math.max(0, Math.min(list.length - 1, Math.floor(float(purpose, id) * list.length)))]!,
  };
}
