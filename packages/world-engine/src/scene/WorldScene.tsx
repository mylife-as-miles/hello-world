/**
 * WorldScene — the one 3D implementation of the HELLO WORLD neighborhood.
 * Implements the contract `WorldSceneProps` exactly, plus optional extension
 * props (`WorldSceneExtraProps`). One SceneStore per runtime bridges snapshots
 * to the render loop; React only re-renders on structure changes. The 3D
 * content is memoised with stable callbacks so host re-renders do not cascade.
 */
import { Component, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldSceneProps } from '@hello-world/contracts';
import { SceneStore } from '../core/sceneStore';
import { SceneStoreContext } from '../core/SceneContext';
import { ResidentsLayer } from '../interactions/ResidentsLayer';
import { ResidentInspector } from '../interactions/ResidentInspector';
import { findSeatNear, getPoi, type Seat } from '../world/layout';
import { animationForVerb, parseActivityVerb } from '../world/activities';
import { createKit, type SceneKit } from './kit';
import { KitContext, useKit } from './context';
import { Town } from './Town';
import { Atmosphere } from './Atmosphere';
import { SkyDome, Clouds, createSkyUniforms } from './Sky';
import { Fountain } from './Fountain';
import { StageLights } from './StageLights';
import { Portal } from './Portal';
import { Bursts } from './Bursts';
import { WeatherFx } from './Weather';
import { CameraRig, poseFor, type RigMode } from './CameraRig';
import { PostFX } from './PostFX';
import { Hud } from './Hud';
import { createWorldRenderer, type RendererPreference, type WorldRendererStatus } from './renderer';
class WebGPUGuard extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

import { EventBanner } from './EventBanner';
import { buildOverlayPropGroups, groundHeight } from './town';
import { DowntownDistrict, districtOccupied } from './district';
import { GeneratedTrees, PARK_TREE_PLACEMENTS, TREE_VARIANT_INDEX, type TreePlacement } from './foliage';
import { Landscape, terrainHeightAt, FOREST_PLACEMENTS, FOREST_PLACEMENTS_LOW } from './landscape';

/**
 * Scenery modules. `USE_LANDSCAPE` swaps the built-in forest belt / hills / rolling ground for
 * the terrain ring + generated forest (src/scene/landscape + src/scene/foliage).
 */
const USE_LANDSCAPE = true;
const toTree = (p: { x: number; y: number; z: number; scale: number; rot: number; species: keyof typeof TREE_VARIANT_INDEX }): TreePlacement =>
  ({ x: p.x, y: p.y, z: p.z, scale: p.scale, rot: p.rot, variant: TREE_VARIANT_INDEX[p.species] ?? 0 });
const TREES_HIGH: ReadonlyArray<TreePlacement> = USE_LANDSCAPE ? [...PARK_TREE_PLACEMENTS, ...FOREST_PLACEMENTS.map(toTree)] : PARK_TREE_PLACEMENTS;
/** Low quality: generated (leaf-card) trees only near the town; the distant forest becomes merged low-poly trees. */
const LOW_NEAR_RADIUS = 56;
const TREES_LOW: ReadonlyArray<TreePlacement> = USE_LANDSCAPE
  ? [...PARK_TREE_PLACEMENTS, ...FOREST_PLACEMENTS_LOW.filter(p => Math.hypot(p.x, p.z) < LOW_NEAR_RADIUS).map(toTree)]
  : PARK_TREE_PLACEMENTS;
const FAR_TREES_LOW = USE_LANDSCAPE ? FOREST_PLACEMENTS_LOW.filter(p => Math.hypot(p.x, p.z) >= LOW_NEAR_RADIUS) : [];
/** Stable height sampler for the downtown ring (terrain when the landscape is mounted). */
const DISTRICT_HEIGHT = USE_LANDSCAPE ? terrainHeightAt : groundHeight;

export type WorldSceneExtraProps = {
  /** Opt-in WebGPU presentation with automatic WebGL fallback. WebGL remains default. */
  renderer?: RendererPreference;
  /** Actual backend, never inferred from a requested option or API presence. */
  onRendererChange?: (status: WorldRendererStatus) => void;
  /** Resident id of the local viewer (highlights "you", enables the inspector). */
  viewerResidentId?: string;
  /** Called with the POI id when the ground / a building is clicked. */
  onLocationSelect?: (poiId: string) => void;
  /** Glassy clock/weather pill (DOM). Default false — host apps bring their own chrome. */
  showHud?: boolean;
  /** Resident inspector card (DOM). Default false; true when viewerResidentId is provided. */
  showInspector?: boolean;
  /**
   * Built-in forest belt, distant hills and rolling ground around the town (default true).
   * Set false when an external landscape module (src/scene/landscape) is mounted.
   */
  builtInHorizon?: boolean;
  /**
   * OBS overlay (`transparent` + 'neighborhood'): viewer events (raid, join, gift, social, wave, dance,
   * confetti, chat) get a short directed shot that exact-fits only their subjects, then glide back to the
   * full fit. Default true; false keeps the static full fit.
   */
  overlayEventShots?: boolean;
};

export function WorldScene(props: WorldSceneProps & WorldSceneExtraProps) {
  const {
    runtime, transparent = false, cameraMode = 'neighborhood', selectedResidentId, onResidentSelect,
    quality = 'high', className, viewerResidentId, onLocationSelect, builtInHorizon = true, overlayEventShots = true,
  } = props;
  const preference = props.renderer ?? 'webgl';
  const [webGPUFailed, setWebGPUFailed] = useState(false);
  const [rendererStatus, setRendererStatus] = useState<WorldRendererStatus>({ requested: preference, backend: 'webgl' });
  const rendererCallback = useRef(props.onRendererChange); rendererCallback.current = props.onRendererChange;
  useEffect(() => setWebGPUFailed(false), [preference]);
  const effectivePreference: RendererPreference = webGPUFailed ? 'webgl' : preference;
  const setStatus = (status: WorldRendererStatus) => { setRendererStatus(status); rendererCallback.current?.(status); };
  const createRenderer = useMemo(() => async (defaults: Parameters<typeof createWorldRenderer>[0]) => createWorldRenderer(defaults, {
    preference: effectivePreference, transparent,
    onStatus: status => { setRendererStatus(status); rendererCallback.current?.(status); },
    onDeviceLost: reason => { setWebGPUFailed(true); setStatus({ requested: preference, backend: 'webgl', reason }); },
  }), [effectivePreference, transparent, preference]);
  const showHud = props.showHud ?? false;
  const showInspector = props.showInspector ?? viewerResidentId !== undefined;

  const store = useMemo(() => new SceneStore(runtime), [runtime]);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  const kit = useMemo(() => createKit(), []);
  useEffect(() => () => kit.dispose(), [kit]);

  // Stable callbacks (latest-ref pattern) so the memoised 3D tree never re-renders on host renders.
  const selectRef = useRef(onResidentSelect);
  const locationRef = useRef(onLocationSelect);
  useEffect(() => { selectRef.current = onResidentSelect; locationRef.current = onLocationSelect; });
  const [localSel, setLocalSel] = useState<string | undefined>(undefined);
  const controlled = onResidentSelect !== undefined;
  const selected = controlled ? selectedResidentId : (selectedResidentId ?? localSel);
  const select = useCallback((id: string) => {
    const f = selectRef.current;
    if (f) f(id); else setLocalSel(id || undefined);
  }, []);
  const hasLocation = onLocationSelect !== undefined;
  const selectLocation = useMemo(() => (hasLocation ? (id: string) => locationRef.current?.(id) : undefined), [hasLocation]);
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  useEffect(() => { setDismissed(undefined); }, [selected]);
  const closeInspector = useCallback(() => {
    setDismissed(selected);
    const f = selectRef.current;
    if (f) f(''); else setLocalSel(undefined);
  }, [selected]);

  // Transparent overlay honours the requested camera; the default 'neighborhood' becomes the
  // adaptive overlay framing (fits current residents into a lower-third band).
  const rigMode: RigMode = transparent && cameraMode === 'neighborhood' ? 'overlay' : cameraMode;
  const initial = useMemo(() => {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    poseFor(rigMode, 0, pos, look);
    return [pos.x, pos.y, pos.z] as [number, number, number];
    // only the very first pose matters; the rig takes over afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transparent]);

  const canvas = (
      <Canvas
        key={`${transparent ? 'overlay' : 'world'}-${effectivePreference}`}
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={quality === 'high' ? [1, 1.75] : [1, 1]}
        gl={effectivePreference === 'webgl' ? { alpha: transparent, antialias: true, preserveDrawingBuffer: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace } : createRenderer}
        frameloop="always"
        camera={{ fov: 42, near: 0.1, far: 1200, position: initial }}
        style={{ position: 'absolute', inset: 0, background: 'transparent' }}
        onCreated={({ gl, scene }) => {
          if (effectivePreference === 'webgl') { const status: WorldRendererStatus = { requested: preference, backend: 'webgl', ...(webGPUFailed ? { reason: 'WebGPU initialization or device failed; using WebGL.' } : {}) }; gl.domElement.dataset.renderer = 'webgl'; setStatus(status); }
          if (transparent) { gl.setClearColor(0x000000, 0); scene.background = null; }
          else gl.setClearColor('#cfe6f3', 1);
        }}
      >
        <SceneStoreContext.Provider value={store}>
          <KitContext.Provider value={kit}>
            <Suspense fallback={null}><WorldContent
              kit={kit} store={store} transparent={transparent} quality={quality} rigMode={rigMode}
              selectedResidentId={selected} onResidentSelect={select} viewerResidentId={viewerResidentId}
              onLocationSelect={selectLocation} builtInHorizon={builtInHorizon} overlayEventShots={overlayEventShots}
            /></Suspense>
          </KitContext.Provider>
        </SceneStoreContext.Provider>
      </Canvas>
  );

  return (
    <div data-renderer={rendererStatus.backend} data-renderer-requested={rendererStatus.requested} data-renderer-reason={rendererStatus.reason} className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {effectivePreference === 'webgl' ? canvas : <WebGPUGuard key={effectivePreference} onFailure={() => setWebGPUFailed(true)}>{canvas}</WebGPUGuard>}
      {showInspector && (
        <ResidentInspector
          store={store} runtime={runtime}
          selectedResidentId={dismissed === selected ? undefined : selected}
          viewerResidentId={viewerResidentId}
          onClose={closeInspector}
        />
      )}
      {showHud && !transparent && <Hud store={store} />}
      <EventBanner store={store} />
    </div>
  );
}

interface ContentProps {
  kit: SceneKit;
  store: SceneStore;
  transparent: boolean;
  quality: 'low' | 'high';
  rigMode: RigMode;
  selectedResidentId?: string;
  onResidentSelect: (id: string) => void;
  viewerResidentId?: string;
  onLocationSelect?: (poiId: string) => void;
  builtInHorizon: boolean;
  overlayEventShots: boolean;
}

const WorldContent = memo(function WorldContent({
  kit, store, transparent, quality, rigMode, selectedResidentId, onResidentSelect, viewerResidentId, onLocationSelect, builtInHorizon, overlayEventShots,
}: ContentProps) {
  const webgpu = useThree(state => Boolean((state.gl as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend?.isWebGPUBackend));
  const sky = useMemo(() => createSkyUniforms(), []);
  const cloudTint = useMemo(() => new THREE.Color('#ffffff'), []);
  useEventReactions(kit, store);
  return (
    <>
      <Atmosphere transparent={transparent} quality={quality} sky={sky} cloudTint={cloudTint} />
      {!transparent && <SkyDome uniforms={sky} />}
      {!transparent && quality === 'high' && <Clouds tint={cloudTint} />}
      {!transparent && (
        <Town quality={quality} onLocationSelect={onLocationSelect} horizon={builtInHorizon && !USE_LANDSCAPE}
          reservedTrees={PARK_TREE_PLACEMENTS} occupied={districtOccupied} terrainAt={USE_LANDSCAPE ? terrainHeightAt : undefined}
          farTrees={quality === 'low' ? FAR_TREES_LOW : undefined} />
      )}
      {!transparent && <Fountain />}
      {!transparent && <StageLights />}
      <WeatherFx quality={quality} overlay={transparent} />
      {!transparent && USE_LANDSCAPE && <Landscape quality={quality} transparent={transparent} />}
      {!transparent && <DowntownDistrict quality={quality} transparent={transparent} heightAt={DISTRICT_HEIGHT} />}
      {!transparent && (quality === 'high'
        ? <GeneratedTrees quality={quality} placements={TREES_HIGH} />
        : <GeneratedTrees quality={quality} placements={TREES_LOW} farDistance={400} />)}
      {transparent && <ShadowCatcher />}
      {transparent && <OverlayStageDecal />}
      {transparent && <OverlayFurniture store={store} />}
      <RenderStats />
      <Portal quality={quality} overlay={transparent} />
      <Bursts quality={quality} />
      <ResidentsLayer
        selectedResidentId={selectedResidentId} onResidentSelect={onResidentSelect} quality={quality}
        viewerResidentId={viewerResidentId} overlay={transparent}
      />
      <CameraRig mode={rigMode} selectedResidentId={selectedResidentId} transparent={transparent} quality={quality} overlayEventShots={overlayEventShots} />
      {quality === 'high' && !transparent && !webgpu && <PostFX />}
    </>
  );
});

/** Overlay mode: only soft contact shadows under residents (transparent elsewhere). */
function ShadowCatcher() {
  const geo = useMemo(() => { const g = new THREE.CircleGeometry(30, 48); g.rotateX(-Math.PI / 2); return g; }, []);
  const mat = useMemo(() => new THREE.ShadowMaterial({ opacity: 0.22 }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} receiveShadow position={[0, 0.01, 0]} />;
}

/** Radial-gradient decal texture (sRGB); null outside the DOM. Stops: [offset 0…1, css colour]. */
function radialTexture(stops: ReadonlyArray<readonly [number, string]>, size = 128): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Must match ResidentsLayer: an overlay resident with a sit/sleep activity sits on findSeatNear(location, 1.2). */
const OVERLAY_SEAT_RADIUS = 1.2;
/** A prop stays this long (s) after its sitter got up, so they are clear of it before it goes. */
const OVERLAY_PROP_HOLD = 2.5;
const easeOutBack = (k: number) => { const c1 = 1.1, c3 = c1 + 1, u = k - 1; return 1 + c3 * u * u * u + c1 * u * u; };

/**
 * Overlay mode: benches, café chairs and café tables are drawn only while someone sits (or is
 * settling in) there, using the same rule ResidentsLayer uses to seat overlay residents (sit/sleep
 * activity → the layout seat within 1.2 m of their location), so a seated resident always has a
 * drawn seat under them while idle furniture never clutters the stream (and nobody standing clips
 * into an empty café table). A prop pops in from the ground (0.3 s) as its sitter arrives and leaves
 * 2.5 s after they go; each has a soft contact shadow. Hidden props cost no draw calls.
 */
function OverlayFurniture({ store }: { store: SceneStore }) {
  const kit = useKit();
  const res = useMemo(() => {
    const groups = buildOverlayPropGroups();
    const tex = radialTexture([[0, 'rgba(0,0,0,0.42)'], [0.55, 'rgba(0,0,0,0.22)'], [1, 'rgba(0,0,0,0)']]);
    const blobGeo = new THREE.PlaneGeometry(2, 2);
    blobGeo.rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? '#ffffff' : '#000000', transparent: true, opacity: tex ? 1 : 0.2, depthWrite: false, toneMapped: false });
    return { groups, tex, blobGeo, blobMat, k: groups.map(() => 0), lastUse: groups.map(() => -1e9), used: new Set<Seat>(), next: 0, primed: false };
  }, []);
  useEffect(() => () => { for (const g of res.groups) g.geometry.dispose(); res.tex?.dispose(); res.blobGeo.dispose(); res.blobMat.dispose(); }, [res]);
  const refs = useRef<Array<THREE.Group | null>>([]);
  useFrame((_, delta) => {
    const t = kit.env.t;
    const residents = store.current.residents;
    const prime = !res.primed && residents.length > 0;
    if (t >= res.next || prime) {
      res.next = t + 0.2;
      res.used.clear();
      for (const r of residents) {
        const fam = animationForVerb(parseActivityVerb(r.activity));
        if (fam !== 'sit' && fam !== 'sleep') continue;
        const found = findSeatNear(r.location.x, r.location.z, OVERLAY_SEAT_RADIUS);
        if (found) res.used.add(found.seat);
      }
      res.groups.forEach((g, i) => { if (g.seats.some(s => res.used.has(s))) res.lastUse[i] = t; });
    }
    if (prime) res.primed = true;
    const dt = Math.min(delta, 0.1);
    res.groups.forEach((_, i) => {
      const want = t - res.lastUse[i]! < OVERLAY_PROP_HOLD ? 1 : 0;
      const cur = res.k[i]!;
      // first resident snapshot: seated residents already have their seat (no pop on load)
      const k = prime ? want : want > cur ? Math.min(1, cur + dt / 0.3) : Math.max(0, cur - dt / 0.25);
      res.k[i] = k;
      const o = refs.current[i];
      if (!o) return;
      o.visible = k > 0.001;
      const s = k >= 1 ? 1 : easeOutBack(k);
      o.scale.setScalar(Math.max(0.001, s));
    });
  });
  return (
    <group>
      {res.groups.map((g, i) => (
        <group key={i} name={`overlay-prop:${g.kind}`} ref={el => { refs.current[i] = el; }} position={[g.x, 0, g.z]} visible={false}>
          <mesh geometry={g.geometry} material={kit.solidKeep} castShadow receiveShadow />
          <mesh geometry={res.blobGeo} material={res.blobMat} position={[0, 0.015, 0]} scale={[g.shadow, 1, g.shadow]} renderOrder={-1} />
        </group>
      ))}
    </group>
  );
}

/**
 * Overlay mode: the dance stage as a soft warm floor decal (faint fill + rim) instead of an opaque
 * platform filling the stream frame; dancers stand on the ground there. Fades out when the camera
 * comes close (event close-ups), where it would only smear across the frame edge. One draw call.
 */
function OverlayStageDecal() {
  const res = useMemo(() => {
    const st = getPoi('stage')?.position ?? { x: 7.5, z: 7 };
    const tex = radialTexture([
      [0, 'rgba(255,228,184,0.1)'], [0.72, 'rgba(255,216,164,0.12)'], [0.84, 'rgba(232,176,110,0.36)'],
      [0.92, 'rgba(232,176,110,0.28)'], [1, 'rgba(232,176,110,0)'],
    ], 256);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    return { st, tex, geo, mat };
  }, []);
  useEffect(() => () => { res.tex?.dispose(); res.geo.dispose(); res.mat.dispose(); }, [res]);
  const ref = useRef<THREE.Mesh>(null);
  const ndc = useMemo(() => new THREE.Vector3(), []);
  useFrame(state => {
    const p = state.camera.position;
    let k = res.tex ? THREE.MathUtils.smoothstep(Math.hypot(p.x - res.st.x, p.y, p.z - res.st.z), 11, 17) : 0;
    if (k > 0) {
      // ...and as its centre nears the frame edge, so it is never a cropped smear in a corner
      ndc.set(res.st.x, 0, res.st.z).project(state.camera);
      k *= ndc.z < 1 ? THREE.MathUtils.smoothstep(1 - Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), 0.05, 0.3) : 0;
    }
    res.mat.opacity = k;
    if (ref.current) ref.current.visible = k > 0.01;
  });
  return <mesh ref={ref} geometry={res.geo} material={res.mat} position={[res.st.x, 0.012, res.st.z]} scale={[3.1, 1, 3.1]} renderOrder={-1} visible={false} />;
}

/**
 * Exposes averaged renderer.info numbers on the canvas element (`data-draw-calls`, `data-triangles`)
 * for QA/perf budgets. Accumulates across all render calls of a frame (shadow + post passes).
 */
function RenderStats() {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  useEffect(() => {
    // QA only (?hwdebug): expose scene + camera on the canvas element (draw-call breakdowns, click targeting).
    if (typeof location === 'undefined' || !location.search.includes('hwdebug')) return;
    const el = gl.domElement as unknown as { __hwScene?: THREE.Scene; __hwCamera?: THREE.Camera };
    el.__hwScene = scene; el.__hwCamera = camera;
    return () => { delete el.__hwScene; delete el.__hwCamera; };
  }, [gl, scene, camera]);
  const acc = useRef({ frames: 0, calls: 0, tris: 0 });
  useEffect(() => {
    const info = (gl as unknown as { info?: { autoReset: boolean } }).info;
    if (!info) return;
    const prev = info.autoReset;
    info.autoReset = false;
    return () => { info.autoReset = prev; };
  }, [gl]);
  useFrame(() => {
    const info = (gl as unknown as { info?: { reset(): void; render: { calls?: number; drawCalls?: number; triangles?: number } } }).info;
    if (!info) return;
    const a = acc.current;
    a.frames++; a.calls += info.render.calls ?? info.render.drawCalls ?? 0; a.tris += info.render.triangles ?? 0;
    info.reset();
    if (a.frames >= 20) {
      const el = gl.domElement as HTMLElement;
      el.dataset.drawCalls = String(Math.round(a.calls / a.frames));
      el.dataset.triangles = String(Math.round(a.tris / a.frames));
      a.frames = 0; a.calls = 0; a.tris = 0;
    }
  }, -50);
  return null;
}

const JOIN_COLORS = ['#b98cff', '#6ff3ff', '#ffffff', '#ffd6ff'];
const RAID_COLORS = ['#b98cff', '#ff6fd8', '#6ff3ff', '#ffffff', '#ffd166'];
const GIFT_COLORS = ['#ffd166', '#ff8fab', '#ffffff'];
/** Actor confetti pops this high (m): ~1.5 m above a head, inside a tight event close-up. */
const ACTOR_CONFETTI_Y = 3.2;

function useEventReactions(kit: SceneKit, store: SceneStore) {
  useEffect(() => {
    const portal = getPoi('portal')?.position ?? { x: 0, z: -24 };
    const v = new THREE.Vector3();
    let lastConfetti = -1e9;
    const at = (actorId: string, y: number) => {
      const r = store.getResident(actorId);
      return r ? v.set(r.location.x, y, r.location.z) : v.set(0, y, 0);
    };
    const confetti = (actorId: string, n: number) => {
      // bursts of confetti events share one pop (≤ 1 per 600 ms); emitted ~1.5 m above the actor's
      // head with a gentle lift so it falls around them inside a close event shot
      const now = kit.env.t;
      if (now - lastConfetti < 0.6) return;
      lastConfetti = now;
      kit.fx.emitConfetti(at(actorId, ACTOR_CONFETTI_Y), n, 'pop');
    };
    return store.onEvent(({ event }) => {
      switch (event.kind) {
        case 'raid':
          if (kit.env.t - kit.fx.raidAt < 1) break; // coalesce raid bursts
          kit.fx.raidAt = kit.env.t;
          kit.fx.emitSparkles(v.set(portal.x, 2.6, portal.z + 0.8), 260, RAID_COLORS, 1.8);
          kit.fx.emitConfetti(v.set(portal.x, 5.5, portal.z + 3), 420);
          kit.fx.emitConfetti(v.set(0, 6.5, 0), 300);
          break;
        case 'join':
          kit.fx.emitSparkles(v.set(portal.x, 1.6, portal.z + 2.2), 90, JOIN_COLORS, 0.9);
          break;
        case 'confetti':
          confetti(event.actorId, 320);
          break;
        case 'social':
          if (event.payload?.action === 'celebrate') confetti(event.actorId, 230);
          break;
        case 'gift':
          kit.fx.emitSparkles(at(event.actorId, 1.6), 50, GIFT_COLORS, 0.6);
          break;
        default:
          break;
      }
    });
  }, [kit, store]);
}
