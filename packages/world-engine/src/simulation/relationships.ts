/**
 * Contract `Relationship` store: residentA < residentB (sorted ids), friendship
 * 0–100 (first meeting 40–50), Unix-ms lastInteractionAt, ≤ 10 human-readable
 * memories per pair, ≤ 300 pairs (weakest/oldest pruned).
 */
import type { Relationship } from '@hello-world/contracts';
import { hashUnit } from './rng';
import { clamp, cleanText, memoryStamp, type Agent, type World } from './state';

export const MAX_RELATIONSHIPS = 300;
export const MAX_MEMORIES = 10;
export const MEMORY_MAX_CHARS = 220;

export function pairKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

export function getRel(w: World, a: string, b: string): Relationship | undefined {
  return w.relationships.get(pairKey(a, b));
}

export function friendshipOf(w: World, a: string, b: string): number | undefined {
  return getRel(w, a, b)?.friendship;
}

export function ensureRel(w: World, a: Agent, b: Agent): Relationship {
  const key = pairKey(a.id, b.id);
  const existing = w.relationships.get(key);
  if (existing) return existing;
  const [ra, rb] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const rel: Relationship = {
    residentA: ra, residentB: rb,
    friendship: 40 + Math.floor(hashUnit(`${w.worldId}|meet|${ra}|${rb}`) * 11),
    lastInteractionAt: Math.max(0, Math.floor(w.now)),
    memories: [],
  };
  w.relationships.set(key, rel);
  pruneRelationships(w, key);
  return rel;
}

/** Positive deltas scale with both residents' friendship rates. */
export function adjustFriendship(w: World, a: Agent, b: Agent, delta: number): { before: number; after: number; rel: Relationship } {
  const rel = ensureRel(w, a, b);
  const before = rel.friendship;
  // Diminishing gains: close friendships grow slowly (×0.8 at 80, ×0.4 at 90, ×0.12 near 100).
  const taper = before < 60 ? 1 : before < 80 ? 1 - (before - 60) / 100 : Math.max(0.12, (100 - before) / 25);
  const rate = delta > 0 ? ((a.temperament.friendshipRate + b.temperament.friendshipRate) / 2) * taper : 1;
  rel.friendship = Math.round(clamp(before + delta * rate, 0, 100) * 10) / 10;
  rel.lastInteractionAt = Math.max(rel.lastInteractionAt, Math.floor(w.now));
  return { before, after: rel.friendship, rel };
}

export function addMemory(w: World, a: Agent, b: Agent, text: string): void {
  const rel = ensureRel(w, a, b);
  let body = cleanText(text, MEMORY_MAX_CHARS - 20);
  if (!/[.!?"]$/.test(body)) body += '.';
  rel.memories.push(cleanText(`${memoryStamp(w.simTime)} · ${body}`, MEMORY_MAX_CHARS));
  while (rel.memories.length > MAX_MEMORIES) rel.memories.shift();
  rel.lastInteractionAt = Math.max(rel.lastInteractionAt, Math.floor(w.now));
  w.memoryAt.set(pairKey(a.id, b.id), w.simTime);
}

export function pruneRelationships(w: World, keepKey?: string): void {
  while (w.relationships.size > MAX_RELATIONSHIPS) {
    let worstKey: string | null = null;
    let worst: Relationship | null = null;
    for (const [key, r] of w.relationships) {
      if (key === keepKey) continue;
      if (!worst || r.friendship < worst.friendship || (r.friendship === worst.friendship && r.lastInteractionAt < worst.lastInteractionAt)) { worst = r; worstKey = key; }
    }
    if (!worstKey) break;
    w.relationships.delete(worstKey);
    w.memoryAt.delete(worstKey);
  }
}

export function removeRelationshipsOf(w: World, id: string): void {
  for (const [key, r] of [...w.relationships]) {
    if (r.residentA === id || r.residentB === id) { w.relationships.delete(key); w.memoryAt.delete(key); }
  }
}

export type ReactionKind = 'greet' | 'chat' | 'compliment' | 'befriend' | 'gift' | 'wave' | 'reply' | 'bicker' | 'makeup';

/** Does `listener` react warmly to `speaker`? Warmth, mood, friendship, tiredness + a little deterministic noise. */
export function reactsPositively(w: World, listener: Agent, speaker: Agent, kind: ReactionKind): boolean {
  const t = listener.temperament;
  const f = friendshipOf(w, listener.id, speaker.id) ?? 45;
  let p = 0.62 + t.warmth * 0.35 + listener.mood * 0.3 + ((f - 50) / 100) * 0.5 - (listener.needs.energy < 15 ? 0.2 : 0);
  // Sulking, exhausted or lonely-and-grumpy residents give short answers and snub more.
  if (listener.activity.startsWith('sulking') || listener.needs.energy < 20) p -= 0.25;
  if (listener.needs.social < 25 && t.grumpiness > 0.5) p -= 0.15;
  if (kind === 'gift') p += 0.35;
  else if (kind === 'compliment') p += 0.1;
  else if (kind === 'wave') p += 0.05;
  const noise = w.rng.float('react', `${listener.id}>${speaker.id}`) * 0.3 - 0.15;
  return p + noise >= 0.5;
}
