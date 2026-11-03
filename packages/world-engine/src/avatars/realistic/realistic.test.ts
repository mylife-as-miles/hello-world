import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as THREE from 'three';
import type { AvatarAppearance } from '@hello-world/contracts';
import { REALISTIC_BASE_MODELS, isRealisticBase, loadRealisticRig, primeRealisticBase, realisticSupportFor } from './index';
import { BODIES, SKELETONS } from './bodies';

const asset = (rel: string) => new URL(`./assets/${rel}`, import.meta.url);

function appearance(id: string, height = 0.5): AvatarAppearance {
  return {
    baseModelId: id, skinTone: '#c89a7c', hairStyle: 'short', hairColor: '#2a1d14',
    outfit: { top: 'tee', bottom: 'jeans', shoes: 'sneakers', color: '#3a7bd5' }, accessories: ['cap'],
    face: { eyeColor: '#3b2a1a', eyeSize: 0.5, noseSize: 0.5, mouthSize: 0.5 }, body: { height, build: 0.5 },
  };
}

describe('realistic catalog + data', () => {
  it('every base has body data, a shipped GLB and all of its texture layers', () => {
    expect(REALISTIC_BASE_MODELS.length).toBeGreaterThanOrEqual(4);
    for (const b of REALISTIC_BASE_MODELS) {
      expect(b.kind).toBe('realistic');
      expect(isRealisticBase(b.id)).toBe(true);
      const d = BODIES[b.id]!;
      expect(d, b.id).toBeTruthy();
      expect(d.file).toBe(b.file);
      expect(fs.existsSync(asset(d.file)), d.file).toBe(true);
      expect(d.ibm.length).toBe(SKELETONS[d.skeleton]!.bones.length * 16);
      d.layers.forEach((layer, slot) => {
        if (layer < 0 || d.cls[slot] === -1) return;
        const file = `${d.set === 'rb' ? 'r' : ''}${d.cls[slot] === 3 ? 'h' : 'a'}${layer}.webp`;
        expect(fs.existsSync(asset(`tex/${file}`)), `${b.id} slot ${slot} -> ${file}`).toBe(true);
      });
    }
    expect(realisticSupportFor('rb-sofia').outfitColor).toBe(false);
    expect(realisticSupportFor('mh-elena').outfitColor).toBe(true);
  });

  it('never rejects: unknown ids resolve null', async () => {
    await expect(loadRealisticRig(appearance('mh-nope'))).resolves.toBeNull();
  });
});

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const pos = (root: THREE.Object3D, name: string, out: THREE.Vector3) => out.setFromMatrixPosition(root.getObjectByName(name)!.matrixWorld);

it('photoreal hair hooks preserve the WebGL alpha mask without accessing WebGL state on WebGPU', async () => {
  const id = 'mh-elena';
  const bytes = fs.readFileSync(asset(BODIES[id]!.file));
  await primeRealisticBase(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const rig = (await loadRealisticRig({ ...appearance(id), accessories: [] }))!;
  try {
    const mesh = rig.root.getObjectByName('realistic-hair') as THREE.Mesh;
    expect(mesh).toBeTruthy();
    const material = (mesh.material as THREE.Material[]).find(m => m.userData.hwMaskAlpha)!;
    expect(material).toBeTruthy();
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), group = new THREE.Group();
    const draw = (renderer: THREE.WebGLRenderer) => {
      mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, material, group);
      mesh.onAfterRender(renderer, scene, camera, mesh.geometry, material, group);
    };
    const gpu = { isWebGPURenderer: true, get state() { throw new Error('WebGPU has no WebGL state'); },
      getContext() { throw new Error('WebGPU has no WebGL context'); } };
    expect(() => draw(gpu as unknown as THREE.WebGLRenderer)).not.toThrow();
    const calls: unknown[] = [];
    const gl = { isWebGLRenderer: true, state: { buffers: { color: { setMask: (enabled: boolean) => calls.push(enabled) } } },
      getContext: () => ({ colorMask: (...mask: boolean[]) => calls.push(mask) }) };
    draw(gl as unknown as THREE.WebGLRenderer);
    expect(calls).toEqual([true, [true, true, true, false], [true, true, true, true]]);
  } finally { rig.dispose(); }
});

describe.each(['mh-elena', 'rb-sofia'])('realistic rig %s (Node, from GLB bytes)', (id) => {
  it('rebuilds a canonical T-pose rig whose retarget follows the rig.ts sign conventions', { timeout: 60000 }, async () => {
    const buf = fs.readFileSync(asset(BODIES[id]!.file));
    expect(await primeRealisticBase(id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).toBe(true);
    const rig = (await loadRealisticRig(appearance(id, 0.6)))!;
    expect(rig).toBeTruthy();
    expect(rig.kind).toBe('realistic');
    expect(rig.height).toBeGreaterThan(1.6);
    expect(rig.height).toBeLessThan(1.85);
    expect(rig.root.getObjectByName('hips')).toBeTruthy();
    expect(rig.root.getObjectByName('leftLowerLeg')).toBeTruthy();
    expect(rig.root.getObjectByName('realistic-head-accessories')).toBeTruthy();
    const R = rig.root;
    const pose = () => { rig.update(0); R.updateMatrixWorld(true); };

    // canonical identity == T-pose (Rocketbox is bound in an A-pose and must be corrected)
    pose();
    pos(R, 'crl_arm__L', _a); pos(R, 'crl_hand__L', _b);
    expect(_b.x - _a.x).toBeGreaterThan(0.4); // left arm along +X
    expect(Math.abs(_b.y - _a.y)).toBeLessThan(0.05);
    pos(R, 'crl_arm__R', _a); pos(R, 'crl_hand__R', _b);
    expect(_a.x - _b.x).toBeGreaterThan(0.4); // right arm along -X
    pos(R, 'crl_foot__L', _a);
    expect(_a.y).toBeGreaterThan(0); expect(_a.y).toBeLessThan(0.15); // feet on y = 0
    pos(R, 'crl_Head__C', _a);
    expect(_a.y).toBeGreaterThan(rig.height * 0.8);

    // arms down at sides: leftUpperArm z ≈ -1.25
    rig.setBoneRotation('leftUpperArm', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.25)));
    pose();
    pos(R, 'crl_arm__L', _a); pos(R, 'crl_hand__L', _b);
    expect(_b.y - _a.y).toBeLessThan(-0.4);
    // elbow bend: leftLowerArm y < 0 brings the forearm forward (+Z)
    rig.setBoneRotation('leftLowerArm', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.2, 0)));
    pose();
    pos(R, 'crl_foreArm__L', _a); pos(R, 'crl_hand__L', _b);
    expect(_b.z - _a.z).toBeGreaterThan(0.12);
    // hip flexion: upperLeg x < 0 swings the leg forward (+Z)
    rig.setBoneRotation('leftUpperLeg', new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, 0, 0)));
    pose();
    pos(R, 'crl_thigh__L', _a); pos(R, 'crl_foot__L', _b);
    expect(_b.z - _a.z).toBeGreaterThan(0.3);
    // hips offset moves the pelvis in canonical metres
    pos(R, 'crl_hips__C', _a); const y0 = _a.y;
    rig.setHipsOffset(0, -0.2, 0);
    pose();
    pos(R, 'crl_hips__C', _a);
    expect(_a.y - y0).toBeCloseTo(-0.2, 2);
    rig.dispose();
  });
});

describe('HeadEmote (non-facial expressions)', () => {
  it('maps expressions to head/neck gestures; blink does nothing; the happy nod is frame-rate independent', async () => {
    const { HeadEmote } = await import('./headEmote');
    const settle = (e: InstanceType<typeof HeadEmote>, s: number, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) e.update(dt); };
    const e = new HeadEmote();
    e.set('sad', 1); settle(e, 2);
    expect(e.head.x).toBeGreaterThan(0.15); expect(e.neck.x).toBeGreaterThan(0.1); // head down
    e.set('sad', 0); settle(e, 3);
    expect(Math.abs(e.head.x) + Math.abs(e.neck.x)).toBeLessThan(0.005);
    expect(e.active).toBe(false);
    e.set('surprised', 1); settle(e, 0.15);
    expect(e.head.x).toBeLessThan(-0.1); // quick lift back
    e.reset();
    e.set('angry', 1); settle(e, 1.5);
    expect(e.neck.x).toBeGreaterThan(0.1); expect(e.head.x).toBeGreaterThan(0.03); // chin down / forward
    e.reset();
    e.set('blink', 1); settle(e, 1);
    expect(e.head.x === 0 && e.neck.x === 0 && e.head.z === 0).toBe(true);
    const peakNod = (dt: number, steps: number) => {
      const h = new HeadEmote(); let peak = 0;
      for (let k = 1; k <= steps; k++) { h.set('happy', k / steps * 0.9); for (let t = 0; t < dt - 1e-9; t += 1 / 240) { h.update(1 / 240); peak = Math.max(peak, h.head.x); } }
      for (let t = 0; t < 1; t += 1 / 240) { h.update(1 / 240); peak = Math.max(peak, h.head.x); }
      settle(h, 3);
      return { peak, rest: { x: h.head.x, z: h.head.z } };
    };
    const fast = peakNod(1 / 60, 12), slow = peakNod(0.1, 2);
    expect(fast.peak).toBeGreaterThan(0.03); // a visible nod down on onset
    expect(fast.peak).toBeLessThan(0.2); // ... but a small one
    expect(Math.abs(fast.peak - slow.peak) / fast.peak).toBeLessThan(0.45);
    expect(fast.rest.x).toBeLessThan(-0.03); expect(fast.rest.z).toBeGreaterThan(0.03); // settles chin-up with a tilt
  });
});

describe('realistic rig expressions (mh-amara, Node)', () => {
  it('setExpression drives additive head/neck rotations on top of the animator pose', { timeout: 60000 }, async () => {
    const id = 'mh-amara';
    const buf = fs.readFileSync(asset(BODIES[id]!.file));
    expect(await primeRealisticBase(id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).toBe(true);
    for (const lod of ['high', 'low'] as const) {
      const rig = (await loadRealisticRig({ ...appearance(id), accessories: [] }, { lod }))!;
      const R = rig.root;
      const head = new THREE.Vector3(), eye = new THREE.Vector3();
      const sample = () => { R.updateMatrixWorld(true); pos(R, 'attach:head', head); pos(R, 'crl_eye__L', eye); return { top: head.clone(), eye: eye.clone() }; };
      const run = (s: number) => { for (let t = 0; t < s; t += 1 / 60) rig.update(1 / 60); return sample(); };
      rig.update(0);
      const rest = sample();
      rig.setExpression('sad', 1);
      const sad = run(2);
      expect(sad.top.z - rest.top.z).toBeGreaterThan(0.03); // head nods down: the crown moves forward
      expect(sad.eye.y - rest.eye.y).toBeLessThan(-0.015);
      // additive over the animator: a look-left pose survives the gesture
      rig.setBoneRotation('head', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.6, 0)));
      const sadLook = run(0.1);
      expect(sadLook.eye.x - sad.eye.x).toBeGreaterThan(0.02);
      expect(sadLook.eye.y - rest.eye.y).toBeLessThan(-0.01);
      rig.setBoneRotation('head', new THREE.Quaternion());
      rig.setExpression('sad', 0);
      const back = run(3);
      expect(back.top.distanceTo(rest.top)).toBeLessThan(0.003);
      rig.setExpression('surprised', 1);
      const sur = run(0.2);
      expect(sur.top.z - rest.top.z).toBeLessThan(-0.015); // quick lift back
      rig.setExpression('surprised', 0); run(3);
      rig.setExpression('blink', 1);
      const blink = run(1);
      expect(blink.top.distanceTo(rest.top)).toBeLessThan(0.003);
      rig.dispose();
    }
  });
});
