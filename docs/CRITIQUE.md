# Independent product critique

## Final verified checkpoint

**8.4/10** (weighted 8.425), reviewed 2026-11-02. This is a strong verified vertical slice; it does not reach the 9/10 target. The final game HUD, larger resident framing, working creator, shared interactions, persistence, Director controls and transparent browser source are supported by actual behavior and images.

| Category | Weight | Score / 10 | Final evidence |
| --- | ---: | ---: | --- |
| Product design and usability | 20% | 8.5 | Actual full-bleed neighborhood, condensed game typography, angular panels, lime actions and readable resident names/bubbles; 390 px layout fits. Minor mobile copy spacing remains visible in the captured build. |
| Functional integration | 25% | 8.8 | Ten real core browser checks cover creator/preset/appearance, join, social/chat, refresh and independent-session state. Final focused tests add private-key Director UI authentication, weather fanout and labeled demo confetti. Ten actual runtime acceptance checks cover server restart and shared state. |
| Twitch and OBS experience | 20% | 8.0 | Honest Demo Mode, validated shared event path, documented scope/credential requirements. Actual 1920×1080 browser-source alpha and nonblank content pass; selected follow target is fully visible. Live Twitch and an installed OBS application remain untested. |
| Performance and stability | 15% | 8.0 | Reported frozen-main Node 22/pnpm 10 checks: 80 tests, typecheck and build pass; ten actual runtime checks pass. Final browser routes have zero page errors. Software WebGPU world/studio/overlay probes report the actual backend and rendered pixels without shader/page errors. Hardware performance is unmeasured. |
| Character and world experience | 15% | 8.6 | Loaded avatar rig and usable creator, distinctive outfit saved to authoritative state, autonomous residents, social friendship/memory, decorated neighborhood, weather and celebration reactions. Closer final framing makes characters much more legible. |
| Overall delight | 5% | 8.7 | The living neighborhood, speech, lighting, portal and coherent game HUD make the community-world concept tangible. |

The first scored checkpoint was 7.05. A genuine creator pointer/layout defect lowered the temporary score to 6.68. Its behavioral retest recovered the score; subsequent core checks and final HUD/Director/overlay verification raised it to 8.425. The checkpoint history below preserves the evidence rather than hiding failures.

### Final evidence and limits

- Core browser preflight: ten passing checks through creator, social/chat, refresh and independent context; the run then stopped on a Director selector issue. It is not represented as a complete suite pass.
- Frozen-main final focused pass at `http://localhost:3011`, 21:02:35–21:04:28 UTC: **8/8 checks passed**, zero page errors. This followed the earlier core run; the entire ten-check creator/social sequence was not rerun on the final HUD.
- Actual final images reviewed: `/tmp/hello-world-qa/final-browser/landing-desktop.png`, `director-studio.png`, `world-mobile.png`, `obs-overlay.png`. Machine-readable result: the same folder’s `browser-results.json`.
- Final overlay: 1920×1080; **1,806,257 clear pixels (87.11%)**, 190,409 opaque and 76,934 translucent; all four corner alpha values are zero. The follow target Nova is fully visible. Other nearby residents can extend beyond edges in this close follow view; this is distinct from the earlier unintentional framing defect.
- The critic independently parsed the earlier overlay PNG too: 94.549% fully transparent pixels, 73,636 opaque pixels, nonblank bounds and all four transparent corners.
- Runtime/browser evidence is documented in [QA.md](QA.md) and [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md). Software WebGPU probe limits are documented in [WEBGPU_PROBE.md](WEBGPU_PROBE.md).

Remaining limits: live Twitch delivery needs real credentials/consent and has not been tested; OBS desktop hosting and hardware GPU frame rates are unverified. Local server disk persistence is not managed distributed durability, and simulation requires a running host. One minor captured mobile copy defect (`YOU BELONGIN THE STORY`) needs a whitespace correction. No extra feature expansion is recommended before delivery; preserve the passing integrated build.

## Review basis

Review started 2026-11-02. Scores require a runnable application and recorded browser evidence. The initial scaffold is **unscored**; it is not evidence of completion.

| Category | Weight | Evidence required for a strong score |
| --- | ---: | --- |
| Product design and usability | 20% | The world is central; join/customize/interact are discoverable; state and errors are clear; mobile and keyboard flows remain usable. |
| Functional integration | 25% | Join, avatar save, social interaction, demo event, director action, refresh persistence, and two-session synchronization work through the same authoritative runtime. |
| Twitch and OBS experience | 20% | Demo/live status is truthful; capability/scopes are explicit; commands are normalized; overlay is transparent in both DOM and WebGL and exposes useful framing. Live operation is scored only if actually verified. |
| Performance and stability | 15% | Build/typecheck/tests pass; real browser has no critical runtime errors; repeated interactions and reconnects remain stable; loading/failure states are usable. |
| Character and world experience | 15% | Customization changes a visible resident, residents show life and social feedback, and neighborhood/camera composition supports viewing. |
| Overall delight | 5% | The experience feels like a living community product with memorable visual and interaction details. |

Weighted total = design × .20 + integration × .25 + Twitch/OBS × .20 + performance × .15 + world × .15 + delight × .05.

## Initial risks and inspection plan

- A successful join must make the viewer’s own resident identifiable, without relying on event-log text alone.
- Avatar customization must visibly survive saving and refresh.
- A social action must show who interacted with whom and a durable relationship or memory change.
- Approval and cooldown controls must explain blocked actions and resolve pending events predictably.
- Browser-source transparency needs pixel evidence from the rendered canvas, not only CSS inspection.
- Twitch capabilities must reflect actual token scopes and active subscriptions; simulated events must be labeled.
- Server and clients must share one authoritative state; refresh and a second browser session must preserve and display the same changes.

## Checkpoints

No runnable product has been reviewed yet. Scores, defects, evidence, and timed fixes will be added at first integrated and final checkpoints.

## Source review, before engine integration

The initial UI source used 4–9 px text for several meaningful labels, including mobile roster details and action controls. The critic and QA flagged readability as the highest-impact shell improvement. The Product Experience engineer added a readable final scale (core text/actions approximately 12–14 px, metadata approximately 10–11 px), stacked community cards on mobile, and added target names to social/gift history entries. These are source-confirmed changes; browser legibility and behavior remain to be verified.

## First scored checkpoint — real isolated product preflight

Reviewed 2026-11-02 at approximately 20:31 UTC, before release integration. This review uses actual browser images from the Codex UI/server connected to Claude engine checkpoint `854b5af`, plus reported passing build/typecheck and ten real runtime acceptance checks. It does not establish live Twitch operation, OBS desktop application behavior, or completion of the full viewer browser journey.

| Category | Score / 10 | Evidence and limits |
| --- | ---: | --- |
| Product design and usability | 8.2 | Actual landing and Director screenshots show a cohesive dark moss/lime system, strong hierarchy, prominent world, readable revised labels, clear Demo Mode, and discoverable creation/OBS entry points. Residents are difficult to identify at the default camera distance. |
| Functional integration | 7.0 | The actual server-fed scene renders seven residents, relationship counts, simulation activity, and event history. Ten runtime acceptance checks and the full build pass were reported. Join → creator → save → refresh and a second browser session were still undergoing browser verification at this checkpoint. |
| Twitch and OBS experience | 5.8 | Demo status and simulated raid labels are honest. Browser source removes app chrome and renders characters/effects. The captured overlay clips residents at the right/bottom, and the engine camera reportedly overrides the requested framing. Live Twitch and OBS desktop were not tested. |
| Performance and stability | 6.5 | Build/typecheck and server tests pass; real world and Director render. A prior browser journey stalled with the high-quality software-rendered scene, motivating low quality during creator/mobile use. No hardware production FPS claim is supported. |
| Character and world experience | 7.5 | The real neighborhood contains varied buildings, paths, fountain, gathering stage, trees, portal, lighting, and autonomous activity. Character scale is roughly 10–25 px in the 530 px default scene, hiding appearance and social detail. |
| Overall delight | 8.0 | The night lighting, portal, lively neighborhood and consistent copy create a distinctive community-world impression. A closer personal camera would make the promise more tangible. |

**Weighted provisional preflight score: 7.05 / 10** (rounded 7.1). This is a build/review checkpoint, not a final release rating.

### Highest-impact fixes

1. **Fit overlay residents into the frame and honor the camera query** — approximately 5–10 minutes. The actual OBS screenshot clips Bram at the bottom and places other residents at the extreme right. Correct the engine camera rather than hiding the defect with app chrome. Retest alpha plus nonblank rendered content, and at least neighborhood/follow framing.
2. **Select and follow the viewer’s own resident after an accepted join or avatar save** — approximately 3–5 minutes. A visible personal reveal connects the creator to the shared world and addresses the tiny default resident scale.
3. **Keep expensive background rendering low or paused while the creator is active** — approximately 3–5 minutes. The browser must remain responsive when entering a name, switching controls and saving. Measure with the available SwiftShader context and state that limit.
4. **Complete the browser acceptance journey** — approximately 8–12 minutes: join, visibly customize, social interaction with target feedback, Director event, persisted refresh, second-session synchronization, approval/cooldown errors, overlay alpha. Runtime assertions and screenshots alone do not prove this sequence.

Evidence images: `/tmp/hello-world-qa/real-world-preflight.png`, `/tmp/hello-world-qa/director-studio-actual.png`, `/tmp/hello-world-qa/obs-overlay-actual.png`. These are local preflight artifacts; no deployment, live stream, or OBS desktop recording is implied.

### Independent browser follow-up

The critic opened `/world?quality=low` in Chromium/SwiftShader. The page connected in approximately 4.6 seconds, produced no page errors, showed seven residents, eighteen relationships, changing autonomous activities and two connected sessions. The critic’s own valid world capture is `/tmp/hello-world-qa/critic-first-world.png`.

A Playwright `locator.click()` initially timed out while waiting for element stability. A subsequent normal coordinate mouse click opened the same Create resident modal in **109 ms**; filling the name and advancing to Character Studio succeeded. This is not evidence that a user click is broken. The creator DOM exposed body/proportions/skin, face features, twelve hair styles, outfit pieces/colour, accessories, traits, presets, expression and animation controls. The attempted creator screenshot did not reliably capture the modal during concurrent development, so no successful creator visual claim is based on that image. The critic closed its browser to give the acceptance suite exclusive software-GPU resources.

### Retest criteria after requested game-HUD restyle

A later user direction asks for a full-bleed game HUD, cut-corner panels, stronger condensed display typography and a bottom interaction dock. This visual change has not yet been scored. Its acceptance criteria are:

- The actual world remains the dominant view, with a legible personal/follow resident view.
- Create/join, camera, viewer actions/chat, Director and OBS controls remain discoverable and functional.
- Meaningful controls keep readable type and contrast; narrow screens stack or collapse panels rather than shrinking text.
- The bottom dock does not hide the active resident and presents real disabled, cooldown, approval and error state.
- No fabricated XP, currency, achievements or progression appears.
- Modal focus/Escape behavior and the name → creator → save sequence remain intact.

A visual restyle alone cannot raise functional integration, OBS or stability scores. Those require completed browser acceptance and corrected overlay framing, followed by a recorded retest.

### Confirmed integration blocker from QA

QA’s real Chromium hit-test probe found that the creator host did not supply a definite height: `.creator-content` was approximately 380 px, while `.hwc-root` and `.hwc-layout` collapsed to 0 px and `.hwc-panel` to approximately 2 px. A preset button had nominal bounds, but its center hit the host `DIV.creator-content` rather than the button. This is an actual pointer/customization blocker, distinct from Playwright’s earlier stability wait. The root engineer was alerted to correct the Codex host CSS.

Required retest: a normal pointer changes a preset or outfit colour, the preview visibly changes, Save Character joins/updates the authoritative resident, and the same appearance survives refresh. DOM text alone does not pass this check.

**Score update while this blocker remains:** functional integration 5.5/10 (previously provisional 7.0); other category scores unchanged. Weighted total **6.68/10**, rounded 6.7. This temporary score reflects the newly confirmed core customization defect and will be rescored after the actual pointer/save/persistence retest.

### Creator blocker retest — fixed

QA confirmed that the host-height correction gave the real creator a visible, loaded rig and usable layout. A normal pointer selected the Atlas preset and Save Character succeeded. The server’s authoritative snapshot contained the new viewer resident and the outfit hex colour matched the selected UI value. This recovers functional integration to at least the earlier provisional **7.0/10**, and the weighted checkpoint to **7.05/10**; social, refresh, multi-session, Director and overlay browser checks were still running at this update. The zero-height customization blocker is resolved by actual behavior, not merely by CSS inspection.

### Browser acceptance checkpoint — 20:48 UTC

The saved real-product browser result now records ten passing checks: viewer-only initial permissions, authoritative world load, 630 px creator host with a loaded rig, distinctive `#4aa3df` outfit selection reaching server state, actual viewer join through the creator, all five camera modes accepting changes without runtime errors, social friendship with Nova (67.4 at assertion), chat through the shared runtime, appearance plus relationship surviving reload, and an independent browser context receiving the same resident/relationship. No page errors were recorded. A console 404 remains to be identified. The run stopped locating the Director unlock control; Director and overlay checks were not completed in that run.

These results support the following provisional update: design **8.2**, integration **8.2**, Twitch/OBS **5.8**, stability **7.5**, character/world **8.0**, delight **8.0**. Weighted total **7.58/10**, rounded **7.6**. The requested HUD restyle and corrected overlay framing still require an actual connected visual/behavioral retest. Evidence: `/tmp/hello-world-qa/browser-preflight/browser-results.json`.
