import { createHash, randomUUID } from "crypto";
import { constants } from "fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "fs/promises";
import path from "path";
import { MutationQueue } from "@/main/fs/MutationQueue";
import { MARKDOWN_DOCUMENT_LIMIT } from "@/types/markdown";
import type { JournalDraft } from "@/types/vault";

export function validDraft(value: unknown): value is JournalDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as JournalDraft;
  return (
    typeof draft.path === "string" &&
    draft.path.length > 0 &&
    draft.path.length <= 32768 &&
    typeof draft.baseJournal === "string" &&
    draft.baseJournal.length <= MARKDOWN_DOCUMENT_LIMIT &&
    typeof draft.text === "string" &&
    draft.text.length <= MARKDOWN_DOCUMENT_LIMIT &&
    typeof draft.version === "string" &&
    draft.version.length > 0 &&
    draft.version.length <= 200
  );
}

/** Version equality prevents a completed save from removing a newer edit. */
export class DraftRepository {
  private queue = new MutationQueue();
  constructor(
    private directory: string,
    private canonicalPath: (target: string) => Promise<string>,
  ) {}

  private file(target: string): string {
    return path.join(
      this.directory,
      `${createHash("sha256").update(target).digest("hex")}.json`,
    );
  }

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("The recovery folder is not a private directory.");
    await chmod(this.directory, 0o700);
  }

  private async read(file: string): Promise<JournalDraft> {
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MARKDOWN_DOCUMENT_LIMIT * 12 + 65536
    )
      throw new Error("The recovery draft has an unsupported format.");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: unknown;
    try {
      data = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
    if (
      !data ||
      typeof data !== "object" ||
      (data as { format?: number }).format !== 1 ||
      !validDraft((data as { draft?: unknown }).draft)
    )
      throw new Error("The recovery draft has an unsupported format.");
    return (data as { draft: JournalDraft }).draft;
  }

  list(): Promise<JournalDraft[]> {
    return this.queue.run(async () => {
      await this.prepare();
      const drafts: JournalDraft[] = [];
      for (const name of await readdir(this.directory)) {
        if (!/^[a-f\d]{64}\.json$/.test(name)) continue;
        // Revoked roots and malformed files stay on disk but are never exposed.
        try {
          const file = path.join(this.directory, name);
          const draft = await this.read(file);
          const canonical = await this.canonicalPath(draft.path);
          if (canonical === draft.path && file === this.file(canonical))
            drafts.push(draft);
        } catch {
          continue;
        }
      }
      return drafts;
    });
  }

  put(input: JournalDraft): Promise<undefined> {
    return this.queue.run(async () => {
      if (!validDraft(input)) throw new Error("Invalid recovery draft.");
      const canonical = await this.canonicalPath(input.path);
      const draft: JournalDraft = {
        path: canonical,
        baseJournal: input.baseJournal,
        text: input.text,
        version: input.version,
      };
      await this.prepare();
      const temporary = path.join(this.directory, `.draft-${randomUUID()}`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ format: 1, draft }), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file(canonical));
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return undefined;
    });
  }

  clear(target: string, version: string): Promise<undefined> {
    return this.queue.run(async () => {
      if (typeof version !== "string" || !version || version.length > 200)
        throw new Error("Invalid recovery version.");
      const canonical = await this.canonicalPath(target);
      await this.prepare();
      const file = this.file(canonical);
      try {
        const current = await this.read(file);
        if (current.path === canonical && current.version === version)
          await unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return undefined;
    });
  }
}
