/** Renderer selection is presentation-only. It never creates another world runtime. */
import * as THREE from "three";
import type { GLProps } from "@react-three/fiber";
type DefaultGLProps = Parameters<Extract<GLProps, (props: any) => unknown>>[0];
interface BrowserGPUDevice {
  destroy(): void;
  lost: Promise<{ reason: string }>;
}
interface BrowserGPUAdapter {
  requestDevice(): Promise<BrowserGPUDevice>;
}
interface BrowserGPU {
  requestAdapter(options?: {
    powerPreference?: string;
  }): Promise<BrowserGPUAdapter | null>;
}

export type RendererPreference = "webgl" | "webgpu" | "auto";
export interface WorldRendererStatus {
  requested: RendererPreference;
  backend: "webgl" | "webgpu";
  reason?: string;
}
export interface RendererOptions {
  preference: RendererPreference;
  transparent: boolean;
  onStatus(status: WorldRendererStatus): void;
  onDeviceLost?(reason: string): void;
}

function marker(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  status: WorldRendererStatus,
) {
  if ("dataset" in canvas) {
    canvas.dataset.renderer = status.backend;
    canvas.dataset.rendererRequested = status.requested;
    canvas.dataset.rendererFallback = status.reason || "";
  }
}

export async function createWorldRenderer(
  props: DefaultGLProps,
  options: RendererOptions,
): Promise<THREE.WebGLRenderer> {
  const legacy = (reason?: string) => {
    const status: WorldRendererStatus = {
      requested: options.preference,
      backend: "webgl",
      ...(reason ? { reason } : {}),
    };
    const renderer = new THREE.WebGLRenderer({
      ...props,
      canvas: props.canvas as HTMLCanvasElement,
      alpha: options.transparent,
      antialias: true,
    });
    marker(renderer.domElement, status);
    options.onStatus(status);
    return renderer;
  };
  if (options.preference === "webgl") return legacy();
  const gpu = (globalThis.navigator as Navigator & { gpu?: BrowserGPU }).gpu;
  if (!globalThis.isSecureContext || !gpu)
    return legacy("WebGPU requires a secure browser with GPU support.");
  let adapter: BrowserGPUAdapter | null = null;
  let device: BrowserGPUDevice | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return legacy("No WebGPU adapter is available; using WebGL.");
    device = await adapter.requestDevice();
  } catch {
    return legacy("WebGPU device could not start; using WebGL.");
  }
  try {
    const { WebGPURenderer } = await import("three/webgpu");
    const renderer = new WebGPURenderer({
      canvas: props.canvas as HTMLCanvasElement,
      device,
      antialias: true,
      alpha: options.transparent,
    });
    await renderer.init();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // R3F ecosystem helpers use this WebGL-era capability accessor only to
    // discover canvas alpha. Report the real configured surface capabilities.
    (renderer as unknown as { getContextAttributes(): WebGLContextAttributes }).getContextAttributes = () => ({ alpha: options.transparent, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false, desynchronized: false });
    // isWebGPURenderer alone is insufficient: Three can silently use WebGL2.
    if (
      !(renderer.backend as unknown as { isWebGPUBackend?: boolean })
        .isWebGPUBackend
    ) {
      renderer.dispose();
      device.destroy();
      options.onDeviceLost?.(
        "WebGPU selected another backend; restarting with WebGL.",
      );
      throw new Error("WebGPU backend was not initialized.");
    }
    const { createWebGPUSceneAdapter } = await import("./WebGPUCompatibility");
    const sceneAdapter = createWebGPUSceneAdapter();
    const render = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      // Adapt before the very first shader compilation, including newly loaded rigs.
      sceneAdapter.update(scene, camera);
      return render(scene, camera);
    };
    const status: WorldRendererStatus = {
      requested: options.preference,
      backend: "webgpu",
    };
    marker(renderer.domElement, status);
    options.onStatus(status);
    const ownedDevice = device;
    const dispose = renderer.dispose.bind(renderer);
    renderer.dispose = async () => {
      sceneAdapter.dispose();
      await dispose();
      ownedDevice.destroy();
    };
    void device.lost.then((info) => {
      if (info.reason !== "destroyed")
        options.onDeviceLost?.(
          "WebGPU device was lost; restarting with WebGL.",
        );
    });
    return renderer as unknown as THREE.WebGLRenderer;
  } catch (error) {
    device.destroy();
    options.onDeviceLost?.(
      "WebGPU initialization failed; restarting with WebGL.",
    );
    throw error;
  }
}
