/**
 * Realistic human base models via the Valdrada dataset: photoreal CARLA 0.10 / Epic MetaHuman-derived bodies ('mh-*')
 * and Microsoft Rocketbox bodies ('rb-*', MIT).
 * PURE DATA, Node-safe. Owned by the realistic-avatar pass; the coordinator merges this list into BASE_MODELS.
 * Licence notes live in ./assets/NOTICE.md (CC BY 4.0 "CARLA Simulator (carla.org)" + Epic MetaHuman licence:
 * rendering/interactive use only — never for building datasets or training/testing AI).
 */
import type { BaseModelEntry } from '../catalog';

const MH_CREDIT = 'CARLA Simulator (carla.org), CC BY 4.0 · contains Epic MetaHuman components (MetaHuman licence) · via Valdrada';
const RB_CREDIT = 'Microsoft Rocketbox Avatar Library, MIT (c) 2020 Microsoft · via Valdrada';

export const REALISTIC_BASE_MODELS: BaseModelEntry[] = [
  { id: 'mh-elena', label: 'Elena (photoreal)', kind: 'realistic', file: 'SK_EuroW_.glb', credit: MH_CREDIT, description: 'Photoreal woman — denim, cardigan, sneakers' },
  { id: 'mh-marco', label: 'Marco (photoreal)', kind: 'realistic', file: 'SK_euroM_.glb', credit: MH_CREDIT, description: 'Photoreal man — jacket, jeans' },
  { id: 'mh-amara', label: 'Amara (photoreal)', kind: 'realistic', file: 'SK_AfroW_03_GEN23.glb', credit: MH_CREDIT, description: 'Photoreal woman — casual shirt and trousers' },
  { id: 'mh-kenji', label: 'Kenji (photoreal)', kind: 'realistic', file: 'SK_AsiaM_v2.glb', credit: MH_CREDIT, description: 'Photoreal man — layered streetwear' },
  { id: 'rb-sofia', label: 'Sofia (Rocketbox)', kind: 'realistic', file: 'RB_Female_Adult_01.glb', credit: RB_CREDIT, description: 'Realistic woman — casual outfit' },
  { id: 'rb-daniel', label: 'Daniel (Rocketbox)', kind: 'realistic', file: 'RB_Male_Adult_01.glb', credit: RB_CREDIT, description: 'Realistic man — casual outfit' },
  { id: 'rb-claire', label: 'Claire (Rocketbox)', kind: 'realistic', file: 'RB_Business_Female_01.glb', credit: RB_CREDIT, description: 'Realistic woman — business wear' },
  { id: 'rb-james', label: 'James (Rocketbox)', kind: 'realistic', file: 'RB_Business_Male_01.glb', credit: RB_CREDIT, description: 'Realistic man — business suit' },
];

export interface AppearanceSupport {
  /** Which AvatarAppearance fields visibly apply to this base. */
  skinTone: boolean; hair: boolean; outfitColor: boolean; outfitPieces: boolean; face: boolean; body: boolean; accessories: boolean;
}

/** body = height only (uniform scale); outfit.color recolours the top garment (mh-* only, see realisticSupportFor);
 *  skin/hair/face/pieces are baked into the scans. */
export const REALISTIC_SUPPORT: AppearanceSupport = {
  skinTone: false, hair: false, outfitColor: true, outfitPieces: false, face: false, body: true, accessories: false,
};

/** Per-base support: Rocketbox bodies have no garment segmentation, so outfit colour does not apply to them. */
export function realisticSupportFor(baseModelId: string): AppearanceSupport {
  return baseModelId.startsWith('rb-') ? { ...REALISTIC_SUPPORT, outfitColor: false } : REALISTIC_SUPPORT;
}

export function isRealisticBase(baseModelId: string): boolean {
  return baseModelId.startsWith('mh-') || baseModelId.startsWith('rb-');
}
