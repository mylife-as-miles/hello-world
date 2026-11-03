/**
 * Approach-then-act for targeted viewer events (social greet / compliment / befriend / celebrate, gift).
 *
 * A viewer event whose target is more than ~5 m away is not performed across town any more: the actor walks
 * over (jogs when > 12 m) and the action happens on arrival, ~1.1 m from the target; a very far pair (> 25 m)
 * jogs toward each other and meets halfway along the actor's route. The target pauses and turns to the
 * approaching actor (`waving at …`); a sleeper stays asleep and is approached where they lie. The payoff always
 * lands within APPROACH_CAP sim seconds (= real seconds): when the cap is hit the action is performed at the
 * reached distance, exactly as the old instant behaviour did. Deterministic (no randomness), Node-safe.
 *
 * Snapshot surface (renderer / camera): actor `walking to {T}` / `running to {T}`, target `waving at {A}` or
 * `running to {A}` (meet halfway); the payoff is the usual simulation reply event (targetId = actor).
 */
import type { Vec2 } from '../world/layout';
import { clearAction, gesture, goThen } from './actions';
import { meetingPoint, pathLength, planDirectPath, RUN_SPEED, WALK_SPEED } from './movement';
import { isSleeping } from './needs';
import { pushOut } from './places';
import { dist, type Action, type Agent, type World } from './state';

/** Closer than this the action happens on the spot (as before). */
export const APPROACH_MIN = 5;
/** Farther than this the actor jogs instead of walking. */
export const APPROACH_JOG_OVER = 12;
/** Farther than this both jog toward each other and meet halfway. */
export const APPROACH_MEET_OVER = 25;
/** The payoff always happens within this many sim seconds of the event. */
export const APPROACH_CAP = 9;
/** Actor and target count as "there" within this distance. */
export const APPROACH_REACH = 1.5;
const STAND_OFF = 1.1;
const BRISK_MAX = 1.65;
/** Plan so arrival lands comfortably inside the cap. */
const PLAN_TIME = APPROACH_CAP - 1.5;

export type ApproachMode = 'walk' | 'jog' | 'meet';

/** Called once when the pair meets (or the cap is hit). `own` = the actor is still free to animate. */
export type ApproachPayoff = (w: World, actor: Agent, target: Agent | undefined, own: boolean) => void;

export interface Approach {
  id: number;
  actorId: string;
  targetId: string;
  mode: ApproachMode;
  startedAt: number;
  by: number;
  actorAct: Action;
  targetAct: Action | null;
  /** Where the actor is heading (re-planned when the target drifts away from it). */
  goal: Vec2;
  replanAt: number;
  fire: ApproachPayoff;
}

function pointAlong(from: Vec2, path: readonly Vec2[], s: number): Vec2 {
  let cur = from;
  let left = Math.max(0, s);
  for (const p of path) {
    const d = dist(cur, p);
    if (d >= left) { const t = d > 1e-6 ? left / d : 0; return { x: cur.x + (p.x - cur.x) * t, z: cur.z + (p.z - cur.z) * t }; }
    left -= d;
    cur = p;
  }
  return { x: cur.x, z: cur.z };
}

/** Replace the nav-graph route goThen planned with the direct one (still in the travel phase). */
function steer(a: Agent, goal: Vec2): void {
  const act = a.action;
  if (!act || act.phase !== 'travel') return;
  a.path = planDirectPath({ x: a.x, z: a.z }, goal);
  act.travelTimeout = APPROACH_CAP + 5;
}

/** Pending approach of this actor, if any. */
export function approachOf(w: World, actorId: string): Approach | undefined {
  for (const ap of w.approaches.values()) if (ap.actorId === actorId) return ap;
  return undefined;
}

/**
 * Start an approach; returns false when the target is close enough (≤ minD) or cannot be approached —
 * the caller then performs the action on the spot.
 */
export function approachThen(w: World, A: Agent, T: Agent, fire: ApproachPayoff, minD = APPROACH_MIN): boolean {
  if (A === T || T.leaving || A.leaving || dist(A, T) <= minD) return false;
  // A newer viewer event for the same actor settles the previous one first (at the reached distance).
  const prev = approachOf(w, A.id);
  if (prev) fireApproach(w, prev);
  const asleep = isSleeping(T);
  const d = dist(A, T);
  const walkSpeed = WALK_SPEED * A.temperament.speed;
  // The target stops and turns to the actor (a sleeper is left alone).
  let targetAct: Action | null = null;
  if (!asleep) {
    gesture(w, T, `waving at ${A.displayName}`, APPROACH_CAP + 2, { priority: 2, effects: { energy: 0, social: 0.3, fun: 0.1 } });
    targetAct = T.action;
  }
  const stand = meetingPoint(T, A, STAND_OFF, `${A.id}|${T.id}|approach`);
  const route = planDirectPath({ x: A.x, z: A.z }, stand);
  const L = pathLength(A, route);
  let mode: ApproachMode = d > APPROACH_MEET_OVER || L / RUN_SPEED > PLAN_TIME ? 'meet' : d > APPROACH_JOG_OVER || L / BRISK_MAX > PLAN_TIME ? 'jog' : 'walk';
  if (mode === 'meet' && !targetAct) mode = 'jog';
  let goal = stand;
  if (mode === 'meet') {
    // Halfway along the actor's route to the target; each stops ~0.6 m short of the midpoint.
    const full = planDirectPath({ x: A.x, z: A.z }, { x: T.x, z: T.z });
    const LF = pathLength(A, full);
    goal = pointAlong(A, full, LF / 2 - STAND_OFF / 2);
    const tGoal = pointAlong(A, full, LF / 2 + STAND_OFF / 2);
    pushOut(goal);
    pushOut(tGoal);
    goThen(w, T, tGoal, `running to ${A.displayName}`, `waving at ${A.displayName}`, APPROACH_CAP + 2, { priority: 2, run: true });
    targetAct = T.action;
    steer(T, tGoal);
  }
  const speed = mode === 'walk' ? Math.min(BRISK_MAX, Math.max(walkSpeed, L / PLAN_TIME)) : RUN_SPEED;
  goThen(w, A, goal, `${mode === 'walk' ? 'walking' : 'running'} to ${T.displayName}`, `waving at ${T.displayName}`, APPROACH_CAP + 2, { priority: 2, speed });
  steer(A, goal);
  const id = w.nextApproachId++;
  w.approaches.set(id, {
    id, actorId: A.id, targetId: T.id, mode, startedAt: w.simTime, by: w.simTime + APPROACH_CAP,
    actorAct: A.action!, targetAct, goal, replanAt: w.simTime + 1, fire,
  });
  return true;
}

/** Settle an approach now: stop the pair where they are and run the payoff. */
export function fireApproach(w: World, ap: Approach): void {
  if (!w.approaches.delete(ap.id)) return;
  const A = w.agents.get(ap.actorId);
  const T = w.agents.get(ap.targetId);
  if (!A) { if (T && ap.targetAct && T.action === ap.targetAct) clearAction(w, T); return; }
  const own = A.action === ap.actorAct;
  if (own) clearAction(w, A);
  if (T && ap.targetAct && T.action === ap.targetAct) clearAction(w, T);
  ap.fire(w, A, T, own);
}

/** Settle any approach this actor is making (a newer viewer event for them arrived). */
export function flushApproachesOf(w: World, actorId: string): void {
  const ap = approachOf(w, actorId);
  if (ap) fireApproach(w, ap);
}

/** Per substep: fire approaches whose pair met, whose cap is up, or whose actor got pulled away; follow drifting targets. */
export function updateApproaches(w: World): void {
  if (!w.approaches.size) return;
  for (const ap of [...w.approaches.values()]) {
    const A = w.agents.get(ap.actorId);
    const T = w.agents.get(ap.targetId);
    if (!A || A.leaving) { fireApproach(w, ap); continue; }
    const own = A.action === ap.actorAct;
    const close = !!T && dist(A, T) <= APPROACH_REACH;
    const arrived = own && ap.actorAct.phase === 'perform';
    const targetComing = !!T && !!ap.targetAct && T.action === ap.targetAct && ap.targetAct.phase === 'travel';
    if (!T || close || !own || w.simTime + 1e-9 >= ap.by || (arrived && !targetComing && dist(A, T) <= STAND_OFF + 0.6)) { fireApproach(w, ap); continue; }
    // The target moved (pulled into something else, nudged, re-targeted): head to where they are now.
    if (!targetComing && w.simTime >= ap.replanAt && dist(T, ap.goal) > STAND_OFF + 1.2) {
      ap.replanAt = w.simTime + 1;
      const spot = meetingPoint(T, A, STAND_OFF, `${A.id}|${T.id}|re`);
      ap.goal = spot;
      ap.actorAct.spot = spot;
      ap.actorAct.phase = 'travel';
      ap.actorAct.travelTimeout = APPROACH_CAP + 5;
      ap.actorAct.speed = Math.max(ap.actorAct.speed, dist(A, spot) > 4 ? RUN_SPEED : ap.actorAct.speed);
      A.path = planDirectPath({ x: A.x, z: A.z }, spot);
      A.activity = ap.actorAct.travelActivity;
    } else if (arrived && !targetComing && dist(A, T) > STAND_OFF + 0.6) {
      // Waiting at the goal while the target is somewhere else: the replan above takes over once allowed.
      ap.replanAt = Math.min(ap.replanAt, w.simTime);
    }
  }
}
