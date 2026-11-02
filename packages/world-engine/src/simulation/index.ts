/**
 * HELLO WORLD life simulation — deterministic, Node-safe (no three/react/DOM).
 *
 * Residents have personalities, needs (energy/social/fun), moods, goals,
 * relationships and memories; they pick activities with utility AI, walk the
 * nav graph, sit on reserved seats, nap at home at night, chat in rate-limited
 * conversations and react to every contract event. Everything visible goes out
 * through contract fields + `source: 'simulation'` WorldEvents.
 *
 * Determinism: no Math.random/Date.now in decisions — all randomness hashes
 * (worldId, tick, counter, purpose, id). `now` is only used for timestamps.
 */
import type { Relationship, WorldSnapshot } from '@hello-world/contracts';
import { normalizeAppearance } from '../avatars/catalog';
import { hashString } from '../avatars/catalog';
import { findSeatNear } from '../world/layout';
import { worldClock } from '../world/time';
import { startAction } from './actions';
import { ambientCompany, decide, updateAgent } from './behavior';
import { createAgent, handleEvent } from './events';
import { decayNeeds, updateMood } from './needs';
import { pushOut, zoneAt, POI_BY_ID } from './places';
import { MAX_MEMORIES, MAX_RELATIONSHIPS, pairKey } from './relationships';
import { createRng } from './rng';
import { seedWorld } from './seed';
import { directSocial, updateEncounters } from './social';
import { round, runScheduled, tickFor, emit, type Agent, type World } from './state';
import { separate } from './movement';
import type { CreateSimulation, Simulation, SimulationExport } from './types';
import type { DialogueProvider } from './dialogue';

export type { DialogueContext, DialogueProvider, HttpDialogueOptions } from './dialogue';
export { createHttpDialogueProvider, registerDialogueProvider, sanitizeDialogue } from './dialogue';

const MAX_SUBSTEP = 0.5;
const worlds = new WeakMap<Simulation, World>();

function createWorld(opts: Parameters<CreateSimulation>[0]): World {
  const wid = opts.worldId.replace(/[^\w:.@-]/g, '-').slice(0, 40) || 'world';
  return {
    worldId: opts.worldId,
    maxResidents: Math.max(1, Math.min(50, opts.maxResidents)),
    simTime: 0,
    weather: 'sunny',
    now: opts.now,
    agents: new Map(),
    relationships: new Map(),
    memoryAt: new Map(),
    bestFriends: new Set(),
    giftAt: new Map(),
    seats: new Map(),
    encounters: new Map(),
    scheduled: [],
    out: [],
    rng: createRng(opts.worldId),
    tick: 0,
    idTick: -1,
    eventSerial: 0,
    idPrefix: `sim:${wid}:`,
    epoch: (hashString(`epoch:${opts.now}`) % 46656).toString(36),
    nextEncounterId: 1,
    scheduleSeq: 0,
    nextSocialAt: 3,
    lineUsedAt: new Map(),
    facts: { raidAt: -1e9, raidChannel: '', confettiAt: -1e9, newcomer: null, lastGrumbleAt: -1e9, lastAmbientAt: -1e9, lastChatReplyAt: -1e9, lastWelcomeAt: -1e9, lastGiftAt: -1e9 },
    llm: { provider: null, inFlight: 0, ready: [], nextAt: 0 },
  };
}

function restore(w: World, snap: WorldSnapshot): void {
  w.simTime = Math.max(0, Number.isFinite(snap.simulationTime) ? snap.simulationTime : 0);
  w.weather = snap.weather;
  w.tick = tickFor(w.simTime);
  w.rng.setTick(w.tick);
  for (const r of snap.residents) {
    if (w.agents.size >= w.maxResidents || w.agents.has(r.id)) continue;
    const a = createAgent(w, {
      id: r.id, name: r.displayName, x: r.location.x, z: r.location.z, appearance: normalizeAppearance(r.appearance),
      personality: [...r.personality], joinedAt: r.joinedAt, lastActiveAt: r.lastActiveAt,
      needs: { ...r.needs }, activity: r.activity, zone: r.location.zone, seed: r.id.startsWith('seed:'), visitor: r.id.startsWith('raid:'),
    });
    if (a.visitor) {
      const parts = r.id.split(':');
      a.group = parts.slice(0, -1).join(':');
      a.visitorIndex = Number(parts[parts.length - 1]) || 2;
      const elapsed = Math.max(0, (w.now - r.joinedAt) / 1000);
      a.leaveAt = w.simTime + Math.max(20, 240 - elapsed);
    }
    w.agents.set(a.id, a);
    // Continue the restored activity briefly (re-reserving a seat when sitting exactly on one).
    const seat = findSeatNear(a.x, a.z, 0.05);
    const seatKey = seat ? `${seat.poi.id}#${(seat.poi.seats ?? []).indexOf(seat.seat)}` : undefined;
    const free = seatKey && !w.seats.has(seatKey);
    if (!free) pushOut(a);
    const sleeping = a.activity.startsWith('sleeping');
    const moving = /^(walking|running|arriving|leaving|wandering)/.test(a.activity);
    startAction(w, a, {
      type: sleeping ? 'sleep' : 'gesture', phase: 'perform', travelActivity: a.activity, activity: a.activity, spot: null,
      remaining: moving ? 0.5 : w.rng.range(sleeping ? 10 : 1.5, sleeping ? 30 : 5, 'restore', a.id),
      effects: sleeping ? { energy: 1.5, social: 0, fun: 0 } : { energy: 0, social: 0, fun: 0 }, speed: 0, priority: 0, travelTimeout: 0,
      anchored: !!free || sleeping, ...(free && seatKey ? { seatKey } : {}),
    });
  }
  for (const r of snap.relationships) {
    if (r.residentA === r.residentB) continue;
    const [ra, rb] = r.residentA < r.residentB ? [r.residentA, r.residentB] : [r.residentB, r.residentA];
    const key = pairKey(ra, rb);
    if (w.relationships.has(key)) continue;
    w.relationships.set(key, {
      residentA: ra, residentB: rb, friendship: Math.min(100, Math.max(0, r.friendship)),
      lastInteractionAt: r.lastInteractionAt, memories: r.memories.slice(-MAX_MEMORIES),
    });
    if (r.friendship >= 80) w.bestFriends.add(key);
    if (w.relationships.size >= MAX_RELATIONSHIPS) break;
  }
  // Never reuse simulation event ids already present in the restored history.
  const prefix = `${w.idPrefix}${w.tick}:`;
  for (const e of snap.eventHistory) {
    if (!e.id.startsWith(prefix)) continue;
    const n = Number(e.id.slice(prefix.length).split(':')[0]);
    if (Number.isFinite(n)) { w.idTick = w.tick; w.eventSerial = Math.max(w.eventSerial, n + 1); }
  }
  w.nextSocialAt = w.simTime + 2;
}

function zoneFor(a: Agent): string {
  const act = a.action;
  if (act?.poiId && act.phase === 'perform') return POI_BY_ID.get(act.poiId)?.zone ?? zoneAt(a.x, a.z);
  if (!act && a.zone) return a.zone;
  return zoneAt(a.x, a.z);
}

function exportWorld(w: World): SimulationExport {
  const residents = [...w.agents.values()].map(a => ({
    id: a.id,
    displayName: a.displayName,
    appearance: {
      ...a.appearance,
      outfit: { ...a.appearance.outfit },
      accessories: [...a.appearance.accessories],
      face: { ...a.appearance.face },
      body: { ...a.appearance.body },
    },
    personality: [...a.personality],
    needs: { energy: round(a.needs.energy, 1), social: round(a.needs.social, 1), fun: round(a.needs.fun, 1) },
    location: { x: round(a.x, 2), y: 0, z: round(a.z, 2), zone: zoneFor(a) },
    activity: a.activity.slice(0, 120),
    joinedAt: a.joinedAt,
    lastActiveAt: a.lastActiveAt,
  }));
  const relationships: Relationship[] = [...w.relationships.values()].map(r => ({
    residentA: r.residentA, residentB: r.residentB, friendship: round(r.friendship, 1), lastInteractionAt: r.lastInteractionAt, memories: [...r.memories],
  }));
  return { residents, relationships, weather: w.weather, simulationTime: round(w.simTime, 3) };
}

function substep(w: World, h: number): void {
  w.simTime += h;
  w.tick = tickFor(w.simTime);
  w.rng.setTick(w.tick);
  const clock = worldClock(w.simTime);
  runScheduled(w);
  for (const a of [...w.agents.values()]) {
    decayNeeds(a, h, clock);
    updateMood(a, w.weather, h);
  }
  for (const a of [...w.agents.values()]) {
    if (!w.agents.has(a.id)) continue;
    updateAgent(w, a, h, clock);
  }
  updateEncounters(w);
  directSocial(w);
  ambientCompany(w, h);
  separate(w);
}

function flushLlm(w: World): void {
  if (!w.llm.ready.length) return;
  const ready = w.llm.ready.splice(0, 2);
  for (const r of ready) {
    if (w.simTime - r.requestedAt > 30) continue;
    const speaker = w.agents.get(r.speakerId);
    if (!speaker) continue;
    const listener = r.listenerId ? w.agents.get(r.listenerId) ?? null : null;
    emit(w, 'chat', speaker, { target: listener, text: r.text, payload: { reaction: 'llm', sentiment: 'positive' } });
  }
}

export const createSimulation: CreateSimulation = (opts) => {
  const w = createWorld(opts);
  if (opts.initialSnapshot) restore(w, opts.initialSnapshot);
  else if (opts.seedResidents) seedWorld(w);
  const flush = () => { const out = w.out; w.out = []; return out; };
  const sim: Simulation = {
    applyEvent(event, now) {
      w.now = now;
      w.rng.setTick(w.tick);
      handleEvent(w, event);
      // Anyone left without a plan (e.g. a cancelled conversation partner) decides right away.
      const clock = worldClock(w.simTime);
      for (const a of [...w.agents.values()]) if (!a.action) decide(w, a, clock);
      return flush();
    },
    step(dtSeconds, now) {
      w.now = now;
      const dt = Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0);
      const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
      for (let i = 0; i < n; i++) substep(w, dt / n);
      flushLlm(w);
      return flush();
    },
    exportState: () => exportWorld(w),
    population: () => w.agents.size,
  };
  worlds.set(sim, w);
  return sim;
};

/** Attach (or detach with null) an optional LLM dialogue provider to a simulation instance. */
export function setDialogueProvider(sim: Simulation, provider: DialogueProvider | null): void {
  const w = worlds.get(sim);
  if (w) w.llm.provider = provider;
}
