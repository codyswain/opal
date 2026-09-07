// Disposable screenshot tour, part 2: gallery, preview pane, inspector, palette, chat thread, first run.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, realpath } from 'fs/promises';
import os from 'os';
import path from 'path';

const OUT = process.env.TOUR_OUT;
const PROJECT_ROOT = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-tour2-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-tour2-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Projects', 'Atlas'), { recursive: true });
await mkdir(path.join(vaultParent, 'Vault', 'Reading'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const md = (title, tags, body) => `---\ntags: [${tags.join(', ')}]\ndescription: ${title} notes\n---\n# ${title}\n\n${body}\n`;
await writeFile(`${vault}/Projects/Atlas/plan.md`, md('Atlas plan', ['research', 'maps'], 'The atlas project maps mountains and rivers in detail.'));
await writeFile(`${vault}/Projects/Atlas/budget.md`, md('Atlas budget', ['finance'], 'Printing costs dominate the second year.'));
await writeFile(`${vault}/Projects/roadmap.md`, md('Roadmap', ['planning'], 'Quarterly goals for the studio.'));
await writeFile(`${vault}/Reading/sourdough.md`, md('Sourdough', ['recipes', 'weekend'], 'Flour, water, salt and patience.'));
// A tiny valid PNG (1x1) so the gallery has an image thumbnail.
await writeFile(`${vault}/Reading/cover.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
await writeFile(`${vault}/inbox.md`, '# Inbox\n\nLoose thoughts.\n');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(path.join(userData, 'library', 'chat'), { recursive: true });
const now = Date.now();
await writeFile(path.join(userData, 'library', 'chat', '11111111-1111-4111-8111-111111111111.json'), JSON.stringify({
  id: '11111111-1111-4111-8111-111111111111', title: 'What does the atlas project cover?', createdAt: now - 60000, updatedAt: now - 30000,
  messages: [
    { id: 'u1', role: 'user', content: 'What does the atlas project cover?', createdAt: now - 60000 },
    { id: 'a1', role: 'assistant', createdAt: now - 30000, content: 'The atlas project **maps mountains and rivers in detail** [1]. Printing costs are expected to dominate the budget in the second year [2].\n\n- Survey data has been gathered\n- The first plates are still to be drafted', sources: [
      { n: 1, path: `${vault}/Projects/Atlas/plan.md`, name: 'plan.md', excerpt: 'The atlas project maps mountains and rivers in detail.', score: 0.82 },
      { n: 2, path: `${vault}/Projects/Atlas/budget.md`, name: 'budget.md', excerpt: 'Printing costs dominate the second year.', score: 0.61 },
    ] },
  ],
}));
await writeFile(path.join(userData, 'library', 'chat', '22222222-2222-4222-8222-222222222222.json'), JSON.stringify({
  id: '22222222-2222-4222-8222-222222222222', title: 'Bread ideas for the weekend', createdAt: now - 7200000, updatedAt: now - 7000000,
  messages: [{ id: 'u2', role: 'user', content: 'Bread ideas for the weekend', createdAt: now - 7200000 }, { id: 'a2', role: 'assistant', content: 'Sourdough needs flour, water, salt and patience [1].', createdAt: now - 7000000, sources: [{ n: 1, path: `${vault}/Reading/sourdough.md`, name: 'sourdough.md', excerpt: 'Flour, water, salt and patience.', score: 0.7 }] }],
}));

async function launch(data) {
  const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: data } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const win = await app.browserWindow(page);
  await win.evaluate((w) => { w.setSize(1440, 900); w.center(); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { app, page, errors };
}
const shot = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('shot', name); };

let { app, page, errors } = await launch(userData);
try {
  await page.evaluate((v) => { window.location.hash = `#/files?mode=browse&dir=${encodeURIComponent(v + '/Reading')}`; }, vault);
  await page.getByTestId(`disk-folder-entry-${vault}/Reading/cover.png`).waitFor();
  await page.getByTestId('disk-folder-view-gallery').click();
  await shot(page, '20-gallery');
  await page.getByTestId('disk-folder-view-list').click().catch(() => {});
  await page.getByTestId(`disk-folder-entry-${vault}/Reading/sourdough.md`).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await shot(page, '21-preview-pane');
  await page.evaluate(() => { localStorage.setItem('opal.isRightSidebarOpen', JSON.stringify({ version: 1, value: true })); });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((v) => { window.location.hash = `#/files?mode=browse&dir=${encodeURIComponent(v + '/Reading')}`; }, vault);
  await page.getByTestId(`disk-folder-entry-${vault}/Reading/sourdough.md`).waitFor();
  await page.getByTestId(`disk-folder-entry-${vault}/Reading/sourdough.md`).click();
  await shot(page, '22-inspector');
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(400);
  await shot(page, '23-palette');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.location.hash = '#/chat'; });
  await page.getByTestId('chat-index-status').waitFor();
  await page.waitForTimeout(500);
  await shot(page, '24-chat-thread');
  await page.evaluate(() => { window.location.hash = '#/files?mode=browse&collection=recent'; });
  await page.waitForTimeout(500);
  await shot(page, '25-recent-empty');
} finally {
  console.log('errors', JSON.stringify(errors, null, 1));
  await app.close();
}
// First run: no folders opened yet.
const fresh = await mkdtemp(path.join(os.tmpdir(), 'opal-tour2-fresh-'));
({ app, page, errors } = await launch(fresh));
try {
  await page.waitForTimeout(800);
  await shot(page, '26-first-run');
  await page.evaluate(() => { window.location.hash = '#/chat'; });
  await page.waitForTimeout(500);
  await shot(page, '27-first-run-chat');
} finally {
  console.log('errors', JSON.stringify(errors, null, 1));
  await app.close();
}
