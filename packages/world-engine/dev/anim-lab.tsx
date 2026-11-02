/**
 * Animation lab (dev only): every base family + gesture side by side.
 * URL params: ?only=sit,think  &time=1.2 (freeze after advancing to t)  &view=front|side|back  &cols=6
 *             &world=1 (ResidentsLayer with a local runtime)
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { WorldEvent } from '@hello-world/contracts';
import { createAvatarRig, type HumanoidRig } from '../src/avatars/index';
import { appearanceFromSeed } from '../src/avatars/catalog';
import { AvatarAnimator, ANIMATION_FAMILIES, GESTURE_NAMES, type GestureName } from '../src/interactions/animation/AvatarAnimator';
import type { AnimationFamily } from '../src/world/activities';
import { ResidentsLayer, ResidentInspector } from '../src/interactions/index';
import { SceneStore } from '../src/core/sceneStore';
import { SceneStoreContext } from '../src/core/SceneContext';
import { createWorldRuntime } from '../src/runtime/index';

const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',').filter(Boolean);
const freeze = params.get('time') ? Number(params.get('time')) : null;
const view = params.get('view') ?? 'front';
const cols = Number(params.get('cols') ?? 6);

type Item = { label: string; family: AnimationFamily; gesture?: GestureName };
const ALL_ITEMS: Item[] = [
  ...ANIMATION_FAMILIES.map((f): Item => ({ label: f, family: f })),
  ...GESTURE_NAMES.map((g): Item => ({ label: `gesture: ${g}`, family: 'idle', gesture: g })),
];
const ITEMS = ALL_ITEMS.filter(i => !only || only.includes(i.label) || (i.gesture && only.includes(i.gesture)));

function LabRig({ item, index, x, z }: { item: Item; index: number; x: number; z: number }) {
  const rig = useMemo<HumanoidRig>(() => createAvatarRig(appearanceFromSeed(`lab-${index}`)), [index]);
  const anim = useMemo(() => new AvatarAnimator(rig, index * 7919), [rig, index]);
  const gTimer = useRef(0.2);
  const frozen = useRef(false);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => {
    if (params.get('seat')) anim.setSeatHeight(Number(params.get('seat')));
    anim.setBase(item.family);
    if (freeze !== null) {
      // Deterministic still: advance to `time`.
      let t = 0;
      if (item.gesture) anim.playGesture(item.gesture);
      while (t < freeze + 1.5) { anim.update(1 / 60); t += 1 / 60; if (item.gesture && t < 1.5) { /* fade-in */ } }
      if (item.gesture) { anim.playGesture(item.gesture); let g = 0; while (g < freeze) { anim.update(1 / 60); g += 1 / 60; } }
      frozen.current = true;
    }
  }, [anim, item]);
  useFrame((_, dt) => {
    if (frozen.current) return;
    if (item.gesture && (gTimer.current -= dt) <= 0) { anim.playGesture(item.gesture); gTimer.current = 3.2; }
    anim.update(dt);
  });
  return <group position={[x, 0, z]}>
    <primitive object={rig.root} />
    {(item.family === 'sit' || item.family === 'sleep') && !params.get('seat') ? <mesh position={[0, 0.225, -0.05]}><boxGeometry args={[0.6, 0.45, 0.45]} /><meshStandardMaterial color="#8b6a4f" /></mesh> : null}
    <Html position={[0, 2.05, 0]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', font: '600 12px system-ui', color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 6 }}>{item.label}</Html>
  </group>;
}

function Lab() {
  const rows = Math.ceil(ITEMS.length / cols);
  const spacing = 1.6;
  const span = Math.max(Math.min(cols, ITEMS.length) * spacing, rows * spacing * 1.25);
  const d = 1.2 + span * 0.85;
  const cam: [number, number, number] = view === 'side' ? [d, 1.3, 0] : view === 'back' ? [0, 1.3 + rows * 0.5, -d] : view === 'top' ? [0, d, 0.01] : [d * 0.35, 1.3 + rows * 0.7, d];
  return <Canvas dpr={1} camera={{ position: cam, fov: 40 }} style={{ position: 'fixed', inset: 0 }}>
    <color attach="background" args={['#24313a']} />
    <hemisphereLight args={['#dfefff', '#3a2f28', 1.2]} />
    <directionalLight position={[4, 8, 6]} intensity={2.2} />
    <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[40, 40]} /><meshStandardMaterial color="#4c6152" /></mesh>
    {ITEMS.map((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * spacing;
      const z = (r - (rows - 1) / 2) * spacing * 1.25;
      return <LabRig key={it.label} item={it} index={i} x={view === 'side' ? 0 : x} z={view === 'side' ? x : z} />;
    })}
    <OrbitControls target={[0, 0.9, 0]} />
  </Canvas>;
}

function Expose() {
  const { scene, camera, size } = useThree();
  useEffect(() => { (window as unknown as { __lab: unknown }).__lab = { scene, camera, size }; }, [scene, camera, size]);
  return null;
}

function World() {
  const runtime = useMemo(() => createWorldRuntime({ worldId: 'lab', seedResidents: true, autoTick: true }), []);
  const store = useMemo(() => new SceneStore(runtime), [runtime]);
  const [sel, setSel] = useState<string | undefined>(params.get('select') ?? undefined);
  useEffect(() => { store.start(); return () => store.stop(); }, [store]);
  useEffect(() => {
    (window as unknown as { __rt: typeof runtime }).__rt = runtime;
    let n = 0;
    const ev = (e: Partial<WorldEvent>): WorldEvent => ({ id: `lab-${Date.now()}-${n++}`, kind: 'chat', source: 'demo', actorId: 'seed:nova', actorDisplayName: 'Nova', timestamp: Date.now(), ...e }) as WorldEvent;
    if (params.get('paused') === '1') runtime.setPaused(true);
    const script = () => [
      ev({ kind: 'chat', text: 'Hi everyone! Lovely evening at the plaza — who wants coffee?' }),
      ev({ kind: 'wave', actorId: 'seed:mochi', actorDisplayName: 'Mochi', targetId: 'seed:nova' }),
      ev({ kind: 'gift', actorId: 'seed:rex', actorDisplayName: 'Rex', targetId: 'seed:lumi', payload: { item: 'flowers' } }),
      ev({ kind: 'social', actorId: 'seed:lumi', actorDisplayName: 'Lumi', targetId: 'seed:rex', source: 'simulation', payload: { action: 'befriend', sentiment: 'positive' }, text: 'Aww, thank you Rex! These are beautiful.' }),
      ev({ kind: 'dance', actorId: 'seed:pixelcat', actorDisplayName: 'PixelCat' }),
      ev({ kind: 'social', actorId: 'seed:bram', actorDisplayName: 'Bram', targetId: 'seed:pixelcat', payload: { action: 'greet', sentiment: 'negative' }, source: 'simulation', text: 'Hmph. Not now, PixelCat.' }),
    ];
    const timers: ReturnType<typeof setTimeout>[] = [];
    script().forEach((e, i) => timers.push(setTimeout(() => runtime.dispatch(e), 400 + i * 250)));
    const iv = setInterval(() => script().forEach((e, i) => timers.push(setTimeout(() => runtime.dispatch({ ...e, id: `${e.id}-${Date.now()}` }), i * 250))), 4000);
    timers.push(iv as unknown as ReturnType<typeof setTimeout>);
    return () => { timers.forEach(clearTimeout); clearInterval(iv); };
  }, [runtime]);
  return <>
    <Canvas dpr={1} camera={{ position: params.get('cam') === 'far' ? [-0.6, 14.6, 23.2] : [0, 6, 11], fov: 45 }} style={{ position: 'fixed', inset: 0 }}>
      <color attach="background" args={['#24313a']} />
      <hemisphereLight args={['#dfefff', '#3a2f28', 1.2]} />
      <directionalLight position={[4, 8, 6]} intensity={2.2} />
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[80, 80]} /><meshStandardMaterial color="#4c6152" /></mesh>
      <Expose />
      <SceneStoreContext.Provider value={store}>
        <ResidentsLayer selectedResidentId={sel} onResidentSelect={setSel} viewerResidentId="seed:bram" quality="high" />
      </SceneStoreContext.Provider>
      <OrbitControls target={[0, 0.5, 0]} />
    </Canvas>
    <ResidentInspector store={store} runtime={runtime} selectedResidentId={sel} viewerResidentId="seed:bram" onClose={() => setSel(undefined)} />
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{params.get('world') === '1' ? <World /> : <Lab />}</StrictMode>);
