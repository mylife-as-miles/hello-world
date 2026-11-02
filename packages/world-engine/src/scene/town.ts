/**
 * Procedural, data-driven town builder. Everything static is authored from
 * small crafted primitives and merged into a few vertex-coloured geometries:
 *   solid (casts shadows) · far (horizon, no shadows) · flat (ground decals) ·
 *   glass (windows, glow at night) · bulbs (lamps/neon, unlit).
 * Built from layout.ts (BUILDINGS, POIS, PATH_SEGMENTS, seats).
 */
import * as THREE from 'three';
import { BUILDINGS, POIS, PATH_SEGMENTS, PLAZA_RADIUS, getPoi, getNavNode, type BuildingDef, type Vec2 } from '../world/layout';
import { Batch, Prims, mtx, rng, noise2 } from './batch';

export interface SignDef {
  key: string;
  text: string;
  sub?: string;
  position: [number, number, number];
  rotationY: number;
  width: number;
  height: number;
  fg: string;
  bg: string | null;
  border?: string;
  glow?: string;
  /** Neon signs are unlit + brighten at night. */
  neon?: boolean;
}

export interface TownGeometry {
  solid: THREE.BufferGeometry;
  /** Small props (flowers, tufts, pebbles): lit + receive shadows but never cast (cheaper shadow pass). */
  detail: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  flat: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  bulbs: THREE.BufferGeometry;
  ground: THREE.BufferGeometry;
  lamps: THREE.Vector3[];
  chimneys: THREE.Vector3[];
  signs: SignDef[];
}

export const STAGE_POLE_HEIGHT = 3.45;
export const POND = { x: -15.2, z: -21.2, r: 2.7 };
export const PLAYGROUND_SWINGS = { x: -21.2, z: -8.2, yaw: 0.35 };

/* ------------------------------------------------------------------ space */

type Blocker = { x: number; z: number; r: number } | { x: number; z: number; hw: number; hd: number; rot: number };

class Space {
  segs: Array<{ a: Vec2; b: Vec2; hw: number }> = PATH_SEGMENTS.map(([a, b]) => ({ a, b, hw: 1.2 }));
  blockers: Blocker[] = [];
  circle(x: number, z: number, r: number) { this.blockers.push({ x, z, r }); }
  rect(x: number, z: number, hw: number, hd: number, rot: number) { this.blockers.push({ x, z, hw, hd, rot }); }
  pathDist(x: number, z: number): number {
    let best = Infinity;
    for (const s of this.segs) best = Math.min(best, segDist(x, z, s.a, s.b) - s.hw);
    return best;
  }
  free(x: number, z: number, clearance: number): boolean {
    if (this.pathDist(x, z) < clearance + 0.25) return false;
    for (const b of this.blockers) {
      if ('r' in b) { if (Math.hypot(x - b.x, z - b.z) < b.r + clearance) return false; }
      else {
        const dx = x - b.x, dz = z - b.z;
        const c = Math.cos(b.rot), s = Math.sin(b.rot);
        // world → local (inverse yaw)
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) < b.hw + clearance && Math.abs(lz) < b.hd + clearance) return false;
      }
    }
    return true;
  }
}

function segDist(x: number, z: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** Local building coords → world (yaw rotation about Y). */
function toWorld(b: { position: Vec2; rotation: number }, lx: number, lz: number): Vec2 {
  const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
  return { x: b.position.x + lx * c + lz * s, z: b.position.z - lx * s + lz * c };
}

/* --------------------------------------------------------------- palette */

interface HouseStyle {
  wall: string; roof: string; roofDark: string; trim: string; door: string; storeys: 1 | 2; pitch: number;
  chimney: boolean; porch: boolean; shutters: string | null; siding?: string; gable?: string; flowers: boolean;
}

const HOUSES: Record<number, HouseStyle> = {
  2: { wall: '#f4c9a3', roof: '#c95c46', roofDark: '#a3473a', trim: '#fff7ec', door: '#7b4a33', storeys: 1, pitch: 0.82, chimney: true, porch: true, shutters: '#8f5b3d', flowers: true },
  3: { wall: '#cfe6c7', roof: '#557399', roofDark: '#435c7d', trim: '#ffffff', door: '#e8a74f', storeys: 1, pitch: 1.1, chimney: true, porch: false, shutters: '#557399', flowers: true },
  4: { wall: '#f8e3ad', roof: '#7e503f', roofDark: '#633d30', trim: '#ffffff', door: '#3f749b', storeys: 2, pitch: 0.62, chimney: true, porch: true, shutters: null, siding: '#e9c98a', flowers: false },
  5: { wall: '#c7d8f1', roof: '#e07c63', roofDark: '#c0624c', trim: '#ffffff', door: '#f2c46e', storeys: 1, pitch: 0.78, chimney: false, porch: true, shutters: '#ffffff', flowers: true },
  6: { wall: '#f6f0e6', roof: '#405f86', roofDark: '#324b6b', trim: '#ffffff', door: '#c9493b', storeys: 2, pitch: 0.9, chimney: true, porch: false, shutters: '#405f86', gable: '#dcae7f', flowers: true },
};

const GLOW = ['#ffcf86', '#ffbf6e', '#ffe0a6', '#ffd497', '#ffc27a'];
const FLOWERS = ['#ff8fab', '#ffd166', '#f78c6b', '#ffffff', '#c792ea', '#ff6b6b', '#8ecae6'];
const LEAF = ['#6aa84f', '#78b55a', '#5e9e48', '#86c062'];
const CANOPY = ['#6fae4f', '#7dbb57', '#62a347', '#8cc463', '#5b9a45'];
const PINE = ['#3f7d4e', '#4a8a56', '#3a7448', '#568f5c'];

export interface TownOptions {
  /** Built-in forest belt, distant hills and rolling ground beyond the town (switch off when an external landscape is mounted). */
  horizon?: boolean;
  /** Trees rendered by another module (e.g. GeneratedTrees in Willow Park): kept clear of stylised trees/props. */
  reservedTrees?: ReadonlyArray<{ x: number; z: number; scale: number }>;
  /** Footprint test of an external district (lots/streets) so the forest belt never pierces it. */
  occupied?: (x: number, z: number, pad: number) => boolean;
}

interface Ctx {
  solid: Batch; detail: Batch; far: Batch; flat: Batch; glass: Batch; bulbs: Batch;
  P: Prims; r: () => number; space: Space; q: number;
  lamps: THREE.Vector3[]; chimneys: THREE.Vector3[]; signs: SignDef[];
}

const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length]!;
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

/* ------------------------------------------------------------- builders */

function addWindow(c: Ctx, M: THREE.Matrix4, ww: number, wh: number, trim: string, shutter: string | null, flowers: boolean) {
  const at = (m: THREE.Matrix4) => M.clone().multiply(m);
  c.solid.add(c.P.box(), trim, at(mtx(0, 0, 0.02, 0, ww + 0.2, wh + 0.2, 0.08)));
  c.glass.add(c.P.box(), c.r() < 0.18 ? '#6b5a48' : pick(c.r, GLOW), at(mtx(0, 0, 0.05, 0, ww, wh, 0.04)));
  c.solid.add(c.P.box(), trim, at(mtx(0, 0, 0.08, 0, 0.06, wh, 0.03)));
  c.solid.add(c.P.box(), trim, at(mtx(0, wh * 0.08, 0.08, 0, ww, 0.06, 0.03)));
  c.solid.add(c.P.box(), trim, at(mtx(0, -wh / 2 - 0.11, 0.1, 0, ww + 0.36, 0.08, 0.22)));
  if (shutter) for (const s of [-1, 1]) {
    c.solid.add(c.P.box(), shutter, at(mtx(s * (ww / 2 + 0.27), 0, 0.05, 0, 0.3, wh + 0.12, 0.05)));
    c.solid.add(c.P.box(), shade(shutter, 0.82), at(mtx(s * (ww / 2 + 0.27), 0, 0.08, 0, 0.2, 0.04, 0.02)));
  }
  if (flowers) {
    c.solid.add(c.P.rbox(ww + 0.12, 0.22, 0.26, 0.03), '#8b5a3c', at(mtx(0, -wh / 2 - 0.28, 0.2)));
    const n = Math.max(3, Math.round(ww * 4.5));
    for (let i = 0; i < n; i++) {
      const fx = -ww / 2 + 0.06 + (i / (n - 1)) * (ww - 0.12);
      c.detail.add(c.P.ico(0), pick(c.r, LEAF), at(mtx(fx, -wh / 2 - 0.14, 0.2, c.r() * 3, 0.13, 0.1, 0.12)), true);
      if (i % 2 === 0) c.detail.add(c.P.ico(0), pick(c.r, FLOWERS), at(mtx(fx + 0.02, -wh / 2 - 0.06, 0.24, c.r() * 3, 0.06, 0.06, 0.06)), true);
    }
  }
}

function addBush(c: Ctx, batch: Batch, x: number, z: number, s: number, flowers = false) {
  const col = pick(c.r, ['#5f9d47', '#6aa84f', '#4f8f43', '#74b257']);
  batch.add(c.P.blob(Math.floor(c.r() * 6), 0.2, 1), col, mtx(x, 0.32 * s, z, c.r() * 6, 0.62 * s, 0.5 * s, 0.58 * s), true);
  if (c.r() < 0.6) batch.add(c.P.blob(Math.floor(c.r() * 6), 0.2, 0), shade(col, 1.1), mtx(x + 0.35 * s, 0.24 * s, z + 0.15 * s, c.r() * 6, 0.38 * s, 0.32 * s, 0.36 * s), true);
  if (flowers) {
    const fc = pick(c.r, FLOWERS);
    for (let i = 0; i < 5; i++) {
      const a = c.r() * Math.PI * 2;
      batch.add(c.P.ico(0), fc, mtx(x + Math.cos(a) * 0.45 * s, 0.4 * s + c.r() * 0.25 * s, z + Math.sin(a) * 0.42 * s, 0, 0.07, 0.07, 0.07), true);
    }
  }
}

function addTree(c: Ctx, batch: Batch, x: number, z: number, kind: 'round' | 'pine' | 'birch' | 'blossom' | 'autumn', s: number, detail = 1, y0 = 0) {
  const r = c.r;
  if (y0 !== 0) {
    // Lift the whole tree onto the terrain via a wrapper batch transform.
    const sub = new Batch();
    addTree(c, sub, 0, 0, kind, s, detail, 0);
    const g = sub.build();
    batch.addColored(g, mtx(x, y0 - 0.1, z));
    g.dispose();
    return;
  }
  if (kind === 'pine') {
    batch.add(c.P.tcyl(0.7, 6), '#7a5236', mtx(x, 0.45 * s, z, 0, 0.17 * s, 0.9 * s, 0.17 * s));
    const col = pick(r, PINE);
    const tiers = [[1.35, 1.6, 1.25], [1.05, 1.45, 2.05], [0.72, 1.25, 2.8]] as const;
    tiers.forEach(([rad, h, y], i) => batch.add(c.P.cone(7), shade(col, 1 + i * 0.06), mtx(x, y * s, z, r() * 3, rad * s, h * s, rad * s), true));
    return;
  }
  const trunkCol = kind === 'birch' ? '#efe9de' : '#8b5e3c';
  const th = kind === 'birch' ? 1.9 : 1.45;
  batch.add(c.P.tcyl(0.72, 7), trunkCol, mtx(x, th * s * 0.5, z, 0, 0.15 * s, th * s, 0.15 * s));
  if (kind === 'birch') for (let i = 0; i < 3; i++) batch.add(c.P.box(), '#4a4038', mtx(x, (0.4 + i * 0.45) * s, z, r() * 3, 0.31 * s, 0.04 * s, 0.31 * s));
  const palette = kind === 'blossom' ? ['#f6a8c0', '#f9bfd1', '#f290ae'] : kind === 'autumn' ? ['#eba340', '#f0b754', '#e48a3a'] : kind === 'birch' ? ['#a9d36d', '#b6da7a', '#9cc95f'] : CANOPY;
  const col = pick(r, palette);
  const top = th * s;
  batch.add(c.P.blob(Math.floor(r() * 8), 0.2, detail), col, mtx(x, top + 0.75 * s, z, r() * 6, 1.25 * s, 1.08 * s, 1.2 * s), true);
  batch.add(c.P.blob(Math.floor(r() * 8), 0.22, detail), shade(col, 1.08), mtx(x + 0.55 * s, top + 0.35 * s, z + 0.3 * s, r() * 6, 0.85 * s, 0.75 * s, 0.8 * s), true);
  batch.add(c.P.blob(Math.floor(r() * 8), 0.22, detail), shade(col, 0.92), mtx(x - 0.5 * s, top + 1.25 * s, z - 0.2 * s, r() * 6, 0.72 * s, 0.66 * s, 0.7 * s), true);
}

function addWillow(c: Ctx, x: number, z: number, s: number) {
  const b = c.solid;
  b.add(c.P.tcyl(0.65, 8), '#7d5a3e', mtx(x, 1.1 * s, z, 0, 0.24 * s, 2.2 * s, 0.24 * s));
  const col = '#8fc46b';
  b.add(c.P.blob(3, 0.18, 1), col, mtx(x, 2.75 * s, z, 0, 1.7 * s, 0.95 * s, 1.7 * s), true);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + c.r() * 0.3;
    const rr = 1.45 * s;
    const len = (1.7 + c.r() * 0.7) * s;
    b.add(c.P.cone(5), shade(col, 0.9 + c.r() * 0.2), mtx(x + Math.cos(a) * rr, 2.55 * s - len / 2, z + Math.sin(a) * rr, a, 0.42 * s, len, 0.32 * s, Math.PI), true);
  }
}

function addBench(c: Ctx, x: number, z: number, yaw: number, len: number) {
  const M = mtx(x, 0, z, yaw);
  const at = (m: THREE.Matrix4) => M.clone().multiply(m);
  // seat surface top at exactly y = 0.45 (animator seats hips there)
  for (let i = 0; i < 3; i++) c.solid.add(c.P.rbox(len, 0.05, 0.13, 0.02), '#c08752', at(mtx(0, 0.425, -0.13 + i * 0.14)));
  for (let i = 0; i < 2; i++) c.solid.add(c.P.rbox(len, 0.12, 0.04, 0.02), '#c08752', at(mtx(0, 0.68 + i * 0.17, -0.27, 0, 1, 1, 1, -0.12)));
  for (const s of [-1, 1]) {
    c.solid.add(c.P.box(), '#3b3f3c', at(mtx(s * (len / 2 - 0.12), 0.2, -0.02, 0, 0.06, 0.4, 0.42)));
    c.solid.add(c.P.box(), '#3b3f3c', at(mtx(s * (len / 2 - 0.12), 0.62, -0.28, 0, 0.06, 0.5, 0.05, -0.12)));
    c.solid.add(c.P.box(), '#3b3f3c', at(mtx(s * (len / 2 - 0.12), 0.6, 0.0, 0, 0.06, 0.05, 0.42)));
  }
}

function addChair(c: Ctx, x: number, z: number, yaw: number, color: string) {
  const M = mtx(x, 0, z, yaw);
  const at = (m: THREE.Matrix4) => M.clone().multiply(m);
  c.solid.add(c.P.rbox(0.46, 0.06, 0.44, 0.02), color, at(mtx(0, 0.42, 0))); // seat top at y = 0.45
  c.solid.add(c.P.rbox(0.46, 0.46, 0.05, 0.02), color, at(mtx(0, 0.74, -0.2, 0, 1, 1, 1, -0.08)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.solid.add(c.P.box(), '#3d3a36', at(mtx(sx * 0.19, 0.2, sz * 0.18, 0, 0.04, 0.4, 0.04)));
}

function addLamp(c: Ctx, x: number, z: number) {
  const col = '#2f3d3b';
  c.solid.add(c.P.cyl(10), col, mtx(x, 0.16, z, 0, 0.18, 0.32, 0.18));
  c.solid.add(c.P.tcyl(0.65, 8), col, mtx(x, 1.75, z, 0, 0.07, 3.0, 0.07));
  c.solid.add(c.P.box(), col, mtx(x, 3.2, z, Math.PI / 4, 0.34, 0.06, 0.34));
  c.solid.add(c.P.cone(4), col, mtx(x, 3.78, z, Math.PI / 4, 0.32, 0.26, 0.32));
  for (const [dx, dz] of [[0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]] as const) c.solid.add(c.P.box(), col, mtx(x + dx, 3.44, z + dz, Math.PI / 4, 0.03, 0.44, 0.03));
  c.solid.add(c.P.sphere(8, 6), '#d9b25f', mtx(x, 3.95, z, 0, 0.05, 0.05, 0.05));
  c.bulbs.add(c.P.sphere(10, 8), '#ffd79a', mtx(x, 3.44, z, 0, 0.12, 0.17, 0.12));
  c.lamps.push(new THREE.Vector3(x, 3.44, z));
  c.space.circle(x, z, 0.35);
}

function pathStrip(batch: Batch, P: Prims, a: Vec2, b: Vec2, hw: number, y: number, h: number, color: string) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  if (L < 0.01) return;
  batch.add(P.box(), color, mtx((a.x + b.x) / 2, y, (a.z + b.z) / 2, -Math.atan2(dz, dx), L, h, hw * 2));
}

function buildHouse(c: Ctx, b: BuildingDef) {
  const st = HOUSES[b.palette] ?? HOUSES[2]!;
  const base = mtx(b.position.x, 0, b.position.z, b.rotation);
  const at = (m: THREE.Matrix4) => base.clone().multiply(m);
  const w = b.width, d = b.depth, F = 0.35;
  const H = st.storeys === 2 ? 4.9 : 2.75;
  const yT = F + H;
  c.space.rect(b.position.x, b.position.z, w / 2 + 0.4, d / 2 + 0.4, b.rotation);

  c.solid.add(c.P.rbox(w + 0.34, F, d + 0.34, 0.05), '#b9b2a6', at(mtx(0, F / 2, 0)));
  c.solid.add(c.P.rbox(w, H, d, 0.06), st.wall, at(mtx(0, F + H / 2, 0)));
  if (st.siding) c.solid.add(c.P.box(), st.siding, at(mtx(0, F + 1.1, 0, 0, w + 0.04, 2.2, d + 0.04)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.solid.add(c.P.box(), st.trim, at(mtx(sx * (w / 2), F + H / 2, sz * (d / 2), 0, 0.2, H, 0.2)));
  if (st.storeys === 2) c.solid.add(c.P.box(), st.trim, at(mtx(0, F + 2.5, 0, 0, w + 0.1, 0.14, d + 0.1)));
  c.solid.add(c.P.box(), st.trim, at(mtx(0, yT - 0.06, 0, 0, w + 0.12, 0.12, d + 0.12)));

  // Gable roof (ridge along local X)
  const rise = (d / 2) * st.pitch;
  const a = Math.atan2(rise, d / 2);
  const oh = 0.45, ohx = 0.38, th = 0.17;
  const run = d / 2 + oh;
  const Ls = run / Math.cos(a);
  for (const s of [-1, 1]) {
    const yc = yT + rise - (run / 2) * Math.tan(a) + (th / 2) / Math.cos(a);
    c.solid.add(c.P.box(), st.roof, at(mtx(0, yc, s * run / 2, 0, w + ohx * 2, th, Ls, s * a)));
    // shingle rows
    for (let k = 1; k < 4; k++) {
      const f = k / 4;
      const zz = s * run * f;
      const yy = yT + rise - run * f * Math.tan(a) + th / Math.cos(a) + 0.005;
      c.solid.add(c.P.box(), st.roofDark, at(mtx(0, yy, zz, 0, w + ohx * 2 + 0.02, 0.035, 0.07, s * a)));
    }
    c.solid.add(c.P.box(), st.trim, at(mtx(0, yT - oh * Math.tan(a) + 0.03, s * (run - 0.03), 0, w + ohx * 2 + 0.04, 0.15, 0.07)));
  }
  c.solid.add(c.P.prism(), st.gable ?? st.wall, at(mtx(0, yT, 0, 0, w, rise, d)));
  c.solid.add(c.P.box(), st.roofDark, at(mtx(0, yT + rise + th / Math.cos(a) - 0.02, 0, 0, w + ohx * 2 + 0.08, 0.15, 0.32)));
  // gable vent / round window
  for (const sx of [-1, 1]) c.glass.add(c.P.cyl(12), pick(c.r, GLOW), at(mtx(sx * (w / 2 + 0.02), yT + rise * 0.38, 0, 0, 0.05, 1, 0.05, 0, Math.PI / 2).multiply(mtx(0, 0, 0, 0, Math.min(0.32, rise * 0.25), 1, Math.min(0.32, rise * 0.25)))));

  if (st.chimney) {
    const cz = -d * 0.2, cx = w * 0.27;
    const roofY = yT + rise - Math.abs(cz) * Math.tan(a);
    const top = yT + rise + 0.8;
    const bottom = roofY - 0.3;
    c.solid.add(c.P.rbox(0.62, top - bottom, 0.62, 0.04), '#b0604c', at(mtx(cx, (top + bottom) / 2, cz)));
    c.solid.add(c.P.box(), '#5d5a57', at(mtx(cx, top + 0.06, cz, 0, 0.8, 0.12, 0.8)));
    const wp = toWorld(b, cx, cz);
    c.chimneys.push(new THREE.Vector3(wp.x, top + 0.15, wp.z));
  }

  // Door
  const fz = d / 2;
  c.solid.add(c.P.box(), st.trim, at(mtx(0, F + 1.06, fz + 0.03, 0, 1.3, 2.18, 0.1)));
  c.solid.add(c.P.rbox(1.02, 2.0, 0.1, 0.03), st.door, at(mtx(0, F + 1.0, fz + 0.08)));
  for (const s of [-1, 1]) c.solid.add(c.P.box(), shade(st.door, 0.84), at(mtx(s * 0.22, F + 0.55, fz + 0.135, 0, 0.34, 0.7, 0.02)));
  c.glass.add(c.P.box(), pick(c.r, GLOW), at(mtx(0, F + 1.55, fz + 0.135, 0, 0.62, 0.42, 0.03)));
  c.solid.add(c.P.sphere(8, 6), '#e2b85c', at(mtx(0.36, F + 1.0, fz + 0.16, 0, 0.055, 0.055, 0.055)));
  c.bulbs.add(c.P.sphere(8, 6), '#ffd79a', at(mtx(0.9, F + 1.95, fz + 0.16, 0, 0.09, 0.12, 0.09)));
  c.solid.add(c.P.box(), '#3a3330', at(mtx(0.9, F + 1.95, fz + 0.06, 0, 0.12, 0.2, 0.1)));

  let frontEdge = fz + 0.6;
  if (st.porch) {
    const pw = Math.min(w * 0.62, 3.6), pd = 1.6;
    c.solid.add(c.P.rbox(pw, 0.32, pd, 0.04), '#c99a6b', at(mtx(0, 0.16, fz + pd / 2)));
    for (let i = 1; i < 7; i++) c.solid.add(c.P.box(), '#b0835a', at(mtx(-pw / 2 + (i * pw) / 7, 0.322, fz + pd / 2, 0, 0.025, 0.01, pd - 0.06)));
    c.solid.add(c.P.rbox(1.3, 0.16, 0.45, 0.03), '#b9b2a6', at(mtx(0, 0.08, fz + pd + 0.2)));
    const roofY = st.storeys === 2 ? 2.85 : 2.5;
    for (const sx of [-1, 1]) {
      c.solid.add(c.P.box(), st.trim, at(mtx(sx * (pw / 2 - 0.1), 0.32 + (roofY - 0.32) / 2, fz + pd - 0.1, 0, 0.14, roofY - 0.32, 0.14)));
      c.solid.add(c.P.box(), st.trim, at(mtx(sx * (pw / 2 - 0.1), 0.86, fz + pd / 2, 0, 0.06, 0.06, pd - 0.2)));
      for (let i = 0; i < 4; i++) c.solid.add(c.P.box(), st.trim, at(mtx(sx * (pw / 2 - 0.1), 0.59, fz + 0.25 + (i * (pd - 0.45)) / 3, 0, 0.05, 0.54, 0.05)));
    }
    c.solid.add(c.P.rbox(pw + 0.45, 0.12, pd + 0.4, 0.03), st.roof, at(mtx(0, roofY + 0.1, fz + (pd + 0.4) / 2, 0, 1, 1, 1, 0.16)));
    frontEdge = fz + pd + 0.45;
  } else {
    c.solid.add(c.P.rbox(1.7, 0.1, 0.8, 0.03), st.roof, at(mtx(0, F + 2.35, fz + 0.4, 0, 1, 1, 1, 0.22)));
    for (const sx of [-1, 1]) c.solid.add(c.P.box(), st.trim, at(mtx(sx * 0.72, F + 2.12, fz + 0.2, 0, 0.06, 0.32, 0.36)));
    c.solid.add(c.P.rbox(1.6, 0.2, 0.6, 0.03), '#b9b2a6', at(mtx(0, 0.1, fz + 0.3)));
    c.solid.add(c.P.rbox(1.4, 0.16, 0.4, 0.03), '#b9b2a6', at(mtx(0, 0.28, fz + 0.2)));
  }

  // Windows on every face
  const faces: Array<{ M: (x: number, y: number) => THREE.Matrix4; span: number; door: boolean }> = [
    { M: (x, y) => at(mtx(x, y, fz)), span: w, door: true },
    { M: (x, y) => at(mtx(0, y, -fz, Math.PI)).multiply(mtx(x, 0, 0)), span: w, door: false },
    { M: (x, y) => at(mtx(w / 2, y, 0, Math.PI / 2)).multiply(mtx(x, 0, 0)), span: d, door: false },
    { M: (x, y) => at(mtx(-w / 2, y, 0, -Math.PI / 2)).multiply(mtx(x, 0, 0)), span: d, door: false },
  ];
  for (const f of faces) {
    const floors = st.storeys === 2 ? [F + 1.45, F + 3.75] : [F + 1.45];
    floors.forEach((y, fi) => {
      let xs: number[];
      if (f.door && fi === 0) xs = [-f.span * 0.3, f.span * 0.3];
      else if (f.span > 5.6 && fi === 1) xs = [-f.span * 0.3, 0, f.span * 0.3];
      else xs = f.span > 5 ? [-f.span * 0.24, f.span * 0.24] : [0];
      for (const x of xs) addWindow(c, f.M(x, y), 0.95, 1.05, st.trim, f.door || fi === 1 ? st.shutters : null, st.flowers && f.door && fi === 0);
    });
  }

  // Yard: bushes along the front wall, side flower beds
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const lx = sx * (w / 2 - 0.45 - i * 0.9);
      if (Math.abs(lx) < (st.porch ? 2.0 : 1.0)) continue;
      const p = toWorld(b, lx, fz + 0.62);
      addBush(c, c.solid, p.x, p.z, 0.75 + c.r() * 0.2, c.r() < 0.5);
    }
  }

  // Walkway: door → POI → nav node
  const poi = getPoi(b.poiId);
  const nav = poi ? getNavNode(poi.navNode) : undefined;
  const door = toWorld(b, 0, frontEdge);
  const pts: Vec2[] = [door];
  if (poi) pts.push(poi.position);
  if (nav) pts.push({ x: nav.x, z: nav.z });
  for (let i = 0; i < pts.length - 1; i++) {
    pathStrip(c.flat, c.P, pts[i]!, pts[i + 1]!, 0.72, 0.012, 0.03, '#cdb994');
    pathStrip(c.flat, c.P, pts[i]!, pts[i + 1]!, 0.55, 0.02, 0.03, '#e6d6b8');
    c.space.segs.push({ a: pts[i]!, b: pts[i + 1]!, hw: 0.75 });
  }
  // Mailbox next to the walkway near the street
  if (nav && poi) {
    const dx = nav.x - poi.position.x, dz = nav.z - poi.position.z;
    const L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    const mx = poi.position.x + ux * Math.min(1.4, L * 0.4) - uz * 1.05;
    const mz = poi.position.z + uz * Math.min(1.4, L * 0.4) + ux * 1.05;
    if (c.space.pathDist(mx, mz) > 0.1) {
      const yaw = Math.atan2(ux, uz);
      c.solid.add(c.P.box(), '#7b5a3c', mtx(mx, 0.55, mz, yaw, 0.09, 1.1, 0.09));
      c.solid.add(c.P.rbox(0.34, 0.3, 0.5, 0.08), st.roof, mtx(mx, 1.2, mz, yaw));
      c.solid.add(c.P.box(), '#e04f3f', mtx(mx + 0.19 * Math.cos(yaw), 1.32, mz - 0.19 * Math.sin(yaw), yaw, 0.03, 0.2, 0.06));
      c.space.circle(mx, mz, 0.4);
    }
  }
  // Picket fence around the front yard (skips anything near paths)
  const fenceZ = fz + 3.3;
  const pickets: Array<[number, number]> = [];
  for (let lx = -w / 2 - 0.9; lx <= w / 2 + 0.9; lx += 0.32) pickets.push([lx, fenceZ]);
  for (let lz = fz + 0.4; lz < fenceZ; lz += 0.32) { pickets.push([-w / 2 - 0.9, lz]); pickets.push([w / 2 + 0.9, lz]); }
  for (const [lx, lz] of pickets) {
    const p = toWorld(b, lx, lz);
    if (c.space.pathDist(p.x, p.z) < 0.35) continue;
    c.solid.add(c.P.box(), '#fbf6ee', mtx(p.x, 0.42, p.z, b.rotation, 0.08, 0.84, 0.05));
    c.solid.add(c.P.cone(4), '#fbf6ee', mtx(p.x, 0.9, p.z, b.rotation + Math.PI / 4, 0.06, 0.12, 0.06));
    c.solid.add(c.P.box(), '#efe7da', mtx(p.x, 0.62, p.z, b.rotation + (Math.abs(lz - fenceZ) < 0.01 ? 0 : Math.PI / 2), 0.34, 0.06, 0.03));
  }
  const yard = toWorld(b, 0, (fz + fenceZ) / 2);
  c.space.rect(yard.x, yard.z, w / 2 + 1.0, (fenceZ - fz) / 2 + 0.1, b.rotation);
}

function flatRoofBox(c: Ctx, at: (m: THREE.Matrix4) => THREE.Matrix4, w: number, d: number, yT: number, parapet: string, roof: string) {
  c.solid.add(c.P.box(), roof, at(mtx(0, yT + 0.05, 0, 0, w + 0.1, 0.1, d + 0.1)));
  for (const s of [-1, 1]) {
    c.solid.add(c.P.box(), parapet, at(mtx(0, yT + 0.25, s * (d / 2 + 0.06), 0, w + 0.32, 0.5, 0.2)));
    c.solid.add(c.P.box(), parapet, at(mtx(s * (w / 2 + 0.06), yT + 0.25, 0, 0, 0.2, 0.5, d + 0.32)));
  }
}

function buildCafe(c: Ctx, b: BuildingDef) {
  const base = mtx(b.position.x, 0, b.position.z, b.rotation);
  const at = (m: THREE.Matrix4) => base.clone().multiply(m);
  const w = b.width, d = b.depth, F = 0.3, H = 3.7, yT = F + H, fz = d / 2;
  c.space.rect(b.position.x, b.position.z, w / 2 + 0.5, d / 2 + 0.5, b.rotation);
  c.solid.add(c.P.rbox(w + 0.3, F, d + 0.3, 0.05), '#b8ad9e', at(mtx(0, F / 2, 0)));
  c.solid.add(c.P.rbox(w, H, d, 0.06), '#fde7c4', at(mtx(0, F + H / 2, 0)));
  c.solid.add(c.P.box(), '#c9715a', at(mtx(0, F + 0.45, 0, 0, w + 0.05, 0.9, d + 0.05)));
  c.solid.add(c.P.box(), '#fff6e6', at(mtx(0, F + 0.92, 0, 0, w + 0.09, 0.08, d + 0.09)));
  c.solid.add(c.P.box(), '#fff6e6', at(mtx(0, yT - 0.12, 0, 0, w + 0.22, 0.24, d + 0.22)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.solid.add(c.P.box(), '#fff6e6', at(mtx(sx * (w / 2), F + H / 2, sz * (d / 2), 0, 0.22, H, 0.22)));
  flatRoofBox(c, at, w, d, yT, '#e07b5f', '#a39686');
  // Door + shop windows
  c.solid.add(c.P.box(), '#6b4630', at(mtx(0, F + 1.25, fz + 0.03, 0, 1.9, 2.5, 0.1)));
  for (const s of [-1, 1]) c.glass.add(c.P.box(), '#ffd08a', at(mtx(s * 0.42, F + 1.15, fz + 0.07, 0, 0.72, 2.2, 0.04)));
  c.solid.add(c.P.box(), '#6b4630', at(mtx(0, F + 1.15, fz + 0.09, 0, 0.08, 2.2, 0.04)));
  for (const s of [-1, 1]) c.solid.add(c.P.box(), '#e2b85c', at(mtx(s * 0.12, F + 1.1, fz + 0.12, 0, 0.04, 0.4, 0.04)));
  for (const s of [-1, 1]) {
    const x = s * 2.25;
    c.solid.add(c.P.box(), '#6b4630', at(mtx(x, F + 1.8, fz + 0.03, 0, 2.3, 1.75, 0.1)));
    c.glass.add(c.P.box(), '#ffcd7d', at(mtx(x, F + 1.8, fz + 0.07, 0, 2.06, 1.5, 0.04)));
    c.solid.add(c.P.box(), '#6b4630', at(mtx(x, F + 1.8, fz + 0.095, 0, 0.06, 1.5, 0.04)));
    c.solid.add(c.P.box(), '#fff6e6', at(mtx(x, F + 0.98, fz + 0.12, 0, 2.4, 0.08, 0.26)));
    c.solid.add(c.P.rbox(2.0, 0.42, 0.42, 0.04), '#7a4f35', at(mtx(x, 0.21, fz + 0.4)));
    for (let i = 0; i < 7; i++) {
      c.detail.add(c.P.ico(0), pick(c.r, LEAF), at(mtx(x - 0.85 + i * 0.28, 0.5, fz + 0.4, c.r() * 3, 0.17, 0.14, 0.17)), true);
      if (i % 2 === 0) c.detail.add(c.P.ico(0), pick(c.r, FLOWERS), at(mtx(x - 0.85 + i * 0.28, 0.62, fz + 0.45, 0, 0.07, 0.07, 0.07)), true);
    }
  }
  // Striped awning with scalloped valance
  const aw = w + 0.3, ad = 1.5, drop = 0.5, ay = F + 2.9;
  const n = 13, sw = aw / n;
  const aa = Math.atan2(drop, ad), al = Math.hypot(drop, ad);
  for (let i = 0; i < n; i++) {
    const col = i % 2 ? '#fff3e0' : '#e8604f';
    const x = -aw / 2 + sw * (i + 0.5);
    c.solid.add(c.P.box(), col, at(mtx(x, ay - drop / 2, fz + ad / 2, 0, sw + 0.004, 0.06, al, aa)));
    c.solid.add(c.P.box(), col, at(mtx(x, ay - drop - 0.13, fz + ad + 0.01, 0, sw + 0.004, 0.26, 0.04)));
    c.solid.add(c.P.cyl(8), col, at(mtx(x, ay - drop - 0.26, fz + ad + 0.01, 0, sw / 2, 0.04, 0.025, Math.PI / 2)));
  }
  for (const s of [-1, 1]) c.solid.add(c.P.box(), '#3a3330', at(mtx(s * (aw / 2 - 0.1), ay - drop / 2 - 0.15, fz + ad / 2, 0, 0.04, 0.04, al, aa + 0.25)));
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = -aw / 2 + 0.25 + t * (aw - 0.5);
    const sag = 0.12 * Math.abs(Math.sin(t * Math.PI * 4));
    c.bulbs.add(c.P.sphere(8, 6), i % 3 === 0 ? '#ffb86b' : '#ffe0a0', at(mtx(x, ay - drop - 0.38 - sag, fz + ad + 0.05, 0, 0.06, 0.07, 0.06)));
  }
  // Sign board
  c.solid.add(c.P.rbox(4.5, 0.66, 0.12, 0.05), '#5a3a28', at(mtx(0, F + 3.33, fz + 0.06)));
  const sp = toWorld(b, 0, fz + 0.14);
  c.signs.push({ key: 'cafe', text: 'Sunbeam Café', position: [sp.x, F + 3.33, sp.z], rotationY: b.rotation, width: 4.2, height: 0.6, fg: '#ffe7b3', bg: null, glow: '#ffb347' });
  // Side + back windows
  for (const sx of [-1, 1]) for (const zz of [-1.25, 1.25]) addWindow(c, at(mtx(sx * w / 2, F + 1.95, zz, sx * Math.PI / 2)), 1.0, 1.15, '#fff6e6', null, false);
  for (const xx of [-2, 2]) addWindow(c, at(mtx(xx, F + 1.95, -fz, Math.PI)), 1.0, 1.15, '#fff6e6', null, false);
  // Rooftop details
  c.solid.add(c.P.rbox(0.9, 0.6, 0.9, 0.05), '#c2b8ab', at(mtx(1.9, yT + 0.4, -1.0)));
  c.solid.add(c.P.cyl(10), '#8d857b', at(mtx(-2.2, yT + 0.5, -1.2, 0, 0.18, 0.8, 0.18)));
  c.solid.add(c.P.rbox(1.6, 0.35, 0.5, 0.04), '#7a4f35', at(mtx(-0.6, yT + 0.25, 1.6)));
  for (let i = 0; i < 4; i++) {
    c.detail.add(c.P.blob(i, 0.22, 0), pick(c.r, LEAF), at(mtx(-1.2 + i * 0.4, yT + 0.52, 1.6, c.r() * 6, 0.22, 0.2, 0.22)), true);
    c.detail.add(c.P.ico(0), pick(c.r, FLOWERS), at(mtx(-1.15 + i * 0.4, yT + 0.68, 1.65, 0, 0.07, 0.07, 0.07)), true);
  }
  // Potted plants by the door + chalkboard
  for (const s of [-1, 1]) {
    const p = toWorld(b, s * 1.25, fz + 0.45);
    c.solid.add(c.P.tcyl(1.25, 10), '#c7684a', mtx(p.x, 0.27, p.z, 0, 0.26, 0.54, 0.26));
    c.solid.add(c.P.blob(2, 0.2, 1), '#5e9e48', mtx(p.x, 0.88, p.z, 0, 0.4, 0.52, 0.4), true);
  }
}

function buildTerrace(c: Ctx) {
  const cafe = getPoi('cafe');
  if (!cafe?.seats) return;
  const seats = cafe.seats;
  const minX = Math.min(...seats.map(s => s.x)) - 0.9, maxX = Math.max(...seats.map(s => s.x)) + 1.2;
  const minZ = Math.min(...seats.map(s => s.z)) - 1.2, maxZ = Math.max(...seats.map(s => s.z)) + 1.2;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  c.flat.add(c.P.box(), '#c9a074', mtx(cx, 0.04, cz, 0, maxX - minX, 0.08, maxZ - minZ));
  for (let x = minX + 0.42; x < maxX - 0.1; x += 0.42) c.flat.add(c.P.box(), '#b28659', mtx(x, 0.081, cz, 0, 0.025, 0.01, maxZ - minZ - 0.04));
  c.space.rect(cx, cz, (maxX - minX) / 2, (maxZ - minZ) / 2, 0);
  const umbrellas = ['#f2c14e', '#5fb3a1'];
  for (let i = 0; i + 1 < seats.length; i += 2) {
    const s1 = seats[i]!, s2 = seats[i + 1]!;
    const tx = (s1.x + s2.x) / 2, tz = (s1.z + s2.z) / 2;
    c.solid.add(c.P.cyl(14), '#fbf7ef', mtx(tx, 0.76, tz, 0, 0.55, 0.05, 0.55));
    c.solid.add(c.P.cyl(8), '#3d3a36', mtx(tx, 0.38, tz, 0, 0.05, 0.76, 0.05));
    c.solid.add(c.P.cyl(10), '#3d3a36', mtx(tx, 0.03, tz, 0, 0.3, 0.05, 0.3));
    c.solid.add(c.P.cyl(6), '#efe7da', mtx(tx, 1.55, tz, 0, 0.035, 1.6, 0.035));
    const col = umbrellas[(i / 2) % 2]!;
    c.solid.add(c.P.cone(8), col, mtx(tx, 2.48, tz, Math.PI / 8, 1.45, 0.5, 1.45), true);
    c.solid.add(c.P.cone(8), '#fff7ea', mtx(tx, 2.25, tz, Math.PI / 8, 1.46, 0.04, 1.46), true);
    c.solid.add(c.P.sphere(8, 6), '#efe7da', mtx(tx, 2.78, tz, 0, 0.07, 0.07, 0.07));
    // cups + plates on the table
    c.solid.add(c.P.cyl(8), '#ffffff', mtx(tx - 0.15, 0.83, tz + 0.1, 0, 0.06, 0.09, 0.06));
    c.solid.add(c.P.cyl(8), '#ffffff', mtx(tx + 0.17, 0.83, tz - 0.08, 0, 0.06, 0.09, 0.06));
    c.solid.add(c.P.cyl(10), '#f4d9b0', mtx(tx, 0.8, tz, 0, 0.13, 0.02, 0.13));
    addChair(c, s1.x, s1.z, s1.facing, '#4e8f7a');
    addChair(c, s2.x, s2.z, s2.facing, '#d9644f');
  }
  // Corner planters
  for (const [px, pz] of [[minX + 0.3, minZ + 0.3], [minX + 0.3, maxZ - 0.3]] as const) {
    c.solid.add(c.P.tcyl(1.2, 10), '#c7684a', mtx(px, 0.3, pz, 0, 0.3, 0.6, 0.3));
    addBush(c, c.solid, px, pz, 0.7, true);
  }
}

function buildArcade(c: Ctx, b: BuildingDef) {
  const base = mtx(b.position.x, 0, b.position.z, b.rotation);
  const at = (m: THREE.Matrix4) => base.clone().multiply(m);
  const w = b.width, d = b.depth, F = 0.3, H = 3.3, yT = F + H, fz = d / 2;
  c.space.rect(b.position.x, b.position.z, w / 2 + 0.5, d / 2 + 0.5, b.rotation);
  c.solid.add(c.P.rbox(w + 0.3, F, d + 0.3, 0.05), '#77708a', at(mtx(0, F / 2, 0)));
  c.solid.add(c.P.rbox(w, H, d, 0.06), '#6a55a3', at(mtx(0, F + H / 2, 0)));
  c.solid.add(c.P.box(), '#3d3166', at(mtx(0, F + 0.4, 0, 0, w + 0.05, 0.8, d + 0.05)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.solid.add(c.P.box(), '#3d3166', at(mtx(sx * (w / 2), F + H / 2, sz * (d / 2), 0, 0.22, H, 0.22)));
  flatRoofBox(c, at, w, d, yT, '#3d3166', '#4f456a');
  // Door + window
  c.solid.add(c.P.box(), '#241c3d', at(mtx(-0.6, F + 1.12, fz + 0.03, 0, 1.25, 2.3, 0.1)));
  c.glass.add(c.P.box(), '#57f0ff', at(mtx(-0.6, F + 1.08, fz + 0.07, 0, 1.0, 2.1, 0.04)));
  c.solid.add(c.P.box(), '#241c3d', at(mtx(1.5, F + 1.65, fz + 0.03, 0, 2.1, 1.55, 0.1)));
  c.glass.add(c.P.box(), '#ff70d6', at(mtx(1.5, F + 1.65, fz + 0.07, 0, 1.85, 1.3, 0.04)));
  // Neon strips
  c.bulbs.add(c.P.box(), '#ff4fa3', at(mtx(0, yT - 0.32, fz + 0.12, 0, w - 0.2, 0.07, 0.05)));
  c.bulbs.add(c.P.box(), '#46e6d8', at(mtx(0, yT + 0.5, fz + 0.18, 0, w + 0.3, 0.06, 0.05)));
  for (const sx of [-1, 1]) c.bulbs.add(c.P.box(), '#ffd84d', at(mtx(sx * (w / 2 + 0.12), F + H / 2, fz + 0.12, 0, 0.06, H - 0.3, 0.05)));
  // Rooftop marquee
  c.solid.add(c.P.rbox(4.8, 1.2, 0.2, 0.05), '#1e1733', at(mtx(0, yT + 1.15, fz - 0.2)));
  for (const sx of [-1, 1]) c.solid.add(c.P.box(), '#3d3166', at(mtx(sx * 1.9, yT + 0.4, fz - 0.45, 0, 0.12, 0.8, 0.5)));
  const sp = toWorld(b, 0, fz - 0.08);
  c.signs.push({ key: 'arcade', text: 'ARCADE', sub: '★ PIXEL ★', position: [sp.x, yT + 1.15, sp.z], rotationY: b.rotation, width: 4.5, height: 1.1, fg: '#ffe3f6', bg: null, glow: '#ff4fd8', neon: true });
  // Cabinets out front
  const cabs: Array<[number, string, string]> = [[-2.05, '#e94f64', '#7dffb2'], [2.1, '#3d7bf0', '#ffe066']];
  for (const [x, body, screen] of cabs) {
    const M = at(mtx(x, 0, fz + 0.75));
    const ab = (m: THREE.Matrix4) => M.clone().multiply(m);
    c.solid.add(c.P.rbox(0.72, 1.75, 0.66, 0.05), body, ab(mtx(0, 0.875, 0)));
    c.solid.add(c.P.box(), '#1d1a26', ab(mtx(0, 1.32, 0.31, 0, 0.6, 0.5, 0.06, -0.18)));
    c.glass.add(c.P.box(), screen, ab(mtx(0, 1.32, 0.345, 0, 0.5, 0.4, 0.03, -0.18)));
    c.solid.add(c.P.box(), '#1d1a26', ab(mtx(0, 0.98, 0.42, 0, 0.72, 0.08, 0.3)));
    c.solid.add(c.P.sphere(8, 6), '#ff4f4f', ab(mtx(-0.15, 1.1, 0.45, 0, 0.05, 0.05, 0.05)));
    c.solid.add(c.P.cyl(6), '#1d1a26', ab(mtx(-0.15, 1.05, 0.45, 0, 0.015, 0.1, 0.015)));
    c.bulbs.add(c.P.box(), '#ffe9a6', ab(mtx(0, 1.65, 0.34, 0, 0.6, 0.14, 0.04)));
    c.solid.add(c.P.sphere(8, 6), '#ffd84d', ab(mtx(0.12, 1.02, 0.5, 0, 0.04, 0.03, 0.04)));
  }
  const front = toWorld(b, 0, fz + 0.75);
  c.space.rect(front.x, front.z, w / 2 + 0.2, 0.6, b.rotation);
}

function buildPlaza(c: Ctx) {
  // Border ring and fountain surround (plaza disc itself is a textured mesh)
  c.flat.add(c.P.cyl(72), '#b59d80', mtx(0, 0.025, 0, 0, PLAZA_RADIUS + 0.3, 0.05, PLAZA_RADIUS + 0.3));
  c.space.circle(0, 0, PLAZA_RADIUS + 0.2);
  // Fountain stonework
  const lathe = (pts: Array<[number, number]>, seg = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  const basin = lathe([[0, 0.14], [1.88, 0.14], [1.9, 0.5], [1.97, 0.6], [2.2, 0.6], [2.3, 0.52], [2.3, 0.07], [2.36, 0.0]].reverse() as Array<[number, number]>);
  c.solid.add(basin, '#ddd3c3', mtx(0, 0.04, 0));
  c.solid.add(c.P.cyl(14), '#d4c9b8', mtx(0, 0.85, 0, 0, 0.3, 1.4, 0.3));
  c.solid.add(c.P.cyl(14), '#cbbfad', mtx(0, 0.35, 0, 0, 0.45, 0.4, 0.45));
  const bowl = lathe([[0, 0.26], [0.88, 0.26], [0.95, 0.36], [1.06, 0.33], [1.0, 0.18], [0.32, 0.0]].reverse() as Array<[number, number]>, 32);
  c.solid.add(bowl, '#e1d8c9', mtx(0, 1.36, 0));
  c.solid.add(c.P.cyl(12), '#d4c9b8', mtx(0, 1.85, 0, 0, 0.15, 0.6, 0.15));
  c.solid.add(bowl, '#e1d8c9', mtx(0, 2.0, 0, 0, 0.5, 0.6, 0.5));
  c.solid.add(c.P.sphere(12, 8), '#e9dfcf', mtx(0, 2.42, 0, 0, 0.13, 0.16, 0.13));
  basin.dispose(); bowl.dispose();
  // Plaza planters with little trees + flowers
  const angles = [-Math.PI * 0.64, -Math.PI * 0.36, Math.PI * 0.1, Math.PI * 0.68, Math.PI * 1.12];
  for (const a of angles) {
    const x = Math.cos(a) * 8.45, z = Math.sin(a) * 8.45;
    if (!c.space.free(x, z, 0.3) && c.space.pathDist(x, z) < 0.6) continue;
    c.solid.add(c.P.cyl(16), '#d6c8b0', mtx(x, 0.32, z, 0, 0.78, 0.5, 0.78));
    c.solid.add(c.P.cyl(16), '#e6dbc6', mtx(x, 0.58, z, 0, 0.84, 0.06, 0.84));
    c.solid.add(c.P.cyl(16), '#5b3d2b', mtx(x, 0.6, z, 0, 0.68, 0.04, 0.68));
    addTree(c, c.solid, x, z, a > 0 && a < 1 ? 'blossom' : 'round', 0.62);
    for (let i = 0; i < 8; i++) {
      const fa = (i / 8) * Math.PI * 2;
      c.detail.add(c.P.ico(0), pick(c.r, FLOWERS), mtx(x + Math.cos(fa) * 0.52, 0.7, z + Math.sin(fa) * 0.52, 0, 0.09, 0.08, 0.09), true);
    }
  }
}

function buildStage(c: Ctx) {
  const st = getPoi('stage');
  if (!st) return;
  const { x: sx, z: sz } = st.position;
  const yaw = Math.atan2(-sx, -sz); // local +Z faces the plaza
  const M = mtx(sx, 0, sz, yaw);
  const at = (m: THREE.Matrix4) => M.clone().multiply(m);
  c.space.circle(sx, sz, 3.2);
  c.solid.add(c.P.cyl(24), '#8a6a52', at(mtx(0, 0.18, 0, 0, 2.82, 0.36, 2.82)));
  c.solid.add(c.P.cyl(24), '#e0b98d', at(mtx(0, 0.4, 0, 0, 2.62, 0.08, 2.62)));
  for (let i = -6; i <= 6; i++) {
    const x = i * 0.4;
    const chord = 2 * Math.sqrt(Math.max(0, 2.62 * 2.62 - x * x)) - 0.12;
    c.solid.add(c.P.box(), '#c49a6c', at(mtx(x, 0.445, 0, 0, 0.025, 0.01, chord)));
  }
  c.solid.add(c.P.rbox(1.9, 0.14, 0.5, 0.03), '#b9b2a6', at(mtx(0, 0.07, 3.0)));
  c.solid.add(c.P.rbox(1.9, 0.27, 0.42, 0.03), '#c9c2b6', at(mtx(0, 0.135, 2.62)));
  for (const pole of stagePoles()) {
    c.solid.add(c.P.cyl(8), '#6b4f3a', mtx(pole.x, STAGE_POLE_HEIGHT / 2, pole.z, 0, 0.07, STAGE_POLE_HEIGHT, 0.07));
    c.solid.add(c.P.sphere(8, 6), '#e2b85c', mtx(pole.x, STAGE_POLE_HEIGHT + 0.08, pole.z, 0, 0.1, 0.1, 0.1));
    c.solid.add(c.P.cyl(8), '#5a4232', mtx(pole.x, 0.12, pole.z, 0, 0.16, 0.24, 0.16));
  }
  for (const s of [-1, 1]) {
    c.solid.add(c.P.rbox(0.7, 1.05, 0.55, 0.05), '#2b2b33', at(mtx(s * 1.45, 0.44 + 0.53, -1.85)));
    c.solid.add(c.P.cyl(14), '#4f4f5c', at(mtx(s * 1.45, 0.82, -1.56, 0, 0.21, 0.04, 0.21, Math.PI / 2)));
    c.solid.add(c.P.cyl(10), '#4f4f5c', at(mtx(s * 1.45, 1.27, -1.56, 0, 0.09, 0.04, 0.09, Math.PI / 2)));
  }
  // Wires for the string lights
  for (const curve of stageStringCurves()) {
    const tube = new THREE.TubeGeometry(curve, 18, 0.014, 3, false);
    c.solid.add(tube, '#3a3330', new THREE.Matrix4());
    tube.dispose();
  }
}

export function stagePoles(): THREE.Vector3[] {
  const st = getPoi('stage');
  if (!st) return [];
  const { x: sx, z: sz } = st.position;
  const yaw = Math.atan2(-sx, -sz);
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = yaw + Math.PI / 6 + (k * Math.PI) / 3;
    out.push(new THREE.Vector3(sx + Math.sin(a) * 2.95, STAGE_POLE_HEIGHT, sz + Math.cos(a) * 2.95));
  }
  return out;
}

export function stageStringCurves(): THREE.QuadraticBezierCurve3[] {
  const p = stagePoles();
  if (p.length < 6) return [];
  const pairs: Array<[number, number, number]> = [];
  for (let k = 0; k < 6; k++) pairs.push([k, (k + 1) % 6, 0.35]);
  for (let k = 0; k < 3; k++) pairs.push([k, k + 3, 0.7]);
  return pairs.map(([i, j, sag]) => {
    const a = p[i]!, b = p[j]!;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= sag * 2;
    return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
  });
}

function buildPark(c: Ctx, reserved: ReadonlyArray<{ x: number; z: number; scale: number }> = []) {
  // Pond rim + reeds + lily pads (water surface is animated in Park component)
  c.flat.add(c.P.cyl(28), '#d9cf9f', mtx(POND.x, 0.012, POND.z, 0, POND.r + 0.45, 0.024, POND.r + 0.35));
  c.space.circle(POND.x, POND.z, POND.r + 0.6);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + c.r() * 0.2;
    const rr = POND.r + 0.3 + c.r() * 0.15;
    c.solid.add(c.P.blob(i % 5, 0.3, 0), pick(c.r, ['#a8a49c', '#b8b3a8', '#99958d']), mtx(POND.x + Math.cos(a) * rr, 0.08, POND.z + Math.sin(a) * rr * 0.9, c.r() * 6, 0.32 + c.r() * 0.2, 0.2 + c.r() * 0.1, 0.28 + c.r() * 0.15), true);
  }
  for (let i = 0; i < 9; i++) {
    const a = -0.6 + i * 0.13;
    const rr = POND.r - 0.15;
    for (let k = 0; k < 3; k++) c.solid.add(c.P.cone(4), '#6f9a4a', mtx(POND.x + Math.cos(a) * rr + k * 0.08, 0.45, POND.z + Math.sin(a) * rr * 0.9, 0, 0.04, 0.9 + k * 0.15, 0.04, (k - 1) * 0.15));
  }
  for (let i = 0; i < 6; i++) {
    const a = c.r() * Math.PI * 2, rr = c.r() * (POND.r - 0.8);
    c.solid.add(c.P.cyl(9), '#5e9e48', mtx(POND.x + Math.cos(a) * rr, 0.075, POND.z + Math.sin(a) * rr, c.r() * 6, 0.28, 0.02, 0.28));
    if (i % 2 === 0) c.solid.add(c.P.ico(0), '#ffb3c8', mtx(POND.x + Math.cos(a) * rr, 0.13, POND.z + Math.sin(a) * rr, 0, 0.08, 0.06, 0.08), true);
  }
  // Willows (skip any that would collide with externally rendered park trees)
  for (const [wx, wz, ws] of [[-19.6, -17.8, 1.0], [-11.2, -22.6, 0.9], [-18.6, -24.4, 1.08]] as const) {
    if (reserved.some(t => Math.hypot(t.x - wx, t.z - wz) < 3.2)) continue;
    addWillow(c, wx, wz, ws);
    c.space.circle(wx, wz, 1.8 * ws);
  }
  // Park sign at the gate
  const gate = getNavNode('park-gate');
  if (gate) {
    const gx = gate.x - 1.9, gz = gate.z + 0.6;
    c.solid.add(c.P.box(), '#7b5a3c', mtx(gx - 0.8, 0.8, gz, 0.55, 0.12, 1.6, 0.12));
    c.solid.add(c.P.box(), '#7b5a3c', mtx(gx + 0.8 * Math.cos(0.55), 0.8, gz - 0.8 * Math.sin(0.55) * 1, 0.55, 0.12, 1.6, 0.12));
    c.solid.add(c.P.rbox(1.9, 0.6, 0.1, 0.05), '#8b6343', mtx(gx, 1.35, gz, 0.55));
    c.signs.push({ key: 'park', text: 'Willow Park', position: [gx + Math.sin(0.55) * 0.06, 1.35, gz + Math.cos(0.55) * 0.06], rotationY: 0.55, width: 1.75, height: 0.5, fg: '#fff3dc', bg: null });
    c.space.circle(gx, gz, 1.1);
  }
}

function buildPlayground(c: Ctx) {
  const pg = getPoi('playground');
  if (!pg) return;
  const { x, z } = pg.position;
  c.flat.add(c.P.cyl(28), '#ead2a0', mtx(x, 0.014, z, 0, 3.4, 0.028, 3.4));
  c.space.circle(x, z, 3.3);
  // Swing frame (seats animate separately)
  const S = PLAYGROUND_SWINGS;
  const M = mtx(S.x, 0, S.z, S.yaw);
  const at = (m: THREE.Matrix4) => M.clone().multiply(m);
  for (const s of [-1, 1]) for (const k of [-1, 1]) c.solid.add(c.P.cyl(8), '#e2574c', at(mtx(s * 1.5, 1.2, k * 0.42, 0, 0.06, 2.55, 0.06, k * 0.33)));
  c.solid.add(c.P.cyl(10), '#e2574c', at(mtx(0, 2.42, 0, 0, 0.07, 3.2, 0.07, 0, Math.PI / 2)));
  // Slide
  const D = mtx(x + 1.6, 0, z + 0.9, -0.5);
  const ad = (m: THREE.Matrix4) => D.clone().multiply(m);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.solid.add(c.P.cyl(8), '#f4c542', ad(mtx(sx * 0.45, 0.8, sz * 0.45, 0, 0.06, 1.6, 0.06)));
  c.solid.add(c.P.rbox(1.05, 0.1, 1.05, 0.03), '#4cb3e6', ad(mtx(0, 1.55, 0)));
  c.solid.add(c.P.cone(4), '#e2574c', ad(mtx(0, 2.35, 0, Math.PI / 4, 0.85, 0.7, 0.85)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.solid.add(c.P.cyl(6), '#f4c542', ad(mtx(sx * 0.45, 1.8, sz * 0.45, 0, 0.035, 0.5, 0.035)));
  const sl = Math.hypot(2.2, 1.5), sa = Math.atan2(1.5, 2.2);
  c.solid.add(c.P.box(), '#4cb3e6', ad(mtx(0, 0.82, 0.55 + 1.1, 0, 0.6, 0.06, sl, sa)));
  for (const sx of [-1, 1]) c.solid.add(c.P.box(), '#3a9fd0', ad(mtx(sx * 0.3, 0.92, 0.55 + 1.1, 0, 0.05, 0.16, sl, sa)));
  for (let i = 0; i < 5; i++) c.solid.add(c.P.box(), '#f4c542', ad(mtx(0, 0.25 + i * 0.3, -0.55, 0, 0.9, 0.05, 0.06)));
  // Seesaw
  c.solid.add(c.P.box(), '#7b5a3c', mtx(x - 0.6, 0.25, z + 1.9, 1.1, 0.25, 0.5, 0.25));
  c.solid.add(c.P.rbox(2.6, 0.08, 0.3, 0.03), '#5ab26f', mtx(x - 0.6, 0.52, z + 1.9, 1.1, 1, 1, 1, 0, 0.16));
  // Sandbox
  c.solid.add(c.P.box(), '#a87b50', mtx(x - 1.4, 0.12, z - 1.4, 0.3, 1.8, 0.24, 1.8));
  c.solid.add(c.P.box(), '#f1dca8', mtx(x - 1.4, 0.2, z - 1.4, 0.3, 1.6, 0.1, 1.6));
  c.solid.add(c.P.cone(8), '#e9cf96', mtx(x - 1.2, 0.32, z - 1.3, 0, 0.4, 0.22, 0.4), true);
}

/** Merged geometry for one swing (ropes + seat), pivot at the top bar. */
export function swingGeometry(): THREE.BufferGeometry {
  const P = new Prims();
  const b = new Batch();
  for (const s of [-1, 1]) b.add(P.cyl(5), '#d8d2c4', mtx(s * 0.24, -0.95, 0, 0, 0.012, 1.9, 0.012));
  b.add(P.rbox(0.6, 0.06, 0.24, 0.02), '#4cb3e6', mtx(0, -1.9, 0));
  const g = b.build();
  P.dispose();
  return g;
}

function buildGarden(c: Ctx) {
  const g = getPoi('garden');
  if (!g) return;
  const { x, z } = g.position;
  const beds = [z - 1.3, z, z + 1.3];
  beds.forEach((bz, bi) => {
    c.solid.add(c.P.rbox(2.7, 0.36, 0.95, 0.04), '#9b6b43', mtx(x, 0.18, bz));
    c.solid.add(c.P.box(), '#5b3d2b', mtx(x, 0.37, bz, 0, 2.5, 0.04, 0.78));
    for (let i = 0; i < 6; i++) {
      const px = x - 1.05 + i * 0.42;
      if (bi === 0) { // lettuce
        c.solid.add(c.P.blob(i % 4, 0.25, 0), pick(c.r, ['#8fd06a', '#a4dc7c', '#7cc35a']), mtx(px, 0.48, bz, c.r() * 6, 0.17, 0.12, 0.17), true);
      } else if (bi === 1) { // carrots
        c.solid.add(c.P.cone(4), '#f08a3c', mtx(px, 0.41, bz - 0.18, 0, 0.05, 0.06, 0.05, Math.PI), true);
        c.solid.add(c.P.cone(4), '#6aa84f', mtx(px, 0.55, bz - 0.18, c.r() * 3, 0.07, 0.26, 0.07), true);
        c.solid.add(c.P.cone(4), '#6aa84f', mtx(px + 0.1, 0.55, bz + 0.18, c.r() * 3, 0.07, 0.26, 0.07), true);
      } else { // tomatoes
        c.solid.add(c.P.cyl(5), '#8a6a45', mtx(px, 0.7, bz, 0, 0.015, 0.7, 0.015));
        c.solid.add(c.P.blob(i % 3, 0.25, 0), '#5e9e48', mtx(px, 0.75, bz, c.r() * 6, 0.18, 0.3, 0.16), true);
        c.solid.add(c.P.sphere(8, 6), '#e5483b', mtx(px + 0.1, 0.7, bz + 0.1, 0, 0.06, 0.06, 0.06));
        c.solid.add(c.P.sphere(8, 6), '#ef6a3d', mtx(px - 0.08, 0.85, bz + 0.08, 0, 0.05, 0.05, 0.05));
      }
    }
  });
  // Sunflowers along the back
  for (let i = 0; i < 6; i++) {
    const px = x - 1.25 + i * 0.5, pz = z + 2.25;
    const h = 1.3 + c.r() * 0.4;
    c.solid.add(c.P.cyl(5), '#5e8f3e', mtx(px, h / 2, pz, 0, 0.03, h, 0.03));
    c.solid.add(c.P.cyl(10), '#ffcf3a', mtx(px, h, pz - 0.04, 0, 0.2, 0.04, 0.2, Math.PI / 2 - 0.25));
    c.solid.add(c.P.cyl(8), '#6b4423', mtx(px, h, pz - 0.07, 0, 0.09, 0.04, 0.09, Math.PI / 2 - 0.25));
  }
  // Watering can + sign
  c.solid.add(c.P.cyl(8), '#5aa0c8', mtx(x + 1.75, 0.15, z - 0.4, 0, 0.13, 0.3, 0.13));
  c.solid.add(c.P.cyl(5), '#5aa0c8', mtx(x + 1.95, 0.22, z - 0.4, 0, 0.025, 0.35, 0.025, 0, -0.9));
  c.solid.add(c.P.box(), '#7b5a3c', mtx(x - 1.9, 0.5, z - 2.2, 0, 0.08, 1.0, 0.08));
  c.solid.add(c.P.rbox(1.15, 0.42, 0.06, 0.04), '#8b6343', mtx(x - 1.9, 1.05, z - 2.2, Math.PI));
  c.signs.push({ key: 'garden', text: 'Garden', position: [x - 1.9, 1.05, z - 2.24], rotationY: Math.PI, width: 1.05, height: 0.38, fg: '#fff3dc', bg: null });
  c.space.circle(x, z, 2.6);
  c.space.circle(x - 1.9, z - 2.2, 0.6);
}

function buildPortalBase(c: Ctx) {
  const p = getPoi('portal');
  if (!p) return;
  const { x, z } = p.position;
  c.solid.add(c.P.cyl(28), '#a9a397', mtx(x, 0.13, z, 0, 3.4, 0.26, 3.0));
  c.solid.add(c.P.cyl(28), '#bdb6a8', mtx(x, 0.36, z, 0, 2.8, 0.22, 2.3));
  for (const s of [-1, 1]) {
    c.solid.add(c.P.rbox(0.9, 2.1, 1.0, 0.08), '#9a9488', mtx(x + s * 2.55, 1.35, z, 0));
    c.solid.add(c.P.rbox(1.1, 0.25, 1.2, 0.05), '#8b857a', mtx(x + s * 2.55, 0.5, z, 0));
  }
  // Standing rune stones
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.15 + (i / 5) * Math.PI * 0.7 + Math.PI;
    const rx = x + Math.cos(a) * 4.4, rz = z - Math.sin(a) * 3.6;
    const tilt = (c.r() - 0.5) * 0.15;
    c.solid.add(c.P.rbox(0.55, 1.5 + c.r() * 0.5, 0.42, 0.08), '#8f897e', mtx(rx, 0.75, rz, a, 1, 1, 1, tilt, tilt), true);
    c.bulbs.add(c.P.box(), i % 2 ? '#b98cff' : '#6ff3ff', mtx(rx, 1.05, rz, a + Math.PI / 2, 0.05, 0.42, 0.18));
  }
  c.space.circle(x, z, 4.8);
}

/* ---------------------------------------------------------------- ground */

function buildGround(q: number, horizon = true): THREE.BufferGeometry {
  const size = horizon ? 320 : 92, seg = q > 0.7 ? (horizon ? 160 : 80) : (horizon ? 96 : 56);
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const A = new THREE.Color('#8cc46a'), B = new THREE.Color('#76b05a'), C = new THREE.Color('#a6d27c'), D = new THREE.Color('#bcd07c');
  const F = new THREE.Color('#7fae78');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const n1 = noise2(x * 0.06, z * 0.06, 3), n2 = noise2(x * 0.21, z * 0.21, 7);
    c.copy(A).lerp(B, n1).lerp(C, Math.max(0, n2 - 0.45) * 1.2);
    if (n1 > 0.7) c.lerp(D, (n1 - 0.7) * 1.5);
    const hill = smooth(46, 120, r);
    c.lerp(F, hill * 0.5);
    const h = horizon ? hill * (5 + 14 * noise2(x * 0.025, z * 0.025, 11)) + smooth(110, 160, r) * 10 : -2.5 * smooth(39, 44, r);
    pos.setY(i, h);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

export function groundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const hill = smooth(46, 120, r);
  return hill * (5 + 14 * noise2(x * 0.025, z * 0.025, 11)) + smooth(110, 160, r) * 10;
}

function smooth(e0: number, e1: number, x: number) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

/* ------------------------------------------------------------------ main */

export function buildTown(quality: 'low' | 'high', options: TownOptions = {}): TownGeometry {
  const q = quality === 'high' ? 1 : 0.55;
  const horizon = options.horizon ?? true;
  const low = quality === 'low';
  const ctx: Ctx = {
    solid: new Batch(), detail: new Batch(), far: new Batch(), flat: new Batch(), glass: new Batch(), bulbs: new Batch(),
    P: new Prims(), r: rng(20261102), space: new Space(), q, lamps: [], chimneys: [], signs: [],
  };
  const c = ctx;
  const reserved = options.reservedTrees ?? [];
  for (const t of reserved) c.space.circle(t.x, t.z, 1.9 * t.scale);
  const occupied = options.occupied;

  // Paths (border + top), with round joints
  const nodes = new Map<string, Vec2>();
  for (const [a, b] of PATH_SEGMENTS) {
    pathStrip(c.flat, c.P, a, b, 1.42, 0.0, 0.04, '#c4b08f');
    pathStrip(c.flat, c.P, a, b, 1.15, 0.008, 0.05, '#e9dcc3');
    nodes.set(`${a.x},${a.z}`, a); nodes.set(`${b.x},${b.z}`, b);
  }
  for (const n of nodes.values()) {
    c.flat.add(c.P.cyl(18), '#c4b08f', mtx(n.x, 0.0, n.z, 0, 1.42, 0.04, 1.42));
    c.flat.add(c.P.cyl(18), '#e9dcc3', mtx(n.x, 0.008, n.z, 0, 1.15, 0.05, 1.15));
  }

  buildPlaza(c);
  buildStage(c);
  for (const b of BUILDINGS) {
    if (b.kind === 'house') buildHouse(c, b);
    else if (b.kind === 'cafe') buildCafe(c, b);
    else buildArcade(c, b);
  }
  buildTerrace(c);
  buildPark(c, reserved);
  buildPlayground(c);
  buildGarden(c);
  buildPortalBase(c);

  // Benches at bench POIs (exactly at their seats)
  for (const poi of POIS) {
    if (poi.kind !== 'bench' || !poi.seats?.length) continue;
    const xs = poi.seats.map(s => s.x), zs = poi.seats.map(s => s.z);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
    const span = poi.seats.length > 1 ? Math.hypot(xs[0]! - xs[xs.length - 1]!, zs[0]! - zs[zs.length - 1]!) : 0;
    const yaw = poi.seats[0]!.facing;
    addBench(c, cx, cz, yaw, span + 0.9);
    c.space.circle(cx, cz, span / 2 + 0.7);
  }

  // Street lamps along paths + around the plaza
  const lampSpots: Vec2[] = [];
  const tryLamp = (x: number, z: number, minGap: number) => {
    if (lampSpots.some(l => Math.hypot(l.x - x, l.z - z) < minGap)) return;
    if (!c.space.free(x, z, 0.2)) return;
    lampSpots.push({ x, z });
    addLamp(c, x, z);
  };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 8.0, z = Math.sin(a) * 8.0;
    if (c.space.pathDist(x, z) < 0.35) continue;
    if (lampSpots.some(l => Math.hypot(l.x - x, l.z - z) < 4)) continue;
    lampSpots.push({ x, z });
    addLamp(c, x, z);
  }
  PATH_SEGMENTS.forEach(([a, b], si) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (Math.hypot(a.x, a.z) < PLAZA_RADIUS && Math.hypot(b.x, b.z) < PLAZA_RADIUS) return;
    const n = Math.max(1, Math.round(L / 8));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const side = (i + si) % 2 ? 1 : -1;
      const px = -(b.z - a.z) / L, pz = (b.x - a.x) / L;
      const lx = x + px * 1.75 * side, lz = z + pz * 1.75 * side;
      if (Math.hypot(lx, lz) < PLAZA_RADIUS + 0.8) continue;
      tryLamp(lx, lz, 6.5);
    }
  });

  // Vegetation scatter (deterministic jittered grids)
  const scatter = (cell: number, extent: number, fn: (x: number, z: number, r: () => number) => void) => {
    const rr = rng(Math.round(cell * 1000 + extent));
    for (let gx = -extent; gx < extent; gx += cell) for (let gz = -extent; gz < extent; gz += cell) {
      const x = gx + rr() * cell, z = gz + rr() * cell;
      fn(x, z, rr);
    }
  };
  const inTown = (x: number, z: number) => Math.abs(x) < 35 && Math.abs(z) < 35;
  const treeKinds = ['round', 'round', 'round', 'pine', 'birch', 'blossom', 'autumn', 'round', 'pine'] as const;
  scatter(4.0, 36, (x, z, r) => {
    if (r() > 0.62 * (q > 0.7 ? 1 : 0.7)) return;
    if (!c.space.free(x, z, 1.5)) return;
    const kind = treeKinds[Math.floor(r() * treeKinds.length)]!;
    addTree(c, c.solid, x, z, kind, 0.85 + r() * 0.45, low ? 0 : 1);
    c.space.circle(x, z, 1.0);
  });
  // Forest belt beyond the town edge
  if (horizon) scatter(low ? 4.2 : 3.4, 70, (x, z, r) => {
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d < 35 || Math.hypot(x, z) > (low ? 58 : 72)) return;
    if (r() > (low ? 0.55 : 0.9)) return;
    if (occupied?.(x, z, 2)) return;
    const kind = r() < 0.6 ? 'pine' : (r() < 0.8 ? 'round' : 'autumn');
    addTree(c, c.far, x, z, kind, 1.0 + r() * 0.7, 0, groundHeight(x, z));
  });
  // Distant hills ring (big soft blobs)
  for (let i = 0; i < (horizon ? 18 : 0); i++) {
    const a = (i / 18) * Math.PI * 2 + c.r() * 0.2;
    const R = 115 + c.r() * 30;
    const hx = Math.cos(a) * R, hz = Math.sin(a) * R;
    if (occupied?.(hx, hz, 4)) continue;
    c.far.add(c.P.blob(i % 6, 0.12, 2), pick(c.r, ['#86b06c', '#7ea978', '#93b884', '#7aa47a']), mtx(hx, -4, hz, c.r() * 6, 34 + c.r() * 20, 12 + c.r() * 12, 26 + c.r() * 14), false);
  }
  scatter(2.4, 38, (x, z, r) => {
    if (r() > 0.36 * q) return;
    if (!c.space.free(x, z, 0.65)) return;
    addBush(c, inTown(x, z) ? (low ? c.detail : c.solid) : (horizon ? c.far : c.detail), x, z, 0.65 + r() * 0.5, r() < 0.3);
    c.space.circle(x, z, 0.5);
  });
  scatter(2.6, 34, (x, z, r) => {
    if (r() > 0.4 * q) return;
    if (!c.space.free(x, z, 0.3)) return;
    const fc = pick(r, FLOWERS);
    const n = low ? 3 : 4 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const fx = x + (r() - 0.5) * 1.2, fz = z + (r() - 0.5) * 1.2;
      if (!low) {
        c.detail.add(c.P.ico(0), pick(r, LEAF), mtx(fx, 0.08, fz, r() * 6, 0.13, 0.09, 0.13), true);
        c.detail.add(c.P.cyl(3), '#5e8f3e', mtx(fx, 0.13, fz, 0, 0.012, 0.22, 0.012));
      }
      c.detail.add(c.P.ico(0), fc, mtx(fx, low ? 0.12 : 0.26, fz, r() * 6, 0.085, 0.07, 0.085), true);
    }
  });
  if (!low) scatter(1.8, 40, (x, z, r) => {
    if (r() > 0.5 * q) return;
    if (!c.space.free(x, z, 0.15)) return;
    const col = pick(r, ['#6aa84f', '#7cb85b', '#8cc46a', '#5e9a46']);
    for (let i = 0; i < 3; i++) {
      c.detail.add(c.P.cone(3), col, mtx(x + (r() - 0.5) * 0.18, 0.16, z + (r() - 0.5) * 0.18, r() * 6, 0.05, 0.34 + r() * 0.15, 0.05, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6), true);
    }
  });
  scatter(6.5, 44, (x, z, r) => {
    if (r() > 0.3) return;
    if (!c.space.free(x, z, 0.5)) return;
    const s = 0.3 + r() * 0.5;
    if (!inTown(x, z) && !horizon) return;
    (inTown(x, z) ? c.detail : c.far).add(c.P.blob(Math.floor(r() * 6), 0.3, 0), pick(r, ['#a8a49c', '#b5b0a5', '#9b968c']), mtx(x, s * 0.2, z, r() * 6, s, s * 0.6, s * 0.85), true);
  });

  const out: TownGeometry = {
    solid: c.solid.build(), detail: c.detail.build(), far: c.far.build(), flat: c.flat.build(), glass: c.glass.build(), bulbs: c.bulbs.build(),
    ground: buildGround(q, horizon), lamps: c.lamps, chimneys: c.chimneys, signs: c.signs,
  };
  c.P.dispose();
  return out;
}

/** Nearest POI for a ground click (smaller, more specific places win). */
export function poiAt(x: number, z: number): string | null {
  for (const b of BUILDINGS) {
    const dx = x - b.position.x, dz = z - b.position.z;
    const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < b.width / 2 + 0.3 && Math.abs(lz) < b.depth / 2 + 0.3) return b.poiId;
  }
  let best: { id: string; score: number } | null = null;
  for (const p of POIS) {
    const d = Math.hypot(p.position.x - x, p.position.z - z);
    if (d > p.radius + 0.8) continue;
    const score = p.radius + d * 0.5;
    if (!best || score < best.score) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

/**
 * Minimal props for the transparent overlay: benches, café chairs/tables and the stage
 * platform, so seated/dancing residents never hover in mid-air. Same seat heights (0.45 m).
 */
export function buildOverlayProps(): THREE.BufferGeometry {
  const c: Ctx = {
    solid: new Batch(), detail: new Batch(), far: new Batch(), flat: new Batch(), glass: new Batch(), bulbs: new Batch(),
    P: new Prims(), r: rng(7), space: new Space(), q: 0.5, lamps: [], chimneys: [], signs: [],
  };
  for (const poi of POIS) {
    if (poi.kind !== 'bench' || !poi.seats?.length) continue;
    const xs = poi.seats.map(s => s.x), zs = poi.seats.map(s => s.z);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
    const span = poi.seats.length > 1 ? Math.hypot(xs[0]! - xs[xs.length - 1]!, zs[0]! - zs[zs.length - 1]!) : 0;
    addBench(c, cx, cz, poi.seats[0]!.facing, span + 0.9);
  }
  const cafe = getPoi('cafe');
  if (cafe?.seats) {
    for (let i = 0; i + 1 < cafe.seats.length; i += 2) {
      const s1 = cafe.seats[i]!, s2 = cafe.seats[i + 1]!;
      const tx = (s1.x + s2.x) / 2, tz = (s1.z + s2.z) / 2;
      c.solid.add(c.P.cyl(14), '#fbf7ef', mtx(tx, 0.76, tz, 0, 0.55, 0.05, 0.55));
      c.solid.add(c.P.cyl(8), '#3d3a36', mtx(tx, 0.38, tz, 0, 0.05, 0.76, 0.05));
      addChair(c, s1.x, s1.z, s1.facing, '#4e8f7a');
      addChair(c, s2.x, s2.z, s2.facing, '#d9644f');
    }
  }
  const st = getPoi('stage');
  if (st) {
    c.solid.add(c.P.cyl(24), '#8a6a52', mtx(st.position.x, 0.18, st.position.z, 0, 2.82, 0.36, 2.82));
    c.solid.add(c.P.cyl(24), '#e0b98d', mtx(st.position.x, 0.4, st.position.z, 0, 2.62, 0.08, 2.62));
  }
  const g = c.solid.build();
  c.P.dispose();
  return g;
}
