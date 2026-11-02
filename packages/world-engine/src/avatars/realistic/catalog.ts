/**
 * Realistic human base models (photoreal CARLA/MetaHuman-derived bodies and
 * Microsoft Rocketbox bodies, both via the Valdrada dataset). PURE DATA, Node-safe.
 * Owned by the realistic-avatar pass; the coordinator merges this list into BASE_MODELS.
 * Licence notes live in ./assets/NOTICE.md.
 */
import type { BaseModelEntry } from '../catalog';

export const REALISTIC_BASE_MODELS: BaseModelEntry[] = [];

export interface AppearanceSupport {
  /** Which AvatarAppearance fields visibly apply to this base. */
  skinTone: boolean; hair: boolean; outfitColor: boolean; outfitPieces: boolean; face: boolean; body: boolean; accessories: boolean;
}

export const REALISTIC_SUPPORT: AppearanceSupport = {
  skinTone: false, hair: false, outfitColor: true, outfitPieces: false, face: false, body: true, accessories: true,
};

export function isRealisticBase(baseModelId: string): boolean {
  return baseModelId.startsWith('mh-') || baseModelId.startsWith('rb-');
}
