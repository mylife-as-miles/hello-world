/**
 * World clock derived from contract `simulationTime` (elapsed simulation seconds).
 * 1 simulation second = 1 game minute, so a full day lasts 24 real minutes and a
 * stream sees morning → golden hour → lamp-lit night. Day 1 starts at 08:00.
 * Pure + Node-safe (simulation routines and the renderer both use it).
 */
export const GAME_MINUTES_PER_SIM_SECOND = 1;
export const DAY_START_HOUR = 8;
export const SUNRISE_HOUR = 6;
export const SUNSET_HOUR = 19.5;

export interface WorldClock {
  /** 0–24 (fractional). */
  hours: number;
  /** Day number starting at 1. */
  day: number;
  /** 0–1 position in the day (0 = midnight). */
  dayFraction: number;
  /** 0 at night … 1 at noon-ish (smooth). */
  daylight: number;
  /** Sun elevation angle in radians (negative below horizon). */
  sunElevation: number;
  /** Sun azimuth radians (0 = north/-Z, π/2 = east/+X). */
  sunAzimuth: number;
  isNight: boolean;
  /** "Day 2 · 21:05" */
  label: string;
  period: 'night' | 'morning' | 'afternoon' | 'evening';
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function worldClock(simulationTime: number): WorldClock {
  const totalMinutes = DAY_START_HOUR * 60 + Math.max(0, simulationTime) * GAME_MINUTES_PER_SIM_SECOND;
  const day = Math.floor(totalMinutes / 1440) + 1;
  const minutesToday = totalMinutes % 1440;
  const hours = minutesToday / 60;
  const dayFraction = minutesToday / 1440;
  const daylight = smooth(SUNRISE_HOUR - 0.5, SUNRISE_HOUR + 1.5, hours) * (1 - smooth(SUNSET_HOUR - 1.5, SUNSET_HOUR + 0.75, hours));
  // Sun path: rises in the east, peaks at 12:45, sets in the west.
  const solarT = (hours - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR); // 0..1 during the day
  const sunElevation = Math.sin(Math.PI * solarT) * 1.05 - (solarT < 0 || solarT > 1 ? 0.35 : 0);
  const sunAzimuth = Math.PI * 0.5 + Math.PI * Math.min(1.2, Math.max(-0.2, solarT));
  const isNight = hours < SUNRISE_HOUR || hours >= SUNSET_HOUR + 0.75;
  const hh = Math.floor(hours);
  const mm = Math.floor(minutesToday % 60);
  const period = hours < 5 || hours >= 21 ? 'night' : hours < 12 ? 'morning' : hours < 17.5 ? 'afternoon' : 'evening';
  return { hours, day, dayFraction, daylight, sunElevation, sunAzimuth, isNight, period,
    label: `Day ${day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}
