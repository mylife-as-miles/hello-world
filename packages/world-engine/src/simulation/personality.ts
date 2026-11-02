/**
 * Personality → behaviour modifiers. Known catalog traits (PERSONALITY_TRAITS)
 * have hand-tuned effects; unknown traits get small deterministic hashed nudges
 * so "pirate" or "sleepy" still make a resident subtly different.
 */
import { hashString, PERSONALITY_TRAITS } from '../avatars/catalog';

export interface Temperament {
  /** Desire to talk / greet (multiplier ~0.2–2.2). */
  sociability: number;
  /** Positivity of reactions (-1..1). */
  warmth: number;
  playfulness: number;
  curiosity: number;
  restLove: number;
  bookish: number;
  foodie: number;
  creative: number;
  competitive: number;
  romance: number;
  kindness: number;
  /** Randomness / drama 0..1. */
  chaos: number;
  nightOwl: number;
  shyness: number;
  grumpiness: number;
  energyDecay: number;
  socialDecay: number;
  funDecay: number;
  friendshipRate: number;
  speed: number;
}

const BASE: Temperament = {
  sociability: 1, warmth: 0.35, playfulness: 1, curiosity: 1, restLove: 1, bookish: 0.7, foodie: 1,
  creative: 1, competitive: 0.8, romance: 0.8, kindness: 1, chaos: 0.12, nightOwl: 0, shyness: 0,
  grumpiness: 0, energyDecay: 1, socialDecay: 1, funDecay: 1, friendshipRate: 1, speed: 1,
};

export const TRAIT_EFFECTS: Readonly<Record<string, Partial<Temperament>>> = {
  friendly: { sociability: 0.55, warmth: 0.4, socialDecay: 0.3, friendshipRate: 0.35 },
  shy: { sociability: -0.45, shyness: 0.7, socialDecay: -0.22, friendshipRate: -0.25, warmth: 0.1, speed: -0.05 },
  playful: { playfulness: 0.7, funDecay: 0.3, chaos: 0.1, warmth: 0.15 },
  grumpy: { grumpiness: 0.75, warmth: -0.65, sociability: -0.25, friendshipRate: -0.3, socialDecay: 0.05 },
  curious: { curiosity: 0.7, sociability: 0.1 },
  energetic: { energyDecay: -0.3, restLove: -0.5, playfulness: 0.3, speed: 0.15 },
  lazy: { restLove: 0.9, energyDecay: 0.3, speed: -0.15, playfulness: -0.25, funDecay: 0.35 },
  romantic: { romance: 1, warmth: 0.2 },
  creative: { creative: 0.8, curiosity: 0.15 },
  chaotic: { chaos: 0.45, playfulness: 0.2 },
  kind: { kindness: 0.8, warmth: 0.3 },
  competitive: { competitive: 1, warmth: -0.05 },
  bookish: { bookish: 1.3, sociability: -0.1, curiosity: 0.1 },
  foodie: { foodie: 1.1 },
  'night-owl': { nightOwl: 1 },
};

const RANGES: Record<keyof Temperament, readonly [number, number]> = {
  sociability: [0.2, 2.2], warmth: [-1, 1], playfulness: [0.3, 2.2], curiosity: [0.3, 2.2], restLove: [0.2, 2.4],
  bookish: [0.2, 2.4], foodie: [0.3, 2.4], creative: [0.3, 2.2], competitive: [0.2, 2.2], romance: [0.2, 2.2],
  kindness: [0.3, 2.2], chaos: [0, 1], nightOwl: [0, 1], shyness: [0, 1], grumpiness: [0, 1],
  energyDecay: [0.5, 1.6], socialDecay: [0.4, 1.6], funDecay: [0.5, 1.6], friendshipRate: [0.4, 1.6], speed: [0.8, 1.25],
};

const NUDGE_KEYS: Array<keyof Temperament> = [
  'sociability', 'warmth', 'playfulness', 'curiosity', 'restLove', 'creative', 'foodie', 'chaos', 'bookish', 'kindness',
];

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function isKnownTrait(trait: string): boolean {
  return has(TRAIT_EFFECTS, trait.toLowerCase().trim());
}

export function temperamentFor(traits: readonly string[]): Temperament {
  const t: Temperament = { ...BASE };
  for (const raw of traits) {
    const trait = raw.toLowerCase().trim();
    if (!trait) continue;
    if (has(TRAIT_EFFECTS, trait)) {
      const fx = TRAIT_EFFECTS[trait]!;
      for (const key of Object.keys(fx) as Array<keyof Temperament>) t[key] += fx[key] ?? 0;
      continue;
    }
    // Unknown trait: two small, stable nudges (±0.15) derived from its name.
    const h = hashString(`trait:${trait}`);
    for (let i = 0; i < 2; i++) {
      const key = NUDGE_KEYS[((h >>> (i * 5)) & 31) % NUDGE_KEYS.length]!;
      t[key] += ((((h >>> (10 + i * 7)) & 127) / 127) - 0.5) * 0.3;
    }
  }
  for (const key of Object.keys(RANGES) as Array<keyof Temperament>) {
    const [lo, hi] = RANGES[key];
    t[key] = Math.min(hi, Math.max(lo, t[key]));
  }
  return t;
}

const COMPLEMENTS: Array<[string, string]> = [
  ['kind', 'shy'], ['playful', 'energetic'], ['bookish', 'curious'], ['foodie', 'kind'], ['creative', 'romantic'],
  ['playful', 'chaotic'], ['competitive', 'energetic'], ['night-owl', 'playful'], ['friendly', 'shy'], ['lazy', 'bookish'],
];
const CONFLICTS: Array<[string, string]> = [
  ['grumpy', 'chaotic'], ['lazy', 'energetic'], ['shy', 'chaotic'], ['grumpy', 'playful'], ['competitive', 'lazy'],
];

/** True when the two personalities contain a known clash (grumpy×chaotic, lazy×energetic, …). */
export function hasConflict(pa: readonly string[], pb: readonly string[]): boolean {
  const A = new Set(pa.map(p => p.toLowerCase()));
  const B = new Set(pb.map(p => p.toLowerCase()));
  return CONFLICTS.some(([x, y]) => (A.has(x) && B.has(y)) || (A.has(y) && B.has(x)));
}

/** 0..1 — how well two residents click (used by befriend + friendship gains). */
export function compatibility(ta: Temperament, tb: Temperament, pa: readonly string[], pb: readonly string[]): number {
  const A = new Set(pa.map(p => p.toLowerCase()));
  const B = new Set(pb.map(p => p.toLowerCase()));
  let s = 0.45 + (ta.warmth + tb.warmth) * 0.12;
  for (const p of A) if (B.has(p)) s += 0.12;
  for (const [x, y] of COMPLEMENTS) if ((A.has(x) && B.has(y)) || (A.has(y) && B.has(x))) s += 0.08;
  for (const [x, y] of CONFLICTS) if ((A.has(x) && B.has(y)) || (A.has(y) && B.has(x))) s -= 0.12;
  return Math.min(1, Math.max(0, s));
}

const DEFAULT_POOL = PERSONALITY_TRAITS.map(t => t.id);
const INCOMPATIBLE = new Set(['friendly|grumpy', 'grumpy|friendly', 'lazy|energetic', 'energetic|lazy', 'shy|chaotic', 'chaotic|shy']);

/** Deterministic 2-trait personality for joins that did not supply one. */
export function defaultPersonality(id: string): string[] {
  const h = hashString(`persona:${id}`);
  const first = DEFAULT_POOL[h % DEFAULT_POOL.length]!;
  let second = DEFAULT_POOL[(h >>> 8) % DEFAULT_POOL.length]!;
  for (let i = 1; (second === first || INCOMPATIBLE.has(`${first}|${second}`)) && i < DEFAULT_POOL.length; i++) {
    second = DEFAULT_POOL[((h >>> 8) + i) % DEFAULT_POOL.length]!;
  }
  return second === first ? [first] : [first, second];
}
