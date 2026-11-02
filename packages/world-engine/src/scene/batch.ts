/**
 * Static geometry batching: crafted low-poly props are authored as many small
 * primitives, then merged into a few vertex-coloured meshes (a handful of draw
 * calls for the whole town). Also: deterministic RNG + canvas sign textures.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const tmpColor = new THREE.Color();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/** Compose a TRS matrix (rotation order YXZ: yaw first). */
export function mtx(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  tmpEuler.set(rx, ry, rz, 'YXZ');
  tmpQuat.setFromEuler(tmpEuler);
  return new THREE.Matrix4().compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(sx, sy, sz));
}

class FloatBuf {
  arr = new Float32Array(1 << 15);
  n = 0;
  ensure(extra: number) {
    if (this.n + extra <= this.arr.length) return;
    let cap = this.arr.length;
    while (cap < this.n + extra) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.arr.subarray(0, this.n));
    this.arr = next;
  }
  view(): Float32Array { return this.arr.slice(0, this.n); }
}

const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _n = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _c = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
const _nm = new THREE.Matrix3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _fn = new THREE.Vector3();

/**
 * Accumulates transformed, vertex-coloured triangles straight into typed arrays
 * (no per-part geometry clones / merges → fast town builds).
 */
export class Batch {
  private pos = new FloatBuf();
  private nor = new FloatBuf();
  private col = new FloatBuf();
  private parts = 0;
  /** Parts smaller than `smallRadius` (bounding radius, m) are routed to this batch instead. */
  smallTarget: Batch | null = null;
  smallRadius = 0;

  /** @param flat recompute normals per face (faceted low-poly look) */
  add(src: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix: THREE.Matrix4, flat = false): void {
    if (this.smallTarget && this.smallRadius > 0) {
      if (!src.boundingSphere) src.computeBoundingSphere();
      const r = (src.boundingSphere?.radius ?? 1) * matrix.getMaxScaleOnAxis();
      if (r < this.smallRadius) { this.smallTarget.add(src, color, matrix, flat); return; }
    }
    tmpColor.set(color);
    this.push(src, matrix, flat, null);
  }

  /** Add an already vertex-coloured geometry (keeps its colours). */
  addColored(src: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    this.push(src, matrix, false, src.attributes.color ?? null);
  }

  private push(src: THREE.BufferGeometry, matrix: THREE.Matrix4, flat: boolean, colors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null) {
    const P = src.attributes.position;
    if (!P) return;
    const N = flat ? undefined : src.attributes.normal;
    const idx = src.index;
    const count = idx ? idx.count : P.count;
    const tris = Math.floor(count / 3);
    _nm.getNormalMatrix(matrix);
    this.pos.ensure(tris * 9); this.nor.ensure(tris * 9); this.col.ensure(tris * 9);
    const pa = this.pos.arr, na = this.nor.arr, ca = this.col.arr;
    for (let t = 0; t < tris; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        _v[k]!.fromBufferAttribute(P, vi).applyMatrix4(matrix);
        if (N) _n[k]!.fromBufferAttribute(N, vi).applyMatrix3(_nm).normalize();
        if (colors) _c[k]!.fromBufferAttribute(colors, vi); else _c[k]!.copy(tmpColor);
      }
      if (!N) {
        _e1.subVectors(_v[1]!, _v[0]!); _e2.subVectors(_v[2]!, _v[0]!);
        _fn.crossVectors(_e1, _e2).normalize();
        _n[0]!.copy(_fn); _n[1]!.copy(_fn); _n[2]!.copy(_fn);
      }
      for (let k = 0; k < 3; k++) {
        const o = this.pos.n;
        pa[o] = _v[k]!.x; pa[o + 1] = _v[k]!.y; pa[o + 2] = _v[k]!.z;
        na[o] = _n[k]!.x; na[o + 1] = _n[k]!.y; na[o + 2] = _n[k]!.z;
        ca[o] = _c[k]!.r; ca[o + 1] = _c[k]!.g; ca[o + 2] = _c[k]!.b;
        this.pos.n += 3; this.nor.n += 3; this.col.n += 3;
      }
    }
    this.parts++;
  }

  get size(): number { return this.parts; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    if (!this.pos.n) return g;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.view(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.view(), 3));
    this.pos = new FloatBuf(); this.nor = new FloatBuf(); this.col = new FloatBuf(); this.parts = 0;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Cached primitive geometries for one build pass (dispose afterwards). */
export class Prims {
  private cache = new Map<string, THREE.BufferGeometry>();
  /** Low quality: chamfered (1-segment) rounded boxes everywhere. */
  constructor(readonly low = false) {}
  private get(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.cache.get(key);
    if (!g) { g = make(); this.cache.set(key, g); }
    return g;
  }
  /** Unit box (scale with the matrix). */
  box(): THREE.BufferGeometry { return this.get('box', () => new THREE.BoxGeometry(1, 1, 1)); }
  /** Real-size rounded box (bevel radius stays round). */
  rbox(w: number, h: number, d: number, r = 0.06): THREE.BufferGeometry {
    const k = `rb${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}_${r.toFixed(2)}`;
    const seg = this.low || Math.max(w, h, d) < 1.3 ? 1 : 2;
    return this.get(k, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
  }
  /** Unit cylinder radius 1 height 1. */
  cyl(seg = 10, open = false): THREE.BufferGeometry { return this.get(`cyl${seg}${open}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, open)); }
  /** Tapered unit cylinder (top radius ratio). */
  tcyl(top: number, seg = 8): THREE.BufferGeometry { return this.get(`tc${top}_${seg}`, () => new THREE.CylinderGeometry(top, 1, 1, seg)); }
  cone(seg = 8): THREE.BufferGeometry { return this.get(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)); }
  ico(detail = 0): THREE.BufferGeometry { return this.get(`ico${detail}`, () => new THREE.IcosahedronGeometry(1, detail)); }
  sphere(w = 10, h = 8): THREE.BufferGeometry { return this.get(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)); }
  /** Organic blob: jittered icosphere (consistent jitter per vertex position, no cracks). */
  blob(seed: number, amount = 0.18, detail = 1): THREE.BufferGeometry {
    return this.get(`blob${seed}_${amount}_${detail}`, () => {
      const g = new THREE.IcosahedronGeometry(1, detail);
      const p = g.attributes.position!;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const h = hash3(Math.round(x * 1000) + seed * 17, Math.round(y * 1000), Math.round(z * 1000));
        const s = 1 + (h - 0.5) * 2 * amount;
        p.setXYZ(i, x * s, y * s, z * s);
      }
      g.computeVertexNormals();
      return g;
    });
  }
  /** Triangular prism: triangle in the ZY plane (base `depth`, height 1), extruded along X by 1 (centred). */
  prism(): THREE.BufferGeometry {
    return this.get('prism', () => {
      const g = new THREE.BufferGeometry();
      const v = [
        // gable ends (x=+0.5 / x=-0.5), counter-clockwise from outside
        0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
        -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
        // slope +z
        0.5, 0, 0.5, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
        // slope -z
        -0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
      ];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      return g;
    });
  }
  dispose(): void { for (const g of this.cache.values()) g.dispose(); this.cache.clear(); }
}

export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise in [0,1]. */
export function noise2(x: number, z: number, seed = 0): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, zi, seed), b = hash3(xi + 1, zi, seed), c = hash3(xi, zi + 1, seed), d = hash3(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export interface SignStyle {
  text: string;
  width?: number;
  height?: number;
  bg?: string | null;
  fg: string;
  font?: string;
  border?: string;
  glow?: string;
  sub?: string;
}

/** Local canvas text texture (no font/network fetches). */
export function makeSignTexture(s: SignStyle): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = s.width ?? 512, h = s.height ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  if (s.bg) {
    ctx.fillStyle = s.bg;
    roundRect(ctx, 4, 4, w - 8, h - 8, h * 0.18);
    ctx.fill();
  }
  if (s.border) {
    ctx.strokeStyle = s.border; ctx.lineWidth = Math.max(4, h * 0.05);
    roundRect(ctx, 10, 10, w - 20, h - 20, h * 0.14);
    ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fontSize = Math.round(h * (s.sub ? 0.42 : 0.5));
  ctx.font = s.font ?? `700 ${fontSize}px "Trebuchet MS", "Segoe UI", "DejaVu Sans", system-ui, sans-serif`;
  if (s.glow) { ctx.shadowColor = s.glow; ctx.shadowBlur = h * 0.18; }
  ctx.fillStyle = s.fg;
  ctx.fillText(s.text, w / 2, s.sub ? h * 0.42 : h * 0.53, w - 40);
  if (s.glow) ctx.fillText(s.text, w / 2, s.sub ? h * 0.42 : h * 0.53, w - 40);
  if (s.sub) {
    ctx.shadowBlur = 0;
    ctx.font = `600 ${Math.round(h * 0.2)}px "Trebuchet MS", "Segoe UI", "DejaVu Sans", system-ui, sans-serif`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(s.sub, w / 2, h * 0.77, w - 40);
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
