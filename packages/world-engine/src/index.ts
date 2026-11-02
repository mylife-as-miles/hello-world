/**
 * @hello-world/world-engine — browser entry.
 *   import { WorldScene, AvatarCreator, createWorldRuntime } from '@hello-world/world-engine';
 * Node/server code must import from '@hello-world/world-engine/runtime'.
 */
export { WorldScene } from './scene/WorldScene';
export { AvatarCreator } from './creator/AvatarCreator';
export * from './runtime/index';
export {
  createPersistentWorldRuntime, createIndexedDbSnapshotStorage, createMemorySnapshotStorage, ENGINE_SAVE_VERSION,
} from './persistence/index';
export type { SnapshotStorage, PersistentWorldRuntime, PersistentRuntimeOptions } from './persistence/index';
export {
  BASE_MODELS, HAIR_STYLES, TOPS, BOTTOMS, SHOES, ACCESSORIES, SKIN_TONES, HAIR_COLORS, EYE_COLORS, OUTFIT_COLORS,
  PERSONALITY_TRAITS,
} from './avatars/catalog';
