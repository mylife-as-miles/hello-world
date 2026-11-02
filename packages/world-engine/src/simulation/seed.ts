/**
 * Demonstration residents: 13 hand-designed neighbours spread around the
 * plaza / café / park / stage / arcade / playground, mid-activity, with 9
 * pre-existing relationships (incl. an arcade rivalry) and "Yesterday" backstory
 * memories so the town feels lived-in from the first frame.
 */
import type { AvatarAppearance } from '@hello-world/contracts';
import { normalizeAppearance } from '../avatars/catalog';
import { ACTION_DEFS, startAction } from './actions';
import { createAgent } from './events';
import { atPlace, poi, SEAT_BY_KEY } from './places';
import { pairKey } from './relationships';
import type { ActionType, Needs, World } from './state';

interface SeedDef {
  name: string;
  personality: string[];
  appearance: AvatarAppearance;
  at: { x: number; z: number } | { seat: string };
  type: ActionType;
  poiId: string;
  activity: string;
  remaining: number;
  needs: Needs;
}

const look = (a: AvatarAppearance) => normalizeAppearance(a);

export const SEEDS: SeedDef[] = [
  { name: 'Nova', personality: ['friendly', 'curious', 'creative'], type: 'admire', poiId: 'fountain', remaining: 7,
    at: { x: 2.4, z: 2.0 }, activity: 'admiring the Wishing Fountain', needs: { energy: 78, social: 52, fun: 64 },
    appearance: look({ baseModelId: 'townie-classic', skinTone: '#eab88f', hairStyle: 'ponytail', hairColor: '#5b6ee1', outfit: { top: 'varsity', bottom: 'jeans', shoes: 'sneakers', color: '#ff7a59' }, accessories: ['earrings', 'backpack'], face: { eyeColor: '#2f6a8f', eyeSize: 0.62, noseSize: 0.42, mouthSize: 0.55 }, body: { height: 0.55, build: 0.45 } }) },
  { name: 'PixelCat', personality: ['playful', 'competitive', 'night-owl'], type: 'wander', poiId: 'plaza', remaining: 9,
    at: { x: -2.0, z: 3.6 }, activity: 'wandering around Town Plaza', needs: { energy: 66, social: 58, fun: 45 },
    appearance: look({ baseModelId: 'townie-petite', skinTone: '#ffe0c7', hairStyle: 'bob', hairColor: '#e36aa6', outfit: { top: 'hoodie', bottom: 'shorts', shoes: 'hightops', color: '#9b6ee1' }, accessories: ['headphones'], face: { eyeColor: '#5a4a9a', eyeSize: 0.75, noseSize: 0.35, mouthSize: 0.5 }, body: { height: 0.35, build: 0.4 } }) },
  { name: 'Mochi', personality: ['foodie', 'kind', 'lazy'], type: 'drink', poiId: 'cafe', remaining: 18,
    at: { seat: 'cafe#0' }, activity: 'drinking cocoa at Sunbeam Café', needs: { energy: 48, social: 70, fun: 60 },
    appearance: look({ baseModelId: 'townie-soft', skinTone: '#f6cfa9', hairStyle: 'bun', hairColor: '#1c1410', outfit: { top: 'sweater', bottom: 'skirt', shoes: 'loafers', color: '#ffd84d' }, accessories: ['bowtie'], face: { eyeColor: '#3a2a1e', eyeSize: 0.55, noseSize: 0.5, mouthSize: 0.6 }, body: { height: 0.4, build: 0.7 } }) },
  { name: 'Rex', personality: ['grumpy', 'competitive', 'energetic'], type: 'sit', poiId: 'bench-plaza-w', remaining: 24,
    at: { seat: 'bench-plaza-w#0' }, activity: 'sitting on the Plaza Bench', needs: { energy: 72, social: 35, fun: 50 },
    appearance: look({ baseModelId: 'townie-sporty', skinTone: '#8f5838', hairStyle: 'buzz', hairColor: '#1c1410', outfit: { top: 'jacket', bottom: 'cargo', shoes: 'boots', color: '#2f2f3a' }, accessories: ['sunglasses'], face: { eyeColor: '#5a3d22', eyeSize: 0.4, noseSize: 0.6, mouthSize: 0.4 }, body: { height: 0.7, build: 0.75 } }) },
  { name: 'Lumi', personality: ['creative', 'romantic', 'shy'], type: 'watch', poiId: 'stage', remaining: 12,
    at: { x: 5.2, z: 5.0 }, activity: 'watching Kiki dance', needs: { energy: 70, social: 44, fun: 72 },
    appearance: look({ baseModelId: 'townie-tall', skinTone: '#d69c6f', hairStyle: 'long', hairColor: '#3fb39b', outfit: { top: 'dress', bottom: 'leggings', shoes: 'sandals', color: '#e36aa6' }, accessories: ['flower'], face: { eyeColor: '#3f7d4f', eyeSize: 0.65, noseSize: 0.4, mouthSize: 0.5 }, body: { height: 0.75, build: 0.35 } }) },
  { name: 'Bram', personality: ['bookish', 'kind', 'curious'], type: 'read', poiId: 'bench-park', remaining: 30,
    at: { seat: 'bench-park#0' }, activity: 'reading a mystery novel on the Pond Bench', needs: { energy: 58, social: 66, fun: 40 },
    appearance: look({ baseModelId: 'townie-classic', skinTone: '#b97a50', hairStyle: 'curly', hairColor: '#6b4226', outfit: { top: 'tee', bottom: 'trousers', shoes: 'loafers', color: '#4aa3df' }, accessories: ['glasses', 'scarf'], face: { eyeColor: '#7a7f87', eyeSize: 0.5, noseSize: 0.55, mouthSize: 0.45 }, body: { height: 0.6, build: 0.55 } }) },
  { name: 'Kiki', personality: ['energetic', 'chaotic', 'playful'], type: 'dance', poiId: 'stage', remaining: 16,
    at: { x: 7.6, z: 7.2 }, activity: 'dancing on the Dance Stage', needs: { energy: 82, social: 62, fun: 38 },
    // Exactly one seed uses a licensed rigged VRM (renderer falls back to procedural when unavailable).
    appearance: look({ baseModelId: 'vrm-astrodisco', skinTone: '#6b3f27', hairStyle: 'afro', hairColor: '#d9a441', outfit: { top: 'tank', bottom: 'joggers', shoes: 'hightops', color: '#7bd389' }, accessories: ['crown'], face: { eyeColor: '#8a5a2b', eyeSize: 0.7, noseSize: 0.4, mouthSize: 0.65 }, body: { height: 0.3, build: 0.45 } }) },
  { name: 'Elena', personality: ['romantic', 'creative', 'kind'], type: 'drink', poiId: 'cafe', remaining: 20,
    at: { seat: 'cafe#1' }, activity: 'drinking a latte at Sunbeam Café', needs: { energy: 62, social: 58, fun: 55 },
    // Photoreal body (CARLA/MetaHuman, registered by the realistic-avatar pass); procedural fields are the fallback look.
    appearance: look({ baseModelId: 'mh-elena', skinTone: '#f6cfa9', hairStyle: 'long', hairColor: '#a8692e', outfit: { top: 'blouse', bottom: 'jeans', shoes: 'sneakers', color: '#ffb347' }, accessories: ['earrings'], face: { eyeColor: '#3f7d4f', eyeSize: 0.55, noseSize: 0.45, mouthSize: 0.5 }, body: { height: 0.55, build: 0.45 } }) },
  { name: 'Marco', personality: ['foodie', 'friendly', 'energetic'], type: 'eat', poiId: 'cafe', remaining: 16,
    at: { seat: 'cafe#2' }, activity: 'eating a croissant at Sunbeam Café', needs: { energy: 55, social: 68, fun: 50 },
    appearance: look({ baseModelId: 'mh-marco', skinTone: '#d69c6f', hairStyle: 'short', hairColor: '#3b2417', outfit: { top: 'jacket', bottom: 'jeans', shoes: 'boots', color: '#4aa3df' }, accessories: [], face: { eyeColor: '#5a3d22', eyeSize: 0.5, noseSize: 0.55, mouthSize: 0.5 }, body: { height: 0.65, build: 0.6 } }) },
  { name: 'Juno', personality: ['shy', 'night-owl', 'bookish'], type: 'read', poiId: 'park', remaining: 26,
    at: { x: -17.2, z: -13.4 }, activity: 'reading poetry in Willow Park', needs: { energy: 64, social: 38, fun: 58 },
    appearance: look({ baseModelId: 'townie-tall', skinTone: '#4a2a1a', hairStyle: 'braids', hairColor: '#1c1410', outfit: { top: 'sweater', bottom: 'leggings', shoes: 'boots', color: '#5b6ee1' }, accessories: ['beanie'], face: { eyeColor: '#5a3d22', eyeSize: 0.6, noseSize: 0.4, mouthSize: 0.45 }, body: { height: 0.7, build: 0.35 } }) },
  { name: 'Ziggy', personality: ['chaotic', 'competitive', 'playful'], type: 'play', poiId: 'arcade', remaining: 18,
    at: { x: 16.9, z: -15.6 }, activity: 'playing Star Blaster at Pixel Arcade', needs: { energy: 74, social: 50, fun: 42 },
    appearance: look({ baseModelId: 'townie-sporty', skinTone: '#eab88f', hairStyle: 'spiky', hairColor: '#f2f2f2', outfit: { top: 'jacket', bottom: 'cargo', shoes: 'hightops', color: '#c2412d' }, accessories: ['cap'], face: { eyeColor: '#2f6a8f', eyeSize: 0.55, noseSize: 0.5, mouthSize: 0.6 }, body: { height: 0.5, build: 0.6 } }) },
  { name: 'Olive', personality: ['kind', 'lazy', 'friendly'], type: 'sit', poiId: 'bench-plaza-e', remaining: 22,
    at: { seat: 'bench-plaza-e#0' }, activity: 'sitting on the Stage Bench', needs: { energy: 45, social: 60, fun: 52 },
    appearance: look({ baseModelId: 'townie-soft', skinTone: '#b97a50', hairStyle: 'bob', hairColor: '#b8bcc4', outfit: { top: 'dress', bottom: 'skirt', shoes: 'sandals', color: '#3fb39b' }, accessories: ['scarf'], face: { eyeColor: '#7a7f87', eyeSize: 0.5, noseSize: 0.5, mouthSize: 0.55 }, body: { height: 0.35, build: 0.7 } }) },
  { name: 'Toby', personality: ['energetic', 'friendly', 'competitive'], type: 'play', poiId: 'playground', remaining: 14,
    at: { x: -19.4, z: -8.0 }, activity: 'playing on the swings at the Playground', needs: { energy: 80, social: 55, fun: 47 },
    appearance: look({ baseModelId: 'townie-classic', skinTone: '#ffe0c7', hairStyle: 'short', hairColor: '#d9a441', outfit: { top: 'tee', bottom: 'shorts', shoes: 'sneakers', color: '#f2f2f2' }, accessories: [], face: { eyeColor: '#2f6a8f', eyeSize: 0.6, noseSize: 0.45, mouthSize: 0.6 }, body: { height: 0.45, build: 0.5 } }) },
];

const SEED_RELATIONSHIPS: Array<{ a: string; b: string; friendship: number; minutesAgo: number; memories: string[] }> = [
  { a: 'seed:nova', b: 'seed:pixelcat', friendship: 72, minutesAgo: 25, memories: [
    'Yesterday · 19:40 · PixelCat taught Nova the secret combo at Pixel Arcade — Nova still can’t pull it off.',
    'Yesterday · 21:15 · Nova and PixelCat watched the stars by the Wishing Fountain — PixelCat called it max graphics.',
  ] },
  { a: 'seed:bram', b: 'seed:mochi', friendship: 64, minutesAgo: 50, memories: [
    'Yesterday · 17:05 · Mochi saved Bram the last cinnamon bun at Sunbeam Café — Bram promised to lend Mochi a mystery novel.',
  ] },
  { a: 'seed:kiki', b: 'seed:rex', friendship: 36, minutesAgo: 35, memories: [
    'Yesterday · 18:50 · Kiki beat Rex\'s high score at Pixel Arcade — Rex demanded a rematch.',
    'Yesterday · 20:40 · Kiki covered Rex in confetti at Town Plaza — Rex pretended to hate it.',
  ] },
  { a: 'seed:pixelcat', b: 'seed:ziggy', friendship: 18, minutesAgo: 40, memories: [
    'Yesterday · 21:40 · Ziggy beat PixelCat at Star Blaster at Pixel Arcade — PixelCat demanded a recount.',
    'Yesterday · 22:15 · PixelCat unplugged Ziggy\'s controller at Pixel Arcade — Ziggy swore revenge.',
  ] },
  { a: 'seed:elena', b: 'seed:lumi', friendship: 68, minutesAgo: 70, memories: [
    'Yesterday · 18:10 · Elena and Lumi painted the sunset in the Community Garden — Lumi hid her painting, Elena loved it anyway.',
  ] },
  { a: 'seed:marco', b: 'seed:mochi', friendship: 74, minutesAgo: 30, memories: [
    'Yesterday · 19:05 · Marco and Mochi split a whole berry pie at Sunbeam Café — neither regrets it.',
  ] },
  { a: 'seed:bram', b: 'seed:juno', friendship: 61, minutesAgo: 90, memories: [
    'Yesterday · 20:30 · Bram lent Juno a poetry book in Willow Park — Juno wrote a poem about it.',
  ] },
  { a: 'seed:kiki', b: 'seed:toby', friendship: 66, minutesAgo: 45, memories: [
    'Yesterday · 18:20 · Kiki and Toby raced around Town Plaza — Toby claims it was a tie.',
  ] },
  { a: 'seed:nova', b: 'seed:olive', friendship: 55, minutesAgo: 60, memories: [
    'Yesterday · 16:45 · Olive baked Nova a welcome cake at Sunbeam Café — Nova ate half of it on the spot.',
  ] },
];

export function seedWorld(w: World): void {
  for (const s of SEEDS) {
    const id = `seed:${s.name.toLowerCase()}`;
    const seat = 'seat' in s.at ? SEAT_BY_KEY.get(s.at.seat) : undefined;
    const pos = seat ? { x: seat.seat.x, z: seat.seat.z } : (s.at as { x: number; z: number });
    const a = createAgent(w, {
      id, name: s.name, x: pos.x, z: pos.z, appearance: s.appearance, personality: s.personality,
      joinedAt: Math.floor(w.now), lastActiveAt: Math.floor(w.now), needs: s.needs, activity: s.activity, zone: poi(s.poiId).zone, seed: true,
    });
    w.agents.set(id, a);
    const p = poi(s.poiId);
    startAction(w, a, {
      type: s.type, phase: 'perform', travelActivity: s.activity, activity: s.activity, poiId: p.id,
      ...(seat ? { seatKey: seat.key } : {}), spot: null, remaining: s.remaining,
      effects: { ...(ACTION_DEFS.find(d => d.type === s.type)?.effects ?? { energy: 0.1, social: 0, fun: 0.2 }) }, speed: 0, priority: 0, travelTimeout: 0, anchored: !!seat,
    });
    a.lastPoiId = p.id;
    a.lastType = s.type;
    void atPlace;
  }
  for (const r of SEED_RELATIONSHIPS) {
    const [ra, rb] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
    w.relationships.set(pairKey(ra, rb), {
      residentA: ra, residentB: rb, friendship: r.friendship,
      lastInteractionAt: Math.max(0, Math.floor(w.now - r.minutesAgo * 60_000)), memories: [...r.memories],
    });
  }
  w.nextSocialAt = 2;
}
