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
  /** vertical bumps (curly/afro) */
  bumps?: number;
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
      if (o.bumps) off += o.bumps * (0.5 + 0.5 * Math.sin(phi * 9 + el * 3) * Math.sin(el * 11 + phi * 2));
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

function hairShade(lowEl = -0.6, depth = 0.25) {
  return (x: number, y: number, z: number): V3 => {
    const el = Math.atan2(y - HC[1], Math.hypot(x - HC[0], z - HC[2]));
    const s = 1 - depth + depth * smooth(lowEl, 1.1, el);
    return [s, s, s];
  };
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

const STD_LINE = [[0, 0.5], [0.55, 0.44], [1.05, 0.12], [1.45, -0.02], [1.75, -0.12], [2.4, -0.55], [Math.PI, -0.72]];
const SLEEK_LINE = [[0, 0.52], [0.55, 0.46], [1.05, 0.14], [1.45, -0.02], [1.75, -0.1], [2.4, -0.5], [Math.PI, -0.66]];

export function buildHair(b: GeoBuilder, styleIn: string, lod: Lod, hat: boolean): void {
  const style = hat && (styleIn === 'afro') ? 'curly' : styleIn;
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
      add(capGeometry({ line: STD_LINE, off: vol(0.012, hat ? 0.004 : 0.016), grooves: 28, grooveDepth: 0.0035 }, lod));
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
      }, lod));
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
      }, lod));
      add(lock([[0.62, 0.95, 0.018], [0.4, 0.62, 0.022], [0.32, 0.42, 0.012]], 0.04, 0.02, 0.012, lod));
      add(lock([[-0.2, 0.95, 0.018], [-0.36, 0.7, 0.022], [-0.5, 0.45, 0.014], [-0.7, 0.3, 0.008]], 0.04, 0.018, 0.012, lod));
      return;
    }
    case 'ponytail': {
      add(capGeometry({ line: SLEEK_LINE, off: vol(0.009, 0.006), grooves: 36, grooveDepth: 0.0025 }, lod));
      if (!hat || true) {
        const tie: V3 = [0, HC[1] + 0.07, HC[2] - 0.13];
        b.add('#2d2a3a|plastic', new THREE.TorusGeometry(0.022, 0.009, 6, hi ? 16 : 8).deleteAttribute('uv'), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...tie), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, 0)), new THREE.Vector3(1, 1, 1)) });
        add(pathTube([[0, tie[1] + 0.01, tie[2] + 0.03], [0, tie[1], tie[2] - 0.01], [0, tie[1] - 0.03, tie[2] - 0.06], [0, tie[1] - 0.13, tie[2] - 0.075], [0, tie[1] - 0.25, tie[2] - 0.05]],
          (s) => { const r = 0.034 * Math.sin(Math.min(1, s * 1.4 + 0.25) * Math.PI) * (1 - s * 0.55) + 0.006; return [r, r * 0.85]; }, hi ? 12 : 6, hi ? 14 : 5), hairShade(-1.4, 0.2));
      }
      return;
    }
    case 'bun': {
      add(capGeometry({ line: SLEEK_LINE, off: vol(0.009, 0.006), grooves: 36, grooveDepth: 0.0025 }, lod));
      if (!hat) {
        const top = headPoint(Math.PI, 1.15, 0.045);
        sphereAt(b, H, top, [0.056, 0.05, 0.056], lod, hairShade(0, 0.2));
        b.add('#2d2a3a|plastic', new THREE.TorusGeometry(0.04, 0.007, 6, hi ? 18 : 8).deleteAttribute('uv'), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(top[0], top[1] - 0.035, top[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, 0, 0)), new THREE.Vector3(1, 1, 1)) });
      }
      return;
    }
    case 'curly': {
      add(capGeometry({ line: STD_LINE, off: vol(0.022, hat ? 0.0 : 0.012), grooves: 0, bumps: 0.006 }, lod));
      if (hi && !hat) {
        let k = 0;
        for (let ring = 0; ring < 4; ring++) {
          const el = lerp(0.45, 1.2, ring / 3.2);
          const n = Math.round(lerp(13, 5, ring / 3));
          for (let i = 0; i < n; i++) {
            const phi = -Math.PI + ((i + (ring % 2) * 0.5) / n) * Math.PI * 2;
            const elc = Math.max(el, lineAt(STD_LINE, Math.abs(phi)) + 0.12);
            const r = 0.024 + 0.006 * ((k++ * 37) % 5) / 5;
            sphereAt(b, H, headPoint(phi, elc, 0.02), r, lod, hairShade(-0.4, 0.2));
          }
        }
      }
      return;
    }
    case 'afro': {
      add(capGeometry({ line: [[0, 0.5], [0.6, 0.42], [1.1, 0.0], [1.5, -0.25], [Math.PI, -0.62]], off: (_p, el) => 0.05 + 0.03 * smooth(-0.4, 0.9, el), grooves: 0, bumps: 0.012 }, lod), hairShade(-0.6, 0.3));
      if (hi) {
        for (let i = 0; i < 26; i++) {
          const phi = -Math.PI + ((i * 0.618) % 1) * Math.PI * 2;
          const el = lerp(0.1, 1.3, ((i * 0.382) % 1));
          if (Math.abs(phi) < 0.8 && el < 0.7) continue;
          sphereAt(b, H, headPoint(phi, el, 0.07), 0.04, lod, hairShade(-0.6, 0.25));
        }
      }
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
      add(capGeometry({ line: SLEEK_LINE, off: (phi) => 0.009 - 0.004 * Math.exp(-(phi * phi) / 0.004), grooves: 36, grooveDepth: 0.0025 }, lod));
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
