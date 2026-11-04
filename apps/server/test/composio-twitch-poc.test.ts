import { describe, it, expect, vi } from "vitest";
import { beginManagedProfileProof, inspectManagedTwitch, readManagedProfileProof, requireComposioApproval, type ManagedProfileClient } from "../src/composio-twitch-poc.js";

function fixture() {
  const client: ManagedProfileClient = {
    toolkit: vi.fn(async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"], authConfigDetails: [{ name: "OAUTH2", requiredScopes: [] }] })),
    createProfileConfig: vi.fn(async () => ({ id: "ac_profile" })),
    config: vi.fn(async () => ({ isComposioManaged: true, toolkit: { slug: "twitch" }, status: "ENABLED", credentials: { scopes: "" } })),
    authorize: vi.fn(async () => ({ id: "ca_profile", redirectUrl: "https://connect.composio.dev/link/private-test-link" })),
    ownedAccounts: vi.fn(async () => ({ items: [{ id: "ca_profile", status: "ACTIVE", isDisabled: false, toolkit: { slug: "twitch" }, authConfig: { id: "ac_profile" }, state: { access_token: "should-never-be-returned" } }] })),
    profile: vi.fn(async () => ({ status: 200, data: { data: [{ id: "123", login: "streamer", display_name: "Streamer", broadcaster_type: "", email: "not-requested@example.test", access_token: "never-log" }] } })),
  };
  return client;
}
describe("approval-gated Composio managed Twitch proof", () => {
  it("requires distinct owner approvals before credential use or persistent authorization", async () => {
    expect(() => requireComposioApproval(undefined)).toThrow("OWNER_APPROVAL_REQUIRED");
    expect(() => requireComposioApproval("read-only", true)).toThrow("OWNER_APPROVAL_REQUIRED");
    const client = fixture();
    await expect(beginManagedProfileProof(client, "world:owner", "read-only")).rejects.toThrow("OWNER_APPROVAL_REQUIRED");
    expect(client.toolkit).not.toHaveBeenCalled();
  });
  it("does not substitute a custom app or guess unreported required scopes", async () => {
    const client = fixture();
    client.toolkit = async () => ({ slug: "twitch", composioManagedAuthSchemes: [] });
    await expect(inspectManagedTwitch(client)).rejects.toThrow("MANAGED_TWITCH_OAUTH_UNAVAILABLE");
    client.toolkit = async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"] });
    await expect(inspectManagedTwitch(client)).rejects.toThrow("MANAGED_REQUIRED_SCOPES_UNVERIFIED");
    client.toolkit = async () => ({ slug: "twitch", composioManagedAuthSchemes: ["OAUTH2"], authConfigDetails: [{ name: "OAUTH2", requiredScopes: ["chat:edit"] }] });
    await expect(inspectManagedTwitch(client)).rejects.toThrow("ADDITIONAL_SCOPE_REVIEW");
    expect(client.createProfileConfig).not.toHaveBeenCalled();
  });
  it("refuses broadened, masked or unverifiable empty-scope config before creating a link", async () => {
    for (const scopes of [undefined, "***", "user:read:email", ["chat:read"]]) {
      const client = fixture();
      client.config = async () => ({ isComposioManaged: true, toolkit: { slug: "twitch" }, status: "ENABLED", credentials: { scopes } });
      await expect(beginManagedProfileProof(client, "world:owner", "connect-profile")).rejects.toThrow("EMPTY_SCOPE_OVERRIDE_UNVERIFIED");
      expect(client.authorize).not.toHaveBeenCalled();
    }
  });
  it("binds a private connection attempt to its operator and validates the consent destination", async () => {
    const client = fixture();
    const result = await beginManagedProfileProof(client, "world:owner", "connect-profile");
    expect(result.attempt.ownerId).toBe("world:owner");
    expect(client.authorize).toHaveBeenCalledWith("world:owner", "ac_profile");
    client.authorize = async () => ({ id: "ca_profile", redirectUrl: "https://composio.dev.evil.test/steal" });
    await expect(beginManagedProfileProof(client, "world:owner", "connect-profile")).rejects.toThrow("UNEXPECTED_CONNECT_DESTINATION");
  });
  it("requires an active account in the exact owner's private account list", async () => {
    const client = fixture(); const { attempt } = await beginManagedProfileProof(client, "world:owner", "connect-profile");
    await expect(readManagedProfileProof(client, attempt, "another-owner", "read-only")).rejects.toThrow("OWNER_MISMATCH");
    client.ownedAccounts = async () => ({ items: [] });
    await expect(readManagedProfileProof(client, attempt, "world:owner", "read-only")).rejects.toThrow("OWNER_CONNECTION_NOT_ACTIVE");
    expect(client.profile).not.toHaveBeenCalled();
  });
  it("returns only basic public profile fields and never calls it a verified live event", async () => {
    const client = fixture(); const { attempt } = await beginManagedProfileProof(client, "world:owner", "connect-profile");
    const result = await readManagedProfileProof(client, attempt, "world:owner", "read-only");
    expect(result).toEqual({ profileReadVerified: true, liveEventsVerified: false, profile: { id: "123", login: "streamer", displayName: "Streamer", broadcasterType: "" } });
    expect(JSON.stringify(result)).not.toMatch(/token|email/);
    expect(client.profile).toHaveBeenCalledWith("world:owner", "ca_profile");
  });
});
