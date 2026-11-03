/**
 * Label occlusion (Node-safe, allocation-free): is the sight line camera → nameplate anchor (or
 * camera → head) blocked by solid scenery? Nameplates draw without depth testing (so lamp posts and
 * umbrellas never cut names), so the layer hides a label whose anchor or head sits behind something big:
 *  - buildings (layout boxes, slightly shrunk so labels at a wall corner stay),
 *  - the plaza fountain (basin, column + lower bowl with its water sheet, upper tier),
 *  - the dance stage (platform + speaker stacks),
 *  - the raid portal (stone ring + swirl disc, side pillars),
 *  - tagged town props from `getCameraProps()` (tree canopies with their `minY` band, umbrellas,
 *    planters …). Thin props (lamp posts, stage poles: r < THIN_PROP_RADIUS) are ignored.
 */
import { BUILDINGS, getPoi } from '../world/layout';
import type { CameraProp } from '../scene/cameraPose';

export type LabelOccluder =
  /** Yaw-rotated box: centre, cos/sin of yaw, half extents, vertical band. */
  | { kind: 'box'; x: number; z: number; c: number; s: number; hw: number; hd: number; y0: number; y1: number }
  /** Vertical cylinder: centre, radius, vertical band. */
  | { kind: 'cyl'; x: number; z: number; r: number; y0: number; y1: number }
  /** Vertical disc facing ±Z (portal ring): centre, radius, half thickness along Z. */
  | { kind: 'disc'; x: number; y: number; z: number; r: number; ht: number };

/** Props thinner than this (lamp posts r 0.3, stage poles r 0.2) never hide a label. */
export const THIN_PROP_RADIUS = 0.45;
/** Tagged props are slightly shrunk (canopy blobs are irregular; no hiding at the very rim). */
const PROP_RADIUS_SCALE = 0.9;
/** Canopy band default for big props published without `minY` (trees: canopy starts ≈ ¼ of the height). */
const DEFAULT_CANOPY_FRACTION = 0.25;

function stageOccluders(): LabelOccluder[] {
  const st = getPoi('stage')?.position;
  if (!st) return [];
  const yaw = Math.atan2(-st.x, -st.z); // local +Z faces the plaza (same as scene/town.ts buildStage)
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const out: LabelOccluder[] = [{ kind: 'cyl', x: st.x, z: st.z, r: 2.82, y0: 0, y1: 0.44 }];
  for (const side of [-1, 1]) {
    const lx = side * 1.45, lz = -1.85; // speaker stacks (0.7 × 1.05 × 0.55 on the platform)
    out.push({ kind: 'box', x: st.x + c * lx + s * lz, z: st.z - s * lx + c * lz, c, s, hw: 0.35, hd: 0.28, y0: 0.44, y1: 1.5 });
  }
  return out;
}

/** The raid portal: stone ring (radius ≈ 2.63, grows during raids) with the swirl disc, and its two pillars. */
export function portalOccluders(): LabelOccluder[] {
  const p = getPoi('portal')?.position;
  if (!p) return [];
  return [
    { kind: 'disc', x: p.x, y: 2.65, z: p.z, r: 2.7, ht: 0.5 },
    { kind: 'box', x: p.x - 2.55, z: p.z, c: 1, s: 0, hw: 0.45, hd: 0.5, y0: 0.3, y1: 2.4 },
    { kind: 'box', x: p.x + 2.55, z: p.z, c: 1, s: 0, hw: 0.45, hd: 0.5, y0: 0.3, y1: 2.4 },
  ];
}

/** Static scenery of the full world view (not the transparent overlay, which draws none of it). */
export const WORLD_LABEL_OCCLUDERS: readonly LabelOccluder[] = (() => {
  const out: LabelOccluder[] = [];
  for (const b of BUILDINGS) {
    // Inverse yaw so world → local is (dx·c − dz·s, dx·s + dz·c), as in the original building test.
    out.push({ kind: 'box', x: b.position.x, z: b.position.z, c: Math.cos(b.rotation), s: Math.sin(b.rotation),
      hw: Math.max(0.5, b.width / 2 - 0.15), hd: Math.max(0.5, b.depth / 2 - 0.15), y0: 0, y1: b.kind === 'arcade' ? 6 : 5.5 });
  }
  const f = getPoi('fountain')?.position ?? { x: 0, z: 0 };
  out.push({ kind: 'cyl', x: f.x, z: f.z, r: 2.3, y0: 0, y1: 0.62 });   // basin + rim
  out.push({ kind: 'cyl', x: f.x, z: f.z, r: 1.06, y0: 0.15, y1: 1.74 }); // column, lower bowl, falling water sheet
  out.push({ kind: 'cyl', x: f.x, z: f.z, r: 0.55, y0: 1.74, y1: 2.6 });  // upper column, small bowl, finial
  out.push(...stageOccluders());
  out.push(...portalOccluders());
  return out;
})();

/** Overlay mode: only the portal is ever drawn (while a raid is on). */
export const PORTAL_LABEL_OCCLUDERS: readonly LabelOccluder[] = portalOccluders();

/**
 * Segment a→b vs vertical cylinder; true when the part of the segment inside the footprint passes
 * through the [y0, y1] band before reaching b (b itself inside the band and footprint counts too).
 */
function hitsCylinder(ax: number, ay: number, az: number, bx: number, by: number, bz: number, x: number, z: number, r: number, y0: number, y1: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - x, fz = az - z;
  const A = dx * dx + dz * dz, C = fx * fx + fz * fz - r * r;
  let t0: number, t1: number;
  if (A < 1e-9) {
    if (C > 0) return false;
    t0 = 0; t1 = 1;
  } else {
    const B = 2 * (fx * dx + fz * dz);
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return false;
    const sq = Math.sqrt(disc);
    t0 = Math.max(0, (-B - sq) / (2 * A)); t1 = Math.min(1, (-B + sq) / (2 * A));
    if (t0 >= t1) return false;
  }
  const ya = ay + (by - ay) * t0, yb = ay + (by - ay) * t1;
  return Math.min(ya, yb) < y1 && Math.max(ya, yb) > y0;
}

/** Segment a→b vs yaw-rotated box (slab test in the box frame). */
function hitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Extract<LabelOccluder, { kind: 'box' }>): boolean {
  const ux = ax - o.x, uz = az - o.z, vx = bx - o.x, vz = bz - o.z;
  const p0x = ux * o.c - uz * o.s, p0z = ux * o.s + uz * o.c;
  const p1x = vx * o.c - vz * o.s, p1z = vx * o.s + vz * o.c;
  let t0 = 0, t1 = 1;
  // X slab
  let d = p1x - p0x;
  if (Math.abs(d) < 1e-9) { if (p0x < -o.hw || p0x > o.hw) return false; }
  else {
    let a = (-o.hw - p0x) / d, b = (o.hw - p0x) / d;
    if (a > b) { const q = a; a = b; b = q; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  // Z slab
  d = p1z - p0z;
  if (Math.abs(d) < 1e-9) { if (p0z < -o.hd || p0z > o.hd) return false; }
  else {
    let a = (-o.hd - p0z) / d, b = (o.hd - p0z) / d;
    if (a > b) { const q = a; a = b; b = q; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  // Y band
  d = by - ay;
  if (Math.abs(d) < 1e-9) return ay >= o.y0 && ay <= o.y1;
  let a = (o.y0 - ay) / d, b = (o.y1 - ay) / d;
  if (a > b) { const q = a; a = b; b = q; }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  return t0 <= t1;
}

/** Segment a→b crossing the plane z = o.z inside the disc radius (b standing in the ring itself: not hidden). */
function hitsDisc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Extract<LabelOccluder, { kind: 'disc' }>): boolean {
  if (Math.abs(bz - o.z) < o.ht) return false;
  const dz = bz - az;
  if (Math.abs(dz) < 1e-9) return false;
  const t = (o.z - az) / dz;
  if (t <= 0 || t >= 1) return false;
  const x = ax + (bx - ax) * t - o.x, y = ay + (by - ay) * t - o.y;
  return x * x + y * y < o.r * o.r;
}

/**
 * Is the sight line a (camera) → b (label anchor / head) blocked by `statics` or by any non-thin tagged
 * prop? Allocation-free; pass `props = null` to skip tagged props (overlay mode).
 */
export function labelSightBlocked(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  statics: readonly LabelOccluder[], props: ReadonlyArray<CameraProp> | null,
): boolean {
  for (let i = 0; i < statics.length; i++) {
    const o = statics[i]!;
    if (o.kind === 'cyl') { if (hitsCylinder(ax, ay, az, bx, by, bz, o.x, o.z, o.r, o.y0, o.y1)) return true; }
    else if (o.kind === 'box') { if (hitsBox(ax, ay, az, bx, by, bz, o)) return true; }
    else if (hitsDisc(ax, ay, az, bx, by, bz, o)) return true;
  }
  if (props) {
    // Cheap reject: props outside the segment's padded xz bounds.
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    for (let i = 0; i < props.length; i++) {
      const p = props[i]!;
      if (p.r < THIN_PROP_RADIUS) continue;
      const r = p.r * PROP_RADIUS_SCALE;
      if (p.x + r < minX || p.x - r > maxX || p.z + r < minZ || p.z - r > maxZ) continue;
      const y0 = p.minY ?? (p.r >= 1 ? p.h * DEFAULT_CANOPY_FRACTION : 0);
      if (hitsCylinder(ax, ay, az, bx, by, bz, p.x, p.z, r, y0, p.h)) return true;
    }
  }
  return false;
}
