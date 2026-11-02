/**
 * Noise primitives ported from super-terrain (MIT © 2026 alightinastorm,
 * https://github.com/vibe-stack/super-terrain):
 *   - src/terrain/compiler/heightField.ts → `ridgedMultifractal`, `billow`, `fbm`,
 *     `valueNoise`, `smoothFraction`, `hash2` (band-limiting / LOD octave gain
 *     removed: we mesh once, at a single resolution per vertex)
 *   - src/terrain/core/bounds.ts → `clamp`, `lerp`, `smoothstep`
 * Pure + Node-safe (no three, no DOM). See ./CREDITS.md.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** C2-continuous variant (zero 1st + 2nd derivative at both ends) — used for seam blends. */
export function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Ridged multifractal: detail concentrates on the ridges, flanks stay smooth. 0..1. */
export function ridgedMultifractal(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.52;
  let frequency = 1;
  let weight = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    let signal = 1 - Math.abs(valueNoise(x * frequency, z * frequency, seed + octave * 37) * 2 - 1);
    signal *= signal;
    signal *= weight;
    sum += signal * amplitude;
    weight = clamp(signal * 2.2, 0, 1);
    total += amplitude;
    amplitude *= 0.52;
    frequency *= 2.07;
  }
  return clamp(sum / total, 0, 1);
}

/** Billow noise (|2u-1| octaves): rounded foothills and meadow swells. 0..1. */
export function billow(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += Math.abs(valueNoise(x * frequency, z * frequency, seed + octave * 53) * 2 - 1) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

/** Fractal Brownian motion, roughly −1..1 (zero-mean). */
export function fbm(x: number, z: number, seed: number, octaves: number, lacunarity: number, gain: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  const total = gain === 1 ? 0.5 * octaves : (0.5 * (1 - Math.pow(gain, octaves))) / (1 - gain);
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += (valueNoise(x * frequency, z * frequency, seed + octave * 17) * 2 - 1) * amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / total;
}

/** Quintic-interpolated value noise, 0..1. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothFraction(x - x0);
  const tz = smoothFraction(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function smoothFraction(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

export function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374_761_393) + Math.imul(z, 668_265_263);
  value = (value ^ (value >>> 13)) + Math.imul(seed, 1_443_053);
  value = Math.imul(value ^ (value >>> 16), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}
