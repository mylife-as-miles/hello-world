/**
 * Realistic human base models (photoreal CARLA 0.10 / Epic MetaHuman-derived bodies via the Valdrada dataset).
 * PURE DATA, Node-safe. Owned by the realistic-avatar pass; the coordinator merges this list into BASE_MODELS.
 * Licence notes live in ./assets/NOTICE.md (CC BY 4.0 "CARLA Simulator (carla.org)" + Epic MetaHuman licence:
 * rendering/interactive use only — never for building datasets or training/testing AI).
 */
import type { BaseModelEntry } from '../catalog';

const MH_CREDIT = 'CARLA Simulator (carla.org), CC BY 4.0 · contains Epic MetaHuman components (MetaHuman licence) · via Valdrada';

export const REALISTIC_BASE_MODELS: BaseModelEntry[] = [
  { id: 'mh-elena', label: 'Elena (photoreal)', kind: 'realistic', file: 'SK_EuroW_.glb', credit: MH_CREDIT, description: 'Photoreal woman — denim, cardigan, sneakers' },
  { id: 'mh-marco', label: 'Marco (photoreal)', kind: 'realistic', file: 'SK_euroM_.glb', credit: MH_CREDIT, description: 'Photoreal man — jacket, jeans' },
  { id: 'mh-amara', label: 'Amara (photoreal)', kind: 'realistic', file: 'SK_AfroW_03_GEN23.glb', credit: MH_CREDIT, description: 'Photoreal woman — casual shirt and trousers' },
  { id: 'mh-kenji', label: 'Kenji (photoreal)', kind: 'realistic', file: 'SK_AsiaM_v2.glb', credit: MH_CREDIT, description: 'Photoreal man — layered streetwear' },
];

export interface AppearanceSupport {
  /** Which AvatarAppearance fields visibly apply to this base. */
  skinTone: boolean; hair: boolean; outfitColor: boolean; outfitPieces: boolean; face: boolean; body: boolean; accessories: boolean;
}

/** body = height only (uniform scale); outfit.color recolours the top garment; skin/hair/face/pieces are baked in the scan. */
export const REALISTIC_SUPPORT: AppearanceSupport = {
  skinTone: false, hair: false, outfitColor: true, outfitPieces: false, face: false, body: true, accessories: false,
};

export function isRealisticBase(baseModelId: string): boolean {
  return baseModelId.startsWith('mh-') || baseModelId.startsWith('rb-');
}
