import { describe, expect, it } from 'vitest';
import type { WorldEvent, WorldSnapshot } from '@hello-world/contracts';
import { createSimulation, setDialogueProvider } from '../src/simulation';
import { createWorldRuntime } from '../src/runtime/createWorldRuntime';
import { findSeatNear, SPAWN_POINT } from '../src/world/layout';
import { ACTIVITY_VERBS, parseActivityVerb } from '../src/world/activities';
import { memoryClause, personalize } from '../src/simulation/dialogue';

const T0 = 1_700_000_000_000;
function clock() { let t = T0; return { now: () => t, advance: (ms: number) => { t += ms; } }; }
let n = 0;
const ev = (kind: WorldEvent['kind'], actorId: string, actorDisplayName: string, extra: Partial<WorldEvent> = {}, ts = T0): WorldEvent => ({
  id: `t-${n++}`, kind, source: 'demo', actorId, actorDisplayName, timestamp: ts, ...extra,
});
function runtime(opts: { initialSnapshot?: WorldSnapshot; seedResidents?: boolean; worldId?: string } = {}) {
  const c = clock();
  const rt = createWorldRuntime({ worldId: opts.worldId ?? 'test-world', seedResidents: opts.seedResidents ?? true, autoTick: false, now: c.now, ...(opts.initialSnapshot ? { initialSnapshot: opts.initialSnapshot } : {}) });
  const tick = (steps: number, dt = 0.5) => { for (let i = 0; i < steps; i++) { c.advance(dt * 1000); rt.tick(dt); } };
  return { rt, c, tick };
}
const verbOk = (activity: string) => (ACTIVITY_VERBS as readonly string[]).includes(activity.trim().split(/\s+/)[0]!.toLowerCase());

describe('simulation: seeds & contract shape', () => {
  it('seeds 13 distinct residents with 9 pre-existing relationships (incl. a rivalry) and plausible backstory memories', () => {
    const { rt } = runtime();
    const s = rt.getSnapshot();
    expect(s.residents.map(r => r.id)).toEqual(['seed:nova', 'seed:pixelcat', 'seed:mochi', 'seed:rex', 'seed:lumi', 'seed:bram', 'seed:kiki',
      'seed:elena', 'seed:marco', 'seed:juno', 'seed:ziggy', 'seed:olive', 'seed:toby']);
    expect(new Set(s.residents.map(r => r.activity)).size).toBeGreaterThanOrEqual(11);
    expect(new Set(s.residents.map(r => JSON.stringify(r.appearance))).size).toBe(13);
    expect(new Set(s.residents.map(r => r.personality.join(','))).size).toBe(13);
    expect(s.residents.filter(r => r.appearance.baseModelId.startsWith('vrm-')).map(r => r.id)).toEqual(['seed:kiki']);
    expect(s.residents.filter(r => r.appearance.baseModelId.startsWith('mh-')).map(r => r.id)).toEqual(['seed:elena', 'seed:marco']);
    expect(s.relationships.length).toBe(9);
    expect(s.relationships.some(r => r.friendship < 25)).toBe(true);
    for (const r of s.relationships) {
      expect(r.residentA < r.residentB).toBe(true);
      expect(r.memories.length).toBeGreaterThan(0);
      for (const m of r.memories) expect(m).toMatch(/^Yesterday · \d\d:\d\d · .+ — .+\.$/);
    }
    for (const r of s.residents) for (const k of ['energy', 'social', 'fun'] as const) { expect(r.needs[k]).toBeGreaterThanOrEqual(35); expect(r.needs[k]).toBeLessThanOrEqual(85); }
  });

  it('memory callbacks understand both stamp styles and speak in first person', () => {
    expect(memoryClause('Yesterday · 18:20 · Kiki and Toby raced around Town Plaza — Toby claims it was a tie.')).toBe('Kiki and Toby raced around Town Plaza');
    expect(memoryClause('Day 2 09:14 · Nova greeted PixelCat at Town Plaza — PixelCat beamed.')).toBe('Nova greeted PixelCat at Town Plaza');
    expect(personalize('Kiki and Toby raced around Town Plaza', 'Toby', 'Kiki')).toBe('we raced around Town Plaza');
    expect(personalize("Kiki beat Rex's high score at Pixel Arcade", 'Rex', 'Kiki')).toBe('you beat my high score at Pixel Arcade');
  });

  it('exportState returns fresh plain JSON with only contract keys', () => {
    const sim = createSimulation({ worldId: 'w', seedResidents: true, now: T0, maxResidents: 50 });
    sim.step(0.5, T0 + 500);
    const a = sim.exportState(), b = sim.exportState();
    expect(a).toEqual(b);
    expect(a.residents[0]).not.toBe(b.residents[0]);
    a.residents[0]!.needs.energy = -5; a.relationships[0]!.memories.push('x');
    expect(sim.exportState()).toEqual(b);
    for (const r of a.residents) {
      expect(Object.keys(r).sort()).toEqual(['activity', 'appearance', 'displayName', 'id', 'joinedAt', 'lastActiveAt', 'location', 'needs', 'personality']);
      expect(Object.keys(r.location).sort()).toEqual(['x', 'y', 'z', 'zone']);
      expect(r.location.y).toBe(0);
      expect(Math.round(r.location.x * 100) / 100).toBe(r.location.x);
      expect(verbOk(r.activity)).toBe(true);
    }
    for (const r of a.relationships) expect(Object.keys(r).sort()).toEqual(['friendship', 'lastInteractionAt', 'memories', 'residentA', 'residentB']);
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });
});

describe('simulation: determinism', () => {
  it('same snapshot + events + steps ⇒ identical state and history', () => {
    const script = (r: ReturnType<typeof runtime>) => {
      r.tick(20);
      r.rt.dispatch(ev('social', 'seed:nova', 'Nova', { id: 'd1', targetId: 'seed:pixelcat', payload: { action: 'greet' } }, r.c.now()));
      r.tick(30);
      r.rt.dispatch(ev('raid', 'tw:cozy', 'Cozy', { id: 'd2', payload: { amount: 20, channel: 'Cozy' } }, r.c.now()));
      r.rt.dispatch(ev('weather', 'tw:x', 'X', { id: 'd3', payload: { weather: 'rain' } }, r.c.now()));
      r.rt.dispatch(ev('join', 'tw:juniper', 'Juniper', { id: 'd4' }, r.c.now()));
      r.tick(120);
      return JSON.stringify(r.rt.getSnapshot());
    };
    const a = script(runtime()), b = script(runtime());
    expect(a).toBe(b);
    const restoredA = script(runtime({ initialSnapshot: JSON.parse(a) }));
    const restoredB = script(runtime({ initialSnapshot: JSON.parse(a) }));
    expect(restoredA).toBe(restoredB);
  });
});

describe('simulation: life', () => {
  it('residents move along paths and change activities over 120 steps of 0.5 s', () => {
    const { rt, tick } = runtime();
    const start = rt.getSnapshot();
    const seen = new Map<string, Set<string>>();
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      tick(1);
      for (const r of rt.getSnapshot().residents) {
        if (!seen.has(r.id)) seen.set(r.id, new Set());
        seen.get(r.id)!.add(r.activity);
        expect(verbOk(r.activity)).toBe(true);
      }
    }
    const end = rt.getSnapshot();
    for (const r of end.residents) {
      const s0 = start.residents.find(x => x.id === r.id)!;
      if (Math.hypot(r.location.x - s0.location.x, r.location.z - s0.location.z) > 1) moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(4);
    const changed = [...seen.values()].filter(s => s.size >= 2).length;
    expect(changed).toBeGreaterThanOrEqual(6);
    const verbs = new Set([...seen.values()].flatMap(s => [...s].map(parseActivityVerb)));
    expect(verbs.has('walking')).toBe(true);
    expect(verbs.size).toBeGreaterThanOrEqual(5);
  });

  it('needs decay and are restored by activities', () => {
    const { rt, tick } = runtime();
    const before = rt.getSnapshot().residents;
    tick(120);
    const after = rt.getSnapshot().residents;
    let changes = 0;
    for (const r of after) {
      const b = before.find(x => x.id === r.id)!;
      for (const k of ['energy', 'social', 'fun'] as const) {
        expect(r.needs[k]).toBeGreaterThanOrEqual(0); expect(r.needs[k]).toBeLessThanOrEqual(100);
        if (Math.abs(r.needs[k] - b.needs[k]) > 1) changes++;
      }
    }
    expect(changes).toBeGreaterThan(10);
  });

  it('needs hover in a healthy band and never pin at 100 for long', () => {
    const { rt, tick } = runtime();
    let total = 0, band = 0, wide = 0, maxStreak = 0;
    const streak = new Map<string, number>();
    for (let i = 0; i < 160; i++) {
      tick(5);
      for (const r of rt.getSnapshot().residents) for (const k of ['energy', 'social', 'fun'] as const) {
        const v = r.needs[k];
        total++; if (v >= 30 && v <= 80) band++; if (v >= 15 && v <= 95) wide++;
        const st = v >= 97 ? (streak.get(r.id + k) ?? 0) + 2.5 : 0;
        streak.set(r.id + k, st); maxStreak = Math.max(maxStreak, st);
      }
    }
    expect(band / total).toBeGreaterThan(0.65);
    expect(wide / total).toBeGreaterThan(0.95);
    expect(maxStreak).toBeLessThan(30);
  });

  it('low needs become visible states (lonely sulk, nap thoughts, bored wandering) and then drive goals', () => {
    const base = runtime().rt.getSnapshot();
    const pick = (id: string, needs: { energy: number; social: number; fun: number }) => ({ ...base.residents.find(r => r.id === id)!, needs, activity: 'thinking' });
    const snap: WorldSnapshot = { ...base, residents: [
      pick('seed:nova', { energy: 70, social: 4, fun: 70 }),
      pick('seed:rex', { energy: 6, social: 70, fun: 70 }),
      pick('seed:kiki', { energy: 70, social: 70, fun: 3 }),
    ], relationships: [], eventHistory: [] };
    const { rt, tick } = runtime({ initialSnapshot: snap });
    const seen = new Map<string, string[]>();
    for (let i = 0; i < 240; i++) { tick(1); for (const r of rt.getSnapshot().residents) seen.set(r.id, [...(seen.get(r.id) ?? []), r.activity]); }
    expect(seen.get('seed:nova')!.some(a => a.startsWith('sulking'))).toBe(true);
    expect(seen.get('seed:rex')!.some(a => a === 'thinking about a nap' || /^(resting|sitting|sleeping|drinking|eating)/.test(a))).toBe(true);
    expect(seen.get('seed:kiki')!.some(a => a === 'wandering around looking for fun' || /^(playing|dancing)/.test(a))).toBe(true);
    const end = rt.getSnapshot().residents;
    expect(end.find(r => r.id === 'seed:rex')!.needs.energy).toBeGreaterThan(20);
    expect(end.find(r => r.id === 'seed:kiki')!.needs.fun).toBeGreaterThan(20);
  });

  it('seats are exclusive and sitters stand exactly on seat coordinates', () => {
    const { rt, tick } = runtime();
    for (let i = 0; i < 300; i++) {
      tick(1);
      const sitters = rt.getSnapshot().residents.filter(r => /^(sitting|drinking|eating)/.test(r.activity));
      const keys = new Set<string>();
      for (const r of sitters) {
        const seat = findSeatNear(r.location.x, r.location.z, 0.01);
        expect(seat, `${r.id} ${r.activity}`).not.toBeNull();
        const key = `${seat!.seat.x},${seat!.seat.z}`;
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
  });

  it('autonomous chatter is rate limited and conversations use simulation chat events', () => {
    const { rt, tick } = runtime();
    tick(240); // 120 s
    const sim = rt.getSnapshot().eventHistory.filter(e => e.source === 'simulation');
    expect(sim.length).toBeGreaterThan(4);
    expect(sim.length).toBeLessThan(80);
    for (const e of sim) { expect(e.id.startsWith('sim:test-world:')).toBe(true); if (e.kind === 'chat') expect(e.text?.length).toBeGreaterThan(0); }
    expect(sim.some(e => e.kind === 'chat' && e.targetId)).toBe(true);
    expect(new Set(sim.map(e => e.id)).size).toBe(sim.length);
  });
});

describe('simulation: contract events', () => {
  it('join spawns at the portal, walks to the plaza; rejoin keeps relationships and updates appearance', () => {
    const { rt, c, tick } = runtime();
    rt.dispatch(ev('join', 'tw:juniper', 'Juniper', { payload: { personality: ['friendly', 'pirate'] } }, c.now()));
    let me = rt.getSnapshot().residents.find(r => r.id === 'tw:juniper')!;
    expect(me.activity).toBe('arriving through the portal');
    expect(Math.hypot(me.location.x - SPAWN_POINT.x, me.location.z - SPAWN_POINT.z)).toBeLessThan(2.5);
    expect(me.personality).toEqual(['friendly', 'pirate']);
    tick(60);
    me = rt.getSnapshot().residents.find(r => r.id === 'tw:juniper')!;
    expect(me.location.z).toBeGreaterThan(-12);
    rt.dispatch(ev('social', 'tw:juniper', 'Juniper', { targetId: 'seed:nova', payload: { action: 'greet' } }, c.now()));
    const rel = () => rt.getSnapshot().relationships.find(r => r.residentA === 'seed:nova' && r.residentB === 'tw:juniper');
    expect(rel()).toBeTruthy();
    const appearance = { ...me.appearance, hairStyle: 'mohawk', hairColor: '#e36aa6' };
    c.advance(2000);
    rt.dispatch(ev('join', 'tw:juniper', 'Juniper the Bold', { payload: { appearance } }, c.now()));
    me = rt.getSnapshot().residents.find(r => r.id === 'tw:juniper')!;
    expect(me.appearance.hairStyle).toBe('mohawk');
    expect(me.displayName).toBe('Juniper the Bold');
    expect(rt.getSnapshot().residents.filter(r => r.id === 'tw:juniper').length).toBe(1);
    expect(rel()).toBeTruthy();
  });

  it('re-join with appearance + personality updates both, keeps needs/location/relationships and reacts visibly', () => {
    const { rt, c, tick } = runtime();
    tick(10);
    const before = rt.getSnapshot();
    const nova = before.residents.find(r => r.id === 'seed:nova')!;
    const rels = before.relationships.filter(r => r.residentA === 'seed:nova' || r.residentB === 'seed:nova');
    const appearance = { ...nova.appearance, hairStyle: 'braids', outfit: { ...nova.appearance.outfit, color: '#3fb39b' } };
    rt.dispatch(ev('join', 'seed:nova', 'Nova Prime', { payload: { appearance, personality: ['shy', 'bookish'] } }, c.now()));
    const after = rt.getSnapshot();
    const n2 = after.residents.find(r => r.id === 'seed:nova')!;
    expect(n2.appearance.hairStyle).toBe('braids');
    expect(n2.appearance.outfit.color).toBe('#3fb39b');
    expect(n2.personality).toEqual(['shy', 'bookish']);
    expect(n2.displayName).toBe('Nova Prime');
    expect(n2.needs).toEqual(nova.needs);
    expect(Math.hypot(n2.location.x - nova.location.x, n2.location.z - nova.location.z)).toBeLessThan(1);
    expect(n2.activity).toBe('admiring their new look');
    for (const r of rels) expect(after.relationships).toContainEqual(r);
    expect(after.eventHistory.some(e => e.source === 'simulation' && e.actorId === 'seed:nova' && e.kind === 'chat' && e.payload?.reaction === 'new-look' && !!e.text)).toBe(true);
    expect(after.residents.length).toBe(before.residents.length);
  });

  it('Nova greets PixelCat → positive reply → friendship up → memory → survives snapshot round trip', () => {
    const { rt, c } = runtime();
    const f0 = rt.getSnapshot().relationships.find(r => r.residentA === 'seed:nova' && r.residentB === 'seed:pixelcat')!;
    rt.dispatch(ev('social', 'seed:nova', 'Nova', { id: 'greet-1', targetId: 'seed:pixelcat', payload: { action: 'greet' } }, c.now()));
    const snap = rt.getSnapshot();
    const reply = snap.eventHistory.find(e => e.source === 'simulation' && e.actorId === 'seed:pixelcat' && e.targetId === 'seed:nova');
    expect(reply).toBeTruthy();
    expect(reply!.payload?.action).toBe('greet');
    expect(reply!.payload?.sentiment).toBe('positive');
    expect(reply!.text!.length).toBeGreaterThan(2);
    const rel = snap.relationships.find(r => r.residentA === 'seed:nova' && r.residentB === 'seed:pixelcat')!;
    expect(rel.friendship).toBeGreaterThan(f0.friendship);
    const mem = rel.memories[rel.memories.length - 1]!;
    expect(mem).toMatch(/^Day 1 \d\d:\d\d · Nova greeted PixelCat .* — PixelCat .+\.$/);
    const saved = JSON.parse(JSON.stringify(snap)) as WorldSnapshot;
    const { rt: rt2 } = runtime({ initialSnapshot: saved });
    const s2 = rt2.getSnapshot();
    expect(s2.residents.map(r => r.id)).toEqual(snap.residents.map(r => r.id));
    const rel2 = s2.relationships.find(r => r.residentA === 'seed:nova' && r.residentB === 'seed:pixelcat')!;
    expect(rel2.friendship).toBe(rel.friendship);
    expect(rel2.memories).toContain(mem);
    expect(s2.eventHistory.map(e => e.id)).toEqual(snap.eventHistory.map(e => e.id));
  });

  it('raid spawns visitors at the portal; locals welcome them; visitors leave after ~240 s', () => {
    const { rt, c, tick } = runtime();
    rt.dispatch(ev('raid', 'tw:cozy', 'CozyStreamer', { id: 'raid-1', payload: { amount: 30, channel: 'CozyStreamer' } }, c.now()));
    tick(8);
    let visitors = rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:raid-1:'));
    expect(visitors.length).toBe(5);
    expect(new Set(visitors.map(v => v.displayName)).size).toBe(5);
    expect(visitors.map(v => v.displayName)).toContain("CozyStreamer's #1 fan");
    const celebrate = rt.getSnapshot().eventHistory.find(e => e.source === 'simulation' && e.payload?.reaction === 'raid')!;
    expect(celebrate.payload).toMatchObject({ action: 'celebrate', visitors: 30, amount: 30, channel: 'CozyStreamer' });
    for (const v of visitors) {
      expect(v.displayName).not.toMatch(/Raider \d+$/);
      expect(v.displayName.length).toBeLessThanOrEqual(40);
      expect(Math.hypot(v.location.x - SPAWN_POINT.x, v.location.z - SPAWN_POINT.z)).toBeLessThan(6);
      expect(v.appearance.baseModelId.startsWith('vrm-')).toBe(true);
    }
    expect(new Set(visitors.map(v => v.appearance.baseModelId)).size).toBe(4);
    const locals = rt.getSnapshot().residents.filter(r => r.id.startsWith('seed:') && /(to the Raid Portal|for the raiders)/.test(r.activity));
    expect(locals.length).toBeGreaterThanOrEqual(2);
    tick(2 * 300);
    visitors = rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:'));
    expect(visitors.length).toBe(0);
    expect(rt.getSnapshot().relationships.some(r => r.residentA.startsWith('raid:') || r.residentB.startsWith('raid:'))).toBe(false);
  });

  it('weather changes the world and residents react', () => {
    const { rt, c, tick } = runtime();
    rt.dispatch(ev('weather', 'tw:x', 'X', { payload: { weather: 'rain' } }, c.now()));
    expect(rt.getSnapshot().weather).toBe('rain');
    tick(4);
    const acts = rt.getSnapshot().residents.map(r => r.activity);
    expect(acts.some(a => /(Sunbeam Café|Pixel Arcade|home|in the rain)/.test(a))).toBe(true);
    expect(rt.getSnapshot().eventHistory.some(e => e.source === 'simulation' && e.payload?.reaction === 'weather')).toBe(true);
    c.advance(5000);
    rt.dispatch(ev('weather', 'tw:x', 'X', { payload: { weather: 'sunset' } }, c.now()));
    tick(30);
    expect(rt.getSnapshot().residents.some(r => r.activity.startsWith('admiring the sunset'))).toBe(true);
  });

  it('wave, gift, dance, chat, compliment, befriend, confetti and custom destination all react', () => {
    const { rt, c, tick } = runtime();
    const at = () => { c.advance(3000); return c.now(); };
    rt.dispatch(ev('wave', 'seed:nova', 'Nova', { targetId: 'seed:pixelcat' }, at()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'seed:nova')!.activity).toBe('waving at PixelCat');
    tick(3);
    expect(rt.getSnapshot().eventHistory.some(e => e.kind === 'wave' && e.source === 'simulation' && e.actorId === 'seed:pixelcat')).toBe(true);
    const f0 = rt.getSnapshot().relationships.find(r => r.residentA === 'seed:bram' && r.residentB === 'seed:mochi')!.friendship;
    rt.dispatch(ev('gift', 'seed:mochi', 'Mochi', { targetId: 'seed:bram', payload: { item: 'rose' } }, at()));
    const s = rt.getSnapshot();
    expect(s.residents.find(r => r.id === 'seed:bram')!.activity).toBe('thanking Mochi');
    const rel = s.relationships.find(r => r.residentA === 'seed:bram' && r.residentB === 'seed:mochi')!;
    expect(rel.friendship - f0).toBeGreaterThanOrEqual(8);
    expect(rel.memories[rel.memories.length - 1]).toContain('Mochi gave Bram a rose');
    rt.dispatch(ev('dance', 'tw:newbie', 'Newbie', {}, at()));
    expect(rt.getSnapshot().residents.some(r => r.id === 'tw:newbie')).toBe(true);
    rt.dispatch(ev('dance', 'seed:kiki', 'Kiki', {}, at()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'seed:kiki')!.activity.startsWith('dancing') || rt.getSnapshot().residents.find(r => r.id === 'seed:kiki')!.activity.startsWith('walking')).toBe(true);
    rt.dispatch(ev('chat', 'seed:nova', 'Nova', { text: 'hello everyone!' }, at()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'seed:nova')!.activity).toBe('chatting');
    rt.dispatch(ev('social', 'seed:lumi', 'Lumi', { targetId: 'seed:nova', payload: { action: 'compliment' } }, at()));
    expect(rt.getSnapshot().eventHistory.some(e => e.source === 'simulation' && e.actorId === 'seed:nova' && e.payload?.action === 'compliment')).toBe(true);
    rt.dispatch(ev('social', 'seed:nova', 'Nova', { targetId: 'seed:pixelcat', payload: { action: 'befriend' } }, at()));
    expect(rt.getSnapshot().eventHistory.some(e => e.source === 'simulation' && e.payload?.action === 'befriend')).toBe(true);
    rt.dispatch(ev('confetti', 'seed:nova', 'Nova', {}, at()));
    expect(rt.getSnapshot().residents.filter(r => /^(cheering|celebrating)/.test(r.activity)).length).toBeGreaterThanOrEqual(2);
    rt.dispatch(ev('custom', 'seed:rex', 'Rex', { payload: { destination: 'arcade' } }, at()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'seed:rex')!.activity).toMatch(/Pixel Arcade/);
    rt.dispatch(ev('custom', 'seed:rex', 'Rex', { payload: { action: 'update-avatar', appearance: { ...s.residents[3]!.appearance, hairStyle: 'afro' } } }, at()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'seed:rex')!.appearance.hairStyle).toBe('afro');
    tick(60);
  });

  it('respects the population cap of 50', () => {
    const { rt, c, tick } = runtime();
    for (let i = 0; i < 70; i++) { c.advance(10); rt.dispatch(ev('join', `tw:user${i}`, `User ${i}`, {}, c.now())); }
    expect(rt.getSnapshot().residents.length).toBe(50);
    rt.dispatch(ev('raid', 'tw:big', 'Big', { payload: { amount: 100 } }, c.now()));
    tick(40);
    expect(rt.getSnapshot().residents.length).toBeLessThanOrEqual(50);
  });

  it('50 residents step in well under 2 ms', () => {
    const { rt, c, tick } = runtime();
    for (let i = 0; i < 60; i++) { c.advance(10); rt.dispatch(ev('join', `tw:p${i}`, `P${i}`, {}, c.now())); }
    tick(40);
    // Best of several chunks: robust against CI / parallel-test CPU contention.
    let best = Infinity;
    for (let k = 0; k < 6; k++) { const t0 = performance.now(); tick(100); best = Math.min(best, (performance.now() - t0) / 100); }
    expect(rt.getSnapshot().residents.length).toBe(50);
    expect(best).toBeLessThan(2);
  });

  it('optional dialogue provider only adds extra chat lines, never state', async () => {
    const make = () => createSimulation({ worldId: 'llm', seedResidents: true, now: T0, maxResidents: 50 });
    const plain = make(), withLlm = make();
    setDialogueProvider(withLlm, { generate: async () => 'A <b>bold</b> line\nsecond line' });
    let extra = 0;
    for (let i = 0; i < 400; i++) {
      plain.step(0.5, T0 + i * 500);
      const out = withLlm.step(0.5, T0 + i * 500);
      extra += out.filter(e => e.payload?.reaction === 'llm').length;
      for (const e of out.filter(e => e.payload?.reaction === 'llm')) expect(e.text).toBe('A bbold/b line');
      await Promise.resolve(); await Promise.resolve();
    }
    expect(withLlm.exportState()).toEqual(plain.exportState());
    expect(extra).toBeGreaterThan(0);
  });
});
