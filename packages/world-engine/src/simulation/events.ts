/**
 * Contract event semantics (docs/INTEGRATION_CONTRACT.md). Every handler turns
 * a validated viewer/Twitch event into resident state changes plus a few
 * `source: 'simulation'` follow-up events (replies, wave-backs, welcomes...).
 */
import type { WorldEvent, WorldEventPayload } from '@hello-world/contracts';
import { appearanceFromSeed, hashString, normalizeAppearance } from '../avatars/catalog';
import { POIS, SPAWN_POINT } from '../world/layout';
import { worldClock } from '../world/time';
import { gesture, goThen, interrupt, removeAgent, scoreChoices, startAction, startChoice } from './actions';
import { complimentThing, lines, memoryLine, placeVars, requestExtraLine, withArticle } from './dialogue';
import { WALK_SPEED } from './movement';
import { baseBedtime } from './night';
import { bump, feel, isSleeping } from './needs';
import { compatibility, defaultPersonality, temperamentFor } from './personality';
import { arrivalSpot, atPlace, homeFor, nearestPoi, pickSpot, poi, portalSpot, pushOut, spotAround } from './places';
import { addMemory, adjustFriendship, getRel, pairKey, reactsPositively } from './relationships';
import { startEncounter } from './social';
import { approachThen, flushApproachesOf } from './approach';
import { cleanText, dist, emit, schedule, type Agent, type World } from './state';

export const VISITOR_BASES = ['vrm-polybot', 'vrm-astrodisco', 'vrm-coffee', 'vrm-chill'] as const;
export const VISITOR_STAY_SECONDS = 240;
const STALE_MS = 15 * 60 * 1000;

export interface NewAgentInit {
  id: string; name: string; x: number; z: number; appearance: Agent['appearance']; personality: string[];
  joinedAt: number; lastActiveAt: number; needs?: Agent['needs']; activity?: string; zone?: string; seed?: boolean; visitor?: boolean;
}

export function createAgent(w: World, init: NewAgentInit): Agent {
  const personality = init.personality.slice(0, 5);
  return {
    id: init.id, displayName: cleanText(init.name, 40) || 'Neighbor', appearance: init.appearance, personality,
    temperament: temperamentFor(personality),
    needs: init.needs ? { ...init.needs } : { energy: 70 + w.rng.range(0, 25, 'n-e', init.id), social: 45 + w.rng.range(0, 30, 'n-s', init.id), fun: 45 + w.rng.range(0, 30, 'n-f', init.id) },
    x: init.x, z: init.z, zone: init.zone ?? 'portal', activity: init.activity ?? 'arriving through the portal',
    joinedAt: init.joinedAt, lastActiveAt: init.lastActiveAt, homeId: homeFor(init.id).id, seed: !!init.seed, visitor: !!init.visitor,
    leaveAt: Infinity, leaving: false, needsWelcome: false, action: null, path: [], mood: 0.2, sentiment: 0,
    socialReadyAt: 0, lastReplyAt: -1e9, moodShownAt: -1e9,
    // Personal bedtime (night.ts adds temperament; night owls keep their own dawn schedule).
    bedtime: baseBedtime(init.id), awakeUntil: -1e9,
  };
}

/** Make room for one more resident: raid visitors first (leaving ones first), then stale viewers. */
function makeRoom(w: World, protect: string, protectGroup?: string): boolean {
  if (w.agents.size < w.maxResidents) return true;
  // Departing visitors go first, then the oldest raid's visitors — never the raid that is arriving.
  const visitors = [...w.agents.values()].filter(a => a.visitor && a.id !== protect && (!protectGroup || a.group !== protectGroup))
    .sort((a, b) => Number(b.leaving) - Number(a.leaving) || a.leaveAt - b.leaveAt);
  if (visitors.length) { removeAgent(w, visitors[0]!.id); return true; }
  const stale = [...w.agents.values()].filter(a => !a.seed && a.id !== protect && w.now - a.lastActiveAt >= STALE_MS)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  if (stale.length) { removeAgent(w, stale[0]!.id); return true; }
  return false;
}

function arrive(w: World, a: Agent, then?: (w: World, a: Agent) => void): void {
  const portal = poi('portal').position;
  const dx = a.x - portal.x, dz = a.z - portal.z;
  const d = Math.hypot(dx, dz) || 1;
  const out = { x: a.x + (dx / d) * 1.4, z: a.z + Math.max(0.6, (dz / d) * 1.4) };
  startAction(w, a, {
    type: 'goto', phase: 'travel', travelActivity: 'arriving through the portal', activity: 'arriving through the portal', spot: out,
    remaining: 0.4, effects: { energy: 0, social: 0, fun: 0 }, speed: 1.5, priority: 2, travelTimeout: 6, anchored: false, poiId: 'portal',
    ...(then ? { onDone: then } : {}),
  });
}

export function joinResident(w: World, id: string, name: string, payload: WorldEventPayload | undefined, explicitJoin: boolean): Agent | null {
  const existing = w.agents.get(id);
  if (existing) {
    const lookBefore = JSON.stringify(existing.appearance);
    existing.displayName = cleanText(name, 40) || existing.displayName;
    if (payload?.appearance) existing.appearance = normalizeAppearance(payload.appearance);
    if (payload?.personality?.length) { existing.personality = payload.personality.slice(0, 5); existing.temperament = temperamentFor(existing.personality); }
    existing.lastActiveAt = Math.floor(w.now);
    if (explicitJoin && !existing.leaving) {
      if (JSON.stringify(existing.appearance) !== lookBefore) reactToNewLook(w, existing);
      else {
        gesture(w, existing, 'waving hello', 3, { priority: 2 });
        if (w.simTime - existing.lastReplyAt > 30) {
          existing.lastReplyAt = w.simTime;
          emit(w, 'wave', existing, { text: lines.newcomerHello(w, existing, true, placeVars(w, existing, null, '')), payload: { reaction: 'hello', sentiment: 'positive' } });
        }
      }
    }
    return existing;
  }
  if (!makeRoom(w, id)) return null;
  const spot = arrivalSpot(w, { id } as Agent);
  const a = createAgent(w, {
    id, name, x: spot.x, z: spot.z,
    appearance: payload?.appearance ? normalizeAppearance(payload.appearance) : appearanceFromSeed(id),
    personality: payload?.personality?.length ? payload.personality : defaultPersonality(id),
    joinedAt: Math.floor(w.now), lastActiveAt: Math.floor(w.now),
  });
  a.needsWelcome = true;
  a.viewerAt = w.simTime;
  // A fresh arrival explores for about an hour before following the night routine (joins at 2 AM still get to look around).
  a.awakeUntil = w.simTime + 75;
  w.agents.set(id, a);
  arrive(w, a);
  return a;
}

/** Visible reaction to an avatar edit: a little show-off moment, a line, and maybe a neighbour's compliment. */
export function reactToNewLook(w: World, a: Agent): void {
  gesture(w, a, 'admiring their new look', 3.5, { priority: 2, effects: { energy: 0, social: 0.3, fun: 1 } });
  emit(w, 'chat', a, { text: lines.newLook(w, a, placeVars(w, a, null, '')), payload: { reaction: 'new-look', sentiment: 'positive' } });
  const fan = nearestOther(w, a, 12, o => awake(o) && !busyWithEvent(o) && o.action?.type !== 'converse');
  if (!fan) return;
  schedule(w, 1.5, w2 => {
    const A = w2.agents.get(a.id), F = w2.agents.get(fan.id);
    if (!A || !F || !awake(F) || busyWithEvent(F)) return;
    gesture(w2, F, `complimenting ${A.displayName}`, 3, { priority: 1 });
    emit(w2, 'social', F, { target: A, text: lines.lookCompliment(w2, F, placeVars(w2, F, A, '')), payload: { action: 'compliment', sentiment: 'positive', reaction: 'new-look' } });
    adjustFriendship(w2, F, A, 2);
  });
}

function actorOf(w: World, e: WorldEvent, autoJoin: boolean): Agent | null {
  const a = w.agents.get(e.actorId);
  if (a) {
    if (e.source !== 'simulation') {
      a.lastActiveAt = Math.max(a.lastActiveAt, Math.floor(w.now));
      if (e.actorDisplayName && e.actorDisplayName !== a.displayName && e.kind !== 'raid') a.displayName = cleanText(e.actorDisplayName, 40) || a.displayName;
      // An active viewer's resident stays up a little while after acting (night routine resumes afterwards).
      a.awakeUntil = Math.max(a.awakeUntil, w.simTime + 20);
      a.viewerAt = w.simTime;
    }
    return a;
  }
  return autoJoin ? joinResident(w, e.actorId, e.actorDisplayName, e.payload, false) : null;
}

function nearestOther(w: World, a: Agent, maxD = Infinity, filter: (o: Agent) => boolean = () => true): Agent | null {
  let best: Agent | null = null;
  let bd = maxD;
  for (const o of w.agents.values()) {
    if (o === a || !filter(o)) continue;
    const d = dist(a, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function targetOf(w: World, e: WorldEvent, actor: Agent): Agent | null {
  const t = e.targetId ? w.agents.get(e.targetId) : undefined;
  if (t && t !== actor) return t;
  return nearestOther(w, actor, Infinity, o => !o.leaving);
}

const awake = (a: Agent) => !isSleeping(a) && !a.leaving;
const busyWithEvent = (a: Agent) => !!a.action && a.action.priority >= 2;
const sent = (p: boolean) => (p ? 'positive' : 'negative');

export function handleEvent(w: World, e: WorldEvent): void {
  // A newer viewer event for a resident who is still walking over to someone settles that one first.
  if (e.source !== 'simulation') flushApproachesOf(w, e.actorId);
  switch (e.kind) {
    case 'join': joinResident(w, e.actorId, e.actorDisplayName, e.payload, true); break;
    case 'chat': onChat(w, e); break;
    case 'wave': onWave(w, e); break;
    case 'dance': onDance(w, e); break;
    case 'gift': onGift(w, e); break;
    case 'social': onSocial(w, e); break;
    case 'weather': onWeather(w, e); break;
    case 'confetti': onConfetti(w, e); break;
    case 'raid': onRaid(w, e); break;
    case 'custom': onCustom(w, e); break;
    default: break;
  }
}

function onChat(w: World, e: WorldEvent): void {
  const a = actorOf(w, e, true);
  if (!a || a.leaving) return;
  const target = e.targetId ? w.agents.get(e.targetId) ?? null : null;
  const arriving = a.action?.travelActivity === 'arriving through the portal';
  if (!arriving) gesture(w, a, target && target !== a ? `chatting with ${target.displayName}` : 'chatting', 5.5, { effects: { energy: 0, social: 1.2, fun: 0.2 } });
  bump(a, { social: 3 });
  const replier = target && target !== a && awake(target) ? target
    : nearestOther(w, a, 9, o => awake(o) && !busyWithEvent(o) && w.simTime - o.lastReplyAt > 8);
  if (!replier || w.simTime - w.facts.lastChatReplyAt < 3) return;
  const keen = target === replier ? 0.95 : 0.35 + 0.25 * replier.temperament.sociability + ((getRel(w, a.id, replier.id)?.friendship ?? 45) - 45) / 100;
  if (!w.rng.chance(keen, 'chat-reply', replier.id)) return;
  w.facts.lastChatReplyAt = w.simTime;
  replier.lastReplyAt = w.simTime;
  const heard = e.text ?? '';
  schedule(w, w.rng.range(1.2, 2.2, 'chat-delay', replier.id), w2 => {
    const A = w2.agents.get(a.id), R = w2.agents.get(replier.id);
    if (!A || !R || !awake(R)) return;
    const positive = reactsPositively(w2, R, A, 'reply');
    const at = atPlace(nearestPoi(R.x, R.z));
    const text = lines.chatReply(w2, R, heard, positive, placeVars(w2, R, A, at));
    if (!busyWithEvent(R)) gesture(w2, R, `chatting with ${A.displayName}`, 4, { priority: 1, effects: { energy: 0, social: 1, fun: 0.2 } });
    emit(w2, positive ? 'chat' : 'social', R, { target: A, text, payload: positive ? { reaction: 'reply', sentiment: 'positive' } : { action: 'greet', sentiment: 'negative' } });
    adjustFriendship(w2, R, A, positive ? 1.5 : -1);
    const key = pairKey(A.id, R.id);
    if (w2.simTime - (w2.memoryAt.get(key) ?? -1e9) > 120) addMemory(w2, A, R, memoryLine(w2, 'reply', true, { a: A.displayName, b: R.displayName, at }, cleanText(heard, 60)));
    const rel = getRel(w2, A.id, R.id);
    requestExtraLine(w2, 'reply', R, A, text, rel?.memories ?? [], rel?.friendship, at, heard);
  });
}

function onWave(w: World, e: WorldEvent): void {
  const a = actorOf(w, e, true);
  if (!a || a.leaving) return;
  const t = e.targetId ? targetOf(w, e, a) : nearestOther(w, a, 20, o => !o.leaving);
  gesture(w, a, t ? `waving at ${t.displayName}` : 'waving hello', 3, { effects: { energy: 0, social: 1, fun: 0.3 } });
  if (!t || !awake(t)) return;
  const positive = reactsPositively(w, t, a, 'wave');
  schedule(w, 0.8, w2 => {
    const A = w2.agents.get(a.id), T = w2.agents.get(t.id);
    if (!A || !T || !awake(T)) return;
    if (!busyWithEvent(T)) gesture(w2, T, positive ? `waving at ${A.displayName}` : 'sulking', 2.5, { priority: 1 });
    if (positive) emit(w2, 'wave', T, { target: A, payload: { reaction: 'wave-back', sentiment: 'positive' } });
    else emit(w2, 'social', T, { target: A, text: lines.snub(w2, T, placeVars(w2, T, A, '')), payload: { action: 'greet', sentiment: 'negative' } });
    adjustFriendship(w2, A, T, positive ? w2.rng.range(1.5, 3, 'wave', T.id) : -1);
    bump(T, { social: positive ? 2 : 0 });
  });
}

function onDance(w: World, e: WorldEvent): void {
  const a = actorOf(w, e, true);
  if (!a || a.leaving) return;
  const stage = poi('stage');
  const nearStage = dist(a, stage.position) <= 6;
  const fx = { energy: -0.3, social: 0.3, fun: 1.4 };
  if (nearStage) goThen(w, a, pickSpot(w, stage, a), `walking to the ${stage.name}`, `dancing on the ${stage.name}`, 12, { effects: fx, poiId: stage.id, type: 'dance' });
  else gesture(w, a, 'dancing', 10, { effects: fx, type: 'dance' });
  const center = nearStage ? stage.position : { x: a.x, z: a.z };
  const joiners = [...w.agents.values()]
    .filter(o => o !== a && awake(o) && !busyWithEvent(o) && dist(o, center) < 8)
    .map(o => ({ o, s: (o.temperament.playfulness + o.temperament.creative) / 2 + ((getRel(w, o.id, a.id)?.friendship ?? 45) - 50) / 50 + w.rng.float('join-dance', o.id) * 0.3 }))
    .filter(x => x.s >= 1.15 && x.o.temperament.grumpiness < 0.5)
    .sort((x, y) => y.s - x.s).slice(0, 3);
  joiners.forEach(({ o }, i) => {
    const spot = spotAround(w, center, 1.3, 2, o, 'dance-spot');
    goThen(w, o, spot, `walking to ${a.displayName}`, `dancing with ${a.displayName}`, 9, { effects: fx, priority: 1, type: 'dance' });
    if (i === 0) emit(w, 'dance', o, { target: a, text: lines.danceJoin(w, o, placeVars(w, o, a, '')), payload: { reaction: 'join-dance', sentiment: 'positive' } });
    adjustFriendship(w, o, a, 2);
  });
  const grump = nearestOther(w, a, 8, o => awake(o) && o.temperament.grumpiness > 0.5 && !joiners.some(j => j.o === o));
  if (grump && w.simTime - w.facts.lastGrumbleAt > 20 && w.rng.chance(0.5, 'grumble', grump.id)) {
    w.facts.lastGrumbleAt = w.simTime;
    emit(w, 'social', grump, { target: a, text: lines.danceGrumble(w, grump, placeVars(w, grump, a, '')), payload: { action: 'greet', sentiment: 'negative', reaction: 'grumble' } });
  }
}

function onGift(w: World, e: WorldEvent): void {
  const a = actorOf(w, e, true);
  if (!a || a.leaving) return;
  const t = targetOf(w, e, a);
  const rawItem = typeof e.payload?.item === 'string' && e.payload.item.trim() ? cleanText(e.payload.item, 32) : 'flowers';
  const item = withArticle(rawItem);
  if (!t) { gesture(w, a, `gifting ${item}`, 3); return; }
  // The hand-over (friendship, memory, thanks) happens only when the giver is actually there
  // (≤ ~2 m, or wherever the giver got to when the approach cap ran out).
  const handOver = (w2: World, giver: Agent, T: Agent | undefined, own: boolean) => {
    if (!T || T.leaving) { if (own) gesture(w2, giver, `gifting ${item}`, 3); return; }
    if (own) gesture(w2, giver, `gifting ${item} to ${T.displayName}`, 3);
    const woken = isSleeping(T);
    const at = atPlace(nearestPoi(T.x, T.z));
    interrupt(w2, T);
    gesture(w2, T, `thanking ${giver.displayName}`, 5, { effects: { energy: 0, social: 1.2, fun: 0.8 } });
    adjustFriendship(w2, giver, T, w2.rng.range(8, 13, 'gift', T.id));
    const line = memoryLine(w2, 'gift', true, { a: giver.displayName, b: T.displayName, at, item });
    addMemory(w2, giver, T, woken ? `${line.split(' — ')[0]} — ${T.displayName} woke up smiling` : line);
    bump(T, { social: 8, fun: 6 });
    bump(giver, { social: 5, fun: 3 });
    feel(T, 0.4);
    w2.facts.lastGiftAt = w2.simTime;
    emit(w2, 'chat', T, { target: giver, text: lines.thanks(w2, T, woken, placeVars(w2, T, giver, at, { item })), payload: { reaction: 'thanks', sentiment: 'positive', item: rawItem } });
  };
  // A gift is always handed over in person: anything beyond arm's reach (2.5 m) is walked / jogged over first.
  if (!approachThen(w, a, t, handOver, 2.5)) handOver(w, a, t, true);
}

function onSocial(w: World, e: WorldEvent): void {
  const a = actorOf(w, e, true);
  if (!a || a.leaving) return;
  const action = e.payload?.action ?? 'greet';
  const t = targetOf(w, e, a);
  // Farther than ~5 m: walk / jog over (or meet halfway) and do it face to face — within the approach cap.
  if (t && approachThen(w, a, t, (w2, A, T, own) => performSocial(w2, A, T, action, own))) return;
  performSocial(w, a, t ?? undefined, action, true);
}

/** The social action itself (on the spot, or once the actor has walked over). `own`: the actor may be animated. */
function performSocial(w: World, a: Agent, t: Agent | undefined, action: NonNullable<WorldEventPayload['action']>, own: boolean): void {
  const at = atPlace(nearestPoi((t ?? a).x, (t ?? a).z));
  const pose = (activity: string, seconds: number, effects?: Agent['needs']) => { if (own) gesture(w, a, activity, seconds, effects ? { effects } : {}); };
  if (action === 'celebrate') {
    pose(t ? `celebrating with ${t.displayName}` : 'celebrating', 5, { energy: -0.1, social: 0.6, fun: 1.2 });
    for (const o of [...w.agents.values()].filter(o => o !== a && o !== t && awake(o) && !busyWithEvent(o) && dist(o, a) < 10).slice(0, 5)) {
      gesture(w, o, `cheering for ${a.displayName}`, 4, { priority: 1, effects: { energy: 0, social: 0.5, fun: 1 } });
    }
    if (t && awake(t)) {
      gesture(w, t, `celebrating with ${a.displayName}`, 4, { priority: 2, effects: { energy: 0, social: 0.5, fun: 1 } });
      emit(w, 'social', t, { target: a, text: lines.celebrateReply(w, t, placeVars(w, t, a, at)), payload: { action: 'celebrate', sentiment: 'positive' } });
      adjustFriendship(w, a, t, 3);
    }
    return;
  }
  if (!t) { pose('waving hello', 3); return; }
  const verb = action === 'compliment' ? 'complimenting' : action === 'befriend' ? 'befriending' : 'greeting';
  pose(`${verb} ${t.displayName}`, 3, { energy: 0, social: 1, fun: 0.3 });
  if (!awake(t)) { if (t.leaving) return; addMemory(w, a, t, memoryLine(w, 'asleep', true, { a: a.displayName, b: t.displayName, at })); return; }
  const va = placeVars(w, t, a, at);
  if (action === 'befriend') {
    const rel = getRel(w, a.id, t.id);
    const compat = compatibility(a.temperament, t.temperament, a.personality, t.personality) + ((rel?.friendship ?? 45) - 50) / 100 + t.mood * 0.1;
    const yes = compat >= 0.45;
    gesture(w, t, yes ? `celebrating with ${a.displayName}` : 'thinking', 4, { priority: 2 });
    if (yes) pose(`celebrating with ${t.displayName}`, 4);
    emit(w, 'social', t, { target: a, text: lines.befriendReply(w, t, yes, va), payload: { action: 'befriend', sentiment: sent(yes) } });
    adjustFriendship(w, a, t, yes ? w.rng.range(15, 25, 'befriend', t.id) : 3);
    addMemory(w, a, t, memoryLine(w, yes ? 'friends' : 'declined', yes, { a: a.displayName, b: t.displayName, at }));
    feel(t, yes ? 0.4 : 0);
    bump(t, { social: yes ? 10 : 3 });
    return;
  }
  const kind = action === 'compliment' ? 'compliment' : 'greet';
  const positive = reactsPositively(w, t, a, kind);
  gesture(w, t, positive ? (kind === 'greet' ? `waving at ${a.displayName}` : `chatting with ${a.displayName}`) : 'sulking', 3.5, { priority: 2, effects: { energy: 0, social: 1, fun: 0.2 } });
  const text = kind === 'compliment' ? lines.complimentReply(w, t, positive, va) : lines.response(w, t, positive, va);
  emit(w, positive && kind === 'compliment' ? 'chat' : 'social', t, { target: a, text, payload: { action: kind, sentiment: sent(positive) } });
  const delta = positive ? (kind === 'compliment' ? w.rng.range(5, 10, 'soc', t.id) : w.rng.range(4, 8, 'soc', t.id)) : -w.rng.range(2, 4, 'soc', t.id);
  adjustFriendship(w, a, t, delta);
  addMemory(w, a, t, memoryLine(w, kind === 'compliment' ? 'compliment' : 'greet', positive, { a: a.displayName, b: t.displayName, at, thing: complimentThing(w, t) }));
  feel(t, positive ? 0.25 : -0.1);
  bump(t, { social: positive ? 5 : 1 });
  bump(a, { social: 4 });
  if (positive && kind === 'greet' && dist(a, t) < 10) {
    schedule(w, 3.6, w2 => {
      const A = w2.agents.get(a.id), T = w2.agents.get(t.id);
      if (!A || !T || busyWithEvent(A) || busyWithEvent(T) || !awake(A) || !awake(T) || A.action?.type === 'converse' || T.action?.type === 'converse') return;
      startEncounter(w2, A, T, 'chat', false);
    });
  }
}

function onWeather(w: World, e: WorldEvent): void {
  const weather = e.payload?.weather;
  if (!weather) return;
  const prev = w.weather;
  w.weather = weather;
  if (prev === weather) return;
  const clock = worldClock(w.simTime);
  let speaker: Agent | null = null;
  let loudest = -Infinity;
  for (const a of w.agents.values()) {
    if (!awake(a) || busyWithEvent(a) || a.action?.type === 'converse') continue;
    const t = a.temperament;
    const loud = t.chaos + t.playfulness * 0.5 + t.sociability * 0.3 + w.rng.float('loud', a.id) * 0.3;
    if (loud > loudest) { loudest = loud; speaker = a; }
    const r = w.rng.float('weather-react', a.id);
    if (weather === 'rain') {
      if ((t.playfulness > 1.4 || t.chaos > 0.4) && r < 0.35) gesture(w, a, 'dancing in the rain', 8, { priority: 1, type: 'dance', effects: { energy: -0.2, social: 0.1, fun: 1.2 } });
      else if (r < 0.75) {
        const shelter = scoreChoices(w, a, clock).filter(c => c.poi.kind === 'cafe' || c.poi.kind === 'arcade' || (c.poi.kind === 'home' && c.def.type === 'rest')).sort((x, y) => y.score - x.score)[0];
        if (shelter) startChoice(w, a, shelter, clock, 1, dist(a, shelter.poi.position) > 6);
      }
    } else if (weather === 'snow') {
      if (t.playfulness > 1.2 && r < 0.6) gesture(w, a, 'playing in the snow', 10, { priority: 1, type: 'play', effects: { energy: -0.2, social: 0.2, fun: 1.3 } });
      else if (r < 0.4) gesture(w, a, 'admiring the snow', 6, { priority: 1, type: 'admire', effects: { energy: 0, social: 0, fun: 0.5 } });
    } else if (weather === 'sunset') {
      if (r < 0.55) {
        const view = w.rng.pick(['fountain', 'garden', 'portal'] as const, 'sunset-spot', a.id);
        const p = dist(a, poi(view).position) < 25 ? poi(view) : poi('fountain');
        goThen(w, a, pickSpot(w, p, a), `walking to ${p.kind === 'fountain' ? 'the ' : p.kind === 'garden' || p.kind === 'portal' ? 'the ' : ''}${p.name}`, `admiring the sunset ${atPlace(p)}`, 12, { priority: 1, type: 'admire', poiId: p.id, effects: { energy: 0.1, social: 0.05, fun: 0.6 } });
      }
    } else if (r < 0.3) gesture(w, a, 'cheering for the sunshine', 3, { priority: 1, effects: { energy: 0, social: 0, fun: 0.6 } });
  }
  if (speaker) emit(w, 'chat', speaker, { text: lines.weather(w, speaker, weather, placeVars(w, speaker, null, '')), payload: { reaction: 'weather', weather, sentiment: 'positive' } });
}

function onConfetti(w: World, e: WorldEvent): void {
  w.facts.confettiAt = w.simTime;
  const actor = w.agents.get(e.actorId) ?? null;
  const center = actor ? { x: actor.x, z: actor.z } : { x: 0, z: 0 };
  if (actor && !actor.leaving) { actor.lastActiveAt = Math.max(actor.lastActiveAt, Math.floor(w.now)); gesture(w, actor, 'celebrating', 6, { effects: { energy: 0, social: 0.5, fun: 1.5 } }); }
  let first: Agent | null = null;
  for (const o of w.agents.values()) {
    if (o === actor || !awake(o) || dist(o, center) > 14 || o.action?.type === 'converse') continue;
    const cheer = w.rng.chance(0.6, 'confetti', o.id);
    gesture(w, o, cheer ? (actor ? `cheering for ${actor.displayName}` : 'cheering') : 'celebrating', w.rng.range(4, 6.5, 'confetti-d', o.id), { priority: 2, effects: { energy: 0, social: 0.4, fun: 1.2 } });
    first ??= o;
  }
  if (first && w.simTime - w.facts.lastAmbientAt > 8) {
    w.facts.lastAmbientAt = w.simTime;
    emit(w, 'social', first, { ...(actor ? { target: actor } : {}), text: lines.confetti(w, first, placeVars(w, first, actor, '')), payload: { action: 'celebrate', sentiment: 'positive', reaction: 'confetti' } });
  }
}

function safeIdPart(s: string): string {
  return s.replace(/[^\w:.@-]/g, '-').slice(0, 56) || 'raid';
}

function onRaid(w: World, e: WorldEvent): void {
  const amount = typeof e.payload?.amount === 'number' ? e.payload.amount : 0;
  // Visitor agents scale with the raid: 40 viewers ≈ 14 avatars, 100+ → 16 (population cap still applies).
  const n = raidVisitorCount(amount);
  const base = cleanText(typeof e.payload?.channel === 'string' && e.payload.channel ? e.payload.channel : e.actorDisplayName, 24) || 'Friendly';
  w.facts.raidAt = w.simTime;
  w.facts.raidChannel = base;
  const group = `raid:${safeIdPart(e.id)}`;
  const spawnAt: number[] = [];
  let acc = 0;
  for (let k = 1; k <= n; k++) { spawnAt.push(acc); acc += w.rng.range(0.5, 0.8, 'raid-stagger', `${group}:${k}`); }
  const groups = Math.ceil(n / 4);
  for (let k = 1; k <= n; k++) {
    const g = Math.floor((k - 1) / 4);
    const lastInGroup = Math.min(n, g * 4 + 4);
    // Groups of up to 4 head to distinct spots around the north half of the plaza ring.
    const theta = -Math.PI / 2 + (g - (groups - 1) / 2) * 0.95;
    const plan: VisitorPlan = {
      arc: arcSpot(k, n),
      // Everyone in a group finishes celebrating together, then they walk to the plaza side by side.
      celebrate: 4 + (spawnAt[lastInGroup - 1]! - spawnAt[k - 1]!),
      anchor: { x: Math.cos(theta) * 5.6, z: Math.sin(theta) * 5.6 },
      slot: (k - 1) % 4,
      // They also leave together, group by group (waves).
      leaveAt: w.simTime + VISITOR_STAY_SECONDS + g * 15,
    };
    schedule(w, spawnAt[k - 1]!, w2 => spawnVisitor(w2, group, k, base, plan));
  }
  // Locals hurry to the portal to welcome them.
  const portal = poi('portal');
  const locals = [...w.agents.values()]
    .filter(a => !a.visitor && awake(a) && !busyWithEvent(a))
    .map(a => ({ a, s: a.temperament.sociability + a.temperament.kindness * 0.5 - dist(a, portal.position) * 0.02 + w.rng.float('raid-welcome', a.id) * 0.2 }))
    .sort((x, y) => y.s - x.s).slice(0, 4);
  locals.forEach(({ a }, i) => {
    const spot = portalSpot(w, a);
    const run = dist(a, spot) > 8;
    goThen(w, a, spot, `${run ? 'running' : 'walking'} to the ${portal.name}`, 'cheering for the raiders', 6, {
      priority: 2, run, poiId: portal.id, effects: { energy: -0.05, social: 0.6, fun: 1.2 },
      ...(i === 0 ? { onArrive: (w2: World, ag: Agent) => {
        const v = [...w2.agents.values()].find(o => o.group === group);
        emit(w2, 'social', ag, { ...(v ? { target: v } : {}), text: lines.raidWelcome(w2, ag, placeVars(w2, ag, v ?? null, '')), payload: { action: 'greet', sentiment: 'positive', reaction: 'raid-welcome' } });
        if (v) { adjustFriendship(w2, ag, v, 6); addMemory(w2, ag, v, memoryLine(w2, 'raid', true, { a: ag.displayName, b: v.displayName, at: '' })); }
      } } : {}),
    });
  });
  const announcer = locals[0]?.a;
  // Crowd size for the renderer (banner / extra crowd): `amount` is the real raid size, `visitors` the same clamped to the validator's 50.
  const crowd = { visitors: Math.min(50, Math.max(n, amount)), amount: Math.max(n, amount), channel: base };
  w.facts.raidCrowd = crowd;
  if (announcer) emit(w, 'social', announcer, { text: lines.raidAnnounce(w, announcer, placeVars(w, announcer, null, '')), payload: { action: 'celebrate', sentiment: 'positive', reaction: 'raid', ...crowd } });
}

const RAIDER_NAMES = ['Pip', 'Sprout', 'Biscuit', 'Clover', 'Comet', 'Pebble', 'Maple', 'Nimbus', 'Waffles', 'Bean', 'Taffy', 'Echo', 'Sunny', 'Dot', 'Mango', 'Fig', 'Rook', 'Moss', 'Tango', 'Nova Jr', 'Pixel', 'Juniper', 'Bramble', 'Kiwi'] as const;

/** Friendly, varied, unique-per-raid visitor names ("CozyStreamer's #1 fan", "Raider Pip", "Biscuit from CozyStreamer"). */
export function raiderName(group: string, k: number, base: string): string {
  if (k === 1) return cleanText(`${base}'s #1 fan`, 40);
  const start = hashString(group) % RAIDER_NAMES.length;
  const name = RAIDER_NAMES[(start + (k - 2) * 7) % RAIDER_NAMES.length]!;
  const pattern = (hashString(`${group}:${k}`) >>> 3) % 4;
  const full = pattern === 0 ? `Raider ${name}` : pattern === 1 ? `${name} from ${base}` : pattern === 2 ? `${name} the Raider` : `${base}'s fan ${name}`;
  return cleanText(full, 40);
}

interface VisitorPlan { arc: { x: number; z: number }; celebrate: number; anchor: { x: number; z: number }; slot: number; leaveAt: number }

export function raidVisitorCount(amount: number): number {
  return Math.min(16, Math.max(3, Math.round(Math.sqrt(Math.max(0, amount)) * 2.2)));
}

const SLOT_OFFSETS = [{ x: -0.55, z: -0.45 }, { x: 0.55, z: -0.45 }, { x: -0.55, z: 0.5 }, { x: 0.55, z: 0.5 }] as const;

/** Arrival point k of n on an arc in front of (south of) the portal ring — never stacked. */
export function arcSpot(k: number, n: number): { x: number; z: number } {
  const portal = poi('portal').position;
  // Two rows: up to 8 on an inner arc, the rest on a wider outer arc.
  const inner = Math.min(n, 8);
  const row2 = k > 8;
  const count = row2 ? n - 8 : inner;
  const i = row2 ? k - 9 : k - 1;
  const theta = Math.PI * (row2 ? 0.15 + (0.7 * (i + 0.5)) / count : 0.12 + (0.76 * (i + 0.5)) / count);
  const r = row2 ? 4.4 : 2.8;
  return { x: portal.x + Math.cos(theta) * r, z: portal.z + Math.sin(theta) * r };
}

function spawnVisitor(w: World, group: string, k: number, base: string, plan?: VisitorPlan): void {
  const id = `${group}:${k}`;
  if (w.agents.has(id) || !makeRoom(w, id, group)) return;
  const spot = plan ? { ...plan.arc } : arrivalSpot(w, { id } as Agent);
  const appearance = { ...appearanceFromSeed(id), baseModelId: VISITOR_BASES[(k - 1) % VISITOR_BASES.length]! };
  const a = createAgent(w, {
    id, name: raiderName(group, k, base), x: spot.x, z: spot.z, appearance: normalizeAppearance(appearance),
    personality: ['energetic', 'friendly', w.rng.pick(['playful', 'curious', 'chaotic', 'creative'] as const, 'raider-trait', id)],
    joinedAt: Math.floor(w.now), lastActiveAt: Math.floor(w.now), visitor: true,
    needs: { energy: 85, social: 60, fun: 70 },
  });
  a.group = group;
  a.visitorIndex = k;
  a.leaveAt = plan?.leaveAt ?? w.simTime + VISITOR_STAY_SECONDS + k * 2;
  w.agents.set(id, a);
  arrive(w, a, (w2, ag) => gesture(w2, ag, 'celebrating the raid', plan?.celebrate ?? 4, {
    priority: 1, effects: { energy: 0, social: 0.6, fun: 1 },
    ...(plan ? { onDone: (w3: World, v: Agent) => {
      const off = SLOT_OFFSETS[plan.slot % SLOT_OFFSETS.length]!;
      const target = { x: plan.anchor.x + off.x, z: plan.anchor.z + off.z };
      pushOut(target);
      // Linger as a crowd that fills the plaza before exploring.
      const vibe = ['admiring Town Plaza', 'cheering for the town', 'dancing in Town Plaza', 'waving hello'][plan.slot % 4]!;
      goThen(w3, v, target, 'walking to Town Plaza', vibe, w3.rng.range(18, 26, 'raid-linger', v.id), { priority: 1, speed: WALK_SPEED, poiId: 'plaza', type: vibe.startsWith('dancing') ? 'dance' : 'goto', effects: { energy: -0.05, social: 0.4, fun: 0.6 } });
    } } : {}),
  }));
  if (k === 1) {
    schedule(w, 2.2, w2 => {
      const v = w2.agents.get(id);
      if (!v) return;
      emit(w2, 'chat', v, { text: lines.raidArrival(w2, v, placeVars(w2, v, null, '')), payload: { reaction: 'raid-arrival', sentiment: 'positive', ...(w2.facts.raidCrowd ?? { channel: base }) } });
    });
  }
}

function onCustom(w: World, e: WorldEvent): void {
  const p = e.payload;
  if (p?.action === 'update-avatar') {
    const known = w.agents.has(e.actorId);
    const a = actorOf(w, e, true);
    if (a && p.appearance) {
      const before = JSON.stringify(a.appearance);
      a.appearance = normalizeAppearance(p.appearance);
      if (p.personality?.length) { a.personality = p.personality.slice(0, 5); a.temperament = temperamentFor(a.personality); }
      if (known && !a.leaving && JSON.stringify(a.appearance) !== before) reactToNewLook(w, a);
    }
    return;
  }
  const a = actorOf(w, e, false);
  if (!a || a.leaving) return;
  const dest = typeof p?.destination === 'string' ? p.destination.toLowerCase().trim() : '';
  if (!dest) return;
  const target = POIS.find(x => x.id === dest || x.name.toLowerCase() === dest) ?? POIS.find(x => x.zone === dest);
  if (!target) return;
  const clock = worldClock(w.simTime);
  const choice = scoreChoices(w, a, clock).filter(c => c.poi.id === target.id).sort((x, y) => y.score - x.score)[0];
  if (choice && startChoice(w, a, choice, clock, 2)) return;
  goThen(w, a, pickSpot(w, target, a), `walking to ${target.name}`, `admiring ${target.name}`, 8, { priority: 2, poiId: target.id });
}

export { SPAWN_POINT, WALK_SPEED };
