/**
 * Procedural "Townie" HumanoidRig: a THREE.Bone hierarchy named per
 * HumanBoneName (identity rest rotations, canonical T-pose frame) and ONE
 * merged, vertex-coloured SkinnedMesh per avatar: body, head skin, hair and
 * hats (head parts rigidly skinned to 'head'), with each part's finish
 * (roughness / metalness / emissive) kept per vertex by the shared 'baked'
 * material. Only transparent glasses lenses stay a separate mesh.
 *  - 'high': + the live expressive TownieFace (eyes, lids, brows, mouth, blush) on the head bone.
 *  - 'mid':  same tessellation as high with the face frozen at its neutral rest pose baked into the
 *            merged mesh (1 draw call; expressions / blink are no-ops).
 *  - 'low':  coarse tessellation + eye dots (1 draw call).
 * Geometry (keyed by shape AND baked colours) + materials are cached and shared across residents with the same look.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarAppearance } from '@hello-world/contracts';
import { HUMAN_BONES, type AttachSlot, type AvatarLod, type ExpressionName, type HumanBoneName, type HumanoidRig } from '../rig';
import { BOTTOMS, SHOES, hashString } from '../catalog';
import { buildBodyAccessories, buildHeadAccessories, HATS, HEAD_ACCESSORIES } from './accessories';
import { LOD_HIGH, LOD_LOW, buildSkin } from './body';
import { BI, computeDims, quantBuild, type Dims } from './dims';
import { BLUSH_COLOR, REST_BLUSH, TownieFace, buildStaticFace, noseMatrix, unitSphere, withColor } from './face';
import { GeoBuilder, sphereG, trs } from './geom';
import { buildHair } from './hair';
import { headGeometry, headNormal, headPoint } from './head';
import { FINISH_PBR, acquireMaterial, contrastOf, releaseMaterial, shade, type Finish } from './materials';
import { TOP_OFFSET, buildBottom, buildShoes, buildTop, coverageFor } from './outfits';

const PARENT: Record<HumanBoneName, HumanBoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
};

// ---------------------------------------------------------------- geometry cache
interface GeoEntry { geos: Map<string, THREE.BufferGeometry>; refs: number }
const geoCache = new Map<string, GeoEntry>();
const idle: string[] = [];
const MAX_IDLE = 40;
function acquireGeo(key: string, make: () => Map<string, THREE.BufferGeometry>): Map<string, THREE.BufferGeometry> {
  let e = geoCache.get(key);
  if (!e) { e = { geos: make(), refs: 0 }; geoCache.set(key, e); }
  const i = idle.indexOf(key); if (i >= 0) idle.splice(i, 1);
  e.refs++;
  return e.geos;
}
function releaseGeo(key: string): void {
  const e = geoCache.get(key); if (!e) return;
  e.refs--;
  if (e.refs <= 0) {
    idle.push(key);
    while (idle.length > MAX_IDLE) {
      const k = idle.shift()!; const old = geoCache.get(k);
      if (old && old.refs <= 0) { for (const g of old.geos.values()) g.dispose(); geoCache.delete(k); }
    }
  }
}

const headSkinCache: Partial<Record<'high' | 'low', THREE.BufferGeometry>> = {};
function headSkin(lod: 'high' | 'low'): THREE.BufferGeometry {
  const c = headSkinCache[lod]; if (c) return c;
  const b = new GeoBuilder(false);
  b.add('skin', headGeometry(lod));
  // ears
  for (const side of [1, -1]) {
    const ph = side * 1.5, el = -0.1;
    const p = headPoint(ph, el, -0.004);
    const n = headNormal(ph, el);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(n[0], 0, n[2]).normalize());
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * 0.35, side * 0.12)));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(0.02, 0.036, 0.027));
    b.add('skin', sphereG(lod === 'high' ? 14 : 6, lod === 'high' ? 10 : 4), { matrix: m });
    if (lod === 'high') {
      const inner = new THREE.Matrix4().compose(new THREE.Vector3(p[0] + n[0] * 0.007, p[1] + 0.002, p[2] + n[2] * 0.007 - 0.002), q, new THREE.Vector3(0.008, 0.024, 0.016));
      b.add('skin', sphereG(10, 8), { matrix: inner, color: [0.86, 0.8, 0.8] });
    }
  }
  const g = b.build().get('skin')!;
  headSkinCache[lod] = g;
  return g;
}

// ---------------------------------------------------------------- materials
function accentOf(outfit: string): string {
  const c = new THREE.Color(outfit); c.offsetHSL(0.42, 0, 0);
  const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(0.75, Math.max(0.35, hsl.s)), Math.min(0.62, Math.max(0.4, hsl.l)));
  return `#${c.getHexString()}`;
}

function resolveMaterial(key: string, a: AvatarAppearance): [string, Finish] {
  const [slot, f] = key.split('|') as [string, Finish | undefined];
  if (slot.startsWith('#')) return [slot, f ?? 'cloth'];
  const oc = a.outfit.color;
  const bottomColor = BOTTOMS.find(x => x.id === a.outfit.bottom)?.color ?? '#3d5a8a';
  const shoeColor = SHOES.find(x => x.id === a.outfit.shoes)?.color ?? '#f4f4f4';
  const topFinish: Finish = a.outfit.top === 'sweater' ? 'knit' : 'cloth';
  const bottomFinish: Finish = a.outfit.bottom === 'jeans' ? 'denim' : 'cloth';
  const shoeFinish: Finish = a.outfit.shoes === 'boots' || a.outfit.shoes === 'loafers' || a.outfit.shoes === 'sandals' ? 'leather' : 'cloth';
  const accent = accentOf(oc);
  switch (slot) {
    case 'skin': return [a.skinTone, 'skin'];
    case 'hair': return [a.hairColor, 'hair'];
    case 'hairDark': return [shade(a.hairColor, -0.35), 'hair'];
    case 'hairCoil': return [a.hairColor, 'coil'];
    case 'top': return [oc, topFinish];
    case 'topDark': return [shade(oc, -0.28), topFinish];
    case 'topLight': return [shade(oc, 0.38), topFinish];
    case 'trim': return [contrastOf(oc), 'cloth'];
    case 'shirt': return ['#f4f1ea', 'cloth'];
    case 'bottom': return [bottomColor, bottomFinish];
    case 'bottomDark': return [shade(bottomColor, -0.3), bottomFinish];
    case 'bottomLight': return [shade(bottomColor, 0.22), bottomFinish];
    case 'shoe': return [shoeColor, shoeFinish];
    case 'shoeDark': return [shade(shoeColor, -0.35), shoeFinish];
    case 'sole': {
      const s: Record<string, string> = { sneakers: '#f7f5f0', hightops: '#f7f5f0', boots: '#2a211b', loafers: '#3a2a20', sandals: '#c9a27a' };
      return [s[a.outfit.shoes] ?? '#f7f5f0', 'rubber'];
    }
    case 'accent': return [accent, f ?? 'cloth'];
    case 'accentDark': return [shade(accent, -0.3), f ?? 'cloth'];
    default: return ['#ff00ff', 'cloth'];
  }
}

/**
 * Merge per-material geometries into one, multiplying each part's vertex colours by its material colour and writing
 * its finish response into the per-vertex `pbr` attribute read by the shared 'baked' material. Transparent lenses
 * are left out (the caller keeps them as their own mesh).
 */
function bakeColors(geos: Map<string, THREE.BufferGeometry>, a: AvatarAppearance): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [key, g] of geos) {
    const [hex, finish] = resolveMaterial(key, a);
    if (finish === 'lens' || finish === 'baked') continue;
    const c = new THREE.Color(hex);
    const pbr = FINISH_PBR[finish] ?? FINISH_PBR.cloth;
    const gg = g.clone();
    const col = gg.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
    const pb = new Float32Array(col.count * 3);
    for (let i = 0; i < col.count; i++) { pb[i * 3] = pbr[0]; pb[i * 3 + 1] = pbr[1]; pb[i * 3 + 2] = pbr[2]; }
    gg.setAttribute('pbr', new THREE.BufferAttribute(pb, 3));
    parts.push(gg);
  }
  const merged = mergeGeometries(parts, false) ?? parts[0]!;
  for (const p of parts) if (p !== merged) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Local-space culling bounds covering every pose of a Townie (feet at y=0, height <= ~2.1 m with arms up). */
const TOWNIE_POSE_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.5);

/** sRGB-space colour mix: matches how the high face's transparent blush blends over the skin on screen. */
function mixSrgb(a: string, b: string, t: number): string {
  const A = { r: 0, g: 0, b: 0 }, B = { r: 0, g: 0, b: 0 };
  new THREE.Color(a).getRGB(A, THREE.SRGBColorSpace); new THREE.Color(b).getRGB(B, THREE.SRGBColorSpace);
  return `#${new THREE.Color().setRGB(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t, THREE.SRGBColorSpace).getHexString()}`;
}

/** Shared per-vertex-PBR material key of every merged Townie mesh (all LODs, all residents). */
const BAKED_MATERIAL = '#ffffff|baked';
/** Builder slots whose colour gets baked; their resolved colours are part of the merged-geometry cache key. */
const BAKED_SLOTS = ['skin', 'hair', 'hairDark', 'hairCoil', 'top', 'topDark', 'topLight', 'trim', 'shirt', 'bottom', 'bottomDark', 'bottomLight', 'shoe', 'shoeDark', 'sole', 'accent', 'accentDark'];

// ---------------------------------------------------------------- rig
export interface TownieOptions { lod?: AvatarLod; seed?: string }

export function createTownieRig(a: AvatarAppearance, opts: TownieOptions = {}): HumanoidRig {
  const lod: AvatarLod = opts.lod === 'low' || opts.lod === 'mid' ? opts.lod : 'high';
  const low = lod === 'low';
  /** Tessellation level of the shared part builders: 'mid' uses the high-detail shapes. */
  const geoLod: 'high' | 'low' = low ? 'low' : 'high';
  const L = low ? LOD_LOW : LOD_HIGH;
  const d: Dims = computeDims(a.baseModelId, a.body.build);
  const root = new THREE.Group();
  root.name = 'TownieRig';
  const bones = new Map<HumanBoneName, THREE.Bone>();
  for (const name of HUMAN_BONES) {
    const bone = new THREE.Bone(); bone.name = name;
    const p = d.bones[name]; const parent = PARENT[name];
    const pp = parent ? d.bones[parent] : [0, 0, 0];
    bone.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    bones.set(name, bone);
    (parent ? bones.get(parent)! : root).add(bone);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(HUMAN_BONES.map(n => bones.get(n)!));

  const usedMats: THREE.Material[] = [];
  const mat = (key: string) => { const [c, f] = resolveMaterial(key, a); const m = acquireMaterial(c, f); usedMats.push(m); return m; };

  // --- body
  const o = a.outfit;
  const bodyAcc = a.accessories.filter(x => !HEAD_ACCESSORIES.has(x)).sort();
  const bodyKey = `body|${d.key}|${o.top}|${o.bottom}|${o.shoes}|${bodyAcc.join(',')}|${geoLod}`;
  const buildBodyInto = (b: GeoBuilder) => {
    buildSkin(b, d, L, coverageFor(o, d));
    buildTop(b, d, L, o.top, o.bottom);
    buildBottom(b, d, L, o.bottom, o.top);
    buildShoes(b, d, L, o.shoes);
    buildBodyAccessories(b, d, L, bodyAcc, TOP_OFFSET[o.top] ?? 0.012);
  };
  const headAcc = a.accessories.filter(x => HEAD_ACCESSORIES.has(x)).sort();
  const hat = headAcc.some(x => HATS.has(x));
  const faceParams = {
    eyeScale: 0.8 + a.face.eyeSize * 0.48,
    noseScale: 0.65 + Math.round(a.face.noseSize * 20) / 20 * 0.8,
    mouthScale: 0.72 + a.face.mouthSize * 0.62,
    eyeColor: a.face.eyeColor,
  };
  const skinKey = 'skin';
  /** Head content in unit-head space (headContent frame): head skin + ears, hair, hats; low: eye dots; high: nose; mid: whole resting face. */
  const buildHeadInto = (b: GeoBuilder) => {
    b.add(skinKey, headSkin(geoLod));
    if (low) {
      const eyeR = 0.0272 * (0.8 + a.face.eyeSize * 0.48);
      for (const side of [1, -1]) {
        const ph = side * 0.41, el = -0.075;
        const n = headNormal(ph, el);
        const c = headPoint(ph, el, -eyeR * 0.3);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0] * 0.5, 0, 1).normalize());
        b.add('#1c1414|dark', sphereG(8, 6), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...c), q, new THREE.Vector3(eyeR * 0.62, eyeR * 0.85, eyeR * 0.45)) });
      }
    } else if (lod === 'high') {
      b.add(skinKey, unitSphere(16, 12), { matrix: noseMatrix(faceParams.noseScale) });
    } else {
      buildStaticFace(b, faceParams, {
        skin: skinKey, brow: `${shade(a.hairColor, -0.25)}|hair`, eye: '#ffffff|eye', mouth: '#6b2a35|mouth', glow: '#ffffff|glow',
        blush: `${mixSrgb(a.skinTone, BLUSH_COLOR, REST_BLUSH)}|skin`,
      });
    }
    buildHair(b, a.hairStyle, geoLod, hat);
    buildHeadAccessories(b, headAcc, a.hairStyle, geoLod, '');
  };
  // ONE merged SkinnedMesh per avatar (+ a lens mesh with glasses): body + head parts (rigidly skinned to 'head'),
  // every colour baked into vertex colours, every finish into the per-vertex `pbr` attribute; one material shared
  // by all residents. The cache key covers shape AND every baked colour.
  const colourSig = BAKED_SLOTS.map(k => resolveMaterial(k, a)[0]).join(',');
  const faceSig = low ? `${a.face.eyeColor}|${Math.round(a.face.eyeSize * 10)}`
    : lod === 'high' ? `${faceParams.noseScale.toFixed(3)}`
    : `${a.face.eyeColor}|${faceParams.eyeScale.toFixed(3)}|${faceParams.noseScale.toFixed(3)}|${(Math.round(faceParams.mouthScale * 20) / 20).toFixed(2)}`;
  const key = `merged2|${lod}|${bodyKey}|${a.hairStyle}|${headAcc.join(',')}|${colourSig}|${faceSig}`;
  const geoKeys: string[] = [key];
  const bodyGeos = acquireGeo(key, () => {
    const sb = new GeoBuilder(true);
    buildBodyInto(sb);
    const hb = new GeoBuilder(false);
    buildHeadInto(hb);
    const hp = d.bones.head;
    const headM = new THREE.Matrix4().compose(new THREE.Vector3(hp[0], hp[1], hp[2]), new THREE.Quaternion(), new THREE.Vector3(d.headScale, d.headScale, d.headScale));
    for (const [k, g] of hb.build()) { sb.add(k, g, { matrix: headM, bone: BI.head }); g.dispose(); }
    const src = sb.build();
    const out = new Map<string, THREE.BufferGeometry>([[BAKED_MATERIAL, bakeColors(src, a)]]);
    // transparent glasses lenses stay their own mesh (high / mid); distant low-detail residents drop them
    for (const [k, g] of src) { if (!low && resolveMaterial(k, a)[1] === 'lens') out.set(k, g); else g.dispose(); }
    return out;
  });
  const identity = new THREE.Matrix4();
  for (const [k, g] of bodyGeos) {
    const m = new THREE.SkinnedMesh(g, mat(k));
    const lens = k !== BAKED_MATERIAL;
    m.name = lens ? `townie-lens:${k}` : `townie-body:${lod}`;
    m.castShadow = !lens; m.receiveShadow = false;
    if (lens) m.renderOrder = 2;
    root.add(m);
    m.bind(skeleton, identity);
    // Fixed, generous local bounds (any pose incl. raised arms / sitting). three.js computes a
    // SkinnedMesh's sphere lazily ONCE from current bone matrices; if that happens before the
    // moving root's matrixWorld is refreshed the sphere is offset and the body gets culled while
    // its label stays visible. Fixed bounds keep frustum culling valid (same as realistic rigs).
    m.boundingSphere = TOWNIE_POSE_BOUNDS.clone();
  }

  // --- head
  const headBone = bones.get('head')!;
  const headContent = new THREE.Group(); headContent.name = 'headContent';
  headContent.scale.setScalar(d.headScale);
  headBone.add(headContent);

  // --- face (high only: live expressions; the nose is static and already merged above)
  const face = lod !== 'high' ? null : new TownieFace('high', { ...faceParams, mouthScale: 0.72 + a.face.mouthSize * 0.62, nose: false }, {
    skin: mat('skin'), brow: mat(`${shade(a.hairColor, -0.25)}|hair`), eye: mat('#ffffff|eye'),
    mouth: mat('#6b2a35|mouth'), teeth: mat('#fbf8f2|teeth'), dark: mat('#1c1414|dark'), highlight: mat('#ffffff|glow'),
  }, hashString(opts.seed ?? JSON.stringify(a)));
  if (face) headContent.add(face.group);

  // --- attach points
  const attach: Record<AttachSlot, THREE.Object3D> = {
    head: new THREE.Object3D(), leftHand: new THREE.Object3D(), rightHand: new THREE.Object3D(), back: new THREE.Object3D(),
  };
  attach.head.position.set(0, 0.255, 0.01); headContent.add(attach.head);
  attach.leftHand.position.set(0.06 * d.handScale, -0.03, 0); bones.get('leftHand')!.add(attach.leftHand);
  attach.rightHand.position.set(-0.06 * d.handScale, -0.03, 0); bones.get('rightHand')!.add(attach.rightHand);
  attach.back.position.set(0, -0.02, -0.16); bones.get('upperChest')!.add(attach.back);
  for (const [k, v] of Object.entries(attach)) v.name = `attach:${k}`;

  // --- height
  const hScale = 0.88 + a.body.height * 0.24;
  root.scale.setScalar(hScale);
  const height = d.top * hScale;
  void quantBuild; void trs; void withColor;

  const hips = bones.get('hips')!;
  const hipsRest = hips.position.clone();
  let disposed = false;
  const rig: HumanoidRig = {
    root, kind: 'procedural', height,
    setBoneRotation(bone, q) { const b = bones.get(bone); if (b) b.quaternion.copy(q); },
    setHipsOffset(x, y, z) { hips.position.set(hipsRest.x + x, hipsRest.y + y, hipsRest.z + z); },
    setExpression(name: ExpressionName, w: number) { face?.setExpression(name, w); },
    getAttachPoint(slot) { return attach[slot] ?? null; },
    update(dt) { if (!disposed) face?.update(Math.min(0.1, Math.max(0, dt))); },
    dispose() {
      if (disposed) return; disposed = true;
      root.removeFromParent();
      for (const k of geoKeys) releaseGeo(k);
      for (const m of usedMats) releaseMaterial(m);
      face?.dispose();
      skeleton.dispose();
    },
  };
  return rig;
}
