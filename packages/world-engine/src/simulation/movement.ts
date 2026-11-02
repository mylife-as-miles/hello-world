/**
 * Movement: nav-graph paths (A* from layout) with straight-line shortcuts for
 * short hops, fountain detours, fixed-speed stepping and soft separation so
 * residents never stack on one point.
 */
import { FOUNTAIN_RADIUS, findNavPath, nearestNavNode, type Vec2 } from '../world/layout';
import { insideBuilding, isBlocked, pushOut } from './places';
import { hashUnit } from './rng';
import { dist, type Agent, type World } from './state';

export const WALK_SPEED = 1.3;
export const RUN_SPEED = 3;
export const STROLL_SPEED = 0.9;

function segmentHitsBuilding(a: Vec2, b: Vec2): boolean {
  const len = dist(a, b);
  const n = Math.max(1, Math.ceil(len / 0.6));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (insideBuilding(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.15)) return true;
  }
  return false;
}

const DETOUR_R = FOUNTAIN_RADIUS + 0.9;

/** Append b (with waypoints around the fountain basin if a→b cuts through it). */
function pushWithDetour(a: Vec2, b: Vec2, out: Vec2[], depth = 0): void {
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  if (len2 > 1e-6 && depth < 4) {
    const t = -(a.x * abx + a.z * abz) / len2;
    if (t > 0 && t < 1) {
      const cx = a.x + abx * t, cz = a.z + abz * t;
      const d = Math.hypot(cx, cz);
      if (d < FOUNTAIN_RADIUS + 0.5) {
        let nx: number, nz: number;
        if (d > 1e-3) { nx = cx / d; nz = cz / d; } else { const L = Math.sqrt(len2); nx = -abz / L; nz = abx / L; }
        const wp = { x: nx * DETOUR_R, z: nz * DETOUR_R };
        pushWithDetour(a, wp, out, depth + 1);
        pushWithDetour(wp, b, out, depth + 1);
        return;
      }
    }
  }
  out.push({ x: b.x, z: b.z });
}

/** Waypoints from `from` to `to` (excluding the start, including `to`). */
export function planPath(from: Vec2, to: Vec2): Vec2[] {
  const direct = dist(from, to);
  if (direct < 0.03) return [];
  const out: Vec2[] = [];
  if (direct <= 8 && !segmentHitsBuilding(from, to)) {
    pushWithDetour(from, to, out);
    return out;
  }
  const start = nearestNavNode(from.x, from.z);
  const end = nearestNavNode(to.x, to.z);
  const nodes = findNavPath(start.id, end.id);
  const pts = nodes.length ? nodes.slice() : [];
  if (pts.length >= 2 && dist(from, pts[1]!) <= dist(pts[0]!, pts[1]!) && !segmentHitsBuilding(from, pts[1]!)) pts.shift();
  if (pts.length >= 2) {
    const prev = pts[pts.length - 2]!, last = pts[pts.length - 1]!;
    if (dist(prev, to) <= dist(prev, last) && !segmentHitsBuilding(prev, to)) pts.pop();
  }
  pts.push(to);
  let cur = from;
  for (const p of pts) { pushWithDetour(cur, p, out); cur = p; }
  return out;
}

export function pathLength(from: Vec2, path: Vec2[]): number {
  let len = 0;
  let cur = from;
  for (const p of path) { len += dist(cur, p); cur = p; }
  return len;
}

/** Advance along the path by `budget` metres. Returns true when the path is finished. */
export function moveAlong(a: Agent, budget: number): boolean {
  while (budget > 1e-6 && a.path.length) {
    const t = a.path[0]!;
    const dx = t.x - a.x, dz = t.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d <= budget) { a.x = t.x; a.z = t.z; a.path.shift(); budget -= d; }
    else { a.x += (dx / d) * budget; a.z += (dz / d) * budget; budget = 0; }
  }
  return a.path.length === 0;
}

const MIN_GAP = 0.7;

function anchored(a: Agent): boolean {
  const act = a.action;
  return !!act && act.phase === 'perform' && act.anchored;
}

/** Soft separation: overlapping residents are nudged apart (seated/sleeping ones never move). */
export function separate(w: World): void {
  const list = [...w.agents.values()];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const dx = b.x - a.x;
      if (dx > MIN_GAP || dx < -MIN_GAP) continue;
      const dz = b.z - a.z;
      if (dz > MIN_GAP || dz < -MIN_GAP) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= MIN_GAP * MIN_GAP) continue;
      const fa = anchored(a), fb = anchored(b);
      if (fa && fb) continue;
      let d = Math.sqrt(d2);
      let nx: number, nz: number;
      if (d < 1e-4) {
        const ang = hashUnit(`${a.id}|${b.id}`) * Math.PI * 2;
        nx = Math.cos(ang); nz = Math.sin(ang); d = 0;
      } else { nx = dx / d; nz = dz / d; }
      const push = (MIN_GAP - d) * 0.5;
      if (fa) { b.x += nx * push * 2; b.z += nz * push * 2; pushOut(b); }
      else if (fb) { a.x -= nx * push * 2; a.z -= nz * push * 2; pushOut(a); }
      else { a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push; pushOut(a); pushOut(b); }
    }
  }
}

/** A free point `distance` from `anchor`, on the side facing `mover` when possible. */
export function meetingPoint(anchor: { x: number; z: number }, mover: { x: number; z: number }, distance: number, salt: string): Vec2 {
  let dx = mover.x - anchor.x, dz = mover.z - anchor.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) { const ang = hashUnit(salt) * Math.PI * 2; dx = Math.cos(ang); dz = Math.sin(ang); d = 1; }
  const base = Math.atan2(dz / d, dx / d);
  for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
    const ang = base + off;
    const c = { x: anchor.x + Math.cos(ang) * distance, z: anchor.z + Math.sin(ang) * distance };
    if (!isBlocked(c.x, c.z)) return c;
  }
  const c = { x: anchor.x + (dx / d) * distance, z: anchor.z + (dz / d) * distance };
  pushOut(c);
  return c;
}
