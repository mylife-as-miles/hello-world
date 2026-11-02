import { describe, expect, it } from 'vitest';
import {
  FOREST_PLACEMENTS, FOREST_PLACEMENTS_LOW, FOREST_VARIANTS, LANDSCAPE_FLAT_RADIUS, buildForestPlacements, buildRockPlacements,
  isLakeWater, terrainHeightAt,
} from './index';

describe('landscape terrain', () => {
  it('is exactly flat (y = 0) inside the neighborhood radius', () => {
    for (let i = 0; i < 4000; i++) {
      const a = (i * 2.399963) % (Math.PI * 2), r = Math.sqrt((i + 0.5) / 4000) * LANDSCAPE_FLAT_RADIUS;
      expect(terrainHeightAt(Math.cos(a) * r, Math.sin(a) * r)).toBe(0);
    }
    expect(terrainHeightAt(34, 0)).toBe(0);
    expect(terrainHeightAt(-34, -34 * 0)).toBe(0);
  });

  it('leaves the flat smoothly (no seam) and rises to close the horizon', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const c = Math.cos(a), s = Math.sin(a);
      expect(Math.abs(terrainHeightAt(c * 37, s * 37))).toBeLessThan(0.01);
      expect(terrainHeightAt(c * 42, s * 42)).toBeGreaterThanOrEqual(0);
      expect(terrainHeightAt(c * 42, s * 42)).toBeLessThan(0.3);
    }
    let sum = 0, n = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.05) { sum += terrainHeightAt(Math.cos(a) * 240, Math.sin(a) * 240); n++; }
    expect(sum / n).toBeGreaterThan(20);
  });

  it('places forest outside town, on the terrain, out of the lake, deterministically', () => {
    expect(FOREST_PLACEMENTS.length).toBeGreaterThan(300);
    expect(FOREST_PLACEMENTS_LOW.length).toBeLessThan(FOREST_PLACEMENTS.length);
    for (const p of FOREST_PLACEMENTS) {
      expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(38.5);
      expect(p.y).toBeCloseTo(terrainHeightAt(p.x, p.z), 6);
      expect(isLakeWater(p.x, p.z)).toBe(false);
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(FOREST_VARIANTS.length);
    }
    const again = buildForestPlacements();
    expect(again.length).toBe(FOREST_PLACEMENTS.length);
    expect(again[17]).toEqual(FOREST_PLACEMENTS[17]);
  });

  it('keeps boulders outside the town and out of the water', () => {
    const rocks = buildRockPlacements('high');
    expect(rocks.length).toBeGreaterThan(50);
    for (const r of rocks) {
      expect(Math.hypot(r.x, r.z)).toBeGreaterThan(40);
      expect(isLakeWater(r.x, r.z)).toBe(false);
    }
  });
});
