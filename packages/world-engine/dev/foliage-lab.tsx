/**
 * Foliage lab (Foliage Engineer): http://localhost:5189/foliage-lab.html
 *   default: the variants side by side in front of a ≈400-tree forest (near meshes + far impostors)
 *   ?view=world (game-like camera: park stand + ≈400-tree belt) · ?view=row (variants only)
 *   ?view=park (PARK_TREE_PLACEMENTS close-up) · ?view=forest · ?q=low · ?far=<m>
 *   &snow=<0..1> · &wet=<0..1> — town weather uniforms via a local kit (as WorldScene provides)
 *   &measure=1 — renders high, records GPU triangle/draw counts, switches to low, records,
 *   then returns to high (one page load measures both qualities; numbers shown in the HUD).
 */
import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GeneratedTrees, PARK_TREE_PLACEMENTS, TREE_VARIANTS, type TreePlacement } from '../src/scene/foliage';
import { KitContext } from '../src/scene/context';
import { createKit } from '../src/scene/kit';

const params = new URLSearchParams(location.search);
const quality = (params.get('q') === 'low' ? 'low' : 'high') as 'low' | 'high';
const view = params.get('view') ?? 'combo';
const farParam = params.get('far');
const measure = params.get('measure') === '1';
const kit = createKit();
kit.uniforms.uSnow.value = Number(params.get('snow') ?? 0);
kit.uniforms.uWet.value = Number(params.get('wet') ?? 0);

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
    out.push({ x, z, scale: 0.7 + rnd() * 0.6, rot: rnd() * 6.28, variant: Math.floor(rnd() * TREE_VARIANTS.length) });
  }
  return out;
}

/** Belt around a 35 m town footprint, like the landscape agent's FOREST_PLACEMENTS will be. */
function beltPlacements(): TreePlacement[] {
  const out: TreePlacement[] = [];
  let s = 7654321;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2, r = 38 + Math.sqrt(rnd()) * 150;
    out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, scale: 0.8 + rnd() * 0.6, rot: rnd() * 6.28, variant: rnd() < 0.45 ? 1 : Math.floor(rnd() * TREE_VARIANTS.length) });
  }
  return out;
}

function CameraSetup() {
  const camera = useThree((s) => s.camera);
  useMemo(() => {
    if (view === 'park') { camera.position.set(-2, 13, 2); camera.lookAt(-15, 2, -17); }
    else if (view === 'forest') { camera.position.set(0, 22, 40); camera.lookAt(0, 4, -30); }
    else if (view === 'world') { camera.position.set(0, 38, 46); camera.lookAt(0, 0, -6); }
    else if (view === 'combo') { camera.position.set(0, 7, 21); camera.lookAt(0, 4.2, -6); }
    else { camera.position.set(0, 5.5, 19); camera.lookAt(0, 3.2, 0); }
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function Stats({ q }: { q: string }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  let n = 0;
  useFrame(() => {
    if (++n % 10 !== 0) return;
    const el = document.getElementById('stats');
    const lod = scene.getObjectByName('generated-trees')?.userData.lod as { near: number; mid: number; far: number; calls: number; tris: number } | undefined;
    if (el) el.textContent = `calls ${gl.info.render.calls} · tris ${gl.info.render.triangles} · q=${q} · view=${view}` +
      (lod ? ` · trees near ${lod.near} / mid ${lod.mid} / impostor ${lod.far} · forest ${lod.calls} calls / ${lod.tris} tris` : '');
  });
  return null;
}

/** ?measure=1: high → record → low → record → back to high (for the screenshot). */
function Measure({ setQ }: { setQ: (q: 'low' | 'high') => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const st = useRef({ phase: 0, frames: 0, group: null as THREE.Object3D | null, done: null as THREE.Object3D | null, out: [] as string[] });
  useFrame(() => {
    const m = st.current;
    if (m.phase >= 2) return;
    const g = scene.getObjectByName('generated-trees');
    // wait for the forest rebuilt for the new quality (the old one lingers a frame or two)
    if (!g || !g.userData.lod || g === m.done) { m.frames = 0; return; }
    if (g !== m.group) { m.group = g; m.frames = 0; }
    if (++m.frames < 5) return;
    const lod = g.userData.lod as { near: number; mid: number; far: number };
    m.out.push(`${m.phase === 0 ? 'HIGH' : 'LOW'} ${gl.info.render.triangles} tris / ${gl.info.render.calls} calls (near ${lod.near}, mid ${lod.mid}, impostor ${lod.far})`);
    const el = document.getElementById('measure');
    if (el) el.textContent = m.out.join('  ·  ');
    console.log('[foliage-lab measure]', m.out[m.out.length - 1]);
    m.phase++;
    m.done = g;
    m.frames = 0;
    setQ(m.phase === 1 ? 'low' : 'high');
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
      {view === 'world' && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
          <circleGeometry args={[10, 48]} />
          <meshStandardMaterial color="#e6d8c0" roughness={1} />
        </mesh>
      )}
      {(view === 'park' || view === 'world') && (
        <mesh rotation-x={-Math.PI / 2} position={[-15.2, 0.02, -21.2]}>
          <circleGeometry args={[2.7, 40]} />
          <meshStandardMaterial color="#7fc4d8" roughness={0.3} />
        </mesh>
      )}
    </>
  );
}

function App() {
  const [q, setQ] = useState<'low' | 'high'>(quality);
  const placements = useMemo(() => (view === 'park' ? PARK_TREE_PLACEMENTS
    : view === 'forest' ? forestPlacements()
    : view === 'world' ? [...PARK_TREE_PLACEMENTS, ...beltPlacements()]
    : view === 'combo' ? [...rowPlacements(), ...forestPlacements()] : rowPlacements()), []);
  return (
    <KitContext.Provider value={kit}>
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
        <GeneratedTrees quality={q} placements={placements} farDistance={farParam ? Number(farParam) : undefined} />
        <Stats q={q} />
        {measure && <Measure setQ={setQ} />}
      </Canvas>
      <div className="hud">
        <a href="?">combo</a><a href="?view=world">world</a><a href="?view=row">row</a><a href="?view=park">park</a><a href="?view=forest">forest</a><a href="?q=low">low</a>
        <span id="stats" />
        <div id="measure" />
      </div>
    </KitContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
