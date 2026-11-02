/**
 * STUB (coordinator) — the realistic-avatar engineer implements this.
 * Contract: loadRealisticRig never rejects; on any failure it resolves to null
 * and the caller falls back to the procedural Townie rig.
 */
import type { AvatarAppearance } from '@hello-world/contracts';
import type { AvatarLod, HumanoidRig } from '../rig';
export { REALISTIC_BASE_MODELS, REALISTIC_SUPPORT, isRealisticBase } from './catalog';
export type { AppearanceSupport } from './catalog';

export async function loadRealisticRig(_appearance: AvatarAppearance, _opts: { lod?: AvatarLod } = {}): Promise<HumanoidRig | null> {
  return null;
}
