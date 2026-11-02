/**
 * Per-resident update: travel along paths, perform activities (applying their
 * need effects), wander hops, and choosing what to do next.
 */
import type { WorldClock } from '../world/time';
import { cancelEncounter, clearAction, gesture, goThen, interrupt, removeAgent, scoreChoices, socializeCandidate, startAction, startChoice, startSocialize } from './actions';
import { lines, placeVars } from './dialogue';
import { moveAlong, planPath, STROLL_SPEED } from './movement';
import { applyEffects, lowestNeed, primaryNeed, type NeedKey } from './needs';
import { atPlace, nearestPoi, pickSpot, placeName, poi, portalSpot, spotAround } from './places';
import { POIS, type PoiDef } from '../world/layout';
import { startWelcomeWalk } from './social';
import { dist, emit, type Agent, type World } from './state';

const TRAVEL_COST = { energy: -0.03, social: 0, fun: 0 };

export function updateAgent(w: World, a: Agent, dt: number, clock: WorldClock): void {
  const act = a.action;
  if (!act) { decide(w, a, clock); return; }
  if (act.phase === 'travel') {
    a.activity = act.travelActivity;
    const done = moveAlong(a, act.speed * dt);
    applyEffects(a, TRAVEL_COST, dt);
    act.travelTimeout -= dt;
    if (done) {
      act.phase = 'perform';
      if (act.spot) { a.x = act.spot.x; a.z = act.spot.z; }
      a.activity = act.activity;
      act.onArrive?.(w, a);
    } else if (act.travelTimeout <= 0) {
      if (act.encounterId !== undefined) cancelEncounter(w, act.encounterId);
      else clearAction(w, a);
    }
    return;
  }
  applyEffects(a, act.effects, dt);
  // Satiation: an activity ends early once the need it serves is full.
  const primary = primaryNeed(act.type);
  if (primary && act.priority < 1 && !act.hold && act.remaining > 1.5 && a.needs[primary] >= (act.type === 'sleep' ? 96 : 90)) act.remaining = 1.5;
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
  if (!a.visitor && w.simTime - a.moodShownAt > 40) {
    const low = lowestNeed(a);
    if (low.value < 24 && w.rng.chance(0.7, 'mood-show', a.id)) { a.moodShownAt = w.simTime; showLowNeed(w, a, low.key); return; }
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
  if (need === 'social') {
    a.socialReadyAt = Math.min(a.socialReadyAt, w.simTime);
    let bench: PoiDef | null = null;
    let bd = 18;
    for (const p of POIS) if (p.kind === 'bench') { const d = dist(a, p.position); if (d < bd) { bd = d; bench = p; } }
    if (bench) {
      const spot = spotAround(w, bench.position, 1, 1.5, a, 'lonely');
      goThen(w, a, spot, `walking to ${placeName(bench)}`, `sulking near ${placeName(bench)}`, 5, { priority: 0, effects: { energy: 0.1, social: 0, fun: 0 } });
    } else gesture(w, a, `sulking alone ${atPlace(nearestPoi(a.x, a.z))}`, 5, { priority: 0 });
    return;
  }
  if (need === 'energy') { gesture(w, a, 'thinking about a nap', 3.5, { priority: 0, effects: { energy: 0.2, social: 0, fun: 0 } }); return; }
  let place = poi('plaza');
  let bd = Infinity;
  for (const p of POIS) if (p.kind === 'plaza' || p.kind === 'park' || p.kind === 'garden') { const d = dist(a, p.position); if (d < bd) { bd = d; place = p; } }
  interrupt(w, a);
  startAction(w, a, {
    type: 'wander', phase: 'travel', travelActivity: 'wandering around looking for fun', activity: 'wandering around looking for fun', poiId: place.id,
    spot: pickSpot(w, place, a), remaining: 9, effects: { energy: -0.03, social: 0, fun: 0.1 }, speed: STROLL_SPEED, priority: 0, travelTimeout: 30, anchored: false,
    hop: { center: place.position, radius: place.radius, next: w.simTime + 4, poiId: place.id },
  });
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
    if (near[i]! > 0 && a.action?.type !== 'sleep') applyEffects(a, { energy: 0, social: 0.04 * Math.min(3, near[i]!), fun: 0 }, dt);
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
    priority: 3, type: 'leave', poiId: 'portal', onDone: (w2, ag) => removeAgent(w2, ag.id),
  });
}
