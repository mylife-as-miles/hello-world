/**
 * Social life: autonomous encounters (approach → 2–4 spoken lines → friendship
 * + memory), a town-wide social director that rate-limits chatter to one new
 * exchange every ~6–12 s, friendship milestones, and newcomer welcomes.
 */
import type { PoiDef } from '../world/layout';
import { hashString } from '../avatars/catalog';
import { mix32 } from './rng';
import { hasConflict } from './personality';
import { cancelEncounter, clearAction, gesture, goThen, interrupt, startAction } from './actions';
import { complimentThing, fallbackTopic, GIFT_ITEMS, lines, memoryLine, pickTopic, placeVars, requestExtraLine, withArticle } from './dialogue';
import { meetingPoint, WALK_SPEED } from './movement';
import { bump, feel, isSleeping, urgency } from './needs';
import { atPlace, homeFor, nearestPoi, spotAround } from './places';
import { bedBound, nightSleeper } from './night';
import { worldClock } from '../world/time';
import { addMemory, adjustFriendship, friendshipOf, getRel, pairKey, reactsPositively } from './relationships';
import { cleanText, dist, emit, schedule, type Agent, type Encounter, type EncounterKind, type PlannedLine, type World } from './state';

const CHAT_EFFECTS = { energy: 0, social: 1.2, fun: 0.12 };
/** A snub doesn't fill anyone's social bar. */
const COLD_EFFECTS = { energy: 0, social: 0.1, fun: -0.1 };

export function socialAvailable(w: World, a: Agent): boolean {
  if (a.leaving || w.simTime < a.socialReadyAt || a.needs.energy < 15) return false;
  const act = a.action;
  if (act && (act.type === 'sleep' || act.type === 'converse' || act.priority > 0)) return false;
  // Residents on their way to bed don't get pulled into new chats.
  return !bedBound(w, a, worldClock(w.simTime).hours);
}

function seated(a: Agent): boolean { return !!a.action?.seatKey && a.action.phase === 'perform'; }

function planLines(w: World, kind: EncounterKind, A: Agent, B: Agent, positive: boolean, place: PoiDef, at: string)
  : { lines: PlannedLine[]; topicLabel: string; quote: string; thing?: string; item?: string; topicCheck?: (w: World) => boolean } {
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
      out.push({ speaker: 'a', kind: 'chat', text: topic.line, payload: { sentiment: 'positive' }, topic: 'line' });
      return { lines: out, topicLabel: 'meeting', quote: out[1]!.text, ...(topic.check ? { topicCheck: topic.check } : {}) };
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
  if (kind === 'bicker') {
    const topic = w.rng.pick(['the noise', 'the best bench', 'the last cinnamon bun', 'the arcade high score', 'the music', 'whose turn it was', 'personal space'] as const, 'bicker-topic', A.id);
    out.push({ speaker: 'a', kind: 'social', text: lines.bicker(w, A, varsA), payload: { action: 'greet', sentiment: 'negative', reaction: 'bicker' }, speakerActivity: `sulking at ${B.displayName}` });
    out.push({ speaker: 'b', kind: 'social', text: lines.retort(w, B, varsB), payload: { action: 'greet', sentiment: 'negative', reaction: 'retort' }, speakerActivity: `sulking at ${A.displayName}` });
    if (w.rng.chance(0.5, 'bicker-last', A.id)) out.push({ speaker: 'a', kind: 'social', text: lines.lastWord(w, A, varsA), payload: { action: 'greet', sentiment: 'negative', reaction: 'retort' }, speakerActivity: 'sulking' });
    return { lines: out, topicLabel: topic, quote: out[0]!.text };
  }
  if (kind === 'makeup') {
    const pk = pairKey(A.id, B.id);
    out.push({ speaker: 'a', kind: 'social', text: lines.apology(w, A, varsA, pk), payload: { action: 'compliment', sentiment: 'positive', reaction: 'apology' }, speakerActivity: `chatting with ${B.displayName}` });
    out.push(positive
      ? { speaker: 'b', kind: 'chat', text: lines.apologyReply(w, B, true, varsB, pk), payload: { sentiment: 'positive', reaction: 'make-up' }, speakerActivity: `laughing with ${A.displayName}`, listenerActivity: `laughing with ${B.displayName}` }
      : { speaker: 'b', kind: 'social', text: lines.apologyReply(w, B, false, varsB, pk), payload: { action: 'greet', sentiment: 'negative', reaction: 'make-up' } });
    return { lines: out, topicLabel: 'making up', quote: out[1]!.text };
  }
  if (kind === 'befriend') {
    out.push({ speaker: 'a', kind: 'social', text: lines.befriendAsk(w, A, varsA), payload: { action: 'befriend', sentiment: 'positive' }, speakerActivity: `befriending ${B.displayName}` });
    out.push({ speaker: 'b', kind: 'social', text: lines.befriendReply(w, B, positive, varsB), payload: { action: 'befriend', sentiment }, ...(positive ? { speakerActivity: `celebrating with ${A.displayName}`, listenerActivity: `celebrating with ${B.displayName}` } : {}) });
    return { lines: out, topicLabel: 'friendship', quote: out[1]!.text };
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
  if (extra >= 1) out.push({ speaker: 'a', kind: 'chat', text: topic.line, payload: { sentiment: 'positive' }, topic: 'line', ...(topic.joke ? { listenerActivity: `laughing with ${A.displayName}` } : {}) });
  if (extra >= 2) out.push({ speaker: 'b', kind: 'chat', text: topic.reply, payload: { sentiment: 'positive' }, topic: 'reply' });
  return { lines: out, topicLabel: extra >= 1 || !topic.check ? topic.label : 'the day', quote: extra >= 1 ? topic.line : out[1]!.text, ...(extra >= 1 && topic.check ? { topicCheck: topic.check } : {}) };
}

/** Start a face-to-face exchange: A walks to ~1.2 m from B, then they talk. */
export function startEncounter(w: World, A: Agent, B: Agent, kind: EncounterKind, autonomous: boolean): Encounter | null {
  if (A === B || A.leaving || B.leaving) return null;
  interrupt(w, A);
  interrupt(w, B);
  const place = nearestPoi(B.x, B.z);
  const at = atPlace(place);
  const positive = kind === 'gift' ? true : kind === 'bicker' ? false
    : kind === 'makeup' ? reactsPositively(w, B, A, 'compliment') || w.rng.chance(0.55, 'makeup-accept', B.id)
      : reactsPositively(w, B, A, kind === 'chat' ? 'chat' : kind);
  if (kind === 'gift') { w.giftAt.set(pairKey(A.id, B.id), w.simTime); w.facts.lastGiftAt = w.simTime; }
  const planned = planLines(w, kind, A, B, positive, place, at);
  const id = w.nextEncounterId++;
  const enc: Encounter = {
    id, kind, a: A.id, b: B.id, phase: 'approach', lines: planned.lines, index: 0, nextAt: 0, endAt: Infinity,
    startedAt: w.simTime, positive, placeAt: at, topicLabel: planned.topicLabel, quote: planned.quote,
    ...(planned.thing ? { thing: planned.thing } : {}), ...(planned.item ? { item: planned.item } : {}), autonomous,
    ...(planned.topicCheck ? { topicCheck: planned.topicCheck } : {}),
  };
  w.encounters.set(id, enc);
  const meet = meetingPoint(B, A, 1.2, `${A.id}|${B.id}|${id}`);
  const prio = autonomous ? 0.5 : 1;
  startAction(w, B, {
    type: 'converse', phase: 'perform', travelActivity: `waving at ${A.displayName}`, activity: dist(A, B) > 1.8 ? `waving at ${A.displayName}` : `chatting with ${A.displayName}`,
    spot: null, remaining: 1, effects: positive ? CHAT_EFFECTS : COLD_EFFECTS, speed: 0, priority: prio, travelTimeout: 0, anchored: true, hold: true, encounterId: id, partnerId: A.id,
  });
  startAction(w, A, {
    type: 'converse', phase: 'travel', travelActivity: `walking to ${B.displayName}`, activity: `chatting with ${B.displayName}`,
    spot: meet, remaining: 1, effects: positive ? CHAT_EFFECTS : COLD_EFFECTS, speed: WALK_SPEED * A.temperament.speed, priority: prio, travelTimeout: kind === 'makeup' ? 30 : 14, anchored: true, hold: true, encounterId: id, partnerId: B.id,
  });
  return enc;
}

/** A planned topic that is no longer true (the dancer stopped, the newcomer left) is swapped for an always-true one. */
function reground(w: World, enc: Encounter, line: PlannedLine, A: Agent, B: Agent): void {
  if (line.topic !== 'line' || !enc.topicCheck || enc.topicCheck(w)) return;
  const old = line.text;
  const alt = fallbackTopic(w, A, placeVars(w, A, B, enc.placeAt));
  line.text = alt.line;
  line.listenerActivity = undefined;
  for (const l of enc.lines) if (l.topic === 'reply') l.text = alt.reply;
  if (enc.quote === old) enc.quote = alt.line;
  if (enc.kind !== 'greet') enc.topicLabel = alt.label;
  delete enc.topicCheck;
}

function speak(w: World, enc: Encounter, line: PlannedLine, A: Agent, B: Agent): void {
  reground(w, enc, line, A, B);
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
  const delta = enc.kind === 'bicker' ? -r(3, 6) : !enc.positive ? -r(1.5, 4)
    : enc.kind === 'gift' ? r(7, 11) : enc.kind === 'makeup' ? r(4, 8) : enc.kind === 'befriend' ? r(4, 7) : enc.kind === 'compliment' ? r(4, 7) : enc.kind === 'greet' ? r(2.5, 5) : r(1.5, 3.5);
  const { before, after } = adjustFriendship(w, A, B, delta);
  const a = A.displayName, b = B.displayName;
  const recent = w.simTime - (w.memoryAt.get(pairKey(A.id, B.id)) ?? -1e9) < 60;
  let memory: string | null = null;
  const mv = { a, b, at: enc.placeAt, thing: enc.thing ?? 'style', item: withArticle(enc.item ?? 'flowers'), topic: enc.topicLabel };
  if (!enc.positive) memory = enc.kind === 'compliment' ? memoryLine(w, 'compliment', false, mv) : enc.kind === 'greet' ? memoryLine(w, 'met', false, mv) : memoryLine(w, 'rebuff', false, mv);
  else if (enc.kind === 'greet') memory = memoryLine(w, 'met', true, mv);
  else if (enc.kind === 'compliment') memory = memoryLine(w, 'compliment', true, mv);
  else if (enc.kind === 'gift') memory = memoryLine(w, 'gift', true, mv);
  else if (enc.kind === 'befriend') { memory = memoryLine(w, 'friends', true, mv); w.bestFriends.add(pairKey(A.id, B.id)); }
  else if (!recent) memory = memoryLine(w, 'chat', true, mv, cleanText(enc.quote, 80));
  if (!enc.positive && enc.kind === 'befriend') memory = memoryLine(w, 'declined', false, mv);
  if (enc.kind === 'bicker') memory = memoryLine(w, 'bicker', false, mv);
  if (enc.kind === 'makeup') memory = memoryLine(w, 'makeup', enc.positive, mv);
  if (memory) addMemory(w, A, B, memory);
  const key = pairKey(A.id, B.id);
  if (enc.kind === 'bicker') { w.feuds.set(key, { at: w.simTime, a: A.id, b: B.id, attempts: 0 }); w.clashAt.set(key, w.simTime); }
  else if (enc.kind === 'makeup' && !enc.positive) { const f = w.feuds.get(key); w.feuds.set(key, { at: w.simTime, a: A.id, b: B.id, attempts: (f?.attempts ?? 0) + 1 }); }
  feel(A, enc.positive ? 0.25 : -0.15);
  feel(B, enc.positive ? 0.2 : -0.1);
  for (const p of [A, B]) {
    if (p.action?.encounterId === enc.id) clearAction(w, p);
    const t = p.temperament;
    if (enc.positive) bump(p, { social: 3 });
    p.socialReadyAt = w.simTime + w.rng.range(22, 40, 'social-cd', p.id) * (t.shyness > 0.5 ? 1.6 : 1) * (p.needs.social < 30 ? 0.35 : 1);
  }
  if (enc.positive && enc.kind === 'befriend') {
    gesture(w, A, `celebrating with ${b}`, 3, { priority: 0.5 });
    gesture(w, B, `celebrating with ${a}`, 3, { priority: 0.5 });
  } else if (enc.positive && before < 70 && after >= 70 && !w.bestFriends.has(pairKey(A.id, B.id))) {
    w.bestFriends.add(pairKey(A.id, B.id));
    emit(w, 'social', A, { target: B, text: lines.milestone(w, A, placeVars(w, A, B, enc.placeAt)), payload: { action: 'befriend', sentiment: 'positive' } });
    addMemory(w, A, B, memoryLine(w, 'friends', true, { a, b, at: enc.placeAt }));
    gesture(w, A, `celebrating with ${b}`, 3, { priority: 0.5 });
    gesture(w, B, `celebrating with ${a}`, 3, { priority: 0.5 });
  } else if (enc.kind === 'bicker') {
    gesture(w, A, `sulking ${enc.placeAt}`, 6, { priority: 0 });
    gesture(w, B, 'sulking', 6, { priority: 0 });
  } else if (enc.kind === 'makeup' && enc.positive) {
    gesture(w, A, `laughing with ${b}`, 3, { priority: 0.5 });
    gesture(w, B, `laughing with ${a}`, 3, { priority: 0.5 });
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
        if (w.simTime - enc.startedAt > (enc.kind === 'makeup' ? 32 : 16)) cancelEncounter(w, enc.id);
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
  if (makeUps(w) || friction(w)) { w.nextSocialAt = w.simTime + w.rng.range(6, 12, 'social-gap', 'drama'); return; }
  const list = [...w.agents.values()].filter(a => socialAvailable(w, a) && !isSleeping(a));
  // First meetings taper once most pairs in town have met.
  let pairsMet = 0;
  for (const r of w.relationships.values()) if (w.agents.has(r.residentA) && w.agents.has(r.residentB)) pairsMet++;
  const n = w.agents.size;
  const metShare = n > 1 ? pairsMet / ((n * (n - 1)) / 2) : 1;
  const novelty = metShare < 0.3 ? 0.08 : metShare < 0.5 ? -0.05 : -0.18;
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
        + ((f ?? 45) - 45) / 100 * 0.7 + (seeking ? 0.6 : 0) + (f === undefined ? novelty : 0) - d * 0.04
        + pairNoise(w, a, b) * 0.15;
      if (a.temperament.shyness > 0.5 && b.temperament.shyness > 0.5 && !seeking) s *= 0.5;
      // Shy and grumpy residents are rarely drawn into chats by acquaintances (they have to seek company).
      if (!seeking && (f ?? 45) < 55 && (a.temperament.shyness > 0.5 || b.temperament.shyness > 0.5 || a.temperament.grumpiness > 0.5 || b.temperament.grumpiness > 0.5)) s *= 0.6;
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
  else {
    // As friendship grows, exchanges shift toward compliments, inside jokes, gifts and best-friend moments.
    const key = pairKey(A.id, B.id);
    const giftOk = w.simTime - w.facts.lastGiftAt > 45 && w.simTime - (w.giftAt.get(key) ?? -1e9) > 300;
    const t = A.temperament;
    const r = w.rng.float('kind', A.id);
    const pBefriend = f >= 70 && !w.bestFriends.has(key) ? 0.35 : 0;
    const pGift = giftOk ? (f >= 70 ? 0.22 : f >= 55 ? 0.13 : 0.03) * Math.min(1.6, 0.5 * t.kindness + 0.4 * t.romance) : 0;
    const pCompliment = (f >= 70 ? 0.3 : f >= 55 ? 0.27 : 0.16) + 0.04 * t.romance;
    if (r < pBefriend) kind = 'befriend';
    else if (r < pBefriend + pGift) kind = 'gift';
    else if (r < pBefriend + pGift + pCompliment) kind = 'compliment';
  }
  startEncounter(w, A, B, kind, true);
  w.nextSocialAt = w.simTime + w.rng.range(6, 12, 'social-gap', A.id);
}

/** Feuds cool off, then the warmer resident walks over to apologise (arcs: clash → make-up). */
function makeUps(w: World): boolean {
  for (const [key, f] of [...w.feuds]) {
    // First apology after ~75 s; after a refusal wait ≥ 3 game hours.
    if (w.simTime - f.at < (f.attempts > 0 ? 180 : 75)) continue;
    const A = w.agents.get(f.a), B = w.agents.get(f.b);
    if (!A || !B || f.attempts >= 2) { w.feuds.delete(key); continue; }
    if (!socialAvailable(w, A) || !socialAvailable(w, B) || isSleeping(A) || isSleeping(B) || dist(A, B) > 30) continue;
    const [sorry, other] = A.temperament.warmth + A.temperament.kindness * 0.2 >= B.temperament.warmth + B.temperament.kindness * 0.2 ? [A, B] : [B, A];
    w.feuds.delete(key);
    return !!startEncounter(w, sorry, other, 'makeup', true);
  }
  return false;
}

/** Incompatible personalities occasionally clash — at most about once per 2 game hours town-wide. */
function friction(w: World): boolean {
  if (w.simTime < w.nextFrictionAt) return false;
  let best: { a: Agent; b: Agent; s: number } | null = null;
  const list = [...w.agents.values()].filter(a => !a.visitor && socialAvailable(w, a) && !isSleeping(a));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!, b = list[j]!;
    const pk = pairKey(a.id, b.id);
    if (dist(a, b) > 9 || !hasConflict(a.personality, b.personality) || w.feuds.has(pk) || w.simTime - (w.clashAt.get(pk) ?? -1e9) < 360) continue;
    const f = friendshipOf(w, a.id, b.id) ?? 45;
    if (f < 15 || f > 75) continue; // never pile on enemies, never break up close friends
    const s = a.temperament.grumpiness + b.temperament.grumpiness + (1 - (a.mood + b.mood) / 2) * 0.5 + pairNoise(w, a, b) * 0.3 - (w.clashAt.has(pk) ? 0.6 : 0);
    if (!best || s > best.s) best = { a, b, s };
  }
  if (!best) { w.nextFrictionAt = w.simTime + 10; return false; }
  // The grumpier / lower-mood one starts it.
  const [A, B] = best.a.temperament.grumpiness - best.a.mood >= best.b.temperament.grumpiness - best.b.mood ? [best.a, best.b] : [best.b, best.a];
  w.nextFrictionAt = w.simTime + w.rng.range(110, 150, 'friction-gap', A.id);
  return !!startEncounter(w, A, B, 'bicker', true);
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
  // Late at night the plaza may be empty: the nearest neighbour who is up (within ~50 m) walks over instead.
  let far: Agent | null = null;
  let fd = 50;
  const h = worldClock(w.simTime).hours;
  for (const o of w.agents.values()) {
    if (o === a || o.visitor || o.leaving || isSleeping(o) || nightSleeper(o) || (o.action && o.action.priority >= 2)) continue;
    const d = dist(a, o);
    if (d < bd) { bd = d; local = o; }
    if (d < fd && !bedBound(w, o, h) && o.action?.type !== 'converse') { fd = d; far = o; }
  }
  w.facts.newcomer = { name: a.displayName, at: w.simTime, id: a.id };
  if ((!local && !far) || w.simTime - w.facts.lastWelcomeAt < 4) return;
  w.facts.lastWelcomeAt = w.simTime;
  const L = (local ?? far)!;
  const at = atPlace(nearestPoi(a.x, a.z));
  if (a.action) a.action.activity = `waving at ${L.displayName}`;
  a.activity = `waving at ${L.displayName}`;
  const rejoin = !!getRel(w, a.id, L.id);
  emit(w, 'wave', a, { target: L, text: lines.newcomerHello(w, a, rejoin, placeVars(w, a, L, at)), payload: { reaction: 'hello', sentiment: 'positive' } });
  if (!local) {
    // The newcomer keeps waving while the neighbour comes over, then they meet face to face.
    const d = dist(a, L);
    gesture(w, a, `waving at ${L.displayName}`, Math.min(30, d / (WALK_SPEED * L.temperament.speed) + 5), { priority: 1 });
    goThen(w, L, meetingPoint(a, L, 1.3, `${L.id}|welcome`), `walking to ${a.displayName}`, `greeting ${a.displayName}`, 3, {
      priority: 1, onArrive: w2 => welcomeReply(w2, a.id, L.id, at),
    });
    return;
  }
  schedule(w, 1.4, w2 => welcomeReply(w2, a.id, L.id, at));
}

function welcomeReply(w2: World, newcomerId: string, localId: string, at: string): void {
  {
    const A = w2.agents.get(newcomerId), B = w2.agents.get(localId);
    if (!A || !B || isSleeping(B) || B.leaving) return;
    const positive = reactsPositively(w2, B, A, 'greet');
    if (!(B.action && B.action.priority >= 2)) gesture(w2, B, `greeting ${A.displayName}`, 3, { priority: 1 });
    emit(w2, 'social', B, { target: A, text: positive ? lines.welcome(w2, B, placeVars(w2, B, A, at)) : lines.snub(w2, B, placeVars(w2, B, A, at)), payload: { action: 'greet', sentiment: positive ? 'positive' : 'negative' } });
    adjustFriendship(w2, B, A, positive ? w2.rng.range(4, 8, 'welcome', A.id) : -2);
    addMemory(w2, B, A, memoryLine(w2, 'welcome', positive, { a: B.displayName, b: A.displayName, at }));
    bump(A, { social: 6, fun: 3 });
    bump(B, { social: 4 });
  }
}
