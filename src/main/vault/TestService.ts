import { randomUUID } from "crypto";
import { constants } from "fs";
import { mkdir, open, rename, stat, unlink } from "fs/promises";
import path from "path";
import type { RootRegistry } from "@/main/fs/RootRegistry";
import { filesystemMutationQueue } from "@/main/fs/MutationQueue";
import { isInsideRoot, normalizePath } from "@/main/fs/paths";
import { validDate } from "@/common/vaultModel";
import {
  TESTS_FOLDER,
  answerName,
  cleanReason,
  currentTest,
  parseDailyTest,
  parseTestAnswer,
  testDates,
  testName,
} from "@/common/dailyTest";
import { VARIANTS, parseVariantSides } from "@/common/variants";
import type {
  DailyTest,
  TestAnswer,
  TestAnswerResult,
  TestChoice,
  VariantSide,
  VariantSides,
  VaultTest,
  VaultTestChange,
} from "@/types/dailyTest";
import { inVault, openedVault } from "./vaultPaths";

export interface TestServiceDependencies {
  registry: RootRegistry;
  /** `<userData>/variants.json`: the side each variant is on, on this Mac. */
  variantsFile: string;
  /** The variants this build knows. Tests pass their own; the app uses the registry in `src/common/variants.ts`. */
  known?: readonly string[];
  now?: () => Date;
  /** Called when a folder's current test reads differently on disk. */
  onChanged?: (change: VaultTestChange) => void;
}

/** Test and answer files are small; anything larger is not one. */
const JSON_LIMIT = 64 * 1024;

/**
 * The daily A/B test. Agents write `Library/tests/<date> test.json`; Opal
 * reads it, says which test is current, and writes the answer beside it.
 * Every path a test names goes through the registry, so a hidden or outside
 * file makes the test no test. The side each variant is on is kept per Mac
 * in `<userData>/variants.json`.
 */
export class TestService {
  private watched = new Map<string, { today: string; json: string }>();
  private sidesQueue: Promise<unknown> = Promise.resolve();

  constructor(private deps: TestServiceDependencies) {}

  private get known(): readonly string[] {
    return this.deps.known ?? VARIANTS;
  }

  /** The current test of the opened folder `target` on `today`, or null when there is none. */
  async test(target: string, today: string): Promise<VaultTest | null> {
    if (typeof today !== "string" || !validDate(today)) throw new Error("Choose a valid calendar date.");
    const root = await openedVault(this.deps.registry, target);
    const current = await this.read(root, today);
    this.watched.delete(root);
    this.watched.set(root, { today, json: JSON.stringify(current) });
    return current;
  }

  /**
   * Writes the answer to the test of `date` in one step, replacing an earlier
   * one, and leaves an interface test's variant on the chosen side (A for
   * neither). Refused when that date's test is not the one with `id`.
   */
  async answer(target: string, date: string, id: string, choice: TestChoice, reason: string): Promise<TestAnswerResult> {
    if (!validDate(date)) throw new Error("Choose a valid calendar date.");
    const root = await openedVault(this.deps.registry, target);
    const test = await this.readTest(root, date);
    if (!test || test.id !== id) throw new Error("This test changed on disk. Look at it again.");
    const answer: TestAnswer = {
      version: 1,
      id: test.id,
      choice,
      reason: cleanReason(reason),
      answeredAt: (this.deps.now?.() ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    await filesystemMutationQueue.run(async () => {
      const folder = path.join(root, TESTS_FOLDER);
      await inVault(root, folder);
      await this.deps.registry.assertAllowed(folder);
      const file = await inVault(root, path.join(folder, answerName(date)), true);
      await writeJson(file, answer);
    });
    let sides = await this.sides();
    if (test.kind === "interface" && test.variant && this.known.includes(test.variant)) {
      sides = await this.setSide(test.variant, choice === "b" ? "b" : "a");
    }
    return { answer, sides };
  }

  /** The side each variant is on. A variant not listed is on A. */
  async sides(): Promise<VariantSides> {
    return parseVariantSides(await readJson(this.deps.variantsFile));
  }

  /** Puts a variant this build knows on a side, kept across launches and updates. */
  async setSide(name: string, side: VariantSide): Promise<VariantSides> {
    if (!this.known.includes(name)) throw new Error("This build does not have that variant.");
    const work = this.sidesQueue.then(async () => {
      const sides = await this.sides();
      if (side === "b") sides[name] = "b";
      else delete sides[name];
      await mkdir(path.dirname(this.deps.variantsFile), { recursive: true });
      await writeJson(this.deps.variantsFile, { version: 1, sides });
      return sides;
    });
    this.sidesQueue = work.catch(() => undefined);
    return work;
  }

  /** Takes the directories the disk watcher reports, and reports each folder whose current test reads differently. */
  async changed(directories: readonly string[]): Promise<void> {
    for (const [root, watched] of [...this.watched]) {
      if (!directories.some((directory) => this.touches(root, directory))) continue;
      let json: string;
      try {
        json = JSON.stringify(await this.read(root, watched.today));
      } catch {
        this.watched.delete(root);
        continue;
      }
      const current = this.watched.get(root);
      if (!current || current.json === json) continue;
      current.json = json;
      this.deps.onChanged?.({ root });
    }
  }

  private touches(root: string, directory: string): boolean {
    const normalized = normalizePath(directory);
    if (!isInsideRoot(root, normalized)) return false;
    const relative = path.posix.relative(normalizePath(root), normalized);
    return ["", "Library", TESTS_FOLDER].includes(relative);
  }

  private async read(root: string, today: string): Promise<VaultTest | null> {
    const days = await Promise.all(
      testDates(today).map(async (date) => {
        const test = await this.readTest(root, date);
        const answer = test ? parseTestAnswer(await this.vaultJson(root, answerName(date))) : null;
        return { date, test, answer };
      }),
    );
    const current = currentTest(today, days);
    return current ? { root, date: current.date, test: current.test, answer: current.answer } : null;
  }

  /** A date's test with its paths made absolute, or null when it is missing, malformed, or names a file it may not. */
  private async readTest(root: string, date: string): Promise<DailyTest | null> {
    const test = parseDailyTest(await this.vaultJson(root, testName(date)));
    if (!test) return null;
    try {
      if (test.kind === "page") {
        return {
          ...test,
          a: { ...test.a, path: await this.file(root, test.a.path as string) },
          b: { ...test.b, path: await this.file(root, test.b.path as string) },
        };
      }
      const where = test.where === null || test.where === "daily" || test.where === "recent" ? test.where : await this.file(root, test.where);
      return { ...test, where };
    } catch {
      return null;
    }
  }

  /** A file a test names, from the folder's top, checked against the registry. Throws when refused. */
  private async file(root: string, relative: string): Promise<string> {
    const absolute = await inVault(root, path.join(root, ...relative.split("/")));
    const real = await this.deps.registry.assertAllowed(absolute);
    if (!(await stat(real)).isFile()) throw new Error("Not a file.");
    return real;
  }

  /** A file in the tests folder, parsed, or null when it is missing, hidden, a link, too large or not JSON. */
  private async vaultJson(root: string, name: string): Promise<unknown> {
    try {
      const file = await inVault(root, path.join(root, TESTS_FOLDER, name));
      await this.deps.registry.assertAllowed(file);
      return await readJson(file);
    } catch {
      return null;
    }
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > JSON_LIMIT) return null;
      return JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Writes JSON beside `file` and renames it into place, so a reader never sees half of it. */
async function writeJson(file: string, contents: unknown): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o644);
    try {
      await handle.writeFile(`${JSON.stringify(contents, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
