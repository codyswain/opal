// Disposable Electron acceptance for the Recent slice. Uses its own userData
// and a temp vault; never touches the user's profile or running app.
// Run from the repository root after the Vite bundles are built:
//   node e2e/acceptance/recent-acceptance.mjs
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-recent-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-recent-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Notes'), { recursive: true });
await mkdir(path.join(vaultParent, 'Vault', 'Papers'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
await writeFile(path.join(vault, 'Notes', 'brief.md'), '# Brief\n\nHello.\n');
await writeFile(path.join(vault, 'Papers', 'paper.pdf'), '%PDF-1.4\n%fake\n');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

const NOTE = `${vault}/Notes/brief.md`;
const PDF = `${vault}/Papers/paper.pdf`;
const activityPath = path.join(userData, 'library', 'activity.json');

async function launch() {
  const app = await electron.launch({
    args: [PROJECT_ROOT],
    env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return { app, page, errors };
}
const gotoHash = async (page, hash) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
};
const readActivity = async () => JSON.parse(await readFile(activityPath, 'utf8'));

let { app, page, errors } = await launch();
try {
  // 1. Open a PDF, then a note: Recent lists the note first with a reason.
  await gotoHash(page, `#/files?mode=browse&dir=${encodeURIComponent(`${vault}/Papers`)}`);
  await page.getByTestId(`disk-folder-entry-${PDF}`).dblclick();
  await page.getByRole('button', { name: 'Return to folder' }).waitFor();
  await gotoHash(page, `#/files?mode=browse&dir=${encodeURIComponent(`${vault}/Notes`)}`);
  await page.getByTestId(`disk-folder-entry-${NOTE}`).dblclick();
  await page.getByRole('button', { name: 'Return to folder' }).waitFor();
  await page.getByRole('link', { name: 'Recent' }).click();
  await page.getByTestId('files-recent').waitFor();
  const rows = page.locator('[data-testid^="disk-folder-entry-"]');
  await rows.first().waitFor();
  const firstId = await rows.first().getAttribute('data-testid');
  check('1 Recent lists the note first', firstId === `disk-folder-entry-${NOTE}`, firstId ?? '');
  const reason = await page.getByText(/Opened just now/).first().isVisible();
  check('1 Recent shows a readable reason', reason);
  // Hovering and selecting other rows does not reorder.
  await rows.nth(1).hover();
  await rows.nth(1).click();
  const stillFirst = await rows.first().getAttribute('data-testid');
  check('1 selection does not reorder', stillFirst === `disk-folder-entry-${NOTE}`);
  const before = await readActivity();
  check('activity persisted with two records', before.items.length === 2, JSON.stringify(before.items.map((i) => i.path)));

  // 6. Open a result, go Back, selection restored in Recent.
  await rows.first().click();
  await rows.first().dblclick();
  await page.getByRole('button', { name: 'Return to folder' }).waitFor();
  check('6 focus URL keeps recent collection', (await page.evaluate(() => window.location.hash)).includes('collection=recent'));
  await page.goBack();
  await page.getByTestId('files-recent').waitFor();
  const pressed = await page.getByTestId(`disk-folder-entry-${NOTE}`).getAttribute('aria-pressed');
  check('6 Back restores Recent with selection', pressed === 'true', `aria-pressed=${pressed}`);

  // 3. Save a description: organized just now; failed save creates no activity.
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.getByLabel('Description').fill('A brief note');
  const beforeSave = await readActivity();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved').waitFor();
  await page.getByText(/Organized just now/).first().waitFor();
  const afterSave = await readActivity();
  const noteRecord = afterSave.items.find((i) => i.path === NOTE);
  check('3 save marks the note organized', !!noteRecord?.organizedAt && !beforeSave.items.find((i) => i.path === NOTE)?.organizedAt);
  check('3 save captured the item UUID', typeof noteRecord?.id === 'string', String(noteRecord?.id));
} catch (error) {
  check('phase 1 threw', false, String(error));
}
check('no renderer errors in phase 1', errors.length === 0, errors.join(' | '));
await app.close();

// 2. Restart: Recent remains and restoration adds no timestamps.
const snapshot = await readActivity();
({ app, page, errors } = await launch());
try {
  await gotoHash(page, '#/files?mode=browse&collection=recent');
  await page.getByTestId('files-recent').waitFor();
  const rows = page.locator('[data-testid^="disk-folder-entry-"]');
  await rows.first().waitFor();
  check('2 Recent survives restart', (await rows.count()) === 2, `${await rows.count()} rows`);
  const after = await readActivity();
  check('2 restoration adds no activity', JSON.stringify(after) === JSON.stringify(snapshot));

  // 11. Rename through Opal keeps the row and its activity.
  await page.getByTestId(`disk-folder-entry-${NOTE}`).click();
  await page.getByRole('button', { name: 'Show in folder' }).click();
  await page.getByTestId('breadcrumb').waitFor();
  const selectedInFolder = await page.getByTestId(`disk-folder-entry-${NOTE}`).getAttribute('aria-pressed');
  check('Show in folder lands selected', selectedInFolder === 'true');
  // Rename through the app's own dialog (Return on the selected row).
  await page.getByTestId(`disk-folder-entry-${NOTE}`).focus();
  await page.keyboard.press('Enter');
  const nameInput = page.getByTestId('name-dialog-input');
  await nameInput.waitFor();
  await nameInput.fill('renamed.md');
  await page.getByTestId('name-dialog-submit').click();
  const RENAMED = `${vault}/Notes/renamed.md`;
  await page.getByTestId(`disk-folder-entry-${RENAMED}`).waitFor();
  const renamedActivity = await readActivity();
  const renamedRecord = renamedActivity.items.find((i) => i.path === RENAMED);
  check('11 rename remaps activity to the new path', !!renamedRecord && !renamedActivity.items.find((i) => i.path === NOTE));
  check('11 renamed item keeps its UUID and history', renamedRecord?.id === snapshot.items.find((i) => i.path === NOTE)?.id && renamedRecord?.openedAt === snapshot.items.find((i) => i.path === NOTE)?.openedAt);

  // 13. Clear recent activity leaves files intact.
  await page.getByRole('link', { name: 'Recent' }).click();
  await page.getByTestId('files-recent').waitFor();
  await page.getByRole('button', { name: 'Clear recent activity' }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByText('Items you open or work on will appear here.').waitFor();
  const cleared = await readActivity();
  check('13 clear empties activity', cleared.items.length === 0);
  const noteBytes = await readFile(RENAMED, 'utf8');
  check('13 files and metadata untouched by clear', noteBytes.includes('A brief note') && noteBytes.includes('Hello.'));
} catch (error) {
  check('phase 2 threw', false, String(error));
}
check('no renderer errors in phase 2', errors.length === 0, errors.join(' | '));
await app.close();

await rm(userData, { recursive: true, force: true });
await rm(vaultParent, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
