/**
 * Camera director. Modes: orbit · neighborhood · street · follow · cinematic (+ overlay).
 *  - neighborhood: close, composed high-angle shot over plaza + stage + café (residents read at stream scale)
 *  - follow: front three-quarter framing relative to the resident's (smoothed) heading, look-ahead,
 *    occlusion-aware (layout building boxes, stage, fountain, portal) — swings to a clear angle
 *  - cinematic/street: an event director cuts to the actor (or the portal for raid/join) for ~7 s on
 *    viewer/twitch/demo events; otherwise cinematic drifts around the densest resident cluster
 * No per-frame allocations (scratch objects only).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraMode, WorldEvent, ResidentProfile } from '@hello-world/contracts';
import { useSceneStore } from '../core/SceneContext';
import type { SceneStore } from '../core/sceneStore';
import { BUILDINGS, getPoi } from '../world/layout';
import { useKit } from './context';

export type RigMode = CameraMode | 'overlay';

interface OrbitLike { target: THREE.Vector3; update?: () => void }

/* ------------------------------------------------------------ occluders */

type Occluder =
  | { kind: 'box'; x: number; z: number; hw: number; hd: number; c: number; s: number; h: number }
  | { kind: 'circle'; x: number; z: number; r: number; h: number };

const OCCLUDERS: Occluder[] = (() => {
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
let EXTRA: ReadonlyArray<{ x: number; z: number; r: number; h: number }> = [];

function blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  for (let i = 0; i < EXTRA.length; i++) {
    const o = EXTRA[i]!;
    // the camera itself must keep clear of props (no canopy / post filling the lens)
    if (ay < o.h + 0.6 && Math.hypot(ax - o.x, az - o.z) < o.r + 1.0) return true;
    const dx = bx - ax, dz = bz - az;
    const fx = ax - o.x, fz = az - o.z;
    const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - o.r * o.r;
    const disc = B * B - 4 * A * C;
    if (A < 1e-9 || disc <= 0) continue;
    const sq = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - sq) / (2 * A)), t1 = Math.min(1, (-B + sq) / (2 * A));
    if (t0 > t1 || t1 >= 0.97) continue; // ignore props right at the subject
    if (Math.min(ay + (by - ay) * t0, ay + (by - ay) * t1) < o.h) return true;
  }
  for (let i = 0; i < OCCLUDERS.length; i++) {
    const o = OCCLUDERS[i]!;
    let t0 = 0, t1 = 1;
    if (o.kind === 'box') {
      const lax = (ax - o.x) * o.c - (az - o.z) * o.s, laz = (ax - o.x) * o.s + (az - o.z) * o.c;
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

/* -------------------------------------------------------------- helpers */

const angleLerp = (a: number, b: number, k: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

/** Static pose for the non-dynamic modes. */
export function poseFor(mode: RigMode, t: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
  switch (mode) {
    case 'overlay':
      // Residents occupy a lower-third band; camera looks just above the plaza.
      outPos.set(0, 6, 28); outLook.set(0, 4.2, 0); break;
    case 'orbit':
      // higher + wider start so the skyline ring and mountains are discoverable
      outPos.set(-16, 40, 64); outLook.set(2, 3, -8); break;
    case 'street': {
      const s = Math.sin(t * 0.045);
      const x = -7 + s * 7;
      outPos.set(x, 1.75, 10.4); outLook.set(x + 10, 1.6, 14.6); break;
    }
    default:
      // neighborhood: ~40% closer + lower than the old establishing shot, over plaza + stage + café
      outPos.set(-0.6 + Math.sin(t * 0.05) * 1.6, 14.6 + Math.sin(t * 0.07) * 0.5, 23.2 + Math.cos(t * 0.05) * 0.8);
      outLook.set(4.2, 2.0, 0.2);
  }
}

const CINE_POS: Array<[number, number, number]> = [
  [15, 8.5, 17], [6, 5.5, -1], [10.5, 6, -12], [5, 6, -14.5], [-6, 6.5, -10.5], [-12.5, 5.5, -2.5], [-10.5, 5.5, 8], [-3, 5, 10], [3.5, 6.5, 2.5],
];
const CINE_LOOK: Array<[number, number, number]> = [
  [1, 1, 0], [13, 1.6, -7], [19, 1.8, -18], [0, 2.6, -24], [-15, 0.8, -19], [-20, 1, -9], [-20, 2, 3], [-7, 0.6, 19], [7.5, 1.4, 7],
];

const STAGE_POS = getPoi('stage')?.position ?? { x: 7.5, z: 7 };
const PORTAL_POS = getPoi('portal')?.position ?? { x: 0, z: -24 };

/** Fat test: any prop (lamp post, tree, planter…) within `margin` of the subject end of the segment. */
function propsNear(ax: number, ay: number, az: number, bx: number, by: number, bz: number, margin: number): boolean {
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

const PORTAL_CANDIDATES = [0.32, -0.32, 0.55, -0.55, 0.14, -0.14, 0.8, -0.8, 1.05, -1.05];

/** Tall props in the near half of a shot (camera → subject) would loom in the foreground. */
function foregroundClutter(cx: number, cz: number, tx: number, tz: number): boolean {
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

/**
 * Portal shot (raid / join): picks the first clear angle from a small candidate set so no lamp post,
 * tree or fence stands between camera and arrivals. Arrivals sit in the upper-middle third.
 */
function portalPose(raid: boolean, outPos: THREE.Vector3, outLook: THREE.Vector3) {
  const tx = PORTAL_POS.x, tz = PORTAL_POS.z + 2.6, ty = 1.0;
  const D = raid ? 17 : 11.5, H = raid ? 6.4 : 3.8;
  let a = PORTAL_CANDIDATES[0]!;
  for (let i = 0; i < PORTAL_CANDIDATES.length; i++) {
    const c = PORTAL_CANDIDATES[i]!;
    const cx = tx + Math.sin(c) * D, cz = tz + Math.cos(c) * D;
    if (!blocked(cx, H, cz, tx, ty + 0.6, tz) && !propsNear(cx, H, cz, tx, ty, tz, 1.2) && !foregroundClutter(cx, cz, tx, tz)) { a = c; break; }
  }
  outPos.set(tx + Math.sin(a) * D, H, tz + Math.cos(a) * D);
  // aim ~1 m below the arrivals so they sit slightly above centre (upper-middle third)
  outLook.set(tx, ty - (raid ? 1.0 : 0.6), tz);
}

/** Keep the camera outside building volumes (push out along the shallowest axis). */
function pushOutOfBuildings(p: THREE.Vector3) {
  for (let i = 0; i < OCCLUDERS.length; i++) {
    const o = OCCLUDERS[i]!;
    if (o.kind !== 'box' || p.y > o.h + 0.8) continue;
    const dx = p.x - o.x, dz = p.z - o.z;
    const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
    const hw = o.hw + 0.9, hd = o.hd + 0.9;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) continue;
    let nx = lx, nz = lz;
    if (hw - Math.abs(lx) < hd - Math.abs(lz)) nx = Math.sign(lx || 1) * hw; else nz = Math.sign(lz || 1) * hd;
    // back to world (yaw rotation)
    p.x = o.x + nx * o.c + nz * o.s;
    p.z = o.z - nx * o.s + nz * o.c;
  }
}


const DIRECTED_KINDS = new Set<WorldEvent['kind']>(['join', 'raid', 'gift', 'social', 'dance', 'chat', 'wave', 'confetti']);

interface Director {
  kind: 'none' | 'actor' | 'portal' | 'speaker';
  actorId: string;
  until: number;
  lastCut: number;
  lastPush: number;
  cutPending: boolean;
  raid: boolean;
}

/** Front three-quarter framing solver (shared by follow + director actor shots). */
interface Framer {
  pos: THREE.Vector3;      // smoothed ground position of the subject
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  rel: number;             // chosen relative yaw (camera side)
  yaw: number;             // smoothed absolute camera yaw
  init: boolean;
}
const newFramer = (): Framer => ({ pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, rel: 0.62, yaw: 0, init: false });
const REL_CANDIDATES = [0.62, -0.62, 1.15, -1.15, 1.7, -1.7, 2.4, -2.4, Math.PI];

function clearAt(f: Framer, rel: number, dist: number, height: number, ly: number): boolean {
  const a = f.heading + rel;
  return !blocked(f.pos.x + Math.sin(a) * dist, height, f.pos.z + Math.cos(a) * dist, f.pos.x, ly, f.pos.z);
}

function frame(f: Framer, tx: number, tz: number, dt: number, dist: number, height: number, lookY: number, outPos: THREE.Vector3, outLook: THREE.Vector3, snap: boolean) {
  if (!f.init || snap) { f.pos.set(tx, 0, tz); f.prev.copy(f.pos); f.vel.set(0, 0, 0); f.init = true; }
  f.prev.copy(f.pos);
  const k = snap ? 1 : 1 - Math.exp(-dt * 3);
  f.pos.x += (tx - f.pos.x) * k; f.pos.z += (tz - f.pos.z) * k;
  if (dt > 1e-4) {
    const vx = (f.pos.x - f.prev.x) / dt, vz = (f.pos.z - f.prev.z) / dt;
    const kv = 1 - Math.exp(-dt * 2);
    f.vel.x += (vx - f.vel.x) * kv; f.vel.z += (vz - f.vel.z) * kv;
  }
  const speed = Math.hypot(f.vel.x, f.vel.z);
  if (speed > 0.35) f.heading = angleLerp(f.heading, Math.atan2(f.vel.x, f.vel.z), 1 - Math.exp(-dt * 1.6));
  const ly = lookY;
  // keep the current side while it is clear, else search (same side first)
  if (!clearAt(f, f.rel, dist, height, ly)) {
    const side = f.rel < 0 ? -1 : 1;
    for (let i = 0; i < REL_CANDIDATES.length; i++) {
      const cand = REL_CANDIDATES[i]! * side;
      if (clearAt(f, cand, dist, height, ly)) { f.rel = cand; break; }
    }
  }
  const targetYaw = f.heading + f.rel;
  f.yaw = snap ? targetYaw : angleLerp(f.yaw, targetYaw, 1 - Math.exp(-dt * 1.8));
  const ahead = Math.min(2, speed * 0.6);
  const hx = speed > 0.01 ? f.vel.x / speed : 0, hz = speed > 0.01 ? f.vel.z / speed : 0;
  outLook.set(f.pos.x + hx * ahead, ly, f.pos.z + hz * ahead);
  outPos.set(f.pos.x + Math.sin(f.yaw) * dist, height, f.pos.z + Math.cos(f.yaw) * dist);
}

/** Densest resident cluster (counts neighbours within 6 m). */
function densestCluster(store: SceneStore, out: THREE.Vector3): boolean {
  const rs = store.current.residents;
  if (!rs.length) return false;
  let best = -1, bi = 0;
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i]!.location;
    let n = 0;
    for (let j = 0; j < rs.length; j++) {
      const b = rs[j]!.location;
      if (Math.hypot(a.x - b.x, a.z - b.z) < 6) n++;
    }
    const score = n - Math.hypot(a.x, a.z) * 0.01;
    if (score > best) { best = score; bi = i; }
  }
  const c = rs[bi]!.location;
  let sx = 0, sz = 0, n = 0;
  for (const r of rs) {
    if (Math.hypot(r.location.x - c.x, r.location.z - c.z) < 6) { sx += r.location.x; sz += r.location.z; n++; }
  }
  out.set(sx / n, 0, sz / n);
  // A centroid inside the fountain / stage ring cannot be framed at eye level: use the group's
  // most-connected resident instead (a real subject, never the middle of a prop).
  if (Math.hypot(out.x, out.z) < 2.9 || Math.hypot(out.x - STAGE_POS.x, out.z - STAGE_POS.z) < 2.2) out.set(c.x, 0, c.z);
  return true;
}

/* ------------------------------------------------------- overlay framing */

interface OverlayFit { minX: number; maxX: number; minZ: number; maxZ: number; init: boolean; at: number; xs: number[]; zs: number[] }
const newOverlayFit = (): OverlayFit => ({ minX: -7, maxX: 7, minZ: -7, maxZ: 7, init: false, at: -1, xs: [], zs: [] });

/** Trimmed (20th–80th percentile) resident bounds, padded; falls back to the plaza. */
function residentBounds(store: SceneStore, f: OverlayFit, out: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const rs = store.current.residents;
  if (!rs.length) { out.minX = -7; out.maxX = 7; out.minZ = -7; out.maxZ = 7; return; }
  f.xs.length = 0; f.zs.length = 0;
  for (const r of rs) { f.xs.push(r.location.x); f.zs.push(r.location.z); }
  f.xs.sort((a, b) => a - b); f.zs.sort((a, b) => a - b);
  // 20th–80th percentile: frame the crowd, let stragglers walk out of frame
  const lo = Math.floor((rs.length - 1) * 0.2), hi = Math.ceil((rs.length - 1) * 0.8);
  out.minX = f.xs[lo]! - 1.6; out.maxX = f.xs[hi]! + 1.6;
  out.minZ = f.zs[lo]! - 1.6; out.maxZ = f.zs[hi]! + 1.6;
  // keep a sensible minimum frame (about the plaza)
  const cx = (out.minX + out.maxX) / 2, cz = (out.minZ + out.maxZ) / 2;
  if (out.maxX - out.minX < 12) { out.minX = cx - 6; out.maxX = cx + 6; }
  if (out.maxZ - out.minZ < 8) { out.minZ = cz - 4; out.maxZ = cz + 4; }
}

const _bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
const OVERLAY_PITCH = THREE.MathUtils.degToRad(9);

/**
 * Overlay framing: fit the residents' (trimmed) bounds into a lower-third composition.
 * Re-measured about once per second and smoothed.
 */
function overlayPose(store: SceneStore, f: OverlayFit, cam: THREE.PerspectiveCamera, t: number, dt: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
  if (!f.init || t - f.at > 1) {
    f.at = t;
    residentBounds(store, f, _bounds);
    if (!f.init) { f.minX = _bounds.minX; f.maxX = _bounds.maxX; f.minZ = _bounds.minZ; f.maxZ = _bounds.maxZ; f.init = true; }
  }
  const k = 1 - Math.exp(-dt * 0.8);
  f.minX += (_bounds.minX - f.minX) * k; f.maxX += (_bounds.maxX - f.maxX) * k;
  f.minZ += (_bounds.minZ - f.minZ) * k; f.maxZ += (_bounds.maxZ - f.maxZ) * k;
  const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
  const tanV = Math.tan(THREE.MathUtils.degToRad((cam.fov || 42) / 2));
  const tanH = tanV * (cam.aspect || 16 / 9);
  const cDep = OVERLAY_PITCH + Math.atan(0.45 * tanV);          // content centre sits ~72% down the frame
  const nearLim = OVERLAY_PITCH + Math.atan(0.9 * tanV);        // near edge stays inside the bottom edge
  const halfW = (f.maxX - f.minX) / 2 + 0.8;
  const dzNear = f.maxZ - cz + 0.6;
  const dW = halfW / (0.92 * tanH);
  const dN = (0.9 + Math.tan(nearLim) * dzNear) / Math.max(0.05, Math.tan(nearLim) - Math.tan(cDep));
  const D = Math.min(42, Math.max(12, dW, dN));
  const H = 0.9 + D * Math.tan(cDep);
  outPos.set(cx, H, cz + D);
  outLook.set(cx, H - D * Math.tan(OVERLAY_PITCH), cz);
}

interface OrbitState { pos: THREE.Vector3; look: THREE.Vector3; clusterS: THREE.Vector3; orbit: number; blockedFor: number }

/** Camera must stay outside the stage's string-light ring (plus margin). */
const outsideStageRing = (x: number, z: number) => Math.hypot(x - STAGE_POS.x, z - STAGE_POS.z) > 4.4;

/**
 * Slow orbit around the smoothed cluster centre. Small props are dissolved by the see-through
 * cone; if the subject stays blocked for > 0.5 s the camera swings along the orbit until clear.
 */
function orbitClear(o: OrbitState, a: number, dist: number, h: number, lookY: number): boolean {
  const cx = o.clusterS.x + Math.sin(a) * dist, cz = o.clusterS.z + Math.cos(a) * dist;
  return outsideStageRing(cx, cz) && !blocked(cx, h, cz, o.clusterS.x, lookY, o.clusterS.z);
}

function orbitShot(o: OrbitState, dt: number, speed: number, dist: number, h: number, lookY: number) {
  if (orbitClear(o, o.orbit, dist, h, lookY)) {
    o.blockedFor = 0;
    o.orbit += dt * speed;
  } else {
    o.blockedFor += dt;
    // swing smoothly along the orbit once the block persists (> 0.5 s)
    o.orbit += dt * (o.blockedFor > 0.5 ? 0.9 : speed);
  }
  o.pos.set(o.clusterS.x + Math.sin(o.orbit) * dist, h, o.clusterS.z + Math.cos(o.orbit) * dist);
  o.look.set(o.clusterS.x, lookY, o.clusterS.z);
}

/* ----------------------------------------------------------------- rig */

/** Fixed overlay viewing direction. Bounds include labels, gestures, feet and interpolation lag. */
const OVERLAY_BACK = new THREE.Vector3(0, 0.58, 1).normalize();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const OVERLAY_SAFE_NDC = 0.82;

function includeResidents(
  box: THREE.Box3,
  residents: readonly ResidentProfile[],
  point: THREE.Vector3,
) {
  for (const resident of residents) {
    const { x, z } = resident.location;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    // Renderer residents are grounded at y=0. Their labels/animated hands sit above their bodies.
    box.expandByPoint(point.set(x - 1.25, -0.35, z - 1.25));
    box.expandByPoint(point.set(x + 1.25, 3.4, z + 1.25));
  }
}

/**
 * Exact perspective fit for the eight corners of an AABB, including their depth.
 * In camera basis a corner q has depth D-q.z, so D >= q.z + |q.x| / tan(hfov/2),
 * and likewise for y. Reserving NDC +/-0.82 leaves an additional 9% frame margin.
 */
export function overlayFitDistance(
  box: THREE.Box3,
  center: THREE.Vector3,
  backward: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  right: THREE.Vector3,
  up: THREE.Vector3,
  point: THREE.Vector3,
): number {
  right.crossVectors(WORLD_UP, backward).normalize();
  if (right.lengthSq() < 0.5) right.set(1, 0, 0);
  up.crossVectors(backward, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
  const tanH = tanV * Math.max(0.1, camera.aspect);
  let distance = 8;
  for (let mask = 0; mask < 8; mask++) {
    point
      .set(
        mask & 1 ? box.max.x : box.min.x,
        mask & 2 ? box.max.y : box.min.y,
        mask & 4 ? box.max.z : box.min.z,
      )
      .sub(center);
    const towardCamera = point.dot(backward);
    distance = Math.max(
      distance,
      towardCamera + Math.abs(point.dot(right)) / (tanH * OVERLAY_SAFE_NDC),
      towardCamera + Math.abs(point.dot(up)) / (tanV * OVERLAY_SAFE_NDC),
      towardCamera + camera.near + 0.5,
    );
  }
  return distance;
}

export function CameraRig({ mode, selectedResidentId, transparent = false, quality = 'high' }: { mode: RigMode; selectedResidentId?: string; transparent?: boolean; quality?: 'low' | 'high' }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const store = useSceneStore();
  const kit = useKit();
  const look = useRef(new THREE.Vector3(4.2, 2.0, 0.6));
  const controls = useRef<OrbitLike | null>(null);
  const first = useRef(true);
  const s = useMemo(() => ({
    pos: new THREE.Vector3(), look: new THREE.Vector3(),
    follow: newFramer(), actor: newFramer(),
    cluster: new THREE.Vector3(), clusterS: new THREE.Vector3(), clusterInit: false, clusterAt: -1, orbit: 0.4,
    overlay: newOverlayFit(),
    estAt: -1e9, estNext: 25, estCount: 0, blockedFor: 0,
    cut: new THREE.Vector3(), cutWant: 0, cutR0: 0.35, cutR1: 0.95,
    shotPos: new THREE.Vector3(), shotLook: new THREE.Vector3(), head: new THREE.Vector3(), outFor: 0,
  }), []);
  const cine = useMemo(() => ({
    pos: new THREE.CatmullRomCurve3(CINE_POS.map(p => new THREE.Vector3(...p)), true, 'centripetal'),
    look: new THREE.CatmullRomCurve3(CINE_LOOK.map(p => new THREE.Vector3(...p)), true, 'centripetal'),
    u: 0,
  }), []);
  const overlay = useMemo(() => ({ bounds: new THREE.Box3(), point: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3(), sphere: new THREE.Sphere() }), []);
  const director = useRef<Director>({ kind: 'none', actorId: '', until: 0, lastCut: -1e9, lastPush: -1e9, cutPending: false, raid: false });

  useEffect(() => { s.follow.init = false; }, [selectedResidentId, s]);

  // Event director: cut to what matters (viewer/twitch/demo events only, never simulation chatter).
  useEffect(() => store.onEvent(({ event }) => {
    if (event.source === 'simulation' || !DIRECTED_KINDS.has(event.kind)) return;
    const d = director.current;
    const now = performance.now() / 1000;
    if (d.raid && now < d.until && event.kind !== 'raid') return; // never interrupt a raid shot
    if (event.kind === 'chat' && !event.targetId) {
      // untargeted chat: gentle push-in on the speaker, rate-limited
      if (now - d.lastPush < 8 || (d.kind !== 'none' && now < d.until)) return;
      d.kind = 'speaker'; d.actorId = event.actorId; d.raid = false;
      d.until = now + 5; d.lastPush = now; d.cutPending = false;
      return;
    }
    // coalesce bursts: one transition per window (raids may pre-empt after 1 s, others after 3.5 s)
    if (event.kind !== 'join' && now - d.lastCut < (event.kind === 'raid' ? 1 : 3.5)) return;
    if (event.kind === 'join' && now - d.lastCut < 0.8) return; // joins always get their portal shot (bursts: once per 0.8 s)
    const isPortal = event.kind === 'raid' || event.kind === 'join';
    d.kind = isPortal ? 'portal' : 'actor';
    d.actorId = event.actorId;
    d.raid = event.kind === 'raid';
    d.until = now + (event.kind === 'raid' ? 9 : 6);
    d.lastCut = now;
    d.cutPending = true;
  }), [store]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1);
    const t = state.clock.elapsedTime;
    EXTRA = kit.occluders;
    kit.uniforms.uCutNear.value = mode === 'overlay' ? 0 : 3;
    if (mode === 'orbit') {
      kit.uniforms.uCutOn.value = Math.max(0, kit.uniforms.uCutOn.value - dt * 3);
      kit.uniforms.uCutA.value.copy(camera.position);
      pushOutOfBuildings(camera.position);
      if (first.current) {
        poseFor('orbit', t, s.pos, s.look);
        camera.position.copy(s.pos); look.current.copy(s.look); camera.lookAt(look.current);
        if (controls.current) { controls.current.target.copy(s.look); controls.current.update?.(); }
        first.current = false;
        return;
      }
      if (controls.current) look.current.copy(controls.current.target);
      return;
    }
    let snap = false;
    let rate = 1.4;
    const d = director.current;
    const now = performance.now() / 1000;
    // densest resident group (shared by neighborhood bias, street and cinematic)
    if (s.clusterAt < 0 || t - s.clusterAt > 1.5) {
      s.clusterAt = t;
      if (densestCluster(store, s.cluster) && !s.clusterInit) { s.clusterS.copy(s.cluster); s.clusterInit = true; }
    }
    if (s.clusterInit) s.clusterS.lerp(s.cluster, 1 - Math.exp(-dt * 0.5));
    const directable = mode !== 'overlay';
    const directed = directable && d.kind !== 'none' && now < d.until;
    if (directed) {
      snap = d.cutPending;
      d.cutPending = false;
      if (d.kind === 'portal') {
        const p = PORTAL_POS;
        const age = d.until - now;
        if (snap || s.shotPos.lengthSq() === 0) portalPose(d.raid, s.shotPos, s.shotLook);
        s.pos.copy(s.shotPos); s.pos.x += Math.sin(age * 0.12) * 0.6;
        s.look.copy(s.shotLook);
        void p;
        rate = 2.2;
      } else {
        const r = store.getResident(d.actorId);
        if (!r) d.until = 0;
        else if (d.kind === 'speaker') {
          frame(s.actor, r.location.x, r.location.z, dt, 5.4, mode === 'street' ? 1.8 : 2.5, 1.3, s.pos, s.look, false);
          rate = 1.6;
        } else {
          frame(s.actor, r.location.x, r.location.z, dt, mode === 'street' ? 5.2 : 7.2, mode === 'street' ? 1.9 : 3.3, 1.15, s.pos, s.look, snap);
          rate = 2.2;
        }
      }
      if (d.until === 0) poseFor(mode === 'street' ? 'street' : 'neighborhood', t, s.pos, s.look);
    } else if (mode === 'follow') {
      const r = selectedResidentId ? store.getResident(selectedResidentId) : undefined;
      if (r) frame(s.follow, r.location.x, r.location.z, dt, 6.8, 3.1, 1.15, s.pos, s.look, false);
      else if (transparent) overlayPose(store, s.overlay, camera, t, dt, s.pos, s.look);
      else poseFor('neighborhood', t, s.pos, s.look);
      rate = 2.4;
    } else if (mode === 'cinematic' && quality === 'high' && (t >= s.estNext || t - s.estAt < 8)) {
      // occasional wide establishing pass: plaza + downtown skyline ring + mountains
      if (t >= s.estNext) { s.estAt = t; s.estNext = t + 60 + (s.estCount % 3) * 15; s.estCount++; snap = true; }
      const a = s.estCount * 1.9 + (t - s.estAt) * 0.025;
      s.pos.set(Math.sin(a) * 52, 30, Math.cos(a) * 52);
      s.look.set(-Math.sin(a) * 14, 6, -Math.cos(a) * 14);
      rate = 3;
    } else if (mode === 'cinematic' && s.clusterInit) {
      // slow orbit around the liveliest group; down-angle capped at ~35°
      const onStage = Math.hypot(s.clusterS.x - STAGE_POS.x, s.clusterS.z - STAGE_POS.z) < 3.15;
      const dist = onStage ? 9.4 : 12, h = onStage ? 7.6 : 6.2;
      orbitShot(s, dt, 0.07, dist, h, 1.1);
      rate = 0.9;
    } else if (mode === 'overlay') {
      overlay.bounds.makeEmpty();
      includeResidents(overlay.bounds, store.current.residents, overlay.point);
      if (store.previous) includeResidents(overlay.bounds, store.previous.residents, overlay.point);
      overlay.bounds.expandByPoint(overlay.point.set(PORTAL_POS.x - 3, -0.35, PORTAL_POS.z - 1));
      overlay.bounds.expandByPoint(overlay.point.set(PORTAL_POS.x + 3, 7, PORTAL_POS.z + 1));
      overlay.bounds.getCenter(s.look);
      const distance = overlayFitDistance(overlay.bounds, s.look, OVERLAY_BACK, camera, overlay.right, overlay.up, overlay.point);
      s.pos.copy(s.look).addScaledVector(OVERLAY_BACK, distance);
    } else if (mode === 'cinematic') {
      cine.u = (cine.u + dt / 120) % 1;
      cine.pos.getPointAt(cine.u, s.pos);
      cine.look.getPointAt(cine.u, s.look);
    } else if (mode === 'street' && s.clusterInit) {
      // eye level, aimed at the street/plaza spot with the most residents
      orbitShot(s, dt, 0.035, 8.6, 1.85, 1.35);
      rate = 1.1;
    } else {
      poseFor(mode, t, s.pos, s.look);
      if (mode === 'neighborhood' && s.clusterInit) {
        // subtle bias of the look target towards the densest group (±3 m)
        const bx = Math.max(-3, Math.min(3, s.clusterS.x - 4.2)), bz = Math.max(-3, Math.min(3, s.clusterS.z - 0.2));
        s.look.x += bx; s.look.z += bz;
        s.pos.x += bx * 0.6; s.pos.z += bz * 0.6;
      }
    }
    // See-through cone (WebGL): dissolve props between the camera and the subject in close shots.
    let cutWant = 0;
    if (directed && d.kind === 'portal') { s.cut.set(PORTAL_POS.x, 1.7, PORTAL_POS.z + 2.8); cutWant = 1; s.cutR0 = 0.5; s.cutR1 = d.raid ? 2.2 : 1.6; }
    else if (directed && d.until > 0) { s.cut.set(s.actor.pos.x, 1.25, s.actor.pos.z); cutWant = 1; s.cutR0 = 0.35; s.cutR1 = 0.95; }
    else if (!directed && mode === 'follow' && selectedResidentId && s.follow.init) { s.cut.set(s.follow.pos.x, 1.25, s.follow.pos.z); cutWant = 1; s.cutR0 = 0.35; s.cutR1 = 0.95; }
    else if (!directed && (mode === 'street' || (mode === 'cinematic' && t - s.estAt >= 8)) && s.clusterInit) { s.cut.set(s.clusterS.x, 1.15, s.clusterS.z); cutWant = 1; s.cutR0 = 0.3; s.cutR1 = mode === 'street' ? 0.85 : 1.1; }
    if (first.current || snap) {
      camera.position.copy(s.pos);
      look.current.copy(s.look);
      first.current = false;
    } else {
      const k = 1 - Math.exp(-dt * rate);
      camera.position.lerp(s.pos, k);
      look.current.lerp(s.look, k);
    }
    if (mode === 'overlay') {
      overlay.back.copy(camera.position).sub(look.current);
      const currentDistance = overlay.back.length();
      if (currentDistance > 0.001) overlay.back.multiplyScalar(1 / currentDistance); else overlay.back.copy(OVERLAY_BACK);
      const safeDistance = overlayFitDistance(overlay.bounds, look.current, overlay.back, camera, overlay.right, overlay.up, overlay.point);
      if (safeDistance > currentDistance) camera.position.copy(look.current).addScaledVector(overlay.back, safeDistance);
      overlay.bounds.getBoundingSphere(overlay.sphere);
      const farNeeded = camera.position.distanceTo(overlay.sphere.center) + overlay.sphere.radius + 10;
      if (camera.far < farNeeded) { camera.far = farNeeded; camera.updateProjectionMatrix(); }
    }
    if (mode !== 'overlay') pushOutOfBuildings(camera.position);
    camera.lookAt(look.current);
    // follow: the subject's head must stay inside the frame (≥ 10 % margin), else re-pick + cut
    if (mode === 'follow' && !directed && selectedResidentId && s.follow.init) {
      camera.updateMatrixWorld();
      s.head.set(s.follow.pos.x, 1.75, s.follow.pos.z).project(camera);
      const out = s.head.z > 1 || Math.abs(s.head.x) > 0.8 || Math.abs(s.head.y) > 0.8;
      s.outFor = out ? s.outFor + dt : 0;
      if (s.outFor > 0.4) {
        s.outFor = 0;
        s.follow.rel = -s.follow.rel;
        camera.position.copy(s.pos);
        look.current.copy(s.look);
        camera.lookAt(look.current);
      }
    }
    const u = kit.uniforms;
    u.uCutA.value.copy(camera.position);
    if (snap || u.uCutOn.value < 0.01) u.uCutB.value.copy(s.cut); else u.uCutB.value.lerp(s.cut, Math.min(1, dt * 6));
    u.uCutR.value.set(s.cutR0, s.cutR1);
    u.uCutOn.value += (cutWant - u.uCutOn.value) * Math.min(1, dt * 3.5);
  });

  if (mode !== 'orbit') return null;
  return (
    <OrbitControls
      ref={(c: unknown) => { controls.current = (c as OrbitLike | null) ?? null; }}
      makeDefault target={[look.current.x, look.current.y, look.current.z]} enableDamping dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.46} minDistance={5} maxDistance={170} />
  );
}
