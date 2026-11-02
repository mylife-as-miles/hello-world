/**
 * Garments (rig space, skinned with the same weights as the body underneath).
 * Material slots: top, topDark, topLight, trim, shirt, bottom, bottomDark,
 * bottomLight, shoe, shoeDark, sole, plus fixed '#rrggbb|finish' keys.
 */
import * as THREE from 'three';
import { armShell, footGeometry, legShell, torsoRing, torsoShell, type Coverage, type LodCfg } from './body';
import { BI, armWeights, legR, legWeights, skirtWeights, torsoAt, torsoS, torsoWeights, type Dims } from './dims';
import { GeoBuilder, capsuleG, lerp, pathTube, roundBoxG, smooth, sweep, trs, type Ring, type V3 } from './geom';

export interface OutfitSpec { top: string; bottom: string; shoes: string }

/** Outward offset of each top (used by body accessories). */
export const TOP_OFFSET: Record<string, number> = { tee: 0.01, hoodie: 0.02, sweater: 0.018, jacket: 0.024, tank: 0.008, dress: 0.009, blouse: 0.013, varsity: 0.022 };

export function coverageFor(o: OutfitSpec, d: Dims): Coverage {
  const ua = d.upperArm, la = d.lowerArm, ul = d.upperLeg, ll = d.lowerLeg;
  const sleeve: Record<string, number> = { tee: 0.45 * ua, hoodie: ua + la, sweater: ua + la, jacket: ua + la, tank: -1, dress: 0.28 * ua, blouse: 0.55 * ua, varsity: ua + la };
  const s = sleeve[o.top] ?? sleeve.tee!;
  const armFrom = s < 0 ? 0 : Math.max(0.02, s - 0.04);
  let legFrom: number;
  if (o.top === 'dress') legFrom = o.bottom === 'leggings' ? ul + ll - 0.05 : 0.18 * ul;
  else {
    const pant: Record<string, number> = { jeans: ul + ll, trousers: ul + ll, joggers: ul + ll, leggings: ul + ll, cargo: ul + ll, shorts: 0.52 * ul, skirt: 0.2 * ul };
    const p = pant[o.bottom] ?? pant.jeans!;
    legFrom = o.bottom === 'skirt' ? p : Math.max(0.02, p - 0.05);
  }
  return { armFrom, legFrom, bareFeet: o.shoes === 'sandals' };
}

const rib = (n: number, amp: number) => (th: number) => 1 + amp * Math.cos(th * n);

// ---------------------------------------------------------------- tops
function sleeves(b: GeoBuilder, d: Dims, lod: LodCfg, mat: string, end: number, off: number, o: { cuff?: string; puff?: number; flare?: number; cuffW?: number } = {}): void {
  const aw = armWeights(d);
  for (const side of [1, -1] as const) {
    const shape = o.puff ? (t: number) => 1 + o.puff! * Math.sin(Math.min(1, Math.max(0, (t + 0.03) / (end + 0.03))) * Math.PI) : undefined;
    const offF = (t: number) => off + (o.flare ?? 0) * smooth(end - 0.08, end, t);
    b.add(mat, armShell(d, lod, side, { t0: -0.055, t1: end, off: offF, capStart: true, ringCount: 14, shape }), { weights: aw });
    if (o.cuff) {
      const w = o.cuffW ?? 0.035;
      b.add(o.cuff, armShell(d, lod, side, { t0: end - w, t1: end + 0.004, off: offF(end) + 0.004, ringCount: 3, mod: lod.high ? rib(24, 0.02) : undefined }), { weights: aw });
    }
  }
}

function band(b: GeoBuilder, d: Dims, lod: LodCfg, mat: string, s0: number, s1: number, off: number, ribbed = false): void {
  b.add(mat, torsoShell(d, lod, { s0, s1, off: (s) => off + 0.003 * Math.sin(((s - s0) / (s1 - s0)) * Math.PI), ringCount: 3, mod: ribbed && lod.high ? rib(48, 0.005) : undefined }), { weights: torsoWeights(d) });
}

function chestPoint(d: Dims, s: number, side: number, off: number): V3 {
  const y = torsoS(d, s);
  const [w, df, , n, zc] = torsoAt(d, y);
  // point on the front super-ellipse at x offset `side`
  const xn = Math.max(-0.95, Math.min(0.95, side / w));
  const zf = Math.pow(1 - Math.pow(Math.abs(xn), n), 1 / n) * df;
  return [side, y, zc + zf + off];
}

function buttons(b: GeoBuilder, d: Dims, lod: LodCfg, mat: string, s0: number, s1: number, n: number, off: number, r = 0.007): void {
  if (!lod.high) return;
  const tw = torsoWeights(d);
  for (let i = 0; i < n; i++) {
    const s = lerp(s0, s1, n === 1 ? 0.5 : i / (n - 1));
    const p = chestPoint(d, s, 0, off);
    const g = new THREE.SphereGeometry(1, 8, 6); g.deleteAttribute('uv');
    b.add(mat, g, { matrix: trs(p, [0, 0, 0], [r, r, r * 0.55]), weights: tw });
  }
}

function hood(b: GeoBuilder, d: Dims, lod: LodCfg, mat: string, off: number): void {
  const y = torsoS(d, 0.99);
  const [w, , db] = torsoAt(d, torsoS(d, 0.92));
  const pts: V3[] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const a = lerp(-1.25, 1.25, i / N); // around the back of the neck
    pts.push([Math.sin(a) * (w * 0.62 + off), y + 0.012 + 0.02 * Math.cos(a), -Math.cos(a) * (db * 0.78 + off) + 0.012]);
  }
  b.add(mat, pathTube(pts, (s) => { const k = Math.sin(s * Math.PI); return [0.026 + 0.03 * k, 0.03 + 0.016 * k]; }, lod.high ? 12 : 6, lod.high ? 18 : 7), { bone: BI.upperChest });
  // hood back panel resting between the shoulder blades
  const g = new THREE.SphereGeometry(1, lod.high ? 16 : 8, lod.high ? 10 : 5, 0, Math.PI * 2, 0, Math.PI * 0.62); g.deleteAttribute('uv');
  b.add(mat, g, { matrix: trs([0, y - 0.055, -db - off - 0.012], [-1.9, 0, 0], [0.105, 0.06, 0.1]), bone: BI.upperChest });
}

export function buildTop(b: GeoBuilder, d: Dims, lod: LodCfg, top: string, bottom: string): void {
  const tw = torsoWeights(d);
  const hi = lod.high;
  const ua = d.upperArm, la = d.lowerArm;
  const shell = (mat: string, s0: number, s1: number, off: number | ((s: number) => number), extra: Partial<Parameters<typeof torsoShell>[2]> = {}) =>
    b.add(mat, torsoShell(d, lod, { s0, s1, off, ringCount: 22, ...extra }), { weights: tw });
  // tops tuck over the waistband: hem at s=-0.1 (over hips)
  switch (top) {
    case 'hoodie': {
      const off = 0.02;
      shell('top', -0.14, 1.0, (s) => off + 0.006 * smooth(0.3, -0.1, s), { flare: 0.006 });
      band(b, d, lod, 'topDark', -0.18, -0.1, off + 0.006, true);
      sleeves(b, d, lod, 'top', ua + la - 0.005, off - 0.004, { cuff: 'topDark', cuffW: 0.04, puff: 0.06 });
      hood(b, d, lod, 'topDark', off);
      // kangaroo pocket
      shell('topDark', 0.04, 0.3, off + 0.005, { theta0: -0.62, theta1: 0.62, ringCount: 6 });
      if (hi) for (const sx of [0.028, -0.028]) {
        const p = chestPoint(d, 0.96, sx, off + 0.01);
        b.add('#f4f1ea|cloth', capsuleG(0.004, 0.09, 2, 6), { matrix: trs([p[0], p[1] - 0.055, p[2] + 0.004], [0.08, 0, 0]), bone: BI.upperChest });
        const g = new THREE.CylinderGeometry(0.0055, 0.0055, 0.014, 6); g.deleteAttribute('uv');
        b.add('#d8d2c4|plastic', g, { matrix: trs([p[0], p[1] - 0.108, p[2] + 0.008]), bone: BI.upperChest });
      }
      return;
    }
    case 'sweater': {
      const off = 0.017;
      shell('top', -0.12, 1.0, off);
      band(b, d, lod, 'topDark', -0.17, -0.09, off + 0.005, true);
      band(b, d, lod, 'topDark', 0.94, 1.03, off - 0.004, true);
      sleeves(b, d, lod, 'top', ua + la - 0.005, off - 0.004, { cuff: 'topDark', cuffW: 0.045 });
      // knit stripes across the chest
      shell('topLight', 0.56, 0.62, off + 0.0015, { ringCount: 3 });
      shell('topLight', 0.68, 0.72, off + 0.0015, { ringCount: 2 });
      return;
    }
    case 'jacket': {
      // tee underneath + open jacket (slimmer shoulders)
      shell('shirt', -0.08, 1.0, 0.009);
      band(b, d, lod, 'shirt', 0.95, 1.02, 0.006);
      const off = 0.021;
      const open = 0.3;
      shell('top', -0.16, 0.99, (s) => off + 0.004 * smooth(0.4, -0.1, s), { theta0: open, theta1: Math.PI * 2 - open, ringCount: 22 });
      // lapels (darker), folded outward along the opening
      for (const [t0, t1] of [[open - 0.02, open + 0.34], [Math.PI * 2 - open - 0.34, Math.PI * 2 - open + 0.02]] as const) {
        shell('topDark', 0.62, 0.995, (s) => off + 0.004 + 0.008 * smooth(0.62, 0.9, s), { theta0: t0, theta1: t1, ringCount: 6 });
      }
      band(b, d, lod, 'topDark', -0.19, -0.13, off + 0.004);
      sleeves(b, d, lod, 'top', ua + la - 0.008, off - 0.006, { cuff: 'topDark', cuffW: 0.03 });
      if (hi) for (const sx of [0.085, -0.085]) {
        const p = chestPoint(d, 0.2, sx, off + 0.003);
        b.add('topDark', roundBoxG(0.06, 0.008, 0.01, 0.003, 1), { matrix: trs(p, [0, sx > 0 ? -0.35 : 0.35, 0]), weights: tw });
      }
      return;
    }
    case 'tank': {
      const off = 0.007;
      shell('top', -0.11, 0.82, off);
      band(b, d, lod, 'topDark', 0.78, 0.84, off + 0.002);
      for (const side of [1, -1]) {
        const xs = side * 0.072 * Math.sqrt(d.armX / 0.158);
        const pf = chestPoint(d, 0.8, xs, off);
        const [, , db] = torsoAt(d, torsoS(d, 0.8));
        const yTop = torsoS(d, 1.0);
        const pts: V3[] = [pf, [xs * 1.05, yTop - 0.005, 0.03], [xs * 1.08, yTop + 0.003, -0.004], [xs * 1.05, yTop - 0.01, -0.045], [xs, torsoS(d, 0.8), -db - off]];
        b.add('topDark', pathTube(pts, () => [0.013, 0.004], hi ? 6 : 4, hi ? 12 : 5, { up: (p) => [p[0] * 0.3, p[1] - torsoS(d, 0.55), p[2]] }), { weights: tw });
      }
      return;
    }
    case 'dress': {
      const off = 0.009;
      shell('top', 0.14, 0.96, off);
      band(b, d, lod, 'topDark', 0.92, 0.97, off + 0.003);
      sleeves(b, d, lod, 'top', 0.28 * ua, 0.012, { puff: 0.22, cuff: 'topDark', cuffW: 0.018 });
      // waist band
      band(b, d, lod, 'topDark', 0.12, 0.2, off + 0.004);
      // flared skirt from the waist to just above the knee
      const yTop = torsoS(d, 0.16);
      const yBot = d.hipJoint - d.upperLeg * 0.86;
      const rings: Ring[] = [];
      const N = hi ? 12 : 5;
      for (let i = 0; i <= N; i++) {
        const t = i / N; const y = lerp(yTop, yBot, t);
        const base = torsoRing(d, Math.max(y, torsoS(d, -0.18)), off + 0.004);
        const fl = Math.pow(t, 0.85) * 0.13;
        rings.push({ c: [0, y, base.c[2]], a: Math.max(base.a, d.hipX + legR(d, 0.1)) + fl, b: base.b + fl * 0.95, bb: (base.bb ?? base.b) + fl * 1.05, n: lerp(base.n ?? 2, 2, t) });
      }
      b.add('top', sweep(rings, { u: [1, 0, 0], v: [0, 0, 1], segs: lod.torsoRadial + 6, mod: hi ? (th, ri) => 1 + 0.035 * (ri / N) * Math.cos(th * 14) : undefined }), { weights: skirtWeights(d, yTop - yBot) });
      if (hi) {
        // hem trim
        const last = rings[rings.length - 1]!, prev = rings[rings.length - 2]!;
        const trimRings: Ring[] = [prev, last].map((r, k) => ({ ...r, c: [r.c[0], lerp(last.c[1] + 0.03, last.c[1], k), r.c[2]] as V3, a: last.a + 0.003, b: last.b + 0.003, bb: (last.bb ?? last.b) + 0.003 }));
        b.add('topDark', sweep(trimRings, { u: [1, 0, 0], v: [0, 0, 1], segs: lod.torsoRadial + 6, mod: (th) => 1 + 0.035 * Math.cos(th * 14) }), { weights: skirtWeights(d, yTop - yBot) });
      }
      void bottom;
      return;
    }
    case 'blouse': {
      const off = 0.013;
      shell('top', -0.15, 1.0, (s) => off + 0.012 * smooth(0.15, -0.15, s));
      sleeves(b, d, lod, 'top', 0.55 * ua, 0.012, { puff: 0.28, cuff: 'topDark', cuffW: 0.02 });
      // peter-pan collar
      for (const [t0, t1] of [[0.06, 0.95], [Math.PI * 2 - 0.95, Math.PI * 2 - 0.06]] as const) {
        shell('shirt', 0.9, 1.005, (s) => off + 0.003 + 0.02 * smooth(1.0, 0.9, s), { theta0: t0, theta1: t1, ringCount: 4 });
      }
      buttons(b, d, lod, '#fbf7ef|plastic', 0.25, 0.82, 4, off + 0.002);
      return;
    }
    case 'varsity': {
      const off = 0.022;
      shell('top', -0.12, 1.0, off);
      band(b, d, lod, 'topDark', -0.18, -0.1, off + 0.006, true);
      band(b, d, lod, 'trim', -0.155, -0.135, off + 0.0125);
      band(b, d, lod, 'topDark', 0.93, 1.03, off - 0.002, true);
      band(b, d, lod, 'trim', 0.955, 0.975, off + 0.0065);
      sleeves(b, d, lod, 'trim', ua + la - 0.008, off - 0.004, { cuff: 'topDark', cuffW: 0.04 });
      buttons(b, d, lod, 'trim', 0.0, 0.85, 5, off + 0.003, 0.008);
      if (hi) {
        // chenille "H" patch on the left chest
        const p = chestPoint(d, 0.62, 0.075, off + 0.002);
        const n = new THREE.Vector3(0.35, 0, 1).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        const disc = new THREE.CylinderGeometry(0.034, 0.034, 0.006, 20); disc.deleteAttribute('uv');
        b.add('trim', disc, { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1)), weights: tw });
        const qz = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        const P = new THREE.Vector3(...p).addScaledVector(n, 0.004);
        const bar = (dx: number, dy: number, rot: number, len: number) => {
          const m = new THREE.Matrix4().compose(P.clone().add(new THREE.Vector3(dx, dy, 0).applyQuaternion(qz)), qz.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rot))), new THREE.Vector3(1, 1, 1));
          b.add('topDark', capsuleG(0.0045, len, 2, 6), { matrix: m.multiply(trs([0, 0, 0], [0, 0, 0], [1, 1, 0.6])), weights: tw });
        };
        bar(-0.011, 0, 0, 0.03); bar(0.011, 0, 0, 0.03); bar(0, 0, Math.PI / 2, 0.016);
      }
      return;
    }
    case 'tee':
    default: {
      const off = 0.01;
      shell('top', -0.11, 1.0, off);
      band(b, d, lod, 'topDark', 0.95, 1.025, off - 0.003);
      sleeves(b, d, lod, 'top', 0.45 * ua, off + 0.004, { flare: 0.006, cuff: 'topDark', cuffW: 0.014 });
      if (hi) {
        // little heart print
        const p = chestPoint(d, 0.62, -0.06, off + 0.0015);
        const n = new THREE.Vector3(-0.25, 0, 1).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        for (const sx of [-1, 1]) {
          const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1))
            .multiply(trs([sx * 0.008, 0.004, 0], [0, 0, sx * 0.7], [0.012, 0.02, 0.002]));
          const g = new THREE.SphereGeometry(1, 10, 8); g.deleteAttribute('uv');
          b.add('topLight', g, { matrix: m, weights: tw });
        }
      }
    }
  }
}

// ---------------------------------------------------------------- bottoms
function pelvis(b: GeoBuilder, d: Dims, lod: LodCfg, mat: string, off: number, sTop = 0.2): void {
  b.add(mat, torsoShell(d, lod, { s0: -0.18, s1: sTop, off, capBottom: true, ringCount: 12 }), { weights: torsoWeights(d) });
}

function pantLegs(b: GeoBuilder, d: Dims, lod: LodCfg, mat: string, end: number, off: (t: number) => number, cuff?: { mat: string; w: number; off: number }): void {
  const lw = legWeights(d);
  for (const side of [1, -1] as const) {
    b.add(mat, legShell(d, lod, side, { t0: -0.06, t1: end, off, ringCount: 20 }), { weights: lw });
    if (cuff) b.add(cuff.mat, legShell(d, lod, side, { t0: end - cuff.w, t1: end + 0.003, off: (t) => off(t) + cuff.off, ringCount: 3 }), { weights: lw });
  }
}

/** Keep trousers straight below the knee: offset grows where the calf narrows. */
const straight = (d: Dims, base: number, minR: number) => (t: number) => base + Math.max(0, minR - legR(d, t)) * smooth(d.upperLeg * 0.7, d.upperLeg + 0.1, t);

function belt(b: GeoBuilder, d: Dims, lod: LodCfg, off: number): void {
  band(b, d, lod, '#3b2a20|leather', 0.13, 0.21, off + 0.004);
  if (!lod.high) return;
  const p = chestPoint(d, 0.17, 0, off + 0.008);
  b.add('#d9b45a|metal', roundBoxG(0.04, 0.03, 0.008, 0.004, 1), { matrix: trs(p), weights: torsoWeights(d) });
}

export function buildBottom(b: GeoBuilder, d: Dims, lod: LodCfg, bottom: string, top: string): void {
  const full = d.upperLeg + d.lowerLeg - 0.006;
  if (top === 'dress' && bottom !== 'leggings') return;
  switch (bottom) {
    case 'shorts': {
      pelvis(b, d, lod, 'bottom', 0.013);
      pantLegs(b, d, lod, 'bottom', d.upperLeg * 0.55, (t) => 0.013 + 0.012 * smooth(0.0, d.upperLeg * 0.5, t), { mat: 'bottomDark', w: 0.025, off: 0.003 });
      belt(b, d, lod, 0.013);
      return;
    }
    case 'skirt': {
      pelvis(b, d, lod, 'bottom', 0.01);
      band(b, d, lod, 'bottomDark', 0.14, 0.22, 0.014);
      const yTop = torsoS(d, 0.18);
      const yBot = d.hipJoint - d.upperLeg * 0.62;
      const rings: Ring[] = [];
      const N = lod.high ? 10 : 4;
      for (let i = 0; i <= N; i++) {
        const t = i / N; const y = lerp(yTop, yBot, t);
        const base = torsoRing(d, Math.max(y, torsoS(d, -0.18)), 0.014);
        const fl = Math.pow(t, 0.9) * 0.085;
        rings.push({ c: [0, y, base.c[2]], a: Math.max(base.a, d.hipX + legR(d, 0.1) + 0.01) + fl, b: base.b + fl, bb: (base.bb ?? base.b) + fl, n: lerp(base.n ?? 2, 2.1, t) });
      }
      b.add('bottom', sweep(rings, { u: [1, 0, 0], v: [0, 0, 1], segs: lod.torsoRadial + 8, mod: lod.high ? (th, ri) => 1 + 0.045 * (ri / N) * (Math.abs(((th * 16 / Math.PI) % 2) - 1) - 0.5) : undefined }), { weights: skirtWeights(d, yTop - yBot) });
      return;
    }
    case 'leggings': {
      pelvis(b, d, lod, 'bottom', 0.005);
      pantLegs(b, d, lod, 'bottom', full, () => 0.004);
      band(b, d, lod, 'bottomDark', 0.14, 0.2, 0.008);
      return;
    }
    case 'joggers': {
      pelvis(b, d, lod, 'bottom', 0.016);
      band(b, d, lod, 'bottomDark', 0.13, 0.21, 0.02, true);
      pantLegs(b, d, lod, 'bottom', full - 0.01, (t) => 0.016 + 0.014 * Math.sin(Math.min(1, t / full) * Math.PI) * 0.8, { mat: 'bottomDark', w: 0.04, off: 0.004 });
      if (lod.high) {
        const lw = legWeights(d);
        for (const side of [1, -1] as const) {
          const c = side === 1 ? Math.PI / 2 : Math.PI * 1.5;
          b.add('#f4f1ea|cloth', legShell(d, lod, side, { t0: 0.0, t1: full - 0.05, off: (t) => 0.0175 + 0.014 * Math.sin(Math.min(1, t / full) * Math.PI) * 0.8, theta0: c - 0.09, theta1: c + 0.09, ringCount: 20 }), { weights: lw });
        }
        for (const sx of [0.02, -0.02]) {
          const p = chestPoint(d, 0.15, sx, 0.026);
          b.add('#f4f1ea|cloth', capsuleG(0.0035, 0.06, 2, 5), { matrix: trs([p[0], p[1] - 0.035, p[2]], [0.05, 0, sx > 0 ? -0.1 : 0.1]), weights: torsoWeights(d) });
        }
      }
      return;
    }
    case 'cargo': {
      pelvis(b, d, lod, 'bottom', 0.02);
      pantLegs(b, d, lod, 'bottom', full - 0.012, straight(d, 0.02, 0.064), { mat: 'bottomDark', w: 0.04, off: 0.005 });
      belt(b, d, lod, 0.02);
      for (const side of [1, -1] as const) {
        const t = d.upperLeg * 0.55;
        const r = legR(d, t) + 0.02;
        const p: V3 = [side * (d.hipX + r + 0.004), d.hipJoint - t, 0.01];
        b.add('bottomDark', roundBoxG(0.026, 0.085, 0.075, 0.01, lod.high ? 2 : 1), { matrix: trs(p), bone: side === 1 ? BI.leftUpperLeg : BI.rightUpperLeg });
        if (lod.high) b.add('bottom', roundBoxG(0.03, 0.022, 0.078, 0.008, 1), { matrix: trs([p[0], p[1] + 0.04, p[2]]), bone: side === 1 ? BI.leftUpperLeg : BI.rightUpperLeg });
      }
      return;
    }
    case 'trousers': {
      pelvis(b, d, lod, 'bottom', 0.016);
      pantLegs(b, d, lod, 'bottom', full - 0.004, straight(d, 0.016, 0.066));
      belt(b, d, lod, 0.016);
      return;
    }
    case 'jeans':
    default: {
      pelvis(b, d, lod, 'bottom', 0.013);
      pantLegs(b, d, lod, 'bottom', full - 0.01, straight(d, 0.013, 0.058), { mat: 'bottomLight', w: 0.035, off: 0.004 });
      belt(b, d, lod, 0.013);
    }
  }
}

// ---------------------------------------------------------------- shoes
function sole(d: Dims, lod: LodCfg, half: number, grow: number, toeUp = 0.0): THREE.BufferGeometry {
  const L = d.footLen, W = d.footW / 2 + grow;
  const keys = [[-0.06, 0.66], [-0.03, 0.86], [0.04, 0.9], [0.11, 1.0], [L - 0.07, 0.95], [L - 0.05, 0.72]];
  const rings: Ring[] = [];
  const n = lod.high ? 10 : 5;
  for (let i = 0; i <= n; i++) {
    const z = lerp(-0.062 - grow * 0.5, L - 0.045 + grow * 0.5, i / n);
    let k = 0; while (k < keys.length - 2 && z > keys[k + 1]![0]!) k++;
    const a = keys[k]!, bb = keys[k + 1]!; const t = smooth(a[0]!, bb[0]!, z);
    const w = W * lerp(a[1]!, bb[1]!, t);
    const lift = toeUp * smooth(L - 0.12, L - 0.04, z);
    rings.push({ c: [0, -d.ankle + half + lift, z], a: w, b: half, bb: half, n: 4 });
  }
  const f = rings[0]!, l = rings[rings.length - 1]!;
  return sweep(rings, { u: [1, 0, 0], v: [0, 1, 0], segs: lod.radial + 4, startPole: [0, f.c[1], f.c[2] - 0.01], endPole: [0, l.c[1], l.c[2] + 0.01] });
}

export function buildShoes(b: GeoBuilder, d: Dims, lod: LodCfg, shoes: string): void {
  const lw = legWeights(d);
  for (const side of [1, -1] as const) {
    const fb = side === 1 ? BI.leftFoot : BI.rightFoot;
    const fp = d.bones[side === 1 ? 'leftFoot' : 'rightFoot'];
    const M = new THREE.Matrix4().makeTranslation(fp[0], fp[1], fp[2]);
    const add = (mat: string, g: THREE.BufferGeometry, local?: THREE.Matrix4) => b.add(mat, g, { matrix: local ? M.clone().multiply(local) : M, bone: fb });
    const ankleT = d.upperLeg + d.lowerLeg;
    switch (shoes) {
      case 'boots': {
        add('shoe', footGeometry(d, lod, { grow: 0.011, heightMul: 1.05 }));
        add('sole', sole(d, lod, 0.012, 0.016));
        b.add('shoe', legShell(d, lod, side, { t0: ankleT - 0.16, t1: ankleT + 0.02, off: 0.013, ringCount: 6, capEnd: false }), { weights: lw });
        b.add('shoeDark', legShell(d, lod, side, { t0: ankleT - 0.175, t1: ankleT - 0.15, off: 0.017, ringCount: 2 }), { weights: lw });
        if (lod.high) add('#c9a35a|metal', roundBoxG(0.012, 0.01, 0.01, 0.003, 1), trs([side * 0.04, 0.0, 0.05]));
        break;
      }
      case 'sandals': {
        add('sole', sole(d, lod, 0.007, 0.006));
        add('shoe', footGeometry(d, lod, { grow: 0.0035, z0: 0.07, z1: 0.1 }));
        add('shoe', footGeometry(d, lod, { grow: 0.0035, z0: -0.025, z1: 0.0 }));
        break;
      }
      case 'loafers': {
        add('shoe', footGeometry(d, lod, { grow: 0.008, heightMul: 0.82 }));
        add('sole', sole(d, lod, 0.008, 0.011));
        if (lod.high) add('shoeDark', footGeometry(d, lod, { grow: 0.0105, heightMul: 0.82, z0: 0.07, z1: 0.085 }));
        add('sole', roundBoxG(0.06, 0.02, 0.05, 0.008, 1), trs([0, -d.ankle + 0.012, -0.035]));
        break;
      }
      case 'hightops': {
        add('shoe', footGeometry(d, lod, { grow: 0.011, heightMul: 1.08 }));
        add('sole', sole(d, lod, 0.014, 0.016, 0.004));
        b.add('shoe', legShell(d, lod, side, { t0: ankleT - 0.09, t1: ankleT + 0.02, off: 0.016, ringCount: 4 }), { weights: lw });
        b.add('sole', legShell(d, lod, side, { t0: ankleT - 0.1, t1: ankleT - 0.085, off: 0.019, ringCount: 2 }), { weights: lw });
        if (lod.high) {
          const disc = new THREE.CylinderGeometry(0.018, 0.018, 0.004, 14); disc.deleteAttribute('uv');
          add('sole', disc, trs([side * (d.footW / 2 + 0.012), 0.005, -0.005], [0, 0, Math.PI / 2]));
          add('sole', footGeometry(d, lod, { grow: 0.0125, heightMul: 1.08, z0: d.footLen - 0.1, z1: d.footLen - 0.06 }));
        }
        break;
      }
      case 'sneakers':
      default: {
        add('shoe', footGeometry(d, lod, { grow: 0.01, heightMul: 0.95 }));
        add('sole', sole(d, lod, 0.013, 0.015, 0.004));
        if (lod.high) {
          for (let i = 0; i < 3; i++) add('sole', capsuleG(0.004, 0.032, 2, 5), trs([0, -0.005 + i * 0.006 - 0.0, 0.035 + i * 0.022], [0, 0, Math.PI / 2 + 0.0]).multiply(trs([0, 0, 0], [0.45, 0, 0])));
          add('sole', footGeometry(d, lod, { grow: 0.0115, heightMul: 0.95, z0: -0.06, z1: -0.035 }));
        }
      }
    }
  }
}
