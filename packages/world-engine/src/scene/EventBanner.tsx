/**
 * Always-on lower-third event toasts (DOM, inside WorldScene's container; also in the
 * transparent OBS overlay). Raids (with an animated viewer count-up), joins, gifts and
 * confetti. React state changes only when an event arrives — never per frame.
 * Max 2 stacked, ~5 s each, pointer-events: none, scoped class names + inline styles.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { WorldEvent } from '@hello-world/contracts';
import type { SceneStore } from '../core/sceneStore';

type ToastKind = 'raid' | 'join' | 'gift' | 'confetti';
interface Toast { id: string; kind: ToastKind; title: string; text: string; amount?: number; born: number; life: number }

/** Raid toasts last as long as the 9 s raid camera shot; everything else ~5 s. */
const LIFETIME_MS: Record<ToastKind, number> = { raid: 9500, join: 5200, gift: 5200, confetti: 5200 };
const ACCENT: Record<ToastKind, string> = { raid: '#c792ff', join: '#6ff3ff', gift: '#ffd166', confetti: '#ff8fab' };

const clean = (v: unknown, max = 32): string => {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const t = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function toastFor(e: WorldEvent, lastRaidAt: { t: number }, nameOf: (id: string) => string | undefined): Toast | null {
  const now = Date.now();
  const p = e.payload ?? {};
  const name = clean(e.actorDisplayName) || 'Someone';
  const simRaid = e.source === 'simulation' && p['reaction'] === 'raid';
  if ((e.kind === 'raid' && e.source !== 'simulation') || simRaid) {
    if (now - lastRaidAt.t < 15000) return null; // one banner per raid (event + its celebration)
    lastRaidAt.t = now;
    const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) ? Math.max(0, Math.round(p.amount)) : undefined;
    const channel = clean(p['channel']) || name;
    return { id: `${e.id}-raid`, kind: 'raid', title: 'RAID!', text: amount !== undefined ? `viewers from ${channel}` : `${channel} is raiding the neighborhood`, amount, born: now, life: LIFETIME_MS.raid };
  }
  if (e.source === 'simulation') return null;
  switch (e.kind) {
    case 'join': return { id: e.id, kind: 'join', title: 'Welcome', text: `to the neighborhood, ${name}!`, born: now, life: LIFETIME_MS.join };
    case 'gift': {
      const item = clean(p['item'], 24) || 'a gift';
      const to = e.targetId ? clean(nameOf(e.targetId)) : '';
      return { id: e.id, kind: 'gift', title: 'Gift', text: to ? `${name} gave ${to} ${item}` : `${name} shared ${item} with the neighborhood`, born: now, life: LIFETIME_MS.gift };
    }
    case 'confetti': return { id: e.id, kind: 'confetti', title: 'Confetti', text: `${name} made it rain confetti!`, born: now, life: LIFETIME_MS.confetti };
    default: return null;
  }
}

function Icon({ kind }: { kind: ToastKind }) {
  const c = ACCENT[kind];
  const s: CSSProperties = { width: 16, height: 16, display: 'block' };
  if (kind === 'raid' || kind === 'join') return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={c} strokeWidth="2.2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" fill={c} stroke="none" /></svg>;
  if (kind === 'gift') return <svg viewBox="0 0 24 24" style={s} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round"><rect x="4" y="10" width="16" height="10" rx="1.5" /><path d="M3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0" /></svg>;
  return <svg viewBox="0 0 24 24" style={s} fill={c}><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" /><circle cx="19" cy="18" r="1.6" /><circle cx="5" cy="17" r="1.2" /></svg>;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Never shows 0: starts at ~60 % of the amount and counts up over 0.6 s (instant with reduced motion). */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const start = Math.round(to * 0.6);
  useEffect(() => {
    if (reducedMotion()) { if (ref.current) ref.current.textContent = String(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 600);
      const eased = 1 - Math.pow(1 - k, 3);
      if (ref.current) ref.current.textContent = String(Math.round(start + (to - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, start]);
  return <span ref={ref} style={{ fontVariantNumeric: 'tabular-nums' }}>{reducedMotion() ? to : start}</span>;
}

const wrap: CSSProperties = {
  position: 'absolute', left: 0, right: 0, zIndex: 6, pointerEvents: 'none',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
};

const CSS = `
@keyframes hwEvbIn { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes hwEvbOut { to { opacity: 0; transform: translateY(-6px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .hw-evb-toast { animation: none !important; } }
`;
const anim = (life: number) => `hwEvbIn .38s cubic-bezier(.2,.9,.3,1.2) both, hwEvbOut .45s ease-in ${((life - 450) / 1000).toFixed(2)}s forwards`;

export function EventBanner({ store }: { store: SceneStore }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastRaid = useRef({ t: 0 });
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let windowStart = 0, inWindow = 0;
    const off = store.onEvent(({ event }) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; inWindow = 0; }
      // bursts: accept at most 2 toasts per second (raids always pass), drop the rest
      if (inWindow >= 2 && event.kind !== 'raid') return;
      const t = toastFor(event, lastRaid.current, id => store.getResident(id)?.displayName);
      if (!t) return;
      inWindow++;
      setToasts(prev => [...prev.filter(x => x.id !== t.id), t].slice(-2));
      const timer = setTimeout(() => { timers.delete(timer); setToasts(prev => prev.filter(x => x.id !== t.id)); }, t.life);
      timers.add(timer);
    });
    return () => { off(); for (const tm of timers) clearTimeout(tm); };
  }, [store]);
  if (!toasts.length) return null;
  // During a raid shot the arrivals fill the lower frame: move the stack to the top.
  const raidActive = toasts.some(t => t.kind === 'raid');
  return (
    <div style={{ ...wrap, ...(raidActive ? { top: '7%' } : { bottom: '9%' }) }} aria-live="polite" data-testid="world-event-banner" data-position={raidActive ? 'top' : 'bottom'}>
      <style>{CSS}</style>
      {toasts.map(t => {
        const accent = ACCENT[t.kind];
        const big = t.kind === 'raid';
        return (
          <div key={t.id} className="hw-evb-toast" style={{
            animation: anim(t.life),
            display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'min(92%, 560px)',
            padding: big ? '10px 18px 10px 12px' : '8px 16px 8px 10px', borderRadius: 999,
            background: big ? 'linear-gradient(90deg, rgba(60,24,96,.78), rgba(18,22,34,.72))' : 'rgba(16,20,28,.66)',
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: `1px solid ${accent}55`, boxShadow: `0 8px 28px rgba(0,0,0,.3), 0 0 22px ${accent}33`,
            color: '#f6f3ee', fontSize: big ? 15 : 13, lineHeight: 1.25,
          }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 26, background: `${accent}22`, border: `1px solid ${accent}66`, flex: '0 0 auto' }}>
              <Icon kind={t.kind} />
            </span>
            <span style={{ fontWeight: 800, letterSpacing: big ? 1.2 : 0.3, color: accent, textTransform: big ? 'uppercase' : 'none', flex: '0 0 auto' }}>{t.title}</span>
            <span style={{ fontWeight: 600, opacity: 0.95, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.amount !== undefined && <><b style={{ color: '#fff' }}><CountUp to={t.amount} /></b>{' '}</>}{t.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
