import { z } from "zod";
import { EVENT_KINDS } from "@hello-world/contracts";
import type {
  ClientMessage,
  WorldEvent,
  WorldSnapshot,
} from "@hello-world/contracts";

const identifier = z.string().trim().min(1).max(80);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unit = z.number().finite().min(0).max(1);
const item = z.string().trim().min(1).max(40);
export const appearanceSchema = z
  .object({
    baseModelId: item,
    skinTone: hex,
    hairStyle: item,
    hairColor: hex,
    outfit: z
      .object({ top: item, bottom: item, shoes: item, color: hex })
      .strict(),
    accessories: z.array(item).max(6),
    face: z
      .object({ eyeColor: hex, eyeSize: unit, noseSize: unit, mouthSize: unit })
      .strict(),
    body: z.object({ height: unit, build: unit }).strict(),
  })
  .strict();
export const payloadSchema = z
  .object({
    appearance: appearanceSchema.optional(),
    personality: z.array(item).max(5).optional(),
    weather: z.enum(["sunny", "rain", "snow", "sunset"]).optional(),
    amount: z.number().int().min(1).max(10000).optional(),
    action: z
      .enum(["greet", "compliment", "befriend", "celebrate", "update-avatar"])
      .optional(),
    color: hex.optional(),
  })
  .strict();
export const eventSchema = z
  .object({
    id: identifier,
    kind: z.enum(EVENT_KINDS),
    source: z.enum(["twitch", "viewer", "demo", "simulation"]),
    actorId: identifier,
    actorDisplayName: z.string().trim().min(1).max(32),
    targetId: identifier.optional(),
    timestamp: z.number().finite().nonnegative(),
    text: z.string().trim().max(180).optional(),
    payload: payloadSchema.optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    approvalRequired: z.boolean().optional(),
    cooldownSeconds: z.number().int().min(0).max(60).optional(),
    maxResidents: z.number().int().min(1).max(50).optional(),
    paused: z.boolean().optional(),
  })
  .strict();
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), event: eventSchema }).strict(),
  z
    .object({
      type: z.literal("director-auth"),
      key: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({ type: z.literal("director-settings"), settings: settingsSchema })
    .strict(),
  z.object({ type: z.literal("approve"), eventId: identifier }).strict(),
  z.object({ type: z.literal("reject"), eventId: identifier }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
]);
export function parseClientMessage(input: unknown): ClientMessage {
  return clientMessageSchema.parse(input);
}

// Stored engine history is data, not a client command. The engine may add bounded
// contract-compatible metadata (destination, sentiment, reaction, etc.). Do not
// reuse this schema for browser or authenticated Twitch ingress.
const persistedIdentifier = z.string().trim().min(1).max(128);
const persistedString = z.string().max(500);
const persistedValue = z.union([
  persistedString,
  z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  z.boolean(),
  z.array(z.string().max(200)).max(16),
  appearanceSchema,
]);
const persistedPayloadSchema = z
  .object({
    appearance: appearanceSchema.optional(),
    personality: z.array(z.string().max(80)).max(16).optional(),
    weather: z.enum(["sunny", "rain", "snow", "sunset"]).optional(),
    amount: z
      .number()
      .finite()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .optional(),
    action: z
      .enum(["greet", "compliment", "befriend", "celebrate", "update-avatar"])
      .optional(),
    color: z.string().max(80).optional(),
  })
  .catchall(persistedValue)
  .superRefine((payload, context) => {
    const keys = Object.keys(payload);
    if (
      keys.length > 24 ||
      keys.some(
        (key) =>
          !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(key) ||
          ["constructor", "prototype"].includes(key),
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stored event metadata has invalid or excessive keys",
      });
  });
export const persistedEventSchema = z
  .object({
    id: persistedIdentifier,
    kind: z.enum(EVENT_KINDS),
    source: z.enum(["twitch", "viewer", "demo", "simulation"]),
    actorId: persistedIdentifier,
    actorDisplayName: z.string().trim().min(1).max(64),
    targetId: persistedIdentifier.optional(),
    timestamp: z.number().finite().nonnegative(),
    text: persistedString.optional(),
    payload: persistedPayloadSchema.optional(),
  })
  .strict();

const residentSchema = z.object({
  id: persistedIdentifier,
  displayName: z.string().min(1).max(64),
  appearance: appearanceSchema,
  personality: z.array(z.string().max(80)).max(10),
  needs: z.object({
    energy: z.number().finite(),
    social: z.number().finite(),
    fun: z.number().finite(),
  }),
  location: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
    zone: z.string().max(100),
  }),
  activity: z.string().max(400),
  joinedAt: z.number().finite(),
  lastActiveAt: z.number().finite(),
});
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  worldId: persistedIdentifier,
  residents: z.array(residentSchema).max(50),
  relationships: z
    .array(
      z.object({
        residentA: persistedIdentifier,
        residentB: persistedIdentifier,
        friendship: z.number().finite(),
        lastInteractionAt: z.number().finite(),
        memories: z.array(z.string().max(1000)).max(100),
      }),
    )
    .max(2500),
  weather: z.enum(["sunny", "rain", "snow", "sunset"]),
  eventHistory: z.array(persistedEventSchema).max(100),
  simulationTime: z.number().finite().nonnegative(),
});
export function parseSnapshot(input: unknown): WorldSnapshot {
  return snapshotSchema.parse(input);
}
export function parseEvent(input: unknown): WorldEvent {
  return eventSchema.parse(input);
}
export const cleanText = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
