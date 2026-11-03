// The look gallery: opens every fixture document in e2e/fixtures/gallery in
// the built app and saves it light and dark, at 700 and 420 pixels wide, as
// PNGs with one index.html to look through. A fixture taller than the window
// is saved in parts, one per screen. Screenshots are for people;
// nothing compares them. Own userData and temp vault; run from the
// repository root after the Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/gallery.mjs [area] [--out dir]
//
// `area` renders only e2e/fixtures/gallery/<area>.mdo. The output folder is
// --out, then OPAL_GALLERY_OUT, then e2e/out/gallery.
import { _electron as electron } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const FIXTURES = path.join(PROJECT_ROOT, 'e2e', 'fixtures', 'gallery');
const THEMES = ['light', 'dark'];
const WIDTHS = [700, 420];
const HEIGHT = 1400;

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = path.resolve(outFlag !== -1 ? args[outFlag + 1] : process.env.OPAL_GALLERY_OUT ?? path.join('e2e', 'out', 'gallery'));
const area = args.find((arg, index) => !arg.startsWith('--') && (outFlag === -1 || index !== outFlag + 1)) ?? null;

const fixtures = (await readdir(FIXTURES)).filter((name) => name.endsWith('.mdo')).sort()
  .filter((name) => !area || name === `${area}.mdo`);
if (fixtures.length === 0) {
  console.log(`FAIL no fixture${area ? ` named ${area}.mdo` : ''} in ${FIXTURES}`);
  process.exit(1);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-gallery-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-gallery-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Gallery'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
for (const name of fixtures) await copyFile(path.join(FIXTURES, name), path.join(vault, 'Gallery', name));
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(outDir, { recursive: true });

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

/** Sizes the window so the page's editor is `width` pixels wide. */
async function sizeEditor(width) {
  const setContent = (w, h) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h), { w, h });
  await setContent(width + 600, HEIGHT);
  await page.waitForTimeout(150);
  const chrome = await page.evaluate(() => window.innerWidth - (document.querySelector('.opal-editor')?.getBoundingClientRect().width ?? window.innerWidth));
  await setContent(Math.round(width + chrome), HEIGHT);
  // The window has a minimum width, so a narrow page is set on the editor itself.
  await page.evaluate((w) => { for (const editor of document.querySelectorAll('.opal-editor')) editor.style.maxWidth = `${w}px`; }, width);
  await page.waitForTimeout(250);
}

/**
 * Scrolls the page to screen `part` (overlapping by 80 pixels) and gives
 * back how many screens it takes. The page scrolls in the nearest scrolling
 * box around the editor's text.
 */
async function scrollToPart(part) {
  const parts = await page.evaluate((target) => {
    let scroller = document.scrollingElement;
    for (let node = document.querySelector('.cm-content'); node; node = node.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
        scroller = node;
        break;
      }
    }
    const step = Math.max(1, scroller.clientHeight - 80);
    scroller.scrollTop = target * step;
    return Math.max(1, Math.ceil((scroller.scrollHeight - scroller.clientHeight) / step) + 1);
  }, part);
  await page.waitForTimeout(200);
  return parts;
}

async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
}

const shots = [];
let failed = false;
try {
  for (const name of fixtures) {
    const file = path.join(vault, 'Gallery', name);
    await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, file);
    await page.getByTestId('markdown-editor').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    for (const theme of THEMES) {
      await setTheme(theme);
      for (const width of WIDTHS) {
        await sizeEditor(width);
        // A fixture taller than the window goes in parts, one per screen, so nothing below the fold is missed.
        const parts = await scrollToPart(0);
        for (let part = 0; part < parts; part += 1) {
          await scrollToPart(part);
          const png = `${name.replace(/\.mdo$/, '')}-${theme}-${width}${part > 0 ? `-${part + 1}` : ''}.png`;
          await page.locator('.opal-editor').first().screenshot({ path: path.join(outDir, png) });
          shots.push({ name, theme, width, png, part });
        }
        await scrollToPart(0);
        console.log(`PASS ${name} ${theme} ${width}px, ${parts} part${parts === 1 ? '' : 's'}`);
      }
    }
  }
} catch (error) {
  failed = true;
  console.log(`FAIL ${String(error)}`);
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rows = [...new Set(shots.map((shot) => shot.name))].map((name) => `
  <section>
    <h2>${escape(name)}</h2>
    <div class="row">${shots.filter((shot) => shot.name === name).map((shot) => `
      <figure><img src="${shot.png}" width="${shot.width}" alt="${escape(`${name}, ${shot.theme}, ${shot.width}px, part ${shot.part + 1}`)}"><figcaption>${shot.theme} · ${shot.width}px${shot.part > 0 ? ` · part ${shot.part + 1}` : ''}</figcaption></figure>`).join('')}
    </div>
  </section>`).join('');
await writeFile(path.join(outDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opal look gallery</title>
<style>
  body { margin: 0; padding: 24px; background: #f5f5f5; color: #262626; font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 24px; color: #6b6b6b; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .row { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; padding-bottom: 8px; }
  figure { margin: 0; flex-shrink: 0; }
  img { display: block; border: 1px solid #d4d4d4; border-radius: 8px; }
  figcaption { margin-top: 6px; color: #6b6b6b; font-size: 12px; }
</style>
</head>
<body>
<h1>Opal look gallery</h1>
<p>${shots.length} screenshots of ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}, ${new Date().toISOString()}.</p>
${rows}
</body>
</html>
`);
console.log(`${failed || errors.length > 0 ? 'FAIL' : 'PASS'} gallery written to ${path.join(outDir, 'index.html')}${errors.length > 0 ? ` with page errors: ${errors.join(' | ')}` : ''}`);
process.exit(failed || errors.length > 0 ? 1 : 0);
