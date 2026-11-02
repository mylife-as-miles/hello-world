/** Stable integration contract v1. All timestamps are Unix milliseconds. */
export const SCHEMA_VERSION = 1 as const;
export const EVENT_KINDS = ['join', 'chat', 'wave', 'dance', 'gift', 'social', 'weather', 'confetti', 'raid', 'custom'] as const;
export type WorldEventKind = typeof EVENT_KINDS[number];
export type WorldEventSource = 'twitch' | 'viewer' | 'demo' | 'simulation';
export type Weather = 'sunny' | 'rain' | 'snow' | 'sunset';
export type CameraMode = 'orbit' | 'neighborhood' | 'street' | 'follow' | 'cinematic';
export interface AvatarAppearance {
  baseModelId: string;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  outfit: { top: string; bottom: string; shoes: string; color: string };
  accessories: string[];
  face: { eyeColor: string; eyeSize: number; noseSize: number; mouthSize: number };
  body: { height: number; build: number };
}
export interface ResidentProfile {
  id: string;
  displayName: string;
  appearance: AvatarAppearance;
  personality: string[];
  needs: { energy: number; social: number; fun: number };
  location: { x: number; y: number; z: number; zone: string };
  activity: string;
  joinedAt: number;
  lastActiveAt: number;
}
export interface Relationship {
  residentA: string;
  residentB: string;
  friendship: number;
  lastInteractionAt: number;
  memories: string[];
}
/** Payload is validated at the server boundary before dispatch. No scripts. */
export interface WorldEventPayload {
  appearance?: AvatarAppearance;
  personality?: string[];
  weather?: Weather;
  amount?: number;
  action?: 'greet' | 'compliment' | 'befriend' | 'celebrate' | 'update-avatar';
  color?: string;
  [key: string]: string | number | boolean | string[] | AvatarAppearance | undefined;
}
export interface WorldEvent {
  id: string;
  kind: WorldEventKind;
  source: WorldEventSource;
  actorId: string;
  actorDisplayName: string;
  targetId?: string;
  timestamp: number;
  text?: string;
  payload?: WorldEventPayload;
}
export interface WorldSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  worldId: string;
  residents: ResidentProfile[];
  relationships: Relationship[];
  weather: Weather;
  eventHistory: WorldEvent[];
  simulationTime: number;
}
export interface WorldRuntime {
  dispatch(event: WorldEvent): void;
  getSnapshot(): WorldSnapshot;
  subscribe(listener: (snapshot: WorldSnapshot) => void): () => void;
}
export interface WorldRuntimeOptions {
  worldId?: string;
  initialSnapshot?: WorldSnapshot;
  seedResidents?: boolean;
  autoTick?: boolean;
  tickIntervalMs?: number;
}
export interface WorldSceneProps {
  runtime: WorldRuntime;
  transparent?: boolean;
  cameraMode?: CameraMode;
  selectedResidentId?: string;
  onResidentSelect?: (id: string) => void;
  quality?: 'low' | 'high';
  className?: string;
}
export interface AvatarCreatorProps {
  initialAppearance?: AvatarAppearance;
  displayName?: string;
  onSave: (appearance: AvatarAppearance) => void;
  onCancel?: () => void;
}
export interface DirectorSettings {
  approvalRequired: boolean;
  cooldownSeconds: number;
  maxResidents: number;
  paused: boolean;
}
export type ClientMessage =
  | { type: 'event'; event: WorldEvent }
  | { type: 'director-auth'; key: string }
  | { type: 'director-settings'; settings: Partial<DirectorSettings> }
  | { type: 'approve'; eventId: string }
  | { type: 'reject'; eventId: string }
  | { type: 'reset' };
export type ServerMessage =
  | { type: 'snapshot'; snapshot: WorldSnapshot }
  | { type: 'event'; event: WorldEvent }
  | { type: 'status'; mode: 'demo' | 'live'; twitch: string; clients: number; settings: DirectorSettings; pending: WorldEvent[] }
  | { type: 'error'; message: string; eventId?: string }
  | { type: 'director-auth'; authorized: boolean };
