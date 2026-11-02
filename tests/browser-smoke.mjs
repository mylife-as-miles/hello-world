import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.QA_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const output = resolve(process.env.QA_EVIDENCE_DIR || 'docs/screenshots');
const browserPath = process.env.QA_BROWSER_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const actionTimeout = Number(process.env.QA_ACTION_TIMEOUT_MS || 45_000);
const results = { startedAt: new Date().toISOString(), base, checks: [], pageErrors: [], consoleErrors: [], screenshots: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] });
const contexts = [];
const redact = value => process.env.QA_DIRECTOR_KEY ? String(value).split(process.env.QA_DIRECTOR_KEY).join('[REDACTED]') : String(value);
const check = (name, detail = {}) => { results.checks.push({ name, passed: true, ...detail }); console.log(`PASS ${name}`); };
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function until(predicate, label, timeout = actionTimeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await predicate()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
async function trackedPage(viewport = { width: 1100, height: 900 }, observeOnly = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 }); contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(actionTimeout);
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
  await page.goto(observeOnly ? `${base}/api/health` : `${base}/?quality=low`, { waitUntil: 'domcontentloaded' });
  if (observeOnly) await page.evaluate(async () => {
    await fetch('/api/status', { credentials: 'include' });
    const url = new URL('/ws', location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    window.qaObserver = new WebSocket(url);
  });
  await until(() => state.snapshot && state.status, 'authoritative world connection');
  return { context, page, state };
}
async function settleScene(page, scope = page) {
  const canvas = scope.locator('canvas').first();
  await canvas.waitFor({ state: 'visible' });
  await page.waitForLoadState('domcontentloaded');
  await sleep(1000);
  const bounds = await canvas.boundingBox();
  assert(bounds && bounds.width > 100 && bounds.height > 100, 'Scene canvas has no usable visible area');
}
async function realClick(locator) {
  await locator.waitFor({ state: 'visible' });
  // Force skips Playwright's unstable animation/actionability polling, while
  // Chromium still receives a real pointer click at the current element bounds.
  await locator.click({ force: true, noWaitAfter: true, timeout: actionTimeout });
}
async function screenshot(page, name, options = {}) {
  if (process.env.QA_SKIP_OPTIONAL_SCREENSHOTS === 'true' && name !== 'obs-overlay.png') return Buffer.alloc(0);
  const path = resolve(output, name);
  const png = await page.screenshot({ path, fullPage: true, animations: 'disabled', timeout: actionTimeout, ...options });
  results.screenshots.push(name); return png;
}
const samePair = (relationship, a, b) => [relationship.residentA, relationship.residentB].includes(a) && [relationship.residentA, relationship.residentB].includes(b);

let primary;
try {
  primary = await trackedPage(); const { page, state } = primary;
  if (process.env.QA_REQUIRE_VIEWER === 'true') { assert.equal(state.director, false, 'First session must have viewer-only permissions for this run'); check('First browser session has viewer-only permissions'); }
  assert(await page.getByRole('heading', { level: 1, name: /Little world/i }).isVisible());
  await settleScene(page);
  check('Landing and authoritative 3D world load', { residents: state.snapshot.residents.length, mode: state.status.mode });
  await screenshot(page, 'landing-desktop.png');
  let myId = state.snapshot.residents.find(resident => resident.id.startsWith('viewer:'))?.id || state.snapshot.residents[0]?.id;
  let hasPersistedRelationship = () => true;
  results.scope = process.env.QA_DIRECTOR_ONLY === 'true' ? 'Focused Director/mobile/overlay follow-up; core flow not rerun' : 'Full browser flow';
  if (process.env.QA_DIRECTOR_ONLY !== 'true') {
  await realClick(page.getByRole('button', { name: 'Enter the world', exact: true }));
  assert(await page.getByRole('heading', { level: 1, name: /Make yourself at home/i }).isVisible());
  const name = `QA Nova ${Date.now().toString().slice(-5)}`;
  const headerCreator = page.getByRole('button', { name: 'Create resident', exact: true });
  const visibleCreator = await headerCreator.isVisible() ? headerCreator : page.getByRole('button', { name: 'Create your resident', exact: true }).filter({ visible: true }).first();
  await realClick(visibleCreator);
  console.log('STEP resident name modal opened');
  await page.locator('#resident-name').fill(name);
  await realClick(page.getByRole('button', { name: 'Make it yours', exact: true }));
  console.log('STEP character creator opened');
  await settleScene(page, page.getByRole('dialog'));
  const creatorBounds = await page.getByTestId('avatar-creator').boundingBox();
  assert(creatorBounds && creatorBounds.height >= 300, `Creator host collapsed to ${creatorBounds?.height}px`);
  await until(async () => Number(await page.getByTestId('creator-stage').getAttribute('data-rig-builds')) > 0, 'actual preview avatar rig rendered');
  check('Creator has a usable host height and a loaded 3D avatar rig', { height: creatorBounds.height });
  const creator = page.getByRole('dialog');
  const initialOutfitColor = await creator.locator('[data-testid^="outfit-color-"][aria-pressed="true"]').getAttribute('title');
  const chosenPreset = creator.getByTestId('preset-1');
  await realClick(chosenPreset);
  await until(async () => await chosenPreset.getAttribute('aria-pressed') === 'true', 'distinctive Atlas appearance preset applied in creator');
  const expectedOutfitColor = (await creator.locator('[data-testid^="outfit-color-"][aria-pressed="true"]').getAttribute('title')).toLowerCase();
  assert.notEqual(expectedOutfitColor, initialOutfitColor.toLowerCase(), 'Appearance preset did not change the visible outfit choice');
  await screenshot(page, 'avatar-creator.png');
  const creatorSave = page.getByRole('dialog').getByRole('button', { name: /^(save|join|move in|enter|create|finish)/i }).last();
  await realClick(creatorSave);
  await until(() => state.snapshot.residents.some(resident => resident.displayName === name), 'viewer appears in authoritative world');
  const me = state.snapshot.residents.find(resident => resident.displayName === name);
  myId = me.id;
  assert(myId.startsWith('viewer:'));
  assert.equal(me.appearance.outfit.color.toLowerCase(), expectedOutfitColor, 'Saved resident did not retain selected outfit color');
  check('Distinctive creator outfit selection reaches authoritative appearance', { outfitColor: expectedOutfitColor });
  check('Viewer joins through the actual 3D avatar creator', { residentId: myId });
  await realClick(page.locator('.resident-row').filter({ hasText: name }));
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('follow');
  await settleScene(page);
  await screenshot(page, 'world-resident.png');
  for (const camera of ['orbit', 'street', 'cinematic', 'neighborhood']) {
    await page.getByRole('combobox', { name: 'Camera view' }).selectOption(camera);
    await sleep(300);
    assert.equal(await page.locator('.scene-empty').count(), 0, `Camera ${camera} triggered the scene fallback`);
  }
  check('All five camera modes accept changes without runtime errors');

  const neighbor = state.snapshot.residents.find(resident => resident.id !== myId);
  assert(neighbor, 'A second resident is required to verify social interaction');
  await page.locator('#target-resident').selectOption(neighbor.id);
  await realClick(page.getByRole('button', { name: 'Make a friend', exact: true }));
  await until(() => state.snapshot.relationships.some(relationship => samePair(relationship, myId, neighbor.id) && relationship.friendship > 0), 'social relationship appears');
  const relationshipMark = state.snapshot.relationships.find(relationship => samePair(relationship, myId, neighbor.id));
  const friendship = relationshipMark.friendship;
  const socialMemory = relationshipMark.memories.at(-1);
  hasPersistedRelationship = snapshot => snapshot.relationships.some(relationship => samePair(relationship, myId, neighbor.id) && (socialMemory ? relationship.memories.includes(socialMemory) : relationship.friendship > 0));
  check('Viewer social interaction creates a relationship', { targetId: neighbor.id, friendship });
  await sleep((state.status.settings.cooldownSeconds + 0.2) * 1000);
  const chat = `Hello from ${name}`;
  await page.getByRole('textbox', { name: 'Say something to the neighborhood' }).fill(chat);
  await realClick(page.getByRole('button', { name: 'Send message', exact: true }));
  await until(() => state.snapshot.eventHistory.some(event => event.kind === 'chat' && event.actorId === myId && event.text === chat), 'viewer chat event');
  check('Viewer chat enters the shared event runtime');

  await page.evaluate(() => history.replaceState(null, '', `${location.pathname}?quality=low`));
  state.snapshot = null;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(() => state.snapshot?.residents.some(resident => resident.id === myId), 'resident restored after browser reload');
  assert(hasPersistedRelationship(state.snapshot), 'The same relationship or social memory did not survive reload');
  assert.deepEqual(state.snapshot.residents.find(resident => resident.id === myId).appearance, me.appearance);
  check('Resident appearance and relationship survive browser reload');

  }
  // A real second browser session observes the same WebSocket protocol without
  // rendering a second expensive software WebGL canvas during Director actions.
  const second = await trackedPage({ width: 390, height: 500 }, true);
  assert(second.state.snapshot.residents.some(resident => resident.id === myId));
  if (process.env.QA_DIRECTOR_ONLY !== 'true') assert(hasPersistedRelationship(second.state.snapshot), 'Independent session lacks the persisted relationship or social memory');
  check(process.env.QA_DIRECTOR_ONLY === 'true' ? 'Independent context receives current authoritative resident' : 'Independent browser context receives the same resident and relationship', { connectedSessions: second.state.status.clients });

  await realClick(page.getByRole('button', { name: 'Director Studio', exact: true }));
  if (!state.director) {
    assert(process.env.QA_DIRECTOR_KEY, 'Director controls are locked. Supply QA_DIRECTOR_KEY or explicitly enable local demo Director on the server.');
    await realClick(page.getByRole('button', { name: 'Unlock controls', exact: true }));
    await page.locator('#director-key').fill(process.env.QA_DIRECTOR_KEY);
    await realClick(page.getByRole('button', { name: 'Unlock Studio', exact: true }));
    await until(() => state.director, 'Director authentication');
  }
  const priorWeather = state.snapshot.weather;
  const targetWeather = priorWeather === 'snow' ? 'sunny' : 'snow';
  const targetWeatherLabel = targetWeather === 'snow' ? 'Snow' : 'Sunny';
  await realClick(page.getByRole('button', { name: targetWeatherLabel, exact: true }));
  await until(() => state.snapshot.weather === targetWeather && second.state.snapshot.weather === targetWeather, 'weather fanout to two contexts');
  check('Authenticated Director weather reaches independent sessions', { from: priorWeather, to: targetWeather });
  const previousConfetti = new Set(state.snapshot.eventHistory.filter(event => event.kind === 'confetti').map(event => event.id));
  await realClick(page.getByRole('button', { name: /Throw a celebration/i }));
  await until(() => state.snapshot.eventHistory.some(event => event.kind === 'confetti' && event.source === 'demo' && !previousConfetti.has(event.id)), 'labeled demo celebration');
  check('Director demo celebration uses shared normalized events');
  await screenshot(page, 'director-studio.png');
  const previousWeatherLabel = { sunny: 'Sunny', sunset: 'Golden hour', rain: 'Rain', snow: 'Snow' }[priorWeather];
  if (previousWeatherLabel !== targetWeatherLabel) {
    await realClick(page.getByRole('button', { name: previousWeatherLabel, exact: true }));
    await until(() => state.snapshot.weather === priorWeather, 'restore prior weather');
  }
  await second.context.close();

  await realClick(page.getByRole('button', { name: 'Your world', exact: true }));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Phone layout overflows horizontally');
  check('Phone layout fits a 390px viewport');
  await screenshot(page, 'world-mobile.png');

  await page.goto('about:blank');
  const overlay = page;
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  overlay.on('pageerror', error => results.pageErrors.push(error.message));
  await overlay.goto(`${base}/overlay?camera=follow&resident=${encodeURIComponent(myId)}&quality=low`, { waitUntil: 'domcontentloaded' });
  await settleScene(overlay);
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
