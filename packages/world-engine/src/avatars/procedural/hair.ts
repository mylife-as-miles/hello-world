/**
 * 12 hair styles as distinct geometry, generated on the analytic head surface
 * (unit-head space). Caps carry baked strand grooves + depth shading.
 */
import * as THREE from 'three';
import { GeoBuilder, clamp, grid, lerp, pathTube, smooth, type V3 } from './geom';
import { HC, headNormal, headPoint } from './head';

type Lod = 'high' | 'low';

interface CapOpts {
  /** hairline elevation keys over |phi| (0 front .. pi back): [[absPhi, el], ...] */
  line: number[][];
  off: (phi: number, el: number, v: number) => number;
  grooves?: number;
  grooveDepth?: number;
  /** straight-hanging curtain below the widest ring (bob/long) */
  hang?: { from: number; flare: number };
  /** extend below the head: y (relative to head bone) per |phi| for curtain bottoms */
  bottomY?: (absPhi: number) => number | null;
  shadeLow?: number;
  /** soft clumps (curly/afro): amplitude + integer lobe frequencies */
  bumps?: number;
  lobe?: [number, number];
}

/** Smooth clump field in [0,1] (integer phi frequencies keep the back seam continuous). */
export function lobes(phi: number, el: number, kp: number, ke: number): number {
  const a = 0.5 + 0.5 * Math.sin(phi * kp + el * 2.3);
  const b = 0.5 + 0.5 * Math.sin(el * ke - phi * 2 + 1.3);
  const c = 0.5 + 0.5 * Math.sin(phi * (kp - 2) + el * (ke - 3) + 2.1);
  return Math.pow(a * b * 0.6 + c * 0.4, 0.8) * smooth(Math.PI / 2, 1.15, el);
}

function lineAt(keys: number[][], aphi: number): number {
  let i = 0; while (i < keys.length - 2 && aphi > keys[i + 1]![0]!) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const t = smooth(a[0]!, b[0]!, aphi);
  return lerp(a[1]!, b[1]!, t);
}

function capGeometry(o: CapOpts, lod: Lod): THREE.BufferGeometry {
  const nu = lod === 'high' ? 64 : 20, nv = lod === 'high' ? 26 : 8;
  return grid((u, v) => {
    const phi = -Math.PI + u * Math.PI * 2;
    const aphi = Math.abs(phi);
    const elMin = lineAt(o.line, aphi);
    const bottom = o.bottomY ? o.bottomY(aphi) : null;
    // v in [0,1]: crown -> hairline (or curtain bottom)
    const headPart = bottom === null ? 1 : 0.62;
    let p: V3;
    const groove = (o.grooves ?? 0) > 0 ? (0.5 + 0.5 * Math.cos(phi * o.grooves!)) : 0.5;
    const gd = (o.grooveDepth ?? 0.0025) * groove;
    if (v <= headPart) {
      const vv = v / headPart;
      const el = lerp(Math.PI / 2 - 0.001, elMin, Math.pow(vv, 0.95));
      let off = o.off(phi, el, vv) + gd * smooth(0, 0.25, vv);
      if (o.bumps) off += o.bumps * lobes(phi, el, o.lobe?.[0] ?? 9, o.lobe?.[1] ?? 9);
      // tuck the edge onto the scalp
      if (bottom === null) off *= lerp(1, 0.25, smooth(0.86, 1, vv));
      p = headPoint(phi, el, off);
      if (o.hang && el < o.hang.from) {
        const k = smooth(o.hang.from, o.hang.from - 0.5, el);
        const eq = headPoint(phi, o.hang.from, off);
        const fl = 1 + o.hang.flare * k;
        const hp: V3 = [HC[0] + (eq[0] - HC[0]) * fl, p[1], HC[2] + (eq[2] - HC[2]) * fl];
        p = [lerp(p[0], hp[0], k), p[1], lerp(p[2], hp[2], k)];
      }
    } else {
      // curtain below the head, continuing straight down from the hairline row
      const vv = (v - headPart) / (1 - headPart);
      const el = elMin;
      const off = o.off(phi, el, 1) + gd;
      const top = headPoint(phi, el, off);
      const k = 1;
      const eq = headPoint(phi, o.hang ? o.hang.from : el, off);
      const fl = 1 + (o.hang?.flare ?? 0) * k + 0.08 * vv;
      const x = HC[0] + (eq[0] - HC[0]) * fl, z = HC[2] + (eq[2] - HC[2]) * fl;
      const y = lerp(top[1], bottom!, vv);
      const tuck = smooth(0.85, 1, vv) * 0.25;
      p = [lerp(x, HC[0] + (x - HC[0]) * 0.85, tuck), y, lerp(z, HC[2] + (z - HC[2]) * 0.85, tuck)];
    }
    return p;
  }, nu, nv, { poleTop: headPoint(0, Math.PI / 2, o.off(0, Math.PI / 2, 0)), center: HC });
}

function hairShade(lowEl = -0.6, depth = 0.25, grooves = 0) {
  return (x: number, y: number, z: number): V3 => {
    const el = Math.atan2(y - HC[1], Math.hypot(x - HC[0], z - HC[2]));
    let s = 1 - depth + depth * smooth(lowEl, 1.1, el);
    if (grooves) { const ph = Math.atan2(x - HC[0], z - HC[2]); s *= 0.87 + 0.13 * (0.5 + 0.5 * Math.cos(ph * grooves)) * (1 - smooth(1.0, 1.45, el)) + 0.13 * smooth(1.0, 1.45, el); }
    return [s, s, s];
  };
}

/**
 * Approximate outward offset (m, unit head) of a hair style's surface at (phi, el):
 * accessories (headphones, flower, crown, hats) sit on top of it instead of vanishing inside.
 */
export function hairOffset(style: string, phi: number, el: number, hat: boolean): number {
  const top = smooth(-0.2, 1.2, el);
  const below = (line: number[][]) => el < lineAt(line, Math.abs(phi)) - 0.05;
  switch (style) {
    case 'bald': return 0;
    case 'buzz': return below(STD_LINE) ? 0 : 0.004;
    case 'mohawk': return (!hat && Math.abs(Math.sin(phi)) < 0.2 && el > 0.3) ? 0.075 : 0.004;
    case 'short': return below(STD_LINE) ? 0 : 0.016 + (hat ? 0.004 : 0.016) * top;
    case 'bob': return 0.02 + 0.012 * top + (el < 0 ? 0.03 : 0);
    case 'long': return 0.02 + 0.01 * top + (el < 0 ? 0.035 : 0);
    case 'ponytail': case 'bun': case 'braids': return below(SLEEK_LINE) ? 0 : 0.012 + 0.006 * top;
    case 'curly': return below(STD_LINE) ? 0 : 0.026 + (hat ? 0 : 0.012 + 0.018) * top;
    case 'afro': { const o = afroOffset(phi, el, hat, true); return o > 0 ? o + (hat ? 0.006 : 0.004) : 0; }
    case 'spiky': return below(STD_LINE) ? 0 : 0.016 + 0.006 * top;
    default: return 0.02;
  }
}

/** Lock of hair lying on the head: control points given as [phi, el, off]. */
function lock(ctrl: Array<[number, number, number]>, w0: number, w1: number, th: number, lod: Lod): THREE.BufferGeometry {
  const pts = ctrl.map(([p, e, o]) => headPoint(p, e, o));
  return pathTube(pts, (s) => { const w = lerp(w0, w1, Math.pow(s, 0.8)) * (s < 0.15 ? 0.55 + s * 3 : 1); return [w, th * (1 - s * 0.6)]; },
    lod === 'high' ? 8 : 5, lod === 'high' ? 10 : 4, { up: (p) => { const d = [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]]; return [d[0]!, d[1]!, d[2]!]; } });
}

function sphereAt(b: GeoBuilder, mat: string, p: V3, r: number | V3, lod: Lod, color?: V3 | ((x: number, y: number, z: number) => V3)): void {
  const g = new THREE.SphereGeometry(1, lod === 'high' ? 12 : 6, lod === 'high' ? 9 : 4); g.deleteAttribute('uv');
  const s = typeof r === 'number' ? [r, r, r] as V3 : r;
  b.add(mat, g, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(...s)), color });
}

// ---------------------------------------------------------------- afro
/**
 * Afro: a volumetric, clustered-coil silhouette instead of a smooth dome.
 *  - envelope: round and full (crown + upper sides), offset along the head normal;
 *  - curl clusters: a max-of-round-caps field over ~46 jittered puffs (+ ~150 small coils at high detail) gives lumpy
 *    "cauliflower" clusters with creases between them, so the outline is irregular from every angle;
 *  - the volume rolls back onto the scalp at a slightly irregular, rounded hairline (no thin shell edge);
 *  - under a hat the top compresses below the crown of the hat and the clusters puff out beneath its edge.
 * Vertex colours bake crease occlusion (darker between clusters) + a fine grain; the 'hairCoil' slot is matte.
 * Budget: high/mid ~6.3k tris, low ~0.6k tris (one baked mesh with the rest of the avatar).
 */
/** Afro hairline [absPhi, el]: rounded forehead, soft temples, sideburns, nape. */
const AFRO_LINE = [[0, 0.53], [0.32, 0.5], [0.7, 0.4], [1.12, 0.04], [1.38, -0.24], [1.75, -0.36], [2.5, -0.58], [Math.PI, -0.68]];
const AFRO_TOP = Math.PI / 2 - 0.001;
const AFRO_VPOW = 0.85;
/** Lowest hat edge (beanie, see accessories.ts `dome(0.36, -0.42)`): the afro compresses above it. */
function hatEdge(aphi: number): number {
  return aphi < 1.2 ? lerp(0.36, 0.18, smooth(0, 1.2, aphi)) : lerp(0.18, -0.42, smooth(1.2, Math.PI, aphi));
}
const hash01 = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
interface Puff { x: number; y: number; z: number; r2: number; h: number }
const puffSets = new Map<string, Puff[]>();
/** Deterministic curl clusters on the unit sphere: Fibonacci layout + hash jitter in position, radius and height. */
function puffSet(n: number, r0: number, r1: number, h0: number, h1: number, seed: number): Puff[] {
  const key = `${n}|${seed}`;
  let out = puffSets.get(key);
  if (out) return out;
  out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y0 = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const th = ga * i + (hash01(i * 3 + seed) - 0.5) * 0.9;
    let x = Math.cos(th) * rr, y = y0 + (hash01(i * 3 + 1 + seed) - 0.5) * 0.14, z = Math.sin(th) * rr;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    if (y < -0.8) continue;
    const r = lerp(r0, r1, hash01(i * 3 + 2 + seed));
    out.push({ x, y, z, r2: r * r, h: lerp(h0, h1, hash01(i * 7 + 11 + seed)) });
  }
  puffSets.set(key, out);
  return out;
}
const AFRO_BIG_H = 0.021, AFRO_SMALL_H = 0.0065;
const afroBig = () => puffSet(46, 0.34, 0.5, 0.011, AFRO_BIG_H, 7);
const afroSmall = () => puffSet(150, 0.14, 0.21, 0.0035, AFRO_SMALL_H, 101);
/** Max-of-round-caps field (m): rounded clusters with creases where they meet. */
function puffField(list: Puff[], dx: number, dy: number, dz: number): number {
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const ex = dx - p.x, ey = dy - p.y, ez = dz - p.z;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= p.r2) continue;
    const v = p.h * Math.sqrt(1 - d2 / p.r2);
    if (v > best) best = v;
  }
  return best;
}
/** Afro hairline elevation at azimuth phi (slightly irregular along the front). */
function afroLine(phi: number): number {
  const aphi = Math.abs(phi);
  return lineAt(AFRO_LINE, aphi) + 0.016 * Math.sin(phi * 11 + 0.6) * (1 - smooth(1.1, 1.9, aphi));
}
interface AfroSample { off: number; big: number; small: number }
const _afro: AfroSample = { off: 0, big: 0, small: 0 };
/** Afro surface offset (m, unit head, along the head normal) incl. the rounded roll onto the hairline. */
function afroSample(phi: number, el: number, hat: boolean, fine: boolean, out: AfroSample = _afro): AfroSample {
  const elMin = afroLine(phi);
  if (el < elMin - 0.005) { out.off = 0; out.big = 0; out.small = 0; return out; }
  const ce = Math.cos(el);
  const dx = Math.sin(phi) * ce, dy = Math.sin(el), dz = Math.cos(phi) * ce;
  // envelope: full crown, rounder upper sides, a gentle asymmetric wobble
  let off = 0.044 + 0.03 * smooth(-0.45, 0.85, el)
    + 0.005 * Math.abs(Math.sin(phi)) * smooth(-0.7, 0.2, el) * (1 - smooth(0.2, 1.0, el))
    + 0.004 * Math.sin(phi * 2 + 0.7) * Math.cos(el * 1.5);
  const big = puffField(afroBig(), dx, dy, dz);
  const small = fine ? puffField(afroSmall(), dx, dy, dz) : 0;
  off += big + small;
  if (hat) {
    // compressed under the crown of the hat, clusters puff out beneath its edge
    const he = hatEdge(Math.abs(phi));
    off = lerp(0.017 + small * 0.4, off * 0.9, smooth(he + 0.02, he - 0.18, el));
  }
  // roll the volume back onto the scalp over the lower part of the cap (cosine taper: a round ball tucking in toward
  // the hairline, not a ledge over the ears)
  const v = Math.pow(clamp((AFRO_TOP - el) / Math.max(0.05, AFRO_TOP - elMin), 0, 1), 1 / AFRO_VPOW);
  // (under a hat the hair is pushed out below the brim: a later, bulgier quarter-ellipse roll)
  const e = smooth(hat ? 0.72 : 0.55, 1, v);
  off *= 0.06 + 0.94 * (hat ? Math.sqrt(Math.max(0, 1 - e * e)) : Math.cos(e * Math.PI / 2));
  out.off = off; out.big = big; out.small = small;
  return out;
}
/** Afro outer surface offset at (phi, el): accessories sit on it. */
export function afroOffset(phi: number, el: number, hat: boolean, fine = true): number {
  return afroSample(phi, el, hat, fine).off;
}

function afroGeometry(lod: Lod, hat: boolean): THREE.BufferGeometry {
  const hi = lod === 'high';
  const nu = hi ? 92 : 28, nv = hi ? 34 : 11;
  const shade: number[] = [];
  const s: AfroSample = { off: 0, big: 0, small: 0 };
  const tone = (el: number, smp: AfroSample, k: number): number => {
    const depth = 0.7 + 0.3 * smooth(-0.6, 1.1, el);                         // darker toward the nape / under-side
    const ao = 0.66 + 0.34 * Math.pow(Math.min(1, smp.big / AFRO_BIG_H), 0.6); // creases between clusters
    const coil = hi ? 0.88 + 0.12 * Math.min(1, smp.small / AFRO_SMALL_H) : 1;
    const grain = 0.93 + 0.07 * hash01(k * 1.37 + 5);
    return depth * ao * coil * grain;
  };
  let k = 0;
  const g = grid((u, v) => {
    const phi = -Math.PI + u * Math.PI * 2;
    const el = lerp(AFRO_TOP, afroLine(phi), Math.pow(v, AFRO_VPOW));
    afroSample(phi, el, hat, hi, s);
    shade.push(tone(el, s, k++));
    return headPoint(phi, el, Math.max(0.003, s.off));
  }, nu, nv, { poleTop: headPoint(0, Math.PI / 2, afroSample(0, Math.PI / 2, hat, hi, s).off), center: HC });
  shade.push(tone(Math.PI / 2, afroSample(0, Math.PI / 2, hat, hi, s), k));
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = shade[i] ?? 1; col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const STD_LINE = [[0, 0.5], [0.55, 0.44], [1.05, 0.12], [1.45, -0.02], [1.75, -0.12], [2.4, -0.55], [Math.PI, -0.72]];
const SLEEK_LINE = [[0, 0.52], [0.55, 0.46], [1.05, 0.14], [1.45, -0.02], [1.75, -0.1], [2.4, -0.5], [Math.PI, -0.66]];

export function buildHair(b: GeoBuilder, style: string, lod: Lod, hat: boolean): void {
  const H = 'hair';
  const add = (g: THREE.BufferGeometry, color: V3 | ((x: number, y: number, z: number) => V3) = hairShade()) => b.add(H, g, { color });
  const hi = lod === 'high';
  const vol = (base: number, top: number) => (_p: number, el: number) => base + top * smooth(-0.2, 1.2, el);
  switch (style) {
    case 'bald': return;
    case 'buzz':
      add(capGeometry({ line: [[0, 0.56], [0.6, 0.48], [1.1, 0.16], [1.5, 0.0], [1.8, -0.1], [2.5, -0.5], [Math.PI, -0.62]], off: () => 0.0035, grooves: hi ? 90 : 0, grooveDepth: 0.0008 }, lod), hairShade(-0.6, 0.12));
      return;
    case 'short': {
      add(capGeometry({ line: STD_LINE, off: vol(0.012, hat ? 0.004 : 0.016), grooves: 28, grooveDepth: 0.0035 }, lod), hairShade(-0.6, 0.25, 28));
      if (hi || true) {
        // swept fringe locks
        const locks: Array<[number, number]> = [[-0.5, 0.0], [-0.25, 0.04], [0.0, 0.06], [0.25, 0.05], [0.48, 0.02]];
        for (const [p0, d] of locks) {
          add(lock([[p0 - 0.15, 0.95, 0.016], [p0 + 0.02, 0.72, 0.02], [p0 + 0.14, 0.5 + d, 0.014], [p0 + 0.26, 0.4 + d, 0.006]], 0.034, 0.012, 0.012, lod));
        }
      }
      return;
    }
    case 'bob': {
      add(capGeometry({
        line: [[0, 0.5], [0.6, 0.42], [0.95, 0.0], [1.15, -0.62], [Math.PI / 2, -0.72], [Math.PI, -0.72]],
        off: (_p, el, v) => 0.016 + 0.012 * smooth(-0.1, 1.2, el) + 0.006 * Math.sin(v * Math.PI),
        grooves: 40, grooveDepth: 0.003, hang: { from: -0.05, flare: 0.1 },
      }, lod), hairShade(-0.9, 0.25, 40));
      // straight bangs
      const bangs = grid((u, v) => {
        const phi = lerp(-0.92, 0.92, u);
        const el = lerp(0.62, 0.3 + 0.06 * Math.abs(phi), v);
        return headPoint(phi, el, 0.02 + 0.006 * (1 - v));
      }, hi ? 24 : 8, hi ? 6 : 2, { wrapU: false, center: HC });
      add(bangs, hairShade(0, 0.15));
      return;
    }
    case 'long': {
      add(capGeometry({
        line: [[0, 0.5], [0.6, 0.42], [0.95, 0.05], [1.2, -0.5], [Math.PI / 2, -0.6], [Math.PI, -0.62]],
        off: (_p, el) => 0.016 + 0.01 * smooth(-0.1, 1.2, el),
        grooves: 46, grooveDepth: 0.003, hang: { from: -0.1, flare: 0.16 },
        bottomY: (ap) => ap < 0.95 ? null : lerp(-0.08, -0.36, smooth(1.0, 2.6, ap)),
      }, lod), hairShade(-1.4, 0.25, 46));
      add(lock([[0.62, 0.95, 0.018], [0.4, 0.62, 0.022], [0.32, 0.42, 0.012]], 0.04, 0.02, 0.012, lod));
      add(lock([[-0.2, 0.95, 0.018], [-0.36, 0.7, 0.022], [-0.5, 0.45, 0.014], [-0.7, 0.3, 0.008]], 0.04, 0.018, 0.012, lod));
      return;
    }
    case 'ponytail': {
      add(capGeometry({ line: SLEEK_LINE, off: vol(0.009, 0.006), grooves: 36, grooveDepth: 0.0025 }, lod), hairShade(-0.6, 0.25, 36));
      if (!hat || true) {
        const tie: V3 = [0, HC[1] + 0.07, HC[2] - 0.13];
        b.add('#2d2a3a|plastic', new THREE.TorusGeometry(0.022, 0.009, 6, hi ? 16 : 8).deleteAttribute('uv'), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...tie), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0)), new THREE.Vector3(1, 1, 1)) });
        add(pathTube([[0, tie[1] + 0.01, tie[2] + 0.03], [0, tie[1], tie[2] - 0.01], [0, tie[1] - 0.03, tie[2] - 0.06], [0, tie[1] - 0.13, tie[2] - 0.075], [0, tie[1] - 0.25, tie[2] - 0.05]],
          (s) => { const r = 0.034 * Math.sin(Math.min(1, s * 1.4 + 0.25) * Math.PI) * (1 - s * 0.55) + 0.006; return [r, r * 0.85]; }, hi ? 12 : 6, hi ? 14 : 5), hairShade(-1.4, 0.2));
      }
      return;
    }
    case 'bun': {
      add(capGeometry({ line: SLEEK_LINE, off: vol(0.009, 0.006), grooves: 36, grooveDepth: 0.0025 }, lod), hairShade(-0.6, 0.25, 36));
      if (!hat) {
        const top = headPoint(Math.PI, 1.15, 0.045);
        sphereAt(b, H, top, [0.056, 0.05, 0.056], lod, hairShade(0, 0.2));
        b.add('#2d2a3a|plastic', new THREE.TorusGeometry(0.04, 0.007, 6, hi ? 18 : 8).deleteAttribute('uv'), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(top[0], top[1] - 0.035, top[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, 0, 0)), new THREE.Vector3(1, 1, 1)) });
      }
      return;
    }
    case 'curly': {
      add(capGeometry({ line: STD_LINE, off: vol(0.024, hat ? 0.0 : 0.012), grooves: 0, bumps: hat ? 0 : 0.019, lobe: [9, 10] }, lod), hairShade(-0.5, 0.3));
      if (!hat) {
        // soft fringe curls along the hairline
        for (let i = 0; i < 7; i++) {
          const phi = lerp(-0.75, 0.75, i / 6);
          add(lock([[phi * 0.9, 0.85, 0.03], [phi, 0.6, 0.032], [phi * 1.05, 0.46, 0.02]], 0.03, 0.022, 0.016, lod), hairShade(0.0, 0.25));
        }
      }
      return;
    }
    case 'afro': {
      // matte coils (own finish slot), vertex colours carry the curl-cluster occlusion + grain
      b.add('hairCoil', afroGeometry(lod, hat));
      return;
    }
    case 'spiky': {
      add(capGeometry({ line: STD_LINE, off: vol(0.012, 0.006), grooves: 30, grooveDepth: 0.003 }, lod));
      if (!hat) {
        const spikes: Array<[number, number, number]> = [[0, 0.75, 0.085], [0.45, 0.8, 0.075], [-0.45, 0.8, 0.075], [0.9, 0.55, 0.06], [-0.9, 0.55, 0.06], [0.25, 1.15, 0.08], [-0.25, 1.15, 0.08], [2.5, 0.9, 0.07], [-2.5, 0.9, 0.07], [Math.PI, 0.6, 0.065], [1.6, 0.85, 0.07], [-1.6, 0.85, 0.07], [0, 1.4, 0.07]];
        for (const [phi, el, len] of spikes) {
          const base = headPoint(phi, el, 0.006);
          const n = headNormal(phi, el);
          const dir = new THREE.Vector3(n[0], n[1] + 0.6, n[2] - 0.25).normalize();
          const g = new THREE.ConeGeometry(0.03, len, hi ? 8 : 5); g.deleteAttribute('uv');
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          const pos = new THREE.Vector3(...base).addScaledVector(dir, len / 2);
          b.add(H, g, { matrix: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 0.7)), color: hairShade(-0.2, 0.25) });
        }
      }
      return;
    }
    case 'mohawk': {
      b.add('hairDark', capGeometry({ line: [[0, 0.56], [0.6, 0.48], [1.1, 0.16], [1.5, 0.0], [1.8, -0.1], [2.5, -0.5], [Math.PI, -0.62]], off: () => 0.003 }, lod), { color: hairShade(-0.6, 0.1) });
      if (!hat) {
        const ctrl: V3[] = [];
        const N = 7;
        for (let i = 0; i <= N; i++) { const t = i / N; const el = lerp(0.55, Math.PI - 0.4, t); const phi = el > Math.PI / 2 ? Math.PI : 0; const e = el > Math.PI / 2 ? Math.PI - el : el; ctrl.push(headPoint(phi, e, 0.03)); }
        add(pathTube(ctrl, (s) => [0.016 * (1 - s * 0.4), 0.05 * Math.sin(clamp(s * 1.15 + 0.1, 0, 1) * Math.PI) + 0.012], hi ? 10 : 6, hi ? 18 : 6, {
          up: (p) => [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]], n: 2.4,
        }), hairShade(0.0, 0.2));
      }
      return;
    }
    case 'braids': {
      add(capGeometry({ line: SLEEK_LINE, off: (phi) => 0.009 - 0.004 * Math.exp(-(phi * phi) / 0.004), grooves: 36, grooveDepth: 0.0025 }, lod), hairShade(-0.6, 0.25, 36));
      for (const side of [1, -1]) {
        const start = headPoint(side * 1.95, -0.25, 0.01);
        const segN = hi ? 9 : 5;
        for (let i = 0; i < segN; i++) {
          const t = i / (segN - 1);
          const p: V3 = [start[0] + side * (0.01 + 0.03 * t), start[1] - 0.02 - t * 0.26, start[2] + 0.04 + 0.13 * Math.sin(t * Math.PI * 0.55)];
          const r = 0.026 * (1 - t * 0.35);
          const g = new THREE.SphereGeometry(1, hi ? 10 : 6, hi ? 8 : 4); g.deleteAttribute('uv');
          b.add(H, g, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler((i % 2 ? 0.5 : -0.5), 0, side * 0.3)), new THREE.Vector3(r, r * 1.25, r)), color: hairShade(-1.5, 0.15) });
        }
        const endP: V3 = [start[0] + side * 0.04, start[1] - 0.31, start[2] + 0.04 + 0.13 * Math.sin(Math.PI * 0.55)];
        sphereAt(b, '#e36aa6|plastic', endP, 0.011, lod);
      }
      return;
    }
    default:
      buildHair(b, 'short', lod, hat);
  }
}
