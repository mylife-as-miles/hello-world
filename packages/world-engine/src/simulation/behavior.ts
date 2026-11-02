/**
 * Per-resident update: travel along paths, perform activities (applying their
 * need effects), wander hops, and choosing what to do next.
 */
import type { WorldClock } from '../world/time';
import { cancelEncounter, clearAction, goThen, removeAgent, scoreChoices, socializeCandidate, startChoice, startSocialize } from './actions';
import { lines, placeVars } from './dialogue';
import { moveAlong, planPath, STROLL_SPEED } from './movement';
import { applyEffects } from './needs';
import { pickSpot, poi, portalSpot } from './places';
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
  const choices = scoreChoices(w, a, clock).sort((x, y) => y.score - x.score);
  const social = socializeCandidate(w, a);
  if (social && (!choices.length || social.score > choices[0]!.score)) { startSocialize(w, a, social.target); return; }
  for (const c of choices.slice(0, 4)) if (startChoice(w, a, c, clock)) return;
  // Fallback: a stroll around the plaza is always possible.
  const plaza = poi('plaza');
  const spot = pickSpot(w, plaza, a);
  goThen(w, a, spot, 'walking to Town Plaza', 'wandering around Town Plaza', 8, { priority: 0, poiId: 'plaza', type: 'wander' });
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
