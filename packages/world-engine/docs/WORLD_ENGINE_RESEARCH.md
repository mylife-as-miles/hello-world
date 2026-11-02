# World engine research: avatars, assets, AI, performance

Research scout notes for `@hello-world/world-engine` (React 19, R3F 9, drei 10, three 0.187,
@pixiv/three-vrm 3.5, dexie 4). Compiled 2026-11-02. Each licence claim names its source.
"Verified" means I read the licence file, the catalog entry, or the metadata inside the file
myself. Nothing in this document was downloaded into the repo, and none of it is legal advice.

## 1. Decision summary

| Area | Decision for the current slice | Later / trigger to revisit |
|---|---|---|
| Resident bodies | Keep the procedural Townie rig and the VRM adapter behind `HumanoidRig` (`src/avatars/rig.ts`). | A parametric morph base built offline with MPFB2 (§5, §11). |
| Third-party VRMs | Optional. Ship up to about 5 verified **CC0 100Avatars** VRMs (about 1–1.2 MB each), copied into local assets with a CREDITS entry. Use them as "guest skins", not as the core look. | Add an in-app catalog browser over open-source-avatars, filtered to CC0 entries and checked per file. |
| CharacterStudio | Use the concepts only: slot manifest, culling layers, atlas/merge at export. **Copy none of its assets.** | A trait/wearable manifest module (§11). |
| Body animation | Procedural poses through `HumanoidRig`. Ship no VRMA files for now. No verified CC0 VRMA pack exists. | Retarget Quaternius **UAL (CC0)** clips offline and save them as `.vrma`. |
| Pathfinding | Keep the deterministic waypoint graph + A* in `layout.ts`. | Server-side `recast-navigation-js` for dynamic obstacles, free movement, or crowd avoidance. |
| Resident AI | Deterministic utility AI in the server simulation. Templated dialogue. | An optional `DialogueProvider` backed by an LLM that writes text only (§8). |
| Physics / controller | None. No Rapier, no ecctrl. | ecctrl once a viewer can directly control an avatar. |
| Environment art | Kenney CC0 kits. Prefer the official kenney.nl zips; the tge-assets GLB mirror is also CC0. | — |
| MetaHuman | Reference only. | — |
| Performance | DPR `[1, 1.5]` (OBS: 1 at 30 fps), one shadow-casting light, blob shadows under avatars, instanced props, two-level avatar LOD. | Impostors, a KTX2 + meshopt pipeline, BatchedMesh. |

## 2. M3-org CharacterStudio

**What it is.** A web VRM avatar builder (three.js/WebGL; React optional since the logic moved
into a `CharacterManager` class). Features: point-and-click traits, drag-and-drop VRMs and
textures, colour picker, GLB/VRM/screenshot export, and a one-click optimiser that merges skinned
meshes and atlases textures (it can reach a single draw call). It also has batch/random export
against metadata schemas and face culling through a custom layer system.
[Repo](https://github.com/M3-org/CharacterStudio) ·
[docs](https://m3-org.github.io/characterstudio-docs/) ·
[demo](https://m3-org.github.io/CharacterStudio/) ·
upstream [webaverse/characterstudio](https://github.com/webaverse/characterstudio)

**Composition model** (read from the live manifests):

- A root `manifest.json` lists `characters[]`, each with `name`, `portrait`, `manifest` (a path)
  and `format: "vrm"`. It also lists `defaultAnimations[]` (FBX), `loras`, `sprites` and
  `thumbnails`.
- Each per-character manifest has these top-level keys: `assetsLocation`, `traitsDirectory`,
  `exportScale`, `animationPath`, `defaultCullingLayer`, `defaultCullingDistance`,
  `requiredTraits`, `initialTraits`, `randomTraits`, `colliderTraits`, `offset`, `traits[]`,
  `textureCollections[]` and `colorCollections[]`.
- Each trait is a slot (`Body`, `Head`, `Hands`, `Shoes`, `Chest`, `Neck`, `Weapon`, `Waist`).
  It carries `cullingLayer`, `cullingDistance`, `cameraTarget {distance, height}`, an SVG icon,
  and `collection[]` items of the form `{id, name, directory: "Chest/x.vrm", thumbnail}`.
- **Every wearable is its own VRM rigged to the same skeleton.** The studio binds wearables to
  the base skeleton, hides body faces covered by higher culling layers, and on export merges and
  atlases everything into one VRM.
- Example manifest:
  [anata/female/manifest.json](https://github.com/m3-org/loot-assets/blob/main/anata/female/manifest.json).

**Licences.** The code is **MIT**, verified in
[LICENSE](https://github.com/M3-org/CharacterStudio/blob/main/LICENSE) ("Copyright (c) 2022
Atlas Foundation"). The asset packs are separate repositories, and the MIT code licence does not
cover them:

| Companion pack | What it contains | Licence found |
|---|---|---|
| [m3-org/loot-assets](https://github.com/m3-org/loot-assets) (the app needs it in `public/`) | Base characters and wearables for **Anata**, **0N1 Force** and **Tubby Cats**, plus Loot-inspired items | **No LICENSE file and no licence statement in the README.** The characters come from third-party NFT projects with their own IP terms. Only Tubby Cats is mentioned anywhere as CC0, and only in secondary sources. |
| [memelotsqui/character-assets](https://github.com/memelotsqui/character-assets) (fork of webaverse-studios/character-assets) | Loot-themed `drophunter` and `neurohacker` sets, plus `manifest.json` and `personality.json` | **No LICENSE file.** |

> **Red flag:** treat every CharacterStudio asset pack as all rights reserved. Use the MIT code
> or ideas only, with attribution if code is copied. Do not copy any `.vrm`, `.fbx`, texture or
> thumbnail from these repos.

**What we can borrow as concepts.** `AvatarAppearance` identifiers already act as slot choices.
A future wearable system can reuse:

1. a JSON manifest of slots, collection items, culling layers and restricted-trait pairs;
2. wearables that share one humanoid skeleton;
3. culling of body faces under clothing, which avoids z-fighting;
4. mesh merging plus a texture atlas when saving a finished avatar, for one draw call per resident.

## 3. pixiv three-vrm v3 (installed 3.5.5 per node_modules, which is the npm latest; MIT)

All facts below are checked against the docs or the source on the `dev` branch. That includes
`springBoneManager.reset()`, `firstPerson.setup()`, `lookAt.target` and `lookAt.lookAt(v)`.

- **Normalized humanoid bones.** `vrm.humanoid.getNormalizedBoneNode(name)` returns a proxy whose
  rest pose has an identity rotation. `getRawBoneNode` returns the model's own bone. Normalized
  poses copy to the raw bones during `vrm.update(dt)` / `humanoid.update()` unless
  `humanoid.autoUpdateHumanBones = false`. VRM 1.0 allows one node per bone, so
  `getBones`/`getBoneNodes` were removed.
  [Migration guide](https://github.com/pixiv/three-vrm/blob/dev/guides/migration-guide-1.0.md)
- **Orientation.** VRM 0.x faces −Z and VRM 1.0 faces +Z. `VRMUtils.rotateVRM0(vrm)` rotates
  `vrm.scene` 180° about Y, and only for VRM 0.x.
- **Retargeting onto VRM 0.x.** When `vrm.meta.metaVersion === '0'`, the official code negates
  the quaternion **x and z** components (`i % 2 === 0`) and the hips position **x and z**
  (`i % 3 !== 1`, scaled by the ratio of hips heights). Sources:
  [createVRMAnimationClip.ts](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-animation/src/createVRMAnimationClip.ts) and
  [loadMixamoAnimation.js](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js).
  Our `rig.ts` already uses the VRM 1.0 normalized frame and makes the VRM0 adapter convert
  internally, which matches this.
- **`expressionManager` presets** ([VRMExpressionPresetName](https://pixiv.github.io/three-vrm/docs/variables/three-vrm.VRMExpressionPresetName.html)):
  `aa ih ou ee oh blink blinkLeft blinkRight happy angry sad relaxed surprised neutral lookUp
  lookDown lookLeft lookRight`.
  - VRM0 blend shapes are renamed on load
    ([v0v1PresetNameMap](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-core/src/expressions/VRMExpressionLoaderPlugin.ts)):
    `a→aa, e→ee, i→ih, o→oh, u→ou, joy→happy, sorrow→sad, fun→relaxed, blink_l→blinkLeft,
    blink_r→blinkRight, lookup→lookUp …`.
  - VRM0 has no `surprised` preset.
  - `setValue` on a missing expression is a no-op. Check `getExpression(name)` first so the
    code can fall back.
- **[VRMUtils](https://pixiv.github.io/three-vrm/docs/classes/three-vrm.VRMUtils.html)**:
  - `removeUnnecessaryVertices(root)` cuts morph-texture VRAM.
  - `combineSkeletons(root)` merges skeletons so fewer bone matrices are computed. It replaces
    `removeUnnecessaryJoints`, which is deprecated and will be removed in the next major version.
  - `combineMorphs(vrm)` merges morphs per expression, which avoids morph-limit crashes on mobile.
  - `deepDispose(obj)` disposes geometry, materials and textures.
  - `rotateVRM0(vrm)` is described under Orientation above.
  - Recommended order after load: `removeUnnecessaryVertices → combineSkeletons →
    (combineMorphs) → rotateVRM0`. On unmount, call `deepDispose(vrm.scene)`.
- **lookAt.** `vrm.lookAt.target = object3D`, or call `lookAt.lookAt(position)`. The applier is
  either bone (rotates the eye bones) or expression (lookUp/Down/Left/Right weights). If a model
  has **no eye bones**, the bone applier does nothing, so turn the head instead (see §4).
- **Spring bones** run on the CPU inside `vrm.update(dt)`. Cost grows with joints × colliders.
  For crowds, update them only at the near LOD, and call `springBoneManager.reset()` after a
  teleport so hair doesn't fly. Scaled models need care
  ([guide](https://github.com/pixiv/three-vrm/blob/dev/guides/spring-bones-on-scaled-models.md)).
- **VRMA** is a glTF file with the `VRMC_vrm_animation-1.0` extension
  ([spec](https://github.com/vrm-c/vrm-specification/tree/master/specification/VRMC_vrm_animation-1.0)).
  It carries humanoid rotations, hips translation, expression weights and lookAt.
  `@pixiv/three-vrm-animation` (3.5.5, MIT) provides `VRMAnimationLoaderPlugin` and
  `createVRMAnimationClip(vrmAnimation, vrm)`, which returns a normal `THREE.AnimationClip`.
- **CC0 VRMA motions: none verified.**
  - VRoid's free 7-motion `.vrma` pack ([news](https://vroid.com/en/news/6HozzBIV0KkcKf9dc1fZGW),
    [BOOTH](https://vroid.booth.pm/items/5512385)) defers to its BOOTH terms. It is **not CC0**;
    do not bundle it.
  - The best CC0 source is Quaternius's **Universal Animation Library**: CC0, 45 free clips
    including 8-way locomotion, sitting and emotes, on a universal humanoid rig with a
    Mixamo-compatible option ([itch](https://quaternius.itch.io/universal-animation-library),
    [OGA](https://opengameart.org/content/universal-animation-library)). **UAL 2** (CC0,
    January 2026) adds farming, fishing and more
    ([OGA](https://opengameart.org/content/universal-animation-library-2)).
  - Pipeline: retarget offline in Blender (VRM Add-on for Blender) to a VRM humanoid, then save
    as `.vrma`, or bake to JSON keyframes for our canonical frame.

## 4. Open Source Avatars registry and 100Avatars (Polygonal Mind)

**Registry.** [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars)
(site: opensourceavatars.com). The registry data, docs and integration code are **CC0**, verified
in [LICENSE](https://github.com/ToxSam/open-source-avatars/blob/main/LICENSE). That file says
avatars carry **per-collection** licences, listed in `data/projects.json`.

- [`data/projects.json`](https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data/projects.json)
  holds collections with `license`, `storage_type` (arweave/ipfs/github) and `avatar_data_file`.
- `data/avatars/<collection>.json` holds entries with `model_file_url` (a direct VRM link),
  `thumbnail_url`, `format: "VRM"`, and `metadata.alternateModels` (`fbx`, `voxel_vrm`,
  `voxel_fbx`).
- Licences per collection: 100Avatars R1/R2/R3 are **CC0** (arweave). Grifters Squaddies,
  ToxSam, Halloween Rising, Xmas Chibis and NeonGlitch86 are listed as CC0 (NFT collections on
  IPFS). **VIPE Heroes Genesis is CC-BY**, so attribution is required.
- Always read the VRM `meta` licence of each file as well. Community threads report VRMs whose
  embedded licence disagrees with the listing.

**Evidence that 100Avatars are CC0.** I checked two things:

1. `projects.json` lists `"id": "100avatars-r1", "license": "CC0", "creator_id": "Polygonal-Mind",
   "storage_type": "arweave"`.
2. The embedded VRM 0.0 meta of every file below, read from the GLB JSON chunk with an HTTP
   range request (2026-11-02), says `licenseName: "CC0"`, `author: "Polygonal Mind"`,
   `commercialUssageName: "Allow"`, `allowedUserName: "Everyone"`.

**Technical profile** (checked on 7 files; 60 of 100 R1 sizes measured):

- Format: **VRM 0.0**, exported with the saturday06 Blender VRM exporter 2.4.8.
- Geometry: 1 mesh, 1 primitive, 1 MToon material and 1 texture each, so **one draw call**.
  2.1–3.8 k triangles.
- Size: average about 1.78 MB, range 0.95–9.1 MB (055 Fungus is the outlier).
- Spring bones: **none**, so they cost nothing to simulate.
- lookAt type is Bone, but **there are no eye bones**, so turn the head to show gaze.
- 31 humanoid bones. Fingers have proximal bones only. Some models lack `leftToes` (Polybot has
  only `rightToes`). Our rule that missing bones are ignored is required.
- **Expressions: only visemes `aa/ee/ih/oh/ou` plus `blink`.** 001 Crimsom has only
  `blinkLeft/blinkRight`. There is **no happy/sad/angry/surprised/relaxed**, so show emotion
  through posture, emote icons and bubbles. Blink must fall back to `blinkLeft` + `blinkRight`.
- Style: chunky low-poly characters (a cactus, a banana, a coffee cup). They are fun as viewer
  "guest skins". They do **not** reach the inZOI-style look.

**Verified CC0 VRM URLs (smallest measured).** `arweave.net` answers with a 302 to a gateway
subdomain and serves `application/octet-stream`.

| # / name | Direct URL | Bytes | Tris | Expressions |
|---|---|---|---|---|
| 051 Polybot | https://arweave.net/DUR8v-IugXppdMBxPdE1rDO2dZCJJ7ZgBTXSRgPJFNo | 997,048 | 2,130 | aa ee ih oh ou blink |
| 077 WeirdFlexButOk | https://arweave.net/SLR0PvjqsNa3K_Mj9hXYFdA6v0tn92tZuhDShd2ggaI | 1,027,928 | 2,960 | same |
| 027 Astrodisco | https://arweave.net/uS4wvZn6sURMWJuwWzWnCqGaqDtZSiQQdTwci0f6hmM | 1,033,356 | 2,724 | same |
| 012 Chill | https://arweave.net/JCzmV7mgqDGNDu8YkdSMeJApOA09CCL2i71BqvJKCVs | 1,124,256 | 3,536 | same |
| 080 Coffee | https://arweave.net/JxV2leixFtpOsscIyelJzK6OSA84hnyrWZs7LAMfU8c | 1,172,848 | 3,496 | same |
| 007 Observer | https://arweave.net/bDb0wMAxPHGbhirVjHi-7GF1QL6HrwD8SuKFEF5Sx2M | 1,200,564 | 2,968 | same |
| 001 Crimsom | https://arweave.net/DUHQfXxfFPjlMzBoCyYD0Kuz7vwD7eZkT-9eOIJByzY | 1,652,200 | 3,776 | aa ee ih oh ou blinkLeft blinkRight |

Rules for using these files:

- The brief bans runtime CDN fetches, so **vendor the files locally**.
- Record the source URL, the sha256, "CC0 1.0, Polygonal Mind 100Avatars", and the
  registry/meta evidence in the asset folder's CREDITS file.
- Keep the total under the 15 MB budget, which allows about 5–8 avatars.

## 5. MakeHuman / MPFB2

**Licences** (verified in the
[MPFB2 LICENSE.md](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md) and the
[MakeHuman licence page](https://static.makehumancommunity.org/about/license.html)):

- **MakeHuman app code: AGPL.** **MPFB2 code: GPLv3.**
- **Assets are CC0.** That covers the base mesh, proxies, targets/modifiers, textures, MHCLO
  clothes, rigs, poses, expressions and JSON mesh data.
- **Output:** the team "makes no claim whatsoever" over exports (FBX/OBJ/DAE/MHX2…), renders or
  saved models. They are "your data", and since the assets are CC0, there is no limit on the
  combined output. Selling models is explicitly allowed
  ([FAQ](https://static.makehumancommunity.org/mpfb/faq/can_i_sell_models.html)).
- MPFB 2.x needs **Blender ≥ 4.2**.

**Offline pipeline** for future high-detail humans with shape keys:

1. In MPFB2, generate the base human with the game-engine rig, a low-poly proxy, eyes, eyebrows
   and a few MHCLO clothes.
2. Keep a **curated set of 10–30 targets as shape keys**: height/weight/muscle/age/proportions,
   plus a few face sliders.
3. Use the VRM Add-on for Blender to map the humanoid bones and add expressions (MPFB's CC0
   expression poses can be baked into shape keys). Export **VRM 1.0**, or GLB.
4. Validate, then compress (§10).
5. In the browser, drive `morphTargetInfluences` from the `AvatarAppearance` sliders.

**Why not embed MakeHuman/MPFB in the browser:**

- The code is AGPL/GPL, so linking it into our app would trigger copyleft duties.
- It depends on Python and Blender.
- The full target library is hundreds of MB.
- Pre-baking a small set of CC0 targets gives the same creator experience at a fraction of the
  size.

## 6. MetaHuman → reference only

- Since **UE 5.6 (June 2025)**, MetaHuman Creator, Mesh to MetaHuman and MetaHuman Animator ship
  inside Unreal Engine under the **standard UE EULA**.
- Epic now allows MetaHuman characters and animations in other engines (Unity, Godot) and their
  sale on Fab ([CG Channel](https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/)).
- The old cloud MetaHuman Creator EULA still governs UE ≤ 5.5 users
  ([Epic EULA page](https://www.unrealengine.com/eula/mhc)).
- The DNA calibration tooling ([EpicGames/MetaHuman-DNA-Calibration](https://github.com/EpicGames/MetaHuman-DNA-Calibration))
  lives in Epic's GitHub org, and its README doesn't state a public licence.
- **Practical verdict:**
  - The licence still ties creation to Unreal/Epic terms.
  - The assets are 100 k+ triangles with LOD chains, strand or card grooms and RigLogic facial
    rigs, which is wrong for a browser crowd or an OBS source.
  - The rig is not a VRM humanoid.
  - Use MetaHuman only as a visual reference for proportions and skin shading. Ship nothing
    exported from it.

## 7. Kenney CC0 kits and tge-assets

**Kits** (kenney.nl pages show CC0):

- [City Kit Suburban](https://kenney.nl/assets/city-kit-suburban): v2.0 "completely remade",
  about 40 files.
- [Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit): v2.0, about 160 files.
- [Furniture Kit](https://kenney.nl/assets/furniture-kit)
- [Nature Kit](https://kenney.nl/assets/nature-kit)
- [City Kit Roads](https://kenney.nl/assets/city-kit-roads)
- Also Mini Characters and Blocky Characters.
- How to get them: download the official zip from each page. Recent Kenney 3D kits typically
  ship GLB/FBX/OBJ folders, but I didn't check each zip. Copy only the GLBs we use into our asset
  folder with a CREDITS line. Credit is appreciated but not required.

**[Hidencod/tge-assets](https://github.com/Hidencod/tge-assets)** is a mirror. Its
[LICENSE](https://github.com/Hidencod/tge-assets/blob/main/LICENSE) states that all models are by
Kenney under **CC0 1.0**, and that the converted GLBs (textures embedded) and the thumbnails are
also CC0.

- The catalog is at `https://hidencod.github.io/tge-assets/catalog.json` with fields `file`,
  `size` and `thumb`.
- Models are at `packs/<pack>/<model>.glb`, for example
  `https://hidencod.github.io/tge-assets/packs/city-kit-suburban/building-type-a.glb`, which
  returns 200 `model/gltf-binary`.

| Pack (mirror) | Models | Total size |
|---|---|---|
| city-kit-suburban | 40: building-type-a…u, driveways, fences, paths, planter, trees | 3.08 MB |
| furniture-kit | 140: benches, chairs, desks, bookcases, lamps… | 1.96 MB |
| nature-kit | 329 | 3.03 MB |
| city-kit-roads | 95: road pieces, street lights, construction props | 2.66 MB |

Caveats:

- **Fantasy Town Kit is not in the mirror.**
- Each mirror GLB embeds its own copy of its texture. Dedupe textures (gltf-transform `dedup`)
  if we merge many.
- Prefer the official zip for provenance. The mirror is fine licence-wise.

## 8. Navigation and resident AI

| Option | Facts | Fit |
|---|---|---|
| **Our waypoint graph + A*** (`layout.ts`) | Deterministic, Node-safe, no dependencies, tiny. Matches 2 Hz server snapshots with renderer interpolation. | **Keep for this slice.** |
| [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) | MIT, 0.44.0 (Oct 2026). A WASM port of Recast/Detour (`@recast-navigation/wasm` is about 2 MB unpacked). Needs `await init()`. Solo/tiled navmesh plus TileCache for temporary obstacles. **Crowd** gives local avoidance. Off-mesh links. Navmesh import/export. Works in Node and in workers. | Revisit for free-form movement, dynamic obstacles (Twitch-spawned props blocking paths) or dense crowds at a concert. Run it **on the server**; the renderer still reads snapshots only. |
| [Yuka](https://github.com/Mugen87/yuka) | MIT. Steering, state- and goal-driven agents, fuzzy logic, navmesh/graph search, perception with memory. **Last npm release 0.7.8 (Sep 2022).** | Use as a source of patterns (goal arbitration, memory decay). Don't take it as a dependency. |

**[a16z-infra/ai-town](https://github.com/a16z-infra/ai-town).** The code is MIT. Its art is
credited to separate OpenGameArt and itch creators, so those licences differ. Architecture, from
[ARCHITECTURE.md](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md):

1. **The engine is the only thing that changes game state.** Humans and agents submit **inputs**
   to a table. The engine applies them in order, checks invariants, and records each result.
2. `Game.tick(now)` runs at 60 ticks/s inside **steps** that run about once per second (load
   state → many ticks interleaved with inputs → save a diff).
3. **Historical buffers** carry within-step positions so clients can replay motion smoothly.
4. Agents combine **rule-based logic with LLM calls**. The LLM calls run in async Convex
   *actions* outside the engine and come back only as inputs.
5. Memories are embeddings with vector search (`NUM_MEMORIES_TO_SEARCH`).
6. Conversations move through `invited → walkingOver → participating`.
7. Paper: [Generative Agents (Park et al. 2023)](https://arxiv.org/abs/2304.03442).

**Why LLMs must not own state:**

- Latency (seconds), cost, and non-determinism (no replay or tests).
- Prompt injection through Twitch chat.
- Moderation.
- Outages.
- They invent positions and items that the world can't validate.

**Recommendation:**

1. **Deterministic utility AI on the server.** Score each candidate activity as
   `need deficit × personality weight × time-of-day curve × distance penalty × relationship/memory
   bonus`. Add commitment (hysteresis), cooldowns and a seeded RNG. Emit contract `WorldEvent`s
   with `source: 'simulation'`.
2. **An optional `DialogueProvider` interface**, for example
   `generate(ctx) → Promise<{ text; sentiment?: 'positive'|'negative'|'neutral' }>`:
   - The default is a template or grammar provider.
   - An LLM provider is allowed **only to produce text plus a bounded enum**, and must have a
     timeout with fallback to the template, rate and budget limits, moderation, and sanitised
     chat input.
   - The engine validates the result and records it as an event.
   - The renderer never calls an LLM.

## 9. Character controller and physics

**[ecctrl](https://github.com/pmndrs/ecctrl).** MIT, v2.0.2 (Sep 2026). A floating rigid-body
controller (shape-cast ground probe with spring and damping, moving platforms) plus
`EcctrlAnimationStateController` for IDLE/WALK/RUN/JUMP states. It needs
**@react-three/rapier** (2.2.0; peers are React 19 and Fiber 9) and
**@dimforge/rapier3d-compat** (Apache-2.0, 0.21.0, about **15 MB unpacked** because the compat
build inlines the WASM).

**When it is worth it:** a viewer or streamer drives one avatar directly (WASD or joystick, jumps,
collisions with props, physics toys).

**This slice: do not add it.**

- Residents are server-authoritative.
- Client physics would diverge from the snapshots.
- The WASM download and init slow first paint, including in OBS.
- Use kinematic interpolation along the path plus procedural gait and foot bob.

## 10. Performance

**Draw calls**

- Share materials across the environment.
- Use `InstancedMesh` for repeated props: trees, fences, lamps, benches, flowers.
- Use three's `BatchedMesh` for varied static props, which renders them in one multi-draw.
- A 100Avatars VRM costs one draw call. The procedural rig should aim for 3 or fewer.

**Avatars** (skinned meshes can't be instanced natively):

- **High LOD:** full rig, expressions, springs, lookAt.
- **Low LOD:** no expressions or springs, and the pose updates every second frame.
- **Beyond about 30 residents:** add billboard **impostors**, meaning a few view angles baked
  into an atlas.
- `AvatarLod 'high'|'low'` already exists.
- Call `VRMUtils.combineSkeletons` and `removeUnnecessaryVertices` after loading.

**VRM file optimisation.**

> **Gotcha:** plain `gltf-transform optimize` and `gltfpack` do not know the VRM extensions and
> can strip them, which breaks humanoid mapping, expressions and MToon
> ([meshoptimizer #198](https://github.com/zeux/meshoptimizer/issues/198)).

- Use [vrm-transform](https://github.com/mrxz/vrm-transform) (MIT, a work in progress, **VRM 1.0
  only**). It provides combineSkins, pruneMorphTargets, pruneVrmVertexAttributes and KTX2
  compression; keep NORMAL for MToon.
- VRM 0.x files (all 100Avatars) must either be converted to 1.0 first or shipped unmodified.
  At about 1 MB each, shipping them unmodified is fine.
- If KTX2 or meshopt is used, **vendor the decoders locally** (no CDN).

**Shadows**

- Use one directional shadow light with a 1024–2048 map and a tight frustum fitted to the town.
- Under avatars, use blob shadows (a transparent radial decal) or a single
  `ContactShadows frames={1}` for static props.
- Don't cast shadows from small props.

**DPR and OBS**

- Use `<Canvas dpr={[1, 1.5]}>` with drei `PerformanceMonitor`/`AdaptiveDpr` to drop resolution
  under load.
- In the OBS Browser Source, use 1920×1080 at **30 fps** ("Use custom frame rate"), DPR 1, and
  "Shutdown source when not visible". See the [OBS KB](https://obsproject.com/kb/browser-source)
  and `docs/RESEARCH.md` §OBS.
- At DPR 1, prefer FXAA/SMAA in postprocessing over MSAA at high DPR.
- Allocate nothing per frame.

## 11. Future engine modules

| Module | Integration notes |
|---|---|
| **WebXR** | [@react-three/xr](https://github.com/pmndrs/xr) v6 (6.6.32; npm licence field reads "SEE LICENSE IN LICENSE", so check that file): `createXRStore()` + `<XR store>`. VRM first person: `vrm.firstPerson.setup()` with layer masks to hide the head. Teleport onto nav-graph nodes, snap turning. Never in the OBS view. |
| **Multiplayer (Colyseus)** | [@colyseus/sdk](https://docs.colyseus.io/) 0.18.9, MIT. A room owns one `createWorldRuntime`. Clients send validated inputs (the ai-town model), and the room broadcasts snapshots or schema patches. See `docs/RESEARCH.md` for the transport decision. |
| **World-to-world portals** | Reuse the **Vibe Jam portal convention** ([vibejam.com](https://vibejam.com/)). On exit, redirect to the hub with `username`, `color`, `speed`, `ref` (plus optional `avatar_url`, `team`, `hp`, `speed_x/y/z`, `rotation_x/y/z`). On arrival, `portal=true` means spawn instantly with no loading screen, and add a return portal to `ref` that passes the parameters back. Our `portal` POI plus a Twitch **raid** event could let a community visit another streamer's world, with `avatar_url` pointing at a CC0 VRM. For in-world content interop, see [OMI glTF extensions](https://github.com/omigroup/gltf-extensions) (`OMI_spawn_point`, `OMI_seat`, `OMI_physics_*`). `OMI_link` is not in the current extension list. |
| **Parametric morph pipeline** | Use MPFB2's CC0 targets offline to bake a VRM 1.0 base with 10–30 shape keys (§5). The creator sliders drive `morphTargetInfluences`. Keep morph counts modest for WebGL and run `combineMorphs`. Skin tone comes from the MToon colour tint. Size and position wearables per morph with offsets or extra shape keys. |
| **Animation library** | Retarget Quaternius UAL/UAL2 (CC0) clips to `.vrma`. Add an `AnimationMixer` per high-LOD avatar and layer procedural additive motion (breathing, lookAt). Apply the VRM0 sign flips from §3. |
| **Wearables / traits** | A manifest modelled on CharacterStudio (slots, culling layers, restricted traits). Merge and atlas on save. All parts must be CC0 or our own. |
| **Navmesh service** | Server-side recast-navigation-js. Bake the navmesh from layout colliders at boot and use TileCache obstacles for spawned props. Crowd avoidance runs at the simulation tick. |
| **Dialogue provider** | The `DialogueProvider` interface from §8, with template and LLM back ends, moderation, budget, and caching. |
| **Asset pipeline CLI** | gltf-transform plus vrm-transform, with meshopt/KTX2 and vendored decoders. It also generates `CREDITS.json` (SPDX id, source URL, sha256, author, evidence link) and fails CI when an asset has no CC0/MIT/CC-BY record. |

## 12. Risks

1. **Licence contamination.**
   - CharacterStudio asset packs have no licence and contain NFT IP.
   - VRoid's VRMA pack is not CC0.
   - Mixamo clips: redistributing raw files is generally restricted (check Adobe's terms before
     use).
   - ai-town's art has separate licences.
   - VIPE Heroes is CC-BY.
   - Mitigation: read the embedded VRM `meta` for every file and record it in CREDITS.
2. **Runtime fetches from arweave/IPFS** are slow, can disappear (gateways), and are banned by the
   brief. Vendor files and pin their sha256.
3. **Style mismatch.** 100Avatars are low-poly novelty characters, not inZOI-like. Keep the
   procedural rig as the primary look and offer VRMs as optional skins.
4. **Missing expressions and bones** in third-party VRMs (no emotions, no eye bones, missing
   toes). The adapter must degrade gracefully, which `rig.ts` already requires.
5. **VRM0 vs VRM1 handling.** Facing direction and the x/z sign flips. Bugs here show up as
   backwards or mirrored poses.
6. **Optimisers stripping VRM extensions.** Never run a generic glTF optimiser on `.vrm` files.
7. **WASM cost** (Rapier, Recast) and CPU springs in OBS. Defer both, and keep spring bones at
   the near LOD only.
8. **LLM risks.** Latency, cost, injection through chat, and moderation. LLMs produce text only,
   the engine validates, and templates are the fallback.
