import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@hello-world/contracts';
import { createPersistentWorldRuntime, createIndexedDbSnapshotStorage, createMemorySnapshotStorage } from '../src/persistence/index';
import { migrateSnapshot } from '../src/runtime/migrate';

const join = (id: string, name: string, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  id: `e-${id}-${Math.random()}`, kind: 'join', source: 'demo', actorId: id, actorDisplayName: name, timestamp: Date.now(), ...extra,
});

describe('persistence', () => {
  for (const make of [() => createIndexedDbSnapshotStorage(`test-db-${Math.random()}`), () => createMemorySnapshotStorage()]) {
    it(`round-trips residents, appearance and relationships (${make().kind})`, async () => {
      const storage = make();
      const a = await createPersistentWorldRuntime({ worldId: 'persist', seedResidents: true, autoTick: false, storage, saveDebounceMs: 5 });
      expect(a.restored).toBe(false);
      a.dispatch(join('viewer:zed', 'Zed', { payload: { appearance: { baseModelId: 'townie-sporty', skinTone: '#8f5838', hairStyle: 'afro', hairColor: '#c2412d', outfit: { top: 'hoodie', bottom: 'shorts', shoes: 'boots', color: '#3fb39b' }, accessories: ['glasses'], face: { eyeColor: '#2f6a8f', eyeSize: 0.8, noseSize: 0.2, mouthSize: 0.6 }, body: { height: 0.9, build: 0.3 } } } }));
      for (let i = 0; i < 10; i++) a.tick();
      const saved = a.getSnapshot();
      await a.flush();
      a.dispose();

      const b = await createPersistentWorldRuntime({ worldId: 'persist', seedResidents: true, autoTick: false, storage });
      expect(b.restored).toBe(true);
      const snap = b.getSnapshot();
      expect(snap.residents.map(r => r.id).sort()).toEqual(saved.residents.map(r => r.id).sort());
      const zed = snap.residents.find(r => r.id === 'viewer:zed')!;
      expect(zed.appearance.hairStyle).toBe('afro');
      expect(zed.appearance.outfit.color).toBe('#3fb39b');
      expect(snap.relationships).toEqual(saved.relationships);
      expect(snap.simulationTime).toBe(saved.simulationTime);
      b.dispose();
    });
  }

  it('throttles routine saves but persists viewer actions almost immediately', async () => {
    const inner = createMemorySnapshotStorage();
    const saves: number[] = [];
    const storage = { ...inner, save: async (s: Parameters<typeof inner.save>[0]) => { saves.push(s.simulationTime); await inner.save(s); } };
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    const rt = await createPersistentWorldRuntime({ worldId: 'cadence', seedResidents: true, autoTick: false, storage, saveDebounceMs: 120, eventSaveDelayMs: 10 });
    await rt.flush();
    const base = saves.length; // the initial save
    // routine ticks every 10 ms for ~300 ms: a throttle (not a starving debounce) saves about every 120 ms
    for (let i = 0; i < 30; i++) { rt.tick(); await wait(10); }
    await wait(20);
    const routine = saves.length - base;
    expect(routine).toBeGreaterThanOrEqual(1);
    expect(routine).toBeLessThanOrEqual(4);
    // a viewer action is written within the short event delay, long before the routine interval
    const before = saves.length;
    rt.dispatch(join('viewer:quick', 'Quick'));
    await wait(40);
    expect(saves.length).toBeGreaterThan(before);
    expect((await inner.load('cadence'))?.residents.some(r => r.id === 'viewer:quick')).toBe(true);
    rt.dispose();
  });

  it('migrateSnapshot rejects garbage and repairs out-of-range values', () => {
    expect(migrateSnapshot(null)).toBeNull();
    expect(migrateSnapshot({ schemaVersion: 99 })).toBeNull();
    const fixed = migrateSnapshot({ schemaVersion: 1, worldId: 'w', residents: [{ id: 'a', displayName: '<b>Al</b>', needs: { energy: 500 }, location: { x: 1e9 }, appearance: { hairStyle: 'nope' } }], relationships: [], weather: 'tornado', eventHistory: [{ bad: true }], simulationTime: -5 })!;
    expect(fixed.residents[0]!.needs.energy).toBe(100);
    expect(fixed.residents[0]!.location.x).toBe(40);
    expect(fixed.residents[0]!.appearance.hairStyle).toBe('short');
    expect(fixed.residents[0]!.displayName).toBe('bAl/b');
    expect(fixed.weather).toBe('sunny');
    expect(fixed.eventHistory).toEqual([]);
    expect(fixed.simulationTime).toBe(0);
  });
});
