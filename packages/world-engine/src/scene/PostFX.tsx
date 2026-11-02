/** Tasteful high-quality post: bloom on emissives only (high threshold), ACES tone mapping, subtle vignette. */
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

export function PostFX() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.12} intensity={0.8} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}
