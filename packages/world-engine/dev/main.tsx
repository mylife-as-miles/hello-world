/**
 * Engine development harness (NOT the product app — Codex owns apps/web).
 * Runs a local persistent runtime in the browser and exposes every WorldEvent
 * kind as a button so the engine can be exercised without the server.
 * URL params: ?view=world|creator|overlay  &camera=neighborhood|orbit|street|follow|cinematic  &quality=low|high  &fresh=1
 */
import { StrictMode, useEffect, useMemo, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { AvatarAppearance, CameraMode, WorldEvent, WorldEventKind, WorldEventPayload, WorldSceneProps, WorldSnapshot } from '@hello-world/contracts';
import { WorldScene, AvatarCreator, createPersistentWorldRuntime, createIndexedDbSnapshotStorage, type PersistentWorldRuntime } from '../src/index';

const params = new URLSearchParams(location.search);
// Harness opts into the engine's optional chrome (Codex's app keeps it off and uses its own UI).
const Scene = WorldScene as unknown as ComponentType<WorldSceneProps & { viewerResidentId?: string; showHud?: boolean; showInspector?: boolean }>;
const initialView = (params.get('view') ?? 'world') as 'world' | 'creator' | 'overlay';
if (initialView === 'overlay') document.body.classList.add('overlay');

let counter = 0;
const ev = (kind: WorldEventKind, actorId: string, actorDisplayName: string, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  id: `dev-${Date.now()}-${counter++}`, kind, source: 'demo', actorId, actorDisplayName, timestamp: Date.now(), ...extra,
});

function useSnapshot(runtime: PersistentWorldRuntime | null): WorldSnapshot | null {
  const [snap, setSnap] = useState<WorldSnapshot | null>(runtime?.getSnapshot() ?? null);
  useEffect(() => {
    if (!runtime) return;
    setSnap(runtime.getSnapshot());
    let raf = 0;
    const unsub = runtime.subscribe(s => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setSnap(s)); });
    return () => { unsub(); cancelAnimationFrame(raf); };
  }, [runtime]);
  return snap;
}

function App() {
  const [runtime, setRuntime] = useState<PersistentWorldRuntime | null>(null);
  const [view, setView] = useState(initialView);
  const [camera, setCamera] = useState<CameraMode>((params.get('camera') as CameraMode) ?? 'neighborhood');
  const [quality, setQuality] = useState<'low' | 'high'>((params.get('quality') as 'low' | 'high') ?? 'high');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [chat, setChat] = useState('Hello neighborhood!');
  const snap = useSnapshot(runtime);

  useEffect(() => {
    let rt: PersistentWorldRuntime | null = null;
    let cancelled = false;
    const storage = createIndexedDbSnapshotStorage('hello-world-engine-dev');
    (async () => {
      if (params.get('fresh') === '1') await storage.clear('hello-neighborhood');
      rt = await createPersistentWorldRuntime({ worldId: 'hello-neighborhood', seedResidents: true, autoTick: true, storage, catchUpMaxSeconds: 120 });
      if (cancelled) { rt.dispose(); return; }
      (window as unknown as { __world: PersistentWorldRuntime }).__world = rt;
      setRuntime(rt);
    })();
    return () => { cancelled = true; rt?.dispose(); };
  }, []);

  const residents = snap?.residents ?? [];
  const me = residents.find(r => r.id === 'viewer:me');
  const actor = selected ? residents.find(r => r.id === selected) : residents[0];
  const target = residents.find(r => r.id !== actor?.id && r.id !== selected) ?? residents[1];
  const send = (kind: WorldEventKind, payload?: WorldEventPayload, extra: Partial<WorldEvent> = {}) => {
    if (!runtime || !actor) return;
    runtime.dispatch(ev(kind, actor.id, actor.displayName, { ...(payload ? { payload } : {}), ...(target && kind !== 'join' ? { targetId: target.id } : {}), ...extra }));
  };
  const saveAppearance = (appearance: AvatarAppearance) => {
    if (!runtime) return;
    runtime.dispatch(ev(me ? 'custom' : 'join', 'viewer:me', 'You', { payload: { appearance, action: me ? 'update-avatar' : undefined, personality: ['friendly', 'curious'] } }));
    setSelected('viewer:me');
    setView('world');
  };

  const panel = useMemo(() => ({ position: 'absolute' as const, top: 8, left: 8, zIndex: 10, display: 'flex', flexWrap: 'wrap' as const, gap: 6, maxWidth: 'min(860px, calc(100% - 16px))', background: 'rgba(10,14,16,.72)', padding: 8, borderRadius: 10, fontSize: 12 }), []);
  if (!runtime || !snap) return <div style={{ padding: 24 }}>Loading world…</div>;

  if (view === 'creator') {
    return <div style={{ position: 'fixed', inset: 0 }}>
      <AvatarCreator initialAppearance={me?.appearance} displayName={me?.displayName ?? 'You'} onSave={saveAppearance} onCancel={() => setView('world')} />
    </div>;
  }

  return <div style={{ position: 'fixed', inset: 0 }}>
    <Scene runtime={runtime} cameraMode={camera} transparent={view === 'overlay'} quality={quality}
      selectedResidentId={selected} onResidentSelect={id => setSelected(id || undefined)}
      viewerResidentId={me ? 'viewer:me' : undefined} showHud={view !== 'overlay'} showInspector={view !== 'overlay'} />
    {view !== 'overlay' && <div style={panel} data-testid="dev-panel">
      <b style={{ alignSelf: 'center' }}>Engine harness</b>
      <select value={camera} onChange={e => setCamera(e.target.value as CameraMode)}>{['neighborhood', 'orbit', 'street', 'follow', 'cinematic'].map(c => <option key={c}>{c}</option>)}</select>
      <select value={quality} onChange={e => setQuality(e.target.value as 'low' | 'high')}><option>high</option><option>low</option></select>
      <button onClick={() => setView('creator')}>{me ? 'Edit my character' : 'Create my character'}</button>
      <button onClick={() => { const n = ['Juniper', 'Atlas', 'Cleo', 'River', 'Sage', 'Indigo'][counter % 6]!; runtime.dispatch(ev('join', `demo:${n.toLowerCase()}-${counter}`, n)); }}>join</button>
      <button onClick={() => send('wave')}>wave</button>
      <button onClick={() => send('dance')}>dance</button>
      <button onClick={() => send('gift', { item: 'flowers' })}>gift</button>
      <button onClick={() => send('social', { action: 'greet' })}>greet</button>
      <button onClick={() => send('social', { action: 'compliment' })}>compliment</button>
      <button onClick={() => send('social', { action: 'befriend' })}>befriend</button>
      <button onClick={() => { const order = ['sunny', 'sunset', 'rain', 'snow'] as const; const next = order[(order.indexOf(snap.weather) + 1) % order.length]!; send('weather', { weather: next }); }}>weather: {snap.weather}</button>
      <button onClick={() => send('confetti')}>confetti</button>
      <button title="Fast-forward the world clock 3 game hours (small fixed steps, deterministic)" onClick={() => { for (let i = 0; i < 90; i++) runtime.tick(2); }}>+3h</button>
      <button onClick={() => send('raid', { amount: 42, channel: 'CozyStreamer' })}>raid</button>
      <input value={chat} onChange={e => setChat(e.target.value)} style={{ width: 160 }} />
      <button onClick={() => send('chat', undefined, { text: chat })}>chat</button>
      <span style={{ alignSelf: 'center', opacity: .8 }}>actor: {actor?.displayName ?? '—'} → {target?.displayName ?? '—'} · residents {residents.length} · t={snap.simulationTime.toFixed(0)}s · storage {runtime.storage.kind}{runtime.restored ? ' (restored)' : ''}</span>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
