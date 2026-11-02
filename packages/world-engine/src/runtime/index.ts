/**
 * Node-safe runtime entry: `@hello-world/world-engine/runtime`.
 * MUST NOT import React, DOM APIs, three.js or Dexie (checked by test/node-safety.test.ts).
 */
export { createWorldRuntime, HISTORY_LIMIT, POPULATION_LIMIT, DEFAULT_TICK_MS } from './createWorldRuntime';
export type { WorldEngineRuntime, WorldEngineRuntimeOptions } from './createWorldRuntime';
export { validateEvent, sanitizeText } from './validate';
export { migrateSnapshot } from './migrate';
export { normalizeAppearance, appearanceFromSeed, DEFAULT_APPEARANCE } from '../avatars/catalog';
export { POIS, BUILDINGS, NAV_NODES, NAV_EDGES } from '../world/layout';
export { parseActivityVerb, animationForVerb } from '../world/activities';
// Optional LLM dialogue: text-only lines, never state changes (deterministic templates remain the default).
export { registerDialogueProvider, createHttpDialogueProvider, setDialogueProvider, sanitizeDialogue } from '../simulation';
export type { DialogueProvider, DialogueContext, HttpDialogueOptions } from '../simulation';
