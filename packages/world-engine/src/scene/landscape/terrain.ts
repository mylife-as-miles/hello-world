/**
 * Landscape height model — pure + Node-safe (no three / DOM), deterministic.
 *
 * A terrain RING around the flat neighborhood: exactly y = 0 inside
 * `LANDSCAPE_FLAT_RADIUS` (36 m; residents, seats and paths rely on it), a
 * C2-smooth blend out of the flat (zero height, slope and curvature at 36 m →
 * no seam), gentle swells under the downtown ring (≈ 47–114 m, buildings and
 * streets sit on it), then sculpted foothills and a ridged mountain range from
 * ≈ 110 m outwards that closes the horizon (peaks ≈ 50–90 m at 160–300 m).
 *
 * The landform composition is super-terrain's base elevation model
 * (src/terrain/compiler/heightField.ts → `sampleHeightField`, MIT © 2026
 * alightinastorm): a massif mask, a domain-warped ridged multifractal for the
 * range, billow foothills, fbm plains and drainage valleys carved by a second
 * ridged field with flattened valley floors. It is evaluated on a scaled
 * domain (1 m here ≈ 7.5 m of super-terrain world) and with heights scaled by
 * the same factor, and its continent-scale "spine" is replaced by a radial
 * envelope around the town. See ./CREDITS.md.
 */
import { billow, clamp, fbm, lerp, ridgedMultifractal, smootherstep, smoothstep } from './superTerrainNoise';

/** Inside this radius the landscape is exactly y = 0 (town ground). */
export const LANDSCAPE_FLAT_RADIUS = 36;
/** Width of the blend out of the flat town disc. */
export const LANDSCAPE_BLEND_WIDTH = 34;
/** The mesh starts slightly inside the flat radius (coplanar overlap, wins via polygon offset). */
export const LANDSCAPE_INNER_RADIUS = 34;
/** Outer edge of the terrain mesh (far beyond the fog end). */
export const LANDSCAPE_OUTER_RADIUS = 340;

/** Valley lake (south-west, outside the downtown ring). Ellipse in the XZ plane. */
export const LAKE = { x: -102, z: 98, rx: 31, rz: 19, rot: 0.55, level: 4.2 } as const;

/** super-terrain world metres per landscape metre (domain scale) — heights are divided by it. */
const S = 7.5;
const SEED = 4217;
/** Offset into the super-terrain field (st metres) — picks a pleasing patch of the range. */
const OX = 2310;
const OZ = -1185;

// super-terrain's amplitudes (st metres), scaled to the landscape below.
const RIDGE_SHARPNESS = 1.15;
const MOUNTAIN_AMPLITUDE = 430 / S; // ≈ 57 m
const FOOTHILL_AMPLITUDE = 62 / S; // ≈ 8.3 m
const PLAIN_AMPLITUDE = 16 / S; // ≈ 2.1 m

export interface TerrainSample {
  height: number;
  /** 0 on the plains, 1 in the high range (material: rock / alpine). */
  massif: number;
  /** 0..1 proximity to a carved drainage line (material: lush valley floor). */
  valley: number;
  /** Normalised ellipse distance to the lake (1 = shoreline). */
  lakeD: number;
}

/**
 * Normalised elliptical distance to the lake centre (1 on the shoreline), with
 * a noise-perturbed rim so the shore reads as natural rather than as an ellipse.
 */
export function lakeDistance(x: number, z: number): number {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot);
  const u = (dx * c - dz * s) / LAKE.rx, v = (dx * s + dz * c) / LAKE.rz;
  const d = Math.sqrt(u * u + v * v);
  if (d > 3) return d;
  return d + fbm(x * 0.045, z * 0.045, SEED + 613, 3, 2.1, 0.5) * 0.24;
}

const OUT: TerrainSample = { height: 0, massif: 0, valley: 0, lakeD: 99 };

/**
 * Full sample (height + material fields). Returns a SHARED object — copy what
 * you need before calling again.
 */
export function sampleTerrain(x: number, z: number): TerrainSample {
  const r = Math.hypot(x, z);
  const lakeD = lakeDistance(x, z);
  OUT.lakeD = lakeD;
  if (r <= LANDSCAPE_FLAT_RADIUS) { OUT.height = 0; OUT.massif = 0; OUT.valley = 0; return OUT; }

  const X = x * S + OX, Z = z * S + OZ;

  // 1–2. The range (only evaluated where it can exist: r > 96 m).
  let massif = 0, mountains = 0, warpX = 0, warpZ = 0;
  if (r > 96) {
    // Massif mask: super-terrain's spine × regional fbm, with the spine made radial.
    const spine = smoothstep(108, 192, r);
    const regional = fbm(X * 0.00028, Z * 0.00028, SEED + 11, 3, 2.1, 0.5);
    massif = clamp(smoothstep(0.18, 0.78, spine * 0.75 + regional * 0.55 + 0.08), 0, 1) * smoothstep(96, 136, r);
    // The lake sits in an open valley: the range steps back from its shore.
    if (lakeD < 3) massif *= smoothstep(1.15, 3, lakeD);
    // Domain-warped ridged multifractal (the range itself).
    warpX = fbm(X * 0.0011, Z * 0.0011, SEED + 71, 3, 2.2, 0.5) * 240;
    warpZ = fbm(X * 0.0011 + 5.7, Z * 0.0011 - 3.1, SEED + 73, 3, 2.2, 0.5) * 240;
    if (massif > 0) {
      const ridge = ridgedMultifractal((X + warpX) * 0.00085, (Z + warpZ) * 0.00085, SEED + 101, 6);
      mountains = Math.pow(ridge, RIDGE_SHARPNESS) * MOUNTAIN_AMPLITUDE * massif;
    }
  }

  // 3. Billow foothills + fbm plains (kept positive and calm under the downtown ring).
  const calm = lerp(0.5, 1, smoothstep(96, 150, r));
  const foothills = billow(X * 0.0034, Z * 0.0034, SEED + 211, 4) * FOOTHILL_AMPLITUDE * (0.35 + massif * 0.9) * calm;
  const plains = (fbm(X * 0.0062, Z * 0.0062, SEED + 307, 4, 2.15, 0.52) * 0.5 + 0.5) * PLAIN_AMPLITUDE * calm;
  // A broad bowl so the horizon rises all the way round, even between peaks,
  // with an outer rim so the mesh edge always reads as a ridge line.
  const bowl = Math.pow(smoothstep(52, 290, r), 1.25) * 24 + smoothstep(270, 335, r) * 22;

  let height = mountains + foothills + plains + bowl;

  // 4. Drainage valleys (second ridged field), carved only out in the range.
  let valley = 0;
  if (r > 104) {
    const drainage = ridgedMultifractal((X - warpZ * 0.4) * 0.00062, (Z + warpX * 0.4) * 0.00062, SEED + 401, 5);
    valley = clamp(smoothstep(0.62, 0.98, 1 - drainage), 0, 1) * smoothstep(104, 150, r);
    height -= ((26 + massif * 120) / S) * valley;
    const floor = 2 + bowl * 0.6 + massif * (40 / S);
    if (valley > 0.55) {
      const flatten = smoothstep(0.55, 0.95, valley) * 0.65;
      height = lerp(height, Math.min(height, floor + valley * (12 / S)), flatten);
    }
  }

  // 5. Lake basin: bed below the water level, gentle shore rising out of it.
  if (lakeD < 2.6) {
    const target = lakeD < 1 ? LAKE.level - 2.8 * (1 - lakeD * lakeD) : LAKE.level + (lakeD - 1) * 3.2;
    height = lerp(height, target, 1 - smoothstep(1.0, 2.6, lakeD));
  }

  // 6. Seamless blend out of the flat town disc (C2: zero height/slope/curvature at 36 m).
  const blend = smootherstep(LANDSCAPE_FLAT_RADIUS, LANDSCAPE_FLAT_RADIUS + LANDSCAPE_BLEND_WIDTH, r);
  OUT.height = height * blend;
  OUT.massif = massif;
  OUT.valley = valley;
  return OUT;
}

/**
 * Terrain surface height (metres) at world (x, z). Exactly 0 for
 * hypot(x, z) ≤ 36. Stable function identity — safe as a memo dependency.
 */
export function terrainHeightAt(x: number, z: number): number {
  if (x * x + z * z <= LANDSCAPE_FLAT_RADIUS * LANDSCAPE_FLAT_RADIUS) return 0;
  return sampleTerrain(x, z).height;
}

/** Surface slope (rise over run, ≈1 at 45°) by finite differences (pass h0 = height at (x, z) to save a sample). */
export function terrainSlopeAt(x: number, z: number, d = 1.5, h0 = terrainHeightAt(x, z)): number {
  const hx = terrainHeightAt(x + d, z) - h0;
  const hz = terrainHeightAt(x, z + d) - h0;
  return Math.hypot(hx, hz) / d;
}

/** True when (x, z) is open water (lake). */
export function isLakeWater(x: number, z: number, margin = 0): boolean {
  return lakeDistance(x, z) < 1 + margin;
}
