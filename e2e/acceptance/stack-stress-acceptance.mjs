// Disposable Electron acceptance for Today's stream under load: a vault with
// 100 daily pages of mixed length, scrolled slowly and quickly from today to
// the first page and back. Reports frame times and memory, and checks that
// the stream never holds more than twelve editors, loads every page, and
// writes nothing. Own userData and temp vault; run from the repository root
// after the Vite bundles are built: see README.md here.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readdir, rm, realpath, stat } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const PAGES = 100;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dayBefore = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return iso(date);
};

// A small deterministic generator, so every run scrolls the same pages.
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const sentence = () => {
  const words = ['rig', 'arm', 'deploy', 'motor', 'Kigali', 'shipment', 'cooling', 'review', 'Linear', 'firmware', 'NUC', 'camera', 'plan', 'call', 'notes', 'today'];
  const count = 8 + Math.floor(random() * 18);
  const text = Array.from({ length: count }, () => words[Math.floor(random() * words.length)]).join(' ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
};
function dailyPage(index) {
  const blocks = [];
  const size = 1 + Math.floor(random() * (index % 7 === 0 ? 24 : 9));
  for (let block = 0; block < size; block += 1) {
    const kind = random();
    if (kind < 0.45) blocks.push(Array.from({ length: 1 + Math.floor(random() * 4) }, sentence).join(' '));
    else if (kind < 0.7) blocks.push(Array.from({ length: 2 + Math.floor(random() * 5) }, () => `- ${sentence()}`).join('\n'));
    else if (kind < 0.82) blocks.push(Array.from({ length: 2 + Math.floor(random() * 4) }, () => `- [${random() < 0.4 ? 'x' : ' '}] ${sentence()}`).join('\n'));
    else if (kind < 0.92) blocks.push(`## ${sentence().slice(0, 30)}`);
    else blocks.push('| What | Who | When |\n| --- | --- | --- |\n| Ship arms | Lucas | Fri |\n| Cooling test | Josh | Mon |');
  }
  return `---\ndate: ${dayBefore(index)}\ntags:\n  - daily\n---\n${blocks.join('\n\n')}\n`;
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-stack-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-stack-vault-'));
const daily = path.join(vaultParent, 'Vault', 'Library', 'daily');
await mkdir(daily, { recursive: true });
let bytes = 0;
for (let index = 0; index <= PAGES; index += 1) {
  const text = dailyPage(index);
  bytes += text.length;
  await writeFile(path.join(daily, `${dayBefore(index)}.md`), text);
}
const vault = await realpath(path.join(vaultParent, 'Vault'));
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
const mtimes = async () => Object.fromEntries(await Promise.all((await readdir(daily)).map(async (name) => [name, (await stat(path.join(daily, name))).mtimeMs])));
const before = await mtimes();
console.log(`vault: ${PAGES + 1} daily pages, ${(bytes / 1024).toFixed(0)} KB`);

const started = Date.now();
const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.waitForLoadState('domcontentloaded');
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1440, height: 900 }));
const stack = page.getByTestId('files-stack');
await stack.waitFor();
await page.locator('[data-role="head"] .cm-editor').waitFor();
console.log(`launch to today's editor: ${Date.now() - started} ms`);
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');

const memory = async (label) => {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
  const renderer = metrics.filter((metric) => metric.type === 'Tab' || metric.type === 'Renderer');
  const total = metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
  // The DevTools protocol reads the heap exactly; performance.memory is rounded.
  const heap = await cdp.send('Performance.getMetrics').then(
    ({ metrics: list }) => list.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? null,
    () => null,
  );
  const shown = await page.evaluate(() => ({
    sections: document.querySelectorAll('[data-stack-section]').length,
    editors: document.querySelectorAll('[data-testid="files-stack"] .cm-editor').length,
  }));
  console.log(
    `memory ${label}: renderer ${(renderer.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024).toFixed(0)} MB, ` +
    `all processes ${(total / 1024).toFixed(0)} MB, JS heap ${heap === null ? 'n/a' : `${(heap / 1048576).toFixed(1)} MB`}; ` +
    `${shown.sections} sections in the page, ${shown.editors} editors`,
  );
  return shown;
};

/** Scrolls the stream by `step` px each frame until it reaches `target`, recording every frame's length and the editor count. */
const scrollRun = (target, step) => page.evaluate(({ target: goal, step: perFrame }) => new Promise((resolve) => {
  const element = document.querySelector('[data-testid="files-stack"]');
  const frames = [];
  let maxEditors = 0;
  let last = performance.now();
  let stalled = 0;
  const tick = (now) => {
    frames.push(now - last);
    last = now;
    maxEditors = Math.max(maxEditors, element.querySelectorAll('.cm-editor').length);
    const before = element.scrollTop;
    const remaining = goal - before;
    if (Math.abs(remaining) < 1 || stalled > 30) {
      resolve({ frames, maxEditors, end: element.scrollTop, height: element.scrollHeight });
      return;
    }
    element.scrollTop = before + Math.sign(remaining) * Math.min(Math.abs(remaining), perFrame);
    // At the bottom the stream may still be loading pages; wait for it to grow.
    stalled = Math.abs(element.scrollTop - before) < 1 ? stalled + 1 : 0;
    if (goal === Infinity && element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && document.querySelector('.opal-stack-end')) {
      resolve({ frames, maxEditors, end: element.scrollTop, height: element.scrollHeight });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), { target, step });

const summary = (label, run) => {
  const sorted = [...run.frames].slice(1).sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const long = sorted.filter((frame) => frame > 33.4).length;
  console.log(
    `frames ${label}: ${sorted.length} frames, p50 ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, ` +
    `p99 ${at(0.99).toFixed(1)} ms, max ${(sorted.at(-1) ?? 0).toFixed(1)} ms, ${long} over 33 ms; most editors ${run.maxEditors}`,
  );
  return { p95: at(0.95), long, frames: sorted.length, maxEditors: run.maxEditors };
};

await memory('at launch');
// About 1.3 viewports a second: reading speed, every section near the view mounts.
const slow = summary('slow scroll down (18 px per frame)', await scrollRun(Infinity, 18));
const atBottom = await memory('at the first page');
await page.waitForTimeout(3000);
const idle = await memory('3 s later');
const fastUp = summary('fast scroll up (120 px per frame)', await scrollRun(0, 120));
await page.waitForTimeout(500);
const fastDown = summary('fast scroll down (120 px per frame)', await scrollRun(Infinity, 120));
await page.waitForTimeout(3000);
await memory('3 s after the fast runs');

check('every daily page loads into the stream', atBottom.sections === PAGES + 1, `${atBottom.sections} sections`);
check('the stream ends with "No earlier pages"', (await page.locator('.opal-stack-end').count()) === 1);
check('never more than twelve editors', Math.max(slow.maxEditors, fastUp.maxEditors, fastDown.maxEditors) <= 12);
check('editors far from the view are let go', idle.editors <= 12 && idle.editors < atBottom.sections);
check('slow scrolling keeps 95% of frames under 33 ms', slow.p95 < 33.4, `p95 ${slow.p95.toFixed(1)} ms`);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await app.close();
const after = await mtimes();
const changed = Object.keys(after).filter((name) => after[name] !== before[name]);
// Today's page exists already, so nothing is created or written.
check('no daily page was written', changed.length === 0, changed.join(', '));
await rm(userData, { recursive: true, force: true });
await rm(vaultParent, { recursive: true, force: true });
process.exit(results.every((result) => result.ok) ? 0 : 1);
