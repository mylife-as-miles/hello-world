/**
 * Downtown district geometry/materials (THREE). Everything is merged into TWO meshes:
 *  - facade: window walls (UVs in bay/floor units, tiled window texture × per-building
 *    vertex colour; emissive window map whose intensity follows the night factor)
 *  - plain: roofs, cornices, storefronts, awnings, rooftop props, streets, lamps
 *    (vertex colour + a per-vertex `aGlow` emissive colour scaled by one shared
 *    `uNight` uniform: shop windows, lamp heads, neon blades, beacons, light pools).
 * → 2 draw calls for the whole district, no shadows, no per-frame allocations.
 */
import * as THREE from 'three';
import { DISTRICT_STREETS, planDistrict, planLamps, planStreetTrees, type DistrictLot } from './plan';

type RGB = readonly [number, number, number];
const BLACK: RGB = [0, 0, 0];
const lin = (hex: string, k = 1): RGB => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

class Writer {
  p: number[] = []; n: number[] = []; c: number[] = []; g: number[] = []; uv: number[] = [];
  constructor(readonly withUv: boolean, readonly withGlow: boolean) {}
  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: RGB, glow: RGB, u: number, w: number) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]);
    if (this.withGlow) this.g.push(glow[0], glow[1], glow[2]);
    if (this.withUv) this.uv.push(u, w);
  }
  /** Planar polygon (convex, CCW seen from the front), flat normal, fan-triangulated. */
  poly(pts: number[][], col: RGB | RGB[], glow: RGB | RGB[] = BLACK, uvs?: number[][]) {
    const [a, b, c] = pts as [number[], number[], number[]];
    const e1x = b[0]! - a[0]!, e1y = b[1]! - a[1]!, e1z = b[2]! - a[2]!;
    const e2x = c[0]! - a[0]!, e2y = c[1]! - a[1]!, e2z = c[2]! - a[2]!;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const colAt = (i: number): RGB => (Array.isArray(col[0]) ? (col as RGB[])[i]! : col as RGB);
    const glowAt = (i: number): RGB => (Array.isArray(glow[0]) ? (glow as RGB[])[i]! : glow as RGB);
    for (let i = 1; i < pts.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        const q = pts[k]!;
        this.v(q[0]!, q[1]!, q[2]!, nx, ny, nz, colAt(k), glowAt(k), uvs ? uvs[k]![0]! : 0, uvs ? uvs[k]![1]! : 0);
      }
    }
  }
  /** Axis-aligned box without its bottom face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, glow: RGB = BLACK, top = true) {
    if (top) this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], col, glow);
    this.sides(x0, z0, x1, z1, y0, y1, col, glow);
  }
  sides(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, col: RGB, glow: RGB = BLACK) {
    const ring: Array<[number, number]> = [[x0, z1], [x1, z1], [x1, z0], [x0, z0], [x0, z1]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = ring[i]!, [bx, bz] = ring[i + 1]!;
      this.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], col, glow);
    }
  }
  /** Gabled roof, ridge along X (slopes overhang by `ov`; gable ends in `wallCol`). */
  gable(x0: number, z0: number, x1: number, z1: number, y: number, h: number, roofCol: RGB, wallCol: RGB, ov = 0.45) {
    const zm = (z0 + z1) / 2, ye = y - 0.25;
    this.poly([[x0 - ov, ye, z1 + ov], [x1 + ov, ye, z1 + ov], [x1 + ov, y + h, zm], [x0 - ov, y + h, zm]], roofCol);
    this.poly([[x1 + ov, ye, z0 - ov], [x0 - ov, ye, z0 - ov], [x0 - ov, y + h, zm], [x1 + ov, y + h, zm]], roofCol);
    this.poly([[x0, y, z0], [x0, y, z1], [x0, y + h, zm]], wallCol);
    this.poly([[x1, y, z1], [x1, y, z0], [x1, y + h, zm]], wallCol);
  }
  /** Square pyramid (roof cap / spire). */
  pyramid(cx: number, y0: number, cz: number, hx: number, hz: number, h: number, col: RGB, glow: RGB = BLACK) {
    const ring: Array<[number, number]> = [[cx - hx, cz + hz], [cx + hx, cz + hz], [cx + hx, cz - hz], [cx - hx, cz - hz], [cx - hx, cz + hz]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = ring[i]!, [bx, bz] = ring[i + 1]!;
      this.poly([[ax, y0, az], [bx, y0, bz], [cx, y0 + h, cz]], col, glow);
    }
  }
  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.withGlow) geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.g, 3));
    if (this.withUv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}

/* ------------------------------------------------------------ low-poly tree crown template */
let ICO: number[][][] | null = null;
function icoTris(): number[][][] {
  if (ICO) return ICO;
  const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const a = g.attributes.position!;
  const tris: number[][][] = [];
  for (let i = 0; i < a.count; i += 3) tris.push([0, 1, 2].map(k => [a.getX(i + k), a.getY(i + k), a.getZ(i + k)]));
  g.dispose();
  return (ICO = tris);
}
const LEAVES = ['#7bb35a', '#6aa457', '#8cc46a', '#5f9a52', '#9cc76a'].map(h => lin(h));
const BLOSSOM = lin('#f2b0c0');
const TRUNK = lin('#7a5a44');
function addTree(p: Writer, x: number, y: number, z: number, s: number, crown: RGB) {
  p.box(x - 0.13 * s, y, z - 0.13 * s, x + 0.13 * s, y + 1.3 * s, z + 0.13 * s, TRUNK);
  const cy = y + 1.3 * s + 0.9 * s, rx = 1.15 * s, ry = 1.25 * s;
  for (const t of icoTris()) p.poly(t.map(v => [x + v[0]! * rx, cy + v[1]! * ry, z + v[2]! * rx]), crown);
}

/* ------------------------------------------------------------ palettes */
const WALLS = ['#f3e3c3', '#ecd2a8', '#e3a687', '#f1c09a', '#c9d3ad', '#b3c6d6', '#cdbfdc', '#d28a6c', '#ddd0c0', '#bfe0cc', '#f2dc98', '#e9b7b0', '#c7a58a', '#a9c4bd'].map(h => lin(h));
const TRIMS = ['#fbf3e4', '#efe2cc', '#d9c7ae', '#b9a68f'].map(h => lin(h));
const ROOFS = ['#9a8f88', '#8c8a8f', '#a69886', '#7f8a86'].map(h => lin(h));
const GABLE_ROOFS = ['#d9634a', '#3d5a8a', '#8a5a44', '#e07b55', '#5f7f6a', '#b84f45'].map(h => lin(h));
const AWNINGS = ['#e7745f', '#4fa3a5', '#f2b84b', '#8a6fc7', '#5f9e6e', '#e36aa6'].map(h => lin(h));
const NEON = ['#ff6fae', '#5fe3ff', '#ffd25e', '#9d7bff', '#7dffb0', '#ff8f5e'];
const SHOP_GLASS = lin('#5f6874');
const SHOP_GLOW = lin('#ffbe73', 1.15);
const ASPHALT = lin('#77737a');
const SIDEWALK = lin('#d8cbb7');
const CURB = lin('#bcae9a');
const DASH = lin('#f4e2a2');
const POLE = lin('#33393a');
const LAMP_HEAD = lin('#f7e6c4');
const LAMP_GLOW = lin('#ffc070', 1.9);
const POOL_GLOW = lin('#ffb867', 0.55);
const BEACON = lin('#ff4a3d');
const BEACON_GLOW = lin('#ff3b2f', 3.2);

/** Terrain height sampler for the current build (set synchronously by buildDistrict). */
let hAt: (x: number, z: number) => number = () => 0;

const CELLS = 16;
const FLOOR_H = 3.3;
const STORE_H = 4.4;

/* ------------------------------------------------------------ textures */
function windowTextures(size: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const cells = 16, cs = size / cells;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = size; return cv; };
  const a = mk(), b = mk();
  const ca = a.getContext('2d')!, cb = b.getContext('2d')!;
  ca.fillStyle = '#ffffff'; ca.fillRect(0, 0, size, size);
  cb.fillStyle = '#000000'; cb.fillRect(0, 0, size, size);
  const r = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const warm = ['#ffd27a', '#ffe0a3', '#ffc066', '#ffe9c2', '#ffcf8f', '#cfe3ff'];
  // Columns 0–7: style A (punched windows with sills) · columns 8–15: style B (office ribbon glazing).
  for (let j = 0; j < cells; j++) {
    let runLit = false;
    for (let i = 0; i < cells; i++) {
      const x = i * cs, y = j * cs;
      const office = i >= cells / 2;
      if (!office) {
        ca.fillStyle = '#e6e0d8'; ca.fillRect(x, y + cs * 0.86, cs, cs * 0.14); // spandrel / floor slab
        const wx = x + cs * 0.2, wy = y + cs * 0.16, ww = cs * 0.6, wh = cs * 0.58;
        const grd = ca.createLinearGradient(wx, wy, wx + ww, wy + wh);
        grd.addColorStop(0, '#a9c3d8'); grd.addColorStop(0.55, '#6f88a3'); grd.addColorStop(1, '#5a6f88');
        ca.fillStyle = grd; ca.fillRect(wx, wy, ww, wh);
        ca.fillStyle = '#fbf7f0'; ca.fillRect(wx - cs * 0.03, wy + wh, ww + cs * 0.06, cs * 0.06); // sill
        ca.fillStyle = 'rgba(255,255,255,0.35)'; ca.fillRect(wx + ww * 0.48, wy, cs * 0.04, wh); // mullion
        if (r() < 0.46) {
          const col = warm[Math.floor(r() * warm.length)]!;
          const g2 = cb.createLinearGradient(wx, wy, wx, wy + wh);
          g2.addColorStop(0, col); g2.addColorStop(1, r() < 0.5 ? '#b5722e' : col);
          cb.fillStyle = g2; cb.fillRect(wx, wy, ww, wh);
        } else if (r() < 0.18) {
          cb.fillStyle = '#3a2c40'; cb.fillRect(wx, wy, ww, wh); // dim TV glow
        }
      } else {
        const wy = y + cs * 0.14, wh = cs * 0.64;
        const grd = ca.createLinearGradient(x, wy, x + cs, wy + wh);
        grd.addColorStop(0, '#b4cde0'); grd.addColorStop(0.5, '#7d97b2'); grd.addColorStop(1, '#647d98');
        ca.fillStyle = grd; ca.fillRect(x, wy, cs, wh);
        ca.fillStyle = 'rgba(255,255,255,0.55)'; ca.fillRect(x, wy, cs * 0.05, wh); // mullion at bay edge
        ca.fillStyle = '#ece6dd'; ca.fillRect(x, y + cs * 0.82, cs, cs * 0.18);      // spandrel band
        if (i === cells / 2 || r() < 0.45) runLit = r() < 0.42;                      // lit runs (open-plan floors)
        if (runLit) {
          const g3 = cb.createLinearGradient(x, wy, x, wy + wh);
          const c0 = r() < 0.8 ? '#e9c98f' : '#b9cde6';
          g3.addColorStop(0, c0); g3.addColorStop(1, '#7a5a34');
          cb.fillStyle = g3; cb.fillRect(x + cs * 0.05, wy, cs * 0.95, wh);
        }
      }
    }
  }
  const map = new THREE.CanvasTexture(a), emissive = new THREE.CanvasTexture(b);
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  }
  return { map, emissive };
}

/* ------------------------------------------------------------ builders */
function groundMin(x: number, z: number, hx: number, hz: number): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
    const h = hAt(x + dx * hx, z + dz * hz);
    if (h < min) min = h; if (h > max) max = h;
  }
  return { min, max };
}

interface RoofInfo { y: number; hx: number; hz: number }

function addBuilding(f: Writer, p: Writer, lot: DistrictLot, high: boolean, bare = false): RoofInfo | null {
  const rnd = (() => { let s = Math.floor(lot.seed * 2147483646) + 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const hx = lot.sx / 2, hz = lot.sz / 2;
  const { min, max } = groundMin(lot.x, lot.z, hx, hz);
  const base = min - 0.8;
  const wall = WALLS[Math.floor(rnd() * WALLS.length)]!;
  const trim = TRIMS[Math.floor(rnd() * TRIMS.length)]!;
  const roof = ROOFS[Math.floor(rnd() * ROOFS.length)]!;
  const uOff = Math.floor(rnd() * 16), vOff = Math.floor(rnd() * 16);
  const store = high ? max + STORE_H : max + 0.2;
  const floors = Math.max(2, Math.round((lot.height - (store - max)) / FLOOR_H));
  const towerSplit = lot.style === 'tower' && high ? Math.round(floors * (0.62 + rnd() * 0.12)) : floors;
  const rs = rnd();
  const office = lot.style === 'tower' ? rs < 0.7 : lot.style === 'mid' ? rs < 0.3 : false;
  const styleBase = office ? CELLS / 2 : 0;
  // Per-building night occupancy (multiplies the window emissive map in the facade shader).
  const litK: RGB = [office ? 0.45 + rnd() * 0.4 : 0.7 + rnd() * 0.45, 0, 0];

  // Storefront band (high) or plain plinth (low)
  if (high) {
    p.box(lot.x - hx, base, lot.z - hz, lot.x + hx, store, lot.z + hz, mul(wall, 0.9), BLACK, false);
    // shop windows per bay on every side, just proud of the wall (glow warm at night)
    const ring: Array<[number, number]> = [[lot.x - hx, lot.z + hz], [lot.x + hx, lot.z + hz], [lot.x + hx, lot.z - hz], [lot.x - hx, lot.z - hz], [lot.x - hx, lot.z + hz]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = ring[i]!, [bx, bz] = ring[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az), nb = Math.max(1, Math.round(len / lot.bayW));
      const ox = -(bz - az) / len * 0.06, oz = (bx - ax) / len * 0.06;
      const y0 = max + 0.35, y1 = store - 1.15;
      for (let k = 0; k < nb; k++) {
        const t0 = (k + 0.14) / nb, t1 = (k + 0.86) / nb;
        const x0 = ax + (bx - ax) * t0 + ox, z0 = az + (bz - az) * t0 + oz, x1 = ax + (bx - ax) * t1 + ox, z1 = az + (bz - az) * t1 + oz;
        p.poly([[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], SHOP_GLASS, rnd() < 0.8 ? SHOP_GLOW : BLACK);
      }
    }
    // awning strip + band above shops
    const aw = AWNINGS[Math.floor(rnd() * AWNINGS.length)]!;
    p.box(lot.x - hx - 0.7, store - 0.95, lot.z - hz - 0.7, lot.x + hx + 0.7, store - 0.55, lot.z + hz + 0.7, aw);
    p.box(lot.x - hx - 0.08, store - 0.55, lot.z - hz - 0.08, lot.x + hx + 0.08, store + 0.1, lot.z + hz + 0.08, trim);
  } else {
    p.box(lot.x - hx, base, lot.z - hz, lot.x + hx, store, lot.z + hz, mul(wall, 0.8), BLACK, false);
  }

  // Facade shaft(s)
  const facade = (x0: number, z0: number, x1: number, z1: number, y0: number, nF: number, face0: number) => {
    const y1 = y0 + nF * FLOOR_H;
    const ring: Array<[number, number]> = [[x0, z1], [x1, z1], [x1, z0], [x0, z0], [x0, z1]];
    const cb = mul(wall, 0.84), ct = wall;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = ring[i]!, [bx, bz] = ring[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      const span = Math.round(len / lot.bayW);
      const start = (uOff + (face0 + i) * 3) % Math.max(1, CELLS / 2 - span + 1);
      const u0 = (styleBase + start) / CELLS, u1 = u0 + span / CELLS;
      const v0 = (vOff + (y0 - store) / FLOOR_H) / CELLS, v1 = v0 + nF / CELLS;
      f.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [cb, cb, ct, ct], litK, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
    return y1;
  };
  let top = facade(lot.x - hx, lot.z - hz, lot.x + hx, lot.z + hz, store, towerSplit, 0);
  let thx = hx, thz = hz;
  if (towerSplit < floors) {
    // setback ledge + upper shaft
    const lx0 = lot.x - hx - 0.35, lx1 = lot.x + hx + 0.35, lz0 = lot.z - hz - 0.35, lz1 = lot.z + hz + 0.35, ly = top + 0.6;
    p.box(lx0, top, lz0, lx1, ly, lz1, trim, BLACK, false);
    p.poly([[lx0, ly, lz1], [lx1, ly, lz1], [lx1, ly, lz0], [lx0, ly, lz0]], roof); // ledge roof
    const shrink = 0.7 + rnd() * 0.1;
    thx = Math.max(lot.bayW, Math.round((hx * shrink * 2) / lot.bayW) * lot.bayW / 2);
    thz = Math.max(lot.bayW, Math.round((hz * shrink * 2) / lot.bayW) * lot.bayW / 2);
    top = facade(lot.x - thx, lot.z - thz, lot.x + thx, lot.z + thz, top + 0.6, floors - towerSplit, 7);
  }

  // Cozy low-rises (high quality): pitched roof like the neighborhood houses
  if (high && lot.style === 'low' && rnd() < 0.5) {
    p.box(lot.x - thx - 0.15, top, lot.z - thz - 0.15, lot.x + thx + 0.15, top + 0.45, lot.z + thz + 0.15, trim);
    const gr = GABLE_ROOFS[Math.floor(rnd() * GABLE_ROOFS.length)]!;
    p.gable(lot.x - thx, lot.z - thz, lot.x + thx, lot.z + thz, top + 0.45, Math.min(5.5, thz * 0.75), gr, wall);
    if (rnd() < 0.6) { // chimney
      const cx = lot.x + (rnd() - 0.5) * thx, cz = lot.z + thz * 0.35;
      p.box(cx - 0.45, top + 0.45, cz - 0.45, cx + 0.45, top + 0.45 + Math.min(5.5, thz * 0.75) + 0.9, cz + 0.45, lin('#9b5e4a'));
    }
    return null;
  }

  // Cornice + roof cap
  const ov = high ? 0.45 : 0.25;
  p.box(lot.x - thx - ov, top, lot.z - thz - ov, lot.x + thx + ov, top + 0.8, lot.z + thz + ov, trim);
  p.box(lot.x - thx + 0.3, top + 0.8, lot.z - thz + 0.3, lot.x + thx - 0.3, top + 0.9, lot.z + thz - 0.3, roof);
  if (!high) return null;

  const roofY = top + 0.9;
  if (bare) return { y: roofY, hx: thx, hz: thz };
  if (lot.style === 'tower') {
    const kind = rnd();
    if (kind < 0.4) {
      // glowing crown band + spire
      const neon = lin(NEON[Math.floor(rnd() * NEON.length)]!);
      p.box(lot.x - thx + 0.6, roofY, lot.z - thz + 0.6, lot.x + thx - 0.6, roofY + 1.6, lot.z + thz - 0.6, mul(neon, 0.75), mul(neon, 1.6), false);
      p.box(lot.x - thx + 0.6, roofY + 1.6, lot.z - thz + 0.6, lot.x + thx - 0.6, roofY + 1.9, lot.z + thz - 0.6, trim);
      p.pyramid(lot.x, roofY + 1.9, lot.z, thx - 0.6, thz - 0.6, 3 + rnd() * 5, roof);
    } else {
      // mechanical box + antenna with beacon
      p.box(lot.x - thx * 0.5, roofY, lot.z - thz * 0.45, lot.x + thx * 0.5, roofY + 2.6, lot.z + thz * 0.45, trim);
      const ah = 6 + rnd() * 9;
      p.box(lot.x - 0.18, roofY + 2.6, lot.z - 0.18, lot.x + 0.18, roofY + 2.6 + ah, lot.z + 0.18, POLE);
      p.box(lot.x - 0.4, roofY + 2.6 + ah, lot.z - 0.4, lot.x + 0.4, roofY + 3.3 + ah, lot.z + 0.4, BEACON, BEACON_GLOW);
    }
  } else if (lot.style === 'mid' && rnd() < 0.6) {
    // water tower on legs
    const wx = lot.x + (rnd() - 0.5) * (hx - 2), wz = lot.z + (rnd() - 0.5) * (hz - 2);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      p.box(wx + dx * 0.9 - 0.1, roofY, wz + dz * 0.9 - 0.1, wx + dx * 0.9 + 0.1, roofY + 1.8, wz + dz * 0.9 + 0.1, POLE);
    }
    const tank = lin('#a77b5a');
    p.box(wx - 1.1, roofY + 1.8, wz - 1.1, wx + 1.1, roofY + 4.2, wz + 1.1, tank);
    p.pyramid(wx, roofY + 4.2, wz, 1.25, 1.25, 1.2, lin('#6d5a4e'));
  } else if (rnd() < 0.45) {
    // cozy rooftop garden: lawn + a few little trees
    const ix = Math.max(0.6, hx - 1.0), iz = Math.max(0.6, hz - 1.0);
    p.box(lot.x - ix, roofY, lot.z - iz, lot.x + ix, roofY + 0.35, lot.z + iz, lin('#86b862'));
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const tx = lot.x + (rnd() - 0.5) * (ix * 1.4), tz = lot.z + (rnd() - 0.5) * (iz * 1.4);
      addTree(p, tx, roofY + 0.35, tz, 0.55 + rnd() * 0.35, rnd() < 0.2 ? BLOSSOM : LEAVES[Math.floor(rnd() * LEAVES.length)]!);
    }
  } else {
    // AC units / roof hatch
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const ax = lot.x + (rnd() - 0.5) * (hx * 1.2), az = lot.z + (rnd() - 0.5) * (hz * 1.2);
      p.box(ax - 0.8, roofY, az - 0.6, ax + 0.8, roofY + 1.0, az + 0.6, lin('#c9c6c0'));
    }
  }
  // Neon blade sign on some low/mid buildings (faces +z / south toward the town, or +x)
  if (lot.style !== 'tower' && rnd() < 0.45) {
    const neon = lin(NEON[Math.floor(rnd() * NEON.length)]!);
    const towardTown = lot.z < 0 ? 1 : -1; // put it on the facade facing the neighborhood
    const sz = lot.z + towardTown * (hz + 0.1);
    const sx = lot.x + (rnd() - 0.5) * (hx * 1.2);
    const y0 = store + 0.6, y1 = y0 + Math.min(6, (top - store) * 0.6);
    p.box(sx - 0.18, y0, sz - (towardTown > 0 ? 0 : 1.3), sx + 0.18, y1, sz + (towardTown > 0 ? 1.3 : 0), mul(neon, 0.8), mul(neon, 1.9));
  }
  return null;
}

/* ------------------------------------------------------------ rooftop sign */
const SIGN_W = 17, SIGN_H = 4.2;
function signTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const c = cv.getContext('2d')!;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  };
  c.fillStyle = '#21183a'; rr(0, 0, 1024, 256, 46); c.fill();
  c.lineWidth = 10; c.strokeStyle = '#5fe3ff'; c.shadowColor = '#5fe3ff'; c.shadowBlur = 18; rr(14, 14, 996, 228, 36); c.stroke();
  c.font = 'bold 148px ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = '#ff6fae'; c.shadowBlur = 34; c.fillStyle = '#ffd6ea';
  c.fillText('HELLO WORLD', 512, 136, 900);
  c.shadowBlur = 0; c.fillStyle = '#ffeef6'; c.fillText('HELLO WORLD', 512, 136, 900);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** The landmark lot for the sign: a mid-rise just behind the portal, facing the neighborhood. */
function pickSignLot(lots: DistrictLot[]): DistrictLot | null {
  let best: DistrictLot | null = null, score = Infinity;
  for (const l of lots) {
    if (l.style !== 'mid' || l.z > -50 || l.sx < 9) continue;
    const sc = Math.abs(l.x) * 1.4 + Math.abs(l.z + 62);
    if (sc < score) { score = sc; best = l; }
  }
  return best;
}

function addStreet(p: Writer, s: (typeof DISTRICT_STREETS)[number], high: boolean) {
  const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
  const ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len;
  const nx = -uz, nz = ux;
  const half = s.width / 2, road = half - 1.7;
  const step = 3;
  const strip = (o0: number, o1: number, lift: number, col: RGB, from = 0, to = len) => {
    for (let d = from; d < to - 1e-3; d += step) {
      const e = Math.min(to, d + step);
      const P = (along: number, off: number) => {
        const x = s.ax + ux * along + nx * off, z = s.az + uz * along + nz * off;
        return [x, hAt(x, z) + lift, z];
      };
      // CCW from above: order a(o0,d) → b(o0,e) → c(o1,e) → d(o1,d) depends on n orientation; fix via normal check
      const q = [P(d, o1), P(e, o1), P(e, o0), P(d, o0)];
      const e1 = [q[1]![0]! - q[0]![0]!, q[1]![2]! - q[0]![2]!], e2 = [q[2]![0]! - q[0]![0]!, q[2]![2]! - q[0]![2]!];
      const upY = e1[1]! * e2[0]! - e1[0]! * e2[1]!; // y of cross product
      p.poly(upY > 0 ? q : [q[3]!, q[2]!, q[1]!, q[0]!], col);
    }
  };
  strip(-road, road, 0.14, ASPHALT);
  strip(-half, -road, 0.26, SIDEWALK); strip(road, half, 0.26, SIDEWALK);
  if (high) {
    strip(-road - 0.25, -road, 0.3, CURB); strip(road, road + 0.25, 0.3, CURB);
    for (let d = 2; d < len - 3; d += 7) strip(-0.12, 0.12, 0.17, DASH, d, d + 3.2);
  }
}

function addLamp(p: Writer, x: number, z: number, dx: number, dz: number, high: boolean) {
  const y = hAt(x, z) + 0.26;
  const H = 5.2;
  p.box(x - 0.11, y, z - 0.11, x + 0.11, y + H, z + 0.11, POLE);
  const hx = x + dx * 1.1, hz = z + dz * 1.1;
  p.box(Math.min(x, hx) - 0.07, y + H - 0.12, Math.min(z, hz) - 0.07, Math.max(x, hx) + 0.07, y + H, Math.max(z, hz) + 0.07, POLE);
  p.box(hx - 0.3, y + H - 0.55, hz - 0.3, hx + 0.3, y + H - 0.1, hz + 0.3, LAMP_HEAD, LAMP_GLOW);
  if (!high) return;
  // light pool on the street: octagon fan, warm centre → black rim (invisible by day)
  const cx = x + dx * 2.5, cz = z + dz * 2.5, R = 3.0, N = 10;
  const cy = hAt(cx, cz) + 0.2;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * R, z0 = cz + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R, z1 = cz + Math.sin(a1) * R;
    p.poly([[cx, cy, cz], [x1, hAt(x1, z1) + 0.2, z1], [x0, hAt(x0, z0) + 0.2, z0]], [ASPHALT, ASPHALT, ASPHALT], [POOL_GLOW, BLACK, BLACK]);
  }
}

/* ------------------------------------------------------------ public */
export interface DistrictBuild {
  facade: THREE.BufferGeometry;
  plain: THREE.BufferGeometry;
  facadeMat: THREE.MeshStandardMaterial;
  plainMat: THREE.MeshStandardMaterial;
  /** Shared emissive driver for `plainMat` (0 day … 1 night). */
  night: { value: number };
  buildingCount: number;
  /** Rooftop "HELLO WORLD" sign (high quality only); colour scaled by the night factor. */
  sign: { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial; position: [number, number, number] } | null;
  dispose(): void;
}

export function buildDistrict(quality: 'low' | 'high', heightAt: (x: number, z: number) => number = () => 0): DistrictBuild {
  const high = quality === 'high';
  hAt = heightAt;
  const f = new Writer(true, true), p = new Writer(false, true);
  const lots = planDistrict(quality);
  const signLot = high ? pickSignLot(lots) : null;
  let sign: DistrictBuild['sign'] = null;
  for (const lot of lots) {
    const roof = addBuilding(f, p, lot, high, lot === signLot);
    if (lot === signLot && roof) {
      // two posts + a back frame in the plain mesh; the sign face is its own (unlit) mesh
      const zf = lot.z + roof.hz - 1.2, y0 = roof.y + 1.4;
      for (const dx of [-SIGN_W * 0.32, SIGN_W * 0.32]) p.box(lot.x + dx - 0.2, roof.y, zf - 0.6, lot.x + dx + 0.2, y0 + SIGN_H * 0.6, zf - 0.2, POLE);
      p.box(lot.x - SIGN_W / 2 - 0.25, y0 - 0.25, zf - 0.2, lot.x + SIGN_W / 2 + 0.25, y0 + SIGN_H + 0.25, zf - 0.02, lin('#2b2440'));
      const tex = signTexture();
      const material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      sign = { geometry: new THREE.PlaneGeometry(SIGN_W, SIGN_H), material, position: [lot.x, y0 + SIGN_H / 2, zf + 0.01] };
    }
  }
  for (const s of DISTRICT_STREETS) addStreet(p, s, high);
  for (const l of planLamps(quality)) addLamp(p, l.x, l.z, l.dx, l.dz, high);
  if (high) {
    let k = 0;
    for (const t of planStreetTrees()) {
      k++;
      addTree(p, t.x, hAt(t.x, t.z) + 0.26, t.z, 0.85 + ((k * 37) % 10) / 25, k % 9 === 0 ? BLOSSOM : LEAVES[k % LEAVES.length]!);
    }
  }

  const tex = windowTextures(high ? 512 : 256);
  const facadeMat = new THREE.MeshStandardMaterial({
    map: tex.map, emissiveMap: tex.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    vertexColors: true, roughness: 0.82, metalness: 0,
  });
  const night = { value: 0 };
  const patch = (mat: THREE.MeshStandardMaterial, key: string, emissiveGlsl: string) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = night;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emissiveGlsl);
    };
    mat.customProgramCacheKey = () => key;
  };
  // facade: aGlow.x = per-building occupancy; faint wall bounce at night keeps silhouettes readable
  patch(facadeMat, 'hw-district-facade', 'totalEmissiveRadiance *= vGlow.x;\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.06;');
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  // plain: aGlow = per-vertex emissive colour (shop windows, lamps, neon, beacons, light pools)
  patch(plainMat, 'hw-district-plain', 'totalEmissiveRadiance += vGlow * uNight;');

  const facade = f.geometry(), plain = p.geometry();
  hAt = () => 0;
  return {
    facade, plain, facadeMat, plainMat, night, buildingCount: lots.length, sign,
    dispose() {
      facade.dispose(); plain.dispose(); facadeMat.dispose(); plainMat.dispose(); tex.map.dispose(); tex.emissive.dispose();
      if (sign) { sign.geometry.dispose(); sign.material.map?.dispose(); sign.material.dispose(); }
    },
  };
}
