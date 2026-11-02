# WebGPU renderer work

WebGPU is a presentation backend. It uses the same authoritative world runtime, resident profiles, normalized events, and persisted snapshots as WebGL. WebGL remains the default and the compatibility fallback for browsers without a usable WebGPU device, including OBS Browser Source versions whose embedded browser does not expose WebGPU.

## Implementation plan and status

At 2026-11-02 20:47 UTC, the renderer patch was applied after Codex merged the explicit v1 engine handoff. Actual renderer browser verification is still pending; application of source code is not a claim that the complete WebGPU scene has passed.

The Three 0.187 / React Three Fiber 9 integration initializes WebGPURenderer asynchronously. A requested backend is not proof of the actual backend: Three can instantiate WebGPURenderer and internally use WebGL2. The implementation must report `renderer.backend.isWebGPUBackend` and mark the actual canvas backend for browser checks.

The current scene uses GLSL ShaderMaterial effects for sky, water, fountain spray, weather, portal, sparkles, and confetti, plus GLSL material hooks and WebGL postprocessing. These cannot be enabled unchanged on WebGPU. The planned compatibility path uses native/node materials and capped CPU-updated instanced quads for particle effects. This keeps the same scene graph, avatar animation, world events, and gameplay; it does not create a second simulation. WebGL bloom/postprocessing is disabled on the WebGPU path. Authored VRM MToon shaders use standard compatibility shading while keeping the same meshes, maps, bones, expressions, and morphs.

WebGPU visual parity is experimental: custom shading and bloom differ from the WebGL presentation. A failed initialization or lost device must switch to a fresh WebGL canvas, without resetting the authoritative world.

## Browser probe evidence

Chromium 154 on this Linux cloud environment exposes `navigator.gpu`, but the default adapter request returns null. This correctly requires WebGL fallback; API presence alone is insufficient.

A real software WebGPU adapter/device/renderpass/readback and visible premultiplied-alpha GPU canvas were subsequently verified using Chromium SwiftShader/Vulkan. The research probe is documented separately in [WEBGPU_PROBE.md](WEBGPU_PROBE.md). This proves a testable WebGPU device and canvas; it is not yet proof of the complete Three scene renderer.

No native OBS application was installed or tested. OBS WebGPU support depends on its embedded Chromium build, driver, and launch configuration. The browser source must remain usable through WebGL where WebGPU is unavailable.

## Primary references

- [React Three Fiber: WebGPU renderer initialization](https://r3f.docs.pmnd.rs/api/canvas#webgpu)
- [Three WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Three node materials](https://threejs.org/docs/pages/NodeMaterial.html)
- [Three PointsNodeMaterial: WebGPU point-size limitation](https://threejs.org/docs/pages/PointsNodeMaterial.html)
- [WebGPU secure contexts and browser API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)

Actual application renderer evidence, backend diagnostics, screenshots, and fallback checks will be recorded only after the patch is applied and tested.
