/**
 * Utility-based autonomy: action definitions with explicit preconditions
 * (`available`, seats, capacity, sleep cap) and effects (needs per second),
 * scored by need urgency × personality × time of day × weather × distance ×
 * novelty + small deterministic noise. Also the action lifecycle helpers.
 */
import type { Affordance, PoiDef, PoiKind, Vec2 } from '../world/layout';
import { POIS, PLAZA_RADIUS } from '../world/layout';
import { worldClock, type WorldClock } from '../world/time';
import { BOOKS, DRINKS_COLD, DRINKS_HOT, FOODS, GAMES, lines, placeVars, PLAYGROUND_TOYS } from './dialogue';
import { attention, isSleeping, lowestNeed, urgency } from './needs';
import { atPlace, freeSeat, hasFreeSeat, pickSpot, placeName, poi, pushOut, SEAT_BY_KEY } from './places';
import { pathLength, planPath, RUN_SPEED, WALK_SPEED, meetingPoint } from './movement';
import type { Temperament } from './personality';
import { friendshipOf, removeRelationshipsOf } from './relationships';
import { bedBound, bedtimeOf, deepNight, minutesUntilWake, nightCalmFactor, nightDanceOk, nightSleepAction, nightSleepHours, nightSleeper, sleepSpot } from './night';
import { dist, emit, NO_EFFECT, type Action, type ActionType, type Agent, type Needs, type World } from './state';

export interface ActionDef {
  type: ActionType;
  affordance: Affordance;
  kinds: readonly PoiKind[];
  effects: Needs;
  duration: readonly [number, number];
  base: number;
  needsSeat: (p: PoiDef) => boolean;
  groundSit: (p: PoiDef) => boolean;
  pref: (t: Temperament, p: PoiDef) => number;
  phrase: (w: World, a: Agent, p: PoiDef, clock: WorldClock) => string;
  available?: (w: World, a: Agent, p: PoiDef, clock: WorldClock) => boolean;
}

const no = () => false;
export const dancerAt = (w: World, p: PoiDef, self: Agent) => [...w.agents.values()].find(o => o !== self && o.action?.type === 'dance' && o.action.poiId === p.id && o.action.phase === 'perform');

export const ACTION_DEFS: ActionDef[] = [
  { type: 'wander', affordance: 'wander', kinds: ['plaza', 'park', 'garden'], effects: { energy: -0.05, social: 0.03, fun: 0.28 }, duration: [14, 26], base: 0.2,
    needsSeat: no, groundSit: no, pref: t => 0.6 + 0.4 * t.curiosity,
    phrase: (_w, _a, p) => (p.kind === 'plaza' ? `wandering around ${placeName(p)}` : `wandering through ${placeName(p)}`) },
  { type: 'sit', affordance: 'sit', kinds: ['bench', 'cafe'], effects: { energy: 0.5, social: 0.02, fun: -0.02 }, duration: [18, 32], base: 0.14,
    needsSeat: () => true, groundSit: no, pref: t => t.restLove, phrase: (_w, _a, p) => `sitting ${atPlace(p)}`,
    available: (w, a, p) => hasFreeSeat(w, p, a) },
  { type: 'rest', affordance: 'rest', kinds: ['fountain', 'park', 'garden', 'bench', 'home'], effects: { energy: 0.7, social: 0, fun: 0 }, duration: [14, 26], base: 0.08,
    needsSeat: p => p.kind === 'bench', groundSit: p => p.kind !== 'bench', pref: t => t.restLove,
    phrase: (_w, _a, p) => (p.kind === 'home' ? `resting at ${p.name}` : `resting ${atPlace(p)}`),
    available: (w, a, p) => (p.kind === 'home' ? p.id === a.homeId && !a.visitor : p.kind === 'bench' ? hasFreeSeat(w, p, a) : true) },
  { type: 'sleep', affordance: 'sleep', kinds: ['home'], effects: { energy: 1.4, social: 0, fun: 0 }, duration: [50, 100], base: 0,
    needsSeat: no, groundSit: () => true, pref: () => 1, phrase: (_w, _a, p) => `sleeping at ${p.name}`,
    available: (_w, a, p) => p.id === a.homeId && !a.visitor },
  { type: 'drink', affordance: 'drink', kinds: ['cafe'], effects: { energy: 0.45, social: 0.15, fun: 0.05 }, duration: [16, 26], base: 0.2,
    needsSeat: () => true, groundSit: no, pref: t => Math.pow(t.foodie, 0.8),
    phrase: (w, a, p, c) => `drinking ${w.rng.pick(w.weather === 'rain' || w.weather === 'snow' || c.period === 'night' || c.period === 'morning' ? DRINKS_HOT : DRINKS_COLD, 'drink', a.id)} ${atPlace(p)}`,
    available: (w, a, p) => hasFreeSeat(w, p, a) },
  { type: 'eat', affordance: 'eat', kinds: ['cafe'], effects: { energy: 0.6, social: 0.05, fun: 0.1 }, duration: [18, 30], base: 0.14,
    needsSeat: () => true, groundSit: no, pref: t => t.foodie,
    phrase: (w, a, p) => `eating ${w.rng.pick(FOODS, 'food', a.id)} ${atPlace(p)}`, available: (w, a, p) => hasFreeSeat(w, p, a) },
  { type: 'dance', affordance: 'dance', kinds: ['stage'], effects: { energy: -0.4, social: 0.15, fun: 0.9 }, duration: [14, 24], base: 0.18,
    needsSeat: no, groundSit: no, pref: t => (t.playfulness + t.creative) / 2,
    phrase: (w, _a, p, c) => (w.weather === 'rain' ? `dancing in the rain ${atPlace(p)}` : c.period === 'night' || c.period === 'evening' ? 'dancing under the stage lights' : `dancing ${atPlace(p)}`),
    available: (_w, a, _p, c) => a.needs.energy > 22 && nightDanceOk(a, c.hours) },
  { type: 'play', affordance: 'play', kinds: ['arcade', 'playground', 'park'], effects: { energy: -0.35, social: 0.05, fun: 0.9 }, duration: [16, 28], base: 0.18,
    needsSeat: no, groundSit: no,
    pref: (t, p) => (p.kind === 'arcade' ? 0.45 * t.playfulness + 0.6 * t.competitive : p.kind === 'playground' ? t.playfulness : 0.8 * t.playfulness),
    phrase: (w, a, p) => (p.kind === 'arcade' ? `playing ${w.rng.pick(GAMES, 'game', a.id)} ${atPlace(p)}`
      : w.weather === 'snow' ? `playing in the snow ${atPlace(p)}`
        : p.kind === 'playground' ? `playing on ${w.rng.pick(PLAYGROUND_TOYS, 'toy', a.id)} ${atPlace(p)}` : `playing frisbee ${atPlace(p)}`),
    available: (_w, a) => a.needs.energy > 18 },
  { type: 'read', affordance: 'read', kinds: ['park', 'bench'], effects: { energy: 0.1, social: -0.1, fun: 0.45 }, duration: [22, 38], base: 0.12,
    needsSeat: p => p.kind === 'bench', groundSit: p => p.kind !== 'bench', pref: t => t.bookish,
    phrase: (w, a, p) => `reading ${w.rng.pick(BOOKS, 'book', a.id)} ${atPlace(p)}`,
    available: (w, a, p) => (p.kind === 'bench' ? hasFreeSeat(w, p, a) : true) },
  { type: 'admire', affordance: 'admire', kinds: ['fountain', 'garden', 'portal', 'plaza'], effects: { energy: 0.05, social: 0, fun: 0.3 }, duration: [10, 18], base: 0.16,
    needsSeat: no, groundSit: no, pref: t => (t.curiosity + t.creative) / 2,
    phrase: (w, _a, p, c) => (w.weather === 'sunset' ? `admiring the sunset ${atPlace(p)}`
      : w.weather === 'snow' ? `admiring the snow ${atPlace(p)}`
        : p.kind === 'garden' ? `admiring the flowers ${atPlace(p)}`
          : c.period === 'night' ? `admiring the stars ${atPlace(p)}` : p.kind === 'plaza' ? `admiring the lamps ${atPlace(p)}` : `admiring ${placeName(p)}`),
    available: (w, _a, p, c) => p.kind !== 'plaza' || w.weather === 'sunset' || w.weather === 'snow' || c.period === 'night' || c.period === 'evening' },
  { type: 'watch', affordance: 'watch', kinds: ['stage', 'plaza'], effects: { energy: 0, social: 0.1, fun: 0.3 }, duration: [10, 18], base: 0.12,
    needsSeat: no, groundSit: no, pref: t => 0.7 + 0.3 * t.creative,
    phrase: (w, a, p) => { const d = p.kind === 'stage' ? dancerAt(w, p, a) : undefined; return d ? `watching ${d.displayName} dance` : `watching the crowd ${atPlace(p)}`; },
    available: (w, a, p) => (p.kind === 'stage' ? !!dancerAt(w, p, a) : [...w.agents.values()].filter(o => o !== a && Math.hypot(o.x, o.z) < PLAZA_RADIUS).length >= 3) },
];

function weatherFactor(type: ActionType, p: PoiDef, w: World, t: Temperament): number {
  const outdoor = !(p.kind === 'cafe' || p.kind === 'arcade' || p.kind === 'home');
  switch (w.weather) {
    case 'rain':
      if (!outdoor) return 1.6;
      if (type === 'dance' && (t.playfulness > 1.4 || t.chaos > 0.4)) return 1.2;
      return 0.35;
    case 'snow':
      if (type === 'play' && outdoor) return t.playfulness > 1.2 ? 1.8 : 1.1;
      if (type === 'admire') return 1.3;
      if (type === 'drink') return 1.4;
      return outdoor ? 0.85 : 1.1;
    case 'sunset':
      return type === 'admire' ? 2.2 : type === 'dance' ? 1.2 : 1;
    default:
      return outdoor ? 1.1 : 0.95;
  }
}

function timeFactor(type: ActionType, p: PoiDef, c: WorldClock, t: Temperament, visitor: boolean): number {
  const h = c.hours, owl = t.nightOwl > 0.5, night = c.period === 'night';
  // Quiet hours: locals who are up do calm things (benches, stars, books, a café nightcap). Raid crowds party on.
  if (deepNight(h) && !visitor) return nightCalmFactor(type, p.kind, owl, h);
  switch (type) {
    case 'drink': return h >= 6 && h < 11 ? 1.6 : night ? 0.8 : 1;
    case 'eat': return (h >= 11.5 && h < 14) || (h >= 18 && h < 20.5) ? 1.6 : 1;
    case 'dance': return c.period === 'evening' ? 1.6 : night ? (owl ? 1.9 : 1.1) : h < 11 ? 0.6 : 1;
    case 'play': return p.kind === 'playground' ? (night ? 0.3 : c.period === 'afternoon' ? 1.3 : 1) : p.kind === 'arcade' && night ? (owl ? 1.7 : 1.2) : 1;
    case 'read': return night ? 0.6 : c.period === 'afternoon' ? 1.2 : 1;
    case 'admire': return c.period === 'evening' ? 1.2 : 1;
    case 'watch': return c.period === 'evening' || night ? 1.3 : 1;
    case 'wander': return night ? (owl ? 1.2 : 0.8) : 1;
    case 'rest': return owl ? 1 : c.period === 'evening' ? 1.7 : night ? 1.4 : 1;
    case 'sit': return !owl && c.period === 'evening' ? 1.4 : 1;
    default: return 1;
  }
}

export function sleepersCount(w: World): number {
  let n = 0;
  for (const a of w.agents.values()) if (a.action?.type === 'sleep') n++;
  return n;
}

/**
 * How many locals may be asleep at once. Nights (21:00–06:00) have no cap — the night routine
 * (night.ts + the night watch) keeps a small shift awake instead; daytime naps stay capped at 30 %.
 */
export function sleepCap(w: World, c: WorldClock = worldClock(w.simTime)): number {
  let locals = 0;
  for (const a of w.agents.values()) if (!a.visitor) locals++;
  if (c.hours >= 21 || c.hours < 6) return Math.max(1, locals);
  return Math.max(1, Math.floor(locals * 0.3));
}

function sleepScore(w: World, a: Agent, c: WorldClock): number | null {
  if (a.visitor) return null;
  const owl = a.temperament.nightOwl > 0.5;
  const e = a.needs.energy;
  let s: number;
  // Before their bedtime only genuinely tired residents turn in early; after it, sleep wins easily.
  if (c.period === 'night' && !owl) s = (c.hours < 12 || c.hours >= bedtimeOf(a) - 0.5 ? 0.25 : 0) + urgency(e) * 1.6;
  else if (owl && c.period === 'morning') s = 0.05 + urgency(e) * 1.2;
  else if (e < 15) s = urgency(e) * 1.1;
  else return null;
  if (sleepersCount(w) >= sleepCap(w, c) && e > 8) return null;
  return s;
}

function occupancy(w: World, p: PoiDef, self: Agent): number {
  let n = 0;
  for (const o of w.agents.values()) if (o !== self && o.action?.poiId === p.id) n++;
  return n;
}

export interface Choice { def: ActionDef; poi: PoiDef; score: number }

export function scoreChoices(w: World, a: Agent, c: WorldClock): Choice[] {
  const out: Choice[] = [];
  const t = a.temperament;
  for (const def of ACTION_DEFS) {
    for (const p of POIS) {
      if (!def.kinds.includes(p.kind) || !p.affordances.includes(def.affordance)) continue;
      if (def.available && !def.available(w, a, p, c)) continue;
      const occ = occupancy(w, p, a);
      if (occ >= p.capacity) continue;
      let s: number;
      if (def.type === 'sleep') {
        const ss = sleepScore(w, a, c);
        if (ss === null) continue;
        s = ss;
      } else {
        const dur = (def.duration[0] + def.duration[1]) / 2;
        s = def.base;
        for (const k of ['energy', 'social', 'fun'] as const) {
          const gain = def.effects[k] * dur;
          const u = urgency(a.needs[k]) * attention(a, k);
          s += gain > 0 ? (Math.min(gain, 40) / 20) * u : -(Math.min(-gain, 30) / 30) * u * 0.8;
        }
        // A low need dominates: actions that fix it get a boost, the rest are damped.
        const low = lowestNeed(a);
        if (low.value < 22 && attention(a, low.key) >= 1) s *= def.effects[low.key] >= 0.2 ? 1.8 : 0.55;
        // Exhausted (and not a night owl at night): resting beats fun-seeking.
        if (a.needs.energy < 25 && !(t.nightOwl > 0.5 && c.period === 'night')) s *= def.effects.energy >= 0.2 ? 2 : def.effects.fun >= 0.2 ? 0.3 : 1;
        s *= def.pref(t, p);
        s *= timeFactor(def.type, p, c, t, a.visitor);
        if (a.visitor) s *= def.type === 'dance' ? 1.4 : def.type === 'watch' || def.type === 'admire' || def.type === 'play' ? 1.2 : def.type === 'sit' || def.type === 'rest' || def.type === 'read' ? 0.6 : 1;
        if (def.type === 'dance' || def.type === 'watch') s *= 1 + 0.12 * Math.min(occ, 4);
        else s *= 1 - (0.2 * occ) / p.capacity;
      }
      s *= weatherFactor(def.type, p, w, t);
      // Distressed residents look for a remedy close by instead of crossing town.
      s -= dist(a, p.position) * (Math.min(a.needs.energy, a.needs.social, a.needs.fun) < 25 ? 0.03 : 0.006);
      if (a.lastPoiId === p.id) s *= 0.55;
      if (a.lastType === def.type) s *= 0.7;
      s += w.rng.float('noise', a.id) * 0.2 * (1 + t.chaos);
      out.push({ def, poi: p, score: s });
    }
  }
  return out;
}

export function socializeCandidate(w: World, a: Agent): { score: number; target: Agent } | null {
  if (a.needs.social > 72 || w.simTime < a.socialReadyAt) return null;
  let best: Agent | null = null;
  let bs = -Infinity;
  for (const o of w.agents.values()) {
    if (o === a || o.leaving || isSleeping(o) || nightSleeper(o) || o.needs.energy < 15 || (o.action && o.action.priority >= 2)) continue;
    const d = dist(a, o);
    if (d > 30 || d < 0.5 || bedBound(w, o, worldClock(w.simTime).hours)) continue;
    const f = friendshipOf(w, a.id, o.id) ?? 42;
    const s = (f - 40) / 100 - d * 0.012;
    if (s > bs) { bs = s; best = o; }
  }
  if (!best) return null;
  const t = a.temperament;
  return { score: 0.05 + urgency(a.needs.social) * attention(a, 'social') * 0.9 * t.sociability * (t.shyness > 0.5 ? 0.6 : 1) + bs * 0.5 + w.rng.float('soc-noise', a.id) * 0.15, target: best };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export function releaseSeat(w: World, a: Agent): void {
  const key = a.action?.seatKey;
  if (key && w.seats.get(key) === a.id) w.seats.delete(key);
}

export function clearAction(w: World, a: Agent): void {
  releaseSeat(w, a);
  a.action = null;
  a.path = [];
}

export function cancelEncounter(w: World, id: number): void {
  const enc = w.encounters.get(id);
  if (!enc) return;
  w.encounters.delete(id);
  for (const pid of [enc.a, enc.b]) {
    const p = w.agents.get(pid);
    if (p?.action?.encounterId === id) clearAction(w, p);
  }
}

/** Stop whatever a resident is doing (standing up from a seat, leaving a conversation). */
export function interrupt(w: World, a: Agent): void {
  const act = a.action;
  if (!act) return;
  const seat = act.seatKey && act.phase === 'perform' ? SEAT_BY_KEY.get(act.seatKey) : undefined;
  if (act.encounterId !== undefined) cancelEncounter(w, act.encounterId);
  if (a.action) clearAction(w, a);
  if (seat) {
    a.x = seat.seat.x + Math.sin(seat.seat.facing) * 0.7;
    a.z = seat.seat.z + Math.cos(seat.seat.facing) * 0.7;
    pushOut(a);
  }
}

export function startAction(w: World, a: Agent, act: Action): void {
  if (a.action && a.action !== act) releaseSeat(w, a);
  a.action = act;
  if (act.seatKey) w.seats.set(act.seatKey, a.id);
  a.path = act.spot ? planPath({ x: a.x, z: a.z }, act.spot) : [];
  if (a.path.length) {
    act.phase = 'travel';
    act.travelTimeout = pathLength(a, a.path) / Math.max(0.5, act.speed) + 8;
    a.activity = act.travelActivity;
  } else {
    act.phase = 'perform';
    if (act.spot) { a.x = act.spot.x; a.z = act.spot.z; }
    a.activity = act.activity;
    act.onArrive?.(w, a);
  }
}

export interface GestureOptions {
  priority?: number;
  effects?: Needs;
  onDone?: (w: World, a: Agent) => void;
  onArrive?: (w: World, a: Agent) => void;
  run?: boolean;
  speed?: number;
  poiId?: string;
  anchored?: boolean;
  type?: ActionType;
}

/** Perform an activity on the spot for `seconds`. */
export function gesture(w: World, a: Agent, activity: string, seconds: number, o: GestureOptions = {}): void {
  interrupt(w, a);
  startAction(w, a, {
    type: o.type ?? 'gesture', phase: 'perform', travelActivity: activity, activity, spot: null, remaining: seconds,
    effects: o.effects ?? { ...NO_EFFECT }, speed: 0, priority: o.priority ?? 2, travelTimeout: 0, anchored: o.anchored ?? false,
    ...(o.poiId ? { poiId: o.poiId } : {}), ...(o.onDone ? { onDone: o.onDone } : {}), ...(o.onArrive ? { onArrive: o.onArrive } : {}),
  });
}

/** Walk (or run) to a spot, then perform an activity for `seconds`. */
export function goThen(w: World, a: Agent, spot: Vec2, travelActivity: string, activity: string, seconds: number, o: GestureOptions = {}): void {
  interrupt(w, a);
  startAction(w, a, {
    type: o.type ?? 'goto', phase: 'travel', travelActivity, activity, spot, remaining: seconds,
    effects: o.effects ?? { ...NO_EFFECT }, speed: o.speed ?? (o.run ? RUN_SPEED : WALK_SPEED * a.temperament.speed),
    priority: o.priority ?? 2, travelTimeout: 60, anchored: o.anchored ?? false,
    ...(o.poiId ? { poiId: o.poiId } : {}), ...(o.onDone ? { onDone: o.onDone } : {}), ...(o.onArrive ? { onArrive: o.onArrive } : {}),
  });
}

export function travelPhrase(p: PoiDef, type: ActionType, run: boolean): string {
  const verb = run ? 'running' : 'walking';
  return p.kind === 'home' && (type === 'sleep' || type === 'rest') ? `${verb} home to ${p.name}` : `${verb} to ${placeName(p)}`;
}

export function startChoice(w: World, a: Agent, choice: Choice, c: WorldClock, priority = 0, forceRun = false): boolean {
  const { def, poi: p } = choice;
  if (def.type === 'sleep' && p.id === a.homeId && nightSleepHours(w, a, c.hours) !== null) {
    startNightSleep(w, a, c, priority);
    a.lastPoiId = p.id;
    a.lastType = 'sleep';
    return true;
  }
  let seatKey: string | undefined;
  let spot: Vec2;
  if (def.needsSeat(p)) {
    const s = freeSeat(w, p, a);
    if (!s) return false;
    seatKey = s.key;
    spot = { x: s.seat.x, z: s.seat.z };
  } else spot = pickSpot(w, p, a, def.groundSit(p));
  const remaining = w.rng.range(def.duration[0], def.duration[1], 'dur', a.id);
  // "watching Kiki dance" names the dancer: behavior.ts drops the watch as soon as that stops being true.
  const watched = def.type === 'watch' && p.kind === 'stage' ? dancerAt(w, p, a) : undefined;
  // Nobody jogs across town in the quiet hours (raid crowds excepted).
  const run = forceRun || (dist(a, spot) > 26 && (a.temperament.speed > 1.05 || a.needs.energy > 80) && (a.visitor || !deepNight(c.hours)));
  interrupt(w, a);
  startAction(w, a, {
    type: def.type, phase: 'travel', travelActivity: travelPhrase(p, def.type, run), activity: def.phrase(w, a, p, c),
    poiId: p.id, ...(seatKey ? { seatKey } : {}), spot, remaining, effects: def.effects,
    speed: run ? RUN_SPEED : WALK_SPEED * a.temperament.speed, priority, travelTimeout: 60,
    anchored: !!seatKey || def.type === 'sleep',
    ...(def.type === 'wander' ? { hop: { center: p.position, radius: p.radius, next: w.simTime + w.rng.range(4, 7, 'hop', a.id), poiId: p.id } } : {}),
    ...(watched ? { partnerId: watched.id } : {}),
  });
  a.lastPoiId = p.id;
  a.lastType = def.type;
  return true;
}

export function startSocialize(w: World, a: Agent, target: Agent): void {
  const spot = meetingPoint(target, a, 2, `${a.id}|${target.id}`);
  interrupt(w, a);
  startAction(w, a, {
    type: 'socialize', phase: 'travel', travelActivity: `walking to ${target.displayName}`, activity: `waving at ${target.displayName}`,
    spot, remaining: 6, effects: { energy: 0, social: 0.3, fun: 0.1 }, speed: WALK_SPEED * a.temperament.speed, priority: 0,
    travelTimeout: 40, anchored: false, seekingId: target.id,
  });
  a.lastType = 'socialize';
}

/**
 * Go home and sleep until the personal wake-up time ("walking home to …" → "sleeping at …").
 * `sayGoodnight` lets a few residents say goodnight out loud (rate-limited town-wide).
 */
export function startNightSleep(w: World, a: Agent, c: WorldClock, priority = 0, sayGoodnight = false): void {
  const spot = sleepSpot(w, a);
  interrupt(w, a);
  const act = nightSleepAction(w, a, c.hours, spot, priority);
  // The wake-up time counts from the moment they actually lie down.
  act.onArrive = (w2, ag) => { if (ag.action === act) act.remaining = minutesUntilWake(w2, ag, worldClock(w2.simTime).hours); };
  act.onDone = wakeUp;
  if (sayGoodnight && !a.visitor && w.simTime - (w.facts.lastNightLineAt ?? -1e9) > 14 && w.rng.chance(0.55, 'goodnight', a.id)) {
    w.facts.lastNightLineAt = w.simTime;
    emit(w, 'chat', a, { text: lines.goodnight(w, a, placeVars(w, a, null, '', { home: poi(a.homeId).name })), payload: { reaction: 'goodnight', sentiment: 'positive' } });
  }
  startAction(w, a, act);
  a.lastType = 'sleep';
}

/** Morning: a few early risers greet the day out loud (rate-limited) before heading out. */
function wakeUp(w: World, a: Agent): void {
  const h = worldClock(w.simTime).hours;
  if (h < 5.5 || h > 11.5 || w.simTime - (w.facts.lastMorningLineAt ?? -1e9) < 12 || !w.rng.chance(0.5, 'good-morning', a.id)) return;
  w.facts.lastMorningLineAt = w.simTime;
  emit(w, 'chat', a, { text: lines.goodMorning(w, a, placeVars(w, a, null, '')), payload: { reaction: 'good-morning', sentiment: 'positive' } });
}

/** Remove a resident completely (raid visitors leaving, population eviction). */
export function removeAgent(w: World, id: string): void {
  const a = w.agents.get(id);
  if (!a) return;
  if (a.action?.encounterId !== undefined) cancelEncounter(w, a.action.encounterId);
  releaseSeat(w, a);
  for (const [key, owner] of [...w.seats]) if (owner === id) w.seats.delete(key);
  w.agents.delete(id);
  if (a.visitor) removeRelationshipsOf(w, id);
}
