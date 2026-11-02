/**
 * Boulder placements on the landscape — pure + Node-safe, deterministic.
 * Rocky banks and faces get most of them (probability grows with slope), the
 * lake shore gets a few, and the odd glacial erratic sits out in the meadows.
 * Skips the town disc, open water and the downtown district's lots/streets.
 */
import { districtOccupied } from '../district/plan';
import { lakeDistance, terrainHeightAt, terrainSlopeAt } from './terrain';
import { smoothstep } from './superTerrainNoise';

export interface RockPlacement {
  x: number;
  /** Already sunk into the ground by part of its size. */
  y: number;
  z: number;
  /** Uniform size in metres (≈ boulder radius). */
  scale: number;
  /** Non-uniform squash (y) for slabs vs. rounded boulders. */
  squash: number;
  rot: number;
  /** 0..1 tint pick. */
  tone: number;
}

export function buildRockPlacements(quality: 'low' | 'high', avoidDistrict = true): RockPlacement[] {
  const target = quality === 'high' ? 170 : 90;
  const out: RockPlacement[] = [];
  let state = 0x5eed4 >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let v = state;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 0x100000000;
  };
  const minR = 41, maxR = 215;
  for (let attempt = 0; attempt < target * 60 && out.length < target; attempt++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(minR * minR + random() * (maxR * maxR - minR * minR));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const roll = random();
    const lakeD = lakeDistance(x, z);
    if (lakeD < 1.05) continue;
    const h = terrainHeightAt(x, z);
    const slope = terrainSlopeAt(x, z, 1.5, h);
    const shore = lakeD < 1.5 ? 0.5 : 0;
    const p = 0.035 + smoothstep(0.18, 0.7, slope) * 0.7 + shore;
    if (roll > p) continue;
    if (avoidDistrict && districtOccupied(x, z, 1.5)) continue;
    // Keep a little clear of other rocks.
    let close = false;
    for (const o of out) { if ((o.x - x) ** 2 + (o.z - z) ** 2 < 9) { close = true; break; } }
    if (close) continue;
    const big = smoothstep(60, 190, r);
    const scale = (0.45 + random() * 0.75) * (1 + big * 1.6) * (shore ? 0.8 : 1);
    const squash = 0.55 + random() * 0.4;
    out.push({ x, y: h - scale * squash * 0.35, z, scale, squash, rot: random() * Math.PI * 2, tone: random() });
  }
  return out;
}
