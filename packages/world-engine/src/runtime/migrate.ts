/**
 * Versioned snapshot restore. Accepts unknown JSON (disk, IndexedDB, network)
 * and returns a valid v1 WorldSnapshot or null. Repairs out-of-range values
 * instead of trusting them. Node-safe.
 */
import { SCHEMA_VERSION, type Relationship, type ResidentProfile, type Weather, type WorldEvent, type WorldSnapshot } from '@hello-world/contracts';
import { normalizeAppearance } from '../avatars/catalog';
import { validateEvent, sanitizeText } from './validate';

const WEATHERS = new Set<Weather>(['sunny', 'rain', 'snow', 'sunset']);
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function migrateSnapshot(input: unknown): WorldSnapshot | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, unknown>;
  // Future schema versions would be upgraded here, step by step.
  if (s.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof s.worldId !== 'string' || !Array.isArray(s.residents)) return null;

  const residents: ResidentProfile[] = [];
  const ids = new Set<string>();
  for (const raw of s.residents as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || ids.has(r.id) || r.id.length > 96) continue;
    ids.add(r.id);
    const needs = (r.needs ?? {}) as Record<string, unknown>;
    const loc = (r.location ?? {}) as Record<string, unknown>;
    residents.push({
      id: r.id,
      displayName: sanitizeText(typeof r.displayName === 'string' ? r.displayName : 'Neighbor', 40) || 'Neighbor',
      appearance: normalizeAppearance(r.appearance),
      personality: Array.isArray(r.personality) ? r.personality.filter((t): t is string => typeof t === 'string').slice(0, 5) : [],
      needs: { energy: clamp(needs.energy, 0, 100, 70), social: clamp(needs.social, 0, 100, 60), fun: clamp(needs.fun, 0, 100, 60) },
      location: { x: clamp(loc.x, -40, 40, 0), y: clamp(loc.y, -5, 20, 0), z: clamp(loc.z, -40, 40, 0), zone: typeof loc.zone === 'string' ? loc.zone.slice(0, 40) : 'plaza' },
      activity: typeof r.activity === 'string' ? sanitizeText(r.activity, 80) || 'idle' : 'idle',
      joinedAt: clamp(r.joinedAt, 0, Number.MAX_SAFE_INTEGER, 0),
      lastActiveAt: clamp(r.lastActiveAt, 0, Number.MAX_SAFE_INTEGER, 0),
    });
    if (residents.length >= 50) break;
  }

  const relationships: Relationship[] = [];
  for (const raw of Array.isArray(s.relationships) ? s.relationships as unknown[] : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.residentA !== 'string' || typeof r.residentB !== 'string' || r.residentA === r.residentB) continue;
    relationships.push({
      residentA: r.residentA,
      residentB: r.residentB,
      friendship: clamp(r.friendship, 0, 100, 50),
      lastInteractionAt: clamp(r.lastInteractionAt, 0, Number.MAX_SAFE_INTEGER, 0),
      memories: Array.isArray(r.memories) ? r.memories.filter((m): m is string => typeof m === 'string').map(m => sanitizeText(m, 220)).slice(-12) : [],
    });
  }

  const eventHistory: WorldEvent[] = [];
  for (const raw of Array.isArray(s.eventHistory) ? s.eventHistory as unknown[] : []) {
    const v = validateEvent(raw);
    if (v.ok) eventHistory.push(v.event);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    worldId: s.worldId,
    residents,
    relationships,
    weather: WEATHERS.has(s.weather as Weather) ? (s.weather as Weather) : 'sunny',
    eventHistory: eventHistory.slice(-100),
    simulationTime: clamp(s.simulationTime, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}
