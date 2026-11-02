# WebGPU cloud browser probe

Verified 2026-11-02, approximately 20:30–20:34 UTC, using Chromium **154.0.8037.57** on Debian 13 in this task's Linux cloud container. No hardware GPU device was present; the bundled SwiftShader Vulkan driver was available. No system configuration, network policy, engine source, or other browser processes were changed.

## Verified result

This is genuine **software WebGPU**, not WebGL fallback:

- `navigator.gpu.requestAdapter()` returned an adapter with vendor `google` and `adapter.info.isFallbackAdapter === true`.
- `adapter.requestDevice()` succeeded.
- A WebGPU render pass cleared an `rgba8unorm` texture; a GPU texture-to-buffer copy plus mapped readback returned **[255, 128, 0, 255]**.
- A `GPUCanvasContext` with `alphaMode: 'premultiplied'` rendered into an actual browser screenshot. Its center pixel was **(255, 128, 0)**; the blue page outside the canvas was **(0, 0, 255)**.
- A second canvas test cleared premultiplied half-alpha orange `(0.5, 0.25, 0, 0.5)` over the blue page. Screenshot center was **(128, 64, 127)**, verifying alpha composition.
- No uncaptured GPU error or device-loss event was observed during these tiny probes.

These checks establish that this environment can execute and display WebGPU work. They do not establish full-world renderer compatibility, game performance, hardware acceleration, or OBS support. The renderer specialist must test the integrated application separately.

## Working Playwright launch

```js
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=vulkan',
    '--use-gl=angle',
    '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-gpu-sandbox',
  ],
  env: {
    ...process.env,
    VK_ICD_FILENAMES: '/usr/lib/chromium/vk_swiftshader_icd.json',
    VK_DRIVER_FILES: '/usr/lib/chromium/vk_swiftshader_icd.json',
  },
});
```

These are isolated testing flags, not a requirement for end users or recommended global browser configuration. The environment variables select only this process's available Vulkan ICD. The probe used a localhost secure context, held references to the GPU/adapter/device/context, and submitted an animation-frame render loop.

## Failed or incomplete configurations

- Default Chromium and an initial generic Vulkan launch returned no adapter in the preceding renderer investigation.
- An explicit SwiftShader adapter configuration produced valid offscreen texture work but failed GPU canvas configuration with `OperationError: A valid external Instance reference no longer exists`.
- Vulkan configurations including `--disable-vulkan-surface` produced working offscreen work and a `GPUCanvasContext`, but the screenshot remained transparent/blue. The final working combination above omits that flag. Several flags changed together, so this probe does not attribute the fix to one flag in isolation.
- A Chrome GPU feature-status summary can report software/unavailable while explicit WebGPU texture work succeeds. Adapter, device, command execution, and displayed pixels are stronger evidence than that summary alone.

## Probe artifacts

Temporary diagnostic scripts in this session:

- `/tmp/hello-webgpu-probe.mjs`: adapter, device, texture clear, buffer readback, CDP GPU information.
- `/tmp/hello-webgpu-canvas-transparent.mjs`: displayed opaque orange with premultiplied canvas configuration.
- `/tmp/hello-webgpu-canvas-alpha.mjs`: actual half-alpha composition check.
- `/tmp/hello-webgpu-canvas-vulkan.png` and `/tmp/hello-webgpu-alpha-vulkan.png`: screenshots measured above.

These temporary files are session evidence and are not repository runtime dependencies.

## Primary references

Chromium's own WebGPU SwiftShader test configuration uses the explicit adapter flag: [Blink FlagSpecificConfig](https://chromium.googlesource.com/chromium/src/+/425894fa253be30a2f813a27d9d1a9e0966ada29/third_party/blink/web_tests/FlagSpecificConfig). The Chromium implementation selects a Vulkan backend for the SwiftShader WebGPU adapter: [WebGPU decoder](https://chromium.googlesource.com/chromium/src/+/lkgr/gpu/command_buffer/service/webgpu_decoder_impl.cc).

The Chrome team documents headless Vulkan/WebGPU flags and stresses that adapter detection alone does not establish real workload use: [Headless WebGPU testing](https://developer.chrome.com/blog/supercharge-web-ai-testing). The exact working configuration above comes from this task's executed probes, not an assumption that an older documented recipe works unchanged.
