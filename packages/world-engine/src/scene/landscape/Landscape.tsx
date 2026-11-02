/**
 * <Landscape quality transparent? /> — terrain ring + valley lake around the flat
 * neighborhood (see ./terrain.ts) + instanced boulders. 3 draw calls, built once,
 * no per-frame work.
 * Renders nothing in transparent (OBS overlay) mode.
 */
import { useContext, useEffect, useMemo } from 'react';
import { KitContext } from '../context';
import { buildLandscape } from './buildLandscape';
import { LAKE } from './terrain';

export interface LandscapeProps {
  quality: 'low' | 'high';
  transparent?: boolean;
}

const noRaycast = () => null;

export function Landscape({ quality, transparent = false }: LandscapeProps) {
  // Optional: inside <WorldScene> the kit provides the shared snow/wet uniforms.
  const kit = useContext(KitContext);
  const built = useMemo(() => (transparent ? null : buildLandscape(quality, kit?.uniforms ?? null)), [quality, transparent, kit]);
  useEffect(() => () => built?.dispose(), [built]);
  if (!built) return null;
  return (
    <group name="landscape">
      <mesh geometry={built.terrain} material={built.terrainMat} receiveShadow raycast={noRaycast} />
      <mesh geometry={built.lake} material={built.lakeMat} position-y={LAKE.level} receiveShadow raycast={noRaycast} />
      <primitive object={built.rocks} raycast={noRaycast} />
    </group>
  );
}
