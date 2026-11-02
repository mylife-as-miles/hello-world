import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.QA_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const output = resolve(process.env.QA_EVIDENCE_DIR || 'docs/screenshots');
const browserPath = process.env.QA_BROWSER_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const results = { startedAt: new Date().toISOString(), base, checks: [], pageErrors: [], consoleErrors: [], screenshots: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexts = [];
const redact = value => process.env.QA_DIRECTOR_KEY ? String(value).split(process.env.QA_DIRECTOR_KEY).join('[REDACTED]') : String(value);
const check = (name, detail = {}) => { results.checks.push({ name, passed: true, ...detail }); console.log(`PASS ${name}`); };
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function until(predicate, label, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await predicate()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
async function trackedPage(viewport = { width: 1440, height: 1080 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }); contexts.push(context);
  const page = await context.newPage();
  const state = { snapshot: null, status: null, director: false, messages: [] };
  page.on('pageerror', error => results.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try {
      const value = JSON.parse(String(frame.payload));
      state.messages.push(value); if (state.messages.length > 300) state.messages.shift();
      if (value.type === 'snapshot') state.snapshot = value.snapshot;
      if (value.type === 'status') state.status = value;
      if (value.type === 'director-auth') state.director = value.authorized;
    } catch { /* Non-JSON traffic is reported by application error handling. */ }
  }));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await until(() => state.snapshot && state.status, 'authoritative world connection');
  return { context, page, state };
}
async function screenshot(page, name, options = {}) {
  const path = resolve(output, name);
  const png = await page.screenshot({ path, fullPage: true, animations: 'disabled', ...options });
  results.screenshots.push(name); return png;
}
const samePair = (relationship, a, b) => [relationship.residentA, relationship.residentB].includes(a) && [relationship.residentA, relationship.residentB].includes(b);

let primary;
try {
  primary = await trackedPage(); const { page, state } = primary;
  if (process.env.QA_REQUIRE_VIEWER === 'true') { assert.equal(state.director, false, 'First session must have viewer-only permissions for this run'); check('First browser session has viewer-only permissions'); }
  assert(await page.getByRole('heading', { level: 1, name: /Little world/i }).isVisible());
  assert(await page.locator('canvas').count() > 0);
  check('Landing and authoritative 3D world load', { residents: state.snapshot.residents.length, mode: state.status.mode });
  await screenshot(page, 'landing-desktop.png');
  await page.getByRole('button', { name: 'Enter the world', exact: true }).click();
  assert(await page.getByRole('heading', { level: 1, name: /Make yourself at home/i }).isVisible());
  const name = `QA Nova ${Date.now().toString().slice(-5)}`;
  await page.getByRole('button', { name: 'Create resident', exact: true }).click();
  await page.locator('#resident-name').fill(name);
  await page.getByRole('button', { name: 'Make it yours', exact: true }).click();
  await until(async () => await page.getByRole('dialog').locator('canvas').count() > 0, '3D avatar creator');
  await screenshot(page, 'avatar-creator.png');
  const creatorSave = page.getByRole('dialog').getByRole('button', { name: /^(save|join|move in|enter|create|finish)/i }).last();
  await creatorSave.click();
  await until(() => state.snapshot.residents.some(resident => resident.displayName === name), 'viewer appears in authoritative world');
  const me = state.snapshot.residents.find(resident => resident.displayName === name);
  const myId = me.id;
  assert(myId.startsWith('viewer:'));
  check('Viewer joins through the actual 3D avatar creator', { residentId: myId });
  await screenshot(page, 'world-resident.png');

  const neighbor = state.snapshot.residents.find(resident => resident.id !== myId);
  assert(neighbor, 'A second resident is required to verify social interaction');
  await page.locator('#target-resident').selectOption(neighbor.id);
  await page.getByRole('button', { name: 'Make a friend', exact: true }).click();
  await until(() => state.snapshot.relationships.some(relationship => samePair(relationship, myId, neighbor.id) && relationship.friendship > 0), 'social relationship appears');
  const friendship = state.snapshot.relationships.find(relationship => samePair(relationship, myId, neighbor.id)).friendship;
  check('Viewer social interaction creates a relationship', { targetId: neighbor.id, friendship });
  await sleep((state.status.settings.cooldownSeconds + 0.2) * 1000);
  const chat = `Hello from ${name}`;
  await page.getByRole('textbox', { name: 'Say something to the neighborhood' }).fill(chat);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await until(() => state.snapshot.eventHistory.some(event => event.kind === 'chat' && event.actorId === myId && event.text === chat), 'viewer chat event');
  check('Viewer chat enters the shared event runtime');

  state.snapshot = null;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(() => state.snapshot?.residents.some(resident => resident.id === myId), 'resident restored after browser reload');
  assert(state.snapshot.relationships.some(relationship => samePair(relationship, myId, neighbor.id) && relationship.friendship >= friendship));
  assert.deepEqual(state.snapshot.residents.find(resident => resident.id === myId).appearance, me.appearance);
  check('Resident appearance and relationship survive browser reload');

  const second = await trackedPage();
  assert(second.state.snapshot.residents.some(resident => resident.id === myId));
  assert(second.state.snapshot.relationships.some(relationship => samePair(relationship, myId, neighbor.id) && relationship.friendship >= friendship));
  check('Independent browser context receives the same resident and relationship', { connectedSessions: second.state.status.clients });

  await page.getByRole('button', { name: 'Director Studio', exact: true }).click();
  if (!state.director) {
    assert(process.env.QA_DIRECTOR_KEY, 'Director controls are locked. Supply QA_DIRECTOR_KEY or explicitly enable local demo Director on the server.');
    await page.getByRole('button', { name: 'Unlock studio', exact: true }).click();
    await page.locator('#director-key').fill(process.env.QA_DIRECTOR_KEY);
    await page.getByRole('button', { name: 'Unlock Studio', exact: true }).click();
    await until(() => state.director, 'Director authentication');
  }
  const priorWeather = state.snapshot.weather;
  await page.getByRole('button', { name: 'Snow', exact: true }).click();
  await until(() => state.snapshot.weather === 'snow' && second.state.snapshot.weather === 'snow', 'weather fanout to two contexts');
  check('Authenticated Director weather reaches independent sessions');
  const previousConfetti = new Set(state.snapshot.eventHistory.filter(event => event.kind === 'confetti').map(event => event.id));
  await page.getByRole('button', { name: /Throw a celebration/i }).click();
  await until(() => state.snapshot.eventHistory.some(event => event.kind === 'confetti' && event.source === 'demo' && !previousConfetti.has(event.id)), 'labeled demo celebration');
  check('Director demo celebration uses shared normalized events');
  await screenshot(page, 'director-studio.png');
  const previousWeatherLabel = { sunny: 'Sunny', sunset: 'Golden hour', rain: 'Rain', snow: 'Snow' }[priorWeather];
  if (previousWeatherLabel !== 'Snow') {
    await page.getByRole('button', { name: previousWeatherLabel, exact: true }).click();
    await until(() => state.snapshot.weather === priorWeather, 'restore prior weather');
  }
  await second.context.close();

  await page.getByRole('button', { name: 'Your world', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Phone layout overflows horizontally');
  check('Phone layout fits a 390px viewport');
  await screenshot(page, 'world-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1080 });

  const overlay = await primary.context.newPage();
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  overlay.on('pageerror', error => results.pageErrors.push(error.message));
  await overlay.goto(`${base}/overlay?camera=follow&resident=${encodeURIComponent(myId)}&quality=low`, { waitUntil: 'domcontentloaded' });
  await overlay.locator('canvas').waitFor();
  await sleep(1500);
  assert.equal(await overlay.locator('.rail, .topbar, .scene-controls').count(), 0);
  const png = await screenshot(overlay, 'obs-overlay.png', { omitBackground: true });
  const alpha = await overlay.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0, opaque = 0, translucent = 0;
    for (let index = 3; index < pixels.length; index += 4) { if (pixels[index] === 0) clear++; else if (pixels[index] === 255) opaque++; else translucent++; }
    return { width: canvas.width, height: canvas.height, clear, opaque, translucent, total: pixels.length / 4,
      corners: [0, canvas.width - 1, canvas.width * (canvas.height - 1), canvas.width * canvas.height - 1].map(index => pixels[index * 4 + 3]) };
  }, png.toString('base64'));
  assert(alpha.clear > alpha.total * 0.05, 'Overlay composite lacks visible transparent space');
  assert(alpha.opaque + alpha.translucent > alpha.total * 0.005, 'Overlay is blank');
  check('OBS route has hidden chrome, rendered content and real composited alpha', { alpha });
  await overlay.close();
  assert.equal(results.pageErrors.length, 0, `Browser runtime errors: ${results.pageErrors.join('; ')}`);
  check('No uncaught browser runtime errors across tested routes');
  results.finishedAt = new Date().toISOString(); results.passed = true;
} catch (error) {
  results.passed = false; results.failure = redact(error.stack || String(error)); process.exitCode = 1;
  console.error(results.failure);
  if (primary?.page && !primary.page.isClosed()) await screenshot(primary.page, 'failure.png').catch(() => {});
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await writeFile(resolve(output, 'browser-results.json'), JSON.stringify(results, (_key, value) => typeof value === 'string' ? redact(value) : value, 2) + '\n');
}
