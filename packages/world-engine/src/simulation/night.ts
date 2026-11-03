/**
 * Night routine rules (pure, deterministic, Node-safe).
 *
 * Every local resident has a personal bedtime (≈ 21:15–23:45) and wake-up time
 * (06:00–09:00, energetic early birds first, lazy ones last). Night owls flip
 * it: they stay up through the night and sleep from dawn into the late morning.
 * A night's sleep happens at home ("walking home to …" → "sleeping at …") and
 * lasts until the wake-up time. A small night shift — the owls plus a couple of
 * restless neighbours (see `nightWatch` in behavior.ts) — keeps a live stream
 * from looking deserted, and everyone who is up late does calm things.
 *
 * Schedules come from stateless hashes of the resident id (no rng stream use),
 * so daytime behaviour is untouched by this module.
 */
import { BUILDINGS, type Vec2 } from '../world/layout';
import { WALK_SPEED } from './movement';
import { isBlocked, nearSeat, pickSpot, poi, pushOut } from './places';
import { hashUnit } from './rng';
import { clamp, type Action, type Agent, type World } from './state';

/** Energy restored per second (game minute) of a night's sleep — ≈ 90+ after a full night. */
export const NIGHT_SLEEP_ENERGY = 0.2;

export const isOwl = (a: Agent): boolean => a.temperament.nightOwl > 0.5;

/** Hours from `from` to the next `to` on a 24 h clock (0 ≤ result < 24). */
export function hoursUntil(from: number, to: number): number {
  return (((to - from) % 24) + 24) % 24;
}

/** 00:00–05:00 plus the last hour before midnight: the quiet hours. */
export function deepNight(h: number): boolean {
  return h >= 23 || h < 5;
}

/** Night number (changes at noon, so one night = one index across midnight). */
export function nightIndex(simTime: number): number {
  return Math.floor((simTime - 240) / 1440);
}

/** Base personal bedtime from the id (21:24–23:30); `bedtimeOf` adds temperament. */
export function baseBedtime(id: string): number {
  return 21.4 + hashUnit(`bed:${id}`) * 2.1;
}

/** When this resident turns in: non-owls ≈ 21:15–23:45 (lazy earlier, energetic later); night owls at dawn. */
export function bedtimeOf(a: Agent): number {
  if (isOwl(a)) return 5.2 + hashUnit(`owl-bed:${a.id}`);
  return clamp(a.bedtime - (a.temperament.restLove - 1) * 0.3, 21.2, 23.75);
}

/** Wake-up: non-owls 06:00–09:00 staggered by temperament (energetic first, lazy last); night owls 10:00–11:15. */
export function wakeOf(a: Agent): number {
  if (isOwl(a)) return 10 + hashUnit(`owl-wake:${a.id}`) * 1.25;
  return clamp(6.2 + hashUnit(`wake:${a.id}`) * 1.6 + (a.temperament.restLove - 1) * 0.9, 6, 9);
}

/** Sleepiness (faster energy drain) starts ~45 min before bedtime and lasts until the small hours. */
export function pastSleepyHour(a: Agent, h: number): boolean {
  return h >= a.bedtime - 0.75 || h < 5.5;
}

export function inSleepWindow(a: Agent, h: number): boolean {
  const bed = bedtimeOf(a), wake = wakeOf(a);
  return bed > wake ? h >= bed || h < wake : h >= bed && h < wake;
}

/** Mornings (05:00–12:00) only continue a night this resident actually had — a fresh 08:00 world starts awake. */
const nightOf = (w: World, a: Agent, h: number) => !(h >= 5 && h < 12) || a.nightSeen === nightIndex(w.simTime);

/**
 * A local resident who should be on the way to bed / asleep now. Restless spells, fresh arrivals and active
 * viewers may stay up (`awakeUntil`) — unless they are tired (energy < 40), then it's bed after all.
 */
export function bedBound(w: World, a: Agent, h: number): boolean {
  if (a.visitor || a.leaving || (w.simTime < a.awakeUntil && a.needs.energy >= 40) || !inSleepWindow(a, h)) return false;
  // Not worth going back to bed right before the alarm.
  return hoursUntil(h, wakeOf(a)) >= 0.75 && nightOf(w, a, h);
}

/** Hours of sleep if this resident lay down for the night now, or null when it would only be a daytime nap. */
export function nightSleepHours(w: World, a: Agent, h: number): number | null {
  if (a.visitor) return null;
  const wake = wakeOf(a);
  // Owls sleep from dawn — or earlier when they are running on empty.
  const ok = isOwl(a) ? (h >= 4.5 && h < wake - 0.5) || (deepNight(h) && a.needs.energy < 30) : h >= 20 || h < wake - 0.5;
  return ok && nightOf(w, a, h) ? hoursUntil(h, wake) : null;
}

/** Is a resident currently in (or walking home to) a night's sleep? */
export const nightSleeper = (a: Agent): boolean => a.action?.type === 'sleep' && !!a.action.night;

/**
 * Dancing at night: between 23:00 and 05:00 only rested night owls (energy ≥ 50) dance on their own;
 * after 21:00 nobody dances with energy under 40. Raid visitors are exempt. Viewer events bypass this.
 */
export function nightDanceOk(a: Agent, h: number): boolean {
  if (a.visitor) return true;
  // 01:00–05:00 the few who are up keep to calm spots (benches, stars, books, a café nightcap).
  if (capHours(h)) return false;
  if (deepNight(h)) return isOwl(a) && a.needs.energy >= 50;
  if (h >= 21) return a.needs.energy >= 40;
  return true;
}

/** Calm-night multipliers (23:00–05:00): benches, stargazing, reading, a café nightcap — not frisbee or dancing. */
export function nightCalmFactor(type: Action['type'], kind: string, owl: boolean, h = 0): number {
  // The small hours (01–05) are calm for everyone, night owls included: no arcade, no dancing.
  if (capHours(h) && (type === 'play' || type === 'dance')) return 0.02;
  switch (type) {
    case 'sit': return 1.7;
    case 'admire': return 1.9;
    case 'read': return 2.1;
    case 'drink': return 1.6;
    case 'rest': return 1.1;
    case 'eat': return 0.55;
    case 'wander': return 0.8;
    case 'watch': return 0.6;
    case 'dance': return owl ? 0.5 : 0.1;
    case 'play': return kind === 'arcade' ? (owl ? 0.7 : 0.2) : 0.08;
    default: return 1;
  }
}

/** Night shift size: how many non-owl locals the night watch keeps up during the quiet hours (legacy; see nightAwakeRange). */
export function nightShiftSize(locals: number): number {
  return locals >= 20 ? 3 : locals >= 6 ? 2 : locals >= 3 ? 1 : 0;
}

/** 01:00–05:00: the deep quiet hours, when the TOTAL number of locals awake is capped. */
export function capHours(h: number): boolean {
  return h >= 1 && h < 5;
}

/**
 * How many locals are up in the small hours, night owls INCLUDED: never fewer than `min` (a live stream never looks
 * deserted), never more than `max` (≈ 2–3 for a normal town). Viewer-driven residents are never sent to bed.
 */
export function nightAwakeRange(locals: number): { min: number; max: number } {
  const min = locals >= 4 ? 2 : locals >= 2 ? 1 : 0;
  return { min, max: Math.max(min, Math.min(3, locals - 1)) };
}

/** A sleeping spot on the porch of the resident's home: a tidy row along the house front, never on a seat. */
export function sleepSpot(w: World, a: Agent): Vec2 {
  const home = poi(a.homeId);
  const b = BUILDINGS.find(x => x.poiId === home.id);
  if (!b) return pickSpot(w, home, a, true);
  let nx = home.position.x - b.position.x, nz = home.position.z - b.position.z;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len; nz /= len;
  const tx = -nz, tz = nx;
  const mates = [...w.agents.values()].filter(o => !o.visitor && o.homeId === a.homeId).map(o => o.id).sort();
  const start = Math.max(0, mates.indexOf(a.id));
  const OFF = [0, -0.95, 0.95, -1.9, 1.9];
  for (let i = 0; i < 15; i++) {
    const k = (start + i) % 15;
    const off = OFF[k % 5]!, row = Math.floor(k / 5);
    const p = { x: home.position.x + tx * off + nx * row * 0.9, z: home.position.z + tz * off + nz * row * 0.9 };
    if (isBlocked(p.x, p.z) || nearSeat(p.x, p.z, 1.3)) continue;
    let taken = false;
    for (const o of w.agents.values()) {
      if (o === a) continue;
      const s = o.action?.spot;
      if ((s && Math.hypot(s.x - p.x, s.z - p.z) < 0.6) || (o.action?.type === 'sleep' && Math.hypot(o.x - p.x, o.z - p.z) < 0.6)) { taken = true; break; }
    }
    if (taken) continue;
    pushOut(p);
    return p;
  }
  return pickSpot(w, home, a, true);
}

/** Minutes (= sim seconds) from `h` until this resident's wake-up, with a few minutes of nightly jitter. */
export function minutesUntilWake(w: World, a: Agent, h: number): number {
  const jitter = (hashUnit(`wake-j:${a.id}:${nightIndex(w.simTime)}`) - 0.5) * 16;
  return Math.max(20, hoursUntil(h, wakeOf(a)) * 60 + jitter);
}

/** A night's sleep at home: walk home, then sleep until the wake-up time (recomputed on arrival). */
export function nightSleepAction(w: World, a: Agent, h: number, spot: Vec2, priority = 0): Action {
  const home = poi(a.homeId);
  a.nightSeen = nightIndex(w.simTime);
  return {
    type: 'sleep', phase: 'travel', travelActivity: `walking home to ${home.name}`, activity: `sleeping at ${home.name}`,
    poiId: home.id, spot, remaining: minutesUntilWake(w, a, h), effects: { energy: NIGHT_SLEEP_ENERGY, social: 0, fun: 0 },
    speed: WALK_SPEED * a.temperament.speed, priority, travelTimeout: 60, anchored: true, night: true, since: w.simTime,
  };
}
