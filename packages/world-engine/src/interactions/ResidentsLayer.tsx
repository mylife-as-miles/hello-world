/**
 * ResidentsLayer — renders every resident with a HumanoidRig + AvatarAnimator,
 * follows ~2 Hz snapshots smoothly, reacts to fresh events (gestures, gifts,
 * emotes, speech bubbles) and handles selection/LOD.
 * React re-renders only on structure changes (and rare per-resident LOD swaps
 * or bubble start/end); all motion happens in useFrame.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AvatarAppearance, WorldEvent } from '@hello-world/contracts';
import { useSceneStore } from '../core/SceneContext';
import type { ResidentStructure, SceneStore } from '../core/sceneStore';
import { useAvatarRig, type AvatarLod } from '../avatars/index';
import { hashString } from '../avatars/catalog';
import { animationForVerb, parseActivityVerb, type AnimationFamily } from '../world/activities';
import { BUILDINGS, findSeatNear, getPoi } from '../world/layout';
import { AvatarAnimator, RUN_SPEED, WALK_SPEED, type GestureName } from './animation/AvatarAnimator';
import { EmoteSystem, GiftSystem, InstancedEmoteSystem, makeBlobTexture, makeNameplateTexture, type EmoteKind } from './effects';

/** Common surface of the sprite (high) and instanced (low) emote pools. */
interface EmotePool {
  readonly group: THREE.Group;
  spawn(kind: EmoteKind, x: number, y: number, z: number, count?: number, spread?: number, scale?: number): void;
  update(dt: number, camera?: THREE.Camera): void;
  dispose(): void;
}

export interface ResidentsLayerProps {
  selectedResidentId?: string;
  onResidentSelect?: (id: string) => void;
  quality?: 'low' | 'high';
  viewerResidentId?: string;
  /**
   * Transparent stream-overlay mode: there is no ground, so residents never sit
   * or sleep on empty air. They only sit on layout seats (the overlay scene draws
   * benches + café chairs, see scene/town.ts) when OVERLAY_SEATS_DRAWN, else stand.
   * Defaults to auto: true when the canvas is transparent and the scene has no background.
   */
  overlay?: boolean;
}

const TELEPORT_DISTANCE = 8;
/** Max simultaneous speech bubbles: world high / world low / overlay. Over the cap the OLDEST collapse into "Name …". */
const BUBBLE_MAX_VISIBLE = 6;
const BUBBLE_MAX_VISIBLE_LOW = 5;
const BUBBLE_MAX_VISIBLE_OVERLAY = 3;
/** Vertical gap (px) between stacked bubbles. */
const BUBBLE_STACK_GAP = 6;
/** Bubble safe area: viewport inset (px); HUD/banner/inspector rects are excluded too. */
const SAFE_MARGIN = 12;
const MAX_OBSTACLES = 8;
/** Labels may slide below a bubble by at most this much (px) — farther would detach them from the body. */
const LABEL_MAX_NUDGE = 42;

/** Building boxes (from the layout) for cheap label occlusion: centre, yaw cos/sin, half extents, height. */
const BUILDING_BOXES = BUILDINGS.map(b => ({
  x: b.position.x, z: b.position.z, c: Math.cos(b.rotation), s: Math.sin(b.rotation),
  hw: Math.max(0.5, b.width / 2 - 0.15), hd: Math.max(0.5, b.depth / 2 - 0.15), h: b.kind === 'arcade' ? 6 : 5.5,
}));

/** Segment A→B (world) vs rotated building boxes (slab test in each box frame). */
function occludedByBuilding(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  for (let i = 0; i < BUILDING_BOXES.length; i++) {
    const B = BUILDING_BOXES[i]!;
    const ux = ax - B.x, uz = az - B.z, vx = bx - B.x, vz = bz - B.z;
    // world → box local (inverse yaw)
    const p0x = ux * B.c - uz * B.s, p0z = ux * B.s + uz * B.c;
    const p1x = vx * B.c - vz * B.s, p1z = vx * B.s + vz * B.c;
    let t0 = 0, t1 = 1;
    const slab = (p0: number, p1: number, lo: number, hi: number): boolean => {
      const d = p1 - p0;
      if (Math.abs(d) < 1e-9) return p0 >= lo && p0 <= hi;
      let a = (lo - p0) / d, b = (hi - p0) / d;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    if (slab(p0x, p1x, -B.hw, B.hw) && slab(ay, by, 0, B.h) && slab(p0z, p1z, -B.hd, B.hd)) return true;
  }
  return false;
}
const BUBBLE_MAX_DISTANCE = 45;
/** On-screen bubble scale clamp (base text 14 px → never below 14 px, never huge up close). */
const BUBBLE_MIN_SCALE = 1;
const BUBBLE_MAX_SCALE = 1.3;
/** Distance (m) at which bubbles reach their minimum scale. */
const BUBBLE_SCALE_DISTANCE = 11.5;
/** Nameplates are fully visible up to this distance (m), then fade out by NAMEPLATE_FAR. */
const NAMEPLATE_SOLID = 45;
const NAMEPLATE_FAR = 55;
/** On-screen pill height clamp (px). Text is ~0.58 of the pill → ≥ ~12.7 px in wide shots. */
const NAMEPLATE_MIN_PX = 22;
const NAMEPLATE_MAX_PX = 30;
/** Natural world-space pill height (m) between the clamps. */
const NAMEPLATE_WORLD_H = 0.26;
/** Max simultaneous nameplates after screen-space declutter (raid chips included). */
const NAMEPLATE_MAX_VISIBLE = 8;
/** quality 'low' draw-call budget: fewer labels, real shadows only for the nearest few (others get blob discs). */
const NAMEPLATE_MAX_VISIBLE_LOW = 6;
const SHADOW_CASTERS_LOW = 3;
const BLOB_CAPACITY = 64;
/** Raid visitors (ids `raid:<group>:<k>`) within this radius of their group centroid collapse into one chip. */
const RAID_CLUSTER_RADIUS = 7;
const RAID_CLUSTER_MIN = 3;
const RAID_CHIP_SLOTS = 3;
/**
 * Gift hand-over: the sim emits `gift` when the giver STARTS heading over and a
 * `chat` with payload.reaction 'thanks' (actor = recipient, target = giver) on
 * arrival — the arc flies on 'thanks'. Fallback for older servers: fly after
 * GIFT_FALLBACK_S if no 'thanks' arrived.
 */
const GIFT_FALLBACK_S = 10;
/** Only residents this close to a confetti burst / raid portal cheer. */
const CHEER_RADIUS = 12;
const VIEWER_EMOTE_SCALE = 1.35;
/** The transparent overlay scene draws benches/café chairs (scene/town.ts). Set false to make overlay residents always stand. */
const OVERLAY_SEATS_DRAWN = true;

// ---------------------------------------------------------------------------
// Shared per-layer state
// ---------------------------------------------------------------------------
interface Reaction { family: AnimationFamily; until: number }
interface ResidentHandle {
  id: string;
  pos: THREE.Vector3;
  yaw: number;
  height: number;
  animator: AvatarAnimator | null;
  visible: boolean;
  reaction: Reaction | null;
  faceTarget: { id: string; until: number } | null;
  play(g: GestureName, delay?: number): void;
  /** Nameplate declutter: candidate state written by the resident each frame, `plateAllowed` by the layer (~10 Hz). */
  plateCand: boolean;
  plateAllowed: boolean;
  platePx: number;
  plateAspect: number;
  plateY: number;
  /** nowS() of the latest event this resident acted in (label priority). */
  lastActorAt: number;
  /** Individual label suppressed: member of a clustered raid group shown as one chip. */
  raidCollapsed: boolean;
  /** Rig root (for the shadow budget) and whether it currently casts real shadows. */
  rigRoot: THREE.Object3D | null;
  shadowOn: boolean;
  shadowApplied: boolean | null;
  /** Label pushed below an overlapping speech bubble (screen px; 0 = at its normal spot). */
  plateNudgePx: number;
}

/** Shared rate limit for distress emotes (clouds, Zzz puffs, "…", sad faces): ~0.7/s, burst 3. */
interface DistressBudget { tokens: number; last: number }
function takeDistress(d: DistressBudget): boolean {
  const t = nowS();
  d.tokens = Math.min(3, d.tokens + Math.max(0, t - d.last) * 0.7);
  d.last = t;
  if (d.tokens < 1) return false;
  d.tokens -= 1;
  return true;
}

interface RaidChip { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; tex: THREE.CanvasTexture | null; text: string; aspect: number; active: boolean; allowed: boolean; px: number; pos: THREE.Vector3; nudgePx: number }
interface PlateCand { h: ResidentHandle | null; chip: RaidChip | null; x: number; y: number; w: number; hh: number; score: number }

function safeIdPart(s: string): string {
  return s.replace(/[^\w:.@-]/g, '-').slice(0, 56) || 'raid';
}
interface BubbleData { key: number; text: string; name: string; start: number; duration: number; sim: boolean }

/** Per-bubble layout state (allocated once per bubble, mutated per frame). */
interface BubbleLayout {
  el: HTMLDivElement | null;
  /** Unscaled size (px), measured once. */
  w: number; h: number;
  sc: number; dx: number; dy: number; dyT: number;
  /** Anchor in client px (this frame). */
  x: number; y: number;
  cls: number; start: number;
  vis: boolean; shown: boolean; placedOnce: boolean;
  /** Last written CSS values (NaN = force write). */
  wsc: number; wdx: number; wdy: number; wop: number;
}

class BubbleHub {
  private subs = new Map<string, (b: BubbleData | null) => void>();
  readonly active = new Map<string, BubbleData>();
  readonly layout = new Map<string, BubbleLayout>();
  /** Active bubble ids (insertion order), iterated per frame without allocation. */
  readonly list: string[] = [];
  /** Ids whose bubble is currently visible (their nameplate hides meanwhile). */
  readonly shown = new Set<string>();
  /** Ids whose bubble is active but collapsed (over the cap / no room): nameplate shows "Name …". */
  readonly collapsed = new Set<string>();
  private seq = 0;
  subscribe(id: string, cb: (b: BubbleData | null) => void): () => void {
    this.subs.set(id, cb);
    const b = this.active.get(id);
    if (b) cb(b);
    return () => { if (this.subs.get(id) === cb) this.subs.delete(id); };
  }
  show(id: string, name: string, text: string, now: number, sim = false): number {
    const duration = Math.min(7, Math.max(5, 3.6 + text.length / 30));
    const b: BubbleData = { key: ++this.seq, text, name, start: now, duration, sim };
    this.active.set(id, b);
    let L = this.layout.get(id);
    if (!L) {
      L = { el: null, w: 0, h: 0, sc: 1, dx: 0, dy: 0, dyT: 0, x: 0, y: 0, cls: 2, start: now, vis: false, shown: false, placedOnce: false, wsc: NaN, wdx: NaN, wdy: NaN, wop: NaN };
      this.layout.set(id, L);
    }
    L.el = null; L.w = 0; L.h = 0; L.dx = 0; L.dy = 0; L.dyT = 0; L.start = now; L.placedOnce = false;
    L.wsc = NaN; L.wdx = NaN; L.wdy = NaN; L.wop = NaN;
    if (this.list.indexOf(id) < 0) this.list.push(id);
    this.subs.get(id)?.(b);
    return duration;
  }
  tick(now: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const id = this.list[i]!;
      const b = this.active.get(id);
      if (b && now - b.start <= b.duration) continue;
      this.list.splice(i, 1);
      this.active.delete(id); this.layout.delete(id); this.shown.delete(id); this.collapsed.delete(id);
      this.subs.get(id)?.(null);
    }
  }
}

function insertionSort<T>(a: T[], n: number, cmp: (x: T, y: T) => number) {
  for (let i = 1; i < n; i++) {
    const v = a[i]!;
    let j = i - 1;
    while (j >= 0 && cmp(a[j]!, v) > 0) { a[j + 1] = a[j]!; j--; }
    a[j + 1] = v;
  }
}

class LodBus {
  private subs = new Map<string, (l: AvatarLod) => void>();
  readonly lod = new Map<string, AvatarLod>();
  subscribe(id: string, cb: (l: AvatarLod) => void): () => void {
    this.subs.set(id, cb);
    return () => { if (this.subs.get(id) === cb) this.subs.delete(id); };
  }
  set(id: string, l: AvatarLod) {
    if (this.lod.get(id) === l) return;
    this.lod.set(id, l);
    this.subs.get(id)?.(l);
  }
}

/** Plain-text, single-line, ≤ 140 chars. React escapes it on render. */
export function sanitizeBubbleText(text: unknown): string {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 140 ? `${clean.slice(0, 139).trimEnd()}…` : clean;
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.dataset.helloWorld = 'residents';
  s.textContent = `
.hw-bubble{--s:1;--dx:0px;--dy:0px;--stem:0px;position:relative;transform-origin:50% 100%;transform:translate(var(--dx),var(--dy)) translateY(-100%) scale(var(--s));width:max-content;max-width:230px;min-width:96px;padding:8px 12px 9px;border-radius:16px;
background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(244,247,250,.95));color:#1d2329;box-shadow:0 6px 22px rgba(10,20,30,.28),0 1px 0 rgba(255,255,255,.6) inset;
font:500 14px/1.32 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.005em;white-space:normal;word-wrap:break-word;overflow-wrap:anywhere;
pointer-events:none;user-select:none;animation:hw-bubble-in .32s cubic-bezier(.2,1.4,.4,1) backwards;transition:opacity .3s ease}
.hw-bubble::after{content:'';position:absolute;left:calc(50% - var(--dx) / var(--s));bottom:-7px;width:14px;height:14px;margin-left:-7px;background:#f4f7fa;transform:rotate(45deg);border-radius:0 0 4px 0;box-shadow:3px 3px 6px rgba(10,20,30,.12)}
.hw-bubble .hw-stem{position:absolute;top:100%;left:calc(50% - var(--dx) / var(--s));width:2px;margin-left:-1px;height:var(--stem);background:linear-gradient(rgba(255,255,255,.95),rgba(255,255,255,.6));border-radius:1px;box-shadow:0 0 2px rgba(10,20,30,.25)}
.hw-bubble .hw-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:700 11px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7a5cff;margin-bottom:2px}
.hw-bubble.hw-sim .hw-name{color:#2f9e8a}
.hw-bubble.hw-me{background:linear-gradient(180deg,#ffffff,#effffa);box-shadow:0 0 0 2.5px #5ef2c6,0 8px 26px rgba(10,20,30,.34)}
.hw-bubble.hw-me::after{background:#effffa}
.hw-bubble.hw-me .hw-name{color:#0d9a76}
.hw-plates{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:9}
.hw-plate{position:absolute;left:0;top:0;transform:translate3d(-9999px,0,0);padding:2px 9px 3px;border-radius:999px;background:rgba(12,16,20,.86);border:1.5px solid rgba(255,255,255,.28);color:#fff;font:650 12.5px/1.25 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;will-change:transform;user-select:none}
.hw-plate.hw-me{border-color:rgba(94,242,198,.85)}
.hw-plate.hw-chip{border-color:rgba(195,155,255,.85)}
@keyframes hw-bubble-in{from{transform:translate(var(--dx),var(--dy)) translateY(-92%) scale(calc(var(--s) * .85))}to{transform:translate(var(--dx),var(--dy)) translateY(-100%) scale(var(--s))}}
`;
  document.head.appendChild(s);
}

// Shared geometry for hit capsules (invisible, raycast only).
let hitGeo: THREE.CapsuleGeometry | null = null;
let hitMat: THREE.MeshBasicMaterial | null = null;
let hitUsers = 0;
function acquireHit() {
  if (!hitGeo) hitGeo = new THREE.CapsuleGeometry(0.33, 1.0, 2, 8);
  if (!hitMat) hitMat = new THREE.MeshBasicMaterial({ visible: false });
  hitUsers++;
  return { geo: hitGeo, mat: hitMat };
}
function releaseHit() {
  if (--hitUsers <= 0) { hitGeo?.dispose(); hitMat?.dispose(); hitGeo = null; hitMat = null; hitUsers = 0; }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _bm = new THREE.Matrix4();
const _bp = new THREE.Vector3();
const _bs = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
/** Frustum + pixels-per-metre-at-1m shared by all residents, recomputed once per frame. */
const frameCache = { time: -1, frustum: _frustum, pxk: 600, layerTime: -1, layerPxk: 600 };
const nowS = () => performance.now() / 1000;

/**
 * Screen rects speech bubbles must avoid, from the WorldScene container: the
 * ResidentInspector card, HUD pills (`[data-testid=world-hud]`, `[data-hud]`) and the
 * event banner. Without a HUD element (world mode) the top-right 360×90 px is excluded.
 */
function collectObstacles(canvas: HTMLElement, out: Float32Array, worldMode: boolean, crL: number, crT: number, W: number): number {
  const root = (canvas.closest('[data-renderer]') as HTMLElement | null) ?? canvas.parentElement?.parentElement?.parentElement ?? null;
  let n = 0;
  let hud = false;
  if (root) {
    const els = root.querySelectorAll('.hw-insp, [data-testid="world-hud"], [data-testid="world-event-banner"], [data-hud]');
    for (let i = 0; i < els.length && n < MAX_OBSTACLES; i++) {
      const el = els[i]!;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (el.matches('[data-testid="world-hud"], [data-hud]')) hud = true;
      const o = n * 4; out[o] = r.left - 6; out[o + 1] = r.right + 6; out[o + 2] = r.top - 6; out[o + 3] = r.bottom + 6; n++;
    }
  }
  if (worldMode && !hud && n < MAX_OBSTACLES) { const o = n * 4; out[o] = crL + W - 360; out[o + 1] = crL + W; out[o + 2] = crT; out[o + 3] = crT + 90; n++; }
  return n;
}

/** Client rect of a visible ResidentInspector card near this canvas (bubbles avoid it). */
function findInspectorRect(canvas: HTMLElement): DOMRect | null {
  let node: HTMLElement | null = canvas.parentElement;
  for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
    const el = node.querySelector('.hw-insp');
    if (el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; }
  }
  return null;
}

/** Pixels per metre at 1 m for the current camera (perspective), cached per frame. */
function frameCacheLayer(state: { size: { height: number }; clock: { elapsedTime: number } }, camera: THREE.Camera): number {
  if (frameCache.layerTime !== state.clock.elapsedTime) {
    frameCache.layerTime = state.clock.elapsedTime;
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50;
    frameCache.layerPxk = state.size.height / (2 * Math.tan((fov * Math.PI) / 360));
  }
  return frameCache.layerPxk;
}

function angleLerp(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------
export function ResidentsLayer(props: ResidentsLayerProps) {
  const { selectedResidentId, onResidentSelect, quality = 'high', viewerResidentId, overlay } = props;
  const store = useSceneStore();
  const [structure, setStructure] = useState<ResidentStructure[]>(() => store.getStructure());
  useEffect(() => { setStructure(store.getStructure()); return store.onStructure(setStructure); }, [store]);

  const registry = useMemo(() => new Map<string, ResidentHandle>(), []);
  const pending = useMemo(() => new Map<string, Array<(h: ResidentHandle) => void>>(), []);
  const hub = useMemo(() => new BubbleHub(), []);
  const lodBus = useMemo(() => new LodBus(), []);
  const distress = useMemo<DistressBudget>(() => ({ tokens: 3, last: 0 }), []);
  const camera = useThree(s => s.camera);
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  // quality 'low': instanced emotes (≤ 1 draw call per visible kind) instead of one sprite per particle.
  const emotes = useMemo<EmotePool>(() => (quality === 'low' ? new InstancedEmoteSystem(12) : new EmoteSystem(80)), [quality]);
  // quality 'low': soft blob discs (1 instanced draw) under residents without real shadows.
  const blob = useMemo(() => {
    if (quality !== 'low') return null;
    const geo = new THREE.CircleGeometry(0.42, 20);
    geo.rotateX(-Math.PI / 2);
    const tex = makeBlobTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.42, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.InstancedMesh(geo, mat, BLOB_CAPACITY);
    mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.raycast = () => {};
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, geo, mat, tex };
  }, [quality]);
  useEffect(() => () => { if (blob) { blob.geo.dispose(); blob.mat.dispose(); blob.tex.dispose(); blob.mesh.dispose(); } }, [blob]);
  // quality 'low': the (≤ NAMEPLATE_MAX_VISIBLE_LOW) decluttered labels are pooled DOM pills (0 draw calls).
  const domPlates = useMemo(() => {
    if (quality !== 'low' || typeof document === 'undefined') return null;
    const root = document.createElement('div');
    root.className = 'hw-plates';
    const els = Array.from({ length: NAMEPLATE_MAX_VISIBLE_LOW + 2 }, () => { const d = document.createElement('div'); d.className = 'hw-plate'; d.style.display = 'none'; root.appendChild(d); return d; });
    const m = els.length;
    return { root, els, n: 0, aH: new Array<ResidentHandle | null>(m).fill(null), aC: new Array<RaidChip | null>(m).fill(null),
      kH: new Array<ResidentHandle | null>(m).fill(null), kC: new Array<RaidChip | null>(m).fill(null), kCol: new Array<boolean>(m).fill(false), kText: new Array<string>(m).fill('') };
  }, [quality]);
  useEffect(() => {
    if (!domPlates) return;
    const parent = gl.domElement.parentElement;
    parent?.appendChild(domPlates.root);
    return () => { domPlates.root.remove(); };
  }, [domPlates, gl]);
  const gifts = useMemo(() => new GiftSystem(6), []);
  useEffect(() => () => emotes.dispose(), [emotes]);
  useEffect(() => () => gifts.dispose(), [gifts]);
  useEffect(() => { ensureStyles(); }, []);
  useEffect(() => {
    // QA only (?hwdebug): expose bubble layout state for automated checks.
    if (typeof location === 'undefined' || !location.search.includes('hwdebug')) return;
    (window as unknown as { __hwHub?: BubbleHub }).__hwHub = hub;
    return () => { delete (window as unknown as { __hwHub?: BubbleHub }).__hwHub; };
  }, [hub]);

  const clock = useRef({ now: 0, lodTimer: 0, bubbleTimer: 0, plateTimer: 0, bubbleCount: 0, rectAt: -1, crL: 0, crT: 0, W: 1, H: 1, nObs: 0 });
  /** Screen rects bubbles must avoid (inspector card, HUD pills, event banner), refreshed at 4 Hz. */
  const obsRects = useMemo(() => new Float32Array(4 * MAX_OBSTACLES), []);
  /** Registered residents as an array (allocation-free per-frame iteration). */
  const handleList = useMemo(() => [] as ResidentHandle[], []);
  const bubbleCands = useMemo(() => [] as string[], []);
  const bubblePlace = useMemo(() => [] as string[], []);
  const pendingGifts = useMemo(() => [] as Array<{ actor: string; target: string; until: number }>, []);
  /** Recently flown gift arcs (giver→receiver) so a late 'thanks' after a fallback doesn't fly twice. */
  const recentGifts = useMemo(() => [] as Array<{ giver: string; receiver: string; at: number }>, []);
  /** Gift box arc from giver to receiver (+ reactions on landing). */
  const launchGift = useMemo(() => (h: ResidentHandle, th: ResidentHandle) => {
    const es = th.id === viewerRef.current ? VIEWER_EMOTE_SCALE : 1;
    h.faceTarget = { id: th.id, until: nowS() + 4 };
    th.faceTarget = { id: h.id, until: nowS() + 5 };
    h.play('give');
    _v.set(h.pos.x + Math.sin(h.yaw) * 0.35, h.pos.y + h.height * 0.6, h.pos.z + Math.cos(h.yaw) * 0.35);
    _v2.set(th.pos.x, th.pos.y + th.height * 0.62, th.pos.z);
    gifts.launch(_v, _v2, () => {
      emotes.spawn('sparkle', th.pos.x, th.pos.y + th.height * 0.7, th.pos.z, 5, 0.5, es);
      emotes.spawn('heart', th.pos.x, th.pos.y + th.height + 0.2, th.pos.z, 3, 0.35, es);
      th.play('cheer'); th.animator?.flashExpression('happy', 1, 4);
    });
  }, [emotes, gifts]);
  const viewerRef = useRef(viewerResidentId);
  viewerRef.current = viewerResidentId;
  /** Overlay mode, shared with residents through a ref (no re-render); correct from the first frame. */
  const overlayRef = useRef(false);
  overlayRef.current = overlay ?? (!!gl.getContextAttributes()?.alpha && !scene.background);

  // Fresh-event reactions.
  useEffect(() => {
    const withHandle = (id: string | undefined, fn: (h: ResidentHandle) => void) => {
      if (!id) return;
      const h = registry.get(id);
      if (h && h.animator) fn(h);
      else {
        const t0 = nowS();
        const list = pending.get(id) ?? [];
        list.push(hh => { if (nowS() - t0 < 5) fn(hh); });
        pending.set(id, list.slice(-4));
        if (pending.size > 200) pending.clear();
      }
    };
    const emScale = (h: ResidentHandle) => (h.id === viewerRef.current ? VIEWER_EMOTE_SCALE : 1);
    const emoteAt = (h: ResidentHandle, kind: EmoteKind, count = 1, dy = 0.25) => emotes.spawn(kind, h.pos.x, h.pos.y + h.height + dy, h.pos.z, count, 0.35, emScale(h));
    /** Deterministic per-resident cheer for everyone within CHEER_RADIUS of a burst. */
    const cheerAround = (x: number, z: number, key: string, gestures: GestureName[]) => {
      for (const h of registry.values()) {
        if (!h.animator) continue;
        const dx = h.pos.x - x, dz = h.pos.z - z;
        if (dx * dx + dz * dz > CHEER_RADIUS * CHEER_RADIUS) continue;
        const hv = hashString(`${h.id}|${key}`);
        h.play(gestures[hv % gestures.length]!, 0.15 + ((hv >>> 7) % 90) / 100);
      }
    };
    const now = nowS;
    const face = (h: ResidentHandle, other: string | undefined, secs = 4) => { if (other && other !== h.id) h.faceTarget = { id: other, until: now() + secs }; };

    return store.onEvent(({ event }) => {
      const e: WorldEvent = event;
      const actor = e.actorId, target = e.targetId && e.targetId !== e.actorId ? e.targetId : undefined;
      const ah = registry.get(actor);
      if (ah) ah.lastActorAt = now();
      const sentiment = typeof e.payload?.sentiment === 'string' ? e.payload.sentiment : undefined;
      const text = sanitizeBubbleText(e.text);
      if (text && (e.kind === 'chat' || e.kind === 'social' || e.kind === 'gift' || e.kind === 'custom' || e.kind === 'wave')) {
        withHandle(actor, h => {
          const name = store.getResident(actor)?.displayName ?? e.actorDisplayName;
          const d = hub.show(actor, name, text, now(), e.source === 'simulation');
          h.animator?.setTalking(true, d * 0.75);
          face(h, target, d);
        });
      }
      switch (e.kind) {
        case 'join':
          withHandle(actor, h => { h.play('wave', 0.4); emoteAt(h, 'sparkle', 4, 0); h.animator?.flashExpression('happy', 1, 3); });
          break;
        case 'wave':
          withHandle(actor, h => { face(h, target); h.play('wave'); });
          withHandle(target, h => { face(h, actor); h.play('greet', 0.6); setTimeout(() => emoteAt(h, 'hello', 1), 300); });
          break;
        case 'dance':
          withHandle(actor, h => { h.reaction = { family: 'dance', until: now() + 8 }; emoteAt(h, 'note', 2); });
          break;
        case 'gift':
          // Giver is heading over: small present emote now; the arc flies on the 'thanks' hand-over.
          withHandle(actor, h => {
            if (target) {
              emoteAt(h, 'gift', 1, 0.2);
              pendingGifts.push({ actor, target, until: now() + GIFT_FALLBACK_S });
              if (pendingGifts.length > 8) pendingGifts.shift();
            } else { h.play('give'); emoteAt(h, 'sparkle', 3); }
          });
          break;
        case 'chat':
          // Spoken distress line (no target): small matching emote alongside the bubble.
          if (!target && e.payload?.sentiment === 'negative' && (e.payload.reaction === 'tired' || e.payload.reaction === 'lonely' || e.payload.reaction === 'bored')) {
            const reaction = e.payload.reaction;
            withHandle(actor, h => {
              if (!takeDistress(distress)) return;
              const es = emScale(h);
              if (reaction === 'tired') emotes.spawn('zzz', h.pos.x + 0.08, h.pos.y + h.height + 0.12, h.pos.z, 1, 0.05, 0.55 * es);
              else emotes.spawn(reaction === 'lonely' ? 'sad' : 'dots', h.pos.x, h.pos.y + h.height + 0.2, h.pos.z, 1, 0.05, es);
            });
          }
          if (e.payload?.reaction === 'thanks' && target) {
            // Hand-over on arrival: giver (= target) → recipient (= actor).
            const idx = pendingGifts.findIndex(gp => gp.actor === target && gp.target === actor);
            const t0 = now();
            const flewRecently = recentGifts.some(r => r.giver === target && r.receiver === actor && t0 - r.at < 15);
            if (idx >= 0) pendingGifts.splice(idx, 1);
            const gh = registry.get(target), rh = registry.get(actor);
            if ((idx >= 0 || !flewRecently) && gh && rh) {
              launchGift(gh, rh);
              recentGifts.push({ giver: target, receiver: actor, at: t0 });
              if (recentGifts.length > 8) recentGifts.shift();
            }
          }
          break;
        case 'social': {
          const action = e.payload?.action;
          if (sentiment === 'negative') {
            // Snub / bickering (from the sim): quick grumpy cloud on the actor, small sad face on the target.
            withHandle(actor, h => { face(h, target); h.play('shake'); if (takeDistress(distress)) emoteAt(h, 'cloud', 1, 0.15); h.animator?.flashExpression('angry', 0.6, 2.5); });
            withHandle(target, h => { face(h, actor); h.animator?.flashExpression('sad', 0.8, 3); if (takeDistress(distress)) emoteAt(h, 'sad', 1, 0.12); });
            break;
          }
          withHandle(actor, h => {
            face(h, target);
            if (action === 'greet') { h.play('greet'); emoteAt(h, 'hello', 1); }
            else if (action === 'compliment') { h.play('bow'); emoteAt(h, 'sparkle', 3); }
            else if (action === 'befriend') { h.play('cheer'); emoteAt(h, 'heart', 3); }
            else if (action === 'celebrate') { h.reaction = { family: 'celebrate', until: now() + 3.5 }; emoteAt(h, 'sparkle', 4); }
            else { h.play(sentiment === 'positive' ? 'nod' : 'greet'); if (sentiment === 'positive') emoteAt(h, 'heart', 2); }
          });
          withHandle(target, h => {
            face(h, actor);
            if (action === 'compliment') { emoteAt(h, 'heart', 2); h.animator?.flashExpression('happy', 1, 3); h.play('nod', 0.7); }
            else if (action === 'befriend') { emoteAt(h, 'heart', 2); h.play('clap', 0.6); }
            else if (action === 'greet') h.play('wave', 0.7);
          });
          break;
        }
        case 'confetti': {
          // WorldScene bursts confetti above the actor (or the plaza centre).
          const r = store.getResident(actor);
          cheerAround(r?.location.x ?? 0, r?.location.z ?? 0, e.id, ['cheer', 'clap', 'cheer']);
          break;
        }
        case 'raid': {
          // Raid bursts at the portal and over the plaza.
          const portal = getPoi('portal')?.position ?? { x: 0, z: -24 };
          cheerAround(portal.x, portal.z + 3, e.id, ['wave', 'cheer']);
          cheerAround(0, 0, `${e.id}:plaza`, ['cheer', 'clap']);
          break;
        }
        default: break;
      }
    });
  }, [store, registry, pending, hub, emotes, gifts, pendingGifts, recentGifts, launchGift, distress]);

  // Raid chips: one label per clustered raid group ("+7 raiders from CozyStreamer").
  const raidChips = useMemo<RaidChip[]>(() => Array.from({ length: RAID_CHIP_SLOTS }, () => {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false; sprite.renderOrder = 41; sprite.raycast = () => {};
    return { sprite, mat, tex: null, text: '', aspect: 4, active: false, allowed: false, px: NAMEPLATE_MIN_PX, pos: new THREE.Vector3(), nudgePx: 0 };
  }), []);
  useEffect(() => () => { for (const ch of raidChips) { ch.tex?.dispose(); ch.mat.dispose(); } }, [raidChips]);
  const raidGroups = useMemo(() => new Map<string, ResidentHandle[]>(), []);
  const raidChannels = useMemo(() => new Map<string, string>(), []);
  const plateCands = useMemo(() => [] as PlateCand[], []);
  const plateCandPool = useMemo(() => [] as PlateCand[], []);
  const cmpCand = (a: PlateCand, b: PlateCand) => a.score - b.score;

  const raidChannel = (group: string): string => {
    let ch = raidChannels.get(group);
    if (ch) return ch;
    for (const e of store.current.eventHistory) {
      if (e.kind !== 'raid' || `raid:${safeIdPart(e.id)}` !== group) continue;
      const raw = typeof e.payload?.channel === 'string' && e.payload.channel ? e.payload.channel : e.actorDisplayName;
      ch = sanitizeBubbleText(raw).slice(0, 24);
    }
    ch = ch || 'a raid';
    raidChannels.set(group, ch);
    if (raidChannels.size > 32) raidChannels.clear();
    return ch;
  };

  const updateRaidGroups = () => {
    for (const arr of raidGroups.values()) arr.length = 0;
    for (const h of registry.values()) {
      h.raidCollapsed = false;
      if (!h.id.startsWith('raid:')) continue;
      const k = h.id.lastIndexOf(':');
      if (k <= 5) continue;
      const key = h.id.slice(0, k);
      let arr = raidGroups.get(key);
      if (!arr) { arr = []; raidGroups.set(key, arr); }
      arr.push(h);
    }
    let slot = 0;
    for (const [key, arr] of raidGroups) {
      if (arr.length < RAID_CLUSTER_MIN) { if (!arr.length) raidGroups.delete(key); continue; }
      let cx = 0, cz = 0;
      for (const h of arr) { cx += h.pos.x; cz += h.pos.z; }
      cx /= arr.length; cz /= arr.length;
      let n = 0, mx = 0, mz = 0, top = 0;
      for (const h of arr) {
        if (Math.hypot(h.pos.x - cx, h.pos.z - cz) > RAID_CLUSTER_RADIUS) continue;
        n++; mx += h.pos.x; mz += h.pos.z; top = Math.max(top, h.height);
      }
      if (n < RAID_CLUSTER_MIN || slot >= raidChips.length) continue;
      mx /= n; mz /= n;
      for (const h of arr) {
        if (Math.hypot(h.pos.x - cx, h.pos.z - cz) > RAID_CLUSTER_RADIUS) continue;
        // Individual labels only when selected / speaking / it's the viewer.
        h.raidCollapsed = !(h.id === selectedResidentId || h.id === viewerResidentId || hub.shown.has(h.id));
      }
      const chip = raidChips[slot++]!;
      chip.active = true;
      // Beside the group (to its right on screen), at chest height, not over heads.
      const e = camera.matrixWorld.elements;
      let rx = e[0]!, rz = e[2]!;
      const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      let ext = 0;
      for (const h of arr) {
        if (Math.hypot(h.pos.x - cx, h.pos.z - cz) > RAID_CLUSTER_RADIUS) continue;
        ext = Math.max(ext, (h.pos.x - mx) * rx + (h.pos.z - mz) * rz);
      }
      chip.pos.set(mx + rx * (ext + 1.1), Math.min(1.3, top * 0.72), mz + rz * (ext + 1.1));
      const text = `+${n} raiders from ${raidChannel(key)}`;
      if (text !== chip.text) {
        chip.text = text;
        chip.tex?.dispose();
        const t = makeNameplateTexture(text, '#c39bff', 48);
        chip.tex = t.texture; chip.aspect = t.aspect;
        chip.mat.map = t.texture; chip.mat.needsUpdate = true;
      }
    }
    for (; slot < raidChips.length; slot++) raidChips[slot]!.active = false;
  };

  /** Greedy screen-space label selection: viewer > selected > raid chip > recent actor > nearest; shown bubbles block. */
  const declutterPlates = () => {
    const c = clock.current;
    const W = c.W, H = c.H;
    let nCand = 0;
    const take = () => {
      let cnd = plateCandPool[nCand];
      if (!cnd) { cnd = { h: null, chip: null, x: 0, y: 0, w: 0, hh: 0, score: 0 }; plateCandPool[nCand] = cnd; }
      plateCands[nCand] = cnd; nCand++;
      return cnd;
    };
    for (let i = 0; i < handleList.length; i++) {
      const h = handleList[i]!;
      if (!h.plateCand) { h.plateAllowed = false; h.plateNudgePx = 0; continue; }
      // Body must be on screen (label anchored to the rendered body, never to an off-screen resident).
      _v.set(h.pos.x, h.pos.y + 0.9, h.pos.z).project(camera);
      if (_v.z > 1 || _v.x < -1 || _v.x > 1 || _v.y < -1 || _v.y > 1) { h.plateAllowed = false; continue; }
      // Hidden behind a building (camera → label anchor crosses a building box).
      if (occludedByBuilding(camera.position.x, camera.position.y, camera.position.z, h.pos.x, h.pos.y + h.plateY, h.pos.z)) { h.plateAllowed = false; continue; }
      _v.set(h.pos.x, h.pos.y + h.plateY, h.pos.z).project(camera);
      if (_v.z > 1) { h.plateAllowed = false; continue; }
      const age = c.now - h.lastActorAt;
      const score = h.id === viewerResidentId ? -1e6 : h.id === selectedResidentId ? -5e5
        : hub.collapsed.has(h.id) ? -3e4 : age < 10 ? -1e4 + age * 100 : h.pos.distanceTo(camera.position);
      const cnd = take();
      cnd.h = h; cnd.chip = null; cnd.x = c.crL + ((_v.x + 1) / 2) * W; cnd.y = c.crT + ((1 - _v.y) / 2) * H;
      cnd.w = h.platePx * h.plateAspect; cnd.hh = h.platePx; cnd.score = score;
    }
    for (let i = 0; i < raidChips.length; i++) {
      const chip = raidChips[i]!;
      chip.allowed = false;
      if (!chip.active) continue;
      if (occludedByBuilding(camera.position.x, camera.position.y, camera.position.z, chip.pos.x, chip.pos.y, chip.pos.z)) continue;
      _v.set(chip.pos.x, chip.pos.y, chip.pos.z).project(camera);
      if (_v.z > 1) continue;
      const cnd = take();
      cnd.h = null; cnd.chip = chip; cnd.x = c.crL + ((_v.x + 1) / 2) * W; cnd.y = c.crT + ((1 - _v.y) / 2) * H;
      cnd.w = chip.px * chip.aspect; cnd.hh = chip.px; cnd.score = -2e5;
    }
    insertionSort(plateCands, nCand, cmpCand);
    let shownPlates = 0;
    if (domPlates) domPlates.n = 0;
    const nb = c.bubbleCount;
    const cap = quality === 'low' ? NAMEPLATE_MAX_VISIBLE_LOW : NAMEPLATE_MAX_VISIBLE;
    for (let ci = 0; ci < nCand; ci++) {
      const cnd = plateCands[ci]!;
      const l = cnd.x - cnd.w / 2 - 2, r = cnd.x + cnd.w / 2 + 2;
      let t = cnd.y - cnd.hh / 2 - 1, b = cnd.y + cnd.hh / 2 + 1;
      let ok = shownPlates < cap;
      // Clear of ALL bubbles: nudge the label just below the overlapping bubble(s), else hide.
      let nudge = 0;
      for (let iter = 0; ok && iter < 4; iter++) {
        let moved = false;
        for (let k = 0; k < nb; k++) {
          const o = k * 4;
          if (r > shownRects[o]! && l < shownRects[o + 1]! && b + nudge > shownRects[o + 2]! && t + nudge < shownRects[o + 3]!) {
            nudge = shownRects[o + 3]! + 3 - t;
            moved = true;
          }
        }
        if (!moved) break;
      }
      if (nudge > 0) {
        t += nudge; b += nudge;
        if (nudge > LABEL_MAX_NUDGE) ok = false;   // would float away from the body: hide instead
        for (let k = 0; ok && k < nb; k++) {
          const o = k * 4;
          if (r > shownRects[o]! && l < shownRects[o + 1]! && b > shownRects[o + 2]! && t < shownRects[o + 3]!) ok = false;
        }
      }
      for (let k = 0; ok && k < shownPlates && k < 16; k++) {
        const o = k * 4;
        if (r > plateRects[o]! && l < plateRects[o + 1]! && b > plateRects[o + 2]! && t < plateRects[o + 3]!) ok = false;
      }
      if (cnd.h) { cnd.h.plateAllowed = ok; cnd.h.plateNudgePx = ok ? nudge : 0; }
      else if (cnd.chip) { cnd.chip.allowed = ok; cnd.chip.nudgePx = ok ? nudge : 0; }
      if (ok && domPlates && domPlates.n < domPlates.els.length) { domPlates.aH[domPlates.n] = cnd.h; domPlates.aC[domPlates.n] = cnd.chip; domPlates.n++; }
      if (ok && shownPlates < 16) { const o = shownPlates * 4; plateRects[o] = l; plateRects[o + 1] = r; plateRects[o + 2] = t; plateRects[o + 3] = b; }
      if (ok) shownPlates++;
    }
  };


  /** Selection order: class (viewer > viewer/twitch chat or selected > sim chatter), then NEWEST first. */
  const cmpSelect = (a: string, b: string) => {
    const A = hub.layout.get(a)!, B = hub.layout.get(b)!;
    return A.cls !== B.cls ? A.cls - B.cls : B.start - A.start;
  };
  /** Placement order (stable, so no stacking jitter): class, then OLDEST first; later bubbles stack above. */
  const cmpPlace = (a: string, b: string) => {
    const A = hub.layout.get(a)!, B = hub.layout.get(b)!;
    return A.cls !== B.cls ? A.cls - B.cls : A.start - B.start;
  };

  /**
   * Per-frame speech-bubble layout (allocation-free): readable scale, cap with
   * collapse-oldest, inspector dodge, and upward stacking so bubbles never overlap.
   */
  const layoutBubbles = (dt: number) => {
    const c = clock.current;
    const list = hub.list;
    c.bubbleCount = 0;
    if (!list.length) return;
    const cap = overlayRef.current ? BUBBLE_MAX_VISIBLE_OVERLAY : quality === 'low' ? BUBBLE_MAX_VISIBLE_LOW : BUBBLE_MAX_VISIBLE;
    let nc = 0;
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!;
      const L = hub.layout.get(id), b = hub.active.get(id), h = registry.get(id);
      if (!L || !b) continue;
      L.vis = false; L.shown = false;
      if (!h || !L.el || !h.visible) continue;
      const d = h.pos.distanceTo(camera.position);
      if (d > (id === viewerResidentId ? 70 : BUBBLE_MAX_DISTANCE)) continue;
      _v.set(h.pos.x, h.pos.y + h.height + 0.42, h.pos.z).project(camera);
      if (_v.z > 1) continue;
      L.x = c.crL + ((_v.x + 1) / 2) * c.W; L.y = c.crT + ((1 - _v.y) / 2) * c.H;
      L.sc = Math.min(BUBBLE_MAX_SCALE, Math.max(BUBBLE_MIN_SCALE, BUBBLE_SCALE_DISTANCE / Math.max(0.5, d))) * (id === viewerResidentId ? 1.08 : 1);
      if (!L.w && L.el.offsetWidth > 0) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      L.cls = id === viewerResidentId ? 0 : (!b.sim || id === selectedResidentId) ? 1 : 2;
      L.start = b.start;
      L.vis = true;
      bubbleCands[nc++] = id;
    }
    insertionSort(bubbleCands, nc, cmpSelect);
    let np = 0;
    for (let i = 0; i < nc && np < cap; i++) bubblePlace[np++] = bubbleCands[i]!;
    insertionSort(bubblePlace, np, cmpPlace);
    let n = 0;
    for (let i = 0; i < np; i++) {
      const L = hub.layout.get(bubblePlace[i]!)!;
      const w = (L.w || 160) * L.sc, hh = ((L.h || 48) + 8) * L.sc;
      let l = L.x - w / 2, r = L.x + w / 2;
      const bt = L.y, t = L.y - hh;
      // Safe area: keep inside the viewport (minus margins); the tail/stem must still reach the speaker.
      const maxShift = w / 2 - 18 * L.sc;
      const minL = c.crL + SAFE_MARGIN, maxR = c.crL + c.W - SAFE_MARGIN;
      let dx = l < minL ? minL - l : r > maxR ? maxR - r : 0;
      l += dx; r += dx;
      // Slide sideways off HUD pills / event banner / inspector card.
      for (let k = 0; k < c.nObs; k++) {
        const o = k * 4;
        if (r > obsRects[o]! && l < obsRects[o + 1]! && bt > obsRects[o + 2]! && t < obsRects[o + 3]!) {
          const toLeft = obsRects[o]! - 8 - r, toRight = obsRects[o + 1]! + 8 - l;
          const sh = Math.abs(dx + toLeft) <= Math.abs(dx + toRight) ? toLeft : toRight;
          dx += sh; l += sh; r += sh;
        }
      }
      if (Math.abs(dx) > maxShift || l < minL - 0.5 || r > maxR + 0.5) continue;   // no slot: collapsed
      // Stack upward until clear of every placed bubble.
      let dy = 0;
      for (let iter = 0; iter < 10; iter++) {
        let moved = false;
        for (let k = 0; k < n; k++) {
          const o = k * 4;
          if (r > shownRects[o]! + 2 && l < shownRects[o + 1]! - 2 && bt + dy > shownRects[o + 2]! && t + dy < shownRects[o + 3]!) {
            dy = shownRects[o + 2]! - BUBBLE_STACK_GAP - bt;
            moved = true;
          }
        }
        if (!moved) break;
      }
      if (t + dy < c.crT + SAFE_MARGIN || bt + dy > c.crT + c.H - SAFE_MARGIN || n >= 16) continue;   // no room: collapsed
      let blocked = false;
      for (let k2 = 0; k2 < c.nObs && !blocked; k2++) {
        const o = k2 * 4;
        if (r > obsRects[o]! && l < obsRects[o + 1]! && bt + dy > obsRects[o + 2]! && t + dy < obsRects[o + 3]!) blocked = true;
      }
      if (blocked) continue;
      L.shown = true; L.dx = dx; L.dyT = dy;
      const o = n * 4;
      shownRects[o] = l; shownRects[o + 1] = r; shownRects[o + 2] = t + dy; shownRects[o + 3] = bt + dy;
      n++;
    }
    c.bubbleCount = n;
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!;
      const L = hub.layout.get(id), b = hub.active.get(id);
      if (!L || !b || !L.el) continue;
      const fading = c.now - b.start > b.duration - 0.5;
      const show = L.vis && L.shown && !fading;
      if (show) { hub.shown.add(id); hub.collapsed.delete(id); }
      else { hub.shown.delete(id); if (L.vis && !fading) hub.collapsed.add(id); else hub.collapsed.delete(id); }
      if (show) {
        if (!L.placedOnce) { L.dy = L.dyT; L.placedOnce = true; } else L.dy += (L.dyT - L.dy) * k;
      }
      const el = L.el;
      if (L.wsc !== L.wsc || Math.abs(L.sc - L.wsc) > 0.004) { L.wsc = L.sc; el.style.setProperty('--s', L.sc.toFixed(3)); }
      if (L.wdx !== L.wdx || Math.abs(L.dx - L.wdx) > 0.5) { L.wdx = L.dx; el.style.setProperty('--dx', `${L.dx.toFixed(1)}px`); }
      if (L.wdy !== L.wdy || Math.abs(L.dy - L.wdy) > 0.5) {
        L.wdy = L.dy;
        el.style.setProperty('--dy', `${L.dy.toFixed(1)}px`);
        el.style.setProperty('--stem', `${Math.max(0, -L.dy / L.sc - 5).toFixed(1)}px`);
      }
      const op = show ? 1 : 0;
      if (op !== L.wop) {
        // Layout-driven hides (collapse/overlap) are instant so a fading bubble never sits under a newly placed one;
        // natural expiry keeps the CSS fade.
        el.style.transition = op === 0 && !fading ? 'none' : '';
        L.wop = op; el.style.opacity = op ? '1' : '0';
      }
    }
  };

  const applyShadow = (h: ResidentHandle) => {
    if (!h.rigRoot || h.shadowApplied === h.shadowOn) return;
    const on = h.shadowOn;
    h.rigRoot.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.hwCast === undefined) mesh.userData.hwCast = mesh.castShadow;
      mesh.castShadow = on && !!mesh.userData.hwCast;
    });
    h.shadowApplied = on;
  };

  const ringRef = useRef<THREE.Mesh>(null);
  const markerRef = useRef<THREE.Group>(null);
  const lodRank = useMemo(() => [] as Array<{ id: string; d: number }>, []);
  const bubbleRank = useMemo(() => [] as Array<{ id: string; d: number; score: number }>, []);
  const shownRects = useMemo(() => new Float32Array(4 * 16), []);
  const plateRects = useMemo(() => new Float32Array(4 * 16), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const c = clock.current;
    c.now = nowS();
    emotes.update(dt, camera);
    // Blob shadows (quality 'low') for residents without real shadows.
    if (blob) {
      let n = 0;
      for (let i = 0; i < handleList.length; i++) {
        const h = handleList[i]!;
        if (h.shadowOn || !h.visible || n >= BLOB_CAPACITY) continue;
        const k = h.height / 1.7;
        _bp.set(h.pos.x, h.pos.y + 0.025, h.pos.z); _bs.set(k, 1, k);
        _bm.compose(_bp, _bq, _bs);
        blob.mesh.setMatrixAt(n++, _bm);
      }
      blob.mesh.count = n;
      blob.mesh.visible = n > 0;
      if (n > 0) blob.mesh.instanceMatrix.needsUpdate = true;
      blob.mat.opacity = overlayRef.current ? 0.26 : 0.42;
    }
    gifts.update(dt);
    const t = state.clock.elapsedTime;

    // Selection ring + viewer marker.
    const ring = ringRef.current;
    if (ring) {
      const h = selectedResidentId ? registry.get(selectedResidentId) : undefined;
      ring.visible = !!h;
      if (h) {
        ring.position.set(h.pos.x, h.pos.y + 0.03, h.pos.z);
        const s = 1 + 0.06 * Math.sin(t * 3);
        ring.scale.set(s, s, s);
        ring.rotation.z = t * 0.6;
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(t * 3);
      }
    }
    const marker = markerRef.current;
    if (marker) {
      const h = viewerResidentId ? registry.get(viewerResidentId) : undefined;
      marker.visible = !!h;
      if (h) {
        marker.position.set(h.pos.x, h.pos.y + h.height + 0.62 + 0.05 * Math.sin(t * 2.4), h.pos.z);
        marker.rotation.y = t * 1.6;
      }
    }

    // LOD assignment (2 Hz): the nearest few get 'high' (live face), the next ones 'mid' (same shape, static
    // face, 1 draw call), the rest 'low'. Hysteresis: a tier is entered within its distance and kept until
    // TIER_HYST metres beyond it, so residents walking along an edge don't flicker. Selected / viewer: always 'high'.
    if ((c.lodTimer -= dt) <= 0) {
      c.lodTimer = 0.5;
      overlayRef.current = overlay ?? (!!gl.getContextAttributes()?.alpha && !scene.background);
      const maxHigh = quality === 'low' ? 3 : 8;
      const highDist = quality === 'low' ? 9 : 14;
      const maxMid = quality === 'low' ? 10 : 20;
      const midDist = quality === 'low' ? 18 : 30;
      const TIER_HYST = 3;
      let nHigh = 0, nMid = 0;
      lodRank.length = 0;
      for (const h of registry.values()) lodRank.push({ id: h.id, d: h.pos.distanceTo(camera.position) });
      lodRank.sort((a, b) => a.d - b.d);
      lodRank.forEach((r, i) => {
        const cur = lodBus.lod.get(r.id) ?? 'mid';
        const forced = r.id === selectedResidentId || r.id === viewerResidentId;
        const highLimit = cur === 'high' ? highDist + TIER_HYST : highDist;
        const midLimit = cur === 'low' ? midDist : midDist + TIER_HYST;
        let next: AvatarLod = 'low';
        if (forced) next = 'high';
        else if (nHigh < maxHigh && r.d < highLimit) { next = 'high'; nHigh++; }
        else if (nMid < maxMid && r.d < midLimit) { next = 'mid'; nMid++; }
        lodBus.set(r.id, next);
        // Shadow budget: at 'low' only the nearest few cast real shadows (others: blob discs).
        const h = registry.get(r.id);
        if (h) { h.shadowOn = quality !== 'low' || i < SHADOW_CASTERS_LOW; applyShadow(h); }
      });
    }

    // Speech bubbles: expire; keep a readable minimum on-screen size.
    // Fallback for servers without the 'thanks' hand-over: fly the arc after GIFT_FALLBACK_S.
    for (let i = pendingGifts.length - 1; i >= 0; i--) {
      const gft = pendingGifts[i]!;
      if (c.now <= gft.until) continue;
      pendingGifts.splice(i, 1);
      const gh = registry.get(gft.actor), th = registry.get(gft.target);
      if (!gh || !th) continue;
      launchGift(gh, th);
      recentGifts.push({ giver: gft.actor, receiver: gft.target, at: c.now });
      if (recentGifts.length > 8) recentGifts.shift();
    }

    // Raid chips follow their group; keep their on-screen size readable.
    for (let ci = 0; ci < raidChips.length; ci++) {
      const chip = raidChips[ci]!;
      chip.sprite.visible = !domPlates && chip.active && chip.allowed;
      if (!chip.active) continue;
      const pxPerM = frameCacheLayer(state, camera) / Math.max(1, chip.pos.distanceTo(camera.position));
      chip.px = Math.min(NAMEPLATE_MAX_PX, Math.max(NAMEPLATE_MIN_PX, NAMEPLATE_WORLD_H * pxPerM));
      const sc = chip.px / pxPerM;
      chip.sprite.scale.set(sc * chip.aspect, sc, 1);
      chip.sprite.position.copy(chip.pos);
      chip.sprite.position.y -= chip.nudgePx / pxPerM;
    }

    // Nameplate declutter + raid collapse (~10 Hz).
    if ((c.plateTimer -= dt) <= 0) {
      c.plateTimer = 0.05;
      updateRaidGroups();
      declutterPlates();
    }
    if (domPlates) {
      const W = state.size.width, H = state.size.height;
      for (let i = 0; i < domPlates.els.length; i++) {
        const el = domPlates.els[i]!;
        const h = i < domPlates.n ? domPlates.aH[i]! : null, chip = i < domPlates.n ? domPlates.aC[i]! : null;
        if (!h && !chip) { if (el.style.display !== 'none') el.style.display = 'none'; domPlates.kH[i] = null; domPlates.kC[i] = null; continue; }
        if (h) _v.set(h.pos.x, h.pos.y + h.plateY, h.pos.z); else if (chip) _v.copy(chip.pos);
        _v.project(camera);
        if (_v.z > 1) { el.style.display = 'none'; continue; }
        const col = !!h && hub.collapsed.has(h.id);
        if (domPlates.kH[i] !== h || domPlates.kC[i] !== chip || domPlates.kCol[i] !== col || (chip && chip.text !== domPlates.kText[i])) {
          domPlates.kH[i] = h; domPlates.kC[i] = chip; domPlates.kCol[i] = col;
          const label = h ? `${store.getResident(h.id)?.displayName ?? ''}${col ? ' …' : ''}` : chip?.text ?? '';
          domPlates.kText[i] = label;
          el.textContent = label;
          el.className = `hw-plate${h && h.id === viewerResidentId ? ' hw-me' : ''}${chip ? ' hw-chip' : ''}`;
        }
        if (el.style.display === 'none') el.style.display = '';
        const ny = h ? h.plateNudgePx : chip?.nudgePx ?? 0;
        el.style.transform = `translate3d(${(((_v.x + 1) / 2) * W).toFixed(1)}px,${(((1 - _v.y) / 2) * H + ny).toFixed(1)}px,0) translate(-50%,-50%)`;
      }
    }


    hub.tick(c.now);
    c.W = state.size.width; c.H = state.size.height;
    if (c.now - c.rectAt > 0.25) {
      // Cached DOM rects (4 Hz): no per-frame layout reads.
      c.rectAt = c.now;
      const cr = gl.domElement.getBoundingClientRect();
      c.crL = cr.left; c.crT = cr.top;
      c.nObs = collectObstacles(gl.domElement, obsRects, !overlayRef.current, c.crL, c.crT, c.W);
    }
    layoutBubbles(dt);

  });

  const ringGeo = useMemo(() => new THREE.RingGeometry(0.5, 0.62, 48), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), []);
  const markerGeo = useMemo(() => new THREE.OctahedronGeometry(0.11, 0), []);
  const markerMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5ef2c6', emissive: '#1fbf94', emissiveIntensity: 0.9, roughness: 0.3 }), []);
  useEffect(() => () => { ringGeo.dispose(); ringMat.dispose(); markerGeo.dispose(); markerMat.dispose(); }, [ringGeo, ringMat, markerGeo, markerMat]);

  return <group name="residents-layer">
    {structure.map(s => <Resident key={s.id} id={s.id} displayName={s.displayName} appearance={s.resident.appearance}
      store={store} registry={registry} pending={pending} hub={hub} lodBus={lodBus} emotes={emotes} overlayRef={overlayRef} domPlates={!!domPlates} distress={distress} handleList={handleList}
      isViewer={s.id === viewerResidentId} onSelect={onResidentSelect} />)}
    <primitive object={emotes.group} />
    {blob && <primitive object={blob.mesh} />}
    <primitive object={gifts.group} />
    {raidChips.map((ch, i) => <primitive key={`raid-chip-${i}`} object={ch.sprite} />)}
    <mesh ref={ringRef} geometry={ringGeo} material={ringMat} rotation-x={-Math.PI / 2} visible={false} renderOrder={5} raycast={() => null} />
    <group ref={markerRef} visible={false}>
      <mesh geometry={markerGeo} material={markerMat} scale={[1, 1.5, 1]} raycast={() => null} />
    </group>
  </group>;
}

// ---------------------------------------------------------------------------
// One resident
// ---------------------------------------------------------------------------
interface ResidentProps {
  id: string;
  displayName: string;
  appearance: AvatarAppearance;
  store: SceneStore;
  registry: Map<string, ResidentHandle>;
  pending: Map<string, Array<(h: ResidentHandle) => void>>;
  hub: BubbleHub;
  lodBus: LodBus;
  emotes: EmotePool;
  overlayRef: { readonly current: boolean };
  /** quality 'low': labels are DOM pills drawn by the layer; the sprite stays hidden. */
  domPlates: boolean;
  handleList: ResidentHandle[];
  distress: DistressBudget;
  isViewer: boolean;
  onSelect?: (id: string) => void;
}

const Resident = memo(function Resident(p: ResidentProps) {
  const { id, store, registry, pending, hub, lodBus, emotes, overlayRef } = p;
  const [lod, setLod] = useState<AvatarLod>(() => lodBus.lod.get(id) ?? 'mid');
  useEffect(() => lodBus.subscribe(id, setLod), [lodBus, id]);
  const rig = useAvatarRig(p.appearance, lod);
  const groupRef = useRef<THREE.Group>(null);
  const plateRef = useRef<THREE.Sprite>(null);
  const camera = useThree(s => s.camera);
  const hit = useMemo(() => acquireHit(), []);
  useEffect(() => () => releaseHit(), []);

  const handle = useMemo<ResidentHandle>(() => {
    const r = store.getResident(id);
    const h: ResidentHandle = {
      id, pos: new THREE.Vector3(r?.location.x ?? 0, 0, r?.location.z ?? 0), yaw: (hashString(id) % 628) / 100, height: 1.7,
      animator: null, visible: true, reaction: null, faceTarget: null,
      plateCand: false, plateAllowed: false, platePx: NAMEPLATE_MIN_PX, plateAspect: 3, plateY: 2, lastActorAt: -1e9, raidCollapsed: false,
      rigRoot: null, shadowOn: true, shadowApplied: null, plateNudgePx: 0,
      play(g, delay = 0) {
        if (delay > 0) { setTimeout(() => h.animator?.playGesture(g), delay * 1000); return; }
        h.animator?.playGesture(g);
      },
    };
    return h;
  }, [store, id]);

  // Motion state (refs, no React state).
  const m = useRef({
    target: new THREE.Vector3(), lastTarget: new THREE.Vector3(), hasTarget: false, estSpeed: 0, visSpeed: 0,
    lastActivity: '', family: 'idle' as AnimationFamily, seat: null as null | { x: number; z: number; facing: number },
    sitting: false, frameSkip: 0, accDt: 0, emoteTimer: 1 + Math.random() * 2, snapAt: 0,
    distress: null as null | 'sulk' | 'nap' | 'bored' | 'lonely',
  });

  useEffect(() => {
    registry.set(id, handle);
    p.handleList.push(handle);
    return () => {
      if (registry.get(id) === handle) registry.delete(id);
      const i = p.handleList.indexOf(handle);
      if (i >= 0) p.handleList.splice(i, 1);
    };
  }, [registry, id, handle, p.handleList]);

  useEffect(() => {
    if (!rig) return;
    const anim = new AvatarAnimator(rig, hashString(id));
    // Start in the right family without a visible fade on spawn / LOD swap.
    const fam0 = m.current.family;
    const noSeat = overlayRef.current && !(OVERLAY_SEATS_DRAWN && m.current.seat);
    const fam = (fam0 === 'sit' || fam0 === 'sleep') && noSeat ? 'idle' : fam0;
    anim.setBase(fam, {});
    for (let i = 0; i < 30; i++) anim.update(1 / 30);
    handle.animator = anim;
    handle.height = rig.height > 0.3 ? rig.height : 1.7;
    handle.rigRoot = rig.root;
    handle.shadowApplied = null;
    if (!handle.shadowOn) rig.root.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.userData.hwCast = mesh.castShadow; mesh.castShadow = false; } });
    handle.shadowApplied = handle.shadowOn ? null : false;
    rig.root.traverse(o => { o.raycast = () => {}; });
    const queued = pending.get(id);
    if (queued) { pending.delete(id); for (const fn of queued) fn(handle); }
    return () => { if (handle.animator === anim) { handle.animator = null; handle.rigRoot = null; } };
  }, [rig, id, handle, pending, overlayRef]);

  const plate = useMemo(() => makeNameplateTexture(p.displayName, p.isViewer ? '#5ef2c6' : undefined), [p.displayName, p.isViewer]);
  useEffect(() => () => plate.texture.dispose(), [plate]);
  /** "Name …" variant shown while this resident's bubble is collapsed (created lazily). */
  const plateAlt = useRef<{ texture: THREE.CanvasTexture; aspect: number } | null>(null);
  const plateCol = useRef(false);
  useEffect(() => () => { plateAlt.current?.texture.dispose(); plateAlt.current = null; }, [plate]);
  // Labels draw on top of scenery (lamp posts/umbrellas must not cut names); declutter keeps them few.
  const plateMat = useMemo(() => new THREE.SpriteMaterial({ map: plate.texture, transparent: true, depthWrite: false, depthTest: false, opacity: 0.9, toneMapped: false }), [plate]);
  useEffect(() => () => plateMat.dispose(), [plateMat]);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const dt = Math.min(delta, 0.1);
    const s = m.current;
    const r = store.getResident(id);
    const now = performance.now();
    if (r) {
      // --- Snapshot target + speed estimate ---------------------------------
      const tx = r.location.x, tz = r.location.z;
      if (!s.hasTarget) {
        s.target.set(tx, 0, tz); s.lastTarget.copy(s.target); handle.pos.copy(s.target); s.hasTarget = true; s.snapAt = now;
      } else if (tx !== s.target.x || tz !== s.target.z) {
        s.lastTarget.copy(s.target);
        s.target.set(tx, 0, tz);
        const interval = Math.max(0.2, Math.min(2, (now - s.snapAt) / 1000 || store.snapshotInterval / 1000));
        s.snapAt = now;
        const snapSpeed = Math.min(8, s.lastTarget.distanceTo(s.target) / interval);
        s.estSpeed = s.estSpeed * 0.45 + snapSpeed * 0.55;
      } else if (now - s.snapAt > store.snapshotInterval * 1.6) {
        s.estSpeed *= Math.exp(-dt * 3);
      }
      // --- Activity → family / seat -----------------------------------------
      if (r.activity !== s.lastActivity) {
        s.lastActivity = r.activity;
        s.family = animationForVerb(parseActivityVerb(r.activity));
        const act = r.activity.toLowerCase();
        // Distress is keyed on phrase text (sim verbs vary: sitting/watching/playing/resting...).
        s.distress = /^\s*sulking\b/.test(act) ? 'sulk'
          : /(about a nap|\b(nap|naps|yawn|yawning|sleepy|drowsy|tired)\b)/.test(act) ? 'nap'
            : /(\balone\b|the crowd)/.test(act) ? 'lonely'
              : /(looking for fun|something fun|\bbored\b|nothing to do)/.test(act) ? 'bored' : null;
        s.seat = null;
        if (s.family === 'sit' || s.family === 'sleep') {
          const found = findSeatNear(tx, tz, 1.2);
          s.seat = found ? { x: found.seat.x, z: found.seat.z, facing: found.seat.facing } : null;
        }
      }
    }

    // --- Movement -------------------------------------------------------------
    const pos = handle.pos;
    const overlayMode = overlayRef.current;
    // Overlay mode has no ground: sit/sleep only on a drawn layout seat, never on empty air.
    const wantsSit = s.family === 'sit' || s.family === 'sleep';
    const sitAllowed = !overlayMode || (OVERLAY_SEATS_DRAWN && !!s.seat);
    const sitFam = wantsSit && sitAllowed;
    const toSeat = sitFam && !!s.seat && s.estSpeed < 0.3;
    const goal = toSeat && s.seat ? _v.set(s.seat.x, 0, s.seat.z) : _v.copy(s.target);
    const dx = goal.x - pos.x, dz = goal.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const seated = sitFam && s.estSpeed < 0.3 && dist < 0.3;
    let moved = 0;
    if (dist > TELEPORT_DISTANCE) { pos.copy(goal); s.visSpeed = 0; }
    else if (dist > 0.005) {
      const lagTarget = s.estSpeed * (store.snapshotInterval / 1000);
      const catchUp = s.estSpeed > 0.2 ? Math.min(1.6, Math.max(0.75, 1 + (dist - lagTarget) / Math.max(0.4, lagTarget * 2))) : 1;
      const want = Math.max(s.estSpeed * catchUp, Math.min(1.4, dist * 2.2));
      const step = Math.min(dist, want * dt);
      pos.x += (dx / dist) * step; pos.z += (dz / dist) * step;
      moved = step;
    }
    const inst = dt > 0 ? moved / dt : 0;
    s.visSpeed += (inst - s.visSpeed) * (1 - Math.exp(-dt * 6));

    // --- Facing ---------------------------------------------------------------
    let desiredYaw: number | null = null;
    if (s.visSpeed > 0.25 && dist > 0.01) desiredYaw = Math.atan2(dx, dz);
    else if (seated && s.seat) desiredYaw = s.seat.facing;
    else {
      const ft = handle.faceTarget;
      let partner: string | undefined;
      if (ft && ft.until > nowS()) partner = ft.id;
      else handle.faceTarget = null;
      if (!partner) {
        const fe = store.latestEventFor(id, 6000);
        if (fe) partner = fe.event.actorId === id ? fe.event.targetId : fe.event.actorId;
      }
      const ph = partner ? registry.get(partner) : undefined;
      if (ph && ph !== handle) {
        const fx = ph.pos.x - pos.x, fz = ph.pos.z - pos.z;
        if (fx * fx + fz * fz > 0.04 && fx * fx + fz * fz < 400) desiredYaw = Math.atan2(fx, fz);
      }
    }
    if (desiredYaw !== null) handle.yaw = angleLerp(handle.yaw, desiredYaw, 1 - Math.exp(-dt * (seated ? 5 : 7)));
    g.position.copy(pos);
    g.rotation.y = handle.yaw;

    // --- Visibility / update rate --------------------------------------------
    const camDist = pos.distanceTo(camera.position);
    if (frameCache.time !== state.clock.elapsedTime) {
      frameCache.time = state.clock.elapsedTime;
      _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_m);
      const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 50;
      frameCache.pxk = state.size.height / (2 * Math.tan((fov * Math.PI) / 360));
    }
    _sphere.center.set(pos.x, pos.y + 0.9, pos.z); _sphere.radius = 1.3;
    const onScreen = _frustum.intersectsSphere(_sphere);
    handle.visible = onScreen && camDist < 90;

    const plateS = plateRef.current;
    if (plateS) {
      const fade = 1 - Math.min(1, Math.max(0, (camDist - NAMEPLATE_SOLID) / (NAMEPLATE_FAR - NAMEPLATE_SOLID)));
      handle.plateCand = fade > 0.02 && handle.visible && !hub.shown.has(id) && !handle.raidCollapsed;
      const col = hub.collapsed.has(id);
      if (col !== plateCol.current && !p.domPlates) {
        plateCol.current = col;
        if (col && !plateAlt.current) plateAlt.current = makeNameplateTexture(`${p.displayName} …`, p.isViewer ? '#5ef2c6' : undefined);
        plateMat.map = col && plateAlt.current ? plateAlt.current.texture : plate.texture;
        plateMat.needsUpdate = true;
      }
      plateS.visible = !p.domPlates && handle.plateCand && handle.plateAllowed;
      plateMat.opacity = fade;
      // Readable in wide shots: clamp the on-screen pill height, keep depth cue in between.
      const pxPerM = frameCache.pxk / Math.max(1, camDist);
      const px = Math.min(NAMEPLATE_MAX_PX, Math.max(NAMEPLATE_MIN_PX, NAMEPLATE_WORLD_H * pxPerM));
      const sc = px / pxPerM;
      const aspect = plateCol.current && plateAlt.current ? plateAlt.current.aspect : plate.aspect;
      plateS.scale.set(sc * aspect, sc, 1);
      const baseY = handle.height + 0.16 + sc * 0.55 - (seated ? 0.42 : 0);
      // Declutter projects the un-nudged spot (no feedback loop); the sprite shows the nudged one.
      plateS.position.y = baseY - handle.plateNudgePx / pxPerM;
      handle.platePx = px; handle.plateAspect = aspect; handle.plateY = baseY;
    }

    const anim = handle.animator;
    if (!anim) return;
    s.accDt += dt;
    const every = !onScreen ? 6 : camDist > 45 ? 3 : camDist > 25 ? 2 : 1;
    if ((s.frameSkip = (s.frameSkip + 1) % every) !== 0) return;
    const adt = s.accDt; s.accDt = 0;

    // --- Animation family ------------------------------------------------------
    let fam: AnimationFamily = wantsSit && !sitAllowed ? 'idle' : s.family;
    let speed = 1;
    if (handle.reaction && handle.reaction.until < nowS()) handle.reaction = null;
    if (s.visSpeed > 0.22 && !seated) {
      fam = s.visSpeed > 2.3 ? 'run' : 'walk';
      speed = fam === 'run' ? s.visSpeed / RUN_SPEED : s.visSpeed / WALK_SPEED;
    } else if (handle.reaction) fam = handle.reaction.family;
    else if (fam === 'walk' || fam === 'run') fam = 'idle';
    else if ((fam === 'sit' || fam === 'sleep')) anim.setSeatHeight(s.seat ? 0.45 : 0.12);
    anim.setBase(fam, { speed });
    anim.update(adt);

    // Ambient emotes.
    if (onScreen && camDist < 35 && (s.emoteTimer -= adt) <= 0) {
      const es = p.isViewer ? VIEWER_EMOTE_SCALE : 1;
      if (fam === 'sleep') { emotes.spawn('zzz', pos.x + 0.1, pos.y + handle.height * 0.75, pos.z, 1, 0.05, es); s.emoteTimer = 2.2; }
      else if (fam === 'dance') { emotes.spawn('note', pos.x, pos.y + handle.height + 0.1, pos.z, 1, 0.5, es); s.emoteTimer = 1.3 + Math.random(); }
      else if (s.distress) {
        // Small, rate-limited distress cues keyed on the activity text.
        if (takeDistress(p.distress)) {
          if (s.distress === 'sulk') emotes.spawn('cloud', pos.x, pos.y + handle.height + 0.22, pos.z, 1, 0.08, es);
          else if (s.distress === 'nap') emotes.spawn('zzz', pos.x + 0.08, pos.y + handle.height + 0.12, pos.z, 1, 0.05, 0.55 * es);
          else if (s.distress === 'lonely') emotes.spawn('sad', pos.x, pos.y + handle.height + 0.22, pos.z, 1, 0.05, es);
          else emotes.spawn('dots', pos.x, pos.y + handle.height + 0.22, pos.z, 1, 0.05, es);
        }
        s.emoteTimer = 6 + Math.random() * 2.5;
      }
      else if (fam === 'laugh' || fam === 'celebrate') { emotes.spawn('sparkle', pos.x, pos.y + handle.height + 0.1, pos.z, 1, 0.5, es); s.emoteTimer = 1.6; }
      else s.emoteTimer = 2;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); p.onSelect?.(id); };
  const onOver = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; };
  const onOut = () => { document.body.style.cursor = ''; };
  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return <group ref={groupRef} name={`resident:${id}`}>
    {rig && <primitive object={rig.root} />}
    <mesh geometry={hit.geo} material={hit.mat} position={[0, 0.85, 0]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut} />
    <sprite ref={plateRef} material={plateMat} renderOrder={40} raycast={() => null} />
    <SpeechBubble hub={hub} id={id} height={handle.height} isViewer={p.isViewer} />
  </group>;
});

/**
 * Bubble DOM. No drei `distanceFactor`: the layer writes a clamped `--s`
 * scale every frame so text never drops below ~14 px in wide shots.
 */
function SpeechBubble({ hub, id, height, isViewer }: { hub: BubbleHub; id: string; height: number; isViewer: boolean }) {
  const [b, setB] = useState<BubbleData | null>(null);
  useEffect(() => hub.subscribe(id, setB), [hub, id]);
  if (!b) return null;
  const cls = `hw-bubble${b.sim ? ' hw-sim' : ''}${isViewer ? ' hw-me' : ''}`;
  // Hidden until the layout pass places it (opacity is driven by the layer).
  return <Html position={[0, height + 0.42, 0]} center={false} zIndexRange={[30, 10]}
    style={{ pointerEvents: 'none', transform: 'translateX(-50%)' }}>
    <div key={b.key} className={cls} style={{ opacity: 0 }}
      ref={el => { const L = hub.layout.get(id); if (el && L) { L.el = el; L.wsc = NaN; L.wdx = NaN; L.wdy = NaN; L.wop = NaN; } }}>
      <span className="hw-name">{b.name}</span>{b.text}<i className="hw-stem" />
    </div>
  </Html>;

}
