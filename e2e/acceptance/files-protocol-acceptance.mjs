// Disposable Electron acceptance for files in the main process: opal-file://
// ranges and headers, HTML that never runs, a movie whose index is at its end
// seeking to the end, image widths over IPC, opening an LFS file from a
// read-only copy, launchers shown in Finder, thumbnails and a HEIC display
// copy, Copy file handing over a writable copy named without the hash, and
// the text viewer reading an LFS file's bytes. Own userData and
// temp vault; shell.openPath, showItemInFolder and the clipboard are stubbed
// in the main process, so nothing opens and the pasteboard is untouched.
// Run from the repository root after the Vite bundles are built:
//
//   node e2e/acceptance/files-protocol-acceptance.mjs [--shots dir]
//
// --shots saves light and dark screenshots of the text viewer and a page.
import { _electron as electron } from '@playwright/test';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { deflateSync, crc32 } from 'zlib';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const shotsFlag = args.indexOf('--shots');
const shotsDir = shotsFlag !== -1 ? path.resolve(args[shotsFlag + 1]) : null;
const run = promisify(execFile);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A grey PNG saved at 144 dpi, as macOS saves a Retina screenshot. */
function retinaPng(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const density = Buffer.alloc(9);
  density.writeUInt32BE(5669, 0);
  density.writeUInt32BE(5669, 4);
  density[8] = 1;
  const rows = Buffer.alloc(height * (1 + width * 3), 0x80);
  for (let y = 0; y < height; y += 1) rows[y * (1 + width * 3)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('pHYs', density), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** A one-page PDF Chromium and Quick Look can draw. */
function pdf(text) {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Writes `bytes` as a Git LFS object and `file` as its placeholder. */
async function lfs(vault, file, bytes) {
  const oid = createHash('sha256').update(bytes).digest('hex');
  const object = path.join(vault, '.git/lfs/objects', oid.slice(0, 2), oid.slice(2, 4), oid);
  await mkdir(path.dirname(object), { recursive: true });
  await writeFile(object, bytes);
  await writeFile(file, `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`);
}

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-files-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-files-vault-'));
await mkdir(path.join(vaultParent, 'Vault/Library/files/2026-11'), { recursive: true });
await mkdir(path.join(vaultParent, 'Vault/.git'), { recursive: true });
await mkdir(path.join(vaultParent, 'Vault/.opal'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const files = path.join(vault, 'Library/files/2026-11');
await writeFile(path.join(vault, '.opal/files.json'), JSON.stringify({ version: 1, folder: 'Library/files', store: 'git-lfs' }));
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));

const BYTES = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
await writeFile(path.join(files, 'bytes.bin'), BYTES);
await writeFile(path.join(files, 'page.a1b2c3d4.html'), '<!doctype html><title>static</title><script>document.title = "ran"</script><p>hello</p>');
await writeFile(path.join(files, 'q3.a1b2c3d4.pdf'), pdf('Q3 report'));
await lfs(vault, path.join(files, 'deck.b2c3d4e5.pdf'), pdf('Deck from LFS'));
const CSV = 'week,orders,minutes per order\n2026-10-05,412,3.9\n2026-10-12,455,3.6\n2026-10-19,501,3.4\n2026-10-26,548,3.1\n';
await lfs(vault, path.join(files, 'throughput.c3d4e5f6.csv'), Buffer.from(CSV));
await writeFile(path.join(files, 'deploy.command'), '#!/bin/sh\necho never\n');
await writeFile(path.join(files, 'diagram.f6a7b8c9.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#888"/><script>parent.postMessage("ran", "*")</script></svg>');
await writeFile(path.join(vault, 'Plan.mdo'), 'Screenshots from the review:\n');

// A movie written with its index after the media, as cameras save them.
let movie = null;
try {
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-y', path.join(files, 'clip.d4e5f6a7.mp4')], { timeout: 60_000 });
  movie = path.join(files, 'clip.d4e5f6a7.mp4');
} catch (error) {
  console.log(`SKIP movie checks: ffmpeg could not make a test movie (${String(error).split('\n')[0]})`);
}
// A HEIC made from a PNG with sips, as an iPhone photo would arrive.
let heic = null;
try {
  await writeFile(path.join(userData, 'source.png'), retinaPng(64, 48));
  await run('/usr/bin/sips', ['-s', 'format', 'heic', path.join(userData, 'source.png'), '--out', path.join(files, 'img-2041.e5f6a7b8.heic')], { timeout: 60_000 });
  heic = path.join(files, 'img-2041.e5f6a7b8.heic');
} catch {
  console.log('SKIP HEIC check: sips could not write HEIC here');
}

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

const url = (file) => `opal-file://${file.split('/').map(encodeURIComponent).join('/')}`;
/** A request from the main process, which goes through the opal-file handler as the page's <img> and <video> do. */
const request = (target, headers = {}) => app.evaluate(async ({ net }, { target, headers }) => {
  const response = await net.fetch(target, { headers });
  const body = Buffer.from(await response.arrayBuffer()).toString('latin1');
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}, { target, headers });

try {
  // Stubs in the main process, so nothing opens and the clipboard is untouched.
  await app.evaluate(({ shell, clipboard }) => {
    globalThis.__opened = [];
    globalThis.__revealed = [];
    shell.openPath = async (file) => { globalThis.__opened.push(file); return ''; };
    shell.showItemInFolder = (file) => { globalThis.__revealed.push(file); };
    clipboard.writeBuffer = (type, buffer) => { globalThis.__pasteboard = { type, url: buffer.toString() }; };
  });

  const ranged = await request(url(path.join(files, 'bytes.bin')), { Range: 'bytes=10-19' });
  check('a Range request is answered 206 with Content-Range', ranged.status === 206 && ranged.headers['content-range'] === `bytes 10-19/${BYTES.length}` && ranged.body === 'abcdefghij', `${ranged.status} ${ranged.headers['content-range']}`);
  const past = await request(url(path.join(files, 'bytes.bin')), { Range: `bytes=${BYTES.length}-` });
  check('a range past the end is 416 with bytes */size', past.status === 416 && past.headers['content-range'] === `bytes */${BYTES.length}`);
  const html = await request(url(path.join(files, 'page.a1b2c3d4.html')));
  const responses = [ranged, past, html, await request(url(path.join(files, 'deck.b2c3d4e5.pdf'))), await request(url(path.join(vault, '..', 'outside.png')))];
  check('no opal-file response carries Access-Control-Allow-Origin', responses.every((response) => !('access-control-allow-origin' in response.headers)));
  check('every opal-file response carries nosniff', responses.every((response) => response.headers['x-content-type-options'] === 'nosniff'));
  check('HTML carries only its own sandbox policy, which loads nothing', html.headers['content-security-policy'] === "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", html.headers['content-security-policy']);

  // HTML loaded as a page in its own window runs no script.
  const title = await app.evaluate(async ({ BrowserWindow }, target) => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      await window.loadURL(target);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return window.webContents.getTitle();
    } finally {
      window.destroy();
    }
  }, url(path.join(files, 'page.a1b2c3d4.html')));
  check('HTML from opal-file runs no script', title === 'static', `title: ${title}`);

  // An SVG still draws in <img> under its sandbox policy, as a note's picture.
  const svgWidth = await page.evaluate(async (target) => {
    const image = new Image();
    image.src = target;
    await image.decode().catch(() => undefined);
    return image.naturalWidth;
  }, url(path.join(files, 'diagram.f6a7b8c9.svg')));
  check('an SVG from the vault still draws in <img>', svgWidth === 120, `${svgWidth} px`);

  // The page can't read files or the web with fetch: connect-src has neither.
  const fetched = await page.evaluate(async (targets) => Promise.all(targets.map((target) => fetch(target).then(() => 'read', () => 'blocked'))), [url(path.join(files, 'bytes.bin')), 'https://example.com/']);
  check('the page can fetch neither opal-file: nor https:', fetched.every((answer) => answer === 'blocked'), fetched.join(', '));

  if (movie) {
    const seek = await page.evaluate(async (target) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = target;
      document.body.append(video);
      try {
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error(video.error?.message ?? 'error')); setTimeout(() => reject(new Error('no metadata')), 10_000); });
        const duration = video.duration;
        video.currentTime = duration - 0.2;
        await new Promise((resolve, reject) => { video.onseeked = resolve; setTimeout(() => reject(new Error('no seek')), 10_000); });
        return { duration, at: video.currentTime, width: video.videoWidth };
      } finally {
        video.remove();
      }
    }, url(movie)).catch((error) => ({ error: String(error) }));
    check('a video on an opal-file mp4 seeks to its end', !seek.error && Math.abs(seek.at - (seek.duration - 0.2)) < 0.15 && seek.duration > 3.5, JSON.stringify(seek));
    const info = await page.evaluate((target) => window.filesAPI.info(target), movie);
    check('files:info reads the movie\'s duration and size from its headers', info.success && Math.abs(info.data.duration - 4) < 0.2 && info.data.width === 320 && info.data.height === 240, JSON.stringify(info.data));
  }

  const lfsInfo = await page.evaluate((target) => window.filesAPI.info(target), path.join(files, 'deck.b2c3d4e5.pdf'));
  check('files:info reads an LFS PDF from its object', lfsInfo.success && lfsInfo.data.status === 'lfs-present' && lfsInfo.data.pages === 1 && lfsInfo.data.oid?.length === 64, JSON.stringify(lfsInfo.data));

  const opened = await page.evaluate((target) => window.filesAPI.open(target), path.join(files, 'deck.b2c3d4e5.pdf'));
  const openedPath = (await app.evaluate(() => globalThis.__opened))[0];
  const copyMode = openedPath ? (await stat(openedPath)).mode & 0o777 : 0;
  const copyBytes = openedPath ? await readFile(openedPath) : Buffer.alloc(0);
  check('Open on an LFS file opens a read-only copy of the real file, named without the hash, and says so',
    opened.success && opened.data.notice === "Opened a read-only copy. Changes won't reach the vault." && openedPath?.startsWith(userData) && path.basename(openedPath) === 'deck.pdf' && copyMode === 0o444 && copyBytes.subarray(0, 8).toString() === '%PDF-1.4',
    `${openedPath} ${copyMode.toString(8)}`);

  // Copy file: Slack and Finder get a writable file named as the page shows it, which outlives quitting.
  const copied = await page.evaluate((target) => window.filesAPI.copyFile(target), path.join(files, 'deck.b2c3d4e5.pdf'));
  const pasteboard = await app.evaluate(() => globalThis.__pasteboard ?? null);
  const pasted = pasteboard?.url?.startsWith('file:') ? fileURLToPath(pasteboard.url) : '';
  const pastedMode = pasted ? (await stat(pasted)).mode & 0o777 : 0;
  check('Copy file puts a writable copy named without the hash on the pasteboard, outside the copies removed on quit',
    copied.success && pasteboard?.type === 'public.file-url' && path.basename(pasted) === 'deck.pdf' && pastedMode === 0o644 && pasted.startsWith(userData) && !pasted.includes('open-copies'),
    `${pasted} ${pastedMode.toString(8)}`);
  const appUsed = opened.success ? opened.data.app : null;
  check('Open names the app it uses', typeof appUsed === 'string' && appUsed.length > 0, String(appUsed));

  const command = await page.evaluate((target) => window.filesAPI.open(target), path.join(files, 'deploy.command'));
  const external = await page.evaluate((target) => window.diskAPI.openExternal(target), path.join(files, 'deploy.command'));
  const revealed = await app.evaluate(() => globalThis.__revealed);
  const openedAfter = await app.evaluate(() => globalThis.__opened);
  check('a .command file only reveals, from Open and from Open in default app', command.data?.action === 'revealed' && external.data?.action === 'revealed' && revealed.length === 2 && openedAfter.length === 1);

  const outsideFile = path.join(vaultParent, 'statement.pdf');
  await writeFile(outsideFile, pdf('Outside'));
  const asked = await page.evaluate((target) => window.filesAPI.open(target), outsideFile);
  check('a file outside the vault asks first, naming the app', asked.success && asked.data.action === 'confirm' && (await app.evaluate(() => globalThis.__opened)).length === 1, JSON.stringify(asked.data));

  if (shotsDir) await mkdir(shotsDir, { recursive: true });
  const started = Date.now();
  const thumbnail = await page.evaluate((target) => window.filesAPI.thumbnail(target, 128, { visible: true }), path.join(files, 'q3.a1b2c3d4.pdf'));
  const drawn = Buffer.from((thumbnail.data ?? ',').split(',')[1], 'base64');
  const drawnWidth = drawn.length > 24 ? drawn.readUInt32BE(16) : 0;
  check('a PDF gets a thumbnail from macOS as a data: URL', thumbnail.success && /^data:image\/png;base64,/.test(thumbnail.data ?? '') && drawnWidth > 0 && drawnWidth <= 256, `${drawnWidth} pixels wide for 128 points, in ${Date.now() - started} ms`);
  if (shotsDir) await writeFile(path.join(shotsDir, 'pdf-thumbnail.png'), drawn);
  const lfsThumbnail = await page.evaluate((target) => window.filesAPI.thumbnail(target, 64), path.join(files, 'deck.b2c3d4e5.pdf'));
  check('an LFS PDF gets a thumbnail drawn from its read-only copy', lfsThumbnail.success && /^data:image\/png;base64,/.test(lfsThumbnail.data ?? ''));
  if (movie) {
    const still = await page.evaluate((target) => window.filesAPI.thumbnail(target, 128), movie);
    check('a movie gets a thumbnail', still.success && /^data:image\//.test(still.data ?? ''), still.success ? `${(still.data ?? '').length} characters` : still.error);
  }
  await writeFile(path.join(files, 'unknown.zzqq'), 'bytes');
  const noApp = await page.evaluate((target) => window.filesAPI.appName(target), path.join(files, 'unknown.zzqq'));
  check('a type no app opens has no app name, and no error', noApp.success && noApp.data === null, JSON.stringify(noApp));
  const htmlThumbnail = await page.evaluate((target) => window.filesAPI.thumbnail(target, 128), path.join(files, 'page.a1b2c3d4.html'));
  check('HTML gets no thumbnail', htmlThumbnail.success && htmlThumbnail.data === null);

  if (heic) {
    const copy = await page.evaluate((target) => window.filesAPI.rendition(target), heic);
    check('a HEIC in the vault shows through a JPEG copy', copy.success && /^data:image\/jpeg;base64,/.test(copy.data?.url ?? '') && copy.data.width === 64, JSON.stringify({ width: copy.data?.width, height: copy.data?.height }));
  }

  // The text viewer shows an LFS CSV's rows, not its pointer.
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, path.join(files, 'throughput.c3d4e5f6.csv'));
  const viewer = page.getByTestId('text-viewer');
  await viewer.waitFor({ timeout: 10_000 });
  const shown = await viewer.textContent();
  check('the text viewer reads an LFS file\'s bytes, not its pointer', shown?.includes('2026-10-26,548,3.1') && !shown.includes('git-lfs'), shown?.slice(0, 40));
  if (shotsDir) {
    await mkdir(shotsDir, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((resolved) => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(resolved); }, theme);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(shotsDir, `text-viewer-lfs-${theme}.png`) });
    }
  }

  // A pasted Retina screenshot is embedded at its on-screen width, read over IPC.
  const doc = path.join(vault, 'Plan.mdo');
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, doc);
  await page.locator('.cm-content').waitFor({ timeout: 10_000 });
  await page.getByText('Screenshots from the review:').click();
  await page.keyboard.press('End');
  await page.evaluate((bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], 'Screen Shot.png', { type: 'image/png' }));
    document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, [...retinaPng(640, 360)]);
  let written = '';
  for (let tries = 0; tries < 50 && !/\|320\]\]/.test(written); tries += 1) {
    await page.waitForTimeout(100);
    written = await readFile(doc, 'utf8');
  }
  check('a pasted Retina screenshot is embedded at half its pixel width, read through files:info', /!\[\[Library\/files\/\d{4}-\d{2}\/screen-shot\.[0-9a-f]{8}\.png\|320\]\]/.test(written), written.split('\n')[1]);
  if (shotsDir) {
    await page.locator('.cm-md-image img').first().waitFor({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((resolved) => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(resolved); }, theme);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shotsDir, `pasted-screenshot-${theme}.png`) });
    }
  }
} catch (error) {
  check('the run finished', false, String(error));
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

if (errors.length > 0) check('no page errors', false, errors.join(' | '));
const failed = results.filter((result) => !result.ok).length;
console.log(`${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks`);
process.exit(failed === 0 ? 0 : 1);
