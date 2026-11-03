import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ACCESSORIES, BASE_MODELS, BOTTOMS, DEFAULT_APPEARANCE, HAIR_STYLES, SHOES, TOPS, appearanceFromSeed } from '../catalog';
import { createAvatarRig, getAppearanceSupport, isVrmBase } from '../index';
import { HUMAN_BONES } from '../rig';

function tris(root: THREE.Object3D): { tris: number; meshes: number } {
  let t = 0, m = 0;
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    m++;
    const g = mesh.geometry;
    t += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { tris: t, meshes: m };
}

describe('Townie procedural rig', () => {
  it('builds every catalog option without throwing (Node, no DOM)', { timeout: 240000 }, () => {
    const procedural = BASE_MODELS.filter(b => b.kind === 'procedural');
    let i = 0;
    for (const hair of HAIR_STYLES) for (const top of TOPS) {
      const a = {
        ...DEFAULT_APPEARANCE,
        baseModelId: procedural[i % procedural.length]!.id,
        hairStyle: hair.id,
        outfit: { top: top.id, bottom: BOTTOMS[i % BOTTOMS.length]!.id, shoes: SHOES[i % SHOES.length]!.id, color: '#ff7a59' },
        accessories: [ACCESSORIES[i % ACCESSORIES.length]!.id, ACCESSORIES[(i * 5 + 3) % ACCESSORIES.length]!.id],
      };
      i++;
      for (const lod of ['high', 'mid', 'low'] as const) {
        const rig = createAvatarRig(a, { lod });
        expect(rig.kind).toBe('procedural');
        rig.update(0.016);
        rig.dispose();
      }
    }
  });

  it('names canonical bones, honours height and sets expressions safely', () => {
    const short = createAvatarRig({ ...DEFAULT_APPEARANCE, body: { height: 0, build: 0.5 } });
    const tall = createAvatarRig({ ...DEFAULT_APPEARANCE, body: { height: 1, build: 0.5 } });
    for (const b of HUMAN_BONES) expect(tall.root.getObjectByName(b), b).toBeTruthy();
    expect(tall.height).toBeGreaterThan(short.height * 1.2);
    expect(tall.height).toBeGreaterThan(1.5);
    expect(tall.height).toBeLessThan(2.1);
    for (const e of ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'blink', 'aa', 'oh', 'neutral'] as const) tall.setExpression(e, 1);
    tall.update(0.1);
    tall.setBoneRotation('leftUpperArm', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.25)));
    tall.setHipsOffset(0, -0.1, 0);
    expect(tall.getAttachPoint('rightHand')).toBeTruthy();
    expect(tall.getAttachPoint('back')).toBeTruthy();
    short.dispose(); tall.dispose();
  });

  it('keeps distant residents cheap (low LOD) and reports budgets', () => {
    const rows: string[] = [];
    for (let k = 0; k < 6; k++) {
      const a = appearanceFromSeed(`resident-${k}`);
      const hi = createAvatarRig(a, { lod: 'high' });
      const lo = createAvatarRig(a, { lod: 'low' });
      const h = tris(hi.root), l = tris(lo.root);
      rows.push(`${a.baseModelId}/${a.hairStyle}/${a.outfit.top}: high ${h.tris} tris ${h.meshes} meshes | low ${l.tris} tris ${l.meshes} meshes`);
      expect(l.tris).toBeLessThan(h.tris * 0.6);
      expect(l.meshes).toBe(1); // ONE draw call per distant resident
      const only = lo.root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
      expect(only).toBeTruthy();
      const si = only.geometry.getAttribute('skinIndex');
      const headIdx = HUMAN_BONES.indexOf('head');
      let headVerts = 0;
      for (let v = 0; v < si.count; v++) if (si.getX(v) === headIdx) headVerts++;
      expect(headVerts).toBeGreaterThan(100); // head, hair & hats rigidly follow the head bone
      expect(lo.root.getObjectByName('attach:head')).toBeTruthy();
      expect(Math.abs(lo.height - hi.height)).toBeLessThan(1e-6);
      hi.dispose(); lo.dispose();
    }
    console.log(rows.join('\n'));
  });

  it('LOD draw-call budgets: high body merged, mid = static face in one mesh, same skeleton everywhere', () => {
    const rows: string[] = [];
    const seeds = Array.from({ length: 10 }, (_, k) => appearanceFromSeed(`lod-${k}`));
    seeds.push({ ...DEFAULT_APPEARANCE, accessories: ['glasses', 'crown', 'backpack', 'earrings'] });
    for (const a of seeds) {
      const rigs = (['high', 'mid', 'low'] as const).map(lod => ({ lod, rig: createAvatarRig(a, { lod }) }));
      const stat = rigs.map(({ lod, rig }) => {
        let meshes = 0, skinned = 0, t = 0;
        rig.root.traverse(o => {
          const m = o as THREE.Mesh; if (!m.isMesh) return;
          meshes++; if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
          t += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
        });
        return { lod, meshes, skinned, tris: t };
      });
      const [hi, mid, lo] = stat as [typeof stat[0], typeof stat[0], typeof stat[0]];
      const glasses = a.accessories.includes('glasses');
      rows.push(`${a.baseModelId}/${a.hairStyle}/${a.outfit.top}/${a.accessories.join('+') || '-'}: ` + stat.map(s => `${s.lod} ${s.meshes} meshes (${s.skinned} skinned, ${s.tris} tris)`).join(' | '));
      expect(hi.skinned).toBeLessThanOrEqual(glasses ? 2 : 1); // whole body + head + hair + hats: ONE baked SkinnedMesh (+ lens)
      expect(hi.skinned).toBeLessThanOrEqual(5);
      expect(hi.meshes).toBeLessThanOrEqual(16); // + live face (8 eye parts, 2 brows, mouth, teeth, blush)
      expect(mid.meshes).toBeLessThanOrEqual(2);
      expect(mid.meshes).toBe(glasses ? 2 : 1);
      expect(lo.meshes).toBe(1);
      expect(mid.tris).toBeGreaterThan(lo.tris); // mid keeps the high-detail shape
      expect(Math.abs(mid.tris - hi.tris) / hi.tris).toBeLessThan(0.25);
      for (const { rig } of rigs) {
        for (const b of HUMAN_BONES) expect(rig.root.getObjectByName(b), b).toBeTruthy();
        for (const slot of ['head', 'leftHand', 'rightHand', 'back'] as const) expect(rig.getAttachPoint(slot)).toBeTruthy();
        expect(Math.abs(rig.height - rigs[0]!.rig.height)).toBeLessThan(1e-6);
        rig.root.traverse(o => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh) { expect(sm.boundingSphere?.radius).toBeGreaterThan(1.2); expect(sm.geometry.getAttribute('pbr') || sm.name.startsWith('townie-lens')).toBeTruthy(); } });
        // expressions / blink must be safe on every LOD (no-ops on mid / low)
        for (const e of ['happy', 'blink', 'aa', 'surprised'] as const) rig.setExpression(e, 1);
        rig.update(0.05);
      }
      // mid: the head + resting face are rigidly skinned to 'head' (eyes, lids, brows, mouth baked in)
      const midMesh = rigs[1]!.rig.root.getObjectByName('townie-body:mid') as THREE.SkinnedMesh;
      const si = midMesh.geometry.getAttribute('skinIndex');
      let headVerts = 0; for (let v = 0; v < si.count; v++) if (si.getX(v) === HUMAN_BONES.indexOf('head')) headVerts++;
      expect(headVerts).toBeGreaterThan(3000);
      for (const { rig } of rigs) rig.dispose();
    }
    console.log(rows.join('\n'));
  });

  it('exposes VRM bases and appearance support', () => {
    expect(isVrmBase('vrm-polybot')).toBe(true);
    expect(isVrmBase('townie-classic')).toBe(false);
    expect(getAppearanceSupport('townie-soft').hair).toBe(true);
    expect(getAppearanceSupport('vrm-chill').hair).toBe(false);
  });
});
