# Public world, private Director

The live world is public:
https://hello-world-miles-society.myles4miles.chatgpt.site

Anyone can watch the world and load `/world` or `/overlay` without signing in. ChatGPT sign-in is required to create a resident, save appearance and send viewer interactions. The existing shared D1 world and Twitch callback URLs are preserved.

Director controls are the streamer's tools: weather and event triggers, approval/moderation, population and cooldown settings, interaction pause, reset, and Twitch setup. These require an authenticated Sites identity whose trusted email matches the server-side `DIRECTOR_OWNER_EMAIL`. The configured email never reaches the frontend. Missing owner configuration fails closed; the old `DEMO_DIRECTOR` audience shortcut is removed. Signing in alone does not grant Director access.

The owner should sign in with the same ChatGPT account that owns the Site, then open Director Studio. Hosted access uses Sites identity; local Node development still supports its separate private Director key.

The production HTTP checks confirm that anonymous snapshot reads succeed, anonymous reset and OAuth initiation return 401, and forged owner identity headers do not grant authorization. Sites strips those forged headers before the application receives them. Local SQLite-backed tests also reject ordinary signed-in users' settings, reset, approval and Director-auth attempts. See [production HTTP evidence](evidence/public-access-http.json).

The canonical asset-root fallback preserves public `/world`, `/director` and `/overlay` URLs without redirecting the browser back to `/`.

The actual public deployment passed 8 signed-out Chromium checks with zero uncaught browser errors: live world and overlay rendering, sign-in link for resident creation, disabled guest weather controls, server rejection of guest reset, and owner-only Director unlock UI. [Browser report](screenshots/public/browser-results.json) · [Native publication/access result](evidence/public-deployment.json) · [Public world screenshot](screenshots/public/world-public.png) · [Locked Director screenshot](screenshots/public/director-locked.png).

Owner sign-in was not impersonated in the live browser test. Owner authorization is covered using trusted identity fixtures in the SQLite-backed acceptance suite; the actual owner can sign in normally to use the controls.
