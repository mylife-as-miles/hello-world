/**
 * VRM "guest skin" adapter: loads a bundled VRM (GLTFLoader + VRMLoaderPlugin)
 * and exposes it as a HumanoidRig driven through three-vrm NORMALIZED bones.
 * VRM 0.x models are rotated with VRMUtils.rotateVRM0 (to face +Z), so bone
 * rotations / hips offsets get their x/z components negated.
 * Only imported dynamically (keeps three-vrm out of the procedural path).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AvatarAppearance } from '@hello-world/contracts';
import { HUMAN_BONES, type AttachSlot, type AvatarLod, type ExpressionName, type HumanBoneName, type HumanoidRig } from '../rig';
import { GeoBuilder } from '../procedural/geom';
import { buildHeadAccessories } from '../procedural/accessories';
import { acquireMaterial, releaseMaterial, shade, type Finish } from '../procedural/materials';

/** Bundled CC0 VRM files (see ../assets/CREDITS.md). */
export const VRM_FILES: Record<string, string> = {
  'vrm-polybot': new URL('../assets/polybot.vrm', import.meta.url).href,
  'vrm-astrodisco': new URL('../assets/astrodisco.vrm', import.meta.url).href,
  'vrm-coffee': new URL('../assets/coffee.vrm', import.meta.url).href,
  'vrm-chill': new URL('../assets/chill.vrm', import.meta.url).href,
};

const buffers = new Map<string, Promise<ArrayBuffer>>();
function fetchBuffer(url: string): Promise<ArrayBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.arrayBuffer(); });
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  }
  return p;
}

// cap concurrent parses (many residents may join at once)
let active = 0; const queue: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(r => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

const MAP: Partial<Record<ExpressionName, string[]>> = {
  happy: ['happy'], sad: ['sad'], angry: ['angry'], surprised: ['surprised'], relaxed: ['relaxed'],
  blink: ['blink'], aa: ['aa'], oh: ['oh'], neutral: ['neutral'],
};

const HEAD_OK = new Set(['beanie', 'cap', 'crown', 'headphones']);

/** VRM guest skins have a single LOD: every requested level ('high' / 'mid' / 'low') builds the full model. */
export async function loadVrmRig(a: AvatarAppearance, _opts: { lod?: AvatarLod } = {}): Promise<HumanoidRig> {
  const url = VRM_FILES[a.baseModelId];
  if (!url) throw new Error(`unknown VRM base ${a.baseModelId}`);
  const buf = await fetchBuffer(url);
  const gltf = await withSlot(async () => {
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    return loader.parseAsync(buf.slice(0), '');
  });
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm || !vrm.humanoid) throw new Error('file has no VRM humanoid');
  const isV0 = vrm.meta?.metaVersion === '0';
  try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch { /* optional */ }
  try { VRMUtils.combineSkeletons(gltf.scene); } catch { /* optional */ }
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; } });

  const root = new THREE.Group(); root.name = 'VrmRig';
  root.add(vrm.scene);
  vrm.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const rawHeight = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
  const scale = (1.62 * (0.88 + a.body.height * 0.24)) / rawHeight;
  root.scale.setScalar(scale);

  const bones = new Map<HumanBoneName, THREE.Object3D>();
  for (const n of HUMAN_BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(n as VRMHumanBoneName);
    if (node) { node.name = n; bones.set(n, node); }
  }
  const hips = bones.get('hips');
  const hipsRest = hips ? hips.position.clone() : new THREE.Vector3();
  const sx = isV0 ? -1 : 1;
  const q = new THREE.Quaternion();

  // expressions
  const em = vrm.expressionManager;
  const has = (n: string) => !!em?.getExpression(n);
  const weights: Partial<Record<ExpressionName, number>> = {};
  let blinkT = 0, nextBlink = 1 + Math.random() * 3, blinkPhase = -1;
  const setExpr = (name: ExpressionName, w: number) => {
    if (!em) return;
    if (name === 'blink' && !has('blink')) { if (has('blinkLeft')) em.setValue('blinkLeft', w); if (has('blinkRight')) em.setValue('blinkRight', w); return; }
    for (const n of MAP[name] ?? []) if (has(n)) em.setValue(n, w);
  };

  // attach points + head accessories
  const attach: Partial<Record<AttachSlot, THREE.Object3D>> = {};
  const headNode = bones.get('head');
  const usedMats: THREE.Material[] = [];
  const ownedGeos: THREE.BufferGeometry[] = [];
  if (headNode) {
    headNode.updateWorldMatrix(true, false);
    const hw = new THREE.Vector3().setFromMatrixPosition(headNode.matrixWorld);
    const headH = Math.max(0.12, box.max.y - hw.y);
    const holder = new THREE.Group(); holder.name = 'vrmHeadContent';
    holder.scale.setScalar(headH / 0.24);
    if (isV0) holder.rotation.y = Math.PI;
    headNode.add(holder);
    const at = new THREE.Object3D(); at.position.set(0, 0.255, 0); holder.add(at); attach.head = at;
    const acc = a.accessories.filter(x => HEAD_OK.has(x));
    if (acc.length) {
      const b = new GeoBuilder(false);
      buildHeadAccessories(b, acc, 'bald', 'high', '');
      for (const [key, g] of b.build()) {
        const [slot, fin] = key.split('|') as [string, Finish | undefined];
        const color = slot.startsWith('#') ? slot : slot === 'accentDark' ? shade(a.outfit.color, -0.3) : a.outfit.color;
        const m = acquireMaterial(color, fin ?? 'cloth'); usedMats.push(m); ownedGeos.push(g);
        const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; holder.add(mesh);
      }
    }
  }
  for (const slot of ['leftHand', 'rightHand'] as const) {
    const n = bones.get(slot); if (!n) continue;
    const o = new THREE.Object3D(); o.position.set(slot === 'leftHand' ? 0.06 : -0.06, -0.02, 0); n.add(o); attach[slot] = o;
  }
  const chest = bones.get('upperChest') ?? bones.get('chest') ?? bones.get('spine');
  if (chest) { const o = new THREE.Object3D(); o.position.set(0, 0, -0.15 * sx); chest.add(o); attach.back = o; }

  let disposed = false;
  return {
    root, kind: 'vrm', height: rawHeight * scale,
    setBoneRotation(bone, rot) {
      const n = bones.get(bone); if (!n) return;
      if (isV0) { q.set(-rot.x, rot.y, -rot.z, rot.w); n.quaternion.copy(q); } else n.quaternion.copy(rot);
    },
    setHipsOffset(x, y, z) { if (hips) hips.position.set(hipsRest.x + x * sx, hipsRest.y + y, hipsRest.z + z * sx); },
    setExpression(name, w) { weights[name] = w; },
    getAttachPoint(slot) { return attach[slot] ?? null; },
    update(dt) {
      if (disposed) return;
      blinkT += dt; let auto = 0;
      if (blinkPhase < 0 && blinkT > nextBlink) blinkPhase = 0;
      if (blinkPhase >= 0) { blinkPhase += dt / 0.16; auto = Math.sin(Math.min(1, blinkPhase) * Math.PI); if (blinkPhase >= 1) { blinkPhase = -1; blinkT = 0; nextBlink = 2 + Math.random() * 3; } }
      for (const [k, v] of Object.entries(weights) as Array<[ExpressionName, number]>) if (k !== 'blink') setExpr(k, v);
      setExpr('blink', Math.max(weights.blink ?? 0, auto));
      vrm.update(dt);
    },
    dispose() {
      if (disposed) return; disposed = true;
      root.removeFromParent();
      for (const m of usedMats) releaseMaterial(m);
      for (const g of ownedGeos) g.dispose();
      VRMUtils.deepDispose(vrm.scene);
    },
  };
}
