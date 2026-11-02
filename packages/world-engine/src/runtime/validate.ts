/**
 * Defensive validation of incoming WorldEvents. The server validates first;
 * the engine re-validates so a malformed event can never corrupt state.
 * Node-safe.
 */
import { EVENT_KINDS, type WorldEvent, type WorldEventPayload, type Weather } from '@hello-world/contracts';
import { normalizeAppearance } from '../avatars/catalog';

const KIND_SET = new Set<string>(EVENT_KINDS);
const SOURCES = new Set(['twitch', 'viewer', 'demo', 'simulation']);
const WEATHERS = new Set<Weather>(['sunny', 'rain', 'snow', 'sunset']);
const ACTIONS = new Set(['greet', 'compliment', 'befriend', 'celebrate', 'update-avatar']);
const ID_RE = /^[\w:.@\-]{1,96}$/;

export const MAX_TEXT_LENGTH = 200;
export const MAX_NAME_LENGTH = 40;

export type ValidationResult = { ok: true; event: WorldEvent } | { ok: false; reason: string };

/** Strip control characters / markup-ish noise; collapse whitespace. */
export function sanitizeText(text: string, max = MAX_TEXT_LENGTH): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}\u2026` : cleaned;
}

function sanitizeName(name: string): string {
  const s = sanitizeText(name, MAX_NAME_LENGTH);
  return s.length ? s : 'Neighbor';
}

function sanitizePayload(input: unknown): WorldEventPayload | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const p = input as Record<string, unknown>;
  const out: WorldEventPayload = {};
  if (p.appearance !== undefined) out.appearance = normalizeAppearance(p.appearance);
  if (Array.isArray(p.personality)) {
    out.personality = [...new Set(p.personality.filter((t): t is string => typeof t === 'string')
      .map(t => t.toLowerCase().trim().slice(0, 24)).filter(t => /^[a-z][a-z\- ]*$/.test(t)))].slice(0, 5);
  }
  if (typeof p.weather === 'string' && WEATHERS.has(p.weather as Weather)) out.weather = p.weather as Weather;
  if (typeof p.amount === 'number' && Number.isFinite(p.amount)) out.amount = Math.max(0, Math.min(100000, Math.floor(p.amount)));
  if (typeof p.action === 'string' && ACTIONS.has(p.action)) out.action = p.action as WorldEventPayload['action'];
  if (typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color)) out.color = p.color.toLowerCase();
  // Engine extensions (optional, ignored by older servers): destination POI for movement, gift item, sentiment.
  for (const key of ['destination', 'item', 'sentiment', 'reaction', 'line', 'raider', 'channel'] as const) {
    if (typeof p[key] === 'string') out[key] = sanitizeText(p[key] as string, 60);
  }
  if (typeof p.visitors === 'number' && Number.isFinite(p.visitors)) out.visitors = Math.max(0, Math.min(50, Math.floor(p.visitors)));
  return out;
}

export function validateEvent(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'event must be an object' };
  const e = input as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 128) return { ok: false, reason: 'invalid id' };
  if (typeof e.kind !== 'string' || !KIND_SET.has(e.kind)) return { ok: false, reason: `unknown kind ${String(e.kind)}` };
  if (typeof e.source !== 'string' || !SOURCES.has(e.source)) return { ok: false, reason: 'invalid source' };
  if (typeof e.actorId !== 'string' || !ID_RE.test(e.actorId)) return { ok: false, reason: 'invalid actorId' };
  if (typeof e.actorDisplayName !== 'string') return { ok: false, reason: 'invalid actorDisplayName' };
  if (e.targetId !== undefined && (typeof e.targetId !== 'string' || !ID_RE.test(e.targetId))) return { ok: false, reason: 'invalid targetId' };
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp) || e.timestamp < 0) return { ok: false, reason: 'invalid timestamp' };
  if (e.text !== undefined && typeof e.text !== 'string') return { ok: false, reason: 'invalid text' };
  if (e.kind === 'chat' && (typeof e.text !== 'string' || sanitizeText(e.text).length === 0)) return { ok: false, reason: 'chat requires text' };
  const payload = sanitizePayload(e.payload);
  if (e.kind === 'weather' && !payload?.weather) return { ok: false, reason: 'weather requires payload.weather' };
  const event: WorldEvent = {
    id: e.id,
    kind: e.kind as WorldEvent['kind'],
    source: e.source as WorldEvent['source'],
    actorId: e.actorId,
    actorDisplayName: sanitizeName(e.actorDisplayName),
    timestamp: Math.floor(e.timestamp),
    ...(typeof e.targetId === 'string' && e.targetId !== e.actorId ? { targetId: e.targetId } : {}),
    ...(typeof e.text === 'string' ? { text: sanitizeText(e.text) } : {}),
    ...(payload && Object.keys(payload).length ? { payload } : {}),
  };
  return { ok: true, event };
}
