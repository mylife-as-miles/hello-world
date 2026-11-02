/** Camera modes with smooth damped transitions: orbit · neighborhood · street · follow · cinematic (+ overlay). */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraMode } from '@hello-world/contracts';
import { useSceneStore } from '../core/SceneContext';

type RigMode = CameraMode | 'overlay';

interface OrbitLike { target: THREE.Vector3 }

const CINE_POS: Array<[number, number, number]> = [
  [15, 8.5, 17], [6, 5.5, -1], [10.5, 6, -12], [5, 6, -14.5], [-6, 6.5, -10.5], [-12.5, 5.5, -2.5], [-10.5, 5.5, 8], [-3, 5, 10], [3.5, 4.5, 3.5],
];
const CINE_LOOK: Array<[number, number, number]> = [
  [1, 1, 0], [13, 1.6, -7], [19, 1.8, -18], [0, 2.6, -24], [-15, 0.8, -19], [-20, 1, -9], [-20, 2, 3], [-7, 0.6, 19], [7.5, 1.4, 7],
];

export function poseFor(mode: RigMode, t: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
  switch (mode) {
    case 'overlay':
      outPos.set(0, 9.5, 17.5); outLook.set(0, 1.1, 0); break;
    case 'street': {
      const s = Math.sin(t * 0.045);
      const x = -7 + s * 7;
      outPos.set(x, 1.75, 10.8); outLook.set(x + 10, 1.7, 15.2); break;
    }
    case 'follow':
    case 'orbit':
    case 'neighborhood':
    default:
      outPos.set(6 + Math.sin(t * 0.05) * 3, 23 + Math.sin(t * 0.07) * 0.8, 33 + Math.cos(t * 0.05) * 1.5);
      outLook.set(2, 0, -6);
  }
}

export function CameraRig({ mode, selectedResidentId }: { mode: RigMode; selectedResidentId?: string }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const store = useSceneStore();
  const look = useRef(new THREE.Vector3(2, 0, -6));
  const controls = useRef<OrbitLike | null>(null);
  const first = useRef(true);
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), follow: new THREE.Vector3(), hasFollow: false }), []);
  const cine = useMemo(() => ({
    pos: new THREE.CatmullRomCurve3(CINE_POS.map(p => new THREE.Vector3(...p)), true, 'centripetal'),
    look: new THREE.CatmullRomCurve3(CINE_LOOK.map(p => new THREE.Vector3(...p)), true, 'centripetal'),
    u: 0,
  }), []);
  useEffect(() => { tmp.hasFollow = false; }, [selectedResidentId, tmp]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.25);
    const t = state.clock.elapsedTime;
    if (mode === 'orbit') {
      if (controls.current) look.current.copy(controls.current.target);
      first.current = false;
      return;
    }
    if (mode === 'follow') {
      const r = selectedResidentId ? store.getResident(selectedResidentId) : undefined;
      const tx = r ? r.location.x : 0, tz = r ? r.location.z : 0;
      if (!tmp.hasFollow) { tmp.follow.set(tx, 0, tz); tmp.hasFollow = true; }
      tmp.follow.lerp(new THREE.Vector3(tx, 0, tz), 1 - Math.exp(-dt * 2.2));
      const yaw = 0.35 * Math.sin(t * 0.07);
      tmp.look.set(tmp.follow.x, 1.1, tmp.follow.z);
      tmp.pos.set(tmp.follow.x + Math.sin(yaw) * 8.5, 5.2, tmp.follow.z + Math.cos(yaw) * 8.5);
    } else if (mode === 'cinematic') {
      cine.u = (cine.u + dt / 120) % 1;
      cine.pos.getPointAt(cine.u, tmp.pos);
      cine.look.getPointAt(cine.u, tmp.look);
    } else {
      poseFor(mode, t, tmp.pos, tmp.look);
    }
    if (first.current) {
      camera.position.copy(tmp.pos);
      look.current.copy(tmp.look);
      first.current = false;
    } else {
      const k = 1 - Math.exp(-dt * (mode === 'follow' ? 2.4 : 1.4));
      camera.position.lerp(tmp.pos, k);
      look.current.lerp(tmp.look, k);
    }
    camera.lookAt(look.current);
  });

  if (mode !== 'orbit') return null;
  return (
    <OrbitControls
      ref={(c: unknown) => { controls.current = (c as OrbitLike | null) ?? null; }}
      makeDefault target={look.current.clone()} enableDamping dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.46} minDistance={5} maxDistance={95} />
  );
}
