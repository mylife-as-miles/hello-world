/**
 * Social life: autonomous encounters (approach → 2–4 spoken lines → friendship
 * + memory), a town-wide social director that rate-limits chatter to one new
 * exchange every ~6–12 s, friendship milestones, and newcomer welcomes.
 */
import type { PoiDef } from '../world/layout';
import { hashString } from '../avatars/catalog';
import { mix32 } from './rng';
import { cancelEncounter, clearAction, gesture, goThen, interrupt, startAction } from './actions';
import { complimentThing, GIFT_ITEMS, lines, pickTopic, placeVars, requestExtraLine, withArticle } from './dialogue';
import { meetingPoint, WALK_SPEED } from './movement';
import { bump, feel, isSleeping, urgency } from './needs';
import { atPlace, homeFor, nearestPoi, spotAround } from './places';
import { addMemory, adjustFriendship, friendshipOf, getRel, pairKey, reactsPositively } from './relationships';
import { cleanText, dist, emit, schedule, type Agent, type Encounter, type EncounterKind, type PlannedLine, type World } from './state';

const CHAT_EFFECTS = { energy: 0, social: 2, fun: 0.15 };

export function socialAvailable(w: World, a: Agent): boolean {
  if (a.leaving || w.simTime < a.socialReadyAt) return false;
  const act = a.action;
  if (!act) return true;
  if (act.type === 'sleep' || act.type === 'converse' || act.priority > 0) return false;
  return true;
}

function seated(a: Agent): boolean { return !!a.action?.seatKey && a.action.phase === 'perform'; }

function planLines(w: World, kind: EncounterKind, A: Agent, B: Agent, positive: boolean, place: PoiDef, at: string)
  : { lines: PlannedLine[]; topicLabel: string; quote: string; thing?: string; item?: string } {
  const rel = getRel(w, A.id, B.id);
  const friendship = rel?.friendship ?? 45;
  const varsA = placeVars(w, A, B, at, { home: homeFor(A.id).name });
  const varsB = placeVars(w, B, A, at, { home: homeFor(B.id).name });
  const sentiment = positive ? 'positive' : 'negative';
  const out: PlannedLine[] = [];
  if (kind === 'greet') {
    out.push({ speaker: 'a', kind: 'social', text: lines.intro(w, A, varsA), payload: { action: 'greet', sentiment: 'positive' }, speakerActivity: `greeting ${B.displayName}` });
    out.push({ speaker: 'b', kind: 'social', text: lines.introReply(w, B, positive, varsB), payload: { action: 'greet', sentiment } });
    if (positive && w.rng.chance(0.55, 'greet-more', A.id)) {
      const topic = pickTopic({ w, speaker: A, listener: B, place, friendship, memories: [], vars: varsA });
      out.push({ speaker: 'a', kind: 'chat', text: topic.line, payload: { sentiment: 'positive' } });
    }
    return { lines: out, topicLabel: 'meeting', quote: out[1]!.text };
  }
  if (kind === 'compliment') {
    const thing = complimentThing(w, B);
    out.push({ speaker: 'a', kind: 'social', text: lines.compliment(w, A, { ...varsA, thing }), payload: { action: 'compliment', sentiment: 'positive' }, speakerActivity: `complimenting ${B.displayName}` });
    out.push(positive
      ? { speaker: 'b', kind: 'chat', text: lines.complimentReply(w, B, true, varsB), payload: { action: 'compliment', sentiment } }
      : { speaker: 'b', kind: 'social', text: lines.complimentReply(w, B, false, varsB), payload: { action: 'compliment', sentiment } });
    return { lines: out, topicLabel: thing, quote: out[0]!.text, thing };
  }
  if (kind === 'gift') {
    const item = w.rng.pick(GIFT_ITEMS, 'gift-item', A.id);
    out.push({ speaker: 'a', kind: 'gift', text: lines.gift(w, A, { ...varsA, item }), payload: { item, sentiment: 'positive' }, speakerActivity: `gifting ${item} to ${B.displayName}`, listenerActivity: `thanking ${A.displayName}` });
    out.push({ speaker: 'b', kind: 'chat', text: lines.thanks(w, B, false, { ...varsB, item }), payload: { reaction: 'thanks', sentiment: 'positive', item }, speakerActivity: `thanking ${A.displayName}` });
    return { lines: out, topicLabel: 'a gift', quote: out[1]!.text, item };
  }
  // chat
  out.push({ speaker: 'a', kind: 'chat', text: lines.opener(w, A, varsA), payload: { sentiment: 'positive' } });
  if (!positive) {
    out.push({ speaker: 'b', kind: 'social', text: lines.response(w, B, false, varsB), payload: { action: 'greet', sentiment: 'negative' } });
    return { lines: out, topicLabel: 'nothing much', quote: out[1]!.text };
  }
  out.push({ speaker: 'b', kind: 'chat', text: lines.response(w, B, true, varsB), payload: { sentiment: 'positive' } });
  const extra = (w.rng.chance(0.75, 'chat-len', A.id) ? 1 : 0) + (w.rng.chance(0.5 * Math.min(1.4, (A.temperament.sociability + B.temperament.sociability) / 2), 'chat-len2', B.id) ? 1 : 0);
  const memories = getRel(w, A.id, B.id)?.memories ?? [];
  const topic = pickTopic({ w, speaker: A, listener: B, place, friendship, memories, vars: varsA });
  if (extra >= 1) out.push({ speaker: 'a', kind: 'chat', text: topic.line, payload: { sentiment: 'positive' }, ...(topic.joke ? { listenerActivity: `laughing with ${A.displayName}` } : {}) });
  if (extra >= 2) out.push({ speaker: 'b', kind: 'chat', text: topic.reply, payload: { sentiment: 'positive' } });
  return { lines: out, topicLabel: topic.label, quote: extra >= 1 ? topic.line : out[1]!.text };
}

/** Start a face-to-face exchange: A walks to ~1.2 m from B, then they talk. */
export function startEncounter(w: World, A: Agent, B: Agent, kind: EncounterKind, autonomous: boolean): Encounter | null {
  if (A === B || A.leaving || B.leaving) return null;
  interrupt(w, A);
  interrupt(w, B);
  const place = nearestPoi(B.x, B.z);
  const at = atPlace(place);
  const positive = kind === 'gift' ? true : reactsPositively(w, B, A, kind === 'chat' ? 'chat' : kind);
  const planned = planLines(w, kind, A, B, positive, place, at);
  const id = w.nextEncounterId++;
  const enc: Encounter = {
    id, kind, a: A.id, b: B.id, phase: 'approach', lines: planned.lines, index: 0, nextAt: 0, endAt: Infinity,
    startedAt: w.simTime, positive, placeAt: at, topicLabel: planned.topicLabel, quote: planned.quote,
    ...(planned.thing ? { thing: planned.thing } : {}), ...(planned.item ? { item: planned.item } : {}), autonomous,
  };
  w.encounters.set(id, enc);
  const meet = meetingPoint(B, A, 1.2, `${A.id}|${B.id}|${id}`);
  const prio = autonomous ? 0.5 : 1;
  startAction(w, B, {
    type: 'converse', phase: 'perform', travelActivity: `waving at ${A.displayName}`, activity: dist(A, B) > 1.8 ? `waving at ${A.displayName}` : `chatting with ${A.displayName}`,
    spot: null, remaining: 1, effects: CHAT_EFFECTS, speed: 0, priority: prio, travelTimeout: 0, anchored: true, hold: true, encounterId: id, partnerId: A.id,
  });
  startAction(w, A, {
    type: 'converse', phase: 'travel', travelActivity: `walking to ${B.displayName}`, activity: `chatting with ${B.displayName}`,
    spot: meet, remaining: 1, effects: CHAT_EFFECTS, speed: WALK_SPEED * A.temperament.speed, priority: prio, travelTimeout: 14, anchored: true, hold: true, encounterId: id, partnerId: B.id,
  });
  return enc;
}

function speak(w: World, enc: Encounter, line: PlannedLine, A: Agent, B: Agent): void {
  const speaker = line.speaker === 'a' ? A : B;
  const listener = line.speaker === 'a' ? B : A;
  if (speaker.action) speaker.action.activity = line.speakerActivity ?? `chatting with ${listener.displayName}`;
  if (listener.action) listener.action.activity = line.listenerActivity ?? `chatting with ${speaker.displayName}`;
  speaker.activity = speaker.action?.activity ?? speaker.activity;
  listener.activity = listener.action?.activity ?? listener.activity;
  emit(w, line.kind, speaker, { target: listener, text: line.text, ...(line.payload ? { payload: line.payload } : {}) });
  void enc;
}

function finishEncounter(w: World, enc: Encounter, A: Agent, B: Agent): void {
  w.encounters.delete(enc.id);
  const r = (lo: number, hi: number) => w.rng.range(lo, hi, 'enc-delta', `${A.id}|${B.id}`);
  const delta = !enc.positive ? -r(1.5, 4)
    : enc.kind === 'gift' ? r(8, 12) : enc.kind === 'compliment' ? r(5, 9) : enc.kind === 'greet' ? r(3, 6) : r(2.5, 5.5);
  const { before, after } = adjustFriendship(w, A, B, delta);
  const a = A.displayName, b = B.displayName;
  const recent = w.simTime - (w.memoryAt.get(pairKey(A.id, B.id)) ?? -1e9) < 60;
  let memory: string | null = null;
  if (!enc.positive) memory = enc.kind === 'compliment' ? `${a} complimented ${b}'s ${enc.thing ?? 'style'} ${enc.placeAt} — ${b} rolled their eyes` : `${a} tried to chat with ${b} ${enc.placeAt} — ${b} was not in the mood`;
  else if (enc.kind === 'greet') memory = `${a} met ${b} ${enc.placeAt} — ${b} ${w.rng.pick(['said hi back', 'seemed delighted', 'smiled right away'], 'mem-tail', a)}`;
  else if (enc.kind === 'compliment') memory = `${a} complimented ${b}'s ${enc.thing ?? 'style'} ${enc.placeAt} — ${b} ${w.rng.pick(['blushed', 'beamed', 'grinned'], 'mem-tail', a)}`;
  else if (enc.kind === 'gift') memory = `${a} gave ${b} ${withArticle(enc.item ?? 'flowers')} ${enc.placeAt} — ${b} loved it`;
  else if (!recent) memory = `${a} and ${b} chatted about ${enc.topicLabel} ${enc.placeAt} — "${cleanText(enc.quote, 80)}"`;
  if (memory) addMemory(w, A, B, memory);
  feel(A, enc.positive ? 0.25 : -0.15);
  feel(B, enc.positive ? 0.2 : -0.1);
  for (const p of [A, B]) {
    if (p.action?.encounterId === enc.id) clearAction(w, p);
    const t = p.temperament;
    if (enc.positive) bump(p, { social: 5 });
    p.socialReadyAt = w.simTime + w.rng.range(22, 40, 'social-cd', p.id) * (t.shyness > 0.5 ? 1.6 : 1) * (p.needs.social < 30 ? 0.35 : 1);
  }
  if (enc.positive && before < 70 && after >= 70) {
    emit(w, 'social', A, { target: B, text: lines.milestone(w, A, placeVars(w, A, B, enc.placeAt)), payload: { action: 'befriend', sentiment: 'positive' } });
    addMemory(w, A, B, `${a} and ${b} became friends ${enc.placeAt} — a proper high five`);
    gesture(w, A, `celebrating with ${b}`, 3, { priority: 0.5 });
    gesture(w, B, `celebrating with ${a}`, 3, { priority: 0.5 });
  } else if (!enc.positive) {
    gesture(w, B, w.rng.chance(0.5, 'sulk', B.id) ? `sulking ${enc.placeAt}` : 'sulking', 3.5, { priority: 0 });
  }
  if (enc.autonomous && enc.positive) {
    const rel = getRel(w, A.id, B.id);
    requestExtraLine(w, 'conversation', B, A, enc.quote, rel?.memories ?? [], rel?.friendship, enc.placeAt);
  }
}

export function updateEncounters(w: World): void {
  for (const enc of [...w.encounters.values()]) {
    const A = w.agents.get(enc.a), B = w.agents.get(enc.b);
    if (!A || !B || A.action?.encounterId !== enc.id || B.action?.encounterId !== enc.id) { cancelEncounter(w, enc.id); continue; }
    if (enc.phase === 'approach') {
      if (A.action.phase === 'perform') {
        enc.phase = 'talk';
        enc.nextAt = w.simTime;
      } else {
        if (w.simTime - enc.startedAt > 16) cancelEncounter(w, enc.id);
        continue;
      }
    }
    if (enc.index < enc.lines.length) {
      if (w.simTime + 1e-9 >= enc.nextAt) {
        const line = enc.lines[enc.index++]!;
        speak(w, enc, line, A, B);
        enc.nextAt = w.simTime + 2.1 + Math.min(1.6, line.text.length * 0.02);
        if (enc.index >= enc.lines.length) enc.endAt = enc.nextAt - 0.3;
      }
    } else if (w.simTime >= enc.endAt) finishEncounter(w, enc, A, B);
  }
}

/** Cheap deterministic per-pair noise (no string hashing in the O(n²) loop). */
function pairNoise(w: World, a: Agent, b: Agent): number {
  return mix32(Math.imul(idHash(a), 31) ^ idHash(b) ^ Math.imul(w.tick + 1, 0x9e3779b1)) / 4294967296;
}
const HASHES = new Map<string, number>();
function idHash(a: Agent): number {
  let h = HASHES.get(a.id);
  if (h === undefined) { h = hashString(a.id); if (HASHES.size > 5000) HASHES.clear(); HASHES.set(a.id, h); }
  return h;
}

/** Town-wide social director: at most one new autonomous exchange every ~6–12 s. */
export function directSocial(w: World): void {
  if (w.simTime < w.nextSocialAt) return;
  const list = [...w.agents.values()].filter(a => socialAvailable(w, a) && !isSleeping(a));
  let best: { a: Agent; b: Agent; score: number } | null = null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const d = dist(a, b);
      if (d > 7 || (a.group && a.group === b.group)) continue;
      if (seated(a) && seated(b) && d > 2.6) continue;
      const f = friendshipOf(w, a.id, b.id);
      const seeking = a.action?.seekingId === b.id || b.action?.seekingId === a.id;
      let s = (urgency(a.needs.social) * a.temperament.sociability + urgency(b.needs.social) * b.temperament.sociability) * 0.5
        + ((f ?? 45) - 45) / 100 * 0.4 + (seeking ? 0.6 : 0) + (f === undefined ? 0.1 : 0) - d * 0.04
        + pairNoise(w, a, b) * 0.15;
      if (a.temperament.shyness > 0.5 && b.temperament.shyness > 0.5 && !seeking) s *= 0.5;
      if (!best || s > best.score) best = { a, b, score: s };
    }
  }
  if (!best || best.score < 0.25) { w.nextSocialAt = w.simTime + 1.5; return; }
  let { a: A, b: B } = best;
  // Initiator: not seated, more sociable / the one seeking.
  const aScore = A.temperament.sociability - A.temperament.shyness + (A.action?.seekingId === B.id ? 1 : 0) - (seated(A) ? 2 : 0);
  const bScore = B.temperament.sociability - B.temperament.shyness + (B.action?.seekingId === A.id ? 1 : 0) - (seated(B) ? 2 : 0);
  if (bScore > aScore) [A, B] = [B, A];
  const f = friendshipOf(w, A.id, B.id);
  let kind: EncounterKind = 'chat';
  if (f === undefined) kind = 'greet';
  else if (f >= 60 && w.rng.chance(0.06 * A.temperament.kindness + 0.03 * A.temperament.romance, 'kind-gift', A.id)) kind = 'gift';
  else if (w.rng.chance(0.08 + 0.08 * A.temperament.romance, 'kind-compliment', A.id)) kind = 'compliment';
  startEncounter(w, A, B, kind, true);
  w.nextSocialAt = w.simTime + w.rng.range(6, 12, 'social-gap', A.id);
}

// ---------------------------------------------------------------------------
// Newcomers
// ---------------------------------------------------------------------------
export function startWelcomeWalk(w: World, a: Agent): void {
  const spot = spotAround(w, { x: 0, z: -4.9 }, 0, 1.8, a, 'welcome');
  goThen(w, a, spot, 'walking to Town Plaza', 'waving hello', 3.5, { priority: 1, onArrive: newcomerHello });
}

function newcomerHello(w: World, a: Agent): void {
  let local: Agent | null = null;
  let bd = 14;
  for (const o of w.agents.values()) {
    if (o === a || o.visitor || o.leaving || isSleeping(o) || (o.action && o.action.priority >= 2)) continue;
    const d = dist(a, o);
    if (d < bd) { bd = d; local = o; }
  }
  w.facts.newcomer = { name: a.displayName, at: w.simTime };
  if (!local || w.simTime - w.facts.lastWelcomeAt < 4) return;
  w.facts.lastWelcomeAt = w.simTime;
  const L = local;
  const at = atPlace(nearestPoi(a.x, a.z));
  if (a.action) a.action.activity = `waving at ${L.displayName}`;
  a.activity = `waving at ${L.displayName}`;
  const rejoin = !!getRel(w, a.id, L.id);
  emit(w, 'wave', a, { target: L, text: lines.newcomerHello(w, a, rejoin, placeVars(w, a, L, at)), payload: { reaction: 'hello', sentiment: 'positive' } });
  schedule(w, 1.4, w2 => {
    const A = w2.agents.get(a.id), B = w2.agents.get(L.id);
    if (!A || !B || isSleeping(B) || B.leaving) return;
    const positive = reactsPositively(w2, B, A, 'greet');
    if (!(B.action && B.action.priority >= 2)) gesture(w2, B, `greeting ${A.displayName}`, 3, { priority: 1 });
    emit(w2, 'social', B, { target: A, text: positive ? lines.welcome(w2, B, placeVars(w2, B, A, at)) : lines.snub(w2, B, placeVars(w2, B, A, at)), payload: { action: 'greet', sentiment: positive ? 'positive' : 'negative' } });
    adjustFriendship(w2, B, A, positive ? w2.rng.range(4, 8, 'welcome', A.id) : -2);
    addMemory(w2, B, A, `${B.displayName} welcomed ${A.displayName} to town ${at} — ${positive ? `${A.displayName} waved hello` : `${B.displayName} grumbled a little`}`);
    bump(A, { social: 6, fun: 3 });
    bump(B, { social: 4 });
  });
}
