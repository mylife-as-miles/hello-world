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
