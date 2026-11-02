/**
 * Public avatar API.
 *  - createAvatarRig: synchronous procedural "Townie" rig (never throws)
 *  - loadAvatarRig:   VRM guest skin when the base model is a VRM, else procedural (never rejects)
 *  - useAvatarRig:    React hook; returns the instant procedural rig while a VRM loads
 */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { AvatarAppearance } from '@hello-world/contracts';
import type { AvatarLod, HumanBoneName, HumanoidRig } from './rig';
import { HUMAN_BONES } from './rig';
import { BASE_MODELS, normalizeAppearance } from './catalog';
import { createTownieRig } from './procedural/townie';
import { isRealisticBase, realisticSupportFor, type AppearanceSupport } from './realistic/catalog';

export type { AppearanceSupport } from './realistic/catalog';
export { isRealisticBase } from './realistic/catalog';

export type { HumanoidRig, HumanBoneName, ExpressionName, AttachSlot, AvatarLod } from './rig';
export { HUMAN_BONES, EXPRESSIONS } from './rig';

export interface AvatarRigOptions { lod?: AvatarLod }

interface AvatarStats { vrmLoaded: number; vrmFailed: number; proceduralBuilt: number }
function stats(): AvatarStats {
  const g = globalThis as unknown as { __HW_AVATAR_STATS?: AvatarStats };
  g.__HW_AVATAR_STATS ??= { vrmLoaded: 0, vrmFailed: 0, proceduralBuilt: 0 };
  return g.__HW_AVATAR_STATS;
}

const disposed = new WeakSet<HumanoidRig>();
function track(rig: HumanoidRig): HumanoidRig {
  const inner = rig.dispose.bind(rig);
  rig.dispose = () => { if (disposed.has(rig)) return; disposed.add(rig); inner(); };
  return rig;
}

/** Synchronous procedural rig (always succeeds). */
export function createAvatarRig(appearanceInput: AvatarAppearance, opts: AvatarRigOptions = {}): HumanoidRig {
  const a = normalizeAppearance(appearanceInput);
  stats().proceduralBuilt++;
  try {
    return track(createTownieRig(a, { lod: opts.lod }));
  } catch (err) {
    console.error('[avatars] Townie build failed, using fallback figure', err);
    return track(fallbackRig(a));
  }
}

export function isVrmBase(baseModelId: string): boolean {
  return typeof baseModelId === 'string' && (BASE_MODELS.some(m => m.id === baseModelId && m.kind === 'vrm') || baseModelId.startsWith('vrm-'));
}

/** Async loader: VRM when the base model is a VRM, else procedural. Never rejects. */
export async function loadAvatarRig(appearance: AvatarAppearance, opts: AvatarRigOptions = {}): Promise<HumanoidRig> {
  const a = normalizeAppearance(appearance);
  if (isRealisticBase(a.baseModelId)) {
    try {
      const mod = await import('./realistic');
      const r = await mod.loadRealisticRig(a, opts);
      if (r) return track(r);
    } catch (err) {
      console.warn('[avatars] realistic load failed, falling back to procedural Townie', err);
    }
    return createAvatarRig({ ...a, baseModelId: 'townie-classic' }, opts);
  }
  if (!isVrmBase(a.baseModelId)) return createAvatarRig(a, opts);
  try {
    const mod = await import('./vrm/vrmRig');
    const rig = await mod.loadVrmRig(a, opts);
    stats().vrmLoaded++;
    return track(rig);
  } catch (err) {
    stats().vrmFailed++;
    console.warn('[avatars] VRM load failed, falling back to procedural Townie', err);
    return createAvatarRig({ ...a, baseModelId: 'townie-classic' }, opts);
  }
}

/** Which appearance fields visibly apply to a base model (creator greys out the rest). */
export function getAppearanceSupport(baseModelId: string): AppearanceSupport {
  if (isRealisticBase(baseModelId)) return { ...realisticSupportFor(baseModelId) };
  if (isVrmBase(baseModelId)) return { skinTone: false, hair: false, outfitColor: false, outfitPieces: false, face: false, body: true, accessories: true };
  return { skinTone: true, hair: true, outfitColor: true, outfitPieces: true, face: true, body: true, accessories: true };
}

/** Bases loaded asynchronously (VRM guest skins, realistic scans). */
function isAsyncBase(id: string): boolean { return isVrmBase(id) || isRealisticBase(id); }

function appearanceKey(a: AvatarAppearance): string {
  try { return JSON.stringify(normalizeAppearance(a)); } catch { return 'invalid'; }
}

/** React hook: returns a rig for the appearance, swapping + disposing when it changes. */
export function useAvatarRig(appearance: AvatarAppearance, lodIn: AvatarLod = 'high'): HumanoidRig | null {
  // VRM guest skins have a single LOD: don't re-parse the file when the renderer flips high/low.
  const lod: AvatarLod = isVrmBase(normalizeAppearance(appearance).baseModelId) ? 'high' : lodIn;
  const key = appearanceKey(appearance) + '|' + lod;
  const vrm = isAsyncBase(normalizeAppearance(appearance).baseModelId);
  // Instant procedural rig (also used as a placeholder while a VRM loads).
  const initial = useMemo(() => ({ key, rig: createAvatarRig(vrm ? { ...normalizeAppearance(appearance), baseModelId: 'townie-classic' } : appearance, { lod }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]);
  const [current, setCurrent] = useState(initial);
  useEffect(() => {
    let alive = true;
    let proc = initial.rig;
    if (disposed.has(proc)) proc = createAvatarRig(vrm ? { ...normalizeAppearance(appearance), baseModelId: 'townie-classic' } : appearance, { lod });
    let active: HumanoidRig = proc;
    setCurrent({ key, rig: proc });
    if (vrm) {
      void loadAvatarRig(appearance, { lod }).then(r => {
        if (!alive) { r.dispose(); return; }
        // swap the placeholder for the loaded rig (or its procedural fallback)
        active = r; setCurrent({ key, rig: r });
        setTimeout(() => proc.dispose(), 60);
      });
    }
    return () => { alive = false; active.dispose(); if (active !== proc) proc.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const rig = current.key === key ? current.rig : initial.rig;
  return disposed.has(rig) && rig === initial.rig && current.key === key ? current.rig : rig;
}

// ---------------------------------------------------------------- emergency fallback
function fallbackRig(a: AvatarAppearance): HumanoidRig {
  const root = new THREE.Group();
  const bones = new Map<HumanBoneName, THREE.Object3D>();
  const skin = new THREE.MeshStandardMaterial({ color: a.skinTone, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: a.outfit.color, roughness: 0.85 });
  const pos: Record<HumanBoneName, [number, number, number]> = {
    hips: [0, 0.95, 0], spine: [0, 0.1, 0], chest: [0, 0.15, 0], upperChest: [0, 0.12, 0], neck: [0, 0.13, 0], head: [0, 0.08, 0],
    leftShoulder: [0.04, 0.08, 0], leftUpperArm: [0.12, 0, 0], leftLowerArm: [0.26, 0, 0], leftHand: [0.24, 0, 0],
    rightShoulder: [-0.04, 0.08, 0], rightUpperArm: [-0.12, 0, 0], rightLowerArm: [-0.26, 0, 0], rightHand: [-0.24, 0, 0],
    leftUpperLeg: [0.09, -0.05, 0], leftLowerLeg: [0, -0.42, 0], leftFoot: [0, -0.4, 0], leftToes: [0, -0.05, 0.1],
    rightUpperLeg: [-0.09, -0.05, 0], rightLowerLeg: [0, -0.42, 0], rightFoot: [0, -0.4, 0], rightToes: [0, -0.05, 0.1],
  };
  const parent: Partial<Record<HumanBoneName, HumanBoneName>> = { spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck', leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm', rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm', leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot', rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot' };
  for (const n of HUMAN_BONES) { const o = new THREE.Object3D(); o.name = n; o.position.set(...pos[n]); bones.set(n, o); (parent[n] ? bones.get(parent[n]!)! : root).add(o); }
  const geo = new THREE.CapsuleGeometry(0.05, 0.25, 4, 8);
  const add = (b: HumanBoneName, m: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(...p); mesh.rotation.set(...r); mesh.castShadow = true; bones.get(b)!.add(mesh); };
  add('spine', cloth, [0, 0.15, 0]); add('chest', cloth, [0, 0.1, 0]);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin); head.position.y = 0.14; bones.get('head')!.add(head);
  for (const s of ['left', 'right'] as const) {
    const k = s === 'left' ? 1 : -1;
    add(`${s}UpperArm`, cloth, [0.13 * k, 0, 0], [0, 0, Math.PI / 2]); add(`${s}LowerArm`, skin, [0.12 * k, 0, 0], [0, 0, Math.PI / 2]);
    add(`${s}UpperLeg`, cloth, [0, -0.2, 0]); add(`${s}LowerLeg`, cloth, [0, -0.2, 0]);
  }
  const hips = bones.get('hips')!; const rest = hips.position.clone();
  return {
    root, kind: 'procedural', height: 1.65,
    setBoneRotation(b, q) { bones.get(b)?.quaternion.copy(q); },
    setHipsOffset(x, y, z) { hips.position.set(rest.x + x, rest.y + y, rest.z + z); },
    setExpression() { /* none */ },
    getAttachPoint(slot) { return slot === 'back' ? bones.get('upperChest') ?? null : bones.get(slot) ?? null; },
    update() { /* none */ },
    dispose() { root.removeFromParent(); geo.dispose(); head.geometry.dispose(); skin.dispose(); cloth.dispose(); },
  };
}
