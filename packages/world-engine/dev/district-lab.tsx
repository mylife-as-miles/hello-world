/**
 * District lab (City District Engineer): http://localhost:5188/district-lab.html
 *   ?night=1 · ?t=<simulationTime seconds> · ?q=low · ?view=far · ?weather=rain
 */
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneStoreContext } from '../src/core/SceneContext';
import type { SceneStore } from '../src/core/sceneStore';
import { groundHeight } from '../src/scene/town';
import { DowntownDistrict } from '../src/scene/district';

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const simTime = Number(params.get('t') ?? (night ? 840 : 240));
const quality = (params.get('q') === 'low' ? 'low' : 'high') as 'low' | 'high';
const view = params.get('view') ?? 'neighborhood';
const weather = params.get('weather') ?? 'sunny';
const flat = params.get('flat') === '1';

const fakeStore = { current: { simulationTime: simTime, weather } } as unknown as SceneStore;

const LOOK = night
  ? { bg: '#1c2646', hs: '#3c4f86', hg: '#1c1f2e', hI: 0.62, sun: '#9fb2ff', sunI: 0.55 }
  : { bg: '#cfe6f3', hs: '#d9ecff', hg: '#8f9c62', hI: 1.08, sun: '#fff4e2', sunI: 3.3 };

function Ground() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(320, 320, 120, 120);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const A = new THREE.Color('#8cc46a'), F = new THREE.Color('#7fae78'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, flat ? 0 : groundHeight(x, z));
      c.copy(A).lerp(F, Math.min(1, Math.hypot(x, z) / 120));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <>
      <mesh geometry={geo}><meshStandardMaterial vertexColors roughness={1} /></mesh>
      {/* neighborhood footprint */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
        <circleGeometry args={[34, 48]} />
        <meshStandardMaterial color="#d9c9a8" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, 0]}>
        <ringGeometry args={[8, 10, 40]} />
        <meshStandardMaterial color="#c79b77" roughness={1} />
      </mesh>
    </>
  );
}

function CameraSetup() {
  const camera = useThree(s => s.camera);
  useMemo(() => {
    if (view === 'far') camera.position.set(0, 130, 170);
    else if (view === 'east') camera.position.set(-40, 30, 30);
    else camera.position.set(0, 38, 46);
    camera.lookAt(view === 'east' ? new THREE.Vector3(60, 15, -30) : new THREE.Vector3(0, 0, -6));
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function Stats() {
  const gl = useThree(s => s.gl);
  let n = 0;
  useFrame(() => {
    if (++n % 20 !== 0) return;
    const el = document.getElementById('stats');
    if (el) el.textContent = `calls ${gl.info.render.calls} · tris ${gl.info.render.triangles} · q=${quality} · t=${simTime}${night ? ' (night)' : ''}`;
  });
  return null;
}

function App() {
  return (
    <SceneStoreContext.Provider value={fakeStore}>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 42, near: 0.1, far: 1200, position: [0, 38, 46] }} gl={{ antialias: true }}
        onCreated={({ scene, gl }) => {
          scene.background = new THREE.Color(LOOK.bg);
          scene.fog = new THREE.Fog(LOOK.bg, 110, 340);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}>
        <CameraSetup />
        <hemisphereLight args={[LOOK.hs, LOOK.hg, LOOK.hI]} />
        <directionalLight position={[60, 90, 40]} color={LOOK.sun} intensity={LOOK.sunI} />
        <Ground />
        <DowntownDistrict quality={quality} heightAt={flat ? undefined : groundHeight} />
        <Stats />
      </Canvas>
      <div className="hud">
        <a href="?">day</a><a href="?night=1">night</a><a href="?t=690">dusk</a><a href="?q=low">low</a><a href="?view=far">far</a><a href="?view=far&night=1">far night</a><a href="?view=east">east</a>
        <span id="stats" />
      </div>
    </SceneStoreContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
