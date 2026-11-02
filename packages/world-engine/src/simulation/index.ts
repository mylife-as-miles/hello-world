/**
 * TEMPORARY STUB simulation (coordinator scaffold). The Simulation Engineer
 * replaces this file with the real deterministic life simulation while keeping
 * the `createSimulation` signature from ./types.
 */
import type { ResidentProfile, Relationship, Weather, WorldEvent } from '@hello-world/contracts';
import { appearanceFromSeed, normalizeAppearance, hashString } from '../avatars/catalog';
import { POIS, findNavPath, nearestNavNode, SPAWN_POINT, type Vec2 } from '../world/layout';
import type { CreateSimulation, Simulation } from './types';

interface Internal { profile: ResidentProfile; path: Vec2[]; wait: number }

export const createSimulation: CreateSimulation = (opts) => {
  let simulationTime = opts.initialSnapshot?.simulationTime ?? 0;
  let weather: Weather = opts.initialSnapshot?.weather ?? 'sunny';
  const residents = new Map<string, Internal>();
  const relationships: Relationship[] = opts.initialSnapshot?.relationships.map(r => ({ ...r, memories: [...r.memories] })) ?? [];
  let counter = 0;

  const add = (id: string, name: string, x: number, z: number, now: number, personality: string[] = ['friendly']) => {
    residents.set(id, {
      profile: {
        id, displayName: name, appearance: appearanceFromSeed(id), personality,
        needs: { energy: 80, social: 60, fun: 60 }, location: { x, y: 0, z, zone: 'plaza' },
        activity: 'idle', joinedAt: now, lastActiveAt: now,
      }, path: [], wait: (hashString(id) % 5) + 1,
    });
  };
  if (opts.initialSnapshot) {
    for (const r of opts.initialSnapshot.residents) residents.set(r.id, { profile: structuredClone(r), path: [], wait: 1 });
  } else if (opts.seedResidents) {
    ['Nova', 'PixelCat', 'Mochi', 'Rex', 'Lumi', 'Bram'].forEach((n, i) => add(`seed:${n.toLowerCase()}`, n, Math.cos(i) * 5, Math.sin(i) * 5, opts.now));
  }

  const sim: Simulation = {
    applyEvent(event: WorldEvent, now: number) {
      const actor = residents.get(event.actorId);
      if (event.kind === 'join') {
        if (actor) {
          if (event.payload?.appearance) actor.profile.appearance = normalizeAppearance(event.payload.appearance);
          actor.profile.displayName = event.actorDisplayName;
        } else if (residents.size < opts.maxResidents) {
          add(event.actorId, event.actorDisplayName, SPAWN_POINT.x, SPAWN_POINT.z, now, event.payload?.personality ?? ['curious']);
          const r = residents.get(event.actorId)!;
          if (event.payload?.appearance) r.profile.appearance = normalizeAppearance(event.payload.appearance);
          r.profile.activity = 'arriving through the portal';
        }
      } else if (event.kind === 'weather' && event.payload?.weather) {
        weather = event.payload.weather;
      } else if (actor) {
        const verb = event.kind === 'chat' ? 'chatting' : event.kind === 'wave' ? 'waving' : event.kind === 'dance' ? 'dancing' : event.kind === 'gift' ? 'gifting' : 'greeting';
        actor.profile.activity = verb;
        actor.path = [];
        actor.wait = 4;
        actor.profile.lastActiveAt = now;
      }
      return [];
    },
    step(dt: number, now: number) {
      simulationTime += dt;
      for (const r of residents.values()) {
        const p = r.profile;
        if (r.path.length) {
          const t = r.path[0]!;
          const dx = t.x - p.location.x, dz = t.z - p.location.z;
          const d = Math.hypot(dx, dz);
          const stepLen = 1.3 * dt;
          if (d <= stepLen) { p.location.x = t.x; p.location.z = t.z; r.path.shift(); }
          else { p.location.x += (dx / d) * stepLen; p.location.z += (dz / d) * stepLen; }
          if (!r.path.length) { p.activity = 'idle'; r.wait = 3 + (hashString(p.id + counter) % 6); }
        } else if ((r.wait -= dt) <= 0) {
          const poi = POIS[hashString(`${p.id}:${counter++}`) % POIS.length]!;
          const from = nearestNavNode(p.location.x, p.location.z).id;
          r.path = [...findNavPath(from, poi.navNode), { x: poi.position.x + ((counter % 3) - 1), z: poi.position.z + 1.5 }];
          p.activity = `walking to ${poi.name}`;
          p.location.zone = poi.zone;
          p.lastActiveAt = now;
        }
      }
      return [];
    },
    exportState() {
      return {
        residents: [...residents.values()].map(r => structuredClone(r.profile)),
        relationships: relationships.map(r => ({ ...r, memories: [...r.memories] })),
        weather,
        simulationTime,
      };
    },
    population: () => residents.size,
  };
  return sim;
};
