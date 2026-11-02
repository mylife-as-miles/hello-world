/**
 * WorldScene — the one 3D implementation of the HELLO WORLD neighborhood.
 * Implements the contract `WorldSceneProps` exactly, plus optional extension
 * props (`WorldSceneExtraProps`). One SceneStore per runtime bridges snapshots
 * to the render loop; React only re-renders on structure changes. The 3D
 * content is memoised with stable callbacks so host re-renders do not cascade.
 */
import { Component, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldSceneProps } from '@hello-world/contracts';
import { SceneStore } from '../core/sceneStore';
import { SceneStoreContext } from '../core/SceneContext';
import { ResidentsLayer } from '../interactions/ResidentsLayer';
import { ResidentInspector } from '../interactions/ResidentInspector';
import { getPoi, POIS } from '../world/layout';
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
import { buildOverlayProps, groundHeight } from './town';
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
const TREES_LOW: ReadonlyArray<TreePlacement> = USE_LANDSCAPE ? [...PARK_TREE_PLACEMENTS, ...FOREST_PLACEMENTS_LOW.map(toTree)] : PARK_TREE_PLACEMENTS;
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
};

export function WorldScene(props: WorldSceneProps & WorldSceneExtraProps) {
  const {
    runtime, transparent = false, cameraMode = 'neighborhood', selectedResidentId, onResidentSelect,
    quality = 'high', className, viewerResidentId, onLocationSelect, builtInHorizon = true,
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
              onLocationSelect={selectLocation} builtInHorizon={builtInHorizon}
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
}

const WorldContent = memo(function WorldContent({
  kit, store, transparent, quality, rigMode, selectedResidentId, onResidentSelect, viewerResidentId, onLocationSelect, builtInHorizon,
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
          reservedTrees={PARK_TREE_PLACEMENTS} occupied={districtOccupied} terrainAt={USE_LANDSCAPE ? terrainHeightAt : undefined} />
      )}
      {!transparent && <Fountain />}
      {!transparent && <StageLights />}
      {!transparent && <WeatherFx quality={quality} />}
      {!transparent && USE_LANDSCAPE && <Landscape quality={quality} transparent={transparent} />}
      {!transparent && <DowntownDistrict quality={quality} transparent={transparent} heightAt={DISTRICT_HEIGHT} />}
      {!transparent && <GeneratedTrees quality={quality} placements={quality === 'high' ? TREES_HIGH : TREES_LOW} />}
      {transparent && <ShadowCatcher />}
      {transparent && <OverlaySeating />}
      {transparent && <OverlayContactShadows />}
      <RenderStats />
      <Portal quality={quality} overlay={transparent} />
      <Bursts quality={quality} />
      <ResidentsLayer
        selectedResidentId={selectedResidentId} onResidentSelect={onResidentSelect} quality={quality}
        viewerResidentId={viewerResidentId} overlay={transparent}
      />
      <CameraRig mode={rigMode} selectedResidentId={selectedResidentId} transparent={transparent} quality={quality} />
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

/** Overlay mode: benches, café chairs/tables and the stage platform so nobody sits or dances on air. */
function OverlaySeating() {
  const kit = useKit();
  const geo = useMemo(() => buildOverlayProps(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={kit.solid} castShadow receiveShadow />;
}

/** Overlay mode: soft contact-shadow patches under the drawn benches, café furniture and stage (1 draw call). */
function OverlayContactShadows() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const spots: Array<[number, number, number]> = [];
    for (const poi of POIS) {
      if (!poi.seats?.length) continue;
      if (poi.kind === 'bench') {
        const x = poi.seats.reduce((a, q) => a + q.x, 0) / poi.seats.length, z = poi.seats.reduce((a, q) => a + q.z, 0) / poi.seats.length;
        spots.push([x, z, 1.25]);
      } else if (poi.kind === 'cafe') {
        for (let i = 0; i + 1 < poi.seats.length; i += 2) spots.push([(poi.seats[i]!.x + poi.seats[i + 1]!.x) / 2, (poi.seats[i]!.z + poi.seats[i + 1]!.z) / 2, 1.45]);
      }
    }
    const st = getPoi('stage');
    if (st) spots.push([st.position.x, st.position.z, 3.7]);
    let tex: THREE.CanvasTexture | null = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      if (g) {
        const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
        grad.addColorStop(0, 'rgba(0,0,0,0.42)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.22)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
        tex = new THREE.CanvasTexture(c);
      }
    }
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? '#ffffff' : '#000000', transparent: true, opacity: tex ? 1 : 0.2, depthWrite: false, toneMapped: false });
    return { spots, tex, geo, mat };
  }, []);
  useEffect(() => () => { res.tex?.dispose(); res.geo.dispose(); res.mat.dispose(); }, [res]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const tmp = new THREE.Matrix4();
    res.spots.forEach(([x, z, r], i) => m.setMatrixAt(i, tmp.makeScale(r, 1, r).setPosition(x, 0.015, z)));
    m.instanceMatrix.needsUpdate = true;
  }, [res]);
  return <instancedMesh ref={ref} args={[res.geo, res.mat, res.spots.length]} frustumCulled={false} renderOrder={-1} />;
}

/**
 * Exposes averaged renderer.info numbers on the canvas element (`data-draw-calls`, `data-triangles`)
 * for QA/perf budgets. Accumulates across all render calls of a frame (shadow + post passes).
 */
function RenderStats() {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  useEffect(() => {
    // QA only (?hwdebug): expose the scene on the canvas element for draw-call breakdowns.
    if (typeof location === 'undefined' || !location.search.includes('hwdebug')) return;
    (gl.domElement as unknown as { __hwScene?: THREE.Scene }).__hwScene = scene;
    return () => { delete (gl.domElement as unknown as { __hwScene?: THREE.Scene }).__hwScene; };
  }, [gl, scene]);
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

function useEventReactions(kit: SceneKit, store: SceneStore) {
  useEffect(() => {
    const portal = getPoi('portal')?.position ?? { x: 0, z: -24 };
    const v = new THREE.Vector3();
    let lastConfetti = -1e9;
    const at = (actorId: string, y: number) => {
      const r = store.getResident(actorId);
      return r ? v.set(r.location.x, y, r.location.z) : v.set(0, y, 0);
    };
    const confetti = (actorId: string, y: number, n: number) => {
      // bursts of confetti events share one shower (≤ 1 per 600 ms)
      const now = kit.env.t;
      if (now - lastConfetti < 0.6) return;
      lastConfetti = now;
      kit.fx.emitConfetti(at(actorId, y), n);
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
          confetti(event.actorId, 6, 380);
          break;
        case 'social':
          if (event.payload?.action === 'celebrate') confetti(event.actorId, 5.5, 260);
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
