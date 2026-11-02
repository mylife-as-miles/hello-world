import { describe, expect, it } from 'vitest';
import type { WorldEvent, WorldRuntime, WorldSnapshot } from '@hello-world/contracts';
import { SceneStore } from '../src/core/sceneStore';
import { createWorldRuntime } from '../src/runtime/index';

const flush = () => new Promise(r => setTimeout(r, 0));

describe('SceneStore', () => {
  it('emits each fresh event exactly once and tracks structure changes', async () => {
    const rt = createWorldRuntime({ worldId: 'store', seedResidents: true, autoTick: false });
    const store = new SceneStore(rt);
    store.start();
    const seen: string[] = [];
    let structures = 0;
    store.onEvent(fe => seen.push(fe.event.id));
    store.onStructure(() => structures++);
    rt.dispatch({ id: 'j1', kind: 'join', source: 'demo', actorId: 'twitch:a', actorDisplayName: 'A', timestamp: Date.now() });
    await flush();
    rt.tick(); await flush();
    rt.dispatch({ id: 'j1', kind: 'join', source: 'demo', actorId: 'twitch:a', actorDisplayName: 'A', timestamp: Date.now() });
    await flush();
    expect(seen.filter(id => id === 'j1')).toHaveLength(1);
    expect(structures).toBeGreaterThanOrEqual(1);
    expect(store.getResident('twitch:a')?.displayName).toBe('A');
    store.stop(); rt.dispose();
  });

  it('does not replay old history when a remote adapter delivers its first full snapshot', () => {
    let listener: ((s: WorldSnapshot) => void) | null = null;
    const empty: WorldSnapshot = { schemaVersion: 1, worldId: 'w', residents: [], relationships: [], weather: 'sunny', eventHistory: [], simulationTime: 0 };
    let current = empty;
    const remote: WorldRuntime = { getSnapshot: () => current, subscribe: l => { listener = l; return () => { listener = null; }; }, dispatch: () => {} };
    const store = new SceneStore(remote);
    store.start();
    const fired: string[] = [];
    store.onEvent(fe => fired.push(fe.event.id));
    const t = Date.now();
    const old: WorldEvent[] = Array.from({ length: 30 }, (_, i) => ({ id: `old-${i}`, kind: 'confetti', source: 'demo', actorId: 'x', actorDisplayName: 'X', timestamp: t - 600_000 + i }));
    const recent: WorldEvent = { id: 'recent', kind: 'raid', source: 'twitch', actorId: 'r', actorDisplayName: 'R', timestamp: t };
    current = { ...empty, eventHistory: [...old, recent] };
    listener!(current);
    expect(fired).toEqual(['recent']);
  });
});
