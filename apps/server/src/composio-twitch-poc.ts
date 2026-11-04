/** Isolated, approval-gated managed-auth proof. Never imports/exports Twitch tokens. */

export class ComposioPocError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface ManagedProfileClient {
  toolkit(): Promise<unknown>;
  createProfileConfig(): Promise<unknown>;
  config(id: string): Promise<unknown>;
  authorize(owner: string, config: string): Promise<{ id: string; redirectUrl?: string | null }>;
  ownedAccounts(owner: string, config: string): Promise<unknown>;
  profile(owner: string, account: string): Promise<{ status: number; data?: unknown }>;
}
export interface ProfileAttempt {
  ownerId: string;
  authConfigId: string;
  connectedAccountId: string;
  expiresAt: number;
}
const object = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const validId = (v: unknown): v is string => typeof v === "string" && /^[\w:-]{1,256}$/.test(v);
export function requireComposioApproval(approval: string | undefined, connect = false) {
  if (approval !== (connect ? "connect-profile" : "read-only"))
    throw new ComposioPocError("OWNER_APPROVAL_REQUIRED");
}
export async function createManagedProfileClient(apiKey: string): Promise<ManagedProfileClient> {
  const { Composio } = await import("@composio/core");
  const composio = new Composio({ apiKey, allowTracking: false, logLevel: "silent", disableVersionCheck: true,
    toolkitVersions: { twitch: "20261101_00" } });
  const bounded = () => ({ signal: AbortSignal.timeout(10_000) });
  return {
    toolkit: () => composio.toolkits.get("twitch", bounded()),
    createProfileConfig: () => composio.authConfigs.create("twitch", {
      type: "use_composio_managed_auth", name: "HELLO WORLD profile-only proof",
      credentials: { scopes: "" },
    }, bounded()),
    config: id => composio.authConfigs.get(id, bounded()),
    async authorize(ownerId, authConfigId) {
      const session = await composio.sessions.create(ownerId, {
        toolkits: ["twitch"], authConfigs: { twitch: authConfigId },
        tools: { twitch: ["TWITCH_GET_USERS"] }, manageConnections: false,
      }, bounded());
      // 0.28.0's facade type omits the third argument; its bound runtime method
      // forwards it to the generated client's link request (ToolRouterSession).
      const authorize = session.authorize as (toolkit: string, options: undefined, request: { signal: AbortSignal }) => ReturnType<typeof session.authorize>;
      return authorize("twitch", undefined, bounded());
    },
    ownedAccounts: (ownerId, configId) => composio.connectedAccounts.list({
      userIds: [ownerId], authConfigIds: [configId], statuses: ["ACTIVE"], limit: 100,
    }, bounded()),
    profile: (userId, connectedAccountId) => composio.tools.proxyExecute({
      userId, connectedAccountId, method: "GET", endpoint: "https://api.twitch.tv/helix/users",
    }, bounded()),
  };
}
export async function inspectManagedTwitch(client: ManagedProfileClient) {
  const toolkit = object(await client.toolkit());
  if (String(toolkit.slug).toLowerCase() !== "twitch" || !toolkit.composioManagedAuthSchemes?.includes("OAUTH2"))
    throw new ComposioPocError("MANAGED_TWITCH_OAUTH_UNAVAILABLE");
  const auth = (toolkit.authConfigDetails || []).find((a: any) => a.mode === "OAUTH2" || a.name === "OAUTH2");
  // Missing metadata is not evidence that extra permissions aren't requested.
  if (!auth || !Array.isArray(auth.requiredScopes))
    throw new ComposioPocError("MANAGED_REQUIRED_SCOPES_UNVERIFIED");
  if (auth.requiredScopes.length)
    throw new ComposioPocError("MANAGED_APP_REQUIRES_ADDITIONAL_SCOPE_REVIEW");
  return { managedOAuth: true, requestedExtraScopes: [] as string[], liveEventsVerified: false };
}
async function checkConfig(client: ManagedProfileClient, id: string) {
  const config = object(await client.config(id));
  if (config.isComposioManaged !== true || config.toolkit?.slug?.toLowerCase() !== "twitch" || config.status !== "ENABLED")
    throw new ComposioPocError("PROFILE_CONFIG_NOT_MANAGED_TWITCH");
  const scopes = config.credentials?.scopes;
  if (!(scopes === "" || Array.isArray(scopes) && scopes.length === 0))
    throw new ComposioPocError("EMPTY_SCOPE_OVERRIDE_UNVERIFIED");
}
export async function beginManagedProfileProof(client: ManagedProfileClient, ownerId: string, approval: string) {
  requireComposioApproval(approval, true);
  if (!validId(ownerId)) throw new ComposioPocError("INVALID_SERVER_OWNER_ID");
  await inspectManagedTwitch(client);
  const config = object(await client.createProfileConfig());
  if (!validId(config.id)) throw new ComposioPocError("INVALID_AUTH_CONFIG");
  await checkConfig(client, config.id);
  const connection = await client.authorize(ownerId, config.id);
  const url = new URL(connection.redirectUrl || "");
  if (url.href.length > 4096 || url.protocol !== "https:" || !["connect.composio.dev", "backend.composio.dev"].includes(url.hostname) || url.username || url.password || url.port || url.hash)
    throw new ComposioPocError("UNEXPECTED_CONNECT_DESTINATION");
  if (!validId(connection.id)) throw new ComposioPocError("INVALID_CONNECTION_ID");
  return { attempt: { ownerId, authConfigId: config.id, connectedAccountId: connection.id, expiresAt: Date.now() + 600_000 } satisfies ProfileAttempt,
    // Sensitive consent link: caller stores privately, never logs it or provider state.
    connectUrl: url.href };
}
export async function readManagedProfileProof(client: ManagedProfileClient, attempt: ProfileAttempt, ownerId: string, approval: string) {
  requireComposioApproval(approval);
  if (!validId(ownerId) || attempt.ownerId !== ownerId || !validId(attempt.authConfigId) || !validId(attempt.connectedAccountId) || !Number.isFinite(attempt.expiresAt) || attempt.expiresAt < Date.now())
    throw new ComposioPocError("ATTEMPT_EXPIRED_OR_OWNER_MISMATCH");
  await checkConfig(client, attempt.authConfigId);
  const list = object(await client.ownedAccounts(ownerId, attempt.authConfigId));
  const account = list.items?.find((a: any) => a.id === attempt.connectedAccountId);
  if (!account || account.status !== "ACTIVE" || account.isDisabled || account.toolkit?.slug?.toLowerCase() !== "twitch" || account.authConfig?.id !== attempt.authConfigId)
    throw new ComposioPocError("OWNER_CONNECTION_NOT_ACTIVE");
  const result = await client.profile(ownerId, attempt.connectedAccountId);
  if (result.status !== 200) throw new ComposioPocError(`PROFILE_READ_HTTP_${result.status}`);
  const user = object(object(result.data).data?.[0]);
  if (!/^\d+$/.test(String(user.id)) || typeof user.login !== "string") throw new ComposioPocError("PROFILE_RESPONSE_INVALID");
  return { profileReadVerified: true, liveEventsVerified: false,
    profile: { id: user.id, login: user.login, displayName: user.display_name, broadcasterType: user.broadcaster_type || "" } };
}
