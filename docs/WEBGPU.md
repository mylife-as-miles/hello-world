# WebGPU renderer work

WebGPU is a presentation backend. It uses the same authoritative world runtime, resident profiles, normalized events, and persisted snapshots as WebGL. WebGL remains the default and the compatibility fallback for browsers without a usable WebGPU device, including OBS Browser Source versions whose embedded browser does not expose WebGPU.

## Implemented renderer

Select **WebGPU · experimental** in the app’s OBS setup dialog, or add `?renderer=webgpu` to the world URL. The generated OBS URL preserves this selection. `renderer=auto` requests WebGPU where a usable adapter exists; WebGL is the default.

The world, transparent OBS route, and character studio now support the WebGPU renderer. All use the same authoritative runtime, residents, events, and saved state. Renderer changes do not reset or fork the world.

The Three 0.187 / React Three Fiber 9 integration initializes WebGPURenderer asynchronously. A requested backend is not counted as proof: the factory checks `renderer.backend.isWebGPUBackend`, reports the actual backend through `onRendererChange`, and marks the canvas with `data-renderer="webgpu"` or `data-renderer="webgl"`. Unsupported API/adapter/device configurations fall back to WebGL. Initialization/render errors and device loss remount a fresh WebGL canvas while keeping the same authoritative runtime.

The scene’s GLSL-only sky, water, fountain, portal and lighting effects use native/node compatibility materials on WebGPU. Weather, sparkles and confetti use capped CPU-updated instanced quads, preserving visible motion because WebGPU point primitives are fixed at one pixel. The adapter runs before the first renderer shader compilation, including for newly loaded avatars. It creates no game logic or simulation.

WebGPU visual parity remains experimental: custom shading and bloom differ from the WebGL presentation. WebGL-only bloom/postprocessing is disabled on WebGPU. Authored VRM MToon shaders use standard compatibility shading with the same meshes, maps, bones, expressions and morphs. The studio retains its direct lights and controls; its WebGL-only generated environment/contact-shadow helpers run only on the actual WebGL backend.

## Actual application verification

The built **main application** at `http://localhost:3011` was tested from **21:00:32 to 21:01:22 UTC on 2026-11-02**, using Chromium 154 with a genuine SwiftShader/Vulkan WebGPU adapter. This is software WebGPU, not a claim of hardware performance or a native OBS-host test.

- World canvas reported actual backend **webgpu** and rendered **24,023 sampled colors**.
- Character studio canvas reported actual backend **webgpu** and rendered a visible avatar preview with **5,166 sampled colors**.
- Transparent OBS route rendered **43,077 visible pixels** and **571,323 fully transparent pixels** in a 960 × 640 screenshot.
- **No uncaught page errors or shader/validation errors** occurred. The only console resource error was a missing favicon (404).

Evidence: [machine-readable results](webgpu-evidence/main-results.json), [world screenshot](webgpu-evidence/world.png), [studio screenshot](webgpu-evidence/studio.png), [transparent overlay](webgpu-evidence/overlay.png).

A separate default-Chromium check without a WebGPU adapter requested WebGPU and correctly reported actual backend **webgl**, reason **“No WebGPU adapter is available; using WebGL.”**, with no page errors. This fallback check ran in the isolated renderer harness at `http://localhost:5193`; it is recorded separately in [fallback results](webgpu-evidence/fallback-results.json).

## Browser probe evidence

Chromium 154 on this Linux cloud environment exposes `navigator.gpu`, but the default adapter request returns null. This correctly requires WebGL fallback; API presence alone is insufficient.

A real software WebGPU adapter/device/renderpass/readback and visible premultiplied-alpha GPU canvas were subsequently verified using Chromium SwiftShader/Vulkan. The research probe is documented separately in [WEBGPU_PROBE.md](WEBGPU_PROBE.md). The subsequent complete Three scene/studio/overlay test is recorded above.

No native OBS application was installed or tested. OBS WebGPU support depends on its embedded Chromium build, driver, and launch configuration. The browser source must remain usable through WebGL where WebGPU is unavailable.

## Reproduce the renderer smoke check

With the built app running, execute:

```sh
WEBGPU_TEST_BASE=http://localhost:3011 pnpm test:webgpu
```

The script imports the repository’s declared Playwright dependency. It uses `WEBGPU_BROWSER_PATH` (or `QA_BROWSER_PATH`), system Chromium when present, or Playwright’s installed browser. Install the latter with `pnpm exec playwright install chromium` if needed. `WEBGPU_EVIDENCE_DIR` selects the report/screenshot directory; the default is the system temporary directory under `hello-world-webgpu-evidence`.

This check **requires a genuine usable WebGPU adapter** and fails when the application falls back to WebGL. Normal production fallback remains correct behavior; it is not sufficient to pass this GPU-specific test. The test measures the actual canvas backend, rendered world/studio pixels, transparent overlay pixels, and page/shader/validation errors.

On Linux, if `/usr/lib/chromium/vk_swiftshader_icd.json` exists, the script automatically uses the software WebGPU flags and process-local Vulkan ICD settings verified here. Use `WEBGPU_USE_SOFTWARE=0` to test the browser’s native adapter instead, `WEBGPU_USE_SOFTWARE=1` to require software mode, or `WEBGPU_SWIFTSHADER_ICD` for another installed ICD path. These flags belong to the test browser, not the app or OBS configuration.

The portable repository script preserves the successfully executed renderer checks above; its portability changes were syntax-checked without starting another GPU browser during final regression testing.

## Primary references

- [React Three Fiber: WebGPU renderer initialization](https://r3f.docs.pmnd.rs/api/canvas#webgpu)
- [Three WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Three node materials](https://threejs.org/docs/pages/NodeMaterial.html)
- [Three PointsNodeMaterial: WebGPU point-size limitation](https://threejs.org/docs/pages/PointsNodeMaterial.html)
- [WebGPU secure contexts and browser API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)

The screenshots and reports above are actual renderer evidence. Native OBS integration and hardware-driver performance still require testing on the target streaming machine.


## Round-9 integration regression — 2026-11-03

The initial actual-WebGPU run rendered nonblank pixels but raised repeated exceptions: a new photoreal-hair draw hook accessed WebGL's `renderer.state.buffers` on the real GPU backend. Commit `661cd57` limits that alpha-write workaround to WebGL. The regression test exercises the actual photoreal mesh hooks with a backend lacking WebGL state and confirms that legacy alpha masking still runs on WebGL.

After the fix, world, studio and overlay all render through the actual software WebGPU backend, with no page or console errors. World: 31,792 sampled colors. Studio: 5,394. Overlay: 554,566 clear and 59,834 visible pixels of 614,400. [Final measurements](webgpu-evidence/round9/results.json). [Initial failure and stacks](webgpu-evidence/round9/before-fix-results.json). Hardware performance and native OBS WebGPU remain unverified.
