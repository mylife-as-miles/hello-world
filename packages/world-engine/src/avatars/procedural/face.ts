/**
 * Expressive face for Townie avatars (unit-head space, child of `headContent`).
 * High LOD: 3D eyeballs (sclera + iris + pupil + highlight), rotating upper and
 * lower eyelids with lash lines (blink / squint / half-lidded), brows driven by
 * transforms, nose, a morph-target mouth (smile/frown/grr/O/aa/oh) with teeth,
 * and blush. Low LOD: two cheap eye dots. Mid LOD: `buildStaticFace` bakes the
 * same features at their neutral rest pose into the rig's merged mesh (no
 * live expressions), so a high <-> mid swap keeps the face's look.
 */
import * as THREE from 'three';
import type { ExpressionName } from '../rig';
import { GeoBuilder, clamp, lerp, type V3 } from './geom';
import { RX, RY, headPoint, headStrip, headNormal } from './head';

export function withColor(g: THREE.BufferGeometry, rgb: V3 | ((i: number, x: number, y: number, z: number) => V3)): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = typeof rgb === 'function' ? rgb(i, p.getX(i), p.getY(i), p.getZ(i)) : rgb;
    c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export interface FaceParams {
  eyeScale: number; noseScale: number; mouthScale: number; eyeColor: string;
  /** false: the rig merges the (static) nose into its baked mesh (see `noseMatrix`) instead of a separate mesh. */
  nose?: boolean;
}

/** Neutral rest angles of the eyelid pivots (what `update()` computes with every weight at 0). */
const REST_UPPER_LID = -0.5;
const REST_LOWER_LID = 0.85;

// ---------------------------------------------------------------- geometry (cached)
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g;
}
/** Unit sphere with a white colour attribute (all Townie materials use vertex colours). */
export function unitSphere(ws: number, hs: number): THREE.BufferGeometry {
  return cached(`usphere:${ws}:${hs}`, () => { const g = new THREE.SphereGeometry(1, ws, hs); g.deleteAttribute('uv'); return withColor(g, [1, 1, 1]); });
}

/** Both catch-light spheres of one eye in eye units (eye radius 1): one mesh instead of two. */
function highlightGeometry(): THREE.BufferGeometry {
  return cached('eyeHighlights', () => {
    const b = new GeoBuilder(false);
    b.add('g', unitSphere(8, 6), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(0.3, 0.36, 0.9), new THREE.Quaternion(), new THREE.Vector3(0.15, 0.15, 0.15)) });
    b.add('g', unitSphere(6, 4), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(-0.2, -0.26, 0.95), new THREE.Quaternion(), new THREE.Vector3(0.07, 0.07, 0.07)) });
    return b.build().get('g')!;
  });
}

/** Transform of the nose (unitSphere(16, 12)) in face / unit-head space. */
export function noseMatrix(noseScale: number): THREE.Matrix4 {
  const np = headPoint(0, -0.27, -0.006);
  return new THREE.Matrix4().compose(new THREE.Vector3(np[0], np[1], np[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0, 0)),
    new THREE.Vector3(0.02 * noseScale, 0.017 * noseScale, 0.019 * noseScale));
}

/** Unit eyeball (radius 1) with iris/pupil vertex colours; front = +Z. */
function eyeballGeometry(eyeHex: string): THREE.BufferGeometry {
  return cached(`eye:${eyeHex}`, () => {
    const g = new THREE.SphereGeometry(1, 28, 20);
    g.rotateX(Math.PI / 2); // poles on ±Z so iris rings are clean
    g.deleteAttribute('uv');
    const iris = new THREE.Color(eyeHex);
    const irisDark = iris.clone().multiplyScalar(0.35);
    const irisLight = iris.clone().multiplyScalar(2.2).lerp(new THREE.Color(1, 1, 1), 0.03);
    const sclera = new THREE.Color(1.25, 1.22, 1.18); const scleraEdge = new THREE.Color(1.0, 0.92, 0.9);
    const pupil = new THREE.Color('#120d0c');
    const tmp = new THREE.Color();
    return withColor(g, (_i, x, y, z) => {
      const r = Math.hypot(x, y); // distance from the view axis
      if (z > 0 && r < 0.3) return [pupil.r, pupil.g, pupil.b];
      if (z > 0 && r < 0.7) {
        const t = (r - 0.3) / 0.4;
        tmp.copy(irisLight).lerp(iris, t < 0.5 ? t * 2 : 1).lerp(irisDark, t > 0.7 ? (t - 0.7) / 0.3 : 0);
        if (y > 0) tmp.multiplyScalar(0.82 + 0.18 * (1 - y)); // shadow under the lid
        return [tmp.r, tmp.g, tmp.b];
      }
      tmp.copy(sclera).lerp(scleraEdge, clamp(1 - z, 0, 1));
      return [tmp.r, tmp.g, tmp.b];
    });
  });
}

/** Hemisphere shell lid (unit radius). upper: +Y half. Edge ring darkened as a lash line. */
function lidGeometry(upper: boolean): THREE.BufferGeometry {
  return cached(`lid:${upper}`, () => {
    const g = upper ? new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2 + 0.04) : new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, Math.PI / 2 - 0.03, Math.PI / 2 + 0.03);
    g.deleteAttribute('uv');
    return withColor(g, (_i, _x, y, z) => {
      const edge = Math.abs(y); // near equator => near the lid edge
      const dark = upper ? (edge < 0.13 && z > -0.1 ? 1 : 0) : 0;
      const v = 1 - dark * 0.9;
      return upper && dark ? [0.09, 0.07, 0.07] : [v, v * 0.98, v * 0.98];
    });
  });
}

function mouthShapes(): Array<(u: number) => [number, number, number]> {
  // returns [upper, lower, widthMul] in units of half-width
  const sq = (u: number) => Math.sqrt(Math.max(0, 1 - u * u));
  return [
    (u) => { const c = 0.12 * u * u - 0.02; const h = 0.06 * sq(u) + 0.012; return [c + h, c - h, 1]; },           // 0 neutral
    (u) => { const U = 0.22 * u * u + 0.08; return [U, U - 0.75 * Math.pow(sq(u), 0.85) - 0.01, 1.18]; },               // 1 smile (open D)
    (u) => { const c = -0.2 * u * u + 0.06; const h = 0.05 * sq(u) + 0.012; return [c + h, c - h, 0.92]; },          // 2 frown
    (u) => { const c = -0.06 * u * u; const h = 0.16 * sq(u) + 0.01; return [c + h * 0.8, c - h, 0.84]; },          // 3 grr
    (u) => { const h = 0.4 * sq(u); return [h * 0.9, -h, 0.5]; },                                                     // 4 surprised O
    (u) => { const U = 0.12 * sq(u) + 0.04 * u * u; return [U, -0.62 * Math.pow(sq(u), 0.8), 0.9]; },               // 5 aa
    (u) => { const h = 0.34 * sq(u); return [h * 0.9, -h * 1.05, 0.6]; },                                            // 6 oh
  ];
}

const MOUTH_EL = -0.45;
function mouthGeometry(mouthScale: number, teeth: boolean): THREE.BufferGeometry {
  const key = `mouth:${teeth}:${mouthScale.toFixed(2)}`;
  return cached(key, () => {
    const W = 0.027 * mouthScale;
    const NU = 22, NV = 6;
    const shapes = mouthShapes();
    const build = (shape: (u: number) => [number, number, number]): number[] => {
      const pos: number[] = [];
      for (let i = 0; i <= NU; i++) {
        const u = (i / NU) * 2 - 1;
        let [U, L, wm] = shape(u);
        if (teeth) {
          const open = Math.max(0, U - L - 0.16);
          const th = Math.min(0.15, open * 0.4) * Math.sqrt(Math.max(0, 1 - u * u));
          U = U - 0.025 * Math.min(1, open * 8); L = U - th;
          if (L > U) L = U;
        }
        for (let j = 0; j <= NV; j++) {
          const v = j / NV;
          const x = W * wm * u, y = W * lerp(L, U, v);
          pos.push(...headPoint(x / (RX * 0.92), MOUTH_EL + y / RY, teeth ? 0.0024 : 0.0017));
        }
      }
      return pos;
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(build(shapes[0]!), 3));
    const idx: number[] = [];
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    // orientation: face +Z
    g.computeVertexNormals();
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    if (n.getZ(Math.floor(n.count / 2)) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]!; idx[k + 1] = idx[k + 2]!; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    g.morphAttributes.position = shapes.slice(1).map(s => new THREE.Float32BufferAttribute(build(s), 3));
    g.morphTargetsRelative = false;
    withColor(g, [1, 1, 1]);
    return g;
  });
}

function browGeometry(side: 1 | -1, lod: 'high' | 'low'): { g: THREE.BufferGeometry; pivot: V3 } {
  const phi0 = side * 0.17, phi1 = side * 0.66, el0 = 0.235;
  const center = headPoint(side * 0.4, el0 + 0.02, 0);
  const g = cached(`brow:${side}:${lod}`, () => {
    const gg = headStrip(
      (s) => [lerp(phi0, phi1, s), el0 + 0.055 * Math.sin(s * Math.PI * 0.9) - 0.03 * s],
      (s) => lerp(0.036, 0.015, s) * (s < 0.12 ? 0.6 + s * 3.3 : 1),
      0.0008, (s) => 0.0026 * (1 - s * 0.5), lod === 'high' ? 14 : 6, 4, 'el');
    gg.translate(-center[0], -center[1], -center[2]);
    return withColor(gg, [1, 1, 1]);
  });
  return { g, pivot: center };
}

function blushGeometry(): THREE.BufferGeometry {
  return cached('blush', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      const gg = headStrip((s) => [side * lerp(0.48, 0.84, s), -0.32], (s) => 0.1 * Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2)) + 0.002, 0.0011, () => 0, 10, 4, 'el');
      parts.push(gg);
    }
    const pos: number[] = []; const idx: number[] = [];
    for (const p of parts) {
      const base = pos.length / 3; const a = p.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
      const ix = p.index!; for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return withColor(g, [1, 1, 1]);
  });
}

// ---------------------------------------------------------------- controller
export interface FaceMaterials {
  skin: THREE.Material; brow: THREE.Material; eye: THREE.Material; mouth: THREE.Material; teeth: THREE.Material; dark: THREE.Material;
  highlight: THREE.Material;
}

export class TownieFace {
  readonly group = new THREE.Group();
  private weights: Record<ExpressionName, number> = { neutral: 0, happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0, blink: 0, aa: 0, oh: 0 };
  private upperLids: THREE.Object3D[] = [];
  private lowerLids: THREE.Object3D[] = [];
  private eyes: THREE.Object3D[] = [];
  private brows: Array<{ o: THREE.Object3D; side: 1 | -1; rest: THREE.Vector3 }> = [];
  private mouth: THREE.Mesh | null = null;
  private teeth: THREE.Mesh | null = null;
  private blushMat: THREE.MeshStandardMaterial | null = null;
  private blinkT = 0; private nextBlink = 1 + Math.random() * 3; private blinkPhase = -1;
  private gazeT = 0; private gaze = new THREE.Vector2(); private gazeTarget = new THREE.Vector2();
  private rnd: () => number;

  constructor(readonly lod: 'high' | 'low', p: FaceParams, m: FaceMaterials, seed: number) {
    let s = seed || 1;
    this.rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    this.nextBlink = 0.5 + this.rnd() * 3;
    const eyeR = 0.0272 * p.eyeScale;
    for (const side of [1, -1] as const) {
      const ph = side * 0.41, el = -0.075;
      const n = headNormal(ph, el);
      const c = headPoint(ph, el, -eyeR * (lod === 'high' ? 0.6 : 0.75));
      if (lod === 'low') {
        const dot = new THREE.Mesh(unitSphere(10, 8), m.dark);
        dot.position.set(c[0], c[1], c[2]);
        dot.scale.set(eyeR * 0.7, eyeR * 0.95, eyeR * 0.6);
        dot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0] * 0.5, 0, 1).normalize());
        this.group.add(dot);
        continue;
      }
      const pivot = new THREE.Object3D();
      pivot.position.set(c[0], c[1], c[2]);
      pivot.rotation.set(0, side * 0.09, 0);
      this.group.add(pivot);
      const look = new THREE.Object3D(); pivot.add(look); this.eyes.push(look);
      const ball = new THREE.Mesh(eyeballGeometry(p.eyeColor), m.eye); ball.scale.setScalar(eyeR); look.add(ball);
      const hl = new THREE.Mesh(highlightGeometry(), m.highlight); hl.scale.setScalar(eyeR); look.add(hl);
      const up = new THREE.Object3D(); pivot.add(up); this.upperLids.push(up);
      const ul = new THREE.Mesh(lidGeometry(true), m.skin); ul.scale.setScalar(eyeR * 1.09); up.add(ul);
      const lo = new THREE.Object3D(); pivot.add(lo); this.lowerLids.push(lo);
      const ll = new THREE.Mesh(lidGeometry(false), m.skin); ll.scale.setScalar(eyeR * 1.06); lo.add(ll);
    }
    if (lod === 'low') return;
    for (const side of [1, -1] as const) {
      const { g, pivot } = browGeometry(side, lod);
      const o = new THREE.Object3D(); o.position.set(...pivot);
      o.add(new THREE.Mesh(g, m.brow));
      this.group.add(o);
      this.brows.push({ o, side, rest: o.position.clone() });
    }
    // nose (static: the procedural rig merges it into its baked mesh and passes nose: false)
    if (p.nose !== false) {
      const nose = new THREE.Mesh(unitSphere(16, 12), m.skin);
      nose.matrixAutoUpdate = false; nose.matrix.copy(noseMatrix(p.noseScale));
      this.group.add(nose);
    }
    const ms = Math.round(p.mouthScale * 20) / 20;
    this.mouth = new THREE.Mesh(mouthGeometry(ms, false), m.mouth);
    this.teeth = new THREE.Mesh(mouthGeometry(ms, true), m.teeth);
    for (const mm of [this.mouth, this.teeth]) { mm.morphTargetInfluences = new Array(6).fill(0); this.group.add(mm); }
    this.blushMat = new THREE.MeshStandardMaterial({ color: BLUSH_COLOR, roughness: 0.8, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const blush = new THREE.Mesh(blushGeometry(), this.blushMat);
    blush.renderOrder = 1;
    this.group.add(blush);
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  setExpression(name: ExpressionName, w: number): void {
    if (name in this.weights) this.weights[name] = clamp(Number.isFinite(w) ? w : 0, 0, 1);
  }

  update(dt: number): void {
    if (this.lod === 'low') return;
    const W = this.weights;
    // auto blink
    this.blinkT += dt;
    let auto = 0;
    if (this.blinkPhase < 0 && this.blinkT > this.nextBlink) { this.blinkPhase = 0; }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.16;
      auto = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
      if (this.blinkPhase >= 1) { this.blinkPhase = -1; this.blinkT = 0; this.nextBlink = 1.8 + this.rnd() * 3.5; if (this.rnd() < 0.15) this.nextBlink = 0.25; }
    }
    // gaze saccades
    this.gazeT -= dt;
    if (this.gazeT <= 0) { this.gazeT = 1.2 + this.rnd() * 2.8; this.gazeTarget.set((this.rnd() - 0.5) * 0.3, (this.rnd() - 0.5) * 0.14); }
    this.gaze.lerp(this.gazeTarget, Math.min(1, dt * 14));
    for (const e of this.eyes) e.rotation.set(-this.gaze.y, this.gaze.x, 0);

    const blink = Math.max(W.blink, auto);
    let close = 0.55 * W.relaxed + 0.2 * W.sad + 0.22 * W.angry + 0.12 * W.happy - 0.35 * W.surprised;
    close = clamp(close + blink * (1 - close), -0.4, 1);
    const upper = close >= 0 ? lerp(REST_UPPER_LID, 0.2, close) : lerp(REST_UPPER_LID, -0.95, -close);
    const lower = lerp(REST_LOWER_LID, 0.32, clamp(W.happy * 0.85 + W.angry * 0.25 + blink * 0.25, 0, 1));
    for (const u of this.upperLids) u.rotation.x = upper;
    for (const l of this.lowerLids) l.rotation.x = lower;
    for (const b of this.brows) {
      const raise = 0.012 * W.surprised + 0.0035 * W.happy - 0.0055 * W.angry + 0.004 * W.sad + 0.003 * W.relaxed * 0;
      b.o.position.set(b.rest.x - b.side * 0.004 * W.angry, b.rest.y + raise, b.rest.z);
      b.o.rotation.z = b.side * (0.38 * W.angry - 0.32 * W.sad + 0.05 * W.surprised);
    }
    if (this.mouth && this.teeth) {
      const t = [W.happy + 0.3 * W.relaxed, W.sad, W.angry, W.surprised, W.aa, W.oh];
      const sum = t.reduce((a, b) => a + b, 0);
      const k = sum > 1 ? 1 / sum : 1;
      for (let i = 0; i < 6; i++) { const v = t[i]! * k; this.mouth.morphTargetInfluences![i] = v; this.teeth.morphTargetInfluences![i] = v; }
    }
    if (this.blushMat) this.blushMat.opacity = REST_BLUSH + 0.42 * W.happy + 0.12 * W.surprised;
  }

  dispose(): void { this.blushMat?.dispose(); }
}

// ---------------------------------------------------------------- static (mid LOD) face
/** Builder material keys for `buildStaticFace` (resolved by the rig like any other part key). */
export interface StaticFaceKeys { skin: string; brow: string; eye: string; mouth: string; glow: string; blush: string }

/**
 * The high-LOD face frozen at its neutral rest pose (eyes open, gaze ahead, brows at rest, neutral mouth, resting
 * blush pre-blended into an opaque strip), added in unit-head space to a static builder so the rig can merge it with
 * the head into ONE draw call. Same geometry and colours as `TownieFace` at rest => no visible high <-> mid pop.
 */
export function buildStaticFace(b: GeoBuilder, p: FaceParams, k: StaticFaceKeys): void {
  const eyeR = 0.0272 * p.eyeScale;
  const S = (f: number) => new THREE.Matrix4().makeScale(f, f, f);
  for (const side of [1, -1] as const) {
    const c = headPoint(side * 0.41, -0.075, -eyeR * 0.6);
    const pivot = new THREE.Matrix4().compose(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * 0.09, 0)), new THREE.Vector3(1, 1, 1));
    b.add(k.eye, eyeballGeometry(p.eyeColor), { matrix: pivot.clone().multiply(S(eyeR)) });
    b.add(k.glow, highlightGeometry(), { matrix: pivot.clone().multiply(S(eyeR)) });
    b.add(k.skin, lidGeometry(true), { matrix: pivot.clone().multiply(new THREE.Matrix4().makeRotationX(REST_UPPER_LID)).multiply(S(eyeR * 1.09)) });
    b.add(k.skin, lidGeometry(false), { matrix: pivot.clone().multiply(new THREE.Matrix4().makeRotationX(REST_LOWER_LID)).multiply(S(eyeR * 1.06)) });
  }
  for (const side of [1, -1] as const) {
    const { g, pivot } = browGeometry(side, 'high');
    b.add(k.brow, g, { matrix: new THREE.Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]) });
  }
  b.add(k.skin, unitSphere(16, 12), { matrix: noseMatrix(p.noseScale) });
  b.add(k.mouth, mouthGeometry(Math.round(p.mouthScale * 20) / 20, false)); // base shape = neutral (teeth hidden at rest)
  b.add(k.blush, blushGeometry());
}

/** Resting blush opacity of `TownieFace` (all weights 0) — the mid LOD pre-blends this much blush into the skin. */
export const REST_BLUSH = 0.16;
export const BLUSH_COLOR = '#ff8a94';
