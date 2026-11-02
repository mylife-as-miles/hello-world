/**
 * DowntownDistrict — stylized downtown skyline ring around the neighborhood.
 * 2 draw calls (merged facade + merged plain/emissive geometry), no shadows.
 * Windows, shop fronts, neon blades, beacons and street lamps light up at night:
 * driven by worldClock(store.current.simulationTime).daylight (+ weather) through
 * shared material values — no React state, no per-frame allocations.
 */
import { useContext, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { SceneStoreContext } from '../../core/SceneContext';
import { worldClock } from '../../world/time';
import { buildDistrict } from './build';

export interface DowntownDistrictProps {
  quality: 'low' | 'high';
  transparent?: boolean;
  /** Terrain height sampler (e.g. landscape `terrainHeightAt`). Pass a STABLE function — a new identity rebuilds the district. Default: flat y = 0. */
  heightAt?: (x: number, z: number) => number;
}

const FLAT = () => 0;

export function DowntownDistrict({ quality, transparent, heightAt = FLAT }: DowntownDistrictProps) {
  const store = useContext(SceneStoreContext);
  const built = useMemo(() => (transparent ? null : buildDistrict(quality, heightAt)), [quality, transparent, heightAt]);
  useEffect(() => () => built?.dispose(), [built]);
  const st = useRef({ simTime: -1, target: 0, lit: -1 });

  useFrame((_, dt) => {
    if (!built) return;
    const s = st.current;
    const snap = store?.current;
    const t = snap ? snap.simulationTime : 240;
    if (t !== s.simTime) {
      s.simTime = t;
      const daylight = worldClock(t).daylight; // only when a new snapshot arrives (~2 Hz)
      let target = Math.min(1, Math.max(0, (1 - daylight) * 1.35 - 0.05));
      const w = snap?.weather;
      if (w === 'rain' || w === 'snow') target = Math.max(target, 0.35);
      else if (w === 'sunset') target = Math.max(target, 0.22);
      s.target = target;
    }
    s.lit = s.lit < 0 ? s.target : s.lit + (s.target - s.lit) * Math.min(1, dt * 1.5);
    built.facadeMat.emissiveIntensity = s.lit * 1.55;
    built.night.value = s.lit;
  });

  if (!built) return null;
  return (
    <group name="downtown-district">
      <mesh geometry={built.facade} material={built.facadeMat} />
      <mesh geometry={built.plain} material={built.plainMat} />
    </group>
  );
}
