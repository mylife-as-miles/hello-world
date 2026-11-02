/**
 * Pure camera-pose helpers (Node-safe: three math + layout data only) shared by the camera
 * director and its unit tests: static occluders (buildings, stage, fountain, portal), tagged
 * props published by the town builder (lamp posts, trees, planters, umbrellas, stage poles),
 * segment / clutter / lens tests and a yaw × height-ladder pose picker.
 */
import { BUILDINGS, getPoi } from '../world/layout';

export interface CameraProp { x: number; z: number; r: number; h: number; /** bottom of the blocking band (canopies) */ minY?: number }

/* ------------------------------------------------------------ occluders */

export type Occluder =
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; c: number; s: number; h: number }
  | { kind: 'circle'; x: number; z: number; r: number; h: number };

export const OCCLUDERS: Occluder[] = (() => {
  const out: Occluder[] = [];
  for (const b of BUILDINGS) {
    const h = b.kind === 'house' ? (b.palette === 4 || b.palette === 6 ? 8.2 : 6.4) : b.kind === 'cafe' ? 4.8 : 5.6;
    out.push({ kind: 'box', x: b.position.x, z: b.position.z, hw: b.width / 2 + 0.45, hd: b.depth / 2 + 0.45, c: Math.cos(b.rotation), s: Math.sin(b.rotation), h });
  }
  const stage = getPoi('stage')?.position;
  if (stage) out.push({ kind: 'circle', x: stage.x, z: stage.z, r: 3.15, h: 3.2 });
  // fountain: treated taller than it is so shots never look across its tiers (no see-through dither on it)
  out.push({ kind: 'circle', x: 0, z: 0, r: 2.35, h: 3.6 });
  const portal = getPoi('portal')?.position;
  if (portal) out.push({ kind: 'box', x: portal.x, z: portal.z, hw: 3.3, hd: 0.7, c: 1, s: 0, h: 5.2 });
  return out;
})();

/** Is the segment camera(a) → target(b) blocked by any occluder (2D footprint + height)? Allocation-free. */
let EXTRA: ReadonlyArray<CameraProp> = [];
/** Props the camera must respect (set every frame by the rig from kit.occluders; tests set it directly). */
export function setCameraProps(props: ReadonlyArray<CameraProp>): void { EXTRA = props; }
export function getCameraProps(): ReadonlyArray<CameraProp> { return EXTRA; }

export function blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    // the camera itself must keep clear of props (no canopy / post filling the lens)
    const lo = o.minY ?? 0;
    if (ay < o.h + 0.6 && ay > lo - 0.6 && Math.hypot(ax - o.x, az - o.z) < o.r + 2.2) return true;
    const dx = bx - ax, dz = bz - az;
    const fx = ax - o.x, fz = az - o.z;
    const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - o.r * o.r;
    const disc = B * B - 4 * A * C;
    if (A < 1e-9 || disc <= 0) continue;
    const sq = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - sq) / (2 * A)), t1 = Math.min(1, (-B + sq) / (2 * A));
    if (t0 > t1 || t1 >= 0.97) continue; // ignore props right at the subject
    const ya = ay + (by - ay) * t0, yb = ay + (by - ay) * t1;
    if (Math.min(ya, yb) < o.h && Math.max(ya, yb) > lo) return true;
  }
  for (let i = 0; i < OCCLUDERS.length; i++) {
    const o = OCCLUDERS[i]!;
    let t0 = 0, t1 = 1;
    if (o.kind === 'box') {
      const lax = (ax - o.x) * o.c - (az - o.z) * o.s, laz = (ax - o.x) * o.s + (az - o.z) * o.c;
      // camera keeps ~2 m clear of walls (no wall filling a quarter of the frame)
      if (ay < o.h + 0.8 && Math.abs(lax) < o.hw + 2.0 && Math.abs(laz) < o.hd + 2.0) return true;
      const lbx = (bx - o.x) * o.c - (bz - o.z) * o.s, lbz = (bx - o.x) * o.s + (bz - o.z) * o.c;
      const dx = lbx - lax, dz = lbz - laz;
      // slab X
      if (Math.abs(dx) < 1e-6) { if (Math.abs(lax) > o.hw) continue; }
      else {
        let ta = (-o.hw - lax) / dx, tb = (o.hw - lax) / dx;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      // slab Z
      if (Math.abs(dz) < 1e-6) { if (Math.abs(laz) > o.hd) continue; }
      else {
        let ta = (-o.hd - laz) / dz, tb = (o.hd - laz) / dz;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
    } else {
      // camera keeps ~2 m clear of the fountain / stage footprint when below their top
      if (ay < o.h + 0.6 && Math.hypot(ax - o.x, az - o.z) < o.r + 2.0) return true;
      const dx = bx - ax, dz = bz - az;
      const fx = ax - o.x, fz = az - o.z;
      const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - o.r * o.r;
      const disc = B * B - 4 * A * C;
      if (A < 1e-9 || disc <= 0) continue;
      const sq = Math.sqrt(disc);
      t0 = Math.max(0, (-B - sq) / (2 * A)); t1 = Math.min(1, (-B + sq) / (2 * A));
      if (t0 > t1) continue;
    }
    const y0 = ay + (by - ay) * t0;
    if (t1 >= 0.999) {
      // target stands inside the footprint (e.g. on the stage): only the entry point matters
      if (t0 > 0.001 && y0 < o.h) return true;
      continue;
    }
    const y1 = ay + (by - ay) * t1;
    if (Math.min(y0, y1) < o.h) return true;
  }
  return false;
}


/** Fat test: any prop (lamp post, tree, planter…) within `margin` of the subject end of the segment. */
export function propsNear(ax: number, ay: number, az: number, bx: number, by: number, bz: number, margin: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    const t = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / l2));
    if (t < 0.2 || t > 0.97) continue;
    const px = ax + dx * t, pz = az + dz * t;
    if (Math.hypot(o.x - px, o.z - pz) < o.r + margin && ay + (by - ay) * t < o.h) return true;
  }
  return false;
}

/** Does `prop` cover the sight line camera → subject (subject half-width 0.35 m + prop radius)? */
export function segmentHitsProp(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: CameraProp, halfWidth = 0.35): boolean {
  const dx = bx - ax, dz = bz - az;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  const ox = o.x - ax, oz = o.z - az;
  const f = ox * fx + oz * fz;
  if (f < 0.3 || f > D + 0.2) return false;
  const y = ay + (by - ay) * (Math.min(f, D) / D);
  if (y > o.h + 0.25 || y < (o.minY ?? 0) - 0.25) return false;
  return Math.abs(ox * fz - oz * fx) < halfWidth + o.r;
}

/**
 * Clutter: any prop taller than 1.2 m standing in the central third of the frame between camera and
 * subject — including right at the subject (a seated body reaches ~0.5 m towards the camera, so only
 * props beyond D + 0.2 count as "behind"), plus props up to 1.5 m BEHIND the subject that would grow
 * out of its head. Height-aware: a prop whose top is below the sight line does not count.
 */
export function centralClutter(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    if (o.h < 1.2) continue;
    const ox = o.x - ax, oz = o.z - az;
    const f = ox * fx + oz * fz;
    if (f < 0.3 || f > D + 1.5) continue;
    const lateral = Math.abs(ox * fz - oz * fx);
    if (f > D + 0.2) {
      // behind the subject: only a prop practically in line with the head is a problem
      if (o.h > by && lateral < 0.45 + o.r) return true;
      continue;
    }
    const y = ay + (by - ay) * (Math.min(f, D) / D);
    if (y > o.h + 0.25 || y < (o.minY ?? 0) - 0.25) continue;
    const half = Math.max(f * 0.22, 0.35) + o.r * 0.8;
    if (lateral < half) return true;
  }
  return false;
}

/** No prop taller than 1.2 m within 3 m of the lens inside the (forward) frustum. */
export function lensClear(ax: number, ay: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    if (o.h < 1.2 || ay > o.h + 2.0) continue;
    const ox = o.x - ax, oz = o.z - az;
    const dist = Math.hypot(ox, oz) - o.r;
    if (dist > 3) continue;
    const f = ox * fx + oz * fz;
    if (f < -0.5) continue; // behind the lens
    if (Math.abs(ox * fz - oz * fx) < Math.max(0, f) * 0.75 + o.r + 0.4) return false;
  }
  return true;
}

/** Tall props in the near half of a shot (camera → subject) would loom in the foreground. */
export function foregroundClutter(cx: number, cz: number, tx: number, tz: number): boolean {
  const dx = tx - cx, dz = tz - cz;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    if (o.h < 2.4) continue;
    const ox = o.x - cx, oz = o.z - cz;
    const f = ox * fx + oz * fz;
    if (f <= 0 || f > D * 0.5) continue;
    const lateral = Math.abs(ox * fz - oz * fx);
    if (lateral < f * 0.62 + o.r) return true;
  }
  return false;
}

/** A pose is clean when nothing blocks the subject, no prop clutters the central third and the lens is clear. */
export function poseClean(cx: number, cy: number, cz: number, sx: number, headY: number, sz: number): boolean {
  return !blocked(cx, cy, cz, sx, headY, sz) && !centralClutter(cx, cy, cz, sx, headY, sz) && lensClear(cx, cy, cz, sx, sz);
}

export interface PickedPose { x: number; y: number; z: number; yaw: number; rel: number; level: number }

/** Relative yaw candidates (front three-quarter first) and the height ladder (rise instead of accepting clutter). */
export const POSE_REL = [0.62, -0.62, 0.95, -0.95, 1.3, -1.3, 1.75, -1.75, 2.3, -2.3, 0.3, -0.3, Math.PI];
export const POSE_RISE = [0, 2.4, 5.0, 8.5];

/**
 * Pick a clean framing pose around a subject. Tries `prefRel` first, then every relative yaw in
 * POSE_REL (same side first) at each rung of the height ladder (distance grows a little per rung).
 * Returns false when nothing is clean (out = highest rung of the preferred side).
 */
export function pickFramingPose(
  sx: number, sz: number, headY: number, heading: number, dist: number, height: number,
  out: PickedPose, prefRel = POSE_REL[0]!,
): boolean {
  const side = prefRel < 0 ? -1 : 1;
  for (let level = 0; level < POSE_RISE.length; level++) {
    const h = height + POSE_RISE[level]!;
    const d = dist * (1 + level * 0.12);
    for (let i = -1; i < POSE_REL.length; i++) {
      const rel = i < 0 ? prefRel : POSE_REL[i]! * side;
      const yaw = heading + rel;
      const cx = sx + Math.sin(yaw) * d, cz = sz + Math.cos(yaw) * d;
      if (poseClean(cx, h, cz, sx, headY, sz)) { out.x = cx; out.y = h; out.z = cz; out.yaw = yaw; out.rel = rel; out.level = level; return true; }
    }
  }
  const lvl = POSE_RISE.length - 1, d = dist * (1 + lvl * 0.12), yaw = heading + prefRel;
  out.x = sx + Math.sin(yaw) * d; out.y = height + POSE_RISE[lvl]!; out.z = sz + Math.cos(yaw) * d; out.yaw = yaw; out.rel = prefRel; out.level = lvl;
  return false;
}
