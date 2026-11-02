/**
 * Landscape lab (Landscape Engineer): http://localhost:5191/landscape-lab.html
 *   ?view=neighborhood|aerial|street|low|lake · ?night=1 · ?q=low · ?district=1 (mount DowntownDistrict on the terrain)
 *   ?trees=0 (hide placeholder forest markers)
 * The forest markers are lab-only placeholders (cones/balls) at FOREST_PLACEMENTS —
 * the real trees come from src/scene/foliage GeneratedTrees.
 */
import { StrictMode, Suspense, lazy, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneStoreContext } from '../src/core/SceneContext';
import type { SceneStore } from '../src/core/sceneStore';
import { noise2 } from '../src/scene/batch';
import { Landscape, FOREST_PLACEMENTS, FOREST_PLACEMENTS_LOW, terrainHeightAt, type ForestPlacement } from '../src/scene/landscape';

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const quality = (params.get('q') === 'low' ? 'low' : 'high') as 'low' | 'high';
const view = params.get('view') ?? 'neighborhood';
const withDistrict = params.get('district') === '1';
const showTrees = params.get('trees') !== '0';
const simTime = night ? 840 : 240;
const fakeStore = { current: { simulationTime: simTime, weather: 'sunny' } } as unknown as SceneStore;

const LOOK = night
  ? { bg: '#1c2646', hs: '#3c4f86', hg: '#1c1f2e', hI: 0.62, sun: '#9fb2ff', sunI: 0.55, fog: '#1c2646' }
  : { bg: '#cfe6f3', hs: '#d9ecff', hg: '#8f9c62', hI: 1.08, sun: '#fff4e2', sunI: 3.3, fog: '#cfe6f3' };

const District = lazy(async () => {
  const m = await import('../src/scene/district');
  return { default: () => <m.DowntownDistrict quality={quality} heightAt={terrainHeightAt} /> };
});

/** Flat town disc using the town ground colour formula (stand-in for Town). */
function TownDisc() {
  const geo = useMemo(() => {
    const g = new THREE.CircleGeometry(36, 96, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position!;
    const col = new Float32Array(pos.count * 3);
    const A = new THREE.Color('#8cc46a'), B = new THREE.Color('#76b05a'), C = new THREE.Color('#a6d27c'), D = new THREE.Color('#bcd07c'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n1 = noise2(x * 0.06, z * 0.06, 3), n2 = noise2(x * 0.21, z * 0.21, 7);
      c.copy(A).lerp(B, n1).lerp(C, Math.max(0, n2 - 0.45) * 1.2);
      if (n1 > 0.7) c.lerp(D, (n1 - 0.7) * 1.5);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <>
      <mesh geometry={geo} receiveShadow><meshStandardMaterial vertexColors roughness={0.92} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}><ringGeometry args={[0, 9.5, 64]} /><meshStandardMaterial color="#e6d8c0" roughness={0.9} /></mesh>
      {[[-14, -16], [16, -14], [-20, 12], [18, 14], [0, -26]].map(([x, z], i) => (
        <mesh key={i} position={[x!, 2.2, z!]} castShadow><boxGeometry args={[7, 4.4, 6]} /><meshStandardMaterial color={['#f2d7b6', '#e8b8a0', '#cfe0f0', '#f4e3c3', '#b98cff'][i]} /></mesh>
      ))}
    </>
  );
}

/** Lab-only forest markers (instanced) at the exported placements. */
function ForestMarkers({ placements }: { placements: ForestPlacement[] }) {
  const { cone, ball, trunk, mat, trunkMat, n } = useMemo(() => {
    const cone = new THREE.ConeGeometry(1.5, 4.2, 7); cone.translate(0, 3.6, 0);
    const ball = new THREE.IcosahedronGeometry(1.8, 0); ball.translate(0, 3.4, 0);
    const trunk = new THREE.CylinderGeometry(0.18, 0.24, 1.8, 5); trunk.translate(0, 0.9, 0);
    return { cone, ball, trunk, mat: new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), trunkMat: new THREE.MeshStandardMaterial({ color: '#7a5a3c' }), n: placements.length };
  }, [placements]);
  const refs = useMemo(() => ({ cone: null as THREE.InstancedMesh | null, ball: null as THREE.InstancedMesh | null, trunk: null as THREE.InstancedMesh | null }), []);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const colors = ['#3f7d4f', '#5f9e45', '#a8c95a', '#f2a7c3'];
    let ic = 0, ib = 0;
    placements.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot); s.setScalar(t.scale); p.set(t.x, t.y - 0.1, t.z); m.compose(p, q, s);
      refs.trunk?.setMatrixAt(i, m);
      if (t.variant === 0) { refs.cone?.setMatrixAt(ic, m); refs.cone?.setColorAt(ic++, new THREE.Color(colors[0])); }
      else { refs.ball?.setMatrixAt(ib, m); refs.ball?.setColorAt(ib++, new THREE.Color(colors[t.variant] ?? colors[1])); }
    });
    if (refs.cone) { refs.cone.count = ic; refs.cone.instanceMatrix.needsUpdate = true; if (refs.cone.instanceColor) refs.cone.instanceColor.needsUpdate = true; }
    if (refs.ball) { refs.ball.count = ib; refs.ball.instanceMatrix.needsUpdate = true; if (refs.ball.instanceColor) refs.ball.instanceColor.needsUpdate = true; }
    if (refs.trunk) refs.trunk.instanceMatrix.needsUpdate = true;
  }, [placements, refs]);
  return (
    <>
      <instancedMesh ref={r => { refs.cone = r; }} args={[cone, mat, n]} castShadow />
      <instancedMesh ref={r => { refs.ball = r; }} args={[ball, mat, n]} castShadow />
      <instancedMesh ref={r => { refs.trunk = r; }} args={[trunk, trunkMat, n]} />
    </>
  );
}

function CameraSetup() {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  useMemo(() => {
    const look = new THREE.Vector3(0, 0, -6);
    if (view === 'aerial') { camera.position.set(0, 210, 300); look.set(0, 0, -20); }
    else if (view === 'street') { camera.position.set(-6, 1.75, 10.8); look.set(4, 1.7, 15.2); }
    else if (view === 'low') { camera.position.set(6, 9, 31); look.set(-10, 6, -60); }
    else if (view === 'lake') { camera.position.set(-40, 26, 40); look.set(LAKE_X, 2, LAKE_Z); }
    else camera.position.set(0, 38, 46);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}
const LAKE_X = -102, LAKE_Z = 98;

function Stats() {
  const gl = useThree(s => s.gl);
  let n = 0;
  useFrame(() => {
    if (++n % 20 !== 0) return;
    const el = document.getElementById('stats');
    if (el) el.textContent = `calls ${gl.info.render.calls} · tris ${gl.info.render.triangles} · q=${quality} · trees ${FOREST_PLACEMENTS.length}/${FOREST_PLACEMENTS_LOW.length} · view=${view}`;
  });
  return null;
}

function Scene() {
  const sunPos: [number, number, number] = night ? [-30, 60, 20] : [40, 70, 30];
  return (
    <>
      <color attach="background" args={[LOOK.bg]} />
      <fog attach="fog" args={[LOOK.fog, view === 'aerial' ? 320 : 70, view === 'aerial' ? 900 : (params.get('fogfar') ? Number(params.get('fogfar')) : 230)]} />
      <hemisphereLight args={[LOOK.hs, LOOK.hg, LOOK.hI]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={sunPos} intensity={LOOK.sunI} color={LOOK.sun} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} />
      <TownDisc />
      <Landscape quality={quality} />
      {showTrees && <ForestMarkers placements={quality === 'high' ? FOREST_PLACEMENTS : FOREST_PLACEMENTS_LOW} />}
      {withDistrict && <Suspense fallback={null}><District /></Suspense>}
      <CameraSetup />
      <Stats />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Canvas shadows dpr={[1, 1]} camera={{ fov: 42, near: 0.1, far: 1200 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}>
      <SceneStoreContext.Provider value={fakeStore}>
        <Scene />
      </SceneStoreContext.Provider>
    </Canvas>
  </StrictMode>,
);
