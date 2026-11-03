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
import { findSeatNear, getPoi } from '../world/layout';
import { useKit } from './context';
import {
  OCCLUDERS, blocked, propsNear, centralClutter, foregroundClutter, pickFramingPose, pickTwoShot, poseClean, setCameraProps, POSE_RISE,
  fitPointsToView, pushBackToFit, type PickedPose, type ViewFit,
} from './cameraPose';

export type RigMode = CameraMode | 'overlay';

interface OrbitLike { target: THREE.Vector3; update?: () => void }

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

const PORTAL_CANDIDATES = [0.32, -0.32, 0.55, -0.55, 0.14, -0.14, 0.8, -0.8, 1.05, -1.05];

/**
 * Portal shot (raid / join): picks the first clear angle from a small candidate set so no lamp post,
 * tree or fence stands between camera and arrivals. Arrivals sit in the upper-middle third.
 */
function portalPose(raid: boolean, outPos: THREE.Vector3, outLook: THREE.Vector3) {
  const tx = PORTAL_POS.x, tz = PORTAL_POS.z + 2.6, ty = 1.0;
  const D = raid ? 13.5 : 10, H = raid ? 4.4 : 3.2;
  let a = PORTAL_CANDIDATES[0]!;
  for (let i = 0; i < PORTAL_CANDIDATES.length; i++) {
    const c = PORTAL_CANDIDATES[i]!;
    const cx = tx + Math.sin(c) * D, cz = tz + Math.cos(c) * D;
    if (!blocked(cx, H, cz, tx, ty + 0.6, tz) && !propsNear(cx, H, cz, tx, ty, tz, 1.2) && !foregroundClutter(cx, cz, tx, tz) && !centralClutter(cx, H, cz, tx, ty + 0.6, tz)) { a = c; break; }
  }
  outPos.set(tx + Math.sin(a) * D, H, tz + Math.cos(a) * D);
  // aim ~1 m below the arrivals so they sit slightly above centre (upper-middle third)
  outLook.set(tx, ty - (raid ? 0.7 : 0.5), tz);
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

/**
 * Event director state. All times are on the render clock (`state.clock.elapsedTime`): events are queued
 * by `store.onEvent` and accepted inside useFrame. A shot's hold (`hold` s) starts when its subjects are
 * actually in frame (`acquired`); until then `until` is a short acquisition window.
 */
interface Director {
  kind: 'none' | 'actor' | 'portal' | 'speaker' | 'two';
  actorId: string;
  targetId: string;
  until: number;
  start: number;
  hold: number;
  acquired: boolean;
  recut: boolean;
  offFor: number;
  lastCut: number;
  lastPush: number;
  cutPending: boolean;
  raid: boolean;
  /** last raid / join (render clock): the overlay keeps the portal in its fit for a while */
  portalAt: number;
  queue: WorldEvent[];
}

/** Two-shot only while actor and target are close enough to read together. */
const TWO_SHOT_MAX_SEP = 16;

function acceptEvent(d: Director, event: WorldEvent, t: number, store: SceneStore) {
  if (event.kind === 'raid' || event.kind === 'join') d.portalAt = t;
  if (d.raid && t < d.until && event.kind !== 'raid') return; // never interrupt a raid shot
  const shot = (kind: Director['kind'], hold: number) => {
    d.kind = kind; d.actorId = event.actorId; d.targetId = event.targetId ?? '';
    d.raid = event.kind === 'raid'; d.start = t; d.hold = hold; d.acquired = false; d.recut = false; d.offFor = 0;
    d.until = t + 3.2; // acquisition window; the hold starts once the subjects are in frame
  };
  if (event.kind === 'chat' && !event.targetId) {
    // untargeted chat: gentle push-in on the speaker, rate-limited
    if (t - d.lastPush < 8 || (d.kind !== 'none' && t < d.until)) return;
    shot('speaker', 5); d.lastPush = t; d.cutPending = false;
    return;
  }
  // coalesce bursts: one transition per window (raids may pre-empt after 1 s, others after 3.5 s)
  if (event.kind !== 'join' && t - d.lastCut < (event.kind === 'raid' ? 1 : 3.5)) return;
  if (event.kind === 'join' && t - d.lastCut < 0.8) return; // joins always get their portal shot (bursts: once per 0.8 s)
  const isPortal = event.kind === 'raid' || event.kind === 'join';
  let kind: Director['kind'] = isPortal ? 'portal' : 'actor';
  if (!isPortal && event.targetId && event.targetId !== event.actorId) {
    const a = store.getResident(event.actorId), b = store.getResident(event.targetId);
    if (a && b && Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z) <= TWO_SHOT_MAX_SEP) kind = 'two';
    else if (b && (event.kind === 'gift' || !a)) { kind = 'actor'; shot(kind, 6); d.actorId = event.targetId; d.targetId = ''; d.lastCut = t; d.cutPending = true; return; }
  }
  shot(kind, event.kind === 'raid' ? 9 : 6);
  d.lastCut = t;
  d.cutPending = true;
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
  /** Rung of the height ladder (0 = shoulder height); rises instead of accepting clutter. */
  level: number;
  hS: number;              // smoothed camera height
  dS: number;              // smoothed camera distance
  sincePick: number;
}
const newFramer = (): Framer => ({ pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, rel: 0.62, yaw: 0, init: false, level: 0, hS: 0, dS: 0, sincePick: 0 });
const PICK: PickedPose = { x: 0, y: 0, z: 0, yaw: 0, rel: 0.62, level: 0 };

/**
 * `facing`: the rendered avatar's yaw (NaN when unknown). A standing / idle subject is framed from the
 * side it faces (residents turn to their partner), so single-actor shots read front three-quarter.
 */
function frame(f: Framer, tx: number, tz: number, dt: number, dist: number, height: number, lookY: number, outPos: THREE.Vector3, outLook: THREE.Vector3, snap: boolean, facing = NaN) {
  if (!f.init || snap) { f.pos.set(tx, 0, tz); f.prev.copy(f.pos); f.vel.set(0, 0, 0); f.init = true; f.hS = height; f.dS = dist; f.level = 0; }
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
  else {
    // seated: face the subject from the front (seat facing) instead of their last walking heading
    const seat = findSeatNear(f.pos.x, f.pos.z, 0.7);
    if (seat) f.heading = snap ? seat.seat.facing : angleLerp(f.heading, seat.seat.facing, 1 - Math.exp(-dt * 2));
    else if (Number.isFinite(facing)) f.heading = snap ? facing : angleLerp(f.heading, facing, 1 - Math.exp(-dt * 1.2));
  }
  const ly = lookY;
  const headY = lookY + 0.45;
  // Keep the current pose while it is clean; otherwise (or every ~1.5 s while raised) re-pick:
  // every relative yaw on each rung of the height ladder — clutter is never accepted, the camera rises instead.
  f.sincePick += dt;
  const lvlH = height + POSE_RISE[f.level]!, lvlD = dist * (1 + f.level * 0.12);
  const cy = f.heading + f.rel;
  const clean = poseClean(f.pos.x + Math.sin(cy) * lvlD, lvlH, f.pos.z + Math.cos(cy) * lvlD, f.pos.x, headY, f.pos.z);
  if (snap || !clean || (f.level > 0 && f.sincePick > 1.5)) {
    f.sincePick = 0;
    pickFramingPose(f.pos.x, f.pos.z, headY, f.heading, dist, height, PICK, f.rel);
    f.rel = PICK.rel; f.level = PICK.level;
  }
  const hT = height + POSE_RISE[f.level]!, dT = dist * (1 + f.level * 0.12);
  const ks = snap ? 1 : 1 - Math.exp(-dt * 1.6);
  f.hS += (hT - f.hS) * ks; f.dS += (dT - f.dS) * ks;
  const targetYaw = f.heading + f.rel;
  f.yaw = snap ? targetYaw : angleLerp(f.yaw, targetYaw, 1 - Math.exp(-dt * 1.8));
  const ahead = Math.min(2, speed * 0.6);
  const hx = speed > 0.01 ? f.vel.x / speed : 0, hz = speed > 0.01 ? f.vel.z / speed : 0;
  outLook.set(f.pos.x + hx * ahead, ly, f.pos.z + hz * ahead);
  outPos.set(f.pos.x + Math.sin(f.yaw) * f.dS, f.hS, f.pos.z + Math.cos(f.yaw) * f.dS);
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

interface OrbitState { pos: THREE.Vector3; look: THREE.Vector3; clusterS: THREE.Vector3; orbit: number; blockedFor: number; rise: number; riseT: number }

/** Camera must stay outside the stage's string-light ring (plus margin). */
const outsideStageRing = (x: number, z: number) => Math.hypot(x - STAGE_POS.x, z - STAGE_POS.z) > 4.4;
const ORBIT_OFFS = [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8, 2.4, -2.4];
const ORBIT_LIFTS = [0, 2.5, 5];

function orbitClean(o: OrbitState, a: number, dist: number, h: number, headY: number): boolean {
  const cx = o.clusterS.x + Math.sin(a) * dist, cz = o.clusterS.z + Math.cos(a) * dist;
  return outsideStageRing(cx, cz) && poseClean(cx, h, cz, o.clusterS.x, headY, o.clusterS.z);
}

/**
 * Slow orbit around the smoothed group centre (street / cinematic drift). The same clutter, lens and
 * occlusion tests as follow: on a dirty pose it jumps to the nearest clean yaw offset, and rises
 * (2.5 m, 5 m) rather than accepting a prop in the central third.
 */
function orbitShot(o: OrbitState, dt: number, speed: number, dist: number, h: number, lookY: number) {
  const headY = lookY + 0.45;
  if (orbitClean(o, o.orbit, dist, h + o.riseT, headY)) {
    o.blockedFor = 0;
    o.orbit += dt * speed;
    if (o.riseT > 0 && orbitClean(o, o.orbit, dist, h, headY)) o.riseT = 0;
  } else {
    o.blockedFor += dt;
    if (o.blockedFor > 0.25) {
      o.blockedFor = 0;
      let done = false;
      for (let li = 0; li < ORBIT_LIFTS.length && !done; li++) {
        for (let i = 0; i < ORBIT_OFFS.length; i++) {
          if (orbitClean(o, o.orbit + ORBIT_OFFS[i]!, dist, h + ORBIT_LIFTS[li]!, headY)) { o.orbit += ORBIT_OFFS[i]!; o.riseT = ORBIT_LIFTS[li]!; done = true; break; }
        }
      }
      if (!done) o.riseT = ORBIT_LIFTS[ORBIT_LIFTS.length - 1]!;
    }
  }
  o.rise += (o.riseT - o.rise) * Math.min(1, dt * 1.5);
  o.pos.set(o.clusterS.x + Math.sin(o.orbit) * dist, h + o.rise, o.clusterS.z + Math.cos(o.orbit) * dist);
  o.look.set(o.clusterS.x, lookY, o.clusterS.z);
}

/* ----------------------------------------------------------------- rig */

/** Fixed overlay viewing direction (steady fit). */
const OVERLAY_BACK = new THREE.Vector3(0, 0.58, 1).normalize();
/** Every fitted point stays inside NDC ±0.82 (9 % frame margin). */
const OVERLAY_SAFE_NDC = 0.82;
/** Overlay event shots: subjects ≈ 24 % of the frame height at most (≈ 170 px at 720p), lower angle. */
const OVERLAY_SHOT_MIN_DEPTH = 9.5;
const OVERLAY_SHOT_ELEV = 0.36;
const OVERLAY_MAX_POINTS = 4096;
/** Steady envelope per resident: ±0.7 m (gestures, nameplate width), feet to nameplate top. */
const STEADY_HALF = 0.7, STEADY_TOP = 2.9;
/** Event-shot envelope: closer camera → smaller nameplate in metres. */
const SHOT_HALF = 0.55, SHOT_TOP = 2.4;

function pushBox(buf: Float64Array, n: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  if (n + 8 > OVERLAY_MAX_POINTS) return n;
  for (let m = 0; m < 8; m++) {
    const o = (n + m) * 3;
    buf[o] = m & 1 ? x1 : x0; buf[o + 1] = m & 2 ? y1 : y0; buf[o + 2] = m & 4 ? z1 : z0;
  }
  return n + 8;
}

export function CameraRig({ mode, selectedResidentId, transparent = false, quality = 'high', overlayEventShots = true }: {
  mode: RigMode; selectedResidentId?: string; transparent?: boolean; quality?: 'low' | 'high';
  /** Overlay only: short directed shots that exact-fit an event's subjects (default true; false = static fit). */
  overlayEventShots?: boolean;
}) {
  const camera = useThree(st => st.camera) as THREE.PerspectiveCamera;
  const scene = useThree(st => st.scene);
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
    estAt: -1e9, estNext: 25, estCount: 0, blockedFor: 0, rise: 0, riseT: 0,
    cut: new THREE.Vector3(), cutWant: 0, cutR0: 0.35, cutR1: 0.95,
    shotPos: new THREE.Vector3(), shotLook: new THREE.Vector3(), head: new THREE.Vector3(), outFor: 0,
    subA: new THREE.Vector3(), subB: new THREE.Vector3(), hasA: false, hasB: false,
    two: { x: 0, y: 0, z: 0, yaw: 0, rel: 1, level: 0, dist: 8 } as PickedPose & { dist: number },
    twoMid: new THREE.Vector3(), twoAt: 0, twoNeed: 0,
    lookS: new THREE.Vector3(), shotKey: -1,
  }), []);
  const cine = useMemo(() => ({
    pos: new THREE.CatmullRomCurve3(CINE_POS.map(p => new THREE.Vector3(...p)), true, 'centripetal'),
    look: new THREE.CatmullRomCurve3(CINE_LOOK.map(p => new THREE.Vector3(...p)), true, 'centripetal'),
    u: 0,
  }), []);
  const ov = useMemo(() => ({
    pts: new Float64Array(OVERLAY_MAX_POINTS * 3), n: 0,
    sub: new Float64Array(64 * 3 * 8), sn: 0,
    fit: { x: 0, y: 0, z: 0, depth: 0 } as ViewFit,
    back: new THREE.Vector3(), shotBack: new THREE.Vector3(), tmp: new THREE.Vector3(),
    sphere: new THREE.Sphere(), box: new THREE.Box3(), shotOn: false, shotKey: -1,
  }), []);
  const groups = useMemo(() => ({ map: new Map<string, THREE.Object3D>(), miss: new Map<string, number>() }), []);
  const director = useRef<Director>({
    kind: 'none', actorId: '', targetId: '', until: 0, start: 0, hold: 6, acquired: false, recut: false, offFor: 0,
    lastCut: -1e9, lastPush: -1e9, cutPending: false, raid: false, portalAt: -1e9, queue: [],
  });

  useEffect(() => { s.follow.init = false; }, [selectedResidentId, s]);

  // Event director: queue what matters (viewer/twitch/demo events only, never simulation chatter); the
  // render loop accepts them on the render clock.
  useEffect(() => store.onEvent(({ event }) => {
    if (event.source === 'simulation' || !DIRECTED_KINDS.has(event.kind)) return;
    const q = director.current.queue;
    if (q.length < 32) q.push(event);
  }), [store]);

  /** Rendered avatar group (`resident:<id>` in ResidentsLayer); misses are retried at most every 0.5 s. */
  const groupOf = (id: string, t: number): THREE.Object3D | undefined => {
    const g = groups.map.get(id);
    if (g && g.parent) return g;
    if (g) groups.map.delete(id);
    const missAt = groups.miss.get(id);
    if (missAt !== undefined && t - missAt < 0.5) return undefined;
    const found = scene.getObjectByName(`resident:${id}`);
    if (found) { groups.map.set(id, found); groups.miss.delete(id); } else groups.miss.set(id, t);
    return found;
  };
  /** Where the resident is drawn (falls back to the snapshot); returns the rendered yaw or NaN. */
  const subjectAt = (id: string, t: number, out: THREE.Vector3): { ok: boolean; yaw: number } => {
    const g = groupOf(id, t);
    if (g) { g.getWorldPosition(out); out.y = 0; return { ok: true, yaw: g.rotation.y }; }
    const r = store.getResident(id);
    if (!r) return { ok: false, yaw: NaN };
    out.set(r.location.x, 0, r.location.z);
    const p = store.previous?.residents.find(q => q.id === id);
    const mx = p ? r.location.x - p.location.x : 0, mz = p ? r.location.z - p.location.z : 0;
    return { ok: true, yaw: mx * mx + mz * mz > 0.04 ? Math.atan2(mx, mz) : NaN };
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1);
    const t = state.clock.elapsedTime;
    setCameraProps(kit.occluders);
    kit.uniforms.uCutNear.value = 0; // no screen-door near the lens: camera placement avoids props instead
    if (mode === 'orbit') {
      kit.uniforms.uCutOn.value = Math.max(0, kit.uniforms.uCutOn.value - dt * 3);
      kit.uniforms.uCutA.value.copy(camera.position);
      pushOutOfBuildings(camera.position);
      kit.env.camPos.copy(camera.position);
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
    let lookRate = 0;
    const d = director.current;
    for (let i = 0; i < d.queue.length; i++) acceptEvent(d, d.queue[i]!, t, store);
    d.queue.length = 0;
    // densest resident group (shared by neighborhood bias, street and cinematic)
    if (s.clusterAt < 0 || t - s.clusterAt > 1.5) {
      s.clusterAt = t;
      if (densestCluster(store, s.cluster) && !s.clusterInit) { s.clusterS.copy(s.cluster); s.clusterInit = true; }
    }
    if (s.clusterInit) s.clusterS.lerp(s.cluster, 1 - Math.exp(-dt * 0.5));
    const overlayMode = mode === 'overlay';
    const directable = !overlayMode || overlayEventShots;
    const directed = directable && d.kind !== 'none' && t < d.until;
    if (!directed && d.kind !== 'none' && t >= d.until) d.kind = 'none';
    // subjects of the current shot (rendered positions)
    s.hasA = false; s.hasB = false;
    let facingA = NaN;
    if (directed && d.kind !== 'portal') {
      const a = subjectAt(d.actorId, t, s.subA); s.hasA = a.ok; facingA = a.yaw;
      if (d.kind === 'two') {
        s.hasB = subjectAt(d.targetId, t, s.subB).ok;
        if (!s.hasB) d.kind = 'actor';
      }
      if (!s.hasA) { if (s.hasB) { s.subA.copy(s.subB); s.hasA = true; s.hasB = false; d.kind = 'actor'; } else d.until = 0; }
    }
    const shotOn = directed && d.until > 0;
    if (shotOn && !overlayMode) {
      snap = d.cutPending;
      d.cutPending = false;
      lookRate = 4.5; // centre the subject quickly; the position glides
      if (d.kind === 'portal') {
        const age = d.until - t;
        if (snap || s.shotPos.lengthSq() === 0) portalPose(d.raid, s.shotPos, s.shotLook);
        s.pos.copy(s.shotPos); s.pos.x += Math.sin(age * 0.12) * 0.6;
        s.look.copy(s.shotLook);
        rate = 2.2;
      } else if (d.kind === 'two') {
        // TWO-SHOT: perpendicular to the actor–target axis, both inside the central 60 %
        const street = mode === 'street';
        const height = street ? 1.9 : 3.0, minDist = street ? 5.6 : 7.0, headY = 1.55;
        const mx = (s.subA.x + s.subB.x) / 2, mz = (s.subA.z + s.subB.z) / 2;
        if (snap) s.twoMid.set(mx, 0, mz); else s.twoMid.lerp(s.lookS.set(mx, 0, mz), 1 - Math.exp(-dt * 3));
        const sep = s.subA.distanceTo(s.subB);
        const need = Math.max(minDist, (sep / 2 + 0.45) / (0.6 * 0.6825));
        let repick = snap;
        if (!repick && t - s.twoAt > 0.5) {
          s.twoAt = t;
          const cx = s.twoMid.x + Math.sin(s.two.yaw) * s.two.dist, cz = s.twoMid.z + Math.cos(s.two.yaw) * s.two.dist;
          repick = need > s.two.dist * 1.08 || !poseClean(cx, s.two.y, cz, s.subA.x, headY, s.subA.z) || !poseClean(cx, s.two.y, cz, s.subB.x, headY, s.subB.z);
        }
        if (repick) {
          s.twoAt = t;
          // prefer the side nearer the current camera (less disorienting), then the other
          const axis = Math.atan2(s.subB.x - s.subA.x, s.subB.z - s.subA.z);
          const px = mx + Math.sin(axis + Math.PI / 2), pz = mz + Math.cos(axis + Math.PI / 2);
          const nx = mx + Math.sin(axis - Math.PI / 2), nz = mz + Math.cos(axis - Math.PI / 2);
          const pref = Math.hypot(camera.position.x - px, camera.position.z - pz) <= Math.hypot(camera.position.x - nx, camera.position.z - nz) ? 1 : -1;
          if (!pickTwoShot(s.subA.x, s.subA.z, s.subB.x, s.subB.z, headY, height, minDist, pref, s.two)) {
            // no clean two-shot: front three-quarter on the actor, who faces the target
            d.kind = 'actor'; d.cutPending = true; d.targetId = '';
          } else if (!snap) { d.cutPending = true; } // a re-pick is a cut, never a swing through the scene
          s.twoMid.set(mx, 0, mz);
        }
        s.pos.set(s.twoMid.x + Math.sin(s.two.yaw) * s.two.dist, s.two.y, s.twoMid.z + Math.cos(s.two.yaw) * s.two.dist);
        s.look.set(s.twoMid.x, 1.1, s.twoMid.z);
        rate = 2.2;
      }
      if (d.kind === 'actor' || d.kind === 'speaker') {
        // new subject: start from the front three-quarter of the way the avatar faces
        if (snap || s.shotKey !== d.start) { s.shotKey = d.start; s.actor.rel = 0.62; if (snap) s.actor.init = false; if (Number.isFinite(facingA)) s.actor.heading = facingA; }
        if (d.kind === 'speaker') {
          frame(s.actor, s.subA.x, s.subA.z, dt, 5.4, mode === 'street' ? 1.8 : 2.5, 1.3, s.pos, s.look, snap, facingA);
          rate = 1.6;
        } else {
          frame(s.actor, s.subA.x, s.subA.z, dt, mode === 'street' ? 5.2 : 7.2, mode === 'street' ? 1.9 : 3.3, 1.15, s.pos, s.look, snap, facingA);
          rate = 2.2;
        }
      }
    } else if (overlayMode) {
      // ---- OBS overlay: steady exact fit of every rendered resident; event shots fit only the subjects
      const rs = store.current.residents;
      let n = 0;
      const pts = ov.pts;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i]!;
        const { x, z } = r.location;
        if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
        const g = groupOf(r.id, t);
        if (g && !g.visible) continue; // not drawn by the renderer
        n = pushBox(pts, n, x - STEADY_HALF, 0, z - STEADY_HALF, x + STEADY_HALF, STEADY_TOP, z + STEADY_HALF);
        if (g) { g.getWorldPosition(ov.tmp); n = pushBox(pts, n, ov.tmp.x - STEADY_HALF, 0, ov.tmp.z - STEADY_HALF, ov.tmp.x + STEADY_HALF, STEADY_TOP, ov.tmp.z + STEADY_HALF); }
        else {
          const p = store.previous?.residents.find(q => q.id === r.id);
          if (p) n = pushBox(pts, n, p.location.x - STEADY_HALF, 0, p.location.z - STEADY_HALF, p.location.x + STEADY_HALF, STEADY_TOP, p.location.z + STEADY_HALF);
        }
      }
      // the portal only while it matters: a recent raid / join, or residents at the portal
      let nearPortal = t - d.portalAt < 14;
      for (let i = 0; i < rs.length && !nearPortal; i++) nearPortal = Math.hypot(rs[i]!.location.x - PORTAL_POS.x, rs[i]!.location.z - PORTAL_POS.z) < 7;
      if (nearPortal || n === 0) n = pushBox(pts, n, PORTAL_POS.x - 3.1, 0, PORTAL_POS.z - 0.9, PORTAL_POS.x + 3.1, 5.6, PORTAL_POS.z + 0.9);
      ov.n = n;
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
      const aspect = camera.aspect || 16 / 9;
      // event subjects
      ov.sn = 0;
      if (shotOn) {
        const sub = ov.sub;
        let sn = 0;
        if (d.kind === 'portal') {
          sn = pushBox(sub, sn, PORTAL_POS.x - 3.1, 0, PORTAL_POS.z - 0.9, PORTAL_POS.x + 3.1, 5.6, PORTAL_POS.z + 0.9);
          if (d.raid || d.kind === 'portal') {
            // arriving visitors: everyone within 9 m of the portal (rendered position)
            for (let i = 0; i < rs.length && sn + 8 <= 64 * 8; i++) {
              const r = rs[i]!;
              if (Math.hypot(r.location.x - PORTAL_POS.x, r.location.z - PORTAL_POS.z) > 9) continue;
              const g = groupOf(r.id, t);
              if (g && !g.visible) continue;
              const q = g ? g.getWorldPosition(ov.tmp) : ov.tmp.set(r.location.x, 0, r.location.z);
              sn = pushBox(sub, sn, q.x - SHOT_HALF, 0, q.z - SHOT_HALF, q.x + SHOT_HALF, SHOT_TOP, q.z + SHOT_HALF);
            }
          }
          ov.shotBack.set(0, Math.sin(0.3), Math.cos(0.3));
        } else {
          sn = pushBox(sub, sn, s.subA.x - SHOT_HALF, 0, s.subA.z - SHOT_HALF, s.subA.x + SHOT_HALF, SHOT_TOP, s.subA.z + SHOT_HALF);
          const ra = store.getResident(d.actorId);
          if (ra && d.kind !== 'two') sn = pushBox(sub, sn, ra.location.x - SHOT_HALF, 0, ra.location.z - SHOT_HALF, ra.location.x + SHOT_HALF, SHOT_TOP, ra.location.z + SHOT_HALF);
          let yaw = 0;
          if (d.kind === 'two' && s.hasB) {
            sn = pushBox(sub, sn, s.subB.x - SHOT_HALF, 0, s.subB.z - SHOT_HALF, s.subB.x + SHOT_HALF, SHOT_TOP, s.subB.z + SHOT_HALF);
            const axis = Math.atan2(s.subB.x - s.subA.x, s.subB.z - s.subA.z);
            const y1 = axis + Math.PI / 2, y2 = axis - Math.PI / 2;
            yaw = Math.cos(y1) >= Math.cos(y2) ? y1 : y2; // the side facing the usual overlay view
          } else if (Number.isFinite(facingA)) yaw = facingA;  // front of the actor
          yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
          yaw = Math.max(-0.9, Math.min(0.9, yaw));
          if (ov.shotKey !== d.start) ov.shotBack.set(Math.sin(yaw) * Math.cos(OVERLAY_SHOT_ELEV), Math.sin(OVERLAY_SHOT_ELEV), Math.cos(yaw) * Math.cos(OVERLAY_SHOT_ELEV));
        }
        ov.sn = sn;
        ov.shotKey = d.start;
        fitPointsToView(sub, sn, ov.shotBack.x, ov.shotBack.y, ov.shotBack.z, tanV, aspect, OVERLAY_SAFE_NDC, d.kind === 'portal' ? 0 : OVERLAY_SHOT_MIN_DEPTH, camera.near + 0.5, ov.fit);
        s.pos.set(ov.fit.x, ov.fit.y, ov.fit.z);
        s.look.copy(s.pos).addScaledVector(ov.shotBack, -Math.max(4, ov.fit.depth));
        rate = 1.8;
        d.cutPending = false;
        if (!ov.shotOn) ov.shotOn = true;
      } else {
        if (ov.shotOn) ov.shotOn = false;
        fitPointsToView(pts, n, OVERLAY_BACK.x, OVERLAY_BACK.y, OVERLAY_BACK.z, tanV, aspect, OVERLAY_SAFE_NDC, 0, camera.near + 0.5, ov.fit);
        s.pos.set(ov.fit.x, ov.fit.y, ov.fit.z);
        s.look.copy(s.pos).addScaledVector(OVERLAY_BACK, -Math.max(4, ov.fit.depth));
        rate = d.kind === 'none' && t - d.start < d.hold + 6 ? 1.0 : 1.4;
      }
    } else if (mode === 'follow') {
      const r = selectedResidentId ? store.getResident(selectedResidentId) : undefined;
      if (r && selectedResidentId) {
        const f = subjectAt(selectedResidentId, t, s.subA);
        frame(s.follow, f.ok ? s.subA.x : r.location.x, f.ok ? s.subA.z : r.location.z, dt, 6.8, 3.1, 1.15, s.pos, s.look, false, f.yaw);
      }
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
      // slow orbit around the liveliest group; down-angle capped at ~35°. On the stage: a low, closer
      // orbit that looks UNDER the string-light span (never down through it).
      const onStage = Math.hypot(s.clusterS.x - STAGE_POS.x, s.clusterS.z - STAGE_POS.z) < 3.15;
      const dist = onStage ? 6.6 : 12, h = onStage ? 2.05 : 6.2;
      orbitShot(s, dt, 0.07, dist, h, 1.1);
      rate = 0.9;
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
    // See-through cone (WebGL): only for wide / drifting shots. Close event shots pick clean poses instead
    // (the dither reads as a glitch up close).
    let cutWant = 0;
    if (!shotOn && mode === 'follow' && selectedResidentId && s.follow.init) { s.cut.set(s.follow.pos.x, 1.25, s.follow.pos.z); cutWant = 1; s.cutR0 = 0.35; s.cutR1 = 0.95; }
    else if (!shotOn && (mode === 'street' || (mode === 'cinematic' && t - s.estAt >= 8)) && s.clusterInit) { s.cut.set(s.clusterS.x, 1.15, s.clusterS.z); cutWant = 1; s.cutR0 = 0.3; s.cutR1 = mode === 'street' ? 0.85 : 1.1; }
    if (first.current || snap) {
      camera.position.copy(s.pos);
      look.current.copy(s.look);
      first.current = false;
    } else {
      const k = 1 - Math.exp(-dt * rate);
      camera.position.lerp(s.pos, k);
      look.current.lerp(s.look, lookRate > 0 ? 1 - Math.exp(-dt * lookRate) : k);
    }
    if (overlayMode) {
      // Guarantee: nothing fitted leaves NDC ±0.82 — the steady set when no shot runs, the subjects during a shot.
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
      ov.back.copy(camera.position).sub(look.current);
      if (ov.back.lengthSq() < 1e-6) ov.back.copy(OVERLAY_BACK); else ov.back.normalize();
      const usePts = shotOn ? ov.sub : ov.pts, useN = shotOn ? ov.sn : ov.n;
      const push = pushBackToFit(usePts, useN, camera.position.x, camera.position.y, camera.position.z, ov.back.x, ov.back.y, ov.back.z, tanV, camera.aspect || 16 / 9, OVERLAY_SAFE_NDC, camera.near + 0.5);
      if (push > 0) camera.position.addScaledVector(ov.back, push);
      // hold starts once the glide has (nearly) arrived
      if (shotOn && !d.acquired && (camera.position.distanceTo(s.pos) < 0.12 * Math.max(4, ov.fit.depth) || t - d.start > 2.6)) { d.acquired = true; d.until = t + d.hold; }
      ov.box.makeEmpty();
      for (let i = 0; i < ov.n; i++) ov.box.expandByPoint(ov.tmp.set(ov.pts[i * 3]!, ov.pts[i * 3 + 1]!, ov.pts[i * 3 + 2]!));
      if (!ov.box.isEmpty()) {
        ov.box.getBoundingSphere(ov.sphere);
        const farNeeded = camera.position.distanceTo(ov.sphere.center) + ov.sphere.radius + 10;
        if (camera.far < farNeeded) { camera.far = farNeeded; camera.updateProjectionMatrix(); }
      }
    }
    if (!overlayMode) pushOutOfBuildings(camera.position);
    camera.lookAt(look.current);
    // Directed shots (world view): hold from acquisition; subjects must stay inside the central 60 %.
    if (shotOn && !overlayMode) {
      camera.updateMatrixWorld();
      let inFrame = true, central = true;
      const check = (x: number, y: number, z: number) => {
        s.head.set(x, y, z).project(camera);
        if (s.head.z > 1 || Math.abs(s.head.x) > 0.8 || Math.abs(s.head.y) > 0.88) inFrame = false;
        if (s.head.z > 1 || Math.abs(s.head.x) > 0.6 || Math.abs(s.head.y) > 0.75) central = false;
      };
      if (d.kind === 'portal') check(PORTAL_POS.x, 1.4, PORTAL_POS.z + 2.6);
      else {
        if (s.hasA) { check(s.subA.x, 1.5, s.subA.z); check(s.subA.x, 0.3, s.subA.z); }
        if (d.kind === 'two' && s.hasB) { check(s.subB.x, 1.5, s.subB.z); check(s.subB.x, 0.3, s.subB.z); }
      }
      if (!d.acquired) {
        if (inFrame) { d.acquired = true; d.until = t + d.hold; }
        else if (!d.recut && t - d.start > 1.4) { d.recut = true; d.cutPending = true; }
        else if (t - d.start > 3) d.until = t; // never acquired: give up rather than hold an empty shot
      } else {
        d.offFor = central ? 0 : d.offFor + dt;
        if (d.offFor > 0.6) { d.offFor = 0; d.cutPending = true; }
      }
    }
    // follow: the subject's head must stay inside the frame (≥ 10 % margin), else re-pick + cut
    if (mode === 'follow' && !shotOn && selectedResidentId && s.follow.init) {
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
    kit.env.camPos.copy(camera.position);
    const u = kit.uniforms;
    u.uCutA.value.copy(camera.position);
    if (snap || u.uCutOn.value < 0.01) u.uCutB.value.copy(s.cut); else u.uCutB.value.lerp(s.cut, Math.min(1, dt * 6));
    u.uCutR.value.set(s.cutR0, s.cutR1);
    u.uCutOn.value += (cutWant - u.uCutOn.value) * Math.min(1, dt * (cutWant ? 3.5 : 6));
  });

  if (mode !== 'orbit') return null;
  return (
    <OrbitControls
      ref={(c: unknown) => { controls.current = (c as OrbitLike | null) ?? null; }}
      makeDefault target={[look.current.x, look.current.y, look.current.z]} enableDamping dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.46} minDistance={5} maxDistance={170} />
  );
}
