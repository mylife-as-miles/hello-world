/** Run from the server workspace. Default mode has no credential reads or network. */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ComposioPocError, beginManagedProfileProof, createManagedProfileClient, inspectManagedTwitch, readManagedProfileProof, requireComposioApproval, type ProfileAttempt } from "./composio-twitch-poc.js";

const args = process.argv.slice(2), mode = args.find(a => a.startsWith("--mode="))?.slice(7) || "plan";
const approval = args.find(a => a.startsWith("--approved="))?.slice(11);
const plan = { provider: "Composio Platform managed Twitch OAuth", sdk: "@composio/core@0.28.0", toolkitVersion: "20261101_00",
  read: "GET https://api.twitch.tv/helix/users (own basic profile)", extraTwitchScopes: [],
  credentialsUsed: false, accountCreated: false, authorizationStarted: false, liveEventsVerified: false,
  next: "Owner approval and a privately configured Composio Platform project key are required. Never paste credentials into chat." };
try {
  if (mode === "plan") console.log(JSON.stringify(plan, null, 2));
  else {
    if (!["inspect", "connect", "read"].includes(mode)) throw new ComposioPocError("UNKNOWN_MODE");
    requireComposioApproval(approval, mode === "connect");
    // Read credentials only after explicit mode-specific operator approval.
    const apiKey = process.env.COMPOSIO_API_KEY, ownerId = process.env.COMPOSIO_OWNER_ID;
    if (!apiKey || !ownerId) throw new ComposioPocError("PRIVATE_COMPOSIO_CONFIGURATION_REQUIRED");
    const client = await createManagedProfileClient(apiKey);
    const directory = resolve(fileURLToPath(new URL("../../../.data/composio-poc", import.meta.url)));
    if (mode === "inspect") console.log(JSON.stringify(await inspectManagedTwitch(client)));
    else if (mode === "connect") {
      if (await stat(resolve(directory, "attempt.json")).then(() => true, () => false))
        throw new ComposioPocError("EXISTING_PRIVATE_ATTEMPT_REQUIRES_REVIEW");
      const proof = await beginManagedProfileProof(client, ownerId, approval!);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(resolve(directory, "attempt.json"), JSON.stringify(proof.attempt), { mode: 0o600, flag: "wx" });
      await writeFile(resolve(directory, "connect-url.txt"), proof.connectUrl, { mode: 0o600, flag: "wx" });
      console.log(JSON.stringify({ authorizationStarted: true, privateFiles: ".data/composio-poc/", instruction: "Open the private consent link yourself. Stop if Twitch requests permissions beyond the reviewed basic-profile proof. Then run read mode within ten minutes.", liveEventsVerified: false }));
    } else {
      const attempt = JSON.parse(await readFile(resolve(directory, "attempt.json"), "utf8")) as ProfileAttempt;
      const proof = await readManagedProfileProof(client, attempt, ownerId, approval!);
      await writeFile(resolve(directory, "result.json"), JSON.stringify(proof), { mode: 0o600 });
      console.log(JSON.stringify({ profileReadVerified: true, liveEventsVerified: false, privateResult: ".data/composio-poc/result.json" }));
    }
  }
} catch (error) {
  // Never log SDK errors, account state, URLs, credentials, or HTTP request dumps.
  console.error(JSON.stringify({ error: error instanceof ComposioPocError ? error.code : "PROOF_FAILED_CHECK_PRIVATE_PROVIDER_REQUEST_LOG", liveEventsVerified: false }));
  process.exitCode = 1;
}
