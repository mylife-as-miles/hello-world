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
import { findSeatNear, getPoi } from '../world/layout';
import { AvatarAnimator, RUN_SPEED, WALK_SPEED, type GestureName } from './animation/AvatarAnimator';
import { EmoteSystem, GiftSystem, makeNameplateTexture, type EmoteKind } from './effects';

export interface ResidentsLayerProps {
  selectedResidentId?: string;
  onResidentSelect?: (id: string) => void;
  quality?: 'low' | 'high';
  viewerResidentId?: string;
  /**
   * Transparent stream-overlay mode: no seats/benches are drawn, so residents
   * never sit or sleep on empty air (they stand instead). Defaults to auto:
   * true when the canvas is transparent (alpha) and the scene has no background.
   */
  overlay?: boolean;
}

const TELEPORT_DISTANCE = 8;
/** Max simultaneous speech bubbles (nearest/newest win; viewer's own always first). */
const BUBBLE_MAX_VISIBLE = 6;
const BUBBLE_MAX_VISIBLE_LOW = 4;
const BUBBLE_MAX_DISTANCE = 45;
/** On-screen bubble scale clamp (base text 14 px → never below 14 px, never huge up close). */
const BUBBLE_MIN_SCALE = 1;
const BUBBLE_MAX_SCALE = 1.3;
/** Distance (m) at which bubbles reach their minimum scale. */
const BUBBLE_SCALE_DISTANCE = 11.5;
const NAMEPLATE_SOLID = 22;
const NAMEPLATE_FAR = 36;
/** Only residents this close to a confetti burst / raid portal cheer. */
const CHEER_RADIUS = 12;
const VIEWER_EMOTE_SCALE = 1.35;

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
}
interface BubbleData { key: number; text: string; name: string; start: number; duration: number; sim: boolean }

class BubbleHub {
  private subs = new Map<string, (b: BubbleData | null) => void>();
  readonly active = new Map<string, BubbleData>();
  readonly els = new Map<string, HTMLDivElement>();
  /** Unscaled bubble size (px), measured once per bubble. */
  readonly sizes = new Map<string, { w: number; h: number }>();
  /** Last on-screen scale written to each bubble. */
  readonly scale = new Map<string, number>();
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
    this.sizes.delete(id);
    this.subs.get(id)?.(b);
    return duration;
  }
  tick(now: number) {
    for (const [id, b] of this.active) {
      if (now - b.start > b.duration) { this.active.delete(id); this.els.delete(id); this.sizes.delete(id); this.scale.delete(id); this.subs.get(id)?.(null); }
    }
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
.hw-bubble{--s:1;position:relative;transform-origin:50% 100%;transform:translateY(-100%) scale(var(--s));width:max-content;max-width:230px;min-width:96px;padding:8px 12px 9px;border-radius:16px;
background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(244,247,250,.95));color:#1d2329;box-shadow:0 6px 22px rgba(10,20,30,.28),0 1px 0 rgba(255,255,255,.6) inset;
font:500 14px/1.32 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.005em;white-space:normal;word-wrap:break-word;overflow-wrap:anywhere;
pointer-events:none;user-select:none;animation:hw-bubble-in .32s cubic-bezier(.2,1.4,.4,1) backwards;transition:opacity .45s ease}
.hw-bubble::after{content:'';position:absolute;left:50%;bottom:-7px;width:14px;height:14px;margin-left:-7px;background:#f4f7fa;transform:rotate(45deg);border-radius:0 0 4px 0;box-shadow:3px 3px 6px rgba(10,20,30,.12)}
.hw-bubble .hw-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:700 11px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7a5cff;margin-bottom:2px}
.hw-bubble.hw-sim .hw-name{color:#2f9e8a}
.hw-bubble.hw-me{background:linear-gradient(180deg,#ffffff,#effffa);box-shadow:0 0 0 2.5px #5ef2c6,0 8px 26px rgba(10,20,30,.34)}
.hw-bubble.hw-me::after{background:#effffa}
.hw-bubble.hw-me .hw-name{color:#0d9a76}
@keyframes hw-bubble-in{from{opacity:0;transform:translateY(-92%) scale(calc(var(--s) * .85))}to{opacity:1;transform:translateY(-100%) scale(var(--s))}}
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
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
/** Frustum shared by all residents, recomputed once per frame. */
const frameCache = { time: -1, frustum: _frustum };
const nowS = () => performance.now() / 1000;

/** Client rect of a visible ResidentInspector card near this canvas (bubbles avoid it). */
function findInspectorRect(canvas: HTMLElement): DOMRect | null {
  let node: HTMLElement | null = canvas.parentElement;
  for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
    const el = node.querySelector('.hw-insp');
    if (el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; }
  }
  return null;
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
  const emotes = useMemo(() => new EmoteSystem(quality === 'low' ? 40 : 80), [quality]);
  const gifts = useMemo(() => new GiftSystem(6), []);
  useEffect(() => () => emotes.dispose(), [emotes]);
  useEffect(() => () => gifts.dispose(), [gifts]);
  useEffect(() => { ensureStyles(); }, []);

  const camera = useThree(s => s.camera);
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const clock = useRef({ now: 0, lodTimer: 0, bubbleTimer: 0 });
  const viewerRef = useRef(viewerResidentId);
  viewerRef.current = viewerResidentId;
  /** Overlay mode, shared with residents through a ref (no re-render). */
  const overlayRef = useRef(overlay ?? false);

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
          withHandle(target, h => { face(h, actor); h.play('greet', 0.6); setTimeout(() => emoteAt(h, 'bang', 1), 300); });
          break;
        case 'dance':
          withHandle(actor, h => { h.reaction = { family: 'dance', until: now() + 8 }; emoteAt(h, 'note', 2); });
          break;
        case 'gift':
          withHandle(actor, h => {
            face(h, target, 4); h.play('give');
            const th = target ? registry.get(target) : undefined;
            if (th) {
              _v.set(h.pos.x + Math.sin(h.yaw) * 0.35, h.pos.y + h.height * 0.6, h.pos.z + Math.cos(h.yaw) * 0.35);
              _v2.set(th.pos.x, th.pos.y + th.height * 0.62, th.pos.z);
              face(th, actor, 5);
              gifts.launch(_v, _v2, () => {
                emotes.spawn('sparkle', th.pos.x, th.pos.y + th.height * 0.7, th.pos.z, 5, 0.5, emScale(th));
                emotes.spawn('heart', th.pos.x, th.pos.y + th.height + 0.2, th.pos.z, 3, 0.35, emScale(th));
                th.play('cheer'); th.animator?.flashExpression('happy', 1, 4);
              });
            } else emoteAt(h, 'sparkle', 3);
          });
          break;
        case 'social': {
          const action = e.payload?.action;
          if (sentiment === 'negative') {
            withHandle(actor, h => { face(h, target); h.play('shake'); emoteAt(h, 'cloud', 1); h.animator?.flashExpression('angry', 0.7, 3); });
            break;
          }
          withHandle(actor, h => {
            face(h, target);
            if (action === 'greet') { h.play('greet'); emoteAt(h, 'bang', 1); }
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
  }, [store, registry, pending, hub, emotes, gifts]);

  const ringRef = useRef<THREE.Mesh>(null);
  const markerRef = useRef<THREE.Group>(null);
  const lodRank = useMemo(() => [] as Array<{ id: string; d: number }>, []);
  const bubbleRank = useMemo(() => [] as Array<{ id: string; d: number; score: number }>, []);
  const shownRects = useMemo(() => new Float32Array(4 * 16), []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const c = clock.current;
    c.now = nowS();
    emotes.update(dt);
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

    // LOD assignment (2 Hz): nearest N within range get 'high'.
    if ((c.lodTimer -= dt) <= 0) {
      c.lodTimer = 0.5;
      overlayRef.current = overlay ?? (!!gl.getContextAttributes()?.alpha && !scene.background);
      const maxHigh = quality === 'low' ? 8 : 20;
      const highDist = quality === 'low' ? 18 : 30;
      lodRank.length = 0;
      for (const h of registry.values()) lodRank.push({ id: h.id, d: h.pos.distanceTo(camera.position) });
      lodRank.sort((a, b) => a.d - b.d);
      lodRank.forEach((r, i) => {
        const cur = lodBus.lod.get(r.id) ?? 'high';
        const limit = cur === 'high' ? highDist + 3 : highDist - 3;
        const forced = r.id === selectedResidentId || r.id === viewerResidentId;
        lodBus.set(r.id, forced || (i < maxHigh && r.d < limit) ? 'high' : 'low');
      });
    }

    // Speech bubbles: expire; keep a readable minimum on-screen size.
    hub.tick(c.now);
    if (hub.active.size) {
      for (const [id, el] of hub.els) {
        const h = registry.get(id);
        if (!h) continue;
        const d = Math.max(0.5, camera.position.distanceTo(_v.set(h.pos.x, h.pos.y + h.height, h.pos.z)));
        const sc = Math.min(BUBBLE_MAX_SCALE, Math.max(BUBBLE_MIN_SCALE, BUBBLE_SCALE_DISTANCE / d)) * (id === viewerResidentId ? 1.08 : 1);
        const prev = hub.scale.get(id) ?? 0;
        if (Math.abs(sc - prev) > 0.004) { hub.scale.set(id, sc); el.style.setProperty('--s', sc.toFixed(3)); }
      }
    }
    // Rank (viewer first, then newest/nearest), cap the count, skip bubbles that
    // would overlap a higher-ranked one or sit under the ResidentInspector card.
    if ((c.bubbleTimer -= dt) <= 0 && hub.active.size) {
      c.bubbleTimer = 0.15;
      const maxVisible = quality === 'low' ? BUBBLE_MAX_VISIBLE_LOW : BUBBLE_MAX_VISIBLE;
      bubbleRank.length = 0;
      for (const [id, b] of hub.active) {
        const h = registry.get(id);
        if (!h) continue;
        const d = h.pos.distanceTo(camera.position);
        const age = c.now - b.start;
        bubbleRank.push({ id, d, score: (id === viewerResidentId ? -1000 : 0) + d - (age < 1.5 ? 25 : 0) + age * 0.5 });
      }
      bubbleRank.sort((a, b) => a.score - b.score);
      const cr = gl.domElement.getBoundingClientRect();
      const ir = findInspectorRect(gl.domElement);
      let shown = 0;
      for (const r of bubbleRank) {
        const el = hub.els.get(r.id);
        const b = hub.active.get(r.id);
        const h = registry.get(r.id);
        if (!el || !b || !h) continue;
        let show = shown < maxVisible && r.d < BUBBLE_MAX_DISTANCE && h.visible;
        if (show) {
          _v.set(h.pos.x, h.pos.y + h.height + 0.42, h.pos.z).project(camera);
          if (_v.z > 1) show = false;
          else {
            let sz = hub.sizes.get(r.id);
            if (!sz && el.offsetWidth > 0) { sz = { w: el.offsetWidth, h: el.offsetHeight }; hub.sizes.set(r.id, sz); }
            const sc = hub.scale.get(r.id) ?? 1;
            const w = (sz?.w ?? 160) * sc, hh = ((sz?.h ?? 48) + 8) * sc;
            const x = cr.left + ((_v.x + 1) / 2) * cr.width, y = cr.top + ((1 - _v.y) / 2) * cr.height;
            const l = x - w / 2, rt = x + w / 2, t = y - hh, bt = y;
            if (ir && rt > ir.left && l < ir.right && bt > ir.top && t < ir.bottom) show = false;
            for (let k = 0; show && k < shown && k < 16; k++) {
              const o = k * 4;
              const ox = Math.min(rt, shownRects[o + 1]!) - Math.max(l, shownRects[o]!);
              const oy = Math.min(bt, shownRects[o + 3]!) - Math.max(t, shownRects[o + 2]!);
              // Any real overlap hides the lower-ranked bubble (text must never be covered).
              if (ox > 6 && oy > 4) show = false;
            }
            if (show && shown < 16) { const o = shown * 4; shownRects[o] = l; shownRects[o + 1] = rt; shownRects[o + 2] = t; shownRects[o + 3] = bt; }
          }
        }
        if (show) shown++;
        const fadingOut = c.now - b.start > b.duration - 0.5;
        el.style.opacity = show && !fadingOut ? '1' : '0';
      }
    }
  });

  const ringGeo = useMemo(() => new THREE.RingGeometry(0.5, 0.62, 48), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), []);
  const markerGeo = useMemo(() => new THREE.OctahedronGeometry(0.11, 0), []);
  const markerMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5ef2c6', emissive: '#1fbf94', emissiveIntensity: 0.9, roughness: 0.3 }), []);
  useEffect(() => () => { ringGeo.dispose(); ringMat.dispose(); markerGeo.dispose(); markerMat.dispose(); }, [ringGeo, ringMat, markerGeo, markerMat]);

  return <group name="residents-layer">
    {structure.map(s => <Resident key={s.id} id={s.id} displayName={s.displayName} appearance={s.resident.appearance}
      store={store} registry={registry} pending={pending} hub={hub} lodBus={lodBus} emotes={emotes} overlayRef={overlayRef}
      isViewer={s.id === viewerResidentId} onSelect={onResidentSelect} />)}
    <primitive object={emotes.group} />
    <primitive object={gifts.group} />
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
  emotes: EmoteSystem;
  overlayRef: { readonly current: boolean };
  isViewer: boolean;
  onSelect?: (id: string) => void;
}

const Resident = memo(function Resident(p: ResidentProps) {
  const { id, store, registry, pending, hub, lodBus, emotes, overlayRef } = p;
  const [lod, setLod] = useState<AvatarLod>(() => lodBus.lod.get(id) ?? 'high');
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
  });

  useEffect(() => {
    registry.set(id, handle);
    return () => { if (registry.get(id) === handle) registry.delete(id); };
  }, [registry, id, handle]);

  useEffect(() => {
    if (!rig) return;
    const anim = new AvatarAnimator(rig, hashString(id));
    // Start in the right family without a visible fade on spawn / LOD swap.
    const fam = m.current.family;
    anim.setBase(fam, {});
    for (let i = 0; i < 30; i++) anim.update(1 / 30);
    handle.animator = anim;
    handle.height = rig.height > 0.3 ? rig.height : 1.7;
    rig.root.traverse(o => { o.raycast = () => {}; });
    const queued = pending.get(id);
    if (queued) { pending.delete(id); for (const fn of queued) fn(handle); }
    return () => { if (handle.animator === anim) handle.animator = null; };
  }, [rig, id, handle, pending]);

  const plate = useMemo(() => makeNameplateTexture(p.displayName, p.isViewer ? '#5ef2c6' : undefined), [p.displayName, p.isViewer]);
  useEffect(() => () => plate.texture.dispose(), [plate]);
  const plateMat = useMemo(() => new THREE.SpriteMaterial({ map: plate.texture, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }), [plate]);
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
    // Overlay mode draws no benches: never sit/sleep on empty air.
    const sitFam = !overlayMode && (s.family === 'sit' || s.family === 'sleep');
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
    }
    _sphere.center.set(pos.x, pos.y + 0.9, pos.z); _sphere.radius = 1.3;
    const onScreen = _frustum.intersectsSphere(_sphere);
    handle.visible = onScreen && camDist < 90;

    const plateS = plateRef.current;
    if (plateS) {
      const fade = 1 - Math.min(1, Math.max(0, (camDist - NAMEPLATE_SOLID) / (NAMEPLATE_FAR - NAMEPLATE_SOLID)));
      plateS.visible = fade > 0.02 && !hub.active.has(id);
      plateMat.opacity = fade;
      const sc = 0.2 + camDist * 0.006;
      plateS.scale.set(sc * plate.aspect, sc, 1);
      plateS.position.y = handle.height + 0.28 + sc * 0.3;
    }

    const anim = handle.animator;
    if (!anim) return;
    s.accDt += dt;
    const every = !onScreen ? 6 : camDist > 45 ? 3 : camDist > 25 ? 2 : 1;
    if ((s.frameSkip = (s.frameSkip + 1) % every) !== 0) return;
    const adt = s.accDt; s.accDt = 0;

    // --- Animation family ------------------------------------------------------
    let fam: AnimationFamily = overlayMode && (s.family === 'sit' || s.family === 'sleep') ? 'idle' : s.family;
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
      else if (fam === 'sad') { emotes.spawn('cloud', pos.x, pos.y + handle.height + 0.3, pos.z, 1, 0.1, es); s.emoteTimer = 5; }
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
    <sprite ref={plateRef} material={plateMat} renderOrder={15} raycast={() => null} />
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
  return <Html position={[0, height + 0.42, 0]} center={false} zIndexRange={[30, 10]}
    style={{ pointerEvents: 'none', transform: 'translateX(-50%)' }}>
    <div key={b.key} className={cls} style={{ ['--s' as string]: String(hub.scale.get(id) ?? 1) }}
      ref={el => { if (el) { hub.els.set(id, el); hub.scale.delete(id); } }}>
      <span className="hw-name">{b.name}</span>{b.text}
    </div>
  </Html>;
}
