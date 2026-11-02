import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '@hello-world/contracts';
import { createWorldRuntime, HISTORY_LIMIT } from '../src/runtime/createWorldRuntime';

const T0 = 1_700_000_000_000;
let n = 0;
const ev = (kind: WorldEvent['kind'], actorId: string, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  id: `r-${n++}`, kind, source: 'demo', actorId, actorDisplayName: actorId, timestamp: T0 + n * 5000, ...extra,
});

describe('runtime + simulation integration', () => {
  it('rejects malformed events and ignores duplicate ids', () => {
    const rejected: string[] = [];
    let t = T0;
    const rt = createWorldRuntime({ worldId: 'rt', seedResidents: true, autoTick: false, now: () => t, onReject: r => rejected.push(r) });
    const before = JSON.stringify(rt.getSnapshot().residents);
    rt.dispatch({ nope: true } as unknown as WorldEvent);
    rt.dispatch({ ...ev('chat', 'tw:a'), text: '' });
    rt.dispatch({ ...ev('weather', 'tw:a') });
    rt.dispatch({ ...ev('wave', 'bad id with spaces') });
    rt.dispatch({ ...ev('join', 'tw:a'), kind: 'explode' as WorldEvent['kind'] });
    expect(rejected.length).toBe(5);
    expect(JSON.stringify(rt.getSnapshot().residents)).toBe(before);
    const join = ev('join', 'tw:dup');
    rt.dispatch(join);
    rt.dispatch({ ...join });
    expect(rt.stats.duplicates).toBe(1);
    expect(rt.getSnapshot().residents.filter(r => r.id === 'tw:dup').length).toBe(1);
    expect(rt.getSnapshot().eventHistory.filter(e => e.id === join.id).length).toBe(1);
    t += 1000;
  });

  it('keeps history bounded at 100 with unique ids', () => {
    let t = T0;
    const rt = createWorldRuntime({ worldId: 'rt2', seedResidents: true, autoTick: false, now: () => t });
    for (let i = 0; i < 400; i++) {
      t += 500;
      if (i % 3 === 0) rt.dispatch(ev('chat', `tw:u${i % 7}`, { text: `hi ${i}`, timestamp: t }));
      if (i % 11 === 0) rt.dispatch(ev('wave', `tw:u${i % 5}`, { timestamp: t }));
      rt.tick(0.5);
      const h = rt.getSnapshot().eventHistory;
      expect(h.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    }
    const h = rt.getSnapshot().eventHistory;
    expect(h.length).toBe(HISTORY_LIMIT);
    expect(new Set(h.map(e => e.id)).size).toBe(h.length);
  });

  it('snapshots are frozen, emitted to subscribers and restore without duplicate seeds', async () => {
    let t = T0;
    const rt = createWorldRuntime({ worldId: 'rt3', seedResidents: true, autoTick: false, now: () => t });
    const got: number[] = [];
    const unsub = rt.subscribe(s => got.push(s.simulationTime));
    for (let i = 0; i < 10; i++) { t += 500; rt.tick(0.5); }
    await Promise.resolve();
    expect(got.length).toBeGreaterThan(0);
    unsub();
    const snap = rt.getSnapshot();
    expect(Object.isFrozen(snap.residents[0])).toBe(true);
    const rt2 = createWorldRuntime({ worldId: 'rt3', seedResidents: true, autoTick: false, now: () => t, initialSnapshot: JSON.parse(JSON.stringify(snap)) });
    const s2 = rt2.getSnapshot();
    expect(s2.residents.length).toBe(snap.residents.length);
    expect(new Set(s2.residents.map(r => r.id)).size).toBe(s2.residents.length);
    expect(s2.simulationTime).toBe(snap.simulationTime);
    expect(s2.relationships).toEqual(snap.relationships);
    for (let i = 0; i < 20; i++) { t += 500; rt2.tick(0.5); }
    const ids = rt2.getSnapshot().eventHistory.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
