/**
 * WorldScene — the one 3D implementation of the HELLO WORLD neighborhood.
 * Implements the contract `WorldSceneProps` exactly, plus optional extension
 * props (`WorldSceneExtraProps`). One SceneStore per runtime bridges snapshots
 * to the render loop; React only re-renders on structure changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldSceneProps } from '@hello-world/contracts';
import { SceneStore } from '../core/sceneStore';
import { SceneStoreContext } from '../core/SceneContext';
import { ResidentsLayer } from '../interactions/ResidentsLayer';
import { ResidentInspector } from '../interactions/ResidentInspector';
import { getPoi } from '../world/layout';
import { createKit, type SceneKit } from './kit';
import { KitContext } from './context';
import { Town } from './Town';
import { Atmosphere } from './Atmosphere';
import { SkyDome, Clouds, createSkyUniforms } from './Sky';
import { Fountain } from './Fountain';
import { StageLights } from './StageLights';
import { Portal } from './Portal';
import { Bursts } from './Bursts';
import { WeatherFx } from './Weather';
import { CameraRig, poseFor } from './CameraRig';
import { PostFX } from './PostFX';
import { Hud } from './Hud';

export type WorldSceneExtraProps = {
  /** Resident id of the local viewer (highlights "you", enables the inspector). */
  viewerResidentId?: string;
  /** Called with the POI id when the ground / a building is clicked. */
  onLocationSelect?: (poiId: string) => void;
  /** Glassy clock/weather pill (DOM). Default false — host apps bring their own chrome. */
  showHud?: boolean;
  /** Resident inspector card (DOM). Default false; true when viewerResidentId is provided. */
  showInspector?: boolean;
};

export function WorldScene(props: WorldSceneProps & WorldSceneExtraProps) {
  const {
    runtime, transparent = false, cameraMode = 'neighborhood', selectedResidentId, onResidentSelect,
    quality = 'high', className, viewerResidentId, onLocationSelect,
  } = props;
  const showHud = props.showHud ?? false;
  const showInspector = props.showInspector ?? viewerResidentId !== undefined;

  const store = useMemo(() => new SceneStore(runtime), [runtime]);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  const kit = useMemo(() => createKit(), []);
  useEffect(() => () => kit.dispose(), [kit]);

  // Local selection fallback when the host does not control selection.
  const [localSel, setLocalSel] = useState<string | undefined>(undefined);
  const selected = onResidentSelect ? selectedResidentId : (selectedResidentId ?? localSel);
  const select = (id: string) => { if (onResidentSelect) onResidentSelect(id); else setLocalSel(id || undefined); };
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  useEffect(() => { setDismissed(undefined); }, [selected]);

  const initial = useMemo(() => {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    poseFor(transparent ? 'overlay' : cameraMode, 0, pos, look);
    return pos;
    // only the very first pose matters; the rig takes over afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <Canvas
        key={transparent ? 'overlay' : 'world'}
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={quality === 'high' ? [1, 1.75] : [1, 1]}
        gl={{ alpha: transparent, antialias: true, preserveDrawingBuffer: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        frameloop="always"
        camera={{ fov: 42, near: 0.1, far: 1200, position: [initial.x, initial.y, initial.z] }}
        style={{ position: 'absolute', inset: 0, background: 'transparent' }}
        onCreated={({ gl, scene }) => {
          if (transparent) { gl.setClearColor(0x000000, 0); scene.background = null; }
          else gl.setClearColor('#cfe6f3', 1);
        }}
      >
        <SceneStoreContext.Provider value={store}>
          <KitContext.Provider value={kit}>
            <WorldContent
              kit={kit} store={store} transparent={transparent} quality={quality}
              cameraMode={transparent ? 'overlay' : cameraMode} selectedResidentId={selected}
              onResidentSelect={select} viewerResidentId={viewerResidentId} onLocationSelect={onLocationSelect}
            />
          </KitContext.Provider>
        </SceneStoreContext.Provider>
      </Canvas>
      {showInspector && (
        <ResidentInspector
          store={store} runtime={runtime}
          selectedResidentId={dismissed === selected ? undefined : selected}
          viewerResidentId={viewerResidentId}
          onClose={() => { setDismissed(selected); if (onResidentSelect) onResidentSelect(''); else setLocalSel(undefined); }}
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
  cameraMode: WorldSceneProps['cameraMode'] | 'overlay';
  selectedResidentId?: string;
  onResidentSelect: (id: string) => void;
  viewerResidentId?: string;
  onLocationSelect?: (poiId: string) => void;
}

function WorldContent({ kit, store, transparent, quality, cameraMode, selectedResidentId, onResidentSelect, viewerResidentId, onLocationSelect }: ContentProps) {
  const sky = useMemo(() => createSkyUniforms(), []);
  const cloudTint = useMemo(() => new THREE.Color('#ffffff'), []);
  useEventReactions(kit, store);
  return (
    <>
      <Atmosphere transparent={transparent} quality={quality} sky={sky} cloudTint={cloudTint} />
      {!transparent && <SkyDome uniforms={sky} />}
      {!transparent && <Clouds tint={cloudTint} />}
      {!transparent && <Town quality={quality} onLocationSelect={onLocationSelect} />}
      {!transparent && <Fountain />}
      {!transparent && <StageLights />}
      {!transparent && <WeatherFx quality={quality} />}
      {transparent && <ShadowCatcher />}
      <Portal quality={quality} />
      <Bursts quality={quality} />
      <ResidentsLayer selectedResidentId={selectedResidentId} onResidentSelect={onResidentSelect} quality={quality} viewerResidentId={viewerResidentId} />
      <CameraRig mode={cameraMode ?? 'neighborhood'} selectedResidentId={selectedResidentId} />
      {quality === 'high' && !transparent && <PostFX />}
    </>
  );
}

/** Overlay mode: only soft contact shadows under residents (transparent elsewhere). */
function ShadowCatcher() {
  const geo = useMemo(() => { const g = new THREE.CircleGeometry(14, 48); g.rotateX(-Math.PI / 2); return g; }, []);
  const mat = useMemo(() => new THREE.ShadowMaterial({ opacity: 0.22 }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} receiveShadow position={[0, 0.01, 0]} />;
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
