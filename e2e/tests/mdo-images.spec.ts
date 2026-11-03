import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, readdir, readFile, realpath, writeFile } from "fs/promises";
import path from "path";
import { crc32, deflateSync } from "zlib";
import { expect, test } from "../fixtures/electronApp";
import { createTempVault, seedRoots, type TempVault } from "../helpers/tempVault";

const PROJECT_ROOT = path.join(__dirname, "../..");

let vault: TempVault;
let root: string;
let app: ElectronApplication | null = null;

test.beforeEach(async ({ userDataDir }) => {
  vault = await createTempVault();
  root = await realpath(vault.root);
  await seedRoots(userDataDir, [root]);
});

test.afterEach(async () => {
  await app?.close();
  app = null;
  await vault.cleanup();
});

/** A grey PNG saved at 144 dpi, as macOS saves a Retina screenshot. */
function retinaPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("pHYs", density),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function launch(userDataDir: string): Promise<Page> {
  app = await electron.launch({
    args: [PROJECT_ROOT],
    env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function openDocument(page: Page, file: string) {
  await page.evaluate(([target, from]) => {
    window.location.hash = `#/files?mode=focus&dir=${encodeURIComponent(from)}&file=${encodeURIComponent(target)}`;
  }, [file, path.dirname(file)]);
  await expect(page.locator(".cm-md-inline-title")).toHaveText(path.basename(file, ".mdo"));
}

/** Every file below `folder`, by its path from there. */
async function filesBelow(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)));
}

test("a pasted screenshot is stored in the files folder, embedded at its on-screen width, and still shows after a reload", async ({ userDataDir }) => {
  await mkdir(path.join(root, ".opal"), { recursive: true });
  await writeFile(path.join(root, ".opal", "files.json"), JSON.stringify({ version: 1, folder: "Library/files", store: "folder" }));
  const doc = path.join(root, "Plan.mdo");
  await writeFile(doc, "Intro\n");
  const page = await launch(userDataDir);
  await openDocument(page, doc);
  await page.getByText("Intro").click();

  // A synthetic paste, so the system clipboard is never touched.
  await page.evaluate((bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], "screenshot.png", { type: "image/png" }));
    document.querySelector(".cm-content")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, [...retinaPng(40, 20)]);

  const files = path.join(root, "Library", "files");
  await expect.poll(() => filesBelow(files)).toEqual([expect.stringMatching(/^\d{4}-\d{2}\/screenshot\.[0-9a-f]{8}\.png$/)]);
  const [stored] = await filesBelow(files);
  // 40 pixels at 144 dpi are 20 points.
  await expect.poll(() => readFile(doc, "utf8")).toBe(`Intro\n![[Library/files/${stored}|20]]\n`);
  const image = page.locator(".cm-md-image img");
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(40);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openDocument(page, doc);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(40);
  expect(await image.evaluate((element: HTMLImageElement) => element.style.width)).toBe("20px");
});
