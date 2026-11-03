/**
 * Per-resident update: travel along paths, perform activities (applying their
 * need effects), wander hops, and choosing what to do next.
 */
import type { WorldClock } from '../world/time';
import { cancelEncounter, clearAction, dancerAt, gesture, goThen, interrupt, removeAgent, scoreChoices, socializeCandidate, startAction, startChoice, startNightSleep, startSocialize } from './actions';
import { lines, placeVars } from './dialogue';
import { moveAlong, planPath, STROLL_SPEED, WALK_SPEED } from './movement';
import { applyEffects, distressNeed, fixes, isSleeping, lowestNeed, primaryNeed, type NeedKey } from './needs';
import { worldClock } from '../world/time';
import { atPlace, freeSeat, nearestPoi, pickSpot, placeName, poi, portalSpot, spotAround } from './places';
import { POIS, type PoiDef } from '../world/layout';
import { bedBound, bedtimeOf, deepNight, hoursUntil, isOwl, nightAwakeRange, nightDanceOk, nightIndex, nightSleeper, nightSleepHours, wakeOf } from './night';
import { hashUnit } from './rng';
import { startWelcomeWalk } from './social';
import { dist, emit, type Action, type Agent, type World } from './state';

const TRAVEL_COST = { energy: -0.03, social: 0, fun: 0 };

/** "watching {X} dance" must stay true: once X stops dancing on that stage, switch to another dancer or stop watching. */
function watchStale(w: World, a: Agent, act: Action): boolean {
  if (act.type !== 'watch' || !act.partnerId || !act.poiId) return false;
  const p = poi(act.poiId);
  const d = w.agents.get(act.partnerId);
  if (d && d.action?.type === 'dance' && d.action.poiId === p.id && d.action.phase === 'perform') return false;
  const other = dancerAt(w, p, a);
  if (!other) return true;
  act.partnerId = other.id;
  act.activity = `watching ${other.displayName} dance`;
  if (act.phase === 'perform') a.activity = act.activity;
  return false;
}

export function updateAgent(w: World, a: Agent, dt: number, clock: WorldClock): void {
  // Raid visitors leave promptly when their stay is over (unless a viewer event is playing out).
  if (a.visitor && !a.leaving && w.simTime >= a.leaveAt && !(a.action && a.action.priority >= 2)) { beginLeaving(w, a); return; }
  const act = a.action;
  if (!act) { decide(w, a, clock); return; }
  if (act.phase === 'travel') {
    // Bedtime: autonomous errands are dropped and the resident heads home instead (same for a dance the night no longer suits).
    if (act.priority === 0 && !act.hold && act.type !== 'sleep' && !a.visitor
      && (bedBound(w, a, clock.hours) || (act.type === 'dance' && !nightDanceOk(a, clock.hours)))) { clearAction(w, a); decide(w, a, clock); return; }
    a.activity = act.travelActivity;
    const done = moveAlong(a, act.speed * dt);
    applyEffects(a, TRAVEL_COST, dt);
    act.travelTimeout -= dt;
    if (done) {
      act.phase = 'perform';
      if (act.spot) { a.x = act.spot.x; a.z = act.spot.z; }
      if (watchStale(w, a, act)) { clearAction(w, a); decide(w, a, clock); return; }
      a.activity = act.activity;
      act.onArrive?.(w, a);
    } else if (act.travelTimeout <= 0) {
      if (act.encounterId !== undefined) cancelEncounter(w, act.encounterId);
      else clearAction(w, a);
    }
    return;
  }
  if (watchStale(w, a, act)) { clearAction(w, a); decide(w, a, clock); return; }
  applyEffects(a, act.effects, dt);
  // Distress interrupts unrelated autonomous activities so it stays visible (never a night's sleep).
  if (!a.visitor && act.priority === 0 && !act.hold && !act.distress && !act.night && act.remaining > 0.5 && w.simTime - a.moodShownAt >= 6) {
    const low = distressNeed(a, clock.period === 'night');
    if (low && !fixes(act.type, low)) act.remaining = 0.5;
  }
  // Satiation: an activity ends early once the need it serves is full (a night's sleep runs until the wake-up time).
  const primary = primaryNeed(act.type);
  if (primary && !act.night && act.priority < 1 && !act.hold && act.remaining > 1.5 && a.needs[primary] >= (act.type === 'sleep' ? 96 : 90)) act.remaining = 1.5;
  // Bedtime: autonomous activities wrap up so residents head home instead of dancing or chatting on;
  // the quiet hours also end autonomous dancing for anyone it no longer suits (viewer-driven dances have priority ≥ 1).
  if (act.priority === 0 && !act.hold && act.type !== 'sleep' && act.remaining > 1.5 && !a.visitor
    && (bedBound(w, a, clock.hours) || (act.type === 'dance' && !nightDanceOk(a, clock.hours)))) act.remaining = 1.5;
  if (act.hop) {
    if (a.path.length) moveAlong(a, STROLL_SPEED * dt);
    else if (w.simTime >= act.hop.next) {
      const s = pickSpot(w, poi(act.hop.poiId), a);
      act.spot = s;
      a.path = planPath({ x: a.x, z: a.z }, s);
      act.hop.next = w.simTime + w.rng.range(4, 7, 'hop', a.id);
    }
  }
  a.activity = act.activity;
  if (act.hold) return;
  act.remaining -= dt;
  if (act.remaining <= 0) {
    clearAction(w, a);
    act.onDone?.(w, a);
  }
}

export function decide(w: World, a: Agent, clock: WorldClock): void {
  if (a.visitor && w.simTime >= a.leaveAt) { beginLeaving(w, a); return; }
  if (a.needsWelcome) { a.needsWelcome = false; startWelcomeWalk(w, a); return; }
  if (!a.visitor) {
    // Bedtime (or back to bed after a restless spell): walk home and sleep until the personal wake-up time.
    if (bedBound(w, a, clock.hours)) { startNightSleep(w, a, clock, 0, clock.hours >= 20); return; }
    // Even night owls call it a night early when they are running on empty.
    if (isOwl(a) && deepNight(clock.hours) && a.needs.energy < 28 && w.simTime >= a.awakeUntil) { startNightSleep(w, a, clock); return; }
    // Distress stays visible: while a need is under 25 its state is re-shown ~10 s after the last one ended.
    const low = distressNeed(a, clock.period === 'night');
    if (low && w.simTime - a.moodShownAt >= 4) { showLowNeed(w, a, low); return; }
    const sleepyHour = (clock.period === 'evening' || clock.period === 'night') && a.temperament.nightOwl < 0.5;
    if (!low && sleepyHour && a.needs.energy < 56 && w.simTime - a.moodShownAt > 40 && w.rng.chance(0.65, 'mood-tired', a.id)) { showLowNeed(w, a, 'energy'); return; }
  }
  const choices = scoreChoices(w, a, clock).sort((x, y) => y.score - x.score);
  const social = socializeCandidate(w, a);
  if (social && (!choices.length || social.score > choices[0]!.score)) { startSocialize(w, a, social.target); return; }
  for (const c of choices.slice(0, 4)) if (startChoice(w, a, c, clock)) return;
  // Fallback: a stroll around the plaza is always possible.
  const plaza = poi('plaza');
  const spot = pickSpot(w, plaza, a);
  goThen(w, a, spot, 'walking to Town Plaza', 'wandering around Town Plaza', 8, { priority: 0, poiId: 'plaza', type: 'wander' });
}

/** Make a low need visible before acting on it: lonely → sulk by a bench, tired → think about a nap, bored → aimless wander. */
function showLowNeed(w: World, a: Agent, need: NeedKey): void {
  const clock = worldClock(w.simTime);
  const r = w.rng.float('distress-variant', a.id);
  const dur = (lo: number, hi: number) => w.rng.range(lo, hi, 'distress-dur', a.id);
  const mark = (seconds: number) => { a.moodShownAt = w.simTime + seconds; if (a.action) a.action.distress = need; };
  mutter(w, a, need);
  if (need === 'social') {
    a.socialReadyAt = Math.min(a.socialReadyAt, w.simTime);
    const cafe = poi('cafe');
    const seat = r < 0.3 && dist(a, cafe.position) < 15 ? freeSeat(w, cafe, a) : null;
    if (seat) {
      const d = dur(12, 18);
      interrupt(w, a);
      startAction(w, a, { type: 'sit', phase: 'travel', travelActivity: `walking to ${cafe.name}`, activity: `sitting alone at ${cafe.name}`, poiId: cafe.id, seatKey: seat.key,
        spot: { x: seat.seat.x, z: seat.seat.z }, remaining: d, effects: { energy: 0.3, social: 0, fun: 0 }, speed: WALK_SPEED * a.temperament.speed, priority: 0, travelTimeout: 40, anchored: true });
      mark(d + dist(a, seat.seat) / 1.3);
      return;
    }
    if (r < 0.6 && Math.hypot(a.x, a.z) < 11) {
      // People-watch for a bit, then go and talk to someone.
      const plaza = poi('plaza');
      const d = dur(8, 12);
      goThen(w, a, spotAround(w, { x: a.x, z: a.z }, 0, 1.2, a, 'crowd'), `walking to ${plaza.name}`, `watching the crowd at ${plaza.name}`, d, {
        priority: 0, poiId: plaza.id, effects: { energy: 0, social: 0.05, fun: 0 },
        onDone: (w2, ag) => { const t = socializeCandidate(w2, ag); if (t) startSocialize(w2, ag, t.target); },
      });
      mark(d + 1);
      return;
    }
    let bench: PoiDef | null = null;
    let bd = 12;
    for (const p of POIS) if (p.kind === 'bench') { const d = dist(a, p.position); if (d < bd) { bd = d; bench = p; } }
    const d = dur(12, 20);
    if (bench && r < 0.85) {
      const spot = spotAround(w, bench.position, 1, 1.5, a, 'lonely');
      goThen(w, a, spot, `walking to ${placeName(bench)}`, `sulking near ${placeName(bench)}`, d, { priority: 0, effects: { energy: 0.1, social: 0, fun: 0 } });
      mark(d + dist(a, spot) / 1.3);
    } else { gesture(w, a, `sulking alone ${atPlace(nearestPoi(a.x, a.z))}`, d, { priority: 0 }); mark(d); }
    return;
  }
  if (need === 'energy') {
    // Tired at night: exhausted residents always head home to bed; sleepy ones sometimes turn in early.
    if (nightSleepHours(w, a, clock.hours) !== null && (a.needs.energy < 25 || (r < 0.5 && (clock.hours < 12 || clock.hours >= bedtimeOf(a) - 0.75)))) {
      startNightSleep(w, a, clock, 0, clock.hours >= 20);
      mark(20);
      return;
    }
    if (r < 0.4) {
      const d = dur(6, 10);
      gesture(w, a, 'thinking about a nap', d, { priority: 0, effects: { energy: 0.2, social: 0, fun: 0 }, onDone: (w2, ag) => restNow(w2, ag) });
      mark(d);
      return;
    }
    let best: { key: string; seat: { x: number; z: number }; poi: PoiDef } | null = null;
    let bd = 12;
    for (const p of POIS) {
      if (p.kind !== 'bench') continue;
      const s2 = freeSeat(w, p, a);
      const d = dist(a, p.position);
      if (s2 && d < bd) { bd = d; best = { key: s2.key, seat: s2.seat, poi: p }; }
    }
    if (best) {
      const d = dur(14, 22);
      interrupt(w, a);
      startAction(w, a, { type: 'rest', phase: 'travel', travelActivity: `walking to ${placeName(best.poi)}`, activity: `resting ${atPlace(best.poi)}`, poiId: best.poi.id, seatKey: best.key,
        spot: { x: best.seat.x, z: best.seat.z }, remaining: d, effects: { energy: 0.7, social: 0, fun: 0 }, speed: WALK_SPEED * a.temperament.speed, priority: 0, travelTimeout: 40, anchored: true });
      mark(d + bd / 1.3);
      return;
    }
    const d = dur(6, 10);
    gesture(w, a, 'thinking about a nap', d, { priority: 0, effects: { energy: 0.2, social: 0, fun: 0 }, onDone: (w2, ag) => restNow(w2, ag) });
    mark(d);
    return;
  }
  // Bored (at night: no playground — the fountain, a think or a quiet wander).
  const fountain = poi('fountain');
  const pg = poi('playground');
  const quiet = deepNight(clock.hours);
  if ((r < 0.35 || (quiet && r < 0.6)) && dist(a, fountain.position) < 25) {
    const d = dur(10, 16);
    goThen(w, a, pickSpot(w, fountain, a), `wandering over to ${placeName(fountain)}`, 'watching the fountain, bored', d, { priority: 0, poiId: fountain.id, speed: STROLL_SPEED * 1.3, effects: { energy: 0.05, social: 0, fun: 0.05 } });
    mark(d + dist(a, fountain.position) / 1.2);
  } else if (!quiet && r < 0.6 && dist(a, pg.position) < 18) {
    const d = dur(12, 18);
    goThen(w, a, pickSpot(w, pg, a), `wandering over to ${placeName(pg)}`, `playing alone ${atPlace(pg)}`, d, { priority: 0, poiId: pg.id, type: 'play', speed: STROLL_SPEED * 1.3, effects: { energy: -0.1, social: -0.05, fun: 0.35 } });
    mark(d + dist(a, pg.position) / 1.2);
  } else if (r < 0.78) {
    const d = dur(6, 10);
    gesture(w, a, 'thinking about something fun to do', d, { priority: 0, effects: { energy: 0, social: 0, fun: 0.05 } });
    mark(d);
  } else {
    let place = poi('plaza');
    let bd = Infinity;
    for (const p of POIS) if (p.kind === 'plaza' || p.kind === 'park' || p.kind === 'garden') { const d = dist(a, p.position); if (d < bd) { bd = d; place = p; } }
    // About as long as the other bored states, so no single distress phrase dominates.
    const d = dur(10, 16);
    interrupt(w, a);
    startAction(w, a, {
      type: 'gesture', phase: 'travel', travelActivity: 'wandering around looking for fun', activity: 'wandering around looking for fun', poiId: place.id,
      spot: pickSpot(w, place, a), remaining: d, effects: { energy: -0.03, social: 0, fun: 0.08 }, speed: STROLL_SPEED, priority: 0, travelTimeout: 30, anchored: false,
      hop: { center: place.position, radius: place.radius, next: w.simTime + 4, poiId: place.id },
    });
    mark(d);
  }
}

/** Distressed residents sometimes say it out loud (rate-limited town-wide so history isn't flooded). */
function mutter(w: World, a: Agent, need: NeedKey): void {
  if (w.simTime - w.facts.lastMutterAt < 25 || !w.rng.chance(0.6, 'mutter', a.id)) return;
  w.facts.lastMutterAt = w.simTime;
  emit(w, 'chat', a, { text: lines.mutter(w, a, need), payload: { reaction: need === 'energy' ? 'tired' : need === 'social' ? 'lonely' : 'bored', sentiment: 'negative' } });
}

function restNow(w: World, a: Agent): void {
  const clock = worldClock(w.simTime);
  const rest = scoreChoices(w, a, clock)
    .filter(c => (c.def.type === 'rest' || c.def.type === 'sit' || c.def.type === 'sleep') && dist(a, c.poi.position) < 8)
    .sort((x, y) => y.score - x.score)[0];
  if (rest && startChoice(w, a, rest, clock)) return;
  gesture(w, a, `resting ${atPlace(nearestPoi(a.x, a.z))}`, 12, { priority: 0, type: 'rest', effects: { energy: 0.7, social: 0, fun: 0 } });
}

/** Being around people is mildly social (people-watching), so crowds don't starve. No events. */
export function ambientCompany(w: World, dt: number): void {
  const list = [...w.agents.values()];
  const near = new Array<number>(list.length).fill(0);
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const dx = a.x - b.x, dz = a.z - b.z;
      if (dx * dx + dz * dz < 12.25) { near[i]!++; near[j]!++; }
    }
  }
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (!near[i] || a.action?.type === 'sleep') continue;
    // Shy residents find crowds draining — they come out of a busy plaza feeling lonely.
    if (a.temperament.shyness > 0.5 && near[i]! >= 2) a.needs.social = Math.max(0, a.needs.social - 0.12 * dt);
    // Grumps aren't comforted by crowds; everyone else enjoys a little people-watching.
    else if (a.temperament.grumpiness < 0.5) applyEffects(a, { energy: 0, social: 0.025 * Math.min(3, near[i]!), fun: 0 }, dt);
  }
}

/** Raid visitors head back through the portal and are removed on arrival. */
export function beginLeaving(w: World, a: Agent): void {
  if (a.leaving && a.action?.type === 'leave') return;
  a.leaving = true;
  if (a.visitorIndex === 1) {
    let near: Agent | null = null;
    let bd = 16;
    for (const o of w.agents.values()) if (!o.visitor && o !== a) { const d = dist(a, o); if (d < bd) { bd = d; near = o; } }
    emit(w, 'chat', a, { target: near, text: lines.raidFarewell(w, a, placeVars(w, a, near, 'here')), payload: { reaction: 'farewell', sentiment: 'positive' } });
  }
  const spot = portalSpot(w, a);
  goThen(w, a, spot, 'leaving through the portal', 'leaving through the portal', 0.6, {
    priority: 3, type: 'leave', poiId: 'portal', run: dist(a, spot) > 15, onDone: (w2, ag) => removeAgent(w2, ag.id),
  });
}

/**
 * Night watch (quiet hours 23:30–04:45): a live stream should never look deserted, but the small hours are
 * quiet. Night owls INCLUDED, the town keeps `nightAwakeRange` locals up (≈ 2–3): when fewer than the minimum are
 * staying up, the most restless sleeper (rested enough, not up already tonight, not about to wake anyway) gets up
 * for an hour or so of calm night life — stargazing, a bench, a book, a café nightcap — then walks home to bed
 * again; nobody is woken while the cap is full. From 00:30 a surplus is sent to bed (restless sleepers first, then
 * the least owlish owls); residents a viewer is driving are never sent to bed. Runs every substep (O(n), cheap) so a
 * replacement gets up in the same step someone falls asleep.
 */
export function nightWatch(w: World, clock: WorldClock): void {
  const h = clock.hours;
  // Until 06:00: owls turn in at dawn, so the first early risers may get up a little early to keep the town alive.
  if (!(h >= 23.5 || h < 6)) return;
  const night = nightIndex(w.simTime);
  let locals = 0, up = 0;
  const staying: Agent[] = [];
  let best: Agent | null = null, urgent: Agent | null = null;
  let bs = -Infinity, us = -Infinity;
  for (const a of w.agents.values()) {
    if (a.visitor || a.leaving) continue;
    locals++;
    if (isOwl(a) && !nightSleeper(a)) a.nightSeen = night;
    if (!isSleeping(a)) {
      up++;
      // Heading to bed (or about to: bed-bound with nothing holding them) does not count as staying up.
      if (!nightSleeper(a) && !(bedBound(w, a, h) && !(a.action && (a.action.priority >= 1 || a.action.hold)))) staying.push(a);
      continue;
    }
    if (isOwl(a) || !a.action?.night) continue;
    const act = a.action;
    const left = hoursUntil(h, wakeOf(a));
    const t = a.temperament;
    // Prefer someone who hasn't been up yet tonight; the restless-minded (curious, creative, chaotic, romantic, bookish) first.
    const s = hashUnit(`restless:${a.id}:${night}`) + 0.25 * (t.curiosity + t.creative - 2) + 0.2 * t.chaos + 0.15 * (t.romance - 0.8)
      + 0.1 * (t.bookish - 0.7) - 0.35 * (t.restLove - 1) - (a.restlessNight === night ? 2 : 0);
    if (h < 4.75 && a.needs.energy >= 50 && w.simTime - (act.since ?? w.simTime) >= 50 && left >= 1.75 && s > bs) { bs = s; best = a; }
    // Below the minimum, anyone reasonably rested will do (after 05:00: whoever is due up soonest).
    const early = h >= 5 && h < 12 ? 10 - left : s;
    if (a.needs.energy >= 35 && left >= (h >= 5 && h < 12 ? 0.1 : 1) && early > us) { us = early; urgent = a; }
  }
  const { min, max } = nightAwakeRange(locals);
  // Too many staying up in the small hours: the surplus heads home (restless neighbours first, then the least owlish owls).
  if ((h >= 0.5 && h < 5) && staying.length > max) {
    const viewerDriven = (a: Agent) => w.simTime - (a.viewerAt ?? -1e9) < 90 || (a.action?.priority ?? 0) >= 2;
    const order = staying.filter(a => !viewerDriven(a) && !(a.action?.hold))
      .map(a => ({ a, s: (isOwl(a) ? 10 + a.temperament.nightOwl * 2 : 0) + a.needs.energy / 100 + (a.restlessNight === night ? 0 : 1) }))
      .sort((x, y) => x.s - y.s || (x.a.id < y.a.id ? -1 : 1));
    for (const { a } of order.slice(0, staying.length - max)) {
      a.awakeUntil = Math.min(a.awakeUntil, w.simTime);
      startNightSleep(w, a, clock);
    }
    return;
  }
  if (staying.length >= min || up >= max) return;
  const pick = best ?? urgent;
  if (pick) getUpRestless(w, pick, clock, night, h >= 5 && h < 12);
}

function getUpRestless(w: World, a: Agent, clock: WorldClock, night: number, earlyBird = false): void {
  a.restlessNight = night;
  // An early bird (after 05:00) simply starts the day: up until well past the wake-up time.
  a.awakeUntil = w.simTime + (earlyBird ? hoursUntil(clock.hours, wakeOf(a)) * 60 + 30 : w.rng.range(50, 90, 'restless-for', a.id));
  interrupt(w, a);
  if (!earlyBird && w.simTime - (w.facts.lastNightLineAt ?? -1e9) > 20 && w.rng.chance(0.6, 'restless-say', a.id)) {
    w.facts.lastNightLineAt = w.simTime;
    emit(w, 'chat', a, { text: lines.restless(w, a, placeVars(w, a, null, '')), payload: { reaction: 'restless', sentiment: 'positive' } });
  }
  decide(w, a, clock);
}
