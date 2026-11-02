/**
 * Needs (energy / social / fun, 0–100) decay over time and are restored by
 * activities; personality scales the rates. Mood (internal, -1..1) is derived
 * from needs, recent interaction sentiment, weather and temperament.
 */
import type { Weather } from '@hello-world/contracts';
import type { WorldClock } from '../world/time';
import { clamp, type Agent, type Needs } from './state';

/** Points lost per simulation second (1 s = 1 game minute). */
export const BASE_DECAY: Readonly<Needs> = { energy: 0.045, social: 0.08, fun: 0.07 };

export const clampNeed = (v: number) => clamp(v, 0, 100);

/** How badly a need wants filling: ~0.06 when full … ~1.66 when empty. */
export function urgency(value: number): number {
  const d = 1 - clampNeed(value) / 100;
  return 0.06 + d * d * 1.6;
}

export function isSleeping(a: Agent): boolean {
  return a.action?.type === 'sleep' && a.action.phase === 'perform';
}

export function decayNeeds(a: Agent, dt: number, clock: WorldClock): void {
  const t = a.temperament;
  const sleeping = isSleeping(a);
  const owl = t.nightOwl > 0.5;
  const tiredness = clock.period === 'night' ? (owl ? 0.6 : 1.25) : owl && clock.period === 'morning' ? 1.2 : 1;
  if (!sleeping) a.needs.energy = clampNeed(a.needs.energy - BASE_DECAY.energy * t.energyDecay * tiredness * dt);
  a.needs.social = clampNeed(a.needs.social - BASE_DECAY.social * t.socialDecay * (sleeping ? 0.25 : 1) * dt);
  a.needs.fun = clampNeed(a.needs.fun - BASE_DECAY.fun * t.funDecay * (sleeping ? 0.2 : 1) * dt);
}

export function applyEffects(a: Agent, e: Needs, dt: number): void {
  if (e.energy) a.needs.energy = clampNeed(a.needs.energy + e.energy * dt);
  if (e.social) a.needs.social = clampNeed(a.needs.social + e.social * dt);
  if (e.fun) a.needs.fun = clampNeed(a.needs.fun + e.fun * dt);
}

/** One-off need change (gift received, greeting...). */
export function bump(a: Agent, e: Partial<Needs>): void {
  if (e.energy) a.needs.energy = clampNeed(a.needs.energy + e.energy);
  if (e.social) a.needs.social = clampNeed(a.needs.social + e.social);
  if (e.fun) a.needs.fun = clampNeed(a.needs.fun + e.fun);
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
