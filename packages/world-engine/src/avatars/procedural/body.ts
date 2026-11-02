/**
 * Skin body parts (rig space, T-pose): torso, neck, arms, legs, hands, feet.
 * Ring generators are exported so garments can follow the exact body shape
 * with an offset (same skin weights => no poke-through when posed).
 */
import * as THREE from 'three';
import { BI, armR, armWeights, legDX, legR, legWeights, torsoAt, torsoS, torsoWeights, type Dims } from './dims';
import { GeoBuilder, capsuleG, lerp, roundBoxG, smooth, sweep, trs, type Ring, type SkinW, type V3 } from './geom';

export interface LodCfg { radial: number; torsoRadial: number; rings: number; high: boolean }
export const LOD_HIGH: LodCfg = { radial: 16, torsoRadial: 26, rings: 1, high: true };
export const LOD_LOW: LodCfg = { radial: 8, torsoRadial: 12, rings: 0.45, high: false };

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];

// ---------------------------------------------------------------- torso
export interface TorsoShellOpts {
  /** s range (see dims): -0.27 crotch .. 1.04 neck */
  s0: number; s1: number;
  off: number | ((s: number) => number);
  /** extra flare at the bottom (metres added near s0) */
  flare?: number;
  /** open (no caps) — garments */
  open?: boolean;
  /** close the top with a pole (skin) */
  capTop?: boolean;
  capBottom?: boolean;
  ringCount?: number;
  /** partial theta range for open-front jackets */
  theta0?: number; theta1?: number;
  /** squash depth factor */
  depthMul?: number;
  mod?: (theta: number, ring: number) => number;
}
export function torsoRing(d: Dims, y: number, off: number, depthMul = 1): Ring {
  const [w, df, db, n, zc] = torsoAt(d, y);
  return { c: [0, y, zc], a: w + off, b: df * depthMul + off, bb: db * depthMul + off, n };
}
export function torsoShell(d: Dims, lod: LodCfg, o: TorsoShellOpts): THREE.BufferGeometry {
  const count = Math.max(5, Math.round((o.ringCount ?? 24) * lod.rings));
  const rings: Ring[] = [];
  for (let i = 0; i <= count; i++) {
    const s = lerp(o.s0, o.s1, i / count);
    const off = typeof o.off === 'function' ? o.off(s) : o.off;
    const fl = (o.flare ?? 0) * Math.pow(1 - smooth(o.s0, o.s0 + 0.35, s), 1.5);
    const r = torsoRing(d, torsoS(d, s), off + fl, o.depthMul);
    rings.push(r);
  }
  let startPole: V3 | null = null, endPole: V3 | null = null;
  if (o.capBottom) { const r0 = rings[0]!; startPole = [0, r0.c[1] - 0.006, r0.c[2]]; }
  if (o.capTop) { const r1 = rings[rings.length - 1]!; endPole = [0, r1.c[1] + 0.012, r1.c[2]]; }
  return sweep(rings, { u: X, v: Z, segs: lod.torsoRadial, startPole, endPole, theta0: o.theta0, theta1: o.theta1, mod: o.mod });
}

// ---------------------------------------------------------------- arms
export interface LimbOpts {
  t0: number; t1: number;
  off: number | ((t: number) => number);
  capStart?: boolean; capEnd?: boolean;
  ringCount?: number;
  /** multiply radius (puff sleeves etc.) */
  shape?: (t: number) => number;
  theta0?: number; theta1?: number;
  mod?: (theta: number, ring: number) => number;
}
export function armShell(d: Dims, lod: LodCfg, side: 1 | -1, o: LimbOpts): THREE.BufferGeometry {
  const count = Math.max(4, Math.round((o.ringCount ?? 16) * lod.rings));
  const rings: Ring[] = [];
  const zc = -0.005;
  const cen = (t: number): V3 => [side * (d.armX + t), d.armY, zc];
  const rad = (t: number) => {
    const off = typeof o.off === 'function' ? o.off(t) : o.off;
    return (armR(d, Math.max(0, t)) + off) * (o.shape ? o.shape(t) : 1);
  };
  let startPole: V3 | null = null;
  let tStart = o.t0;
  if (o.capStart) {
    // hemispherical (slightly flattened) shoulder cap; pole at t0
    const r0 = rad(o.t0);
    const depth = r0 * 0.8;
    const tc = o.t0 + depth;
    const rc = rad(tc);
    const cs = lod.high ? 5 : 3;
    for (let k = 1; k < cs; k++) {
      const al = (k / cs) * (Math.PI / 2);
      const t = tc - depth * Math.cos(al);
      const s = Math.sin(al);
      rings.push({ c: cen(t), a: rc * 0.94 * s, b: rc * s });
    }
    startPole = cen(o.t0);
    tStart = tc;
  }
  for (let i = 0; i <= count; i++) {
    const t = lerp(tStart, o.t1, i / count);
    const r = rad(t);
    rings.push({ c: cen(t), a: r * 0.94, b: r * 1.0 });
  }
  const endPole: V3 | null = o.capEnd ? cen(o.t1 + 0.012) : null;
  return sweep(rings, { u: Y, v: Z, segs: lod.radial, startPole, endPole, theta0: o.theta0, theta1: o.theta1, mod: o.mod });
}

// ---------------------------------------------------------------- legs
export function legShell(d: Dims, lod: LodCfg, side: 1 | -1, o: LimbOpts): THREE.BufferGeometry {
  const count = Math.max(5, Math.round((o.ringCount ?? 20) * lod.rings));
  const rings: Ring[] = [];
  const cen = (t: number): V3 => [side * (d.hipX + legDX(d, t)), d.hipJoint - t, t > d.upperLeg ? -0.004 : 0];
  const rad = (t: number) => {
    const off = typeof o.off === 'function' ? o.off(t) : o.off;
    return (legR(d, t) + off) * (o.shape ? o.shape(t) : 1);
  };
  for (let i = 0; i <= count; i++) {
    const t = lerp(o.t0, o.t1, i / count);
    const r = rad(t);
    const calf = smooth(d.upperLeg + 0.02, d.upperLeg + 0.1, t) * (1 - smooth(d.upperLeg + d.lowerLeg * 0.55, d.upperLeg + d.lowerLeg * 0.9, t));
    rings.push({ c: cen(t), a: r, b: r * 1.02, bb: r * (1.04 + calf * 0.12) });
  }
  const startPole: V3 | null = o.capStart ? cen(o.t0 - rad(o.t0) * 0.6) : null;
  const endPole: V3 | null = o.capEnd ? cen(o.t1 + 0.01) : null;
  return sweep(rings, { u: X, v: Z, segs: lod.radial, startPole, endPole, theta0: o.theta0, theta1: o.theta1, mod: o.mod });
}

// ---------------------------------------------------------------- hands & feet
/** Hand in hand-bone local space for the LEFT hand (+X along fingers, palm -Y, thumb +Z). */
export function handGeometry(lod: LodCfg): Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> {
  const out: Array<{ g: THREE.BufferGeometry; m: THREE.Matrix4 }> = [];
  // Soft "mitten" hand: palm + curled finger block + chunky thumb (reads well at any distance).
  const hi = lod.high;
  out.push({ g: roundBoxG(0.078, 0.036, 0.072, 0.017, hi ? 3 : 1), m: trs([0.038, 0, 0]) });
  out.push({ g: roundBoxG(0.064, 0.03, 0.07, 0.0145, hi ? 3 : 1), m: trs([0.094, -0.01, -0.002], [0, 0, -0.38]) });
  out.push({ g: capsuleG(0.0145, 0.03, hi ? 3 : 2, hi ? 10 : 6), m: trs([0.04, -0.008, 0.042], [0.55, 0, -Math.PI / 2 + 0.85]) });
  return out;
}

/** Foot sweep (foot-bone local; heel at -z, toes +z). Used for bare feet and shoe uppers. */
export function footGeometry(d: Dims, lod: LodCfg, o: { grow?: number; heightMul?: number; toeRound?: number; lenMul?: number; z0?: number; z1?: number; flatBottom?: number } = {}): THREE.BufferGeometry {
  const gr = o.grow ?? 0, hm = o.heightMul ?? 1, L = d.footLen * (o.lenMul ?? 1);
  const W = d.footW / 2;
  const keys = [
    // z, halfWidth, topHalfHeight, bottomHalfHeight, centreY
    [-0.055, W * 0.62, 0.032, 0.03, -0.035],
    [-0.035, W * 0.78, 0.042, 0.035, -0.032],
    [0.0, W * 0.82, 0.05, 0.036, -0.03],
    [0.06, W * 0.95, 0.034, 0.034, -0.042],
    [0.11, W * 1.0, 0.026, 0.032, -0.048],
    [L - 0.07, W * 0.92, 0.022, 0.028, -0.05],
    [L - 0.055, W * 0.7, 0.017, 0.022, -0.054],
  ];
  const rings: Ring[] = [];
  const band = o.z0 !== undefined && o.z1 !== undefined;
  const n = band ? 3 : lod.high ? 10 : 5;
  for (let i = 0; i <= n; i++) {
    const z = band ? lerp(o.z0!, o.z1!, i / n) : lerp(keys[0]![0]!, keys[keys.length - 1]![0]!, i / n);
    const f = (c: number) => { let k = 0; while (k < keys.length - 2 && z > keys[k + 1]![0]!) k++; const a = keys[k]!, b = keys[k + 1]!; const t = smooth(a[0]!, b[0]!, z); return lerp(a[c]!, b[c]!, t); };
    const top = f(2) * hm + gr, bot = f(3) + gr * 0.5;
    rings.push({ c: [0, f(4) + (top - bot) * 0.5 * 0 + 0.0, z], a: f(1) + gr, b: top, bb: bot, n: 2.6 });
  }
  const first = rings[0]!, last = rings[rings.length - 1]!;
  if (band) return sweep(rings, { u: X, v: Y, segs: lod.radial });
  return sweep(rings, { u: X, v: Y, segs: lod.radial, startPole: [0, first.c[1], first.c[2] - 0.012 - gr], endPole: [0, last.c[1] - 0.004, last.c[2] + 0.014 + gr] });
}

// ---------------------------------------------------------------- skin body
export interface Coverage {
  /** arm skin starts at this t (m from shoulder pivot); Infinity = no arm skin */
  armFrom: number;
  /** leg skin starts at this t (m from hip joint) */
  legFrom: number;
  /** bare feet visible (sandals) */
  bareFeet: boolean;
}

function neckWeights(d: Dims) {
  return (_x: number, y: number, _z: number, out: SkinW) => {
    const a = smooth(d.neck - 0.03, d.neck + 0.01, y);
    const b = smooth(d.head - 0.01, d.head + 0.03, y);
    const wu = 1 - a, wn = a * (1 - b), wh = a * b;
    const pairs: Array<[number, number]> = [[BI.upperChest, wu], [BI.neck, wn], [BI.head, wh]];
    pairs.sort((p, q) => q[1] - p[1]);
    for (let i = 0; i < 4; i++) { const p = pairs[i]; out.i[i] = p ? p[0] : 0; out.w[i] = p ? p[1] : 0; }
  };
}

export function buildSkin(b: GeoBuilder, d: Dims, lod: LodCfg, cov: Coverage): void {
  const tw = torsoWeights(d), aw = armWeights(d), lw = legWeights(d);
  b.add('skin', torsoShell(d, lod, { s0: -0.21, s1: 1.04, off: 0, capBottom: true, capTop: true, ringCount: 26 }), { weights: tw });
  // neck
  const nr = d.neckR;
  const neckRings: Ring[] = [];
  const ny0 = d.neck - 0.05, ny1 = d.head + 0.09;
  const nn = lod.high ? 8 : 4;
  for (let i = 0; i <= nn; i++) {
    const y = lerp(ny0, ny1, i / nn);
    const flare = 1 + 0.35 * (1 - smooth(ny0, ny0 + 0.06, y));
    neckRings.push({ c: [0, y, -0.01 + 0.004 * (i / nn)], a: nr * flare, b: nr * 0.95 * flare });
  }
  b.add('skin', sweep(neckRings, { u: X, v: Z, segs: lod.radial }), { weights: neckWeights(d) });
  // arms
  const armEnd = d.upperArm + d.lowerArm + 0.012;
  for (const side of [1, -1] as const) {
    if (cov.armFrom < armEnd) {
      const fromShoulder = cov.armFrom <= 0;
      b.add('skin', armShell(d, lod, side, { t0: fromShoulder ? -0.05 : cov.armFrom, t1: armEnd, off: 0, capStart: fromShoulder, capEnd: true, ringCount: 16 }), { weights: aw });
    }
    // hands
    const hb = side === 1 ? BI.leftHand : BI.rightHand;
    const hp = d.bones[side === 1 ? 'leftHand' : 'rightHand'];
    const base = new THREE.Matrix4().makeTranslation(hp[0], hp[1], hp[2]).multiply(new THREE.Matrix4().makeScale(side * d.handScale, d.handScale, d.handScale));
    for (const part of handGeometry(lod)) b.add('skin', part.g, { matrix: base.clone().multiply(part.m), bone: hb });
    // legs
    const legEnd = d.upperLeg + d.lowerLeg + 0.02;
    if (cov.legFrom < legEnd) {
      const fromHip = cov.legFrom <= 0;
      b.add('skin', legShell(d, lod, side, { t0: fromHip ? -0.04 : cov.legFrom, t1: legEnd, off: 0, capStart: fromHip, capEnd: true, ringCount: 20 }), { weights: lw });
    }
    if (cov.bareFeet) {
      const fp = d.bones[side === 1 ? 'leftFoot' : 'rightFoot'];
      b.add('skin', footGeometry(d, lod, { grow: -0.002 }), { matrix: new THREE.Matrix4().makeTranslation(fp[0], fp[1], fp[2]), bone: side === 1 ? BI.leftFoot : BI.rightFoot });
      if (lod.high) {
        for (let k = 0; k < 5; k++) {
          const tz = d.footLen - 0.07 + (k === 0 ? 0.008 : 0) - k * 0.004;
          const tx = side * (0.026 - k * 0.0125) * (d.footW / 0.088);
          const r = k === 0 ? 0.011 : 0.0085 - k * 0.0006;
          b.add('skin', capsuleG(1, 0.6, 3, 8), { matrix: new THREE.Matrix4().makeTranslation(fp[0] + tx, fp[1] - 0.056, fp[2] + tz).multiply(trs([0, 0, 0], [Math.PI / 2, 0, 0], [r, r, r])), bone: side === 1 ? BI.leftFoot : BI.rightFoot });
        }
      }
    }
  }
}
