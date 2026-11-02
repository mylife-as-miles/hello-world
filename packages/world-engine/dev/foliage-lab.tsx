/**
 * Foliage lab (Foliage Engineer): http://localhost:5189/foliage-lab.html
 *   default: the variants side by side in front of a ≈400-tree forest (near meshes + far impostors)
 *   ?view=row (variants only) · ?view=park (PARK_TREE_PLACEMENTS) · ?view=forest · ?q=low · ?far=<m>
 */
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GeneratedTrees, PARK_TREE_PLACEMENTS, TREE_VARIANTS, type TreePlacement } from '../src/scene/foliage';

const params = new URLSearchParams(location.search);
const quality = (params.get('q') === 'low' ? 'low' : 'high') as 'low' | 'high';
const view = params.get('view') ?? 'combo';
const farParam = params.get('far');

function rowPlacements(): TreePlacement[] {
  return TREE_VARIANTS.map((_, i) => ({ x: (i - (TREE_VARIANTS.length - 1) / 2) * 7.5, z: 0, scale: 1, rot: i * 0.9, variant: i }));
}
function forestPlacements(): TreePlacement[] {
  const out: TreePlacement[] = [];
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2, r = 14 + Math.sqrt(rnd()) * 150;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 40;
    if (view === 'combo' && z > -24) continue;
    out.push({ x, z, scale: 0.7 + rnd() * 0.6, rot: rnd() * 6.28, variant: Math.floor(rnd() * 4) });
  }
  return out;
}

function CameraSetup() {
  const camera = useThree((s) => s.camera);
  useMemo(() => {
    if (view === 'park') { camera.position.set(-2, 13, 2); camera.lookAt(-15, 2, -17); }
    else if (view === 'forest') { camera.position.set(0, 22, 40); camera.lookAt(0, 4, -30); }
    else if (view === 'combo') { camera.position.set(0, 7, 21); camera.lookAt(0, 4.2, -6); }
    else { camera.position.set(0, 5.5, 19); camera.lookAt(0, 3.2, 0); }
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function Stats() {
  const gl = useThree((s) => s.gl);
  let n = 0;
  useFrame(() => {
    if (++n % 20 !== 0) return;
    const el = document.getElementById('stats');
    if (el) el.textContent = `calls ${gl.info.render.calls} · tris ${gl.info.render.triangles} · q=${quality} · view=${view}`;
  });
  return null;
}

function Ground() {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#9ccf78" roughness={1} />
      </mesh>
      {view === 'park' && (
        <mesh rotation-x={-Math.PI / 2} position={[-15.2, 0.02, -21.2]}>
          <circleGeometry args={[2.7, 40]} />
          <meshStandardMaterial color="#7fc4d8" roughness={0.3} />
        </mesh>
      )}
    </>
  );
}

function App() {
  const placements = useMemo(() => (view === 'park' ? PARK_TREE_PLACEMENTS
    : view === 'forest' ? forestPlacements()
    : view === 'combo' ? [...rowPlacements(), ...forestPlacements()] : rowPlacements()), []);
  return (
    <>
      <Canvas shadows={quality === 'high'} dpr={[1, 1.5]} camera={{ fov: 42, near: 0.1, far: 800 }} gl={{ antialias: true }}
        onCreated={({ scene, gl }) => {
          scene.background = new THREE.Color('#cfe6f3');
          scene.fog = new THREE.Fog('#cfe6f3', 90, 260);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}>
        <CameraSetup />
        <hemisphereLight args={['#d9ecff', '#8f9c62', 1.1]} />
        <directionalLight position={[30, 45, 20]} color="#fff4e2" intensity={3.1} castShadow={quality === 'high'}
          shadow-mapSize={[1024, 1024]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0005} />
        <Ground />
        <GeneratedTrees quality={quality} placements={placements} farDistance={farParam ? Number(farParam) : undefined} />
        <Stats />
      </Canvas>
      <div className="hud">
        <a href="?">combo</a><a href="?view=row">row</a><a href="?view=park">park</a><a href="?view=forest">forest</a><a href="?q=low">low</a>
        <span id="stats" />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
