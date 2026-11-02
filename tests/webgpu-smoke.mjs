/**
 * Genuine WebGPU scene/studio/overlay smoke test. Fallback is a failure here:
 * this command requires a native or explicitly configured software WebGPU adapter.
 * Run against the built application, not the engine development harness.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const base = (process.env.WEBGPU_TEST_BASE || "http://localhost:3011").replace(
  /\/$/,
  "",
);
const dir = resolve(
  process.env.WEBGPU_EVIDENCE_DIR ||
    join(tmpdir(), "hello-world-webgpu-evidence"),
);
await mkdir(dir, { recursive: true });
const browserPath =
  process.env.WEBGPU_BROWSER_PATH ||
  process.env.QA_BROWSER_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const icd =
  process.env.WEBGPU_SWIFTSHADER_ICD ||
  "/usr/lib/chromium/vk_swiftshader_icd.json";
const useSoftware =
  process.env.WEBGPU_USE_SOFTWARE === "1" ||
  (process.env.WEBGPU_USE_SOFTWARE !== "0" &&
    process.platform === "linux" &&
    existsSync(icd));
if (useSoftware)
  assert(
    existsSync(icd),
    "WEBGPU_SWIFTSHADER_ICD must point to an installed SwiftShader Vulkan ICD.",
  );
const flags = ["--no-sandbox", "--disable-dev-shm-usage"];
if (useSoftware)
  flags.push(
    "--enable-unsafe-webgpu",
    "--enable-unsafe-swiftshader",
    "--use-angle=vulkan",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "--use-gl=angle",
    "--use-vulkan=swiftshader",
    "--use-webgpu-adapter=swiftshader",
    "--disable-gpu-sandbox",
  );
const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: flags,
  env: {
    ...process.env,
    ...(useSoftware ? { VK_ICD_FILENAMES: icd, VK_DRIVER_FILES: icd } : {}),
  },
});
const page = await browser.newPage({
  viewport: { width: 960, height: 640 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(30000);
const report = {
  base,
  softwareAdapterRequested: useSoftware,
  startedAt: new Date().toISOString(),
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  passed: false,
};
page.on("pageerror", (e) => report.pageErrors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.consoleErrors.push(m.text());
});
async function pixels(png) {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const p = ctx.getImageData(0, 0, c.width, c.height).data;
    let clear = 0,
      visible = 0;
    const colors = new Set();
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) clear++;
      else {
        visible++;
        if (i % 16 === 0) colors.add(`${p[i]},${p[i + 1]},${p[i + 2]}`);
      }
    }
    return {
      width: c.width,
      height: c.height,
      clear,
      visible,
      total: p.length / 4,
      colors: colors.size,
    };
  }, png.toString("base64"));
}
try {
  await page.goto(`${base}/world?renderer=webgpu&quality=low`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => document.querySelector("canvas")?.dataset.renderer === "webgpu",
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(2000);
  const diag = await page
    .locator("canvas")
    .first()
    .evaluate((c) => ({ ...c.dataset }));
  assert.equal(diag.renderer, "webgpu");
  const png = await page
    .locator("canvas")
    .first()
    .screenshot({ path: `${dir}/webgpu-world.png`, omitBackground: true });
  const colors = await pixels(png);
  assert(colors.colors > 100, "WebGPU canvas is blank or uniform");
  report.checks.push({
    name: "Actual WebGPU backend renders a nonblank 3D world",
    diag,
    pixels: colors,
  });
  await page.locator(".header-join").evaluate((button) => button.click());
  await page.locator("#resident-name").fill("GPU Studio Check");
  await page
    .getByRole("button", { name: "Make it yours", exact: true })
    .evaluate((button) => button.click());
  const studioCanvas = page
    .getByRole("dialog")
    .locator('canvas[data-renderer="webgpu"]');
  await studioCanvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const studioPng = await studioCanvas.screenshot({
    path: `${dir}/webgpu-studio.png`,
    omitBackground: true,
  });
  const studioPixels = await pixels(studioPng);
  assert(studioPixels.colors > 100, "WebGPU studio preview is blank");
  report.checks.push({
    name: "Actual WebGPU character studio renders a nonblank avatar preview",
    diag: await studioCanvas.evaluate((canvas) => ({ ...canvas.dataset })),
    pixels: studioPixels,
  });
  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .evaluate((button) => button.click());
  await page.goto(
    `${base}/overlay?renderer=webgpu&quality=low&camera=neighborhood`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => document.querySelector("canvas")?.dataset.renderer === "webgpu",
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(2000);
  const overlay = await page.screenshot({
    path: `${dir}/webgpu-overlay.png`,
    omitBackground: true,
  });
  const alpha = await pixels(overlay);
  assert(
    alpha.clear > alpha.total * 0.05,
    "WebGPU overlay has no transparent space",
  );
  assert(alpha.visible > 100, "WebGPU overlay is blank");
  report.checks.push({
    name: "Actual WebGPU overlay preserves nonblank transparent content",
    pixels: alpha,
  });
  report.passed =
    report.pageErrors.length === 0 &&
    !report.consoleErrors.some((message) =>
      /NodeBuilder|ShaderMaterial|validation|WebGPU.*(error|lost|failed)/i.test(
        message,
      ),
    );
  report.finishedAt = new Date().toISOString();
  if (!report.passed) process.exitCode = 1;
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
  await page
    .screenshot({ path: `${dir}/failure.png`, omitBackground: true })
    .catch(() => {});
} finally {
  await browser.close();
  await writeFile(`${dir}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
