/**
 * Realistic avatar loader: photoreal CARLA 0.10 / Epic MetaHuman-derived bodies from the Valdrada dataset
 * (see ./assets/NOTICE.md for licences — CC BY 4.0 + MetaHuman licence: rendering only, never datasets / AI training).
 *
 * The Valdrada body GLBs carry NO glTF skin: they hold three LODs (each an 'opaque' + a 'hair' primitive) with
 * JOINTS_0/WEIGHTS_0 indexing the manifest skeleton, plus per-vertex _SLOT/_CLS/_PART attributes. Textures live in
 * KTX2 2D arrays upstream; the layers our bodies use were extracted offline to small WebP files (assets/tex/aN = albedo
 * layer N, hN = hair layer N). Here we rebuild a plain three.js SkinnedMesh: bones from the manifest rest pose
 * (./bodies.ts), one material group per (slot, UDIM tile), props (_PART >= 10) dropped.
 *
 * The skeleton already rests in a T-pose, faces +Z with its left side on +X and feet on y = 0, i.e. it matches the
 * canonical frame of ../rig.ts. Retarget (three-vrm "normalized rig" style): canonical bone c has local rotation q_c
 * relative to an identity T-pose; its world (rig-root frame) rotation is N_c = N_parent(c) · q_c, and the raw bone's
 * world rotation becomes N_c · R_rest (R_rest = the raw bone's rest world rotation). Unmapped raw bones keep their rest
 * local rotation. Contract: loadRealisticRig never rejects — any failure resolves to null (caller falls back).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AvatarAppearance } from '@hello-world/contracts';
import { HUMAN_BONES, type AttachSlot, type AvatarLod, type ExpressionName, type HumanBoneName, type HumanoidRig } from '../rig';
import { BODIES, SKELETONS, type RealisticBodyData } from './bodies';
export { REALISTIC_BASE_MODELS, REALISTIC_SUPPORT, isRealisticBase } from './catalog';
export type { AppearanceSupport } from './catalog';

const GLB_URLS: Record<string, string> = {
  'mh-elena': new URL('./assets/SK_EuroW_.glb', import.meta.url).href,
  'mh-marco': new URL('./assets/SK_euroM_.glb', import.meta.url).href,
  'mh-amara': new URL('./assets/SK_AfroW_03_GEN23.glb', import.meta.url).href,
  'mh-kenji': new URL('./assets/SK_AsiaM_v2.glb', import.meta.url).href,
};
const texUrl = (file: string): string => new URL(`./assets/tex/${file}.webp`, import.meta.url).href;

/** Canonical bone -> raw Valdrada/CARLA bone name (gen2 + gen3 skeletons share these). */
const BONE_MAP: Partial<Record<HumanBoneName, string>> = {
  hips: 'crl_hips__C', spine: 'crl_spine__C', chest: 'crl_spine01__C', neck: 'crl_neck__C', head: 'crl_Head__C',
  leftShoulder: 'crl_shoulder__L', leftUpperArm: 'crl_arm__L', leftLowerArm: 'crl_foreArm__L', leftHand: 'crl_hand__L',
  rightShoulder: 'crl_shoulder__R', rightUpperArm: 'crl_arm__R', rightLowerArm: 'crl_foreArm__R', rightHand: 'crl_hand__R',
  leftUpperLeg: 'crl_thigh__L', leftLowerLeg: 'crl_leg__L', leftFoot: 'crl_foot__L', leftToes: 'crl_toe__L',
  rightUpperLeg: 'crl_thigh__R', rightLowerLeg: 'crl_leg__R', rightFoot: 'crl_foot__R', rightToes: 'crl_toe__R',
};
/** Canonical hierarchy (parent of each HUMAN_BONES entry, -1 for hips). */
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
  restLocalT: THREE.Vector3[]; restLocalQ: THREE.Quaternion[]; restWorldQ: THREE.Quaternion[]; restWorldP: THREE.Vector3[];
  boneInverses: THREE.Matrix4[]; lods: PartGeo[][];
}

const bodyCache = new Map<string, Promise<BodyAsset | null>>();
const texCache = new Map<string, Promise<THREE.Texture | null>>();
const matCache = new Map<string, THREE.MeshStandardMaterial>();
let loader: GLTFLoader | null = null;

function loadTexture(file: string): Promise<THREE.Texture | null> {
  let p = texCache.get(file);
  if (!p) {
    p = new Promise((resolve) => {
      new THREE.TextureLoader().load(texUrl(file), (t) => {
        t.flipY = false; // glTF UV convention (same orientation as the upstream KTX2 layers)
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; // UDIM tile 1 (u in [1,2)) samples its own layer file
        t.anisotropy = 4;
        t.needsUpdate = true;
        resolve(t);
      }, undefined, () => resolve(null));
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
  if (nrm) { const n = toFloat(nrm, 3); n.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)); n.normalize?.(); geo.setAttribute('normal', n); }
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

async function loadBody(id: string): Promise<BodyAsset | null> {
  const data = BODIES[id], url = GLB_URLS[id];
  if (!data || !url) return null;
  const skel = SKELETONS[data.skeleton];
  if (!skel) return null;
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const lods: PartGeo[][] = [];
  for (let li = 0; li < 3; li++) {
    const node = gltf.scene.getObjectByName('LOD' + li);
    const parts: PartGeo[] = [];
    node?.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const p = buildPart(o as THREE.Mesh, data); if (p) parts.push(p); } });
    lods.push(parts);
    // source geometry is no longer needed once rebuilt
    node?.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  }
  if (!lods[0]!.length) return null;
  const nb = skel.bones.length;
  const restLocalT: THREE.Vector3[] = [], restLocalQ: THREE.Quaternion[] = [], restWorldQ: THREE.Quaternion[] = [], restWorldP: THREE.Vector3[] = [];
  const worldM: THREE.Matrix4[] = [], boneInverses: THREE.Matrix4[] = [];
  for (let i = 0; i < nb; i++) {
    const t = new THREE.Vector3(data.refT[i * 3]!, data.refT[i * 3 + 1]!, data.refT[i * 3 + 2]!);
    const q = new THREE.Quaternion(data.refR[i * 4]!, data.refR[i * 4 + 1]!, data.refR[i * 4 + 2]!, data.refR[i * 4 + 3]!).normalize();
    restLocalT.push(t); restLocalQ.push(q);
    const m = new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1));
    const p = skel.parents[i]!;
    const w = p >= 0 ? worldM[p]!.clone().multiply(m) : m;
    worldM.push(w);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    w.decompose(wp, wq, ws);
    restWorldQ.push(wq); restWorldP.push(wp);
    boneInverses.push(w.clone().invert());
  }
  return { id, data, bones: skel.bones, parents: skel.parents, restLocalT, restLocalQ, restWorldQ, restWorldP, boneInverses, lods };
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
        float hwL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, uHwTint * clamp(hwL * 2.6, 0.0, 1.4), 0.82);
      }`);
  };
  m.customProgramCacheKey = () => 'hw-realistic-tint';
  return m;
}

/* --------------------------------------------------------------------- rig */

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

class RealisticRig implements HumanoidRig {
  readonly root = new THREE.Group();
  readonly kind = 'vrm' as const; // HumanoidRig['kind'] is 'procedural' | 'vrm'; this behaves like a skinned (VRM-style) rig
  readonly realistic = true;
  readonly baseModelId: string;
  readonly height: number;
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
  private readonly attach: Partial<Record<AttachSlot, THREE.Object3D>> = {};
  private dirty = true;

  constructor(private readonly body: BodyAsset, lod: AvatarLod, appearance: AvatarAppearance, textures: Map<string, THREE.Texture | null>) {
    this.baseModelId = body.id;
    const h01 = Number.isFinite(appearance.body?.height) ? Math.min(1, Math.max(0, appearance.body.height)) : 0.5;
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

    const skeleton = new THREE.Skeleton(this.bones, body.boneInverses.map((m) => m.clone()));
    const tint = appearance.outfit?.color ? safeColor(appearance.outfit.color) : null;
    const parts = body.lods[lod === 'low' ? 1 : 0]!.length ? body.lods[lod === 'low' ? 1 : 0]! : body.lods[0]!;
    for (const part of parts) {
      const mats = part.groups.map(({ slot, tile }) => {
        const layer = body.data.layers[slot]! + tile;
        const tex = textures.get((part.hair ? 'h' : 'a') + layer) ?? null;
        const base = baseMaterial(body, slot, tile, part.hair, tex);
        if (tint && !part.hair && body.data.part[slot] === 1 && body.data.cls[slot] === 1) {
          const m = tintedMaterial(base, tint);
          this.ownMaterials.push(m);
          return m;
        }
        return base;
      });
      const mesh = new THREE.SkinnedMesh(part.geo, mats);
      mesh.name = part.hair ? 'realistic-hair' : 'realistic-body';
      mesh.castShadow = true; mesh.receiveShadow = !part.hair;
      mesh.frustumCulled = false;
      this.model.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
    }

    // Proxies for AvatarAnimator's seat solver (it looks up Object3Ds named 'hips' / 'leftLowerLeg').
    const proxy = (name: string, raw: string) => { const i = body.bones.indexOf(raw); if (i < 0) return; const o = new THREE.Object3D(); o.name = name; this.bones[i]!.add(o); };
    proxy('hips', 'crl_hips__C');
    proxy('leftLowerLeg', 'crl_leg__L');
    // Attach points: axes aligned with the rig root at rest, unscaled, small offsets in metres (root frame).
    const mk = (slot: AttachSlot, raw: string, off: [number, number, number]) => {
      const i = body.bones.indexOf(raw); if (i < 0) return;
      const o = new THREE.Object3D(); o.name = 'attach:' + slot;
      const inv = body.restWorldQ[i]!.clone().invert();
      o.quaternion.copy(inv);
      o.position.set(off[0], off[1], off[2]).divideScalar(this.scale).applyQuaternion(inv);
      o.scale.setScalar(1 / this.scale);
      this.bones[i]!.add(o); this.attach[slot] = o;
    };
    mk('head', 'crl_Head__C', [0, 0.2, 0]);
    mk('leftHand', 'crl_hand__L', [0.08, -0.01, 0.01]);
    mk('rightHand', 'crl_hand__R', [-0.08, -0.01, 0.01]);
    mk('back', 'crl_spine01__C', [0, 0.02, -0.16]);
    this.applyPose();
    this.root.updateMatrixWorld(true);
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

  setExpression(_name: ExpressionName, _weight: number): void { /* CARLA bodies ship without morph targets */ }

  getAttachPoint(slot: AttachSlot): THREE.Object3D | null { return this.attach[slot] ?? null; }

  update(_dt: number): void { if (this.dirty) this.applyPose(); }

  private applyPose(): void {
    this.dirty = false;
    // canonical world rotations (rig-root frame)
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
        this.boneWorld[i]!.multiplyQuaternions(this.canonWorld[c]!, B.restWorldQ[i]!);
        if (p >= 0) bone.quaternion.copy(_q.copy(this.boneWorld[p]!).invert()).multiply(this.boneWorld[i]!);
        else bone.quaternion.copy(this.boneWorld[i]!);
      } else {
        bone.quaternion.copy(B.restLocalQ[i]!);
        if (p >= 0) this.boneWorld[i]!.multiplyQuaternions(this.boneWorld[p]!, bone.quaternion);
        else this.boneWorld[i]!.copy(bone.quaternion);
      }
    }
    // hips offset: canonical metres (root frame) -> hips parent's local frame
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
    this.ownMaterials.length = 0;
    // geometries, shared materials and textures stay cached for other residents
  }
}

function safeColor(s: string): THREE.Color | null {
  try { const c = new THREE.Color(); c.set(s); return c; } catch { return null; }
}

/** Ids of the realistic bases this loader can build (all entries of REALISTIC_BASE_MODELS). */
export const REALISTIC_BASE_IDS = Object.keys(GLB_URLS);

/**
 * Build a realistic rig for `appearance.baseModel` (an 'mh-*' id). Resolves null (never rejects) on unknown ids or any
 * load error, so the caller can fall back to the procedural rig.
 */
export async function loadRealisticRig(appearance: AvatarAppearance, opts: { lod?: AvatarLod } = {}): Promise<HumanoidRig | null> {
  const st = stats();
  try {
    const id = appearance?.baseModelId ?? '';
    if (!GLB_URLS[id]) { st.realisticFailed++; return null; }
    const body = await getBody(id);
    if (!body) { st.realisticFailed++; return null; }
    const lod = opts.lod ?? 'high';
    const files = new Set<string>();
    for (const part of body.lods[lod === 'low' ? 1 : 0] ?? []) for (const g of part.groups) files.add((part.hair ? 'h' : 'a') + (body.data.layers[g.slot]! + g.tile));
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
