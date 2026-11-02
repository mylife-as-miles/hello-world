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
