/**
 * WorldScene — the one 3D implementation of the HELLO WORLD neighborhood.
 * Implements the contract `WorldSceneProps` exactly, plus optional extension
 * props (`WorldSceneExtraProps`). One SceneStore per runtime bridges snapshots
 * to the render loop; React only re-renders on structure changes. The 3D
 * content is memoised with stable callbacks so host re-renders do not cascade.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldSceneProps } from '@hello-world/contracts';
import { SceneStore } from '../core/sceneStore';
import { SceneStoreContext } from '../core/SceneContext';
import { ResidentsLayer, type ResidentsLayerProps } from '../interactions/ResidentsLayer';
import { ResidentInspector } from '../interactions/ResidentInspector';
import { getPoi } from '../world/layout';
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
import { buildOverlayProps } from './town';

export type WorldSceneExtraProps = {
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

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <Canvas
        key={transparent ? 'overlay' : 'world'}
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={quality === 'high' ? [1, 1.75] : [1, 1]}
        gl={{ alpha: transparent, antialias: true, preserveDrawingBuffer: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        frameloop="always"
        camera={{ fov: 42, near: 0.1, far: 1200, position: initial }}
        style={{ position: 'absolute', inset: 0, background: 'transparent' }}
        onCreated={({ gl, scene }) => {
          if (transparent) { gl.setClearColor(0x000000, 0); scene.background = null; }
          else gl.setClearColor('#cfe6f3', 1);
        }}
      >
        <SceneStoreContext.Provider value={store}>
          <KitContext.Provider value={kit}>
            <WorldContent
              kit={kit} store={store} transparent={transparent} quality={quality} rigMode={rigMode}
              selectedResidentId={selected} onResidentSelect={select} viewerResidentId={viewerResidentId}
              onLocationSelect={selectLocation} builtInHorizon={builtInHorizon}
            />
          </KitContext.Provider>
        </SceneStoreContext.Provider>
      </Canvas>
      {showInspector && (
        <ResidentInspector
          store={store} runtime={runtime}
          selectedResidentId={dismissed === selected ? undefined : selected}
          viewerResidentId={viewerResidentId}
          onClose={closeInspector}
        />
      )}
      {showHud && !transparent && <Hud store={store} />}
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
  const sky = useMemo(() => createSkyUniforms(), []);
  const cloudTint = useMemo(() => new THREE.Color('#ffffff'), []);
  useEventReactions(kit, store);
  // `overlay` is an optional ResidentsLayer prop (added by the interactions module); passed through untyped
  // so this file compiles whether or not that prop exists yet.
  const overlayProps = useMemo(() => (transparent ? ({ overlay: true } as unknown as Partial<ResidentsLayerProps>) : undefined), [transparent]);
  return (
    <>
      <Atmosphere transparent={transparent} quality={quality} sky={sky} cloudTint={cloudTint} />
      {!transparent && <SkyDome uniforms={sky} />}
      {!transparent && <Clouds tint={cloudTint} />}
      {!transparent && <Town quality={quality} onLocationSelect={onLocationSelect} horizon={builtInHorizon} />}
      {!transparent && <Fountain />}
      {!transparent && <StageLights />}
      {!transparent && <WeatherFx quality={quality} />}
      {/*
        Optional scenery modules (mounted by the coordinator; folders owned by other agents):
          {!transparent && <DowntownDistrict quality={quality} transparent={transparent} />}   // ./district
          {!transparent && <Landscape quality={quality} />}                                     // ./landscape (pass builtInHorizon={false})
          {!transparent && quality === 'high' && <GeneratedTrees quality={quality} placements={PARK_TREE_PLACEMENTS} />} // ./foliage
      */}
      {transparent && <ShadowCatcher />}
      {transparent && <OverlaySeating />}
      <Portal quality={quality} overlay={transparent} />
      <Bursts quality={quality} />
      <ResidentsLayer
        selectedResidentId={selectedResidentId} onResidentSelect={onResidentSelect} quality={quality}
        viewerResidentId={viewerResidentId} {...overlayProps}
      />
      <CameraRig mode={rigMode} selectedResidentId={selectedResidentId} />
      {quality === 'high' && !transparent && <PostFX />}
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

const JOIN_COLORS = ['#b98cff', '#6ff3ff', '#ffffff', '#ffd6ff'];
const RAID_COLORS = ['#b98cff', '#ff6fd8', '#6ff3ff', '#ffffff', '#ffd166'];

function useEventReactions(kit: SceneKit, store: SceneStore) {
  useEffect(() => {
    const portal = getPoi('portal')?.position ?? { x: 0, z: -24 };
    const at = (actorId: string, y: number) => {
      const r = store.getResident(actorId);
      return r ? new THREE.Vector3(r.location.x, y, r.location.z) : new THREE.Vector3(0, y, 0);
    };
    return store.onEvent(({ event }) => {
      switch (event.kind) {
        case 'raid':
          kit.fx.raidAt = kit.env.t;
          kit.fx.emitSparkles(new THREE.Vector3(portal.x, 2.6, portal.z + 0.8), 260, RAID_COLORS, 1.8);
          kit.fx.emitConfetti(new THREE.Vector3(portal.x, 5.5, portal.z + 3), 420);
          kit.fx.emitConfetti(new THREE.Vector3(0, 6.5, 0), 300);
          break;
        case 'join':
          kit.fx.emitSparkles(new THREE.Vector3(portal.x, 1.6, portal.z + 2.2), 90, JOIN_COLORS, 0.9);
          break;
        case 'confetti':
          kit.fx.emitConfetti(at(event.actorId, 6), 380);
          break;
        case 'social':
          if (event.payload?.action === 'celebrate') kit.fx.emitConfetti(at(event.actorId, 5.5), 260);
          break;
        case 'gift':
          kit.fx.emitSparkles(at(event.actorId, 1.6), 50, ['#ffd166', '#ff8fab', '#ffffff'], 0.6);
          break;
        default:
          break;
      }
    });
  }, [kit, store]);
}
