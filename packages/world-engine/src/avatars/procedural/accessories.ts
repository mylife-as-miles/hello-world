/**
 * Accessories. Head items are built in unit-head space (static builder on the
 * head bone); body items are skinned rigidly to bones in rig space.
 */
import * as THREE from 'three';
import { BI, torsoAt, torsoS, type Dims } from './dims';
import { GeoBuilder, capsuleG, grid, lerp, pathTube, roundBoxG, smooth, trs, type V3 } from './geom';
import { HC, headNormal, headPoint } from './head';
import type { LodCfg } from './body';
import { hairOffset } from './hair';

export const HEAD_ACCESSORIES = new Set(['glasses', 'sunglasses', 'beanie', 'cap', 'headphones', 'earrings', 'flower', 'crown']);
export const HATS = new Set(['beanie', 'cap']);

/** Extra radial volume of each hair style on top of the head (hats/crowns sit above it). */
export const HAIR_TOP: Record<string, number> = { bald: 0, buzz: 0.004, short: 0.026, bob: 0.028, long: 0.026, ponytail: 0.015, bun: 0.015, curly: 0.034, afro: 0.08, spiky: 0.02, mohawk: 0.004, braids: 0.012 };

const sph = (lod: 'high' | 'low') => { const g = new THREE.SphereGeometry(1, lod === 'high' ? 12 : 6, lod === 'high' ? 9 : 4); g.deleteAttribute('uv'); return g; };
const at = (p: V3, q: THREE.Quaternion, s: V3) => new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
const qn = (n: V3, up: V3 = [0, 0, 1]) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...up), new THREE.Vector3(...n).normalize());

function dome(line: number, back: number, offIn: number | ((phi: number, el: number) => number), lod: 'high' | 'low', ribs = 0): THREE.BufferGeometry {
  const offAt = (phi: number, el: number) => typeof offIn === 'number' ? offIn : offIn(phi, el);
  const keys = [[0, line], [1.2, line - 0.18], [Math.PI, back]];
  return grid((u, v) => {
    const phi = -Math.PI + u * Math.PI * 2; const a = Math.abs(phi);
    const el0 = a < 1.2 ? lerp(keys[0]![1]!, keys[1]![1]!, smooth(0, 1.2, a)) : lerp(keys[1]![1]!, keys[2]![1]!, smooth(1.2, Math.PI, a));
    const el = lerp(Math.PI / 2 - 0.001, el0, v);
    const r = ribs ? 0.002 * Math.cos(phi * ribs) : 0;
    return headPoint(phi, el, offAt(phi, el) + r);
  }, lod === 'high' ? 48 : 16, lod === 'high' ? 14 : 5, { poleTop: headPoint(0, Math.PI / 2, offAt(0, Math.PI / 2)), center: HC });
}

export function buildHeadAccessories(b: GeoBuilder, list: string[], hair: string, lod: 'high' | 'low', accent: string): void {
  const hi = lod === 'high';
  const hat = list.some(x => HATS.has(x));
  const top = hat ? Math.min(HAIR_TOP[hair] ?? 0.02, 0.018) : (HAIR_TOP[hair] ?? 0.02);
  const ho = (phi: number, el: number) => hairOffset(hair, phi, el, hat);
  const hatOff = (base: number) => (phi: number, el: number) => Math.max(base, ho(phi, el) + 0.008);
  for (const id of list) {
    switch (id) {
      case 'glasses':
      case 'sunglasses': {
        const sun = id === 'sunglasses';
        const frame = sun ? '#1d1b22|plastic' : '#2a2430|plastic';
        const r = sun ? 0.03 : 0.027;
        for (const side of [1, -1]) {
          const ph = side * 0.41, el = -0.07;
          const n = headNormal(ph, el);
          const c = headPoint(ph, el, 0.022);
          const q = qn([n[0] * 0.35, 0, 1]);
          const tor = new THREE.TorusGeometry(r, 0.0032, 6, hi ? 22 : 10); tor.deleteAttribute('uv');
          b.add(frame, tor, { matrix: at(c, q, sun ? [1.1, 0.88, 1] : [1, 0.92, 1]) });
          const lens = new THREE.CircleGeometry(r, hi ? 22 : 10); lens.deleteAttribute('uv');
          b.add(sun ? '#141820|shade' : '#dfefff|lens', lens, { matrix: at(c, q, sun ? [1.1, 0.88, 1] : [1, 0.92, 1]) });
          // temple arm to the ear
          const e = headPoint(side * 1.45, -0.02, 0.006);
          const s0: V3 = [c[0] + side * r * 1.0, c[1] + 0.004, c[2] - 0.004];
          b.add(frame, pathTube([s0, [lerp(s0[0], e[0], 0.5) + side * 0.004, lerp(s0[1], e[1], 0.5) + 0.002, lerp(s0[2], e[2], 0.5)], e], () => [0.0028, 0.0028], 5, 6));
        }
        const l = headPoint(0.2, -0.06, 0.026), rr = headPoint(-0.2, -0.06, 0.026);
        b.add(frame, pathTube([l, [0, l[1] + 0.006, l[2] + 0.004], rr], () => [0.0028, 0.0028], 5, 6));
        break;
      }
      case 'beanie': {
        b.add('accent|knit', dome(0.36, -0.42, hatOff(0.032), lod, hi ? 32 : 0), { color: (x, y) => { const s = 0.9 + 0.1 * smooth(0.1, 0.25, y); return [s, s, s]; } });
        // folded brim
        const brim = grid((u, v) => {
          const phi = -Math.PI + u * Math.PI * 2; const a = Math.abs(phi);
          const el0 = a < 1.2 ? lerp(0.36, 0.18, smooth(0, 1.2, a)) : lerp(0.18, -0.42, smooth(1.2, Math.PI, a));
          return headPoint(phi, el0 + 0.16 * (1 - v), hatOff(0.032)(phi, el0 + 0.16 * (1 - v)) + 0.01 + 0.006 * Math.sin(v * Math.PI));
        }, hi ? 48 : 16, hi ? 5 : 2, { center: HC });
        b.add('accentDark|knit', brim);
        const pp = headPoint(0, Math.PI / 2, hatOff(0.032)(0, Math.PI / 2) + 0.022);
        b.add('accentDark|knit', sph(lod), { matrix: at(pp, new THREE.Quaternion(), [0.036, 0.034, 0.036]) });
        break;
      }
      case 'cap': {
        b.add('accent|cloth', dome(0.42, -0.28, hatOff(0.028), lod, hi ? 6 : 0));
        // brim
        const brim = grid((u, v) => {
          const phi = lerp(-0.85, 0.85, u);
          const e = headPoint(phi, 0.42, hatOff(0.028)(phi, 0.42) + 0.002);
          const n = headNormal(phi, 0.2);
          const L = 0.085 * Math.cos(phi * 0.9);
          return [e[0] + n[0] * L * v, e[1] - 0.012 * v * v + 0.004 * v, e[2] + Math.max(0.2, n[2]) * L * v + 0.01 * v];
        }, hi ? 20 : 8, hi ? 5 : 2, { wrapU: false, center: [0, HC[1] + 0.1, HC[2]] });
        b.add('accentDark|cloth', brim);
        b.add('accentDark|cloth', sph(lod), { matrix: at(headPoint(0, Math.PI / 2, hatOff(0.028)(0, Math.PI / 2) + 0.002), new THREE.Quaternion(), [0.012, 0.007, 0.012]) });
        break;
      }
      case 'headphones': {
        const arc: V3[] = [];
        const N = hi ? 16 : 8;
        for (let i = 0; i <= N; i++) {
          const a = lerp(-1.32, 1.32, i / N);
          const phi = a >= 0 ? Math.PI / 2 : -Math.PI / 2; const el = Math.PI / 2 - Math.abs(a);
          arc.push(headPoint(phi, el, ho(phi, el) + 0.013));
        }
        b.add('#2b2d38|plastic', pathTube(arc, () => [0.012, 0.0065], hi ? 8 : 5, hi ? 18 : 6, { up: (p) => [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]] }));
        for (const side of [1, -1]) {
          const phi = side * Math.PI / 2, el = -0.12;
          const p = headPoint(phi, el, ho(phi, el) + 0.016);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
          const cup = new THREE.CylinderGeometry(0.036, 0.036, 0.026, hi ? 20 : 10); cup.deleteAttribute('uv');
          b.add('#2b2d38|plastic', cup, { matrix: at(p, q, [1, 1, 1]) });
          const cap = new THREE.CylinderGeometry(0.027, 0.027, 0.006, hi ? 18 : 8); cap.deleteAttribute('uv');
          b.add('accent|plastic', cap, { matrix: at([p[0] + side * 0.015, p[1], p[2]], q, [1, 1, 1]) });
          const pad = new THREE.TorusGeometry(0.03, 0.008, 6, hi ? 18 : 8); pad.deleteAttribute('uv');
          b.add('#3a3d4a|cloth', pad, { matrix: at([p[0] - side * 0.014, p[1], p[2]], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), [1, 1, 1]) });
        }
        break;
      }
      case 'earrings': {
        for (const side of [1, -1]) {
          const p = headPoint(side * 1.52, -0.36, 0.01);
          const tor = new THREE.TorusGeometry(0.011, 0.0022, 6, hi ? 16 : 8); tor.deleteAttribute('uv');
          b.add('#e2b84f|metal', tor, { matrix: at([p[0] + side * 0.006, p[1] - 0.012, p[2]], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), [1, 1, 1]) });
        }
        break;
      }
      case 'flower': {
        const ph = 0.95, el = 0.55;
        const c = headPoint(ph, el, ho(ph, el) + 0.007);
        const n = headNormal(ph, el);
        const q = qn(n);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const local = new THREE.Vector3(Math.cos(a) * 0.017, Math.sin(a) * 0.017, 0).applyQuaternion(q);
          b.add('#ff9db5|cloth', sph(lod), { matrix: at([c[0] + local.x, c[1] + local.y, c[2] + local.z], q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, a))), [0.016, 0.011, 0.006]) });
        }
        b.add('#ffd84d|cloth', sph(lod), { matrix: at([c[0] + n[0] * 0.004, c[1] + n[1] * 0.004, c[2] + n[2] * 0.004], q, [0.009, 0.009, 0.006]) });
        break;
      }
      case 'crown': {
        const crownTop = headPoint(0, Math.PI / 2, Math.max(ho(Math.PI / 2, 1.15), ho(-Math.PI / 2, 1.15), ho(Math.PI, 1.15)));
        const y = Math.max(HC[1] + 0.105 + (top + 0.012) * 0.5, crownTop[1] - 0.02);
        const rr = crownTop[1] - 0.02 > HC[1] + 0.12 ? 0.07 : 0.085;
        const ring = new THREE.CylinderGeometry(rr, rr * 0.96, 0.03, hi ? 28 : 12, 1, true); ring.deleteAttribute('uv');
        b.add('#f2c542|metal', ring, { matrix: trs([0, y, HC[2] - 0.01]) });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const cone = new THREE.ConeGeometry(0.016, 0.036, hi ? 6 : 4); cone.deleteAttribute('uv');
          b.add('#f2c542|metal', cone, { matrix: trs([Math.sin(a) * rr * 0.98, y + 0.032, HC[2] - 0.01 + Math.cos(a) * rr * 0.98], [Math.cos(a) * -0.18, 0, Math.sin(a) * 0.18]) });
          if (hi) b.add(i % 2 ? '#e3426e|gem' : '#3fb3e0|gem', sph(lod), { matrix: at([Math.sin(a) * (rr + 0.002), y, HC[2] - 0.01 + Math.cos(a) * (rr + 0.002)], new THREE.Quaternion(), [0.007, 0.007, 0.007]) });
        }
        break;
      }
    }
  }
  void accent;
}

export function buildBodyAccessories(b: GeoBuilder, d: Dims, lod: LodCfg, list: string[], topOff: number): void {
  const hi = lod.high;
  for (const id of list) {
    switch (id) {
      case 'scarf': {
        const y = d.neck + 0.005;
        const pts: V3[] = [];
        for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push([Math.sin(a) * (d.neckR + 0.03), y + 0.012 * Math.cos(a), Math.cos(a) * (d.neckR + 0.028) - 0.008]); }
        b.add('accent|knit', pathTube(pts, () => [0.032, 0.026], hi ? 10 : 6, hi ? 24 : 10, { up: () => [0, 1, 0], caps: false }), { bone: BI.upperChest });
        const [, df] = torsoAt(d, torsoS(d, 0.8));
        const tail: V3[] = [[0.03, y - 0.005, d.neckR + 0.03], [0.045, y - 0.07, df * 0.9 + topOff + 0.03], [0.05, y - 0.17, df + topOff + 0.02]];
        b.add('accent|knit', pathTube(tail, (s) => [0.03 + 0.004 * s, 0.009], hi ? 8 : 5, hi ? 8 : 4, { up: () => [0, 0, 1] }), { bone: BI.upperChest });
        if (hi) for (let k = 0; k < 4; k++) b.add('accentDark|knit', capsuleG(0.003, 0.02, 2, 4), { matrix: trs([0.032 + k * 0.012, y - 0.185, df + topOff + 0.02]), bone: BI.upperChest });
        break;
      }
      case 'backpack': {
        const yc = (d.chest + d.upperChest) / 2;
        const [, , db] = torsoAt(d, yc);
        const z = -db - topOff - 0.06;
        b.add('accent|cloth', roundBoxG(0.25, 0.3, 0.11, 0.045, hi ? 3 : 1), { matrix: trs([0, yc, z]), bone: BI.upperChest });
        b.add('accentDark|cloth', roundBoxG(0.18, 0.12, 0.05, 0.02, hi ? 2 : 1), { matrix: trs([0, yc - 0.07, z - 0.065]), bone: BI.upperChest });
        if (hi) b.add('#d9b45a|metal', roundBoxG(0.02, 0.012, 0.01, 0.003, 1), { matrix: trs([0, yc - 0.03, z - 0.091]), bone: BI.upperChest });
        for (const side of [1, -1]) {
          const x = side * 0.085;
          const yTop = torsoS(d, 1.0);
          const [, dfm] = torsoAt(d, torsoS(d, 0.75));
          const pts: V3[] = [[x, yc + 0.13, z + 0.04], [x * 1.05, yTop + 0.01, -0.03], [x * 1.1, yTop + 0.012, 0.03], [x * 1.12, torsoS(d, 0.8), dfm + topOff + 0.006], [x * 1.25, torsoS(d, 0.62), dfm * 0.6 + topOff], [side * 0.15, yc - 0.1, -0.02]];
          b.add('accentDark|cloth', pathTube(pts, () => [0.017, 0.005], hi ? 6 : 4, hi ? 16 : 6, { up: (p) => [p[0] * 0.2, p[1] - torsoS(d, 0.55), p[2]] }), { bone: BI.upperChest });
        }
        break;
      }
      case 'bowtie': {
        const s = 1.0; const y = torsoS(d, 0.965);
        const [, df] = torsoAt(d, y);
        const z = Math.max(df * 0.85, d.neckR + 0.01) + topOff + 0.012;
        for (const side of [1, -1]) {
          const g = new THREE.ConeGeometry(0.024, 0.045, hi ? 10 : 6); g.deleteAttribute('uv');
          b.add('accent|cloth', g, { matrix: trs([side * 0.022, y, z], [0, 0, side * Math.PI / 2], [1, 1, 0.45]), bone: BI.upperChest });
        }
        b.add('accentDark|cloth', roundBoxG(0.016, 0.02, 0.014, 0.006, 1), { matrix: trs([0, y, z + 0.003]), bone: BI.upperChest });
        void s;
        break;
      }
    }
  }
}
