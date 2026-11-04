/** Real login handler/cookies and SQLite; only Composio's external replies are mocked. */
import { handleTwitchLogin, type TwitchLoginEnv } from "../../apps/server/src/twitch-login.js";
import type { ManagedProfileClient } from "../../apps/server/src/composio-twitch-poc.js";
export async function fixtureTwitchCookie(env: TwitchLoginEnv, twitchId: string, displayName = `Streamer ${twitchId}`) {
  let providerOwner = "";
  const client: ManagedProfileClient = {
    toolkit: async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"], authConfigDetails: [{ mode: "OAUTH2", requiredScopes: [] }] }),
    createProfileConfig: async () => ({ id: "ac_fixture" }),
    config: async () => ({ isComposioManaged: true, status: "ENABLED", toolkit: { slug: "twitch" }, credentials: { scopes: "" } }),
    authorize: async owner => { providerOwner = owner; return { id: `ca_${twitchId}`, redirectUrl: "https://connect.composio.dev/link/fixture" }; },
    completeAuth: async (owner, uri) => {
      if (owner !== providerOwner || uri !== `fixture-completion-${twitchId}`) throw new Error("Fixture completion proof mismatch");
      return { connectedAccountId: `ca_${twitchId}`, toolkitSlug: "twitch" };
    },
    ownedAccounts: async owner => ({ items: owner === providerOwner ? [{ id: `ca_${twitchId}`, status: "ACTIVE", toolkit: { slug: "twitch" }, authConfig: { id: "ac_fixture" } }] : [] }),
    profile: async () => ({ status: 200, data: { data: [{ id: twitchId, login: `streamer${twitchId}`, display_name: displayName }] } }),
  };
  const start = await handleTwitchLogin(new Request("https://world.test/api/auth/twitch/start", {
    method: "POST", headers: { Origin: "https://world.test", "Content-Type": "application/json" }, body: JSON.stringify({ returnTo: "/director" }),
  }), env, async () => client);
  if (start.status !== 200) throw new Error(`Fixture Twitch login failed: ${await start.text()}`);
  const proofCookie = start.headers.getSetCookie()[0].split(";")[0];
  const done = await handleTwitchLogin(new Request(`https://world.test/api/auth/twitch/verify?session_uri=fixture-completion-${twitchId}`, { headers: { Cookie: proofCookie } }), env, async () => client);
  if (done.status !== 303) throw new Error(`Fixture Twitch callback failed: ${await done.text()}`);
  return done.headers.getSetCookie().find(v => v.startsWith("__Host-hw_twitch="))!.split(";")[0];
}
