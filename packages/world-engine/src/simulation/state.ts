/**
 * Internal (non-contract) simulation state + tiny shared helpers.
 * Only `exportState()` (index.ts) turns this into contract objects.
 */
import type { AvatarAppearance, Relationship, Weather, WorldEvent, WorldEventKind, WorldEventPayload } from '@hello-world/contracts';
import type { Vec2 } from '../world/layout';
import { worldClock } from '../world/time';
import { sanitizeText } from '../runtime/validate';
import type { Rng } from './rng';
import type { Temperament } from './personality';
import type { DialogueProvider } from './dialogue';

export interface Needs { energy: number; social: number; fun: number }
export const NEED_KEYS = ['energy', 'social', 'fun'] as const;
export const NO_EFFECT: Readonly<Needs> = Object.freeze({ energy: 0, social: 0, fun: 0 });

export type ActionType =
  | 'wander' | 'sit' | 'rest' | 'sleep' | 'drink' | 'eat' | 'dance' | 'play' | 'read' | 'admire' | 'watch'
  | 'socialize' | 'gesture' | 'goto' | 'converse' | 'leave';

/** Priorities: 0 autonomous, 0.5 autonomous conversation, 1 directed (weather/destination/welcome), 2 viewer event, 3 leaving. */
export interface Action {
  type: ActionType;
  phase: 'travel' | 'perform';
  travelActivity: string;
  activity: string;
  poiId?: string;
  seatKey?: string;
  spot: Vec2 | null;
  /** Seconds left in the perform phase. */
  remaining: number;
  /** Needs change per second while performing. */
  effects: Needs;
  speed: number;
  priority: number;
  /** Give up travelling after this many seconds. */
  travelTimeout: number;
  /** Excluded from separation (seated, sleeping, mid-conversation). */
  anchored: boolean;
  /** Perform until released by its owner (encounters). */
  hold?: boolean;
  partnerId?: string;
  encounterId?: number;
  /** Agent this resident is walking over to socialise with. */
  seekingId?: string;
  hop?: { center: Vec2; radius: number; next: number; poiId: string };
  onArrive?: (w: World, a: Agent) => void;
  onDone?: (w: World, a: Agent) => void;
}

export interface Agent {
  id: string;
  displayName: string;
  appearance: AvatarAppearance;
  personality: string[];
  temperament: Temperament;
  needs: Needs;
  x: number;
  z: number;
  /** Zone carried over from a restored snapshot until the first move. */
  zone: string;
  activity: string;
  joinedAt: number;
  lastActiveAt: number;
  homeId: string;
  seed: boolean;
  visitor: boolean;
  /** Raid group key for visitors. */
  group?: string;
  visitorIndex?: number;
  leaveAt: number;
  leaving: boolean;
  needsWelcome: boolean;
  action: Action | null;
  path: Vec2[];
  /** -1..1 derived from needs + recent sentiment (internal). */
  mood: number;
  /** Recent interaction sentiment, decays to 0. */
  sentiment: number;
  lastPoiId?: string;
  lastType?: ActionType;
  /** Sim time when autonomous socialising is allowed again. */
  socialReadyAt: number;
  /** Sim time of this resident's last reply to viewer chat. */
  lastReplyAt: number;
  /** Sim time a low-need state (lonely / tired / bored) was last shown. */
  moodShownAt: number;
}

export type EncounterKind = 'greet' | 'chat' | 'compliment' | 'gift';

export interface PlannedLine {
  speaker: 'a' | 'b';
  kind: WorldEventKind;
  text: string;
  payload?: WorldEventPayload;
  speakerActivity?: string;
  listenerActivity?: string;
}

export interface Encounter {
  id: number;
  kind: EncounterKind;
  a: string;
  b: string;
  phase: 'approach' | 'talk';
  lines: PlannedLine[];
  index: number;
  nextAt: number;
  endAt: number;
  startedAt: number;
  positive: boolean;
  placeAt: string;
  topicLabel: string;
  quote: string;
  thing?: string;
  item?: string;
  autonomous: boolean;
}

export interface ScheduledTask { at: number; seq: number; run: (w: World) => void }

export interface ReadyLine { speakerId: string; listenerId?: string; text: string; requestedAt: number }

export interface WorldFacts {
  raidAt: number;
  raidChannel: string;
  confettiAt: number;
  newcomer: { name: string; at: number } | null;
  lastGrumbleAt: number;
  lastAmbientAt: number;
  lastChatReplyAt: number;
  lastWelcomeAt: number;
  /** Crowd info of the latest raid (shared by its celebrate + arrival events). */
  raidCrowd?: { visitors: number; amount: number; channel: string };
}

export interface World {
  worldId: string;
  maxResidents: number;
  simTime: number;
  weather: Weather;
  /** Wall clock (Unix ms) of the current call — timestamps only. */
  now: number;
  agents: Map<string, Agent>;
  relationships: Map<string, Relationship>;
  /** pairKey → sim time of the last memory written (throttles chatty memories). */
  memoryAt: Map<string, number>;
  /** seatKey → agent id. */
  seats: Map<string, string>;
  encounters: Map<number, Encounter>;
  scheduled: ScheduledTask[];
  out: WorldEvent[];
  rng: Rng;
  tick: number;
  idTick: number;
  eventSerial: number;
  idPrefix: string;
  epoch: string;
  nextEncounterId: number;
  scheduleSeq: number;
  nextSocialAt: number;
  recentLines: string[];
  facts: WorldFacts;
  llm: { provider: DialogueProvider | null; inFlight: number; ready: ReadyLine[]; nextAt: number };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
export const round = (v: number, digits: number) => { const f = 10 ** digits; return Math.round(v * f) / f || 0; };

export function tickFor(simTime: number): number { return Math.round(simTime * 20); }

export function nextEventId(w: World): string {
  if (w.idTick !== w.tick) { w.idTick = w.tick; w.eventSerial = 0; }
  return `${w.idPrefix}${w.tick}:${w.eventSerial++}:${w.epoch}`;
}

/** Strip markup/control chars, collapse whitespace, clamp length (keeps restore byte-identical). */
export function cleanText(text: string, max = 140): string {
  return sanitizeText(text, max);
}

export interface EmitOptions { target?: Agent | null; text?: string; payload?: WorldEventPayload }

/** Record a simulation-sourced contract event (returned to the runtime → history). */
export function emit(w: World, kind: WorldEventKind, actor: Agent, opts: EmitOptions = {}): WorldEvent {
  const text = opts.text ? cleanText(opts.text) : '';
  const event: WorldEvent = {
    id: nextEventId(w),
    kind,
    source: 'simulation',
    actorId: actor.id,
    actorDisplayName: actor.displayName,
    ...(opts.target && opts.target.id !== actor.id ? { targetId: opts.target.id } : {}),
    timestamp: Math.max(0, Math.floor(w.now)),
    ...(text ? { text } : kind === 'chat' ? { text: '...' } : {}),
    ...(opts.payload && Object.keys(opts.payload).length ? { payload: opts.payload } : {}),
  };
  w.out.push(event);
  return event;
}

export function schedule(w: World, delay: number, run: (w: World) => void): void {
  w.scheduled.push({ at: w.simTime + Math.max(0, delay), seq: w.scheduleSeq++, run });
}

export function runScheduled(w: World): void {
  if (!w.scheduled.length) return;
  const t = w.simTime + 1e-9;
  const due = w.scheduled.filter(s => s.at <= t);
  if (!due.length) return;
  w.scheduled = w.scheduled.filter(s => s.at > t);
  due.sort((a, b) => a.at - b.at || a.seq - b.seq);
  for (const task of due) task.run(w);
}

/** "Day 2 09:14" for memories. */
export function memoryStamp(simTime: number): string {
  return worldClock(simTime).label.replace(' · ', ' ');
}
