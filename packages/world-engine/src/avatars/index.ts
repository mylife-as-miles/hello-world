/**
 * TEMPORARY STUB avatar API (coordinator scaffold). The Character Systems
 * engineer replaces the implementation but MUST keep these exports/signatures.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { AvatarAppearance } from '@hello-world/contracts';
import type { AvatarLod, HumanBoneName, HumanoidRig } from './rig';
import { normalizeAppearance } from './catalog';

export type { HumanoidRig, HumanBoneName, ExpressionName, AttachSlot, AvatarLod } from './rig';
export { HUMAN_BONES, EXPRESSIONS } from './rig';

export interface AvatarRigOptions { lod?: AvatarLod }

/** Synchronous procedural rig (always succeeds). */
export function createAvatarRig(appearanceInput: AvatarAppearance, _opts: AvatarRigOptions = {}): HumanoidRig {
  const a = normalizeAppearance(appearanceInput);
  const root = new THREE.Group();
  const bones = new Map<HumanBoneName, THREE.Object3D>();
  const skin = new THREE.MeshStandardMaterial({ color: a.skinTone, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: a.outfit.color, roughness: 0.85 });
  const mk = (name: HumanBoneName, parent: THREE.Object3D, pos: [number, number, number]) => {
    const o = new THREE.Object3D(); o.name = name; o.position.set(...pos); parent.add(o); bones.set(name, o); return o;
  };
  const limb = (bone: THREE.Object3D, len: number, r: number, mat: THREE.Material, dir: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
    m.position.copy(dir.clone().multiplyScalar(len / 2));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    m.castShadow = true; bone.add(m);
  };
  const hips = mk('hips', root, [0, 0.95, 0]);
  const spine = mk('spine', hips, [0, 0.1, 0]);
  const chest = mk('chest', spine, [0, 0.2, 0]);
  const neck = mk('neck', chest, [0, 0.25, 0]);
  const head = mk('head', neck, [0, 0.08, 0]);
  const down = new THREE.Vector3(0, -1, 0);
  limb(spine, 0.35, 0.17, cloth, new THREE.Vector3(0, 1, 0));
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin); headMesh.position.y = 0.14; headMesh.castShadow = true; head.add(headMesh);
  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    const ua = mk(`${side}UpperArm`, chest, [0.2 * s, 0.18, 0]);
    limb(ua, 0.24, 0.05, cloth, new THREE.Vector3(s, 0, 0));
    const la = mk(`${side}LowerArm`, ua, [0.27 * s, 0, 0]);
    limb(la, 0.22, 0.045, skin, new THREE.Vector3(s, 0, 0));
    mk(`${side}Hand`, la, [0.25 * s, 0, 0]);
    const ul = mk(`${side}UpperLeg`, hips, [0.09 * s, -0.05, 0]);
    limb(ul, 0.36, 0.07, cloth, down);
    const ll = mk(`${side}LowerLeg`, ul, [0, -0.42, 0]);
    limb(ll, 0.34, 0.06, cloth, down);
    mk(`${side}Foot`, ll, [0, -0.4, 0.04]);
  }
  const hipsRest = hips.position.clone();
  return {
    root, kind: 'procedural', height: 1.75,
    setBoneRotation(bone, q) { bones.get(bone)?.quaternion.copy(q); },
    setHipsOffset(x, y, z) { hips.position.set(hipsRest.x + x, hipsRest.y + y, hipsRest.z + z); },
    setExpression() { /* stub */ },
    getAttachPoint(slot) { return slot === 'back' ? bones.get('chest') ?? null : bones.get(slot) ?? null; },
    update() { /* stub */ },
    dispose() { root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); skin.dispose(); cloth.dispose(); },
  };
}

/** Async loader: VRM when the base model is a VRM, else procedural. Never rejects. */
export async function loadAvatarRig(appearance: AvatarAppearance, opts: AvatarRigOptions = {}): Promise<HumanoidRig> {
  return createAvatarRig(appearance, opts);
}

export function isVrmBase(_baseModelId: string): boolean { return false; }

/** React hook: returns a rig for the appearance, swapping + disposing when it changes. */
export function useAvatarRig(appearance: AvatarAppearance, lod: AvatarLod = 'high'): HumanoidRig | null {
  const key = JSON.stringify(appearance) + lod;
  const [rig, setRig] = useState<HumanoidRig | null>(null);
  useEffect(() => {
    let alive = true; let created: HumanoidRig | null = null;
    void loadAvatarRig(appearance, { lod }).then(r => { if (alive) { created = r; setRig(r); } else r.dispose(); });
    return () => { alive = false; created?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return rig;
}
