/**
 * ResidentInspector — DOM overlay card for the selected resident.
 * Re-renders at most ~2 Hz (throttled store.onSnapshot). Viewer actions are
 * dispatched as contract WorldEvents (source 'viewer'; the trusted server
 * boundary re-assigns source/validates).
 */
import { useEffect, useMemo, useState } from 'react';
import type { Relationship, ResidentProfile, WorldEvent, WorldEventKind, WorldEventPayload, WorldRuntime } from '@hello-world/contracts';
import type { SceneStore } from '../core/sceneStore';
import { PERSONALITY_TRAITS } from '../avatars/catalog';
import { sanitizeBubbleText } from './ResidentsLayer';

export interface ResidentInspectorProps {
  store: SceneStore;
  runtime: WorldRuntime;
  selectedResidentId?: string;
  viewerResidentId?: string;
  onClose?: () => void;
}

const GIFT_ITEMS = ['flowers', 'cookie', 'coffee', 'balloon', 'cupcake'];

/**
 * Mood badge from needs (+ recent social context). The most urgent low need wins:
 * < 25 → Exhausted / Lonely / Bored, < 40 → Tired / Wants company / Restless.
 * `grumpy` (recent negative social event or sulking) overrides everything.
 */
export function moodFromNeeds(n: ResidentProfile['needs'], opts: { grumpy?: boolean } = {}): { label: string; color: string } {
  if (opts.grumpy) return { label: 'Grumpy', color: '#ff6b5a' };
  const e = n.energy, s = n.social, f = n.fun;
  const lowest = Math.min(e, s, f);
  if (lowest < 25) {
    if (lowest === e) return { label: 'Exhausted', color: '#8f9bff' };
    if (lowest === s) return { label: 'Lonely', color: '#79b8ff' };
    return { label: 'Bored', color: '#e3b55a' };
  }
  if (lowest < 40) {
    if (lowest === e) return { label: 'Tired', color: '#b3bdf5' };
    if (lowest === s) return { label: 'Wants company', color: '#a9cff5' };
    return { label: 'Restless', color: '#efd08a' };
  }
  const avg = (e + s + f) / 3;
  if (avg >= 75) return { label: 'Joyful', color: '#ffd84d' };
  if (avg >= 55) return { label: 'Content', color: '#7bd389' };
  return { label: 'Okay', color: '#a7c4b5' };
}

/** True when the resident was in a negative social event (snub/bickering) recently, or is sulking. */
export function isGrumpy(r: ResidentProfile, history: readonly WorldEvent[], now = Date.now()): boolean {
  if (/^\s*sulking\b/i.test(r.activity)) return true;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]!;
    if (now - e.timestamp > 90_000) break;
    if (e.kind === 'social' && e.payload?.sentiment === 'negative' && (e.actorId === r.id || e.targetId === r.id)) return true;
  }
  return false;
}

export function friendshipLabel(v: number): string {
  if (v >= 85) return 'Best friend';
  if (v >= 62) return 'Friend';
  if (v >= 38) return 'Acquaintance';
  if (v >= 18) return 'Frosty';
  return 'Rival';
}

const TRAIT_LABEL = new Map(PERSONALITY_TRAITS.map(t => [t.id, t.label]));
const traitLabel = (t: string) => TRAIT_LABEL.get(t) ?? (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 18);

let idCounter = 0;
const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `viewer-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.dataset.helloWorld = 'inspector';
  s.textContent = `
.hw-insp{position:absolute;right:16px;bottom:16px;width:320px;max-height:calc(100% - 32px);overflow:auto;z-index:40;box-sizing:border-box;
padding:16px 16px 14px;border-radius:20px;color:#eef3ef;background:linear-gradient(160deg,rgba(28,36,42,.86),rgba(14,19,23,.86));
backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid rgba(255,255,255,.1);
box-shadow:0 18px 50px rgba(0,0,0,.4);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;animation:hw-insp-in .28s ease-out both}
@keyframes hw-insp-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.hw-insp *{box-sizing:border-box}
.hw-insp h3{margin:0;font-size:18px;font-weight:750;letter-spacing:-.01em}
.hw-insp .hw-sub{opacity:.72;font-size:12.5px;margin-top:2px}
.hw-insp .hw-x{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;border:0;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:16px;line-height:28px}
.hw-insp .hw-x:hover{background:rgba(255,255,255,.18)}
.hw-insp .hw-sec{margin-top:12px}
.hw-insp .hw-h{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;opacity:.55;margin-bottom:6px}
.hw-insp .hw-mood{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:3px 10px 3px 8px;border-radius:99px;background:rgba(255,255,255,.07);font-weight:600;font-size:12px}
.hw-insp .hw-dot{width:8px;height:8px;border-radius:50%}
.hw-insp .hw-bar{display:grid;grid-template-columns:52px 1fr 28px;align-items:center;gap:8px;margin:4px 0;font-size:12px}
.hw-insp .hw-track{height:7px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden}
.hw-insp .hw-fill{height:100%;border-radius:99px;transition:width .6s ease}
.hw-insp .hw-chips{display:flex;flex-wrap:wrap;gap:5px}
.hw-insp .hw-chip{padding:2px 9px;border-radius:99px;background:rgba(122,92,255,.2);border:1px solid rgba(160,140,255,.28);font-size:11.5px}
.hw-insp .hw-rel{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:6px 0;font-size:12.5px}
.hw-insp .hw-rel .hw-track{grid-column:1 / span 2;height:5px}
.hw-insp .hw-tag{font-size:11px;opacity:.75}
.hw-insp .hw-mem{margin:0;padding-left:16px;font-size:12px;opacity:.85}
.hw-insp .hw-mem li{margin:3px 0}
.hw-insp .hw-acts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.hw-insp button.hw-a{padding:7px 4px;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;transition:background .15s,transform .1s}
.hw-insp button.hw-a:hover:not(:disabled){background:rgba(255,255,255,.16)}
.hw-insp button.hw-a:active:not(:disabled){transform:scale(.96)}
.hw-insp button.hw-a:disabled{opacity:.45;cursor:default}
.hw-insp .hw-chat{display:flex;gap:6px;margin-top:7px}
.hw-insp .hw-chat input{flex:1;min-width:0;padding:7px 10px;border-radius:11px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:#fff;font:13px system-ui,sans-serif;outline:none}
.hw-insp .hw-chat input:focus{border-color:rgba(160,140,255,.6)}
.hw-insp .hw-empty{opacity:.55;font-size:12px}
@media (max-width:560px){.hw-insp{left:8px;right:8px;bottom:8px;width:auto;max-height:55%;border-radius:18px}}
`;
  document.head.appendChild(s);
}

const NEED_COLORS = { energy: '#ffc24d', social: '#ff7aa8', fun: '#9b7bff' } as const;

export function ResidentInspector(props: ResidentInspectorProps) {
  const { store, runtime, selectedResidentId: sel, viewerResidentId: viewer, onClose } = props;
  const [, setVersion] = useState(0);
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { ensureCss(); }, []);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { last = performance.now(); timer = undefined; setVersion(v => v + 1); };
    const unsub = store.onSnapshot(() => {
      const since = performance.now() - last;
      if (since >= 500) bump();
      else if (!timer) timer = setTimeout(bump, 500 - since);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [store]);

  const r = sel ? store.getResident(sel) : undefined;
  const snap = store.current;
  const names = useMemo(() => new Map(snap.residents.map(x => [x.id, x.displayName])), [snap]);
  if (!r) return null;

  const rels = snap.relationships.filter((x: Relationship) => x.residentA === r.id || x.residentB === r.id);
  const top = [...rels].sort((a, b) => b.friendship - a.friendship).slice(0, 3);
  const memories: string[] = [];
  for (const rel of [...rels].sort((a, b) => b.lastInteractionAt - a.lastInteractionAt)) {
    for (let i = rel.memories.length - 1; i >= 0 && memories.length < 3; i--) memories.push(rel.memories[i]!);
    if (memories.length >= 3) break;
  }
  const mood = moodFromNeeds(r.needs, { grumpy: isGrumpy(r, snap.eventHistory) });
  const isSelf = !!viewer && viewer === r.id;
  const viewerName = viewer ? store.getResident(viewer)?.displayName ?? 'You' : 'You';

  const send = (kind: WorldEventKind, opts: { payload?: WorldEventPayload; text?: string; targeted?: boolean } = {}) => {
    if (!viewer || busy) return;
    const targeted = opts.targeted ?? true;
    const ev: WorldEvent = {
      id: newId(), kind, source: 'viewer', actorId: viewer, actorDisplayName: viewerName,
      ...(targeted && !isSelf ? { targetId: r.id } : {}),
      timestamp: Date.now(),
      ...(opts.payload ? { payload: opts.payload } : {}),
      ...(opts.text ? { text: opts.text } : {}),
    };
    try { runtime.dispatch(ev); } catch { /* adapter reports errors itself */ }
    setBusy(true);
    setTimeout(() => setBusy(false), 900);
  };
  const sendChat = () => {
    const text = sanitizeBubbleText(chat);
    if (!text) return;
    send('chat', { text });
    setChat('');
  };

  return <div className="hw-insp" role="dialog" aria-label={`${r.displayName} details`}
    onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <button className="hw-x" aria-label="Close" onClick={() => onClose?.()}>×</button>
    <h3>{r.displayName}{isSelf ? ' (you)' : ''}</h3>
    <div className="hw-sub">{r.activity || 'idle'} · {r.location.zone}</div>
    <div className="hw-mood" style={{ background: `${mood.color}26`, boxShadow: `inset 0 0 0 1px ${mood.color}66` }}><span className="hw-dot" style={{ background: mood.color }} />{mood.label}</div>

    <div className="hw-sec">
      <div className="hw-h">Needs</div>
      {(['energy', 'social', 'fun'] as const).map(k => {
        const v = Math.round(Math.max(0, Math.min(100, r.needs[k] ?? 0)));
        return <div className="hw-bar" key={k}>
          <span style={{ textTransform: 'capitalize' }}>{k}</span>
          <div className="hw-track"><div className="hw-fill" style={{ width: `${v}%`, background: NEED_COLORS[k] }} /></div>
          <span style={{ textAlign: 'right', opacity: 0.7 }}>{v}</span>
        </div>;
      })}
    </div>

    {r.personality.length > 0 && <div className="hw-sec">
      <div className="hw-h">Personality</div>
      <div className="hw-chips">{r.personality.slice(0, 6).map(t => <span className="hw-chip" key={t}>{traitLabel(t)}</span>)}</div>
    </div>}

    <div className="hw-sec">
      <div className="hw-h">Relationships</div>
      {top.length === 0 ? <div className="hw-empty">No friends yet — say hi!</div> : top.map(rel => {
        const other = rel.residentA === r.id ? rel.residentB : rel.residentA;
        const f = Math.round(Math.max(0, Math.min(100, rel.friendship)));
        return <div className="hw-rel" key={other}>
          <span>{names.get(other) ?? 'Someone'}</span><span className="hw-tag">{friendshipLabel(f)}</span>
          <div className="hw-track"><div className="hw-fill" style={{ width: `${f}%`, background: f >= 38 ? 'linear-gradient(90deg,#ff7aa8,#ffb86b)' : '#8a9aa8' }} /></div>
        </div>;
      })}
    </div>

    {memories.length > 0 && <div className="hw-sec">
      <div className="hw-h">Recent memories</div>
      <ul className="hw-mem">{memories.map((mm, i) => <li key={i}>{mm}</li>)}</ul>
    </div>}

    {viewer && <div className="hw-sec">
      <div className="hw-h">{isSelf ? 'Do something' : `Interact as ${viewerName}`}</div>
      <div className="hw-acts">
        {!isSelf && <button className="hw-a" disabled={busy} onClick={() => send('wave')}>Wave</button>}
        <button className="hw-a" disabled={busy} onClick={() => send('dance', { targeted: false })}>Dance</button>
        {!isSelf && <button className="hw-a" disabled={busy} onClick={() => send('social', { payload: { action: 'greet' } })}>Greet</button>}
        {!isSelf && <button className="hw-a" disabled={busy} onClick={() => send('social', { payload: { action: 'compliment' } })}>Compliment</button>}
        {!isSelf && <button className="hw-a" disabled={busy} onClick={() => send('social', { payload: { action: 'befriend' } })}>Befriend</button>}
        {!isSelf && <button className="hw-a" disabled={busy} onClick={() => send('gift', { payload: { item: GIFT_ITEMS[Math.floor(Math.random() * GIFT_ITEMS.length)]! } })}>Gift</button>}
        {isSelf && <button className="hw-a" disabled={busy} onClick={() => send('wave', { targeted: false })}>Wave</button>}
        {isSelf && <button className="hw-a" disabled={busy} onClick={() => send('social', { payload: { action: 'celebrate' }, targeted: false })}>Celebrate</button>}
      </div>
      <div className="hw-chat">
        <input value={chat} maxLength={140} placeholder={isSelf ? 'Say something…' : `Say something to ${r.displayName}…`}
          onChange={e => setChat(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); }} />
        <button className="hw-a" style={{ padding: '7px 12px' }} disabled={busy || !chat.trim()} onClick={sendChat}>Chat</button>
      </div>
    </div>}
  </div>;
}
