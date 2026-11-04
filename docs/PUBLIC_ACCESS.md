# Public world, private Director

The live world is public:
https://hello-world-miles-society.myles4miles.chatgpt.site

Anyone can watch `/world` or `/overlay` without signing in. The current product uses Twitch sign-in through Composio for streamers and viewers, with a separate world for each Twitch owner. No ChatGPT account is required. See [public Twitch setup and roles](PUBLIC_TWITCH.md). The account-login flow requires the one-time Composio callback-verifier configuration before it is enabled.

Director controls are the streamer's tools: weather and event triggers, approval/moderation, population and cooldown settings, interaction pause, reset, and Twitch setup. These require a verified Twitch session matching that selected world’s `world_owners` entry. Signing in grants no control over another streamer’s world. ChatGPT/Sites identity headers do not grant Director authority.

A streamer signs in with Twitch and opens their own world’s Director Studio. Local Node development still supports its separate private Director key.

The earlier owner-only release’s production HTTP checks confirmed that anonymous snapshot reads succeed, anonymous reset and OAuth initiation return 401, and forged owner identity headers do not grant authorization. Sites strips those forged headers before the application receives them. Local SQLite-backed tests also reject ordinary signed-in users' settings, reset, approval and Director-auth attempts. See [production HTTP evidence](evidence/public-access-http.json).

The canonical asset-root fallback preserves public `/world`, `/director` and `/overlay` URLs without redirecting the browser back to `/`.

The earlier owner-only release passed 8 signed-out Chromium checks with zero uncaught browser errors: live world and overlay rendering, sign-in link for resident creation, disabled guest weather controls, server rejection of guest reset, and owner-only Director unlock UI. [Browser report](screenshots/public/browser-results.json) · [Native publication/access result](evidence/public-deployment.json) · [Public world screenshot](screenshots/public/world-public.png) · [Locked Director screenshot](screenshots/public/director-locked.png).

Owner sign-in was not impersonated in the live browser test. Owner authorization is covered using trusted identity fixtures in the SQLite-backed acceptance suite; the actual owner can sign in normally to use the controls.

Those linked browser/HTTP artifacts are historical evidence for the previous Sites-owner model. The newer Twitch-user/multi-world acceptance evidence and setup boundary are recorded in [PUBLIC_TWITCH.md](PUBLIC_TWITCH.md).
