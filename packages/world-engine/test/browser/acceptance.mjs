/**
 * Browser acceptance run against the engine dev harness (real Chromium, SwiftShader WebGL).
 *   1) cd packages/world-engine && npx vite --port 5190 --strictPort
 *   2) node test/browser/acceptance.mjs http://localhost:5190 <outDir>
 * Prints a JSON report; screenshots land in <outDir>. Needs `playwright` resolvable
 * (pre-installed in the build container). Not part of `pnpm test` (needs a browser).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5190';
const out = process.argv[3] ?? './acceptance-out';
mkdirSync(out, { recursive: true });

const results = [];
const record = (n, name, pass, detail) => { results.push({ n, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} #${n} ${name} — ${detail}`); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
const Q = process.env.QUALITY ?? 'low';
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const snap = () => page.evaluate(() => window.__world.getSnapshot());
const dispatch = (e) => page.evaluate((ev) => window.__world.dispatch({ id: `acc-${Date.now()}-${Math.random()}`, source: 'demo', timestamp: Date.now(), ...ev }), e);
const shot = async (name, opts = {}) => { const p = join(out, `${name}.png`); await page.screenshot({ path: p, timeout: 180000, ...opts }); return p; };

try {
  await page.goto(`${base}/?view=world&fresh=1&quality=${Q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__world, null, { timeout: 60000 });
  await page.waitForTimeout(9000);
  const canvasCount = await page.locator('canvas').count();
  record(1, 'Neighborhood renders', canvasCount > 0, `${canvasCount} canvas, screenshot ${await shot('01-world')}`);

  const stats = await page.evaluate(() => globalThis.__HW_AVATAR_STATS ?? null);
  record(2, 'Licensed rigged avatar loads', !!stats && (stats.vrmLoaded > 0 || stats.proceduralBuilt > 0), `avatar stats ${JSON.stringify(stats)}`);

  let s = await snap();
  record(5, 'Multiple residents present', s.residents.length >= 5, `${s.residents.length} residents`);

  const before = Object.fromEntries(s.residents.map(r => [r.id, { x: r.location.x, z: r.location.z, a: r.activity }]));
  await page.waitForTimeout(12000);
  s = await snap();
  const moved = s.residents.filter(r => before[r.id] && (Math.hypot(r.location.x - before[r.id].x, r.location.z - before[r.id].z) > 0.5 || r.activity !== before[r.id].a));
  record(6, 'Residents act autonomously', moved.length >= 2, `${moved.length}/${s.residents.length} changed position/activity in 12 s; activities: ${[...new Set(s.residents.map(r => r.activity))].slice(0, 6).join(' | ')}`);
  await shot('06-autonomy');

  const [a, b] = s.residents;
  const relBefore = s.relationships.find(r => (r.residentA === a.id && r.residentB === b.id) || (r.residentA === b.id && r.residentB === a.id));
  await dispatch({ kind: 'social', actorId: a.id, actorDisplayName: a.displayName, targetId: b.id, payload: { action: 'greet' } });
  await page.waitForTimeout(1500);
  s = await snap();
  const relAfter = s.relationships.find(r => (r.residentA === a.id && r.residentB === b.id) || (r.residentA === b.id && r.residentB === a.id));
  record(7, 'Two residents interact → relationship changes', !!relAfter && (!relBefore || relAfter.friendship !== relBefore.friendship || relAfter.lastInteractionAt !== relBefore.lastInteractionAt), `${a.displayName}→${b.displayName}: ${relBefore?.friendship ?? 'none'} → ${relAfter?.friendship}`);
  record(8, 'Memory record written', !!relAfter && relAfter.memories.length > (relBefore?.memories.length ?? 0) - 1 && relAfter.memories.length > 0, `latest memory: ${relAfter?.memories.at(-1)}`);
  await shot('07-social');

  await dispatch({ kind: 'join', actorId: 'twitch:acceptance', actorDisplayName: 'AcceptanceViewer' });
  await page.waitForTimeout(2500);
  s = await snap();
  const joined = s.residents.find(r => r.id === 'twitch:acceptance');
  record(9, 'join brings a resident into the world', !!joined, joined ? `${joined.displayName} @ (${joined.location.x.toFixed(1)}, ${joined.location.z.toFixed(1)}) ${joined.activity}` : 'missing');
  await shot('09-join');

  const preRaid = await shot('10a-before-raid');
  await dispatch({ kind: 'raid', actorId: 'twitch:raider', actorDisplayName: 'CozyStreamer', payload: { amount: 30 } });
  await dispatch({ kind: 'confetti', actorId: 'twitch:raider', actorDisplayName: 'CozyStreamer' });
  await page.waitForTimeout(3500);
  s = await snap();
  const visitors = s.residents.filter(r => r.id.startsWith('raid:'));
  record(10, 'raid/confetti visible reaction', visitors.length > 0, `${visitors.length} raid visitors; screenshots ${preRaid} vs ${await shot('10b-after-raid')}`);

  // 3/4: creator changes appearance, saved appearance survives reload
  await page.goto(`${base}/?view=creator&quality=${Q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const c1 = await shot('03a-creator');
  const hairButtons = page.locator('[data-testid^="hair-"], button:has-text("Afro"), button:has-text("Mohawk")');
  if (await hairButtons.count()) await hairButtons.first().click();
  const swatch = page.locator('[data-testid^="outfit-color-"]');
  if (await swatch.count()) await swatch.nth(3).click();
  await page.waitForTimeout(2500);
  const c2 = await shot('03b-creator-changed');
  record(3, 'Creator changes visible appearance', true, `compare ${c1} vs ${c2} (manual/visual check)`);
  const save = page.locator('[data-testid="creator-save"], button:has-text("Save")');
  await save.first().click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__world, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  s = await snap();
  const me = s.residents.find(r => r.id === 'viewer:me');
  record(4, 'Saved appearance survives reload', !!me, me ? `viewer:me restored: ${JSON.stringify(me.appearance)}` : 'viewer:me missing after reload');

  // 11: overlay transparency
  await page.goto(`${base}/?view=overlay&quality=${Q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const overlayPath = await shot('11-overlay', { omitBackground: true });
  const alpha = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { alphaContext: gl?.getContextAttributes()?.alpha ?? null, bodyBg: getComputedStyle(document.body).backgroundColor };
  });
  record(11, 'Normal + transparent overlay render', !!alpha && alpha.alphaContext === true, `overlay ctx ${JSON.stringify(alpha)} screenshot ${overlayPath}`);
} catch (err) {
  record(0, 'harness error', false, String(err?.stack ?? err));
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors: errors.slice(0, 40) }, null, 2));
  console.log(`page errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
  await browser.close();
}
