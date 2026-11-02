/**
 * Ready-made studio characters + deterministic randomizer for the creator.
 * Built only from catalog identifiers so every preset is valid everywhere.
 */
import type { AvatarAppearance } from '@hello-world/contracts';
import { appearanceFromSeed, normalizeAppearance, PERSONALITY_TRAITS } from '../avatars/catalog';

export interface CharacterPreset {
  name: string;
  tagline: string;
  appearance: AvatarAppearance;
  personality: string[];
}

const P = (name: string, tagline: string, personality: string[], a: Omit<AvatarAppearance, 'face' | 'body'> & {
  face: AvatarAppearance['face']; body: AvatarAppearance['body'];
}): CharacterPreset => ({ name, tagline, personality, appearance: normalizeAppearance(a) });

export const CHARACTER_PRESETS: CharacterPreset[] = [
  P('Juniper', 'Café regular', ['friendly', 'foodie'], {
    baseModelId: 'townie-petite', skinTone: '#f6cfa9', hairStyle: 'bob', hairColor: '#c2412d',
    outfit: { top: 'sweater', bottom: 'skirt', shoes: 'loafers', color: '#ffd84d' },
    accessories: ['glasses'],
    face: { eyeColor: '#3f7d4f', eyeSize: 0.66, noseSize: 0.38, mouthSize: 0.5 },
    body: { height: 0.28, build: 0.45 },
  }),
  P('Atlas', 'Skate park legend', ['energetic', 'competitive'], {
    baseModelId: 'townie-sporty', skinTone: '#8f5838', hairStyle: 'short', hairColor: '#1c1410',
    outfit: { top: 'hoodie', bottom: 'cargo', shoes: 'hightops', color: '#4aa3df' },
    accessories: ['cap', 'headphones'],
    face: { eyeColor: '#3a2a1e', eyeSize: 0.45, noseSize: 0.55, mouthSize: 0.55 },
    body: { height: 0.68, build: 0.72 },
  }),
  P('Cleo', 'Stage star', ['creative', 'playful'], {
    baseModelId: 'townie-tall', skinTone: '#d69c6f', hairStyle: 'long', hairColor: '#e36aa6',
    outfit: { top: 'dress', bottom: 'leggings', shoes: 'boots', color: '#9b6ee1' },
    accessories: ['earrings', 'flower'],
    face: { eyeColor: '#5a4a9a', eyeSize: 0.72, noseSize: 0.35, mouthSize: 0.48 },
    body: { height: 0.8, build: 0.32 },
  }),
  P('River', 'Bookish dreamer', ['bookish', 'shy'], {
    baseModelId: 'townie-classic', skinTone: '#ffe0c7', hairStyle: 'bun', hairColor: '#d9a441',
    outfit: { top: 'blouse', bottom: 'trousers', shoes: 'loafers', color: '#7bd389' },
    accessories: ['glasses', 'scarf'],
    face: { eyeColor: '#2f6a8f', eyeSize: 0.55, noseSize: 0.45, mouthSize: 0.4 },
    body: { height: 0.5, build: 0.42 },
  }),
  P('Sage', 'Cozy gardener', ['kind', 'lazy'], {
    baseModelId: 'townie-soft', skinTone: '#b97a50', hairStyle: 'curly', hairColor: '#3b2417',
    outfit: { top: 'tee', bottom: 'shorts', shoes: 'sandals', color: '#3fb39b' },
    accessories: ['backpack', 'flower'],
    face: { eyeColor: '#8a5a2b', eyeSize: 0.5, noseSize: 0.6, mouthSize: 0.62 },
    body: { height: 0.38, build: 0.82 },
  }),
  P('Indigo', 'Night-owl DJ', ['night-owl', 'chaotic'], {
    baseModelId: 'townie-tall', skinTone: '#4a2a1a', hairStyle: 'afro', hairColor: '#1c1410',
    outfit: { top: 'varsity', bottom: 'joggers', shoes: 'sneakers', color: '#c2412d' },
    accessories: ['sunglasses', 'headphones'],
    face: { eyeColor: '#3a2a1e', eyeSize: 0.42, noseSize: 0.5, mouthSize: 0.5 },
    body: { height: 0.62, build: 0.58 },
  }),
];

/** Deterministic random character: the same click count always yields the same look. */
export function randomAppearance(clickCount: number): AvatarAppearance {
  return appearanceFromSeed(`hello-world-studio-random-${clickCount}`);
}

const TRAIT_IDS = new Set(PERSONALITY_TRAITS.map(t => t.id));
export const MAX_TRAITS = 3;
export const MAX_ACCESSORIES = 6;

/** Keep only known trait ids, unique, max 3. */
export function sanitizeTraits(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((t): t is string => typeof t === 'string' && TRAIT_IDS.has(t)))].slice(0, MAX_TRAITS);
}

/** Toggle `id` in a capped list; when full, the oldest pick is replaced (never a dead click). */
export function toggleCapped(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter(x => x !== id);
  const next = [...list, id];
  return next.length > max ? next.slice(next.length - max) : next;
}
