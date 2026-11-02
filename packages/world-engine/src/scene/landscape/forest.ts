/**
 * Forest placements on the landscape ring — pure + Node-safe, deterministic.
 *
 * The layout is super-terrain's region forest generator
 * (src/tree/forestPresets.ts → `generateForestLayoutInRegion`, `standCover`,
 * `habitatNoise`, `SpacingGrid`, `mulberry32`, `hashString`; MIT © 2026
 * alightinastorm): rejection sampling over a region whose coverage decides
 * WHERE forest may stand, three-scale habitat noise deciding how THICK it is
 * (stands, glades, gaps around veterans), an open-grown size bias, and a
 * spacing grid. Here the region is the ring outside the town (≥ 38.5 m) and
 * coverage also rejects steep slopes, the tree line, the lake and (optionally)
 * the downtown district's lots/streets. See ./CREDITS.md.
 */
import { districtOccupied } from '../district/plan';
import { lakeDistance, terrainHeightAt, terrainSlopeAt } from './terrain';
import { smoothstep } from './superTerrainNoise';

/**
 * Variant index order used by `variant` — identical to src/scene/foliage
 * `TREE_VARIANTS` (GeneratedTrees asset order); not imported so this module stays Node-safe.
 */
export const FOREST_VARIANTS = ['broadleaf', 'conifer', 'birch', 'blossom', 'autumn'] as const;
const BROADLEAF = 0, CONIFER = 1, BIRCH = 2, BLOSSOM = 3, AUTUMN = 4;
export type ForestVariantName = (typeof FOREST_VARIANTS)[number];

/** One tree on the landscape. `variant` indexes FOREST_VARIANTS; `y` = terrainHeightAt(x, z). */
export interface ForestPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  /** Yaw radians. */
  rot: number;
  variant: number;
  species: ForestVariantName;
}

export interface ForestOptions {
  seed?: number;
  /** Stems per hectare before coverage (super-terrain 'temperate-mixed' = 125). */
  treesPerHectare?: number;
  density?: number;
  minRadius?: number;
  maxRadius?: number;
  /** Skip downtown district lots/streets (src/scene/district/plan `districtOccupied`). Default true. */
  avoidDistrict?: boolean;
  /** Extra exclusion test. */
  exclude?: (x: number, z: number) => boolean;
  /** Hard cap on stems. */
  maxStems?: number;
}

const GAP_RATE = 0.12; // temperate-mixed
const THINNEST = 0.14; // super-terrain uses 0.42 (closed woodland); lower → groves and glades

/** 0..1 forest-stand density field (also tints the forest floor in the terrain colours). */
export function forestCover(x: number, z: number, seed = 0xf0257): number {
  return standCover(x * 0.55, z * 0.55, seed) - GAP_RATE;
}

export function buildForestPlacements(opts: ForestOptions = {}): ForestPlacement[] {
  const seed = opts.seed ?? 0xf0257;
  const tph = opts.treesPerHectare ?? 125;
  const density = opts.density ?? 0.62;
  const minR = opts.minRadius ?? 38.5;
  const maxR = opts.maxRadius ?? 195;
  const avoidDistrict = opts.avoidDistrict ?? true;
  const random = mulberry32(seed ^ hashString('hello-world-landscape'));

  const coverage = (x: number, z: number, r: number): number => {
    let c = smoothstep(minR, minR + 7, r) * (1 - smoothstep(maxR - 30, maxR, r));
    if (c <= 0.002) return 0;
    if (lakeDistance(x, z) < 1.35) return 0;
    if (avoidDistrict && districtOccupied(x, z, 2.2)) return 0;
    if (opts.exclude?.(x, z)) return 0;
    const h = terrainHeightAt(x, z);
    c *= 1 - smoothstep(50, 64, h); // tree line
    if (c <= 0.002) return 0;
    c *= 1 - smoothstep(0.5, 0.85, terrainSlopeAt(x, z, 1.5, h)); // gentle slopes only
    // Thick belt framing the town, thinner stands out on the range.
    return c * (1 - 0.5 * smoothstep(75, 150, r));
  };

  const area = Math.PI * (maxR * maxR - minR * minR);
  const budget = Math.min(opts.maxStems ?? 640, Math.max(4, Math.round(tph * (area / 10_000) * density)));
  const accepted: Array<ForestPlacement & { spacing: number }> = [];
  const grid = new SpacingGrid(12);
  const maxAttempts = Math.max(60_000, budget * 120);
  const saturatedAfter = Math.max(6_000, budget * 3);
  let sinceAccepted = 0;

  for (let attempt = 0; attempt < maxAttempts && accepted.length < budget; attempt += 1) {
    if (sinceAccepted > saturatedAfter) break;
    sinceAccepted += 1;
    // Uniform over the annulus.
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(minR * minR + random() * (maxR * maxR - minR * minR));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;

    const field = forestCover(x, z, seed);
    const inStand = THINNEST + (1 - THINNEST) * Math.min(1, Math.max(0, field));
    // Cheap rejection first, coverage (terrain queries) only for survivors.
    const roll = random();
    if (roll > inStand) continue;
    const inRegion = coverage(x, z, r);
    if (roll > inStand * inRegion) continue;

    const y = terrainHeightAt(x, z);
    // Species mix: temperate lowland broadleaf + birch, conifers climbing the range.
    const alpine = smoothstep(8, 34, y) * 0.75 + smoothstep(90, 170, r) * 0.25;
    const pick = random();
    let variant: number;
    if (r < 72 && pick < 0.06) variant = BLOSSOM; // a few blossoms near town
    else if (pick < 0.16 + alpine * 0.6) variant = CONIFER;
    else if (pick < 0.29 + alpine * 0.6 || (lakeDistance(x, z) < 2.4 && pick < 0.55)) variant = BIRCH;
    else if (pick > 0.86 - (1 - alpine) * 0.04) variant = AUTUMN; // warm accents in the lowlands
    else variant = BROADLEAF;

    const openness = 1 - Math.min(1, Math.max(0, field));
    const sizeRoll = random() + (openness - random()) * 0.35;
    const reach = 1 + smoothstep(55, 180, r) * 0.5; // distant trees read bigger
    const scale = (0.82 + Math.min(1, Math.max(0, sizeRoll)) * 0.42) * reach;
    const spacing = 3.1 * scale;
    if (grid.overlaps(x, z, spacing)) continue;
    grid.insert(x, z, spacing);
    sinceAccepted = 0;
    accepted.push({ x, y, z, scale, rot: random() * Math.PI * 2, variant, species: FOREST_VARIANTS[variant]!, spacing });
  }
  // Sorted near → far (handy for LOD subsets / draw order).
  accepted.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  return accepted.map(({ spacing: _s, ...p }) => p);
}

let cached: ForestPlacement[] | null = null;
let cachedLow: ForestPlacement[] | null = null;

/** Default forest (high ≈ 640 stems, low ≈ 380). Lazily generated once. */
export function getForestPlacements(quality: 'low' | 'high' = 'high'): ForestPlacement[] {
  cached ??= buildForestPlacements();
  if (quality === 'high') return cached;
  // Low: keep everything near town, thin the far stems deterministically.
  cachedLow ??= cached.filter((p, i) => Math.hypot(p.x, p.z) < 70 || i % 2 === 0);
  return cachedLow;
}

/* ---------------------------------------------------------------- super-terrain helpers (ported) */

class SpacingGrid {
  private readonly cell: number;
  private readonly buckets = new Map<number, Array<[number, number, number]>>();
  constructor(cell: number) { this.cell = cell; }
  private key(gx: number, gz: number): number { return (Math.imul(gx, 0x45d9f3b) ^ Math.imul(gz, 0x27d4eb2d)) | 0; }
  overlaps(x: number, z: number, spacing: number): boolean {
    const gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const bucket = this.buckets.get(this.key(gx + dx, gz + dz));
      if (!bucket) continue;
      for (const [px, pz, ps] of bucket) {
        const ex = px - x, ez = pz - z, minimum = (ps + spacing) * 0.7;
        if (ex * ex + ez * ez < minimum * minimum) return true;
      }
    }
    return false;
  }
  insert(x: number, z: number, spacing: number): void {
    const key = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push([x, z, spacing]); else this.buckets.set(key, [[x, z, spacing]]);
  }
}

function standCover(x: number, z: number, seed: number): number {
  const broad = habitatNoise(x / 4.1, z / 4.1, seed);
  const grove = habitatNoise(x / 1.55, z / 1.55, seed ^ 0x9e3779b9);
  const gaps = habitatNoise(x / 0.62, z / 0.62, seed ^ 0x85ebca6b);
  const sum = broad * 0.55 + grove * 0.31 + gaps * 0.14;
  return 1 / (1 + Math.exp(-1.702 * ((sum - 0.5) / 0.187)));
}

function habitatNoise(x: number, z: number, seed: number): number {
  const cellSize = 22;
  const gx = Math.floor(x / cellSize), gz = Math.floor(z / cellSize);
  const tx = smooth(x / cellSize - gx), tz = smooth(z / cellSize - gz);
  const a = gridHash(gx, gz, seed), b = gridHash(gx + 1, gz, seed);
  const c = gridHash(gx, gz + 1, seed), d = gridHash(gx + 1, gz + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function gridHash(x: number, z: number, seed: number): number {
  let value = seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

function smooth(value: number): number { return value * value * (3 - 2 * value); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}
