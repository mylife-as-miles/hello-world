/**
 * Downtown district plan — pure + Node-safe (no THREE, no DOM). Deterministic.
 *
 * A ring of city blocks around the neighborhood (≈ 47–114 m from the origin):
 * tallest toward the north/east (behind the portal and the arcade), lower to the
 * south/west so the default high camera looking north still frames the plaza.
 * Streets leave the neighborhood edge (north avenue behind the portal, east avenue,
 * west street) plus two cross streets. Inspired by the module-stacking approach of
 * ProceduralBuildingsThreeJS (MIT, © mohamedachrefelouafi) — no code copied.
 */

export interface DistrictStreet { id: string; ax: number; az: number; bx: number; bz: number; width: number }
export type LotStyle = 'tower' | 'mid' | 'low';
export interface DistrictLot {
  x: number; z: number;
  /** Footprint (metres) — always a whole number of bays. */
  sx: number; sz: number;
  /** Window bay width (m). */
  bayW: number;
  /** Target height above the street (m). */
  height: number;
  style: LotStyle;
  /** 0..1 random numbers for per-building variation. */
  seed: number;
}
export interface DistrictLamp { x: number; z: number; /** Arm direction (unit, x/z). */ dx: number; dz: number }

/** Axis-aligned streets (centre line + full width incl. sidewalks). */
export const DISTRICT_STREETS: DistrictStreet[] = [
  { id: 'north-ave', ax: 0, az: -33, bx: 0, bz: -124, width: 11 },
  { id: 'north-cross', ax: -104, az: -74, bx: 112, bz: -74, width: 9 },
  { id: 'east-ave', ax: 33, az: -4, bx: 124, bz: -4, width: 10 },
  { id: 'east-cross', ax: 76, az: -112, bx: 76, bz: 64, width: 9 },
  { id: 'west-st', ax: -33, az: 9, bx: -122, bz: 9, width: 9 },
];

export const DISTRICT_INNER = 47;
export const DISTRICT_OUTER = 114;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function streetRect(s: DistrictStreet, pad = 0) {
  const h = s.width / 2 + pad;
  return { x0: Math.min(s.ax, s.bx) - h, x1: Math.max(s.ax, s.bx) + h, z0: Math.min(s.az, s.bz) - h, z1: Math.max(s.az, s.bz) + h };
}
function hitsStreet(x: number, z: number, hx: number, hz: number): boolean {
  for (const s of DISTRICT_STREETS) {
    const r = streetRect(s);
    if (x + hx > r.x0 && x - hx < r.x1 && z + hz > r.z0 && z - hz < r.z1) return true;
  }
  return false;
}

const PITCH = 17;
const BAYS = [2.7, 3.1, 3.5, 4.1];

/** Building lots. 'high' ≈ 55–65 buildings, 'low' ≈ 35–40 (same seed, subset). */
export function planDistrict(quality: 'low' | 'high'): DistrictLot[] {
  const r = rng(0xd15c0de);
  const lots: DistrictLot[] = [];
  for (let gx = -7; gx <= 7; gx++) for (let gz = -7; gz <= 7; gz++) {
    // Always consume the same randoms so 'low' is a subset of 'high'.
    const jx = (r() - 0.5) * 3, jz = (r() - 0.5) * 3;
    const roll = r(), rh = r(), rs = r(), rb = r(), r1 = r(), r2 = r(), seed = r();
    const x = gx * PITCH + jx, z = gz * PITCH + jz;
    const rad = Math.hypot(x, z);
    if (Math.max(Math.abs(x), Math.abs(z)) < DISTRICT_INNER || rad > DISTRICT_OUTER) continue;
    const north = -z / rad, east = x / rad;
    const focus = Math.max(north, east * 0.95);
    const tall = smooth(-0.3, 0.85, focus);
    const keep = (0.36 + 0.56 * tall) * (quality === 'high' ? 1 : 0.64);
    if (roll > keep) continue;
    const bayW = BAYS[Math.floor(rb * BAYS.length) % BAYS.length]!;
    const sx = Math.max(2, Math.round((9 + r1 * 5) / bayW)) * bayW;
    const sz = Math.max(2, Math.round((9 + r2 * 5) / bayW)) * bayW;
    if (hitsStreet(x, z, sx / 2 + 1.4, sz / 2 + 1.4)) continue;
    const dist = smooth(DISTRICT_INNER, 104, rad);
    const height = 9 + rh * 7 + tall * (8 + 54 * dist * (0.4 + 0.6 * rs));
    const style: LotStyle = height > 42 ? 'tower' : height > 21 ? 'mid' : 'low';
    lots.push({ x, z, sx, sz, bayW, height, style, seed });
  }
  return lots;
}

/** Street lamps along both sidewalks (skips the neighborhood square and crossings). */
export function planLamps(quality: 'low' | 'high'): DistrictLamp[] {
  const out: DistrictLamp[] = [];
  const step = quality === 'high' ? 15 : 22;
  for (const s of DISTRICT_STREETS) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
    const ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len;
    const nx = -uz, nz = ux;
    for (let d = 6, i = 0; d < len - 4; d += step, i++) {
      for (const side of [-1, 1]) {
        const off = s.width / 2 - 0.7;
        const along = d + (side > 0 ? step / 2 : 0);
        if (along > len - 4) continue;
        const x = s.ax + ux * along + nx * off * side, z = s.az + uz * along + nz * off * side;
        if (Math.max(Math.abs(x), Math.abs(z)) < 36) continue;
        let inCrossing = false;
        for (const o of DISTRICT_STREETS) {
          if (o === s) continue;
          const rr = streetRect(o, 1.5);
          if (x > rr.x0 && x < rr.x1 && z > rr.z0 && z < rr.z1) { inCrossing = true; break; }
        }
        if (inCrossing) continue;
        out.push({ x, z, dx: -nx * side, dz: -nz * side });
      }
    }
  }
  return out;
}

let cachedLots: DistrictLot[] | null = null;
/**
 * True when (x, z) is covered by a district building lot or street (+pad metres).
 * Lets Town skip forest-belt trees that would poke through buildings/streets.
 */
export function districtOccupied(x: number, z: number, pad = 1): boolean {
  cachedLots ??= planDistrict('high');
  for (const l of cachedLots) {
    if (Math.abs(x - l.x) < l.sx / 2 + pad && Math.abs(z - l.z) < l.sz / 2 + pad) return true;
  }
  for (const s of DISTRICT_STREETS) {
    const r = streetRect(s, pad);
    if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
  }
  return false;
}
