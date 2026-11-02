/** Festive string lights over the dance stage + roaming coloured floor spots at night. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getPoi } from '../world/layout';
import { useKit } from './context';
import { stageStringCurves } from './town';

const BULB_COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#f78c6b', '#c792ea'];

export function StageLights() {
  const kit = useKit();
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const curve of stageStringCurves()) {
      const n = Math.max(4, Math.round(curve.getLength() / 0.42));
      for (let i = 1; i < n; i++) pts.push(curve.getPoint(i / n));
    }
    const geo = new THREE.SphereGeometry(0.075, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const spotGeo = new THREE.CircleGeometry(0.85, 28);
    spotGeo.rotateX(-Math.PI / 2);
    const spotMats = ['#ff5fa2', '#4cc9f0', '#ffd166', '#7dffb2'].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    return { pts, geo, mat, spotGeo, spotMats };
  }, []);
  useEffect(() => () => { res.geo.dispose(); res.mat.dispose(); res.spotGeo.dispose(); res.spotMats.forEach(m => m.dispose()); }, [res]);
  useLayoutEffect(() => {
    const m = bulbs.current;
    if (!m) return;
    const tmp = new THREE.Matrix4();
    const c = new THREE.Color();
    res.pts.forEach((p, i) => {
      m.setMatrixAt(i, tmp.makeTranslation(p.x, p.y - 0.06, p.z));
      m.setColorAt(i, c.set(BULB_COLORS[i % BULB_COLORS.length]!));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [res]);
  const spots = useRef<Array<THREE.Mesh | null>>([]);
  const stage = getPoi('stage')?.position ?? { x: 7.5, z: 7 };
  useFrame(() => {
    const L = kit.env.lights, t = kit.env.t;
    const pulse = 0.85 + 0.15 * Math.sin(t * 3.2);
    res.mat.color.setScalar(0.75 + L * 3.0 * pulse);
    spots.current.forEach((s, i) => {
      if (!s) return;
      const a = t * (0.6 + i * 0.17) + i * 1.7;
      s.position.set(stage.x + Math.cos(a) * (1.1 + 0.4 * Math.sin(t * 0.7 + i)), 0.455, stage.z + Math.sin(a * 1.3) * 1.2);
      (s.material as THREE.MeshBasicMaterial).opacity = L * 0.55 * (0.7 + 0.3 * Math.sin(t * 5 + i * 2));
      s.visible = L > 0.03;
    });
  });
  return (
    <group>
      <instancedMesh ref={bulbs} args={[res.geo, res.mat, res.pts.length]} frustumCulled={false} />
      {res.spotMats.map((m, i) => (
        <mesh key={i} ref={el => { spots.current[i] = el; }} geometry={res.spotGeo} material={m} renderOrder={6} />
      ))}
    </group>
  );
}
