/**
 * Stylised head shape (unit head, origin = head bone; the rig scales a
 * `headContent` group by the preset's head scale). Face features, hair caps
 * and hats are all generated ON this analytic surface so they fit exactly.
 * Angles: phi = azimuth (0 = facing +Z, +phi toward the character's left/+X),
 * el = elevation (-pi/2 chin .. +pi/2 crown).
 */
import * as THREE from 'three';
import { grid, type V3 } from './geom';

export const HC: V3 = [0, 0.106, 0.012]; // head centre relative to head bone
export const RX = 0.118, RY = 0.134, RZ = 0.124;

export function headRaw(phi: number, el: number): V3 {
  const ce = Math.cos(el), se = Math.sin(el);
  const dx = Math.sin(phi) * ce, dy = se, dz = Math.cos(phi) * ce;
  let x = dx * RX, y = dy * RY, z = dz * RZ;
  if (dy < 0) {
    const k = -dy;
    x *= 1 - 0.34 * k * k * (0.6 + 0.4 * Math.max(0, dz));       // jaw narrows toward the chin
    if (dz > 0) z *= 1 - 0.16 * k * k * (1 - 0.5 * dz);           // chin stays forward
    else z *= 1 - 0.42 * k * k;                                   // back of jaw tucks to the neck
    y *= 1 - 0.07 * k;
  }
  // soft cheeks
  const cheek = Math.exp(-((dy + 0.28) ** 2) / 0.035) * Math.max(0, dz) * Math.abs(dx);
  x *= 1 + cheek * 0.1;
  z *= 1 + cheek * 0.05;
  // slightly flatter face plane, fuller cranium at the back/top
  if (dz > 0) z *= 1 - 0.08 * Math.pow(dz, 4) * (dy > -0.2 ? 1 : 0.6);
  if (dz < 0) z *= 1 + 0.1 * Math.max(0, dy + 0.35) * -dz;
  if (dy > 0) y *= 1 + 0.03 * dy;
  return [x + HC[0], y + HC[1], z + HC[2]];
}

const EPS = 1e-3;
/** Outward unit normal of the head surface at (phi, el). */
export function headNormal(phi: number, el: number): V3 {
  const elc = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, el));
  const a = headRaw(phi - EPS, elc), b = headRaw(phi + EPS, elc);
  const c = headRaw(phi, elc - EPS), d = headRaw(phi, elc + EPS);
  const tp: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const te: V3 = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
  let n: V3 = [tp[1] * te[2] - tp[2] * te[1], tp[2] * te[0] - tp[0] * te[2], tp[0] * te[1] - tp[1] * te[0]];
  const p = headRaw(phi, elc);
  const r: V3 = [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]];
  if (n[0] * r[0] + n[1] * r[1] + n[2] * r[2] < 0) n = [-n[0], -n[1], -n[2]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Point on the head surface pushed `off` metres along the normal. */
export function headPoint(phi: number, el: number, off = 0): V3 {
  const p = headRaw(phi, el);
  if (off === 0) return p;
  const n = headNormal(phi, el);
  return [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off];
}

/** Head skin mesh (unit head). */
export function headGeometry(lod: 'high' | 'low'): THREE.BufferGeometry {
  const nu = lod === 'high' ? 48 : 18, nv = lod === 'high' ? 36 : 12;
  return grid((u, v) => headRaw(-Math.PI + u * Math.PI * 2, Math.PI / 2 - v * (Math.PI - 0.02)), nu, nv,
    { poleTop: headRaw(0, Math.PI / 2), center: HC });
}

/**
 * Conforming strip ("raised decal") along a path on the head.
 * path(s) -> [phi, el] centre line; half(s) -> half width (radians of elevation);
 * thick(s) -> raised thickness. Edges tuck down to `off`.
 */
export function headStrip(path: (s: number) => [number, number], half: (s: number) => number, off: number, thick: (s: number) => number, ns = 12, nw = 5, across: 'el' | 'phi' = 'el'): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i <= ns; i++) {
    const s = i / ns; const [ph, el] = path(s); const hw = half(s); const th = thick(s);
    for (let j = 0; j <= nw; j++) {
      const w = (j / nw) * 2 - 1;
      const bump = Math.sqrt(Math.max(0, 1 - w * w));
      const p = across === 'el' ? headPoint(ph, el + w * hw, off + th * bump) : headPoint(ph + w * hw, el, off + th * bump);
      pos.push(...p);
    }
  }
  const idx: number[] = [];
  const cols = nw + 1;
  for (let i = 0; i < ns; i++) for (let j = 0; j < nw; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientAway(g);
  g.computeVertexNormals();
  return g;
}

/** Make triangles face away from the head centre. */
export function orientAway(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute; const ix = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  const C = new THREE.Vector3(...HC);
  let s = 0;
  for (let k = 0; k < ix.count; k += 3) {
    a.fromBufferAttribute(p, ix.getX(k)); b.fromBufferAttribute(p, ix.getX(k + 1)); c.fromBufferAttribute(p, ix.getX(k + 2));
    n.subVectors(b, a).cross(t.subVectors(c, a));
    s += n.dot(t.copy(a).sub(C));
  }
  if (s < 0) {
    const arr = ix.array as unknown as number[];
    for (let k = 0; k < ix.count; k += 3) { const tmp = arr[k + 1]!; arr[k + 1] = arr[k + 2]!; arr[k + 2] = tmp; }
  }
}
