/**
 * Realistic avatar loader: photoreal bodies from the Valdrada dataset (see ./assets/NOTICE.md for licences):
 *  - 'mh-*': CARLA 0.10 walkers with Epic MetaHuman components — CC BY 4.0 "CARLA Simulator (carla.org)" + MetaHuman
 *    licence (rendering / interactive use only; never for building datasets or training/testing AI).
 *  - 'rb-*': Microsoft Rocketbox Avatar Library bodies, re-bound by Valdrada to the same CARLA skeleton — MIT.
 *
 * The Valdrada body GLBs carry NO glTF skin: they hold three LODs (each an 'opaque' + a 'hair' primitive) whose
 * JOINTS_0/WEIGHTS_0 index the manifest skeleton, plus per-vertex _SLOT/_CLS/_PART attributes. Textures live in KTX2 2D
 * arrays upstream; the layers our bodies use were extracted offline to WebP (assets/tex/[r]aN = albedo layer N,
 * [r]hN = hair layer N, 'r' prefix = Rocketbox arrays). Here we rebuild a plain three.js SkinnedMesh: the bind pose
 * comes from the manifest's inverse bind matrices (./bodies.ts), one material group per (slot, UDIM tile), and props
 * (_PART >= 10: bags, phones) are dropped.
 *
 * Retarget (three-vrm "normalized rig" style). The bodies face +Z with their left on +X and feet on y = 0, like the
 * canonical frame of ../rig.ts. CARLA bodies are bound in a T-pose, Rocketbox bodies in an A-pose; a rest correction K
 * (shortest arc taking upper-arm and forearm directions onto ±X) makes canonical identity a T-pose for both.
 * Canonical bone c with local rotation q_c has world (rig-root frame) rotation N_c = N_parent(c) · q_c; the raw bone's
 * world rotation becomes N_c · K_b · R_b (R_b = bind world rotation). Unmapped raw bones keep their bind local rotation.
 * Contract: loadRealisticRig never rejects — any failure resolves to null (the caller falls back to procedural).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AvatarAppearance } from '@hello-world/contracts';
import { HUMAN_BONES, type AttachSlot, type AvatarLod, type ExpressionName, type HumanBoneName, type HumanoidRig } from '../rig';
import { BODIES, SKELETONS, type RealisticBodyData } from './bodies';
import { GeoBuilder } from '../procedural/geom';
import { buildHeadAccessories } from '../procedural/accessories';
import { RX, RY, RZ, HC } from '../procedural/head';
import { acquireMaterial, releaseMaterial, shade, type Finish } from '../procedural/materials';
export { REALISTIC_BASE_MODELS, REALISTIC_SUPPORT, isRealisticBase, realisticSupportFor } from './catalog';
export type { AppearanceSupport } from './catalog';

const GLB_URLS: Record<string, string> = {
  'mh-elena': new URL('./assets/SK_EuroW_.glb', import.meta.url).href,
  'mh-marco': new URL('./assets/SK_euroM_.glb', import.meta.url).href,
  'mh-amara': new URL('./assets/SK_AfroW_03_GEN23.glb', import.meta.url).href,
  'mh-kenji': new URL('./assets/SK_AsiaM_v2.glb', import.meta.url).href,
  'rb-sofia': new URL('./assets/RB_Female_Adult_01.glb', import.meta.url).href,
  'rb-daniel': new URL('./assets/RB_Male_Adult_01.glb', import.meta.url).href,
  'rb-claire': new URL('./assets/RB_Business_Female_01.glb', import.meta.url).href,
  'rb-james': new URL('./assets/RB_Business_Male_01.glb', import.meta.url).href,
};
const texUrl = (file: string): string => new URL(`./assets/tex/${file}.webp`, import.meta.url).href;

/** Canonical bone -> raw Valdrada/CARLA bone name (gen2 + gen3 skeletons share these; Rocketbox is re-bound to gen2). */
const BONE_MAP: Partial<Record<HumanBoneName, string>> = {
  hips: 'crl_hips__C', spine: 'crl_spine__C', chest: 'crl_spine01__C', neck: 'crl_neck__C', head: 'crl_Head__C',
  leftShoulder: 'crl_shoulder__L', leftUpperArm: 'crl_arm__L', leftLowerArm: 'crl_foreArm__L', leftHand: 'crl_hand__L',
  rightShoulder: 'crl_shoulder__R', rightUpperArm: 'crl_arm__R', rightLowerArm: 'crl_foreArm__R', rightHand: 'crl_hand__R',
  leftUpperLeg: 'crl_thigh__L', leftLowerLeg: 'crl_leg__L', leftFoot: 'crl_foot__L', leftToes: 'crl_toe__L',
  rightUpperLeg: 'crl_thigh__R', rightLowerLeg: 'crl_leg__R', rightFoot: 'crl_foot__R', rightToes: 'crl_toe__R',
};
/** Canonical hierarchy (parent of each HUMAN_BONES entry). */
const CANON_PARENT: Record<HumanBoneName, HumanBoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
};
const CANON_PARENT_IDX = HUMAN_BONES.map((b) => { const p = CANON_PARENT[b]; return p ? HUMAN_BONES.indexOf(p) : -1; });

interface Stats { realisticLoaded: number; realisticFailed: number }
function stats(): Stats {
  const g = globalThis as unknown as { __HW_AVATAR_STATS?: Partial<Stats> & Record<string, unknown> };
  const s = (g.__HW_AVATAR_STATS ??= {});
  s.realisticLoaded ??= 0; s.realisticFailed ??= 0;
  return s as Stats;
}

/* ------------------------------------------------------------------ assets */

interface PartGeo { geo: THREE.BufferGeometry; hair: boolean; groups: { slot: number; tile: number }[] }
interface BodyAsset {
  id: string; data: RealisticBodyData; bones: string[]; parents: number[];
  /** Bind pose, local (relative to parent bone / model) and world (model space). */
  restLocalT: THREE.Vector3[]; restLocalQ: THREE.Quaternion[]; restWorldP: THREE.Vector3[];
  /** Rest world rotation used by the retarget: bind world rotation with the A→T-pose arm correction applied. */
  tposeWorldQ: THREE.Quaternion[];
  boneInverses: THREE.Matrix4[];
  /** [0] = LOD0 (high), [1] = LOD1 (low). */
  lods: PartGeo[][];
  /** Maps the procedural unit head (../procedural/head.ts) onto this scan's cranium (incl. hair), head-bone relative. */
  headFit: { sx: number; sy: number; sz: number; cx: number; cz: number } | null;
}

const bodyCache = new Map<string, Promise<BodyAsset | null>>();
const texCache = new Map<string, Promise<THREE.Texture | null>>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();
let loader: GLTFLoader | null = null;

function loadTexture(file: string): Promise<THREE.Texture | null> {
  let p = texCache.get(file);
  if (!p) {
    p = new Promise((resolve) => {
      try {
        new THREE.TextureLoader().load(texUrl(file), (t) => {
        t.flipY = false; // glTF UV convention (same orientation as the upstream KTX2 layers)
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; // UDIM tile 1 (u in [1,2)) samples its own layer file with u - 1
          t.anisotropy = 4;
          t.needsUpdate = true;
          resolve(t);
        }, undefined, () => { texCache.delete(file); resolve(null); });
      } catch { texCache.delete(file); resolve(null); } // no DOM (Node/tests): untextured fallback colours
    });
    texCache.set(file, p);
  }
  return p;
}

function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.BufferAttribute {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, size);
}

/** Rebuild one primitive: float positions/normals in model space, index reordered into (slot, tile) groups, props dropped. */
function buildPart(mesh: THREE.Mesh, data: RealisticBodyData): PartGeo | null {
  const src = mesh.geometry;
  const slotA = src.getAttribute('_slot'), partA = src.getAttribute('_part'), uvA = src.getAttribute('uv');
  const index = src.index;
  if (!slotA || !uvA || !index) return null;
  const hair = (mesh.material as THREE.Material).name === 'hair';
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    const slot = Math.round(slotA.getX(a));
    if (slot >= 100 || (partA && partA.getX(a) >= 9.5)) continue; // props (bags, phones…) are not part of the body
    const layer = data.layers[slot] ?? -1;
    if (layer < 0) continue;
    const tile = hair ? 0 : Math.max(0, Math.min(1, Math.floor((uvA.getX(a) + uvA.getX(b) + uvA.getX(c)) / 3)));
    const key = slot * 2 + tile;
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(a, b, c);
  }
  if (!buckets.size) return null;
  const geo = new THREE.BufferGeometry();
  mesh.updateWorldMatrix(true, false);
  const pos = toFloat(src.getAttribute('position'), 3);
  pos.applyMatrix4(mesh.matrixWorld);
  geo.setAttribute('position', pos);
  const nrm = src.getAttribute('normal');
  if (nrm) {
    const n = toFloat(nrm, 3);
    n.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
    const a = n.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) { const l = Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!) || 1; a[i]! /= l; a[i + 1]! /= l; a[i + 2]! /= l; }
    geo.setAttribute('normal', n);
  }
  geo.setAttribute('uv', toFloat(uvA, 2));
  geo.setAttribute('skinIndex', src.getAttribute('skinIndex'));
  geo.setAttribute('skinWeight', src.getAttribute('skinWeight'));
  const keys = [...buckets.keys()].sort((x, y) => x - y);
  const total = keys.reduce((s, k) => s + buckets.get(k)!.length, 0);
  const idx = pos.count > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let off = 0;
  const groups: { slot: number; tile: number }[] = [];
  keys.forEach((k, gi) => {
    const arr = buckets.get(k)!;
    idx.set(arr, off);
    geo.addGroup(off, arr.length, gi);
    groups.push({ slot: k >> 1, tile: k & 1 });
    off += arr.length;
  });
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return { geo, hair, groups };
}

/** World-space rest corrections that turn an A-pose arm chain into a T-pose (identity for T-posed bodies). */
function armCorrections(bones: string[], worldP: THREE.Vector3[]): Map<number, THREE.Quaternion> {
  const K = new Map<number, THREE.Quaternion>();
  for (const [s, x] of [['L', 1], ['R', -1]] as const) {
    const ua = bones.indexOf('crl_arm__' + s), fa = bones.indexOf('crl_foreArm__' + s), h = bones.indexOf('crl_hand__' + s);
    if (ua < 0 || fa < 0 || h < 0) continue;
    const target = new THREE.Vector3(x, 0, 0);
    const dUA = worldP[fa]!.clone().sub(worldP[ua]!).normalize();
    const kUA = new THREE.Quaternion().setFromUnitVectors(dUA, target);
    const dFA = worldP[h]!.clone().sub(worldP[fa]!).normalize().applyQuaternion(kUA);
    const kFA = new THREE.Quaternion().setFromUnitVectors(dFA, target).multiply(kUA);
    K.set(ua, kUA); K.set(fa, kFA); K.set(h, kFA.clone());
  }
  return K;
}

/** Bounding box of the head-dominated vertices (scalp + hair) above the skull base, relative to the head joint. */
function fitHead(parts: PartGeo[], bones: string[], worldP: THREE.Vector3[]): BodyAsset['headFit'] {
  const head = bones.indexOf('crl_Head__C');
  if (head < 0) return null;
  const ids = new Set([head, bones.indexOf('crl_eye__L'), bones.indexOf('crl_eye__R')]);
  const J = worldP[head]!;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity, n = 0;
  for (const part of parts) {
    const pos = part.geo.getAttribute('position'), si = part.geo.getAttribute('skinIndex'), sw = part.geo.getAttribute('skinWeight');
    for (let v = 0; v < pos.count; v++) {
      let best = 0, bj = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > best) { best = w; bj = si.getComponent(v, k); } }
      if (!ids.has(bj)) continue;
      const y = pos.getY(v) - J.y;
      maxY = Math.max(maxY, y);
      if (y < 0.07) continue; // cranium only (no jaw / neck / long hair below the ears)
      const x = pos.getX(v) - J.x, z = pos.getZ(v) - J.z;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); n++;
    }
  }
  if (n < 50 || !(maxY > 0.1)) return null;
  // hair compresses under a hat: fit slightly inside the hair volume
  const sx = (0.9 * (maxX - minX)) / 2 / RX, sz = (0.9 * (maxZ - minZ)) / 2 / RZ, sy = (maxY - 0.012) / (HC[1] + RY);
  return { sx, sy, sz, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 - HC[2] * sz };
}

async function loadBody(id: string, buffer?: ArrayBuffer): Promise<BodyAsset | null> {
  const data = BODIES[id], url = GLB_URLS[id];
  if (!data || !url) return null;
  const skel = SKELETONS[data.skeleton];
  if (!skel || data.ibm.length < skel.bones.length * 16) return null;
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = buffer ? await loader.parseAsync(buffer, '') : await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const lods: PartGeo[][] = [];
  for (let li = 0; li < 2; li++) {
    const node = gltf.scene.getObjectByName('LOD' + li);
    const parts: PartGeo[] = [];
    node?.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const p = buildPart(o as THREE.Mesh, data); if (p) parts.push(p); } });
    lods.push(parts);
  }
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  if (!lods[0]!.length) return null;
  // Bind pose from the inverse bind matrices (for CARLA bodies this equals the manifest rest pose; Rocketbox bodies are
  // bound in an A-pose that differs from the manifest's T-pose reference).
  const nb = skel.bones.length;
  const boneInverses: THREE.Matrix4[] = [], worldM: THREE.Matrix4[] = [];
  const restLocalT: THREE.Vector3[] = [], restLocalQ: THREE.Quaternion[] = [], restWorldP: THREE.Vector3[] = [], restWorldQ: THREE.Quaternion[] = [];
  const s = new THREE.Vector3(), m = new THREE.Matrix4();
  for (let i = 0; i < nb; i++) {
    const ibm = new THREE.Matrix4().fromArray(data.ibm, i * 16);
    boneInverses.push(ibm);
    const w = ibm.clone().invert();
    worldM.push(w);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    w.decompose(wp, wq, s);
    restWorldP.push(wp); restWorldQ.push(wq.normalize());
    const p = skel.parents[i]!;
    m.copy(p >= 0 ? worldM[p]! : new THREE.Matrix4()).invert().multiply(w);
    const lt = new THREE.Vector3(), lq = new THREE.Quaternion();
    m.decompose(lt, lq, s);
    restLocalT.push(lt); restLocalQ.push(lq.normalize());
  }
  const K = armCorrections(skel.bones, restWorldP);
  const headFit = fitHead(lods[0]!, skel.bones, restWorldP);
  const tposeWorldQ = restWorldQ.map((q, i) => { const k = K.get(i); return k ? k.clone().multiply(q) : q.clone(); });
  return { id, data, bones: skel.bones, parents: skel.parents, restLocalT, restLocalQ, restWorldP, tposeWorldQ, boneInverses, lods, headFit };
}

function getBody(id: string): Promise<BodyAsset | null> {
  let p = bodyCache.get(id);
  if (!p) {
    p = loadBody(id).catch((e) => { console.warn('[realistic] body failed', id, e); return null; });
    bodyCache.set(id, p);
    void p.then((b) => { if (!b) bodyCache.delete(id); });
  }
  return p;
}

const texName = (body: BodyAsset, hair: boolean, layer: number): string => `${body.data.set === 'rb' ? 'r' : ''}${hair ? 'h' : 'a'}${layer}`;

/* --------------------------------------------------------------- materials */

const CLS_ROUGH = [0.6, 0.88, 0.12, 0.55];

function baseMaterial(body: BodyAsset, slot: number, tile: number, hair: boolean, tex: THREE.Texture | null): THREE.MeshStandardMaterial {
  const key = `${body.id}:${hair ? 'h' : 'o'}:${slot}:${tile}`;
  let m = matCache.get(key);
  if (!m) {
    const cls = hair ? 3 : body.data.cls[slot] ?? 1;
    m = new THREE.MeshStandardMaterial({
      map: tex, color: tex ? 0xffffff : cls === 0 ? 0xc89a7c : 0x777777, roughness: CLS_ROUGH[cls] ?? 0.8, metalness: 0,
      side: hair ? THREE.DoubleSide : THREE.FrontSide, alphaTest: hair ? 0.4 : 0, envMapIntensity: 0.7,
    });
    m.name = `realistic:${key}`;
    matCache.set(key, m);
  }
  return m;
}

/** Garment recolour (Valdrada-style): keep the texture's shading/detail, swap its hue for the outfit colour. */
function tintedMaterial(base: THREE.MeshStandardMaterial, tint: THREE.Color): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = base.name + ':tint';
  const tintU = { value: tint.clone() };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHwTint = tintU;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHwTint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        // luminance keeps folds/stitching; the floor lets dark garments still read as the chosen colour
        float hwL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, uHwTint * clamp(0.22 + hwL * 1.9, 0.0, 1.3), 0.85);
      }`);
  };
  m.customProgramCacheKey = () => 'hw-realistic-tint';
  return m;
}

/* --------------------------------------------------------------------- rig */

/** Head accessories that sit on the cranium (face-bound ones like glasses need the stylised face). */
const HEAD_OK = new Set(['beanie', 'cap', 'crown', 'headphones']);
/** Model-space sphere that contains the body in every animator pose (hips offsets, raised arms, sitting). */
const POSE_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.45);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const IDENTITY = new THREE.Matrix4();

class RealisticRig implements HumanoidRig {
  readonly root = new THREE.Group();
  readonly kind = 'realistic' as const;
  readonly baseModelId: string;
  readonly lod: AvatarLod;
  readonly height: number;
  /** Rest hip / knee heights above the feet (m, root frame) — read by AvatarAnimator's seat solver. */
  readonly hipsHeight: number;
  readonly kneeHeight: number;
  private readonly model = new THREE.Group();
  private readonly bones: THREE.Bone[] = [];
  private readonly canonOf: Int16Array;
  private readonly canonLocal = HUMAN_BONES.map(() => new THREE.Quaternion());
  private readonly canonWorld = HUMAN_BONES.map(() => new THREE.Quaternion());
  private readonly boneWorld: THREE.Quaternion[];
  private readonly hipsIdx: number;
  private readonly hipsOffset = new THREE.Vector3();
  private readonly scale: number;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly sharedTownieMats: THREE.Material[] = [];
  private readonly ownGeos: THREE.BufferGeometry[] = [];
  private readonly attach: Partial<Record<AttachSlot, THREE.Object3D>> = {};
  private dirty = true;

  constructor(private readonly body: BodyAsset, lod: AvatarLod, appearance: AvatarAppearance, textures: Map<string, THREE.Texture | null>) {
    this.baseModelId = body.id;
    this.lod = lod;
    const hRaw = appearance.body?.height;
    const h01 = typeof hRaw === 'number' && Number.isFinite(hRaw) ? Math.min(1, Math.max(0, hRaw)) : 0.5;
    this.height = 1.6 + 0.25 * h01;
    this.scale = this.height / body.data.height;
    this.root.name = 'realistic-avatar';
    this.model.name = 'realistic-model';
    this.model.scale.setScalar(this.scale);
    this.root.add(this.model);

    const nb = body.bones.length;
    for (let i = 0; i < nb; i++) {
      const b = new THREE.Bone();
      b.name = body.bones[i]!;
      b.position.copy(body.restLocalT[i]!);
      b.quaternion.copy(body.restLocalQ[i]!);
      const p = body.parents[i]!;
      (p >= 0 ? this.bones[p]! : this.model).add(b);
      this.bones.push(b);
    }
    this.boneWorld = this.bones.map(() => new THREE.Quaternion());
    this.canonOf = new Int16Array(nb).fill(-1);
    HUMAN_BONES.forEach((c, ci) => { const raw = BONE_MAP[c]; const i = raw ? body.bones.indexOf(raw) : -1; if (i >= 0) this.canonOf[i] = ci; });
    this.hipsIdx = body.bones.indexOf('crl_hips__C');
    const kneeIdx = body.bones.indexOf('crl_leg__L');
    this.hipsHeight = (body.restWorldP[this.hipsIdx]?.y ?? 1) * this.scale;
    this.kneeHeight = (body.restWorldP[kneeIdx]?.y ?? 0.5) * this.scale;

    const skeleton = new THREE.Skeleton(this.bones, body.boneInverses.map((mm) => mm.clone()));
    const tint = body.data.set === 'mh' && appearance.outfit?.color ? safeColor(appearance.outfit.color) : null;
    const li = lod === 'low' && body.lods[1]?.length ? 1 : 0;
    for (const part of body.lods[li]!) {
      const mats = part.groups.map(({ slot, tile }) => {
        const tex = textures.get(texName(body, part.hair, body.data.layers[slot]! + tile)) ?? null;
        const base = baseMaterial(body, slot, tile, part.hair, tex);
        if (tint && !part.hair && body.data.part[slot] === 1 && body.data.cls[slot] === 1) {
          const tm = tintedMaterial(base, tint);
          this.ownMaterials.push(tm);
          return tm;
        }
        return base;
      });
      const mesh = new THREE.SkinnedMesh(part.geo, mats);
      mesh.name = part.hair ? 'realistic-hair' : 'realistic-body';
      mesh.castShadow = true; mesh.receiveShadow = !part.hair;
      mesh.boundingSphere = POSE_BOUNDS.clone(); // generous fixed bounds (any pose, incl. raised arms / sitting) keep culling valid
      this.model.add(mesh);
      mesh.bind(skeleton, IDENTITY);
    }

    // Proxies for AvatarAnimator's seat solver (it looks up Object3Ds named 'hips' / 'leftLowerLeg').
    const proxy = (name: string, raw: string) => { const i = body.bones.indexOf(raw); if (i < 0) return; const o = new THREE.Object3D(); o.name = name; this.bones[i]!.add(o); };
    proxy('hips', 'crl_hips__C');
    proxy('leftLowerLeg', 'crl_leg__L');
    // Attach points: axes aligned with the rig root at the canonical rest, unscaled, offsets in metres (root frame).
    const mk = (slot: AttachSlot, raw: string, off: [number, number, number]) => {
      const i = body.bones.indexOf(raw); if (i < 0) return;
      const o = new THREE.Object3D(); o.name = 'attach:' + slot;
      const inv = body.tposeWorldQ[i]!.clone().invert();
      o.quaternion.copy(inv);
      o.position.set(off[0], off[1], off[2]).divideScalar(this.scale).applyQuaternion(inv);
      o.scale.setScalar(1 / this.scale);
      this.bones[i]!.add(o); this.attach[slot] = o;
    };
    mk('head', 'crl_Head__C', [0, 0.2, 0]);
    mk('leftHand', 'crl_hand__L', [0.08, -0.01, 0.01]);
    mk('rightHand', 'crl_hand__R', [-0.08, -0.01, 0.01]);
    mk('back', 'crl_spine01__C', [0, 0.02, -0.16]);
    this.buildHeadAccessories(appearance, lod);
    this.applyPose();
    this.root.updateMatrixWorld(true);
  }

  /** Hats / crown / headphones from the procedural kit, fitted to this scan's head (same subset as VRM guests). */
  private buildHeadAccessories(a: AvatarAppearance, lod: AvatarLod): void {
    const fit = this.body.headFit, i = this.body.bones.indexOf('crl_Head__C');
    const list = Array.isArray(a.accessories) ? a.accessories.filter((x) => HEAD_OK.has(x)) : [];
    if (!fit || i < 0 || !list.length) return;
    const holder = new THREE.Group();
    holder.name = 'realistic-head-accessories';
    const inv = this.body.tposeWorldQ[i]!.clone().invert();
    holder.quaternion.copy(inv);
    holder.position.set(fit.cx, 0, fit.cz).applyQuaternion(inv);
    holder.scale.set(fit.sx, fit.sy, fit.sz);
    this.bones[i]!.add(holder);
    const outfit = safeColor(a.outfit?.color ?? '') ? `#${safeColor(a.outfit.color)!.getHexString()}` : '#4a6fa5';
    const b = new GeoBuilder(false);
    buildHeadAccessories(b, list, 'bald', lod, '');
    for (const [key, g] of b.build()) {
      const [slot, fin] = key.split('|') as [string, Finish | undefined];
      const color = slot.startsWith('#') ? slot : slot === 'accentDark' ? shade(outfit, -0.3) : outfit;
      const m = acquireMaterial(color, fin ?? 'cloth');
      this.sharedTownieMats.push(m); this.ownGeos.push(g);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      holder.add(mesh);
    }
  }

  setBoneRotation(bone: HumanBoneName, rotation: THREE.Quaternion): void {
    const i = HUMAN_BONES.indexOf(bone);
    if (i < 0) return;
    this.canonLocal[i]!.copy(rotation);
    this.dirty = true;
  }

  setHipsOffset(x: number, y: number, z: number): void {
    this.hipsOffset.set(x, y, z);
    this.dirty = true;
  }

  setExpression(_name: ExpressionName, _weight: number): void { /* these bodies ship without morph targets */ }

  getAttachPoint(slot: AttachSlot): THREE.Object3D | null { return this.attach[slot] ?? null; }

  update(_dt: number): void { if (this.dirty) this.applyPose(); }

  private applyPose(): void {
    this.dirty = false;
    for (let c = 0; c < HUMAN_BONES.length; c++) {
      const p = CANON_PARENT_IDX[c]!;
      if (p < 0) this.canonWorld[c]!.copy(this.canonLocal[c]!);
      else this.canonWorld[c]!.multiplyQuaternions(this.canonWorld[p]!, this.canonLocal[c]!);
    }
    const B = this.body;
    for (let i = 0; i < this.bones.length; i++) {
      const p = B.parents[i]!;
      const bone = this.bones[i]!;
      const c = this.canonOf[i]!;
      if (c >= 0) {
        this.boneWorld[i]!.multiplyQuaternions(this.canonWorld[c]!, B.tposeWorldQ[i]!);
        if (p >= 0) bone.quaternion.copy(_q.copy(this.boneWorld[p]!).invert()).multiply(this.boneWorld[i]!);
        else bone.quaternion.copy(this.boneWorld[i]!);
      } else {
        bone.quaternion.copy(B.restLocalQ[i]!);
        if (p >= 0) this.boneWorld[i]!.multiplyQuaternions(this.boneWorld[p]!, bone.quaternion);
        else this.boneWorld[i]!.copy(bone.quaternion);
      }
    }
    // hips offset: canonical metres (root frame) -> the hips parent's local frame
    const h = this.hipsIdx;
    if (h >= 0) {
      const p = B.parents[h]!;
      _v.copy(this.hipsOffset).divideScalar(this.scale);
      if (p >= 0) _v.applyQuaternion(_q.copy(this.boneWorld[p]!).invert());
      this.bones[h]!.position.copy(B.restLocalT[h]!).add(_v);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.ownMaterials) m.dispose();
    for (const m of this.sharedTownieMats) releaseMaterial(m);
    for (const g of this.ownGeos) g.dispose();
    this.ownMaterials.length = 0; this.sharedTownieMats.length = 0; this.ownGeos.length = 0;
    // geometries, shared materials and textures stay cached for other residents (see disposeRealisticCache)
  }
}

function safeColor(s: string): THREE.Color | null {
  const v = typeof s === 'string' ? s.trim().toLowerCase() : '';
  if (!v) return null;
  try {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v) || /^(rgb|hsl)a?\(/.test(v)) return new THREE.Color().setStyle(v);
    const named = (THREE.Color.NAMES as Record<string, number>)[v];
    return named === undefined ? null : new THREE.Color(named);
  } catch { return null; }
}

/** Ids of the realistic bases this loader can build. */
export const REALISTIC_BASE_IDS: readonly string[] = Object.keys(GLB_URLS);

/** Start fetching/decoding a base (e.g. when the creator shows its card). Never rejects. */
export function preloadRealisticBase(baseModelId: string): Promise<boolean> {
  return GLB_URLS[baseModelId] ? getBody(baseModelId).then((b) => !!b) : Promise.resolve(false);
}

/** Provide a base's GLB bytes yourself (custom cache, offline bundle, Node tests) instead of fetching its URL. */
export function primeRealisticBase(baseModelId: string, glb: ArrayBuffer): Promise<boolean> {
  if (!GLB_URLS[baseModelId]) return Promise.resolve(false);
  const p = loadBody(baseModelId, glb).catch((e) => { console.warn('[realistic] body failed', baseModelId, e); return null; });
  bodyCache.set(baseModelId, p);
  return p.then((b) => { if (!b) bodyCache.delete(baseModelId); return !!b; });
}

/** Drop every cached body/texture/material (e.g. when leaving the world). Live rigs must be disposed first. */
export function disposeRealisticCache(): void {
  for (const p of bodyCache.values()) void p.then((b) => b?.lods.forEach((l) => l.forEach((part) => part.geo.dispose())));
  for (const p of texCache.values()) void p.then((t) => t?.dispose());
  for (const m of matCache.values()) m.dispose();
  bodyCache.clear(); texCache.clear(); matCache.clear();
}

/**
 * Build a realistic rig for `appearance.baseModelId` ('mh-*' / 'rb-*'). Resolves null (never rejects) on unknown ids or
 * any load error, so the caller can fall back to the procedural rig. lod 'high' → LOD0 (~30k verts), 'low' → LOD1 (~10k).
 */
export async function loadRealisticRig(appearance: AvatarAppearance, opts: { lod?: AvatarLod } = {}): Promise<HumanoidRig | null> {
  const st = stats();
  try {
    const id = appearance?.baseModelId ?? '';
    if (!GLB_URLS[id]) { st.realisticFailed++; return null; }
    const body = await getBody(id);
    if (!body) { st.realisticFailed++; return null; }
    const lod: AvatarLod = opts.lod === 'low' ? 'low' : 'high';
    const files = new Set<string>();
    for (const part of body.lods[lod === 'low' && body.lods[1]?.length ? 1 : 0] ?? []) {
      for (const g of part.groups) files.add(texName(body, part.hair, body.data.layers[g.slot]! + g.tile));
    }
    const textures = new Map<string, THREE.Texture | null>();
    await Promise.all([...files].map(async (f) => textures.set(f, await loadTexture(f))));
    const rig = new RealisticRig(body, lod, appearance, textures);
    st.realisticLoaded++;
    return rig;
  } catch (e) {
    console.warn('[realistic] rig failed', e);
    st.realisticFailed++;
    return null;
  }
}
