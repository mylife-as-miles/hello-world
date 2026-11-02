import { describe, expect, it } from 'vitest';
import type { WorldEvent, WorldSnapshot } from '@hello-world/contracts';
import { createWorldRuntime } from '../src/runtime/index';

let n = 0;
const ev = (kind: WorldEvent['kind'], actorId: string, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  id: `g-${n++}`, kind, source: 'twitch', actorId, actorDisplayName: actorId, timestamp: 1_700_000_000_000 + n * 10_000, ...extra,
});
const tick = () => new Promise(r => setTimeout(r, 0));

describe('runtime wrapper guards', () => {
  it('rejects malformed events without throwing', () => {
    const reasons: string[] = [];
    const rt = createWorldRuntime({ worldId: 'g1', seedResidents: false, autoTick: false, onReject: r => reasons.push(r) });
    const bad: unknown[] = [null, 42, 'x', [], {}, { ...ev('join', 'a'), kind: 'explode' }, { ...ev('join', 'a'), actorId: 'has spaces!' },
      { ...ev('chat', 'a'), text: '   ' }, { ...ev('weather', 'a'), payload: { weather: 'hail' } }, { ...ev('join', 'a'), timestamp: Number.NaN },
      { ...ev('join', 'a'), source: 'admin' }];
    for (const b of bad) expect(() => rt.dispatch(b as WorldEvent)).not.toThrow();
    expect(rt.stats.rejected).toBe(bad.length);
    expect(rt.getSnapshot().residents).toHaveLength(0);
    rt.dispose();
  });

  it('ignores duplicate ids and enforces per-actor cooldowns by event time', () => {
    const rt = createWorldRuntime({ worldId: 'g2', seedResidents: false, autoTick: false });
    const join = ev('join', 'twitch:1');
    rt.dispatch(join); rt.dispatch(join);
    expect(rt.stats.duplicates).toBe(1);
    const t = 1_800_000_000_000;
    rt.dispatch({ ...ev('dance', 'twitch:1'), timestamp: t });
    rt.dispatch({ ...ev('dance', 'twitch:1'), timestamp: t + 100 }); // inside 1.5 s cooldown
    rt.dispatch({ ...ev('dance', 'twitch:1'), timestamp: t + 5000 });
    expect(rt.stats.rejected).toBe(1);
    rt.dispose();
  });

  it('survives an event flood with bounded history and population', () => {
    const rt = createWorldRuntime({ worldId: 'g3', seedResidents: true, autoTick: false });
    for (let i = 0; i < 400; i++) rt.dispatch(ev(i % 3 === 0 ? 'join' : 'chat', `twitch:${i}`, { text: `hi ${i} <script>alert(1)</script>` }));
    for (let i = 0; i < 20; i++) rt.tick();
    const s = rt.getSnapshot();
    expect(s.eventHistory.length).toBeLessThanOrEqual(100);
    expect(s.residents.length).toBeLessThanOrEqual(50);
    for (const e of s.eventHistory) expect(e.text ?? '').not.toMatch(/[<>]/);
    rt.dispose();
  });

  it('emits frozen snapshots, coalesces notifications and stops after dispose', async () => {
    const rt = createWorldRuntime({ worldId: 'g4', seedResidents: true, autoTick: false });
    const got: WorldSnapshot[] = [];
    const unsub = rt.subscribe(s => got.push(s));
    rt.dispatch(ev('join', 'twitch:x'));
    rt.dispatch(ev('wave', 'twitch:x'));
    rt.tick();
    await tick();
    expect(got).toHaveLength(1);
    const s = got[0]!;
    expect(Object.isFrozen(s) && Object.isFrozen(s.residents) && Object.isFrozen(s.residents[0]!.location)).toBe(true);
    expect(() => { (s.residents as unknown as unknown[]).push({}); }).toThrow();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    unsub();
    rt.dispatch(ev('dance', 'twitch:x'));
    await tick();
    expect(got).toHaveLength(1);
    rt.dispose();
    rt.dispatch(ev('join', 'twitch:after'));
    expect(rt.getSnapshot().residents.some(r => r.id === 'twitch:after')).toBe(false);
  });

  it('autoTick advances simulation time and dispose clears the timer', async () => {
    const rt = createWorldRuntime({ worldId: 'g5', seedResidents: true, autoTick: true, tickIntervalMs: 50 });
    await new Promise(r => setTimeout(r, 220));
    const t1 = rt.getSnapshot().simulationTime;
    expect(t1).toBeGreaterThan(0);
    rt.dispose();
    await new Promise(r => setTimeout(r, 150));
    expect(rt.getSnapshot().simulationTime).toBe(t1);
  });
});

describe('auto tick catch-up', () => {
  it('keeps simulation time close to wall time when the host blocks', async () => {
    const rt = createWorldRuntime({ worldId: 'g6', seedResidents: true, autoTick: true, tickIntervalMs: 50 });
    const t0 = Date.now();
    while (Date.now() - t0 < 300) { /* block the event loop like a busy server */ }
    await new Promise(r => setTimeout(r, 260));
    const simulated = rt.getSnapshot().simulationTime;
    rt.dispose();
    // ~560 ms of wall time at 50 ms/step ≈ 11 steps; without catch-up only ~5 run.
    expect(simulated).toBeGreaterThanOrEqual(0.4);
  });
});

describe('server-owned rate limits', () => {
  it('ingressCooldowns:false applies every validated event (Director cooldown 0 s)', () => {
    const rt = createWorldRuntime({ worldId: 'g7', seedResidents: false, autoTick: false, ingressCooldowns: false });
    const t = 1_900_000_000_000;
    rt.dispatch({ id: 'c1', kind: 'join', source: 'twitch', actorId: 'twitch:z', actorDisplayName: 'Z', timestamp: t });
    rt.dispatch({ id: 'c2', kind: 'dance', source: 'twitch', actorId: 'twitch:z', actorDisplayName: 'Z', timestamp: t + 10 });
    rt.dispatch({ id: 'c3', kind: 'dance', source: 'twitch', actorId: 'twitch:z', actorDisplayName: 'Z', timestamp: t + 20 });
    expect(rt.stats.rejected).toBe(0);
    expect(rt.stats.accepted).toBe(3);
    rt.dispatch({ id: 'c3', kind: 'dance', source: 'twitch', actorId: 'twitch:z', actorDisplayName: 'Z', timestamp: t + 30 });
    expect(rt.stats.duplicates).toBe(1); // dedupe stays on
    rt.dispose();
  });
});
