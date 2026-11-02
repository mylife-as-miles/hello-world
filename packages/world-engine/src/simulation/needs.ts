/**
 * Needs (energy / social / fun, 0–100) decay over time and are restored by
 * activities; personality scales the rates. Mood (internal, -1..1) is derived
 * from needs, recent interaction sentiment, weather and temperament.
 */
import type { Weather } from '@hello-world/contracts';
import type { WorldClock } from '../world/time';
import { clamp, type Agent, type Needs } from './state';

/** Points lost per simulation second (1 s = 1 game minute). */
export const BASE_DECAY: Readonly<Needs> = { energy: 0.06, social: 0.13, fun: 0.1 };

/**
 * Diminishing returns: gains taper off above ~55 so needs hover in the 30–80
 * band instead of pinning at 100 (full effect ≤ 55, half at ~77, ~0.1 at 95).
 */
export function gainFactor(value: number): number {
  return clamp((100 - value) / 45, 0.06, 1);
}

export const clampNeed = (v: number) => clamp(v, 0, 100);

/** How badly a need wants filling: ~0.06 when full … ~1.66 when empty. */
export function urgency(value: number): number {
  const v = clampNeed(value);
  const d = 1 - v / 100;
  // Steep below 35 so low needs dominate goal selection.
  return 0.05 + d * d * 1.5 + (v < 35 ? ((35 - v) / 35) * 1.6 : 0);
}

export function isSleeping(a: Agent): boolean {
  return a.action?.type === 'sleep' && a.action.phase === 'perform';
}

export function decayNeeds(a: Agent, dt: number, clock: WorldClock): void {
  const t = a.temperament;
  const sleeping = isSleeping(a);
  const owl = t.nightOwl > 0.5;
  // Evenings make (non night-owl) residents visibly tired; owls fade in the morning instead.
  const tiredness = clock.period === 'night' ? (owl ? 0.6 : 1.7) : clock.period === 'evening' ? (owl ? 0.8 : 1.8) : owl && clock.period === 'morning' ? 1.3 : 1;
  if (!sleeping) a.needs.energy = clampNeed(a.needs.energy - BASE_DECAY.energy * t.energyDecay * tiredness * dt);
  a.needs.social = clampNeed(a.needs.social - BASE_DECAY.social * t.socialDecay * (sleeping ? 0.25 : 1) * dt);
  a.needs.fun = clampNeed(a.needs.fun - BASE_DECAY.fun * t.funDecay * (sleeping ? 0.2 : 1) * dt);
}

const add = (v: number, delta: number) => clampNeed(v + (delta > 0 ? delta * gainFactor(v) : delta));

export function applyEffects(a: Agent, e: Needs, dt: number): void {
  if (e.energy) a.needs.energy = add(a.needs.energy, e.energy * dt);
  if (e.social) a.needs.social = add(a.needs.social, e.social * dt);
  if (e.fun) a.needs.fun = add(a.needs.fun, e.fun * dt);
}

/** One-off need change (gift received, greeting...) — also with diminishing returns. */
export function bump(a: Agent, e: Partial<Needs>): void {
  if (e.energy) a.needs.energy = add(a.needs.energy, e.energy);
  if (e.social) a.needs.social = add(a.needs.social, e.social);
  if (e.fun) a.needs.fun = add(a.needs.fun, e.fun);
}

export type NeedKey = keyof Needs;

/** The need an activity mainly serves (used for satiation: stop when it is full). */
export function primaryNeed(type: string): NeedKey | null {
  switch (type) {
    case 'sit': case 'rest': case 'sleep': case 'drink': case 'eat': return 'energy';
    case 'wander': case 'dance': case 'play': case 'read': case 'admire': case 'watch': return 'fun';
    case 'socialize': case 'converse': return 'social';
    default: return null;
  }
}

/** The lowest need (and its value). */
export function lowestNeed(a: Agent): { key: NeedKey; value: number } {
  const n = a.needs;
  if (n.energy <= n.social && n.energy <= n.fun) return { key: 'energy', value: n.energy };
  return n.social <= n.fun ? { key: 'social', value: n.social } : { key: 'fun', value: n.fun };
}

export function feel(a: Agent, delta: number): void {
  a.sentiment = clamp(a.sentiment + delta, -1, 1);
}

export function updateMood(a: Agent, weather: Weather, dt: number): void {
  const t = a.temperament;
  const n = a.needs;
  const base = (n.energy * 0.3 + n.social * 0.35 + n.fun * 0.35 - 50) / 50;
  const loud = t.playfulness > 1.4 || t.chaos > 0.4;
  const weatherMood = weather === 'rain' ? (loud ? 0.05 : -0.12)
    : weather === 'snow' ? (t.playfulness > 1.3 ? 0.12 : -0.03)
      : weather === 'sunset' ? 0.08 : 0.05;
  a.sentiment += (0 - a.sentiment) * Math.min(1, dt * 0.02);
  a.mood = clamp(base * 0.7 + a.sentiment * 0.5 + t.warmth * 0.15 - t.grumpiness * 0.25 + weatherMood, -1, 1);
}
