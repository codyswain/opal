import { constants, type Dirent } from "fs";
import { lstat, open, readdir } from "fs/promises";
import path from "path";
import type { RootRegistry } from "@/main/fs/RootRegistry";
import { normalizePath } from "@/main/fs/paths";
import { splitFrontmatter } from "@/common/dayModel";
import {
  PEEK_BYTES,
  TRANSCRIPTS_FOLDER,
  dailyDetail,
  dailyHeadDate,
  dailyStreamNames,
  isBlankPage,
  isStackHead,
  isStackKind,
  leadingHeading,
  readOnlyRule,
  sessionDetail,
  sessionLabel,
  sessionStarted,
  transcriptName,
} from "@/common/stackModel";
import { localDate } from "@/common/vaultModel";
import type { StackKind, StackSection, VaultStack } from "@/types/stack";
import { DAY_LAYOUT, inVault, missing, openedVault } from "./vaultPaths";

export interface StackServiceDependencies {
  registry: RootRegistry;
  /** Today's date; a parameter so tests can fix it. */
  today?: () => string;
}

/** Files read at once while checking past daily pages. */
const READ_CONCURRENCY = 16;
/** Peeked files kept; a vault has a few hundred daily pages. */
const CACHE_LIMIT = 4000;

interface Peeked {
  mtimeMs: number;
  size: number;
  blank: boolean;
  /** The frontmatter's fields, when the block closes within the peek. */
  fields: Record<string, unknown>;
  heading: StackSection["textHeading"];
}

interface FileFacts {
  size: number;
  mtimeMs: number;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const noteName = (file: string) => path.basename(file).replace(/\.md$/i, "");

/**
 * The files a stack shows, in order. The renderer never lists vault folders
 * itself: it asks here with the stack's kind and head, and gets back each
 * section's path, label and defaults. Every path is checked against the
 * opened vault, and links are refused.
 */
export class StackService {
  private peeked = new Map<string, Peeked>();

  constructor(private deps: StackServiceDependencies) {}

  async stack(target: string, kind: StackKind, head: string): Promise<VaultStack> {
    if (!isStackKind(kind)) throw new Error("Choose a known kind of stack.");
    if (typeof head !== "string" || !path.isAbsolute(head)) throw new Error("Choose a page in the vault.");
    const root = await openedVault(this.deps.registry, target);
    const file = await inVault(root, normalizePath(head));
    if (!isStackHead(kind, normalizePath(path.relative(root, file)))) throw new Error("This page does not start a stack.");
    switch (kind) {
      case "daily":
        return this.daily(root, file);
      case "recording":
        return this.recording(root, file);
      case "chat":
        return this.chat(root, file);
    }
  }

  /**
   * Today's stream: the head, then every earlier daily page in
   * `Library/daily`, newest first. Past pages with an empty body are left
   * out; the head always shows.
   */
  private async daily(root: string, head: string): Promise<VaultStack> {
    const folder = path.join(root, DAY_LAYOUT.daily);
    if (path.dirname(head) !== folder) throw new Error("This page does not start a stack.");
    const headDate = dailyHeadDate(head) as string;
    const today = this.deps.today?.() ?? localDate();
    const names = dailyStreamNames((await this.entries(folder)).filter((entry) => entry.isFile()).map((entry) => entry.name), headDate);
    const past = await mapLimited(names, READ_CONCURRENCY, async (name) => {
      const file = path.join(folder, name);
      const facts = await this.peek(file);
      return facts && !facts.blank ? { file, facts } : null;
    });
    const section = (file: string, facts: FileFacts, role: StackSection["role"]): StackSection => {
      const date = dailyHeadDate(file) as string;
      return {
        path: file,
        label: noteName(file),
        detail: dailyDetail(date, today),
        role,
        defaultOpen: true,
        readOnly: readOnlyRule(file),
        textHeading: null,
        size: facts.size,
        mtimeMs: facts.mtimeMs,
      };
    };
    const headFacts = (await this.facts(head)) ?? { size: 0, mtimeMs: 0 };
    return {
      kind: "daily",
      head,
      sections: [
        section(head, headFacts, "head"),
        ...past.flatMap((found) => (found ? [section(found.file, found.facts, "part")] : [])),
      ],
      folders: [folder],
    };
  }

  /**
   * A recording page: the summary file, then its transcript file,
   * `transcripts/<stem> transcript.md`, open by default. A recording not
   * split yet is one file and shows alone.
   */
  private async recording(root: string, head: string): Promise<VaultStack> {
    const folder = path.join(root, DAY_LAYOUT.recordings);
    if (path.dirname(head) !== folder) throw new Error("This page does not start a stack.");
    const transcripts = path.join(folder, TRANSCRIPTS_FOLDER);
    const transcript = path.join(transcripts, transcriptName(path.basename(head)));
    const [headFacts, peeked] = await Promise.all([this.facts(head), this.peek(transcript)]);
    const sections = [this.head(head, headFacts)];
    if (peeked) {
      sections.push({
        path: transcript,
        label: "Transcript",
        detail: null,
        role: "part",
        defaultOpen: true,
        readOnly: readOnlyRule(transcript),
        textHeading: peeked.heading,
        size: peeked.size,
        mtimeMs: peeked.mtimeMs,
      });
    }
    return { kind: "recording", head, sections, folders: [folder, transcripts] };
  }

  /**
   * A chat page: the thread card, then the sessions in
   * `Library/chats/<thread>/`, newest first. The newest is open and the
   * older ones start folded. A file there that is not a thread card shows
   * alone.
   */
  private async chat(root: string, head: string): Promise<VaultStack> {
    const folder = path.join(root, DAY_LAYOUT.chats);
    if (path.dirname(head) !== folder) throw new Error("This page does not start a stack.");
    const thread = path.join(folder, noteName(head));
    const card = await this.peek(head);
    const sections = [this.head(head, card)];
    if (card?.fields.type !== "thread") return { kind: "chat", head, sections, folders: [folder] };
    const names = (await this.entries(thread))
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => entry.name);
    const found = await mapLimited(names, READ_CONCURRENCY, async (name) => {
      const file = path.join(thread, name);
      const peeked = await this.peek(file);
      return peeked ? { name, file, peeked, started: sessionStarted(peeked.fields, name) } : null;
    });
    const sessions = found
      .filter((session): session is NonNullable<typeof session> => session !== null)
      .sort((a, b) => b.started.localeCompare(a.started) || b.name.localeCompare(a.name));
    sections.push(
      ...sessions.map(({ name, file, peeked }, index): StackSection => ({
        path: file,
        label: sessionLabel(peeked.fields, name),
        detail: sessionDetail(peeked.fields),
        role: "part",
        defaultOpen: index === 0,
        readOnly: readOnlyRule(file),
        textHeading: peeked.heading,
        size: peeked.size,
        mtimeMs: peeked.mtimeMs,
      })),
    );
    return { kind: "chat", head, sections, folders: [folder, thread] };
  }

  /** A recording or chat page's head, titled by its file name as it is opened alone. */
  private head(file: string, facts: FileFacts | null): StackSection {
    return {
      path: file,
      label: noteName(file),
      detail: null,
      role: "head",
      defaultOpen: true,
      readOnly: readOnlyRule(file),
      textHeading: null,
      size: facts?.size ?? 0,
      mtimeMs: facts?.mtimeMs ?? 0,
    };
  }

  private async entries(folder: string): Promise<Dirent[]> {
    try {
      const info = await lstat(folder);
      if (!info.isDirectory()) return [];
      return (await readdir(folder, { withFileTypes: true })).filter((entry) => !entry.name.startsWith("."));
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }

  private async facts(file: string): Promise<FileFacts | null> {
    try {
      const info = await lstat(file);
      return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  /**
   * A regular file's size and time, whether its body is empty, its
   * frontmatter and the heading it starts with. Read again only when it
   * changed; links are refused.
   */
  private async peek(file: string): Promise<Peeked | null> {
    try {
      const info = await lstat(file);
      if (!info.isFile()) return null;
      const known = this.peeked.get(file);
      if (known && known.mtimeMs === info.mtimeMs && known.size === info.size) return known;
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) return null;
        const buffer = Buffer.alloc(Math.min(opened.size, PEEK_BYTES));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const start = buffer.subarray(0, bytesRead).toString("utf8");
        const value: Peeked = {
          mtimeMs: opened.mtimeMs,
          size: opened.size,
          // A page longer than the peek has a body, whatever its frontmatter.
          blank: opened.size <= PEEK_BYTES && isBlankPage(start),
          fields: splitFrontmatter(start).data,
          heading: leadingHeading(start),
        };
        if (this.peeked.size >= CACHE_LIMIT) this.peeked.clear();
        this.peeked.set(file, value);
        return value;
      } finally {
        await handle.close();
      }
    } catch {
      this.peeked.delete(file);
      return null;
    }
  }
}
