/**
 * Procedural "Townie" HumanoidRig: a THREE.Bone hierarchy named per
 * HumanBoneName (identity rest rotations, canonical T-pose frame), a merged
 * skinned body (one SkinnedMesh per material), a head group (skin, hair,
 * hats, expressive face) on the head bone. Geometry + materials are cached
 * and shared across residents with the same look.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarAppearance } from '@hello-world/contracts';
import { HUMAN_BONES, type AttachSlot, type AvatarLod, type ExpressionName, type HumanBoneName, type HumanoidRig } from '../rig';
import { BOTTOMS, SHOES, hashString } from '../catalog';
import { buildBodyAccessories, buildHeadAccessories, HATS, HEAD_ACCESSORIES } from './accessories';
import { LOD_HIGH, LOD_LOW, buildSkin } from './body';
import { computeDims, quantBuild, type Dims } from './dims';
import { TownieFace, withColor } from './face';
import { GeoBuilder, sphereG, trs } from './geom';
import { buildHair } from './hair';
import { headGeometry, headNormal, headPoint } from './head';
import { acquireMaterial, contrastOf, releaseMaterial, shade, type Finish } from './materials';
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

let headSkinCache: Partial<Record<AvatarLod, THREE.BufferGeometry>> = {};
function headSkin(lod: AvatarLod): THREE.BufferGeometry {
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

/** Merge per-material geometries into one, multiplying each part's vertex colours by its material colour. */
function bakeColors(geos: Map<string, THREE.BufferGeometry>, a: AvatarAppearance): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [key, g] of geos) {
    const [hex, finish] = resolveMaterial(key, a);
    if (finish === 'lens' || finish === 'glow') continue;
    const c = new THREE.Color(hex);
    const gg = g.clone();
    const col = gg.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
    parts.push(gg);
  }
  const merged = mergeGeometries(parts, false) ?? parts[0]!;
  for (const p of parts) if (p !== merged) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------- rig
export interface TownieOptions { lod?: AvatarLod; seed?: string }

export function createTownieRig(a: AvatarAppearance, opts: TownieOptions = {}): HumanoidRig {
  const lod: AvatarLod = opts.lod === 'low' ? 'low' : 'high';
  const L = lod === 'high' ? LOD_HIGH : LOD_LOW;
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
  const bodyKey = `body|${d.key}|${o.top}|${o.bottom}|${o.shoes}|${bodyAcc.join(',')}|${lod}`;
  const buildBody = () => {
    const b = new GeoBuilder(true);
    buildSkin(b, d, L, coverageFor(o, d));
    buildTop(b, d, L, o.top, o.bottom);
    buildBottom(b, d, L, o.bottom, o.top);
    buildShoes(b, d, L, o.shoes);
    buildBodyAccessories(b, d, L, bodyAcc, TOP_OFFSET[o.top] ?? 0.012);
    return b.build();
  };
  const low = lod === 'low';
  // Low LOD: every colour baked into vertex colours -> ONE skinned draw call sharing one material.
  const sig = `${a.skinTone}|${a.hairColor}|${o.color}|${a.face.eyeColor}|${Math.round(a.face.eyeSize * 10)}`;
  const bodyCacheKey = low ? `baked|${bodyKey}|${sig}` : bodyKey;
  const bodyGeos = acquireGeo(bodyCacheKey, () => {
    const src = buildBody();
    if (!low) return src;
    const baked = bakeColors(src, a);
    for (const g of src.values()) g.dispose();
    return new Map([['#ffffff|cloth', baked]]);
  });
  const identity = new THREE.Matrix4();
  for (const [key, g] of bodyGeos) {
    const m = new THREE.SkinnedMesh(g, mat(key));
    m.name = `townie-body:${key}`;
    m.castShadow = true; m.receiveShadow = false;
    root.add(m);
    m.bind(skeleton, identity);
  }

  // --- head
  const headBone = bones.get('head')!;
  const headContent = new THREE.Group(); headContent.name = 'headContent';
  headContent.scale.setScalar(d.headScale);
  headBone.add(headContent);
  if (!low) {
    const headMesh = new THREE.Mesh(headSkin(lod), mat('skin'));
    headMesh.castShadow = true; headContent.add(headMesh);
  }
  const headAcc = a.accessories.filter(x => HEAD_ACCESSORIES.has(x)).sort();
  const hat = headAcc.some(x => HATS.has(x));
  const hairKey = low ? `bakedHead|${a.hairStyle}|${headAcc.join(',')}|${sig}` : `head|${a.hairStyle}|${headAcc.join(',')}|${lod}`;
  const headGeos = acquireGeo(hairKey, () => {
    const b = new GeoBuilder(false);
    if (low) {
      b.add('skin', headSkin('low'));
      const eyeR = 0.0272 * (0.8 + a.face.eyeSize * 0.48);
      for (const side of [1, -1]) {
        const ph = side * 0.41, el = -0.075;
        const n = headNormal(ph, el);
        const c = headPoint(ph, el, -eyeR * 0.3);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0] * 0.5, 0, 1).normalize());
        b.add('#1c1414|dark', sphereG(8, 6), { matrix: new THREE.Matrix4().compose(new THREE.Vector3(...c), q, new THREE.Vector3(eyeR * 0.62, eyeR * 0.85, eyeR * 0.45)) });
      }
    }
    buildHair(b, a.hairStyle, lod, hat);
    buildHeadAccessories(b, headAcc, a.hairStyle, lod, '');
    const src = b.build();
    if (!low) return src;
    const baked = bakeColors(src, a);
    for (const g of src.values()) g.dispose();
    return new Map([['#ffffff|cloth', baked]]);
  });
  for (const [key, g] of headGeos) {
    const m = new THREE.Mesh(g, mat(key));
    m.castShadow = !key.includes('lens'); m.name = `townie-head:${key}`;
    if (key.includes('lens')) m.renderOrder = 2;
    headContent.add(m);
  }

  // --- face
  const face = low ? null : new TownieFace(lod, {
    eyeScale: 0.8 + a.face.eyeSize * 0.48,
    noseScale: 0.65 + a.face.noseSize * 0.8,
    mouthScale: 0.72 + a.face.mouthSize * 0.62,
    eyeColor: a.face.eyeColor,
  }, {
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
      releaseGeo(bodyKey); releaseGeo(hairKey);
      for (const m of usedMats) releaseMaterial(m);
      face?.dispose();
      skeleton.dispose();
    },
  };
  return rig;
}
