/**
 * Low-level geometry toolkit for the procedural "Townie" avatars.
 *  - `sweep`: smooth tube through super-elliptic rings (limbs, torso, garments)
 *  - `grid`: parametric (u, v) surface (head, hair caps, hats)
 *  - `GeoBuilder`: accumulates many pieces into ONE geometry per material
 *    (optionally with skin weights), so a whole avatar is a handful of draw calls.
 * Everything here is pure three.js math (no DOM), so it also runs in Node.
 */
import * as THREE from 'three';

export type V3 = [number, number, number];
export interface SkinW { i: [number, number, number, number]; w: [number, number, number, number] }
export type WeightFn = (x: number, y: number, z: number, out: SkinW) => void;
export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => V3;

const WHITE: V3 = [1, 1, 1];

interface Bucket { pos: number[]; nrm: number[]; col: number[]; si: number[]; sw: number[]; idx: number[] }

export interface AddOpts {
  matrix?: THREE.Matrix4;
  /** Rigid binding to one bone index (skinned builders). */
  bone?: number;
  weights?: WeightFn;
  color?: V3 | ColorFn;
}

export class GeoBuilder {
  private buckets = new Map<string, Bucket>();
  constructor(readonly skinned: boolean) {}

  add(mat: string, geo: THREE.BufferGeometry, o: AddOpts = {}): void {
    let b = this.buckets.get(mat);
    if (!b) { b = { pos: [], nrm: [], col: [], si: [], sw: [], idx: [] }; this.buckets.set(mat, b); }
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const m = o.matrix;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const base = b.pos.length / 3;
    const v = new THREE.Vector3(); const n = new THREE.Vector3();
    const sw: SkinW = { i: [0, 0, 0, 0], w: [1, 0, 0, 0] };
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k); if (m) v.applyMatrix4(m);
      n.fromBufferAttribute(nrm, k); if (nm) n.applyMatrix3(nm); n.normalize();
      b.pos.push(v.x, v.y, v.z); b.nrm.push(n.x, n.y, n.z);
      const c = typeof o.color === 'function' ? o.color(v.x, v.y, v.z, n.x, n.y, n.z) : (o.color ?? WHITE);
      b.col.push(c[0], c[1], c[2]);
      if (this.skinned) {
        if (o.weights) {
          sw.i[0] = sw.i[1] = sw.i[2] = sw.i[3] = 0; sw.w[0] = 1; sw.w[1] = sw.w[2] = sw.w[3] = 0;
          o.weights(v.x, v.y, v.z, sw);
        } else { sw.i[0] = o.bone ?? 0; sw.i[1] = sw.i[2] = sw.i[3] = 0; sw.w[0] = 1; sw.w[1] = sw.w[2] = sw.w[3] = 0; }
        b.si.push(sw.i[0], sw.i[1], sw.i[2], sw.i[3]); b.sw.push(sw.w[0], sw.w[1], sw.w[2], sw.w[3]);
      }
    }
    const flip = !!m && m.determinant() < 0;
    const start = b.idx.length;
    if (geo.index) { for (let k = 0; k < geo.index.count; k++) b.idx.push(base + geo.index.getX(k)); }
    else for (let k = 0; k < pos.count; k++) b.idx.push(base + k);
    if (flip) for (let k = start; k < b.idx.length; k += 3) { const t = b.idx[k + 1]!; b.idx[k + 1] = b.idx[k + 2]!; b.idx[k + 2] = t; }
  }

  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [mat, b] of this.buckets) {
      if (b.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      if (this.skinned) {
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
      }
      const count = b.pos.length / 3;
      g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      out.set(mat, g);
    }
    return out;
  }
}

// ---------------------------------------------------------------- math utils
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Signed power keeping sign: used for super-ellipses. */
export const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** Catmull-Rom style smooth interpolation over sorted keys [x, ...values]. */
export function interpKeys(keys: number[][], x: number, col: number): number {
  const n = keys.length;
  if (x <= keys[0]![0]!) return keys[0]![col]!;
  if (x >= keys[n - 1]![0]!) return keys[n - 1]![col]!;
  let i = 0; while (i < n - 2 && x > keys[i + 1]![0]!) i++;
  const k0 = keys[Math.max(0, i - 1)]!, k1 = keys[i]!, k2 = keys[i + 1]!, k3 = keys[Math.min(n - 1, i + 2)]!;
  const t = (x - k1[0]!) / (k2[0]! - k1[0]!);
  const p0 = k0[col]!, p1 = k1[col]!, p2 = k2[col]!, p3 = k3[col]!;
  // Centripetal-ish Catmull-Rom with tension clamp to avoid overshoot
  const m1 = (p2 - p0) * 0.5, m2 = (p3 - p1) * 0.5;
  const t2 = t * t, t3 = t2 * t;
  const v = (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
  const lo = Math.min(p1, p2), hi = Math.max(p1, p2), pad = (hi - lo) * 0.15;
  return clamp(v, lo - pad, hi + pad);
}

// ---------------------------------------------------------------- sweep
export interface Ring {
  /** centre */
  c: V3;
  /** half extent along `u` axis */
  a: number;
  /** half extent along `v` axis (front side) */
  b: number;
  /** half extent along -v (back side); defaults to b */
  bb?: number;
  /** super-ellipse exponent (2 = ellipse, >2 boxier) */
  n?: number;
}
export interface SweepOpts {
  /** cross-section axes; v is the "front" (theta = 0) */
  u: V3; v: V3;
  segs: number;
  /** close ends with a pole vertex at this point */
  startPole?: V3 | null;
  endPole?: V3 | null;
  /** partial sweep: theta range (radians, 0 = +v, +pi/2 = +u). Open surface. */
  theta0?: number; theta1?: number;
  /** radius multiplier per (theta, ring index) — pleats, ribbing */
  mod?: (theta: number, ring: number) => number;
}

/** Tube through rings. Normals are smooth; winding is outward. */
export function sweep(rings: Ring[], o: SweepOpts): THREE.BufferGeometry {
  const partial = o.theta0 !== undefined && o.theta1 !== undefined;
  const segs = o.segs;
  const cols = partial ? segs + 1 : segs;
  const pos: number[] = [];
  const u = o.u, v = o.v;
  for (let ri = 0; ri < rings.length; ri++) {
    const r = rings[ri]!;
    const n = r.n ?? 2, p = 2 / n;
    for (let j = 0; j < cols; j++) {
      const th = partial ? lerp(o.theta0!, o.theta1!, j / segs) : (j / segs) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      const mm = o.mod ? o.mod(th, ri) : 1;
      const ea = r.a * spow(s, p) * mm;
      const eb = (c >= 0 ? r.b : (r.bb ?? r.b)) * spow(c, p) * mm;
      pos.push(r.c[0] + u[0] * ea + v[0] * eb, r.c[1] + u[1] * ea + v[1] * eb, r.c[2] + u[2] * ea + v[2] * eb);
    }
  }
  const idx: number[] = [];
  // winding: tangent(theta=0) = u; axis = ring1 - ring0; outward(theta=0) = v
  const a0 = rings[0]!.c, a1 = rings[Math.min(1, rings.length - 1)]!.c;
  const ax: V3 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
  const cr: V3 = [u[1] * ax[2] - u[2] * ax[1], u[2] * ax[0] - u[0] * ax[2], u[0] * ax[1] - u[1] * ax[0]];
  const flip = cr[0] * v[0] + cr[1] * v[1] + cr[2] * v[2] < 0;
  const tri = (a: number, b: number, c: number) => { if (flip) idx.push(a, c, b); else idx.push(a, b, c); };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = partial ? j + 1 : (j + 1) % segs;
      const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j, d = (i + 1) * cols + j1;
      tri(a, b, c); tri(b, d, c);
    }
  }
  if (o.startPole && !partial) {
    const pi = pos.length / 3; pos.push(...o.startPole);
    for (let j = 0; j < segs; j++) tri(pi, (j + 1) % segs, j);
  }
  if (o.endPole && !partial) {
    const pi = pos.length / 3; pos.push(...o.endPole);
    const last = (rings.length - 1) * cols;
    for (let j = 0; j < segs; j++) tri(last + j, last + (j + 1) % segs, pi);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Hemispherical cap rings: from radius r at `t0` closing toward t0 + dir*r. Returns rings (excluding t0 ring) + pole. */
export function capRings(center: (t: number) => V3, t0: number, a: number, b: number, dir: 1 | -1, steps: number, n = 2, bb?: number): { rings: Ring[]; pole: V3 } {
  const rings: Ring[] = [];
  for (let k = 1; k < steps; k++) {
    const al = (k / steps) * Math.PI / 2;
    const t = t0 + dir * Math.max(a, b) * Math.sin(al) * 0.9;
    const s = Math.cos(al);
    rings.push({ c: center(t), a: a * s, b: b * s, bb: (bb ?? b) * s, n });
  }
  return { rings, pole: center(t0 + dir * Math.max(a, b) * 0.9) };
}

// ---------------------------------------------------------------- param grid
/**
 * Parametric surface grid. `fn(u, v)` with u in [0,1] around (wraps if `wrapU`),
 * v in [0,1] from top to bottom. Optional pole at v=0 (`poleTop`).
 */
export function grid(fn: (u: number, v: number) => V3, nu: number, nv: number, o: { wrapU?: boolean; poleTop?: V3 | null; center?: V3 } = {}): THREE.BufferGeometry {
  const wrap = o.wrapU ?? true;
  const cols = wrap ? nu : nu + 1;
  const pos: number[] = [];
  const v0 = o.poleTop ? 1 : 0;
  for (let i = v0; i <= nv; i++) {
    for (let j = 0; j < cols; j++) pos.push(...fn(j / nu, i / nv));
  }
  const rows = nv - v0 + 1;
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < nu; j++) {
      const j1 = wrap ? (j + 1) % nu : j + 1;
      const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j, d = (i + 1) * cols + j1;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (o.poleTop) {
    const pi = pos.length / 3; pos.push(...o.poleTop);
    for (let j = 0; j < nu; j++) { const j1 = wrap ? (j + 1) % nu : j + 1; if (j1 > cols - 1) continue; idx.push(pi, j, j1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (o.center) orientOutward(g, o.center);
  g.computeVertexNormals();
  return g;
}

/** Flip all triangles if the surface (on average) faces toward `center`. */
export function orientOutward(g: THREE.BufferGeometry, center: V3): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const ix = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  let s = 0;
  for (let k = 0; k < ix.count; k += 3) {
    a.fromBufferAttribute(p, ix.getX(k)); b.fromBufferAttribute(p, ix.getX(k + 1)); c.fromBufferAttribute(p, ix.getX(k + 2));
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(new THREE.Vector3(...center));
    s += n.dot(m);
  }
  if (s < 0) {
    const arr = ix.array as unknown as number[];
    for (let k = 0; k < ix.count; k += 3) { const t = arr[k + 1]!; arr[k + 1] = arr[k + 2]!; arr[k + 2] = t; }
    ix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- primitives
const _m = new THREE.Matrix4(); const _q = new THREE.Quaternion(); const _e = new THREE.Euler(); const _s = new THREE.Vector3(); const _p = new THREE.Vector3();
/** Compose a TRS matrix (euler XYZ radians). */
export function trs(p: V3, r: V3 = [0, 0, 0], s: V3 | number = 1): THREE.Matrix4 {
  _e.set(r[0], r[1], r[2]); _q.setFromEuler(_e);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p.set(p[0], p[1], p[2]), _q, _s);
}
/** Matrix aligning +Y to direction `dir`, positioned at p, with scale. */
export function alignY(p: V3, dir: V3, s: V3 | number = 1): THREE.Matrix4 {
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return _m.clone().compose(_p.set(p[0], p[1], p[2]), _q, _s);
}

const primCache = new Map<string, THREE.BufferGeometry>();
function prim(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = primCache.get(key);
  if (!g) {
    g = make();
    // keep only position/normal (builder input)
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    primCache.set(key, g);
  }
  return g;
}
export const sphereG = (ws = 16, hs = 12) => prim(`s${ws}.${hs}`, () => new THREE.SphereGeometry(1, ws, hs));
export const capsuleG = (r: number, len: number, cs = 4, rs = 10) => prim(`c${r}.${len}.${cs}.${rs}`, () => new THREE.CapsuleGeometry(r, len, cs, rs));
export const cylG = (rt: number, rb: number, h: number, rs = 12, open = false) => prim(`y${rt}.${rb}.${h}.${rs}.${open}`, () => new THREE.CylinderGeometry(rt, rb, h, rs, 1, open));
export const torusG = (r: number, t: number, rs = 8, ts = 24, arc = Math.PI * 2) => prim(`t${r}.${t}.${rs}.${ts}.${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
export const coneG = (r: number, h: number, rs = 10) => prim(`k${r}.${h}.${rs}`, () => new THREE.ConeGeometry(r, h, rs));
export function roundBoxG(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  // Rounded box from a sphere grid pushed to a box: smooth and cheap.
  return prim(`rb${w}.${h}.${d}.${r}.${seg}`, () => {
    const g = new THREE.SphereGeometry(1, 8 + seg * 4, 6 + seg * 3);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const hx = Math.max(0, w / 2 - r), hy = Math.max(0, h / 2 - r), hz = Math.max(0, d / 2 - r);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      p.setXYZ(i, x * r + Math.sign(x) * hx, y * r + Math.sign(y) * hy, z * r + Math.sign(z) * hz);
    }
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------- path tube
/**
 * Tube along a smooth path through control points. prof(s) -> [a (side), b (up/normal)] half extents.
 * `up(p, s)` gives the preferred "b" direction (e.g. head normal so locks lie flat on the head).
 */
export function pathTube(ctrl: V3[], prof: (s: number) => [number, number], segs: number, steps: number,
  o: { up?: (p: V3, s: number) => V3; n?: number; caps?: boolean } = {}): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  const pts = curve.getSpacedPoints(steps);
  const pos: number[] = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), U = new THREE.Vector3();
  let prevN: THREE.Vector3 | null = null;
  const nexp = 2 / (o.n ?? 2);
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const p = pts[i]!;
    T.copy(pts[Math.min(steps, i + 1)]!).sub(pts[Math.max(0, i - 1)]!).normalize();
    if (o.up) U.set(...o.up([p.x, p.y, p.z], s)); else if (prevN) U.copy(prevN); else U.set(0, 1, 0);
    if (Math.abs(U.dot(T)) > 0.98) U.set(1, 0, 0);
    B.crossVectors(T, U).normalize();
    N.crossVectors(B, T).normalize();
    prevN = N.clone();
    const [a, b] = prof(s);
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const sa = spow(Math.sin(th), nexp) * a, cb = spow(Math.cos(th), nexp) * b;
      pos.push(p.x + B.x * sa + N.x * cb, p.y + B.y * sa + N.y * cb, p.z + B.z * sa + N.z * cb);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < steps; i++) for (let j = 0; j < segs; j++) {
    const j1 = (j + 1) % segs;
    const a = i * segs + j, b = i * segs + j1, c = (i + 1) * segs + j, d = (i + 1) * segs + j1;
    idx.push(a, b, c, b, d, c);
  }
  if (o.caps !== false) {
    const p0 = pts[0]!, p1 = pts[steps]!;
    const t0 = pts[1]!.clone().sub(p0).normalize(), t1 = p1.clone().sub(pts[steps - 1]!).normalize();
    const s0 = pos.length / 3; pos.push(p0.x - t0.x * 0.002, p0.y - t0.y * 0.002, p0.z - t0.z * 0.002);
    for (let j = 0; j < segs; j++) idx.push(s0, (j + 1) % segs, j);
    const s1 = pos.length / 3; pos.push(p1.x + t1.x * 0.002, p1.y + t1.y * 0.002, p1.z + t1.z * 0.002);
    const last = steps * segs;
    for (let j = 0; j < segs; j++) idx.push(last + j, last + (j + 1) % segs, s1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
