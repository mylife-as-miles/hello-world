import { useEffect, useState } from "react";

/** Shown only to the Director; every request is independently owner-authorized. */
export function ComposioProfileProof() {
  const [configured, setConfigured] = useState(false), [inspected, setInspected] = useState(false);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState(false), [hasAttempt, setHasAttempt] = useState(false);
  const [link, setLink] = useState(""), [state, setState] = useState("Loading connection status…");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/composio/twitch/status", { cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error();
      const d = await r.json(); if (!cancelled) { setConfigured(d.configured); setLink(d.connectUrl || ""); setHasAttempt(d.status !== "not-started"); setState(d.profileReadVerified ? "Basic profile verified. Live events are not connected." : d.status === "not-started" ? "Basic-profile test has not started." : `Connection: ${d.status}.`); }
    }).catch(() => { if (!cancelled) setState("Hosted connection test is unavailable."); });
    return () => { cancelled = true; };
  }, []);
  async function run(action: "inspect" | "connect" | "read" | "reset-proof") {
    setBusy(true);
    try {
      const r = await fetch(`/api/composio/twitch/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approval: action === "reset-proof" ? "reset-after-revocation" : action === "connect" ? "connect-profile" : "read-only" }) });
      const d = await r.json();
      if (!r.ok) { setState(`Test stopped: ${typeof d.error === "string" ? d.error : "REQUEST_FAILED"}. See the Composio setup guide.`); return; }
      if (action === "inspect") { setInspected(true); setState("Managed OAuth confirmed; no additional scopes reported. Review consent before connecting."); }
      if (action === "connect") { setHasAttempt(true); setLink(d.connectUrl); setState("Open the private consent link below. Stop if Twitch asks for extra permissions. Then return and verify within ten minutes."); }
      if (action === "read") { setLink(""); setState("Basic profile verified. Live events are not connected."); }
      if (action === "reset-proof") { setLink(""); setHasAttempt(false); setRevoked(false); setConsent(false); setInspected(false); setState("Local proof record cleared. This did not revoke provider access or change your world."); }
    } catch { setState("The test could not finish. Your world remains in Demo Mode."); }
    finally { setBusy(false); }
  }
  return <section className="integration-explanation composio-profile-proof">
    <h3>Connect through Composio · profile test</h3>
    <p>Use the privately configured managed app to test your basic Twitch profile. This does not connect chat or world events.</p>
    <p role="status" aria-live="polite">{state}</p>
    <button className="button secondary full-width" disabled={busy || !configured} onClick={() => void run("inspect")}>Check managed OAuth permissions</button>
    {inspected && !hasAttempt && <>
      <label className="check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I approve a persistent basic-profile connection. Composio stores and refreshes the grant until I revoke it.</label>
      <button className="button twitch-connect full-width" disabled={busy || !consent} onClick={() => void run("connect")}>Prepare private Twitch consent</button>
    </>}
    {link && <a className="button twitch-connect full-width" href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Review Twitch consent</a>}
    <button className="button secondary full-width" disabled={busy || !configured} onClick={() => void run("read")}>Verify approved basic profile</button>
    {hasAttempt && <>
      <p>If a test expired or failed, first revoke/remove this test connection in Composio. Clearing this local record does not revoke provider access.</p>
      <label className="check-row"><input type="checkbox" checked={revoked} onChange={e => setRevoked(e.target.checked)} /> I reviewed and removed the previous test grant in Composio.</label>
      <button className="button secondary full-width" disabled={busy || !revoked} onClick={() => void run("reset-proof")}>Clear local connection test</button>
    </>}
    <a className="text-link" href="https://github.com/mylife-as-miles/hello-world/blob/main/docs/COMPOSIO_TWITCH.md" target="_blank" rel="noreferrer">Composio setup and limitations</a>
  </section>;
}
