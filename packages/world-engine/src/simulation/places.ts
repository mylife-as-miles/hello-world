/**
 * Place helpers on top of the shared layout: human phrasing, seats, spread
 * spots (avoiding buildings, the fountain basin, other residents and — for
 * ground-sitting — seats the renderer would otherwise snap to), and zones.
 */
import {
  BUILDINGS, FOUNTAIN_RADIUS, HOME_COUNT, PLAZA_RADIUS, POIS, SPAWN_POINT, WORLD_BOUNDS,
  type PoiDef, type Seat, type Vec2,
} from '../world/layout';
import { hashString } from '../avatars/catalog';
import { clamp, dist, type Agent, type World } from './state';

export const POI_BY_ID: ReadonlyMap<string, PoiDef> = new Map(POIS.map(p => [p.id, p]));
export const HOMES: PoiDef[] = POIS.filter(p => p.kind === 'home');
export const ALL_SEATS: Array<{ key: string; poi: PoiDef; seat: Seat; index: number }> = POIS.flatMap(
  poi => (poi.seats ?? []).map((seat, index) => ({ key: `${poi.id}#${index}`, poi, seat, index })),
);
export const SEAT_BY_KEY = new Map(ALL_SEATS.map(s => [s.key, s]));

export function poi(id: string): PoiDef {
  return POI_BY_ID.get(id) ?? POIS[0]!;
}

export function homeFor(id: string): PoiDef {
  const idx = hashString(id) % Math.max(1, HOME_COUNT);
  return HOMES.find(h => h.homeIndex === idx) ?? HOMES[0]!;
}

const ARTICLE = new Set(['fountain', 'stage', 'bench', 'playground', 'garden', 'portal']);
export function placeName(p: PoiDef): string { return ARTICLE.has(p.kind) ? `the ${p.name}` : p.name; }

/** "at Sunbeam Café", "on the Pond Bench", "by the Wishing Fountain", "in Willow Park". */
export function atPlace(p: PoiDef): string {
  switch (p.kind) {
    case 'bench': case 'stage': return `on ${placeName(p)}`;
    case 'fountain': case 'portal': return `by ${placeName(p)}`;
    case 'park': case 'garden': return `in ${placeName(p)}`;
    default: return `at ${placeName(p)}`;
  }
}

// ---------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------
interface Footprint { x: number; z: number; cos: number; sin: number; hw: number; hd: number }
const FOOTPRINTS: Footprint[] = BUILDINGS.map(b => ({
  x: b.position.x, z: b.position.z, cos: Math.cos(b.rotation), sin: Math.sin(b.rotation), hw: b.width / 2, hd: b.depth / 2,
}));

/** Rotated-rectangle test (three.js yaw convention). */
export function insideBuilding(x: number, z: number, margin = 0.4): boolean {
  for (const f of FOOTPRINTS) {
    const dx = x - f.x, dz = z - f.z;
    const lx = dx * f.cos - dz * f.sin;
    const lz = dx * f.sin + dz * f.cos;
    if (Math.abs(lx) <= f.hw + margin && Math.abs(lz) <= f.hd + margin) return true;
  }
  return false;
}

export const FOUNTAIN_CLEARANCE = FOUNTAIN_RADIUS + 0.45;

export function isBlocked(x: number, z: number): boolean {
  return x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || z < WORLD_BOUNDS.minZ || z > WORLD_BOUNDS.maxZ
    || Math.hypot(x, z) < FOUNTAIN_CLEARANCE || insideBuilding(x, z, 0.35);
}

/** Push a point out of the fountain basin / buildings and back inside world bounds. */
export function pushOut(p: { x: number; z: number }): void {
  p.x = clamp(p.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
  p.z = clamp(p.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
  const r = Math.hypot(p.x, p.z);
  if (r < FOUNTAIN_CLEARANCE) {
    if (r < 1e-4) { p.x = 0; p.z = FOUNTAIN_CLEARANCE; } else { p.x = (p.x / r) * FOUNTAIN_CLEARANCE; p.z = (p.z / r) * FOUNTAIN_CLEARANCE; }
  }
  for (const f of FOOTPRINTS) {
    const dx = p.x - f.x, dz = p.z - f.z;
    const lx = dx * f.cos - dz * f.sin;
    const lz = dx * f.sin + dz * f.cos;
    const m = 0.3;
    const px = f.hw + m - Math.abs(lx), pz = f.hd + m - Math.abs(lz);
    if (px > 0 && pz > 0) {
      let nlx = lx, nlz = lz;
      if (px < pz) nlx = Math.sign(lx || 1) * (f.hw + m); else nlz = Math.sign(lz || 1) * (f.hd + m);
      // local → world
      p.x = f.x + nlx * f.cos + nlz * f.sin;
      p.z = f.z - nlx * f.sin + nlz * f.cos;
    }
  }
}

/** True when the renderer's findSeatNear(…, 1.2) would snap a sitter at (x, z) onto a seat. */
export function nearSeat(x: number, z: number, radius = 1.4): boolean {
  for (const s of ALL_SEATS) if (Math.hypot(s.seat.x - x, s.seat.z - z) < radius) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Seats & spots
// ---------------------------------------------------------------------------
export function freeSeat(w: World, p: PoiDef, a: Agent): { key: string; seat: Seat } | null {
  const seats = p.seats ?? [];
  if (!seats.length) return null;
  const start = w.rng.int(seats.length, 'seat', a.id);
  for (let i = 0; i < seats.length; i++) {
    const idx = (start + i) % seats.length;
    const key = `${p.id}#${idx}`;
    const owner = w.seats.get(key);
    if (!owner || owner === a.id || !w.agents.has(owner)) return { key, seat: seats[idx]! };
  }
  return null;
}

export function hasFreeSeat(w: World, p: PoiDef, a: Agent): boolean {
  const seats = p.seats ?? [];
  for (let i = 0; i < seats.length; i++) {
    const owner = w.seats.get(`${p.id}#${i}`);
    if (!owner || owner === a.id || !w.agents.has(owner)) return true;
  }
  return false;
}

function crowding(w: World, self: Agent, x: number, z: number): number {
  let nearest = 9;
  for (const o of w.agents.values()) {
    if (o === self) continue;
    const d1 = Math.hypot(o.x - x, o.z - z);
    if (d1 < nearest) nearest = d1;
    const spot = o.action?.spot;
    if (spot) { const d2 = Math.hypot(spot.x - x, spot.z - z); if (d2 < nearest) nearest = d2; }
  }
  return nearest;
}

function candidate(w: World, p: PoiDef, a: Agent): Vec2 {
  const ang = w.rng.float('spot-a', a.id) * Math.PI * 2;
  const u = w.rng.float('spot-r', a.id);
  switch (p.kind) {
    case 'plaza': { const r = 3.2 + u * (p.radius - 3.2); return { x: p.position.x + Math.cos(ang) * r, z: p.position.z + Math.sin(ang) * r }; }
    case 'fountain': { const r = FOUNTAIN_RADIUS + 0.6 + u * 0.75; return { x: Math.cos(ang) * r, z: Math.sin(ang) * r }; }
    case 'portal': return { x: p.position.x + (u - 0.5) * 5.2, z: p.position.z + 2.3 + w.rng.float('spot-z', a.id) * 1.8 };
    default: { const r = Math.sqrt(u) * p.radius; return { x: p.position.x + Math.cos(ang) * r, z: p.position.z + Math.sin(ang) * r }; }
  }
}

/**
 * A free standing spot inside a place: best of a few deterministic candidates,
 * preferring room from other residents. `groundSit` keeps clear of seats.
 */
export function pickSpot(w: World, p: PoiDef, a: Agent, groundSit = false): Vec2 {
  let best: Vec2 | null = null;
  let bestRoom = -1;
  for (let i = 0; i < 7; i++) {
    const c = candidate(w, p, a);
    if (isBlocked(c.x, c.z) || (groundSit && nearSeat(c.x, c.z))) continue;
    const room = crowding(w, a, c.x, c.z);
    if (room > bestRoom) { best = c; bestRoom = room; }
    if (room >= 1.4) break;
  }
  const out = best ?? { x: p.position.x, z: p.position.z + (p.kind === 'fountain' ? FOUNTAIN_RADIUS + 0.9 : 0) };
  pushOut(out);
  return { x: out.x, z: out.z };
}

/** Spot within `radius` of a point (used for crowds around a resident / the portal). */
export function spotAround(w: World, center: Vec2, minR: number, maxR: number, a: Agent, purpose: string): Vec2 {
  let best: Vec2 | null = null;
  let bestRoom = -1;
  for (let i = 0; i < 6; i++) {
    const ang = w.rng.float(`${purpose}-a`, a.id) * Math.PI * 2;
    const r = minR + w.rng.float(`${purpose}-r`, a.id) * (maxR - minR);
    const c = { x: center.x + Math.cos(ang) * r, z: center.z + Math.sin(ang) * r };
    if (isBlocked(c.x, c.z)) continue;
    const room = crowding(w, a, c.x, c.z);
    if (room > bestRoom) { best = c; bestRoom = room; }
    if (room >= 1.1) break;
  }
  const out = best ?? { x: center.x + minR, z: center.z };
  pushOut(out);
  return out;
}

export function arrivalSpot(w: World, a: Agent): Vec2 {
  const c = { x: SPAWN_POINT.x + (w.rng.float('arrive-x', a.id) - 0.5) * 2.6, z: SPAWN_POINT.z + (w.rng.float('arrive-z', a.id) - 0.5) * 1.2 };
  pushOut(c);
  return c;
}

export function portalSpot(w: World, a: Agent): Vec2 {
  return pickSpot(w, poi('portal'), a);
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------
const ZONE_POIS = POIS.filter(p => p.kind !== 'plaza' && p.kind !== 'fountain');

export function zoneAt(x: number, z: number): string {
  if (Math.hypot(x, z) <= PLAZA_RADIUS) return 'plaza';
  let best: PoiDef | null = null;
  let bd = Infinity;
  for (const p of ZONE_POIS) {
    const d = Math.hypot(p.position.x - x, p.position.z - z) - p.radius;
    if (d < bd) { bd = d; best = p; }
  }
  return best && bd <= 3.5 ? best.zone : 'street';
}

/** Nearest place (for "where did this happen" phrasing). */
export function nearestPoi(x: number, z: number): PoiDef {
  if (Math.hypot(x, z) <= 4) return poi('fountain');
  if (Math.hypot(x, z) <= PLAZA_RADIUS) return poi('plaza');
  let best = POIS[0]!;
  let bd = Infinity;
  for (const p of POIS) {
    const d = Math.hypot(p.position.x - x, p.position.z - z) - p.radius * 0.5;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function placeOf(a: Agent): PoiDef {
  const id = a.action?.poiId;
  if (id && a.action?.phase === 'perform') return poi(id);
  return nearestPoi(a.x, a.z);
}

export const distToPoi = (a: Agent, p: PoiDef) => dist(a, p.position);
