/** Minimal glassy HUD (DOM): world clock, weather, population, tiny legend. Updates via refs (no per-frame React state). */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Weather } from '@hello-world/contracts';
import type { SceneStore } from '../core/sceneStore';
import { worldClock } from '../world/time';

const pill: CSSProperties = {
  position: 'absolute', top: 12, right: 12, zIndex: 5, pointerEvents: 'none',
  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', color: '#f4f1ea',
};
const main: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 10px', borderRadius: 999,
  background: 'rgba(16, 20, 28, 0.58)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 6px 24px rgba(0,0,0,0.25)', fontSize: 13, fontWeight: 600, letterSpacing: 0.2,
};
const sub: CSSProperties = {
  display: 'flex', gap: 10, padding: '5px 12px', borderRadius: 999, background: 'rgba(16, 20, 28, 0.42)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, opacity: 0.92,
};
const dot = (c: string): CSSProperties => ({ display: 'inline-block', width: 7, height: 7, borderRadius: 7, background: c, marginRight: 5, boxShadow: `0 0 6px ${c}` });

const WEATHER_LABEL: Record<Weather, string> = { sunny: 'Sunny', rain: 'Rain', snow: 'Snow', sunset: 'Golden hour' };

function WeatherIcon({ weather, night }: { weather: Weather; night: boolean }) {
  const s = { width: 18, height: 18, display: 'block' } as const;
  if (weather === 'rain') return <svg viewBox="0 0 24 24" style={s} fill="none" stroke="#a9d4ff" strokeWidth="2" strokeLinecap="round"><path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 18 9a3 3 0 0 1 0 6H7z" fill="rgba(169,212,255,.18)" /><path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" /></svg>;
  if (weather === 'snow') return <svg viewBox="0 0 24 24" style={s} fill="none" stroke="#e8f3ff" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /></svg>;
  if (weather === 'sunset') return <svg viewBox="0 0 24 24" style={s} fill="none" stroke="#ffb35c" strokeWidth="2" strokeLinecap="round"><path d="M5 17a7 7 0 0 1 14 0" fill="rgba(255,179,92,.25)" /><path d="M3 20h18M12 5v3M5.6 9.6l1.6 1.6M18.4 9.6l-1.6 1.6" /></svg>;
  if (night) return <svg viewBox="0 0 24 24" style={s} fill="#ffe7a8" stroke="none"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>;
  return <svg viewBox="0 0 24 24" style={s} fill="none" stroke="#ffd166" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" fill="#ffd166" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
}

export function Hud({ store }: { store: SceneStore }) {
  const clockRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const [weather, setWeather] = useState<Weather>(store.current.weather);
  const [night, setNight] = useState(false);
  useEffect(() => {
    const tick = () => {
      const s = store.current;
      const extra = Math.min(1, Math.max(0, (performance.now() - store.receivedAt) / 1000));
      const c = worldClock(s.simulationTime + extra);
      if (clockRef.current) clockRef.current.textContent = c.label;
      if (popRef.current) popRef.current.textContent = `${s.residents.length} resident${s.residents.length === 1 ? '' : 's'}`;
      setWeather(prev => (prev === s.weather ? prev : s.weather));
      setNight(prev => (prev === c.isNight ? prev : c.isNight));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [store]);
  return (
    <div style={pill} data-testid="world-hud">
      <div style={main}>
        <WeatherIcon weather={weather} night={night} />
        <span ref={clockRef} style={{ fontVariantNumeric: 'tabular-nums' }} />
        <span style={{ opacity: 0.55 }}>·</span>
        <span style={{ opacity: 0.85 }}>{WEATHER_LABEL[weather] ?? weather}</span>
      </div>
      <div style={sub}>
        <span ref={popRef} />
        <span><i style={dot('#b28cff')} />Raid portal</span>
        <span><i style={dot('#ffd166')} />Stage</span>
        <span><i style={dot('#ff8a5b')} />Café</span>
      </div>
    </div>
  );
}
