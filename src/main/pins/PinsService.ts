import { randomUUID } from "crypto";
import { constants } from "fs";
import { mkdir, open, rename, stat, unlink } from "fs/promises";
import path from "path";
import { filesystemMutationQueue } from "@/main/fs/MutationQueue";
import { isInsideRoot, normalizePath } from "@/main/fs/paths";
import type { RootRegistry } from "@/main/fs/RootRegistry";
import { inVault, openedVault } from "@/main/vault/vaultPaths";
import type { RootPins } from "@/types/pins";

/** Where an opened folder keeps its pins, so git carries them to the other Macs. */
export const PINS_FOLDER = ".opal";
export const PINS_FILE = "pins.json";
/** The most pins one folder keeps. */
export const PINS_LIMIT = 500;
/** A pins file larger than this is not one Opal wrote. */
const FILE_LIMIT = 256 * 1024;

interface PinsFile {
  version: 1;
  /** Paths from the folder's top, with forward slashes, in display order. */
  pins: string[];
}

/** The absolute path a stored entry names, or null when it is not a path inside `root`. */
function fromStored(root: string, entry: unknown): string | null {
  if (typeof entry !== "string" || !entry || entry.includes("\0") || entry.includes("\\")) return null;
  if (path.posix.isAbsolute(entry)) return null;
  const absolute = normalizePath(path.join(root, ...entry.split("/")));
  return absolute !== root && isInsideRoot(root, absolute) ? absolute : null;
}

/**
 * The pins a file's text lists. Anything that is not a version 1 list reads
 * as no pins; entries outside the folder are dropped.
 */
export function parsePins(root: string, text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const file = parsed as Partial<PinsFile> | null;
  if (!file || typeof file !== "object" || file.version !== 1 || !Array.isArray(file.pins)) return [];
  const pins: string[] = [];
  for (const entry of file.pins) {
    const absolute = fromStored(root, entry);
    if (absolute && !pins.includes(absolute)) pins.push(absolute);
  }
  return pins.slice(0, PINS_LIMIT);
}

/** Reads and writes each opened folder's `.opal/pins.json`. */
export class PinsService {
  constructor(private deps: { registry: RootRegistry }) {}

  /**
   * Every opened folder's pins, in the order the folders were opened. A
   * missing, unreadable or malformed file reads as no pins and is left as it
   * is. Reads wait in the write queue, so a list never misses a write the
   * renderer sent before it.
   */
  list(): Promise<RootPins[]> {
    return filesystemMutationQueue.run(async () => {
      const result: RootPins[] = [];
      for (const root of this.deps.registry.list()) {
        const pins = await this.read(root);
        result.push({ root, pins, missing: await this.missing(pins) });
      }
      return result;
    });
  }

  /**
   * Replaces an opened folder's pins with `paths`, in that order. The folder
   * goes through the root registry. The pins are names to keep, not files
   * read here, so each only has to sit inside that folder; a pinned file
   * can be missing until a pull brings it.
   */
  set(target: string, paths: readonly string[]): Promise<RootPins> {
    return filesystemMutationQueue.run(async () => {
      const root = await openedVault(this.deps.registry, target);
      const pins = [...new Set(paths.map(normalizePath))];
      if (pins.length > PINS_LIMIT) throw new Error("That is too many pins.");
      const stored = pins.map((pin) => {
        if (pin === root || !isInsideRoot(root, pin))
          throw new Error("Only files inside the folder can be pinned.");
        return path.relative(root, pin).split(path.sep).join("/");
      });
      await this.write(root, { version: 1, pins: stored });
      return { root, pins, missing: await this.missing(pins) };
    });
  }

  private async read(root: string): Promise<string[]> {
    let handle;
    try {
      // inVault refuses a symlinked .opal or pins.json; O_NOFOLLOW covers a swap since.
      const file = await inVault(root, path.join(root, PINS_FOLDER, PINS_FILE));
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return [];
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > FILE_LIMIT) return [];
      return parsePins(root, await handle.readFile("utf8"));
    } catch {
      return [];
    } finally {
      await handle.close();
    }
  }

  /** The pins that are not a file inside an opened folder now. */
  private async missing(pins: readonly string[]): Promise<string[]> {
    const gone: string[] = [];
    for (const pin of pins) {
      try {
        if ((await stat(await this.deps.registry.assertAllowed(pin))).isFile()) continue;
      } catch {
        /* Not there. */
      }
      gone.push(pin);
    }
    return gone;
  }

  private async write(root: string, contents: PinsFile): Promise<void> {
    const folder = path.join(root, PINS_FOLDER);
    const file = path.join(folder, PINS_FILE);
    await inVault(root, folder, true);
    await mkdir(folder, { recursive: true });
    await inVault(root, folder);
    await inVault(root, file, true);
    const temporary = path.join(folder, `.${PINS_FILE}-${randomUUID()}`);
    try {
      const handle = await open(temporary, "wx", 0o644);
      try {
        await handle.writeFile(`${JSON.stringify(contents, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      // A rename replaces the file in one step, so a reader or a commit never
      // sees half a list. It replaces a link itself rather than its target.
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
