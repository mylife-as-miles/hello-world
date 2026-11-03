/**
 * Pure camera-pose helpers (Node-safe: three math + layout data only) shared by the camera
 * director and its unit tests: static occluders (buildings, stage, fountain, portal), tagged
 * props published by the town builder (lamp posts, trees, planters, umbrellas, stage poles),
 * segment / clutter / lens tests and a yaw × height-ladder pose picker.
 */
import { BUILDINGS, getPoi } from '../world/layout';

export interface CameraProp {
  x: number; z: number; r: number; h: number;
  /** bottom of the blocking band (canopies) */ minY?: number;
  /**
   * Overhead span (stage string lights): a sight line crossing the band [minY, h] inside the footprint is
   * blocked even when the subject stands under it (no "right at the subject" exemption); excluded from the
   * cylinder clutter tests.
   */
  canopy?: boolean;
}

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
  // the platform only (0.45 m + margin): the poles are props and the string-light span is a canopy prop
  // (LAYOUT_PROPS), so a low shot may look under the strings at residents on the stage
  if (stage) out.push({ kind: 'circle', x: stage.x, z: stage.z, r: 3.15, h: 0.7 });
  // fountain: treated taller than it is so shots never look across its tiers (no see-through dither on it)
  out.push({ kind: 'circle', x: 0, z: 0, r: 2.35, h: 3.6 });
  const portal = getPoi('portal')?.position;
  if (portal) out.push({ kind: 'box', x: portal.x, z: portal.z, hw: 3.3, hd: 0.7, c: 1, s: 0, h: 5.2 });
  return out;
})();

/** Local building coords → world (same yaw convention as the town builder). */
function toWorld(b: { position: { x: number; z: number }; rotation: number }, lx: number, lz: number) {
  const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
  return { x: b.position.x + lx * c + lz * s, z: b.position.z - lx * s + lz * c };
}

/**
 * Props the town builder does not publish to `kit.occluders`, derived from the static layout (same
 * placement maths as town.ts): the stage string-light span (canopy band), the portal ring's sides, the
 * café terrace planters, the arcade cabinets / claw machine out front and the picket fences of the yards.
 */
export const LAYOUT_PROPS: ReadonlyArray<CameraProp> = (() => {
  const out: CameraProp[] = [];
  const stage = getPoi('stage')?.position;
  // poles at r 2.95 (3.45 m) with sagging strings down to ~2.6 m across the whole stage
  if (stage) out.push({ x: stage.x, z: stage.z, r: 3.1, h: 3.75, minY: 2.45, canopy: true });
  const portal = getPoi('portal')?.position;
  if (portal) for (const sx of [-1, 1]) out.push({ x: portal.x + sx * 2.85, z: portal.z, r: 0.6, h: 6.4 });
  const cafe = getPoi('cafe');
  if (cafe?.seats?.length) {
    const minX = Math.min(...cafe.seats.map(q => q.x)) - 0.9;
    const minZ = Math.min(...cafe.seats.map(q => q.z)) - 1.2, maxZ = Math.max(...cafe.seats.map(q => q.z)) + 1.2;
    for (const pz of [minZ + 0.3, maxZ - 0.3]) out.push({ x: minX + 0.3, z: pz, r: 0.6, h: 1.2 });
  }
  for (const b of BUILDINGS) {
    if (b.kind === 'arcade') {
      for (const lx of [-2.05, 2.1]) { const p = toWorld(b, lx, b.depth / 2 + 0.75); out.push({ x: p.x, z: p.z, r: 0.55, h: 1.9 }); }
    } else if (b.kind === 'house') {
      const fz = b.depth / 2, fenceZ = fz + 3.3, hw = b.width / 2 + 0.9;
      for (let lx = -hw; lx <= hw + 1e-6; lx += 1.3) { const p = toWorld(b, lx, fenceZ); out.push({ x: p.x, z: p.z, r: 0.45, h: 1.0 }); }
      for (let lz = fz + 0.6; lz < fenceZ; lz += 1.3) for (const sx of [-1, 1]) { const p = toWorld(b, sx * hw, lz); out.push({ x: p.x, z: p.z, r: 0.45, h: 1.0 }); }
    }
  }
  return out;
})();

/** Is the segment camera(a) → target(b) blocked by any occluder (2D footprint + height)? Allocation-free. */
let EXTRA: ReadonlyArray<CameraProp> = LAYOUT_PROPS;
let extraSrc: ReadonlyArray<CameraProp> | null = null;
/**
 * Props the camera must respect (set every frame by the rig from kit.occluders; tests set it directly).
 * The layout-derived props are always appended (merged once per distinct input array).
 */
export function setCameraProps(props: ReadonlyArray<CameraProp>): void {
  if (props === extraSrc) return;
  extraSrc = props;
  EXTRA = props.length ? props.concat(LAYOUT_PROPS) : LAYOUT_PROPS;
}
export function getCameraProps(): ReadonlyArray<CameraProp> { return EXTRA; }

/** Does the sight line a → b cross a canopy's band [minY, h] inside its footprint (subject under it included)? */
export function throughCanopy(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: CameraProp): boolean {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - o.x, fz = az - o.z;
  const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - o.r * o.r;
  let t0: number, t1: number;
  if (A < 1e-9) { if (C > 0) return false; t0 = 0; t1 = 1; }
  else {
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return false;
    const sq = Math.sqrt(disc);
    t0 = Math.max(0, (-B - sq) / (2 * A)); t1 = Math.min(1, (-B + sq) / (2 * A));
    if (t0 > t1) return false;
  }
  const lo = o.minY ?? 0;
  const dy = by - ay;
  // t-range where the line is inside the vertical band
  let u0 = 0, u1 = 1;
  if (Math.abs(dy) < 1e-6) { if (ay < lo || ay > o.h) return false; }
  else {
    let ua = (lo - ay) / dy, ub = (o.h - ay) / dy;
    if (ua > ub) { const q = ua; ua = ub; ub = q; }
    u0 = Math.max(0, ua); u1 = Math.min(1, ub);
  }
  return Math.max(t0, u0) < Math.min(t1, u1) - 1e-3;
}

export function blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    // the camera itself must keep clear of props (no canopy / post filling the lens)
    const lo = o.minY ?? 0;
    if (ay < o.h + 0.6 && ay > lo - 0.6 && Math.hypot(ax - o.x, az - o.z) < o.r + 2.2) return true;
    if (o.canopy) { if (throughCanopy(ax, ay, az, bx, by, bz, o)) return true; continue; }
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
    if (o.canopy) continue;
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
    if (o.h < 1.2 || o.canopy) continue;
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

/** Horizontal half-FOV tangent of the director's lens (fov 42°, 16:9) plus a little slack. */
export const LENS_TAN_H = Math.tan((21 * Math.PI) / 180) * (16 / 9) + 0.08;

/**
 * Lens test: no prop near the lens anywhere inside the horizontal frustum (not just the central
 * third) — tall props (≥ 1.2 m) within 3.2 m, low ones (planter pots, fences, ≥ 0.6 m) within 2.2 m —
 * unless the camera is well above them. A prop that close fills a large part of the frame.
 */
export function lensClear(ax: number, ay: number, az: number, bx: number, bz: number, reachWide = 3.2): boolean {
  const dx = bx - ax, dz = bz - az;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    if (o.canopy || o.h < 0.6 || ay > o.h + 2.2) continue;
    // wide props (tree / planter canopies, r ≥ 0.8) spread well past their footprint radius
    const wide = o.h >= 2.4 && o.r >= 0.8;
    const reach = wide ? Math.max(3.2, reachWide) : o.h >= 1.2 ? 3.2 : 2.2;
    const rr = wide ? o.r + 0.6 : o.r;
    const ox = o.x - ax, oz = o.z - az;
    const dist = Math.hypot(ox, oz) - rr;
    if (dist > reach) continue;
    const f = ox * fx + oz * fz;
    if (f < -rr) continue; // fully behind the lens
    if (Math.abs(ox * fz - oz * fx) - rr < Math.max(0.05, f) * LENS_TAN_H + 0.15) return false;
  }
  return true;
}

/** Street (eye-level) lens reach for wide canopies: a planter tree 5 m away still fills half the frame. */
export const STREET_CANOPY_REACH = 6.5;

/**
 * Fraction of the frame width covered by building walls (and the portal) standing between the camera
 * and the subject's depth, within ~9 m of the lens. A wall beside / in front of the subject that fills
 * a large part of the frame (K-follow-seated: the arcade wall at ~40 %) is rejected; a facade behind the
 * subject is a backdrop and does not count.
 */
export function wallCoverage(ax: number, ay: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  const T = LENS_TAN_H;
  let worst = 0;
  // frame bottom (pitch towards the subject's chest minus the half vertical fov): a wall top below it is out of frame
  const bottom = Math.atan2(1.1 - ay, D) - (21 * Math.PI) / 180;
  for (let i = 0; i < OCCLUDERS.length; i++) {
    const o = OCCLUDERS[i]!;
    if (o.kind !== 'box') continue;
    const hw = o.hw - 0.45, hd = o.hd - 0.45; // real wall footprint (occluders carry a margin)
    if (Math.hypot(o.x - ax, o.z - az) > Math.hypot(hw, hd) + 9) continue;
    let lo = Infinity, hi = -Infinity, any = false;
    // sample the footprint perimeter (convex): screen-x tangent of every sample nearer than the subject
    for (let k = 0; k < 32; k++) {
      const e = k >> 3, u = ((k & 7) + 0.5) / 8 * 2 - 1;
      const lx = e === 0 ? u * hw : e === 1 ? hw : e === 2 ? -u * hw : -hw;
      const lz = e === 0 ? hd : e === 1 ? -u * hd : e === 2 ? -hd : u * hd;
      // local → world (inverse of the occluder's local transform used in blocked())
      const wx = o.x + lx * o.c + lz * o.s, wz = o.z - lx * o.s + lz * o.c;
      const ox = wx - ax, oz = wz - az;
      if (Math.hypot(ox, oz) > 9) continue;
      const f = ox * fx + oz * fz;
      if (f > D + 0.3 || f <= 0.15) continue; // behind the subject (backdrop) or behind the lens
      if (Math.atan2(o.h - ay, f) < bottom) continue; // wall top below the frame (camera well above it)
      const lat = ox * fz - oz * fx; // screen-right is negative here; only the extent matters
      const x = lat / f;
      if (x < lo) lo = x; if (x > hi) hi = x;
      any = true;
    }
    if (!any) continue;
    const a = Math.max(-T, lo), b = Math.min(T, hi);
    if (b > a) worst = Math.max(worst, (b - a) / (2 * T));
  }
  return worst;
}

/** Tall props in the near half of a shot (camera → subject) would loom in the foreground. */
export function foregroundClutter(cx: number, cz: number, tx: number, tz: number): boolean {
  const dx = tx - cx, dz = tz - cz;
  const D = Math.hypot(dx, dz) || 1;
  const fx = dx / D, fz = dz / D;
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    if (o.h < 2.4 || o.canopy) continue;
    const ox = o.x - cx, oz = o.z - cz;
    const f = ox * fx + oz * fz;
    if (f <= 0 || f > D * 0.5) continue;
    const lateral = Math.abs(ox * fz - oz * fx);
    if (lateral < f * 0.62 + o.r) return true;
  }
  return false;
}

/** Max share of the frame width a near wall may cover. */
export const WALL_COVERAGE_MAX = 0.3;

/**
 * A pose is clean when nothing blocks the subject (incl. the stage's string-light span), no prop clutters
 * the central third, the lens is clear of props anywhere in the frame and no near wall covers > 30 %.
 */
export function poseClean(cx: number, cy: number, cz: number, sx: number, headY: number, sz: number): boolean {
  return !blocked(cx, cy, cz, sx, headY, sz) && !centralClutter(cx, cy, cz, sx, headY, sz) && lensClear(cx, cy, cz, sx, sz)
    && wallCoverage(cx, cy, cz, sx, sz) <= WALL_COVERAGE_MAX;
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

/* ------------------------------------------------------------- two-shot */

/**
 * Two-shot (event with a target): camera roughly perpendicular to the actor–target axis at a distance
 * that keeps both inside the central 60 % of the frame (NDC ±0.6 incl. a 0.45 m body half-width).
 * Tries the preferred side first, then the other, with small yaw offsets, on each rung of the height
 * ladder; every candidate must be clean towards BOTH subjects. Returns false when no clean pose exists.
 */
export function pickTwoShot(
  ax: number, az: number, bx: number, bz: number, headY: number, height: number, minDist: number,
  prefSide: number, out: PickedPose & { dist: number }, tanH = LENS_TAN_H - 0.08, frac = 0.6,
): boolean {
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const sep = Math.hypot(bx - ax, bz - az);
  const axis = Math.atan2(bx - ax, bz - az);
  const need = (sep / 2 + 0.45) / (frac * tanH);
  const base = Math.max(minDist, need);
  const side0 = prefSide < 0 ? -1 : 1;
  for (let step = 0; step < POSE_RISE.length * 2; step++) {
    // each rung of the height ladder at the base distance, then pulled back ×1.4 (more room past props)
    const level = step >> 1;
    const h = height + POSE_RISE[level]!;
    const d = base * (1 + level * 0.12) * (step & 1 ? 1.4 : 1);
    for (let i = 0; i < TWO_OFFS.length; i++) {
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? side0 : -side0;
        const yaw = axis + side * Math.PI / 2 + TWO_OFFS[i]! * side;
        // off-perpendicular yaws shrink the lateral spread but add depth: keep the same distance
        const cx = mx + Math.sin(yaw) * d, cz = mz + Math.cos(yaw) * d;
        if (poseClean(cx, h, cz, ax, headY, az) && poseClean(cx, h, cz, bx, headY, bz)) {
          out.x = cx; out.y = h; out.z = cz; out.yaw = yaw; out.rel = side; out.level = level; out.dist = d;
          return true;
        }
      }
    }
  }
  // nothing clean: still a two-shot (both subjects in frame matter most) — high and pulled back on the
  // preferred side, where props sit low in the frame
  const lvl = POSE_RISE.length - 1, d = base * (1 + lvl * 0.12) * 1.4, yaw = axis + side0 * Math.PI / 2;
  out.x = mx + Math.sin(yaw) * d; out.y = height + POSE_RISE[lvl]!; out.z = mz + Math.cos(yaw) * d;
  out.yaw = yaw; out.rel = side0; out.level = lvl; out.dist = d;
  return false;
}
const TWO_OFFS = [0, 0.28, -0.28, 0.5, -0.5, 0.75, -0.75];

/* ------------------------------------------------------------ view fits */

export interface ViewFit { x: number; y: number; z: number; depth: number }

/**
 * Exact perspective fit of a point set for a FIXED view direction `back` (unit vector from the scene
 * towards the camera): the camera position C minimising the distance such that every point projects
 * inside NDC ±`ndc` on both axes. In the camera basis (right r, up u, back b) a point p is inside when
 * |p·r − C·r| ≤ ndc·tanH·(C·b − p·b) (same for u/tanV) — linear in C, so the optimum is closed-form:
 * C·b ≥ (max(p·r + kH p·b) − min(p·r − kH p·b)) / 2kH and C·r is the midpoint (likewise for up).
 * `minDepth` keeps the camera at least that far from the points' mid-depth (subjects never fill the frame).
 * `pts` holds xyz triples; n = number of points. Allocation-free.
 */
export function fitPointsToView(
  pts: ArrayLike<number>, n: number, bx: number, by: number, bz: number,
  tanV: number, aspect: number, ndc: number, minDepth: number, nearPad: number, out: ViewFit,
  /** top of the vertical band (NDC, default `ndc`): lower keeps a top safe area free for speech bubbles */
  ndcTop = ndc,
): ViewFit {
  // basis: right = normalize(up × back), up' = back × right
  let rx = bz, rz = -bx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = by * rz, uy = bz * rx - bx * rz, uz = -by * rx;
  const kV = ndc * tanV, kT = ndcTop * tanV, kH = ndc * tanV * Math.max(0.1, aspect);
  let A = -Infinity, B = Infinity, Au = -Infinity, Bu = Infinity, bMax = -Infinity, bMin = Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!;
    const pr = x * rx + z * rz, pu = x * ux + y * uy + z * uz, pb = x * bx + y * by + z * bz;
    A = Math.max(A, pr + kH * pb); B = Math.min(B, pr - kH * pb);
    // band: −kV·depth ≤ (p − C)·u ≤ kT·depth
    Au = Math.max(Au, pu + kT * pb); Bu = Math.min(Bu, pu - kV * pb);
    bMax = Math.max(bMax, pb); bMin = Math.min(bMin, pb);
  }
  if (n === 0) { out.x = 0; out.y = 0; out.z = 0; out.depth = 0; return out; }
  const cb = Math.max((A - B) / (2 * kH), (Au - Bu) / (kT + kV), bMax + nearPad, (bMax + bMin) / 2 + minDepth);
  // up: midpoint of the feasible interval [Au − kT·cb, Bu + kV·cb]
  const cr = (A + B) / 2, cu = (Au + Bu) / 2 + (kV - kT) * cb / 2;
  out.x = cr * rx + cu * ux + cb * bx;
  out.y = cu * uy + cb * by;
  out.z = cr * rz + cu * uz + cb * bz;
  out.depth = cb - (bMax + bMin) / 2;
  return out;
}

/**
 * How far the camera at (cx,cy,cz) must move back along `back` (unit, camera looks along −back) so
 * every point projects inside NDC ±ndc. 0 when they already fit. Allocation-free.
 */
export function pushBackToFit(
  pts: ArrayLike<number>, n: number, cx: number, cy: number, cz: number, bx: number, by: number, bz: number,
  tanV: number, aspect: number, ndc: number, nearPad: number, ndcTop = ndc,
): number {
  let rx = bz, rz = -bx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = by * rz, uy = bz * rx - bx * rz, uz = -by * rx;
  const kV = ndc * tanV, kT = ndcTop * tanV, kH = ndc * tanV * Math.max(0.1, aspect);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 3]! - cx, py = pts[i * 3 + 1]! - cy, pz = pts[i * 3 + 2]! - cz;
    const depth = -(px * bx + py * by + pz * bz);
    const lr = Math.abs(px * rx + pz * rz), lu = px * ux + py * uy + pz * uz;
    s = Math.max(s, lr / kH - depth, (lu > 0 ? lu / kT : -lu / kV) - depth, nearPad - depth);
  }
  return s;
}

/** Projected height (px) of a vertical segment of `h` metres at camera depth `depth` (viewport `vpH` px, vertical fov tangent tanV). */
export const projectedPx = (h: number, depth: number, tanV: number, vpH: number) => (h / (2 * depth * tanV)) * vpH;

/* ------------------------------------------------------ two-beat event shots */

/**
 * Two-beat shot for targeted events (gift / social / wave): open on the actor (front three-quarter),
 * follow the approach, cut to a two-shot as soon as the pair is within `range` (after at least `minActor`
 * s on the actor, so the giver always registers), and hold it `hold` s once both are in frame. A pair that
 * never gets close (no progress for `stall` s, or `maxApproach` s elapsed) still ends on a two-shot — a
 * wide one (`wide`) that keeps both in frame. A pair already within range opens straight on the two-shot.
 * Pure and allocation-free: the rig feeds the rendered separation and an in-frame flag every frame.
 */
export type BeatPhase = 'actor' | 'two' | 'done';
export interface TwoBeat { phase: BeatPhase; start: number; phaseAt: number; inFrameAt: number; bestSep: number; progressAt: number; wide: boolean }
export const TWO_BEAT = { range: 10, minActor: 1.5, maxApproach: 7.5, stall: 2.2, hold: 2.4, giveUp: 4 } as const;
export const newTwoBeat = (): TwoBeat => ({ phase: 'done', start: 0, phaseAt: 0, inFrameAt: NaN, bestSep: Infinity, progressAt: 0, wide: false });

export function startTwoBeat(b: TwoBeat, t: number, sep: number): BeatPhase {
  b.start = t; b.phaseAt = t; b.inFrameAt = NaN; b.bestSep = sep; b.progressAt = t; b.wide = false;
  b.phase = sep <= TWO_BEAT.range ? 'two' : 'actor';
  return b.phase;
}

export function stepTwoBeat(b: TwoBeat, t: number, sep: number, bothInFrame: boolean): BeatPhase {
  if (b.phase === 'actor') {
    if (sep < b.bestSep - 0.4) { b.bestSep = sep; b.progressAt = t; }
    const age = t - b.phaseAt;
    const close = sep <= TWO_BEAT.range;
    if ((close && age >= TWO_BEAT.minActor) || age >= TWO_BEAT.maxApproach || (age >= TWO_BEAT.minActor + 0.5 && t - b.progressAt >= TWO_BEAT.stall)) {
      b.phase = 'two'; b.phaseAt = t; b.inFrameAt = NaN; b.wide = !close;
    }
    return b.phase;
  }
  if (b.phase === 'two') {
    if (b.wide && sep <= TWO_BEAT.range) b.wide = false; // they met during the wide shot: tighten
    if (bothInFrame && Number.isNaN(b.inFrameAt)) b.inFrameAt = t;
    if (!Number.isNaN(b.inFrameAt) ? t - b.inFrameAt >= TWO_BEAT.hold : t - b.phaseAt >= TWO_BEAT.giveUp) b.phase = 'done';
  }
  return b.phase;
}

/* ------------------------------------------------------------ framing guard */

export interface V3 { x: number; y: number; z: number }

/** NDC of point p for a camera at c looking at l (vertical half-fov tangent tanV); out.z = depth (≤ 0 behind). */
export function projectNdc(c: V3, l: V3, px: number, py: number, pz: number, tanV: number, aspect: number, out: V3): V3 {
  let fx = l.x - c.x, fy = l.y - c.y, fz = l.z - c.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // right = f × up(0,1,0) = (−fz, 0, fx); up' = right × f
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
  const depth = dx * fx + dy * fy + dz * fz;
  const d = Math.max(1e-4, depth);
  out.x = (dx * rx + dz * rz) / (d * tanV * aspect);
  out.y = (dx * ux + dy * uy + dz * uz) / (d * tanV);
  out.z = depth;
  return out;
}

const _g = { x: 0, y: 0, z: 0 };
const ndcOut = (c: V3, l: V3, sx: number, y: number, sz: number, tanV: number, aspect: number, lim: number) => {
  projectNdc(c, l, sx, y, sz, tanV, aspect, _g);
  return _g.z < 0.5 || Math.abs(_g.x) > lim || Math.abs(_g.y) > lim;
};

/**
 * Follow framing guard: project the subject's head and feet from the solved pose (pos → look); when
 * either falls outside ±`lim` NDC, aim at the subject itself (drop the look-ahead), then pull back /
 * raise until both are inside. Also enforces a minimum down-angle (seated subjects behind bench backs,
 * signs, low walls). Mutates pos/look. Returns 0 = untouched, 1 = re-aimed, 2 = re-aimed + moved.
 */
export function guardFraming(
  pos: V3, look: V3, sx: number, sz: number, headY: number, tanV: number, aspect: number,
  lim = 0.8, minDown = (12 * Math.PI) / 180,
): number {
  let code = 0;
  const midY = Math.min(1.1, headY * 0.62);
  // minimum down-angle towards the subject
  const hd = Math.hypot(pos.x - sx, pos.z - sz) || 1e-3;
  if ((pos.y - midY) / hd < Math.tan(minDown)) { pos.y = midY + hd * Math.tan(minDown); code = 2; }
  const bad = () => ndcOut(pos, look, sx, headY, sz, tanV, aspect, lim) || ndcOut(pos, look, sx, 0.05, sz, tanV, aspect, lim);
  if (!bad()) return code;
  look.x = sx; look.y = midY; look.z = sz; code = Math.max(code, 1);
  for (let i = 0; i < 6 && bad(); i++) {
    // too big in frame (or behind the lens): pull back along the horizontal ray, keep the down-angle
    let dx = pos.x - sx, dz = pos.z - sz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nl = Math.max(l * 1.25, 2.5);
    pos.x = sx + dx * nl; pos.z = sz + dz * nl; pos.y = midY + (pos.y - midY) * (nl / l);
    code = 2;
  }
  return code;
}
