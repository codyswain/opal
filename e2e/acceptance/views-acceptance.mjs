// Disposable Electron acceptance for saved views (handoff criteria 5, 12, 13
// plus a restart). Own userData and temp vault; copy next to
// run from the repository root after the Vite bundles are built.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-views-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-views-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Projects'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const projects = `${vault}/Projects`;
const atlasSidecar = `schema: 1\nid: ${crypto.randomUUID()}\ntags: [research]\nannotation: Atlas source\n`;
await writeFile(`${projects}/atlas.pdf`, '%PDF-1.4\n');
await writeFile(`${projects}/atlas.pdf.opal.yaml`, atlasSidecar);
await writeFile(`${vault}/notes.md`, '# Notes\n');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
const viewsDir = path.join(userData, 'library', 'views');

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
const viewFiles = async () => (await readdir(viewsDir).catch(() => [])).filter((name) => name.endsWith('.yaml') && !name.startsWith('.'));

let { app, page, errors } = await launch();
let viewFile = null;
try {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.getByRole('button', { name: 'New view' }).click();
  await page.getByTestId('files-query').waitFor();
  await page.getByLabel('Add filter').selectOption('kind');
  await page.getByTestId('query-chip-kind').getByRole('button', { name: 'PDF' }).click();
  await page.getByLabel('Sort by').selectOption('modified');
  await page.getByTestId('disk-folder-view-gallery').click();
  await page.getByTestId(`disk-folder-entry-${projects}/atlas.pdf`).waitFor();
  await page.getByRole('button', { name: 'Save view' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('View name').fill('Project references');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await page.locator('[data-testid="query-header"] input[aria-label="View name"]').waitFor();
  await page.waitForFunction(() => window.location.hash.includes('collection=view'));
  const files = await viewFiles();
  viewFile = files[0] ? path.join(viewsDir, files[0]) : null;
  check('5 view file written', files.length === 1, files.join(','));
  const yaml = viewFile ? await readFile(viewFile, 'utf8') : '';
  check('5 file holds name, layout, query only', yaml.includes('name: Project references') && yaml.includes('layout: gallery') && yaml.includes('field: modified') && yaml.includes('field: kind') && !/selected|scroll|result/.test(yaml));
  check('5 sidebar lists the view', await page.getByRole('link', { name: 'Project references' }).isVisible());
} catch (error) {
  check('phase 1 threw', false, String(error));
}
check('no renderer errors in phase 1', errors.length === 0, errors.join(' | '));
await app.close();

// Restart: definition persists and reopens with scope, filters, sort and layout.
({ app, page, errors } = await launch());
try {
  await page.evaluate(() => { window.location.hash = '#/files'; });
  await page.getByRole('link', { name: 'Project references' }).click();
  await page.getByTestId('files-query').waitFor();
  check('5 reopens by name after restart', (await page.getByLabel('View name').inputValue()) === 'Project references');
  check('5 filters persist', (await page.getByTestId('query-chip-kind').getByRole('button', { name: 'PDF' }).getAttribute('aria-pressed')) === 'true');
  check('5 sort persists', (await page.getByLabel('Sort by').inputValue()) === 'modified');
  check('5 layout persists', (await page.getByTestId('disk-folder-view-gallery').getAttribute('aria-pressed')) === 'true');
  await page.getByTestId(`disk-folder-entry-${projects}/atlas.pdf`).waitFor();
  check('5 no Edited badge on reopen', (await page.getByTestId('view-edited').count()) === 0);

  // Criterion 12: an external edit while a draft exists.
  await page.getByLabel('Add filter').selectOption('description');
  await page.getByTestId('view-edited').waitFor();
  const original = await readFile(viewFile, 'utf8');
  const external = original.replace('name: Project references', 'name: Externally renamed');
  await writeFile(viewFile, external);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByTestId('view-conflict').waitFor();
  check('12 conflict detected on save', true);
  check('12 external file untouched', (await readFile(viewFile, 'utf8')) === external);
  check('12 draft edits retained', (await page.getByTestId('query-chip-description').count()) === 1);
  await page.getByTestId('view-conflict').getByRole('button', { name: 'Save as new' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('View name').fill('My edits');
  await dialog.getByRole('button', { name: 'Save as new' }).click();
  await page.waitForFunction((id) => !window.location.hash.includes(id), path.basename(viewFile, '.yaml'));
  const files = await viewFiles();
  check('12 both states recoverable as two files', files.length === 2 && (await readFile(viewFile, 'utf8')) === external, files.join(','));
  check('12 sidebar shows both', (await page.getByRole('link', { name: 'Externally renamed' }).count()) === 1 && (await page.getByRole('link', { name: 'My edits' }).count()) === 1);

  // Criterion 13: removing a view leaves files and metadata intact; undo restores it.
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('group', { name: 'Confirm removing this view' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByTestId('files-recent').waitFor();
  const afterRemove = await viewFiles();
  check('13 definition removed', afterRemove.length === 1 && (await readdir(path.join(viewsDir, '.trash'))).length === 1, afterRemove.join(','));
  check('13 files and metadata untouched', (await readFile(`${projects}/atlas.pdf.opal.yaml`, 'utf8')) === atlasSidecar && (await readFile(`${projects}/atlas.pdf`, 'utf8')) === '%PDF-1.4\n');
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('link', { name: 'My edits' }).waitFor({ timeout: 10_000 });
  check('13 undo restores the view', (await viewFiles()).length === 2);
} catch (error) {
  check('phase 2 threw', false, String(error));
}
check('no renderer errors in phase 2', errors.length === 0, errors.join(' | '));
await app.close();

await rm(userData, { recursive: true, force: true });
await rm(vaultParent, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
