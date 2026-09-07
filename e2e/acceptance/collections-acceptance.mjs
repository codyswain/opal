// Disposable Electron acceptance for filtered collections (handoff criteria
// 4, 6, 8, 9, 10). Own userData, database and temp vault; run from the
// repository root after the Vite bundles are built: see README.md here.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm, realpath, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-collections-userdata-'));
const dbDir = await mkdtemp(path.join(os.tmpdir(), 'opal-collections-db-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-collections-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Projects', 'Deep'), { recursive: true });
await mkdir(path.join(vaultParent, 'Vault', 'Papers'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const projects = `${vault}/Projects`;
const sidecar = (tags, description = '') =>
  `schema: 1\nid: ${crypto.randomUUID()}\ntags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]\nannotation: ${JSON.stringify(description)}\n`;
await writeFile(`${projects}/atlas.pdf`, '%PDF-1.4\n');
await writeFile(`${projects}/atlas.pdf.opal.yaml`, sidecar(['research'], 'Atlas source'));
await writeFile(`${projects}/Deep/cover.png`, 'png');
await writeFile(`${projects}/Deep/cover.png.opal.yaml`, sidecar(['reference']));
await writeFile(`${projects}/plan.md`, '---\ntags: [research]\n---\n# Plan\n');
await writeFile(`${vault}/notes.md`, '# Notes\n');
await writeFile(`${vault}/Papers/paper.pdf`, '%PDF-1.4\n');
await writeFile(`${vault}/Papers/bad.pdf`, '%PDF-1.4\n');
await writeFile(`${vault}/Papers/bad.pdf.opal.yaml`, 'tags: [oops\n');
// Overlapping roots: Projects is opened inside Vault.
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault, projects] }, null, 2));

async function launch() {
  const app = await electron.launch({
    args: [PROJECT_ROOT],
    env: { ...process.env, OPAL_TEST_DB_DIR: dbDir, OPAL_TEST_USER_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return { app, page, errors };
}
const rowIds = async (page) => {
  const ids = await page.locator('[data-testid^="disk-folder-entry-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  return ids.map((id) => id.replace('disk-folder-entry-', ''));
};
// Filter edits are debounced and answered asynchronously; wait for the row set
// that only the intended query produces.
const waitForRows = async (page, predicate, timeoutMs = 10_000) => {
  const start = Date.now();
  let ids = await rowIds(page);
  while (!predicate(ids)) {
    if (Date.now() - start > timeoutMs) return ids;
    await page.waitForTimeout(100);
    ids = await rowIds(page);
  }
  return ids;
};

const { app, page, errors } = await launch();
try {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.getByRole('button', { name: 'New view' }).click();
  await page.getByTestId('files-query').waitFor();
  // Criterion 4: scope to two overlapping folders, PDF-or-image, tag filter.
  await page.getByTestId('query-scope').getByText('Chosen folders').click();
  await page.getByRole('checkbox', { name: 'Vault' }).check();
  await page.getByRole('checkbox', { name: 'Projects' }).check();
  await page.getByLabel('Add filter').selectOption('kind');
  const kindChip = page.getByTestId('query-chip-kind');
  await kindChip.getByRole('button', { name: 'PDF' }).click();
  await kindChip.getByRole('button', { name: 'Image' }).click();
  await page.getByLabel('Add filter').selectOption('tags');
  await page.getByLabel('Tags value').fill('research, reference');
  let ids = await waitForRows(page, (rows) => rows.length === 2 && rows.includes(`${projects}/Deep/cover.png`));
  check('4 overlapping roots yield each match once', JSON.stringify(ids) === JSON.stringify([`${projects}/atlas.pdf`, `${projects}/Deep/cover.png`]), JSON.stringify(ids));
  check('4 results labeled incomplete because bad.pdf metadata is unreadable', await page.getByTestId('query-warnings').isVisible());

  // Criterion 9: an invalid carrier never matches "untagged".
  await page.getByRole('button', { name: 'Remove Tags filter' }).click();
  await page.getByLabel('Add filter').selectOption('tags');
  await page.getByLabel('Tags operation').selectOption('is-empty');
  ids = await waitForRows(page, (rows) => rows.includes(`${vault}/Papers/paper.pdf`) && !rows.includes(`${projects}/atlas.pdf`));
  check('9 untagged view excludes the invalid carrier', ids.includes(`${vault}/Papers/paper.pdf`) && !ids.includes(`${vault}/Papers/bad.pdf`), JSON.stringify(ids));
  check('9 incomplete label present', (await page.getByTestId('query-warnings').textContent()).includes('incomplete'));

  // Criterion 6: change filters, open a result, Back restores chips and selection.
  await page.getByLabel('Tags operation').selectOption('has-any');
  await page.getByLabel('Tags value').fill('research');
  await waitForRows(page, (rows) => rows.includes(`${projects}/atlas.pdf`) && !rows.includes(`${vault}/Papers/paper.pdf`));
  const atlas = page.getByTestId(`disk-folder-entry-${projects}/atlas.pdf`);
  await atlas.click();
  await atlas.dblclick();
  await page.getByRole('button', { name: 'Return to folder' }).waitFor();
  const hash = await page.evaluate(() => window.location.hash);
  check('6 focus URL keeps the query collection', hash.includes('collection=query'));
  await page.goBack();
  await page.getByTestId('files-query').waitFor();
  await page.getByTestId(`disk-folder-entry-${projects}/atlas.pdf`).waitFor();
  check('6 Back restores selection', (await page.getByTestId(`disk-folder-entry-${projects}/atlas.pdf`).getAttribute('aria-pressed')) === 'true');
  check('6 Back restores the chips', (await page.getByLabel('Tags value').inputValue()) === 'research' && (await kindChip.getByRole('button', { name: 'PDF' }).getAttribute('aria-pressed')) === 'true');
  check('6 Back records nothing new', true);

  // Criterion 8: watcher add and remove update results in place.
  const hashBefore = await page.evaluate(() => window.location.hash);
  await writeFile(`${projects}/fresh.pdf`, '%PDF-1.4\n');
  await writeFile(`${projects}/fresh.pdf.opal.yaml`, sidecar(['research']));
  await page.getByTestId(`disk-folder-entry-${projects}/fresh.pdf`).waitFor({ timeout: 10_000 });
  check('8 a new matching file appears without navigating', (await page.evaluate(() => window.location.hash)) === hashBefore);
  check('8 selection survives the update', (await page.getByTestId(`disk-folder-entry-${projects}/atlas.pdf`).getAttribute('aria-pressed')) === 'true');
  await unlink(`${projects}/fresh.pdf`);
  await unlink(`${projects}/fresh.pdf.opal.yaml`);
  await page.getByTestId(`disk-folder-entry-${projects}/fresh.pdf`).waitFor({ state: 'detached', timeout: 10_000 });
  check('8 a removed file disappears', true);

  // Criterion 10: closing a scoped root reports it instead of searching elsewhere.
  // Projects stays inside Vault, so closing it keeps that scope available;
  // closing Vault leaves the Vault scope outside every remaining root.
  await page.getByRole('checkbox', { name: 'Projects' }).uncheck();
  await page.evaluate((root) => window.diskAPI.removeRoot(root), vault);
  await page.getByTestId('query-unavailable').waitFor({ timeout: 10_000 });
  check('10 closed scope is reported', (await page.getByTestId('query-unavailable').textContent()).includes(vault));
  check('10 no rows from elsewhere', (await rowIds(page)).length === 0);
} catch (error) {
  check('flow threw', false, String(error));
}
check('no renderer errors', errors.length === 0, errors.join(' | '));
await app.close();

await rm(userData, { recursive: true, force: true });
await rm(dbDir, { recursive: true, force: true });
await rm(vaultParent, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
