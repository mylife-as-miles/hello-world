import { describe, expect, it } from 'vitest';
import type { WorldEvent, WorldSnapshot } from '@hello-world/contracts';
import { createSimulation, setDialogueProvider } from '../src/simulation';
import { createWorldRuntime } from '../src/runtime/createWorldRuntime';
import { findSeatNear, SPAWN_POINT } from '../src/world/layout';
import { ACTIVITY_VERBS, parseActivityVerb } from '../src/world/activities';
import { memoryClause, personalize } from '../src/simulation/dialogue';
import { raidVisitorCount } from '../src/simulation/events';

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

  it('seed relationships were last active the evening before the 08:00 start (≈ 10–16 h earlier)', () => {
    const { rt } = runtime();
    for (const r of rt.getSnapshot().relationships) {
      const hoursAgo = (T0 - r.lastInteractionAt) / 3_600_000;
      expect(hoursAgo).toBeGreaterThan(9);
      expect(hoursAgo).toBeLessThan(16);
    }
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
    expect(band / total).toBeGreaterThan(0.6);
    expect(wide / total).toBeGreaterThan(0.85);
    expect(maxStreak).toBeLessThan(30);
  });

  it('low needs become visible states (lonely sulk, nap thoughts, bored wandering) and then drive goals', () => {
    const base = runtime().rt.getSnapshot();
    const pick = (id: string, needs: { energy: number; social: number; fun: number }) => ({ ...base.residents.find(r => r.id === id)!, needs, activity: 'thinking' });
    const snap: WorldSnapshot = { ...base, residents: [
      pick('seed:nova', { energy: 70, social: 4, fun: 70 }),
      pick('seed:mochi', { energy: 6, social: 70, fun: 70 }),
      pick('seed:kiki', { energy: 70, social: 70, fun: 3 }),
    ], relationships: [], eventHistory: [] };
    const { rt, tick } = runtime({ initialSnapshot: snap });
    const seen = new Map<string, string[]>();
    for (let i = 0; i < 240; i++) { tick(1); for (const r of rt.getSnapshot().residents) seen.set(r.id, [...(seen.get(r.id) ?? []), r.activity]); }
    expect(seen.get('seed:nova')!.some(a => /^(sulking|sitting alone|watching the crowd)/.test(a))).toBe(true);
    expect(seen.get('seed:mochi')!.some(a => a === 'thinking about a nap' || /^(resting|sitting|sleeping|drinking|eating)/.test(a))).toBe(true);
    expect(seen.get('seed:kiki')!.some(a => /^(wandering around looking for fun|wandering over to|watching the fountain, bored|thinking about something fun|playing|dancing)/.test(a))).toBe(true);
    const end = rt.getSnapshot().residents;
    // Recovery is under way (residents may still be dipping — that's the drama).
    expect(end.find(r => r.id === 'seed:mochi')!.needs.energy).toBeGreaterThan(14);
    expect(end.find(r => r.id === 'seed:kiki')!.needs.fun).toBeGreaterThan(6);
  });

  it('dialogue never repeats a line within 3 sim-minutes and memories vary their phrasing', () => {
    const { rt, tick } = runtime();
    const lastSaid = new Map<string, number>();
    const seenIds = new Set<string>();
    for (let i = 0; i < 1200; i++) {
      tick(1);
      const snap = rt.getSnapshot();
      for (const e of snap.eventHistory) {
        if (e.source !== 'simulation' || !e.text || seenIds.has(e.id)) continue;
        seenIds.add(e.id);
        const prev = lastSaid.get(e.text);
        if (prev !== undefined) expect(snap.simulationTime - prev, e.text).toBeGreaterThanOrEqual(170);
        lastSaid.set(e.text, snap.simulationTime);
      }
    }
    const tails = new Map<string, number>();
    for (const r of rt.getSnapshot().relationships) for (const m of r.memories) {
      if (m.startsWith('Yesterday')) continue;
      const clause = m.split(' · ').slice(1).join(' · ').split(' — ')[0]!.replace(/^\S+ /, '').split(' ')[0]!;
      tails.set(clause, (tails.get(clause) ?? 0) + 1);
    }
    expect(tails.size).toBeGreaterThanOrEqual(5);
  });

  it('drama + variety over 12 game hours: some low-need states, and exchanges shift as friendships grow', () => {
    const { rt, tick } = runtime();
    let samples = 0, low = 0;
    const lowKinds = new Set<string>();
    const states = new Set<string>();
    const seen = new Set<string>();
    const starts = { greet: 0, compliment: 0, gift: 0, befriend: 0 };
    for (let i = 0; i < 1440; i++) {
      tick(1);
      const s = rt.getSnapshot();
      for (const e of s.eventHistory) {
        if (e.source !== 'simulation' || seen.has(e.id)) continue;
        seen.add(e.id);
        if (e.kind === 'gift') starts.gift++;
        if (e.kind === 'social' && e.payload?.action === 'compliment' && e.payload?.sentiment === 'positive' && !e.payload?.reaction) starts.compliment++;
        if (e.kind === 'social' && e.payload?.action === 'befriend') starts.befriend++;
        if (e.kind === 'social' && e.payload?.action === 'greet' && /^(Hi|Hello|Hey|Oh, a new|Um|H-|Greetings|\.\.\.|Name|I’m)/.test(e.text ?? '') && /I’m|name’s|Name’s/i.test(e.text ?? '')) starts.greet++;
      }
      if (i % 4) continue;
      for (const r of s.residents) {
        samples++;
        for (const k of ['energy', 'social', 'fun'] as const) if (r.needs[k] < 25) lowKinds.add(k);
        if (Math.min(r.needs.energy, r.needs.social, r.needs.fun) < 25) low++;
        if (/^(sulking|thinking about a nap|wandering around looking for fun)/.test(r.activity)) states.add(r.activity.split(' ')[0]!);
      }
    }
    const share = low / samples;
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.2);
    expect(lowKinds.size).toBeGreaterThanOrEqual(2);
    expect(states.size).toBeGreaterThanOrEqual(2);
    expect(starts.compliment).toBeGreaterThanOrEqual(4);
    expect(starts.gift).toBeGreaterThanOrEqual(1);
    expect(starts.befriend).toBeGreaterThanOrEqual(1);
    expect(starts.greet).toBeLessThan(starts.compliment + starts.gift + starts.befriend + 30);
  });

  it('distress is visible, varied, and spoken: matching states show for much of the low-need time', () => {
    const { rt, tick } = runtime();
    const VIS = {
      energy: /^(thinking about a nap|resting|sleeping|sitting)/,
      social: /^(sulking|sitting alone|watching the crowd)/,
      fun: /^(wandering around looking for fun|wandering over to|watching the fountain, bored|playing alone|thinking about something fun|sulking)/,
    };
    let low = 0, visible = 0;
    const phrases = new Map<string, number>();
    const seen = new Set<string>();
    let spoken = 0;
    for (let i = 0; i < 1680; i++) {
      tick(1);
      const snap = rt.getSnapshot();
      for (const e of snap.eventHistory) {
        if (e.source !== 'simulation' || seen.has(e.id)) continue;
        seen.add(e.id);
        if (['tired', 'lonely', 'bored'].includes(String(e.payload?.reaction))) { spoken++; expect(e.kind).toBe('chat'); expect(e.text!.length).toBeGreaterThan(3); }
      }
      if (i % 2) continue;
      for (const r of snap.residents) {
        const owlNight = r.personality.includes('night-owl') && (snap.simulationTime + 480) % 1440 >= 1260;
        const k = r.needs.energy < 25 && !owlNight ? 'energy' : r.needs.social < 25 && (r.needs.social <= r.needs.fun || r.needs.fun >= 25) ? 'social' : r.needs.fun < 25 ? 'fun' : null;
        if (!k) continue;
        low++;
        if (VIS[k].test(r.activity)) {
          visible++;
          const key = r.activity.replace(/ (at|on|near|by|in|to) .*$/, '');
          phrases.set(key, (phrases.get(key) ?? 0) + 1);
        }
      }
    }
    expect(low).toBeGreaterThan(100);
    expect(visible / low).toBeGreaterThan(0.42);
    const top = Math.max(...phrases.values());
    expect(top / visible).toBeLessThan(0.35); // no single distress phrase dominates
    expect(phrases.size).toBeGreaterThanOrEqual(6);
    expect(spoken).toBeGreaterThanOrEqual(5); // tired / lonely / bored lines reach the event history
  });

  it('when exhausted, rest beats fun-seeking even if bored too (non night-owl, daytime)', () => {
    const base = runtime().rt.getSnapshot();
    const nova = { ...base.residents.find(r => r.id === 'seed:nova')!, needs: { energy: 8, social: 70, fun: 6 }, activity: 'thinking' };
    const { rt, tick } = runtime({ initialSnapshot: { ...base, residents: [nova, base.residents.find(r => r.id === 'seed:rex')!], relationships: [], eventHistory: [] } });
    const acts: string[] = [];
    for (let i = 0; i < 60; i++) {
      tick(1);
      const r = rt.getSnapshot().residents.find(x => x.id === 'seed:nova')!;
      if (r.needs.energy < 25) acts.push(r.activity);
    }
    expect(acts.length).toBeGreaterThan(10);
    expect(acts.some(a => /^(thinking about a nap|resting|sitting|sleeping)/.test(a))).toBe(true);
    expect(acts.some(a => /(looking for fun|fountain, bored|playing alone|something fun)/.test(a))).toBe(false);
  });

  it('friction: incompatible residents occasionally bicker (rate-limited) and later make up', () => {
    const { rt, tick } = runtime();
    const seen = new Set<string>();
    const bickers: Array<{ a: string; b: string; t: number }> = [];
    let apologies = 0;
    const apologyLog = new Map<string, Array<{ t: number; text: string }>>();
    for (let i = 0; i < 1680; i++) {
      tick(1);
      const s = rt.getSnapshot();
      for (const e of s.eventHistory) {
        if (e.source !== 'simulation' || seen.has(e.id)) continue;
        seen.add(e.id);
        if (e.payload?.reaction === 'bicker') {
          expect(e.kind).toBe('social');
          expect(e.payload?.sentiment).toBe('negative');
          bickers.push({ a: e.actorId, b: e.targetId!, t: s.simulationTime });
        }
        if (e.payload?.reaction === 'apology') {
          apologies++;
          const k = [e.actorId, e.targetId!].sort().join('|');
          apologyLog.set(k, [...(apologyLog.get(k) ?? []), { t: s.simulationTime, text: e.text! }]);
        }
      }
    }
    expect(bickers.length).toBeGreaterThanOrEqual(1);
    expect(bickers.length).toBeLessThanOrEqual(9); // ≈ one per 2 game hours over 14 h
    for (let i = 1; i < bickers.length; i++) expect(bickers[i]!.t - bickers[i - 1]!.t).toBeGreaterThan(100);
    expect(apologies).toBeGreaterThanOrEqual(1);
    for (const log of apologyLog.values()) {
      expect(new Set(log.map(l => l.text)).size).toBe(log.length); // never the same apology twice within a pair
      for (let i = 1; i < log.length; i++) expect(log[i]!.t - log[i - 1]!.t).toBeGreaterThan(170); // ≥ ~3 game hours between attempts
    }
    const mems = rt.getSnapshot().relationships.flatMap(r => r.memories);
    expect(mems.some(m => /(bickered|snapped at|argued over|told .+ off|had a spat|complained to)/.test(m))).toBe(true);
    expect(mems.some(m => /(apologized|made up|called a truce|said sorry|peace offering|patched things up)/.test(m))).toBe(true);
    const pairs = new Map<string, number>();
    for (const b of bickers) { const k = [b.a, b.b].sort().join('|'); pairs.set(k, (pairs.get(k) ?? 0) + 1); }
    expect(Math.max(...pairs.values())).toBeLessThanOrEqual(3); // never spirals into constant fights
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
    expect(mem).toMatch(/^Day 1 \d\d:\d\d · Nova .*PixelCat.* — .+\.$/);
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
    tick(20);
    let visitors = rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:raid-1:'));
    expect(visitors.length).toBe(12);
    expect(new Set(visitors.map(v => v.displayName)).size).toBe(12);
    expect(visitors.map(v => v.displayName)).toContain("CozyStreamer's #1 fan");
    const celebrate = rt.getSnapshot().eventHistory.find(e => e.source === 'simulation' && e.payload?.reaction === 'raid')!;
    expect(celebrate.payload).toMatchObject({ action: 'celebrate', visitors: 30, amount: 30, channel: 'CozyStreamer' });
    for (const v of visitors) {
      expect(v.displayName).not.toMatch(/Raider \d+$/);
      expect(v.displayName.length).toBeLessThanOrEqual(40);
      expect(Math.hypot(v.location.x - SPAWN_POINT.x, v.location.z - SPAWN_POINT.z)).toBeLessThan(9);
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
    rt.dispatch(ev('custom', 'seed:rex', 'Rex', { payload: { action: 'update-avatar', appearance: { ...rt.getSnapshot().residents[3]!.appearance, hairStyle: 'afro' } } }, at()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'seed:rex')!.appearance.hairStyle).toBe('afro');
    tick(60);
  });

  // Round 9: Mochi (café seat) and Bram (Pond Bench) are ~23 m apart (~24.5 m once both stand up) — more ground than one
  // runner covers inside the approach cap's 7.5 s planning window — so Bram now runs toward Mochi and they meet halfway
  // ('waving at Mochi' at dispatch encoded the old giver-runs-the-whole-way behaviour), and the hand-over must land
  // inside the 9 s cap at ≤ 2 m (was: whenever the giver arrived, < 2.5 m).
  it('gift: a far pair runs toward each other and meets halfway; memory + friendship only land on the hand-over', () => {
    const { rt, c, tick } = runtime();
    const rel = () => rt.getSnapshot().relationships.find(r => r.residentA === 'seed:bram' && r.residentB === 'seed:mochi')!;
    const before = rel();
    const pos = (id: string) => rt.getSnapshot().residents.find(r => r.id === id)!.location;
    const m0 = pos('seed:mochi'), b0 = pos('seed:bram');
    const sep0 = Math.hypot(m0.x - b0.x, m0.z - b0.z);
    expect(sep0).toBeGreaterThan(20);
    rt.dispatch(ev('gift', 'seed:mochi', 'Mochi', { targetId: 'seed:bram', payload: { item: 'rose' } }, c.now()));
    let snap = rt.getSnapshot();
    expect(snap.residents.find(r => r.id === 'seed:mochi')!.activity).toBe('running to Bram');
    expect(snap.residents.find(r => r.id === 'seed:bram')!.activity).toBe('running to Mochi');
    expect(rel().friendship).toBe(before.friendship);
    expect(rel().memories).toEqual(before.memories);
    let arrivedAt = -1;
    for (let i = 0; i < 80 && arrivedAt < 0; i++) {
      tick(1);
      snap = rt.getSnapshot();
      if (rel().memories.length !== before.memories.length) arrivedAt = i + 1;
      else expect(snap.residents.find(r => r.id === 'seed:mochi')!.activity).toMatch(/^(running to Bram|waving at Bram)$/);
    }
    expect(arrivedAt).toBeGreaterThan(3);
    expect(arrivedAt * 0.5).toBeLessThanOrEqual(9.5); // timely payoff for the stream
    const mochi = snap.residents.find(r => r.id === 'seed:mochi')!, bram = snap.residents.find(r => r.id === 'seed:bram')!;
    expect(Math.hypot(mochi.location.x - bram.location.x, mochi.location.z - bram.location.z)).toBeLessThan(2);
    // Met roughly halfway: both covered a good share of the distance.
    expect(Math.hypot(mochi.location.x - m0.x, mochi.location.z - m0.z)).toBeGreaterThan(sep0 * 0.3);
    expect(Math.hypot(bram.location.x - b0.x, bram.location.z - b0.z)).toBeGreaterThan(sep0 * 0.3);
    expect(rel().friendship - before.friendship).toBeGreaterThanOrEqual(8 * 0.5);
    expect(rel().memories[rel().memories.length - 1]).toMatch(/Mochi .*(Bram.*a rose|a rose.*Bram)/);
    expect(bram.activity).toBe('thanking Mochi');
    expect(snap.eventHistory.some(e => e.source === 'simulation' && e.actorId === 'seed:bram' && e.payload?.reaction === 'thanks')).toBe(true);
  });

  it('raid visitors arrive on an arc around the portal, staggered, then walk to the plaza in small groups', () => {
    const { rt, c, tick } = runtime();
    rt.dispatch(ev('raid', 'tw:cozy', 'CozyStreamer', { id: 'raid-arc', payload: { amount: 48, channel: 'CozyStreamer' } }, c.now()));
    const count = () => rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:raid-arc:')).length;
    expect(count()).toBe(0);
    tick(1);
    expect(count()).toBeGreaterThanOrEqual(1);
    expect(count()).toBeLessThan(4);
    const first = new Map<string, { x: number; z: number }>();
    for (let i = 0; i < 24; i++) {
      tick(1);
      for (const r of rt.getSnapshot().residents) if (r.id.startsWith('raid:raid-arc:') && !first.has(r.id)) first.set(r.id, { x: r.location.x, z: r.location.z });
    }
    expect(count()).toBe(15);
    const pts = [...first.values()];
    expect(pts.length).toBe(15);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i]!.z).toBeGreaterThan(-24);
      const d = Math.hypot(pts[i]!.x, pts[i]!.z + 24);
      expect(d).toBeGreaterThan(2);
      expect(d).toBeLessThan(6.5);
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(0.6);
    }
    tick(60);
    const later = rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:raid-arc:'));
    const inPlaza = later.filter(v => Math.hypot(v.location.x, v.location.z) < 8);
    expect(inPlaza.length).toBeGreaterThanOrEqual(12);
    // Groups of up to 4 at distinct spots: the crowd spreads around the plaza.
    const spots = new Set(inPlaza.map(v => `${Math.round(Math.atan2(v.location.z, v.location.x) * 2)}`));
    expect(spots.size).toBeGreaterThanOrEqual(3);
    for (const v of inPlaza) expect(inPlaza.some(o => o !== v && Math.hypot(o.location.x - v.location.x, o.location.z - v.location.z) < 2.6)).toBe(true);
  });

  it('raid size scales the visitor crowd, respects the cap without evicting its own visitors, and visitors leave in waves', () => {
    expect([0, 5, 40, 100, 5000].map(raidVisitorCount)).toEqual([3, 5, 14, 16, 16]);
    const { rt, c, tick } = runtime();
    for (let i = 0; i < 32; i++) { c.advance(10); rt.dispatch(ev('join', `tw:fan${i}`, `Fan ${i}`, {}, c.now())); }
    expect(rt.getSnapshot().residents.length).toBe(45);
    rt.dispatch(ev('raid', 'tw:big', 'BigStreamer', { id: 'big-1', payload: { amount: 100, channel: 'BigStreamer' } }, c.now()));
    tick(30);
    let s = rt.getSnapshot();
    expect(s.residents.length).toBe(50);
    expect(s.residents.filter(r => r.id.startsWith('raid:big-1:')).length).toBe(5);
    // A second raid replaces the first raid's visitors (oldest/departing first), never its own.
    rt.dispatch(ev('raid', 'tw:big2', 'OtherStreamer', { id: 'big-2', payload: { amount: 40, channel: 'OtherStreamer' } }, c.now()));
    tick(30);
    s = rt.getSnapshot();
    expect(s.residents.length).toBe(50);
    expect(s.residents.filter(r => r.id.startsWith('raid:big-2:')).length).toBe(5);
    expect(s.residents.filter(r => r.id.startsWith('raid:big-1:')).length).toBe(0);
    // Waves: visitors leave group by group.
    const removed: number[] = [];
    let prev = s.residents.filter(r => r.id.startsWith('raid:')).length;
    for (let i = 0; i < 700 && prev > 0; i++) {
      tick(1);
      const now = rt.getSnapshot();
      const cnt = now.residents.filter(r => r.id.startsWith('raid:')).length;
      if (cnt < prev) { removed.push(now.simulationTime); prev = cnt; }
    }
    expect(prev).toBe(0);
    expect(removed.length).toBeGreaterThanOrEqual(2);
  });

  it('evenings bring a few residents genuinely tired (night owls excepted) — naps, rest and sleep show naturally', () => {
    const base = runtime().rt.getSnapshot();
    const { rt, tick } = runtime({ initialSnapshot: { ...base, simulationTime: 720, eventHistory: [] } }); // 20:00
    const tired = new Set<string>();
    const states = new Set<string>();
    for (let i = 0; i < 720; i++) { // until 02:00
      tick(1);
      if (i % 4) continue;
      for (const r of rt.getSnapshot().residents) {
        if (!r.personality.includes('night-owl') && (r.needs.energy < 25 || r.activity.startsWith('sleeping'))) tired.add(r.id);
        const m = /^(thinking about a nap|resting|sleeping)/.exec(r.activity);
        if (m) states.add(m[1]!);
      }
    }
    expect(tired.size).toBeGreaterThanOrEqual(3);
    expect(states.has('sleeping')).toBe(true);
    expect(states.has('thinking about a nap') || states.has('resting')).toBe(true);
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

describe('simulation: night routine', () => {
  const hourOf = (simTime: number) => (simTime / 60 + 8) % 24;
  const asleep = (r: { activity: string }) => r.activity.startsWith('sleeping');
  const owl = (r: { personality: string[] }) => r.personality.includes('night-owl');

  it('over 2 game days most locals sleep 23:00–05:00, a small calm night shift stays up, and mornings wake gradually', () => {
    const { rt, tick } = runtime();
    let nightN = 0, nightAsleep = 0, minAwake = Infinity, maxOthersUp = 0, walkedThenSlept = 0;
    const lowDance: string[] = [], deepDance: string[] = [], noisyPlay: string[] = [], tiredOut: string[] = [];
    const awakeAt = new Map<number, number>();
    const prev = new Map<string, string>();
    for (let i = 1; i <= 2 * 2880; i++) { // 2 game days from 08:00, no viewer events
      tick(1);
      if (i % 4) continue;
      const s = rt.getSnapshot();
      const h = hourOf(s.simulationTime);
      const locals = s.residents.filter(r => !r.id.startsWith('raid:'));
      for (const r of locals) {
        const p = prev.get(r.id);
        if (p?.startsWith('walking home to ') && r.activity === `sleeping at ${p.slice('walking home to '.length)}`) walkedThenSlept++;
        prev.set(r.id, r.activity);
      }
      if ([1320, 1380, 1470, 1560].includes(s.simulationTime)) awakeAt.set(s.simulationTime, locals.filter(r => !asleep(r)).length / locals.length);
      if (!(h >= 23 || h < 5)) continue;
      const awake = locals.filter(r => !asleep(r));
      nightN += locals.length;
      nightAsleep += locals.length - awake.length;
      minAwake = Math.min(minAwake, awake.length);
      maxOthersUp = Math.max(maxOthersUp, awake.filter(r => !owl(r) && !r.activity.startsWith('walking home')).length);
      for (const r of awake) {
        const tag = `${h.toFixed(2)} ${r.displayName} e${r.needs.energy} ${r.activity}`;
        if (r.activity.startsWith('dancing') && r.needs.energy < 40) lowDance.push(tag);
        // 00:00–05:00: only rested night owls dance on their own; nobody plays frisbee or swings.
        if (h < 5 && r.activity.startsWith('dancing') && !(owl(r) && r.needs.energy >= 48)) deepDance.push(tag);
        if (h < 5 && /^playing .*(Playground|Willow Park)/.test(r.activity)) noisyPlay.push(tag);
        // Tired neighbours (energy < 40) head home instead of chatting or dancing.
        if (!owl(r) && r.needs.energy < 40 && /^(chatting|dancing|playing)/.test(r.activity)) tiredOut.push(tag);
      }
    }
    expect(nightAsleep / nightN).toBeGreaterThanOrEqual(0.55); // (a) the majority sleeps
    expect(lowDance).toEqual([]); // (b) no low-energy dancing in the quiet hours
    expect(deepDance).toEqual([]);
    expect(noisyPlay).toEqual([]);
    expect(tiredOut).toEqual([]);
    expect(minAwake).toBeGreaterThanOrEqual(2); // never deserted: night owls + a small shift
    expect(maxOthersUp).toBeLessThanOrEqual(3);
    expect(walkedThenSlept).toBeGreaterThanOrEqual(13); // "walking home to …" then "sleeping at …"
    // (c) mornings: staggered wake-ups fill the town, ≥ 70 % awake by 10:00.
    const [a6, a7, a830, a10] = [1320, 1380, 1470, 1560].map(t => awakeAt.get(t)!);
    expect(a6).toBeLessThan(0.5);
    expect(a7).toBeGreaterThan(a6!);
    expect(a830).toBeGreaterThan(a7!);
    expect(a10).toBeGreaterThanOrEqual(0.7);
  });

  it('bedtime and mornings are spoken now and then (goodnight / can’t sleep / good morning), rate-limited', () => {
    const { rt, tick } = runtime();
    const seen = new Map<string, { t: number; text: string }>();
    for (let i = 0; i < 2 * 1500; i++) { // 08:00 → ~09:00 next day
      tick(1);
      for (const e of rt.getSnapshot().eventHistory) {
        const r = String(e.payload?.reaction);
        if (e.source === 'simulation' && ['goodnight', 'restless', 'good-morning'].includes(r) && !seen.has(e.id)) seen.set(e.id, { t: rt.getSnapshot().simulationTime, text: `${r}|${e.kind}|${e.text}` });
      }
    }
    const kinds = new Set([...seen.values()].map(v => v.text.split('|')[0]));
    expect(kinds.has('goodnight')).toBe(true);
    expect(kinds.has('good-morning')).toBe(true);
    for (const v of seen.values()) { expect(v.text.split('|')[1]).toBe('chat'); expect(v.text.split('|')[2]!.length).toBeGreaterThan(5); }
    expect(seen.size).toBeLessThan(40);
  });

  it('viewer events still work at 2 AM: a join walks out of the portal and is greeted by someone awake; greeting a sleeper leaves an "asleep" memory', () => {
    const { rt, c, tick } = runtime();
    tick(2 * 1080); // → 02:00
    const before = rt.getSnapshot();
    expect(hourOf(before.simulationTime)).toBeCloseTo(2, 3);
    rt.dispatch(ev('join', 'tw:moth', 'Moth', {}, c.now()));
    let me = rt.getSnapshot().residents.find(r => r.id === 'tw:moth')!;
    expect(me.activity).toBe('arriving through the portal');
    expect(Math.hypot(me.location.x - SPAWN_POINT.x, me.location.z - SPAWN_POINT.z)).toBeLessThan(2.5);
    let hello: WorldEvent | undefined, welcome: WorldEvent | undefined;
    for (let i = 0; i < 160 && !welcome; i++) {
      tick(1);
      const s = rt.getSnapshot();
      hello ??= s.eventHistory.find(e => e.source === 'simulation' && e.actorId === 'tw:moth' && e.payload?.reaction === 'hello');
      if (hello) welcome = s.eventHistory.find(e => e.source === 'simulation' && e.actorId === hello!.targetId && e.targetId === 'tw:moth' && e.payload?.action === 'greet');
      if (hello && !welcome) expect(asleep(s.residents.find(r => r.id === hello!.targetId)!)).toBe(false);
    }
    expect(hello).toBeTruthy();
    expect(welcome).toBeTruthy();
    me = rt.getSnapshot().residents.find(r => r.id === 'tw:moth')!;
    expect(asleep(me)).toBe(false); // a fresh arrival looks around before bed
    // A greeting to a sleeper: no reply, an "asleep" memory, and they keep sleeping.
    const sleeper = rt.getSnapshot().residents.find(r => r.id.startsWith('seed:') && asleep(r))!;
    expect(sleeper).toBeTruthy();
    c.advance(2000);
    rt.dispatch(ev('social', 'tw:moth', 'Moth', { targetId: sleeper.id, payload: { action: 'greet' } }, c.now()));
    // Round 9: the sleeper's porch is > 5 m away, so Moth first walks / jogs over (it used to "greet" from across town
    // and write the memory at once); the memory lands on arrival, within the 9 s approach cap.
    const relOf = () => rt.getSnapshot().relationships.find(r => [r.residentA, r.residentB].sort().join('|') === [sleeper.id, 'tw:moth'].sort().join('|'));
    const asleepMemory = () => !!relOf()?.memories.some(m => /(tiptoed past a sleeping|tried to wake|fast asleep)/.test(m));
    expect(rt.getSnapshot().residents.find(r => r.id === 'tw:moth')!.activity).toMatch(new RegExp(`^(walking|running) to ${sleeper.displayName}$`));
    let waited = 0;
    while (!asleepMemory() && waited < 20) { tick(1); waited++; }
    const s2 = rt.getSnapshot();
    expect(asleepMemory()).toBe(true);
    expect(waited * 0.5).toBeLessThanOrEqual(9.5);
    expect(asleep(s2.residents.find(r => r.id === sleeper.id)!)).toBe(true);
    expect(s2.eventHistory.some(e => e.source === 'simulation' && e.actorId === sleeper.id && e.targetId === 'tw:moth')).toBe(false);
    // A gift wakes them up smiling; afterwards they go back to bed.
    c.advance(3000);
    rt.dispatch(ev('gift', 'tw:moth', 'Moth', { targetId: sleeper.id, payload: { item: 'moon cake' } }, c.now()));
    let thanked = false, backToBed = false;
    for (let i = 0; i < 240 && !backToBed; i++) {
      tick(1);
      const s = rt.getSnapshot();
      // (round 9) only Moth's thanks counts: the hand-over now happens on arrival, and an older 'thanks' by the same
      // resident (an autonomous gift earlier in the day) used to satisfy this check before the gift even landed.
      thanked ||= s.eventHistory.some(e => e.source === 'simulation' && e.actorId === sleeper.id && e.targetId === 'tw:moth' && e.payload?.reaction === 'thanks');
      const r = s.residents.find(x => x.id === sleeper.id)!;
      if (thanked && /^(walking home to|sleeping at)/.test(r.activity)) backToBed = true;
    }
    expect(thanked).toBe(true);
    expect(rt.getSnapshot().relationships.some(r => r.memories.some(m => /woke up smiling/.test(m)))).toBe(true);
    expect(backToBed).toBe(true);
  });

  it('a viewer dance at night still makes residents dance; raid visitors at night never sleep and still leave in waves', () => {
    const { rt, c, tick } = runtime();
    tick(2 * 1140); // → 03:00
    rt.dispatch(ev('dance', 'tw:dj', 'DJ', {}, c.now()));
    expect(rt.getSnapshot().residents.find(r => r.id === 'tw:dj')!.activity).toMatch(/^(dancing|arriving)/);
    c.advance(2000);
    rt.dispatch(ev('raid', 'tw:owlcast', 'OwlCast', { id: 'raid-night', payload: { amount: 30, channel: 'OwlCast' } }, c.now()));
    let maxVisitors = 0;
    for (let i = 0; i < 2 * 320; i++) {
      tick(1);
      const vs = rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:raid-night:'));
      maxVisitors = Math.max(maxVisitors, vs.length);
      for (const v of vs) expect(v.activity.startsWith('sleeping') || v.activity.startsWith('walking home')).toBe(false);
    }
    expect(maxVisitors).toBe(12);
    expect(rt.getSnapshot().residents.filter(r => r.id.startsWith('raid:')).length).toBe(0);
  });

  it('a snapshot restored at night keeps sleepers asleep in place', () => {
    const { rt, tick } = runtime();
    tick(2 * 1100); // → 02:20
    const snap = JSON.parse(JSON.stringify(rt.getSnapshot())) as WorldSnapshot;
    const sleepers = snap.residents.filter(asleep);
    expect(sleepers.length).toBeGreaterThanOrEqual(6);
    const { rt: rt2, tick: tick2 } = runtime({ initialSnapshot: snap });
    tick2(2 * 60);
    const after = rt2.getSnapshot().residents;
    const still = sleepers.filter(s => { const r = after.find(x => x.id === s.id)!; return asleep(r) && Math.hypot(r.location.x - s.location.x, r.location.z - s.location.z) < 0.5; });
    expect(still.length).toBeGreaterThanOrEqual(sleepers.length - 1);
  });
});

describe('simulation: targeted viewer events meet in person, grounded lines, thin night watch (round 9)', () => {
  const hourOf = (simTime: number) => (simTime / 60 + 8) % 24;
  const d2 = (a: { location: { x: number; z: number } }, b: { location: { x: number; z: number } }) => Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z);
  /** Bram and Nova alone on an open east–west line (z = -12) `sep` metres apart. */
  function pair(sep: number) {
    const { rt: base } = runtime();
    const snap = JSON.parse(JSON.stringify(base.getSnapshot())) as WorldSnapshot;
    snap.residents = snap.residents.filter(r => r.id === 'seed:bram' || r.id === 'seed:nova');
    for (const r of snap.residents) r.activity = 'admiring Willow Park';
    snap.residents.find(r => r.id === 'seed:bram')!.location = { x: -31, y: 0, z: -12, zone: 'park' };
    snap.residents.find(r => r.id === 'seed:nova')!.location = { x: -31 + sep, y: 0, z: -12, zone: 'park' };
    snap.eventHistory = [];
    const r = runtime({ initialSnapshot: snap });
    const get = (id: string) => r.rt.getSnapshot().residents.find(x => x.id === id)!;
    const rel = () => r.rt.getSnapshot().relationships.find(x => x.residentA === 'seed:bram' && x.residentB === 'seed:nova');
    return { ...r, get, rel };
  }
  /** Dispatch, then tick until the target's payoff event; returns seconds, the pair's distance then, and the start positions. */
  function untilPayoff(p: ReturnType<typeof pair>, e: WorldEvent, isPayoff: (x: WorldEvent) => boolean) {
    const a0 = p.get('seed:bram').location, b0 = p.get('seed:nova').location;
    p.rt.dispatch(e);
    const start = { actor: p.get('seed:bram').activity, target: p.get('seed:nova').activity, early: p.rt.getSnapshot().eventHistory.some(isPayoff) };
    let secs = 0;
    while (!p.rt.getSnapshot().eventHistory.some(isPayoff) && secs < 30) { p.tick(1); secs += 0.5; }
    const A = p.get('seed:bram'), B = p.get('seed:nova');
    return { secs, d: d2(A, B), start, movedA: Math.hypot(A.location.x - a0.x, A.location.z - a0.z), movedB: Math.hypot(B.location.x - b0.x, B.location.z - b0.z) };
  }
  const replyTo = (action: string) => (x: WorldEvent) => x.source === 'simulation' && x.actorId === 'seed:nova' && x.targetId === 'seed:bram' && x.payload?.action === action;
  const thanks = (x: WorldEvent) => x.source === 'simulation' && x.actorId === 'seed:nova' && x.targetId === 'seed:bram' && x.payload?.reaction === 'thanks';

  it('greet: the actor walks (≤ 12 m) or jogs (> 12 m) over, greets within ~2 m, and memory + friendship land on arrival — within the cap', () => {
    for (const [sep, travel] of [[8, /^(walking|running) to Nova$/], [18, /^running to Nova$/]] as const) {
      const p = pair(sep);
      const f0 = p.rel()?.friendship;
      const r = untilPayoff(p, ev('social', 'seed:bram', 'Bram', { targetId: 'seed:nova', payload: { action: 'greet' } }, p.c.now()), replyTo('greet'));
      expect(r.start.early).toBe(false); // nothing is said across the distance
      expect(r.start.actor).toMatch(travel);
      expect(r.start.target).toBe('waving at Bram'); // the target stops and turns to the actor
      expect(r.secs).toBeGreaterThan(1);
      expect(r.secs).toBeLessThanOrEqual(9.5);
      expect(r.d).toBeLessThanOrEqual(2);
      expect(p.rel()!.memories.some(m => /Bram .*Nova/.test(m))).toBe(true);
      if (f0 !== undefined) expect(p.rel()!.friendship).not.toBe(f0);
    }
    // Within ~5 m the greeting still happens on the spot.
    const near = pair(4);
    const r = untilPayoff(near, ev('social', 'seed:bram', 'Bram', { targetId: 'seed:nova', payload: { action: 'greet' } }, near.c.now()), replyTo('greet'));
    expect(r.start.early).toBe(true);
    expect(r.secs).toBe(0);
  });

  it('gift: handed over within ~2 m on arrival (thanks + friendship + memory), within the cap', () => {
    for (const sep of [6, 14, 22]) {
      const p = pair(sep);
      const r = untilPayoff(p, ev('gift', 'seed:bram', 'Bram', { targetId: 'seed:nova', payload: { item: 'tulip' } }, p.c.now()), thanks);
      expect(r.start.early).toBe(false);
      expect(r.start.actor).toMatch(/^(walking|running) to Nova$/);
      expect(r.secs).toBeLessThanOrEqual(9.5);
      expect(r.d).toBeLessThanOrEqual(2);
      const rel = p.rel()!;
      expect(rel.friendship).toBeGreaterThanOrEqual(48);
      expect(rel.memories[rel.memories.length - 1]).toMatch(/Bram .*(Nova.*a tulip|a tulip.*Nova)/);
      expect(p.get('seed:nova').activity).toBe('thanking Bram');
    }
  });

  it('very far pairs (> 25 m) run toward each other and meet halfway; beyond reach the cap still delivers the payoff', () => {
    const p = pair(40);
    const r = untilPayoff(p, ev('social', 'seed:bram', 'Bram', { targetId: 'seed:nova', payload: { action: 'compliment' } }, p.c.now()), replyTo('compliment'));
    expect(r.start.actor).toBe('running to Nova');
    expect(r.start.target).toBe('running to Bram');
    expect(r.secs).toBeLessThanOrEqual(9.5);
    expect(r.d).toBeLessThanOrEqual(2);
    expect(r.movedA).toBeGreaterThan(40 * 0.35);
    expect(r.movedB).toBeGreaterThan(40 * 0.35);
    expect(p.rel()!.memories.length).toBeGreaterThan(0);
    // 62 m apart: no way to meet in 9 s — the compliment lands at the cap, at the reached distance, with its memory.
    const far = pair(62);
    const r2 = untilPayoff(far, ev('social', 'seed:bram', 'Bram', { targetId: 'seed:nova', payload: { action: 'befriend' } }, far.c.now()), replyTo('befriend'));
    expect(r2.secs).toBeGreaterThanOrEqual(8.5);
    expect(r2.secs).toBeLessThanOrEqual(9.5);
    expect(r2.d).toBeLessThan(62 - 30); // they still closed most of the gap
    expect(far.rel()!.memories.length).toBeGreaterThan(0);
  });

  it('wave stays a distance wave: the actor stays put and the target notices and answers', () => {
    const p = pair(20);
    const a0 = p.get('seed:bram').location;
    p.rt.dispatch(ev('wave', 'seed:bram', 'Bram', { targetId: 'seed:nova' }, p.c.now()));
    expect(p.get('seed:bram').activity).toBe('waving at Nova');
    p.tick(3);
    const answer = p.rt.getSnapshot().eventHistory.find(x => x.source === 'simulation' && x.actorId === 'seed:nova' && x.targetId === 'seed:bram');
    expect(answer).toBeTruthy();
    if (answer!.kind === 'wave') expect(p.get('seed:nova').activity).toBe('waving at Bram');
    const a1 = p.get('seed:bram').location;
    expect(Math.hypot(a1.x - a0.x, a1.z - a0.z)).toBeLessThan(0.5);
  });

  it('over 24 game hours, lines about who is dancing / just arrived are true when spoken, and "watching X dance" is never stale', () => {
    const { rt, c, tick } = runtime({ worldId: 'grounded-world' });
    const seen = new Set(rt.getSnapshot().eventHistory.map(e => e.id));
    const bad: string[] = [];
    let claims = 0;
    for (let i = 0; i < 2 * 1440; i++) {
      if (i === 200) rt.dispatch(ev('join', 'tw:sprout', 'Sprout', {}, c.now())); // a newcomer to talk about
      tick(1);
      const s = rt.getSnapshot();
      const byName = new Map(s.residents.map(r => [r.displayName, r]));
      const onStage = (r: { location: { x: number; z: number } }) => Math.hypot(r.location.x - 7.5, r.location.z - 7) <= 4.2;
      for (const e of s.eventHistory) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const text = e.text ?? '';
        let m = /^(.+) is tearing up the stage!$/.exec(text) ?? /^Look at (.+) go on the Dance Stage!$/.exec(text);
        if (m) { claims++; const d = byName.get(m[1]!); if (!d || !d.activity.startsWith('dancing') || !onStage(d)) bad.push(`${hourOf(s.simulationTime).toFixed(2)} ${text} | ${d?.activity}`); }
        m = /^Have you seen (.+) dance\? Wow\.$/.exec(text) ?? /^(.+) is dancing again! Love the energy\.$/.exec(text);
        if (m) { claims++; const d = byName.get(m[1]!); if (!d || !d.activity.startsWith('dancing')) bad.push(`${hourOf(s.simulationTime).toFixed(2)} ${text} | ${d?.activity}`); }
        m = /^Have you met (.+) yet\?/.exec(text) ?? /^(.+) just arrived through the portal!$/.exec(text) ?? /^There’s a new face in town: (.+)!$/.exec(text) ?? /^Did you see (.+) come through the portal\?$/.exec(text);
        if (m) { claims++; if (!byName.has(m[1]!)) bad.push(`${text} | gone`); }
      }
      if (i % 2) continue;
      for (const r of s.residents) {
        const w = /^watching (.+) dance$/.exec(r.activity);
        if (!w) continue;
        claims++;
        const d = byName.get(w[1]!);
        if (!d || !d.activity.startsWith('dancing')) bad.push(`${hourOf(s.simulationTime).toFixed(2)} ${r.displayName} ${r.activity} | ${d?.activity}`);
      }
    }
    expect(bad).toEqual([]);
    expect(claims).toBeGreaterThan(0);
  });

  it('01:00–05:00: 2–3 locals awake in total (night owls included), all at calm spots', () => {
    const { rt, tick } = runtime();
    const byHour = new Map<number, { min: number; max: number }>();
    const loud: string[] = [];
    for (let i = 1; i <= 2 * 2880; i++) {
      tick(1);
      if (i % 2) continue;
      const s = rt.getSnapshot();
      const h = hourOf(s.simulationTime);
      if (!(h >= 1 && h < 5)) continue;
      const awake = s.residents.filter(r => !r.id.startsWith('raid:') && !r.activity.startsWith('sleeping'));
      const b = byHour.get(Math.floor(h)) ?? { min: Infinity, max: 0 };
      byHour.set(Math.floor(h), { min: Math.min(b.min, awake.length), max: Math.max(b.max, awake.length) });
      for (const r of awake) if (/^(dancing|playing|running)/.test(r.activity)) loud.push(`${h.toFixed(2)} ${r.displayName} ${r.activity}`);
    }
    expect([...byHour.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const { min, max } of byHour.values()) { expect(max).toBeLessThanOrEqual(3); expect(min).toBeGreaterThanOrEqual(2); }
    expect(loud).toEqual([]);
  });
});
