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
await writeFile(`${vault}/Reading/cover.png`, Buffer.from('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', 'base64'));
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
  await page.getByTestId('command-palette').waitFor();
  await page.waitForTimeout(400);
  await shot(page, '23-palette');
  await page.keyboard.type('pla');
  await page.waitForTimeout(600);
  await shot(page, '23b-palette-search');
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
