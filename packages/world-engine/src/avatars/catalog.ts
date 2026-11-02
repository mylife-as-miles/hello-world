/**
 * Avatar catalog: renderer-owned identifiers for `AvatarAppearance` string
 * fields (baseModelId, hairStyle, outfit.top/bottom/shoes, accessories).
 * PURE DATA — Node-safe (the runtime uses it to generate appearances).
 * Renderers MUST treat unknown identifiers as the default entry.
 */
import type { AvatarAppearance } from '@hello-world/contracts';

export interface CatalogEntry { id: string; label: string }
export interface BaseModelEntry extends CatalogEntry {
  kind: 'procedural' | 'vrm';
  /** For VRM entries: asset file name inside src/avatars/assets (resolved by the loader). */
  file?: string;
  /** Short credit/licence line shown in the creator for third-party assets. */
  credit?: string;
  description: string;
}

/** Procedural "Townie" bodies — fully parametric, always available, no network. */
export const BASE_MODELS: BaseModelEntry[] = [
  { id: 'townie-classic', label: 'Classic', kind: 'procedural', description: 'Balanced proportions' },
  { id: 'townie-sporty', label: 'Sporty', kind: 'procedural', description: 'Broad shoulders, long legs' },
  { id: 'townie-soft', label: 'Cozy', kind: 'procedural', description: 'Rounder, softer silhouette' },
  { id: 'townie-tall', label: 'Lanky', kind: 'procedural', description: 'Tall and slender' },
  { id: 'townie-petite', label: 'Petite', kind: 'procedural', description: 'Compact and cute' },
  // VRM "guest skins": CC0 avatars by Polygonal Mind (100Avatars R1). See src/avatars/assets/CREDITS.md.
  { id: 'vrm-polybot', label: 'Polybot (100Avatars, CC0)', kind: 'vrm', file: 'polybot.vrm', credit: 'Polybot by Polygonal Mind (100Avatars), CC0', description: 'Friendly low-poly robot guest' },
  { id: 'vrm-astrodisco', label: 'Astrodisco (100Avatars, CC0)', kind: 'vrm', file: 'astrodisco.vrm', credit: 'Astrodisco by Polygonal Mind (100Avatars), CC0', description: 'Disco-ball astronaut guest' },
  { id: 'vrm-coffee', label: 'Coffee (100Avatars, CC0)', kind: 'vrm', file: 'coffee.vrm', credit: 'Coffee by Polygonal Mind (100Avatars), CC0', description: 'Walking coffee cup guest' },
  { id: 'vrm-chill', label: 'Chill (100Avatars, CC0)', kind: 'vrm', file: 'chill.vrm', credit: 'Chill by Polygonal Mind (100Avatars), CC0', description: 'Laid-back hoodie guest' },
];

export const HAIR_STYLES: CatalogEntry[] = [
  { id: 'short', label: 'Short' }, { id: 'buzz', label: 'Buzz' }, { id: 'bob', label: 'Bob' },
  { id: 'long', label: 'Long' }, { id: 'ponytail', label: 'Ponytail' }, { id: 'bun', label: 'Top bun' },
  { id: 'curly', label: 'Curly' }, { id: 'afro', label: 'Afro' }, { id: 'spiky', label: 'Spiky' },
  { id: 'mohawk', label: 'Mohawk' }, { id: 'braids', label: 'Braids' }, { id: 'bald', label: 'Bald' },
];

export const TOPS: CatalogEntry[] = [
  { id: 'tee', label: 'T-shirt' }, { id: 'hoodie', label: 'Hoodie' }, { id: 'sweater', label: 'Sweater' },
  { id: 'jacket', label: 'Jacket' }, { id: 'tank', label: 'Tank top' }, { id: 'dress', label: 'Dress' },
  { id: 'blouse', label: 'Blouse' }, { id: 'varsity', label: 'Varsity jacket' },
];

/** Bottoms carry their own fabric colour; `outfit.color` tints the top. */
export const BOTTOMS: Array<CatalogEntry & { color: string }> = [
  { id: 'jeans', label: 'Jeans', color: '#3d5a8a' }, { id: 'shorts', label: 'Shorts', color: '#c8b089' },
  { id: 'skirt', label: 'Skirt', color: '#2f2f3a' }, { id: 'trousers', label: 'Trousers', color: '#3b3f46' },
  { id: 'joggers', label: 'Joggers', color: '#8b8f98' }, { id: 'leggings', label: 'Leggings', color: '#1f1f26' },
  { id: 'cargo', label: 'Cargo pants', color: '#5f6b45' },
];

export const SHOES: Array<CatalogEntry & { color: string }> = [
  { id: 'sneakers', label: 'Sneakers', color: '#f4f4f4' }, { id: 'boots', label: 'Boots', color: '#5a3b24' },
  { id: 'sandals', label: 'Sandals', color: '#b07a4f' }, { id: 'loafers', label: 'Loafers', color: '#2b1d14' },
  { id: 'hightops', label: 'High-tops', color: '#d6453d' },
];

export const ACCESSORIES: CatalogEntry[] = [
  { id: 'glasses', label: 'Glasses' }, { id: 'sunglasses', label: 'Sunglasses' }, { id: 'beanie', label: 'Beanie' },
  { id: 'cap', label: 'Cap' }, { id: 'headphones', label: 'Headphones' }, { id: 'scarf', label: 'Scarf' },
  { id: 'earrings', label: 'Earrings' }, { id: 'backpack', label: 'Backpack' }, { id: 'flower', label: 'Hair flower' },
  { id: 'bowtie', label: 'Bow tie' }, { id: 'crown', label: 'Party crown' },
];

export const SKIN_TONES = ['#ffe0c7', '#f6cfa9', '#eab88f', '#d69c6f', '#b97a50', '#8f5838', '#6b3f27', '#4a2a1a'];
export const HAIR_COLORS = ['#1c1410', '#3b2417', '#6b4226', '#a8692e', '#d9a441', '#e8d2a0', '#b8bcc4', '#c2412d', '#e36aa6', '#5b6ee1', '#3fb39b', '#f2f2f2'];
export const EYE_COLORS = ['#3a2a1e', '#5a3d22', '#2f6a8f', '#3f7d4f', '#7a7f87', '#8a5a2b', '#5a4a9a'];
export const OUTFIT_COLORS = ['#ff7a59', '#ffb347', '#ffd84d', '#7bd389', '#3fb39b', '#4aa3df', '#5b6ee1', '#9b6ee1', '#e36aa6', '#f2f2f2', '#2f2f3a', '#c2412d'];

export const PERSONALITY_TRAITS: Array<CatalogEntry & { description: string }> = [
  { id: 'friendly', label: 'Friendly', description: 'Greets everyone, makes friends fast' },
  { id: 'shy', label: 'Shy', description: 'Prefers small groups, warms up slowly' },
  { id: 'playful', label: 'Playful', description: 'Loves games, dancing and jokes' },
  { id: 'grumpy', label: 'Grumpy', description: 'Hard to impress, secretly loyal' },
  { id: 'curious', label: 'Curious', description: 'Explores every corner of town' },
  { id: 'energetic', label: 'Energetic', description: 'Always on the move' },
  { id: 'lazy', label: 'Lazy', description: 'Never misses a chance to sit down' },
  { id: 'romantic', label: 'Romantic', description: 'Generous with compliments and gifts' },
  { id: 'creative', label: 'Creative', description: 'Performs on stage, admires art' },
  { id: 'chaotic', label: 'Chaotic', description: 'Unpredictable and dramatic' },
  { id: 'kind', label: 'Kind', description: 'Cheers others up, gives gifts' },
  { id: 'competitive', label: 'Competitive', description: 'Wants to win at the arcade' },
  { id: 'bookish', label: 'Bookish', description: 'Reads quietly in the park' },
  { id: 'foodie', label: 'Foodie', description: 'Lives at the café' },
  { id: 'night-owl', label: 'Night owl', description: 'Comes alive after dark' },
];

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  baseModelId: 'townie-classic',
  skinTone: '#eab88f',
  hairStyle: 'short',
  hairColor: '#3b2417',
  outfit: { top: 'tee', bottom: 'jeans', shoes: 'sneakers', color: '#ff7a59' },
  accessories: [],
  face: { eyeColor: '#3a2a1e', eyeSize: 0.5, noseSize: 0.5, mouthSize: 0.5 },
  body: { height: 0.5, build: 0.5 },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}
function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback;
}
function id(v: unknown, list: CatalogEntry[], fallback: string): string {
  return typeof v === 'string' && list.some(e => e.id === v) ? v : fallback;
}

/**
 * Coerce any (possibly partial/malformed) appearance into a valid one.
 * Unknown identifiers fall back to defaults; numbers are clamped to 0–1.
 * `allowUnknownBase` keeps unrecognised baseModelIds (e.g. VRM ids registered at runtime).
 */
export function normalizeAppearance(input: unknown, allowUnknownBase = true): AvatarAppearance {
  const a = (input && typeof input === 'object' ? input : {}) as Partial<AvatarAppearance> & Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  const outfit = (a.outfit && typeof a.outfit === 'object' ? a.outfit : {}) as Partial<AvatarAppearance['outfit']>;
  const face = (a.face && typeof a.face === 'object' ? a.face : {}) as Partial<AvatarAppearance['face']>;
  const body = (a.body && typeof a.body === 'object' ? a.body : {}) as Partial<AvatarAppearance['body']>;
  const base = typeof a.baseModelId === 'string' && a.baseModelId.length > 0 && a.baseModelId.length <= 64
    && (allowUnknownBase || BASE_MODELS.some(m => m.id === a.baseModelId)) ? a.baseModelId : d.baseModelId;
  const accessories = Array.isArray(a.accessories)
    ? [...new Set(a.accessories.filter((x): x is string => typeof x === 'string' && x.length <= 32))].slice(0, 6)
    : [];
  return {
    baseModelId: base,
    skinTone: hex(a.skinTone, d.skinTone),
    hairStyle: id(a.hairStyle, HAIR_STYLES, d.hairStyle),
    hairColor: hex(a.hairColor, d.hairColor),
    outfit: {
      top: id(outfit.top, TOPS, d.outfit.top),
      bottom: id(outfit.bottom, BOTTOMS, d.outfit.bottom),
      shoes: id(outfit.shoes, SHOES, d.outfit.shoes),
      color: hex(outfit.color, d.outfit.color),
    },
    accessories,
    face: {
      eyeColor: hex(face.eyeColor, d.face.eyeColor),
      eyeSize: clamp01(face.eyeSize, d.face.eyeSize),
      noseSize: clamp01(face.noseSize, d.face.noseSize),
      mouthSize: clamp01(face.mouthSize, d.face.mouthSize),
    },
    body: { height: clamp01(body.height, d.body.height), build: clamp01(body.build, d.body.build) },
  };
}

/** Small deterministic string hash (FNV-1a, 32-bit). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Deterministic pseudo-random appearance for a resident id (used for joins without an appearance). */
export function appearanceFromSeed(seed: string): AvatarAppearance {
  let s = hashString(seed) || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length) % arr.length]!;
  const procedural = BASE_MODELS.filter(m => m.kind === 'procedural');
  const accessories: string[] = [];
  if (rnd() < 0.55) accessories.push(pick(ACCESSORIES).id);
  if (rnd() < 0.2) { const extra = pick(ACCESSORIES).id; if (!accessories.includes(extra)) accessories.push(extra); }
  return normalizeAppearance({
    baseModelId: pick(procedural).id,
    skinTone: pick(SKIN_TONES),
    hairStyle: pick(HAIR_STYLES).id,
    hairColor: pick(HAIR_COLORS),
    outfit: { top: pick(TOPS).id, bottom: pick(BOTTOMS).id, shoes: pick(SHOES).id, color: pick(OUTFIT_COLORS) },
    accessories,
    face: { eyeColor: pick(EYE_COLORS), eyeSize: 0.3 + rnd() * 0.5, noseSize: 0.25 + rnd() * 0.5, mouthSize: 0.3 + rnd() * 0.45 },
    body: { height: 0.2 + rnd() * 0.6, build: 0.2 + rnd() * 0.6 },
  });
}
