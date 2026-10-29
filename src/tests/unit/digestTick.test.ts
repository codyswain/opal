// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { parseDigest } from "@/common/dayModel";
import type { DayDigestItem } from "@/types/day";
import { MarkdownConflictError, MarkdownDocumentService } from "@/main/fs/MarkdownDocumentService";
import { RootRegistry } from "@/main/fs/RootRegistry";
import { VaultService } from "@/main/vault/VaultService";
import { isDigestPath } from "@/main/vault/vaultPaths";

const DIGEST = [
  "---",
  "written_by: ai",
  "---",
  "# Digest, Thu 2026-10-29 (scheduled, 07:00)",
  "",
  "## Top 3",
  "",
  "- [ ] **Answer Tom on the 409A price and early exercise**",
  "  Ask Orrick at the 2:00 call. (reply drafted)",
  "- [x] **Tell Richard Hurley that Friday 2pm PT works**",
  "",
  "## Also worth doing",
  "",
  "- [ ] **High: Grant Sol access to the Onshape static-neck document**",
  "",
  "## Notes",
  "",
  "- [ ] Not an item.",
  "",
];

describe("ticking a digest checkbox", () => {
  let temporary: string, root: string, file: string, registry: RootRegistry, service: VaultService;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "opal-digest-"));
    registry = new RootRegistry({ storePath: path.join(temporary, "roots.json") });
    await mkdir(path.join(temporary, "vault/Library/digests"), { recursive: true });
    await mkdir(path.join(temporary, "vault/Library/daily"), { recursive: true });
    root = await registry.add(path.join(temporary, "vault"));
    file = path.join(root, "Library/digests/2026-10-29 digest.md");
    service = new VaultService({ registry, documents: new MarkdownDocumentService({ registry }) });
  });
  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  /** The items as the day sidebar reads them. */
  const items = async () => parseDigest(await readFile(file, "utf8")).groups.flatMap((group) => group.items);
  /** Where a checkbox item is. */
  const where = (item: DayDigestItem | undefined) => item?.at ?? { line: -1, raw: "" };

  it("changes only the character between the brackets, and back", async () => {
    const source = DIGEST.join("\n");
    await writeFile(file, source);
    const [first] = await items();
    expect(first.at).toEqual({ line: 4, raw: "- [ ] **Answer Tom on the 409A price and early exercise**" });

    const tick = await service.checkDigestItem(root, file, where(first).line, where(first).raw, true);
    expect(tick).toEqual({ line: 4, raw: "- [x] **Answer Tom on the 409A price and early exercise**", checked: true });
    const ticked = await readFile(file, "utf8");
    expect(ticked).toBe(source.replace("- [ ] **Answer Tom", "- [x] **Answer Tom"));
    expect([...ticked].filter((char, index) => char !== source[index])).toEqual(["x"]);
    expect((await items())[0].checked).toBe(true);

    await service.checkDigestItem(root, file, tick.line, tick.raw, false);
    expect(await readFile(file, "utf8")).toBe(source);
    // No temporary file is left beside the digest.
    expect(await readdir(path.dirname(file))).toEqual(["2026-10-29 digest.md"]);
  });

  it("keeps CRLF line endings and a BOM, and counts lines from the end of the frontmatter", async () => {
    const source = `\ufeff${DIGEST.join("\r\n")}`;
    await writeFile(file, source);
    const also = where((await items()).find((item) => item.text.startsWith("Grant Sol")));
    await service.checkDigestItem(root, file, also.line, also.raw, true);
    expect(await readFile(file, "utf8")).toBe(source.replace("- [ ] **High", "- [x] **High"));
  });

  it("refuses a line that changed since it was read, and a checkbox outside the two lists", async () => {
    await writeFile(file, DIGEST.join("\n"));
    const [first] = await items();
    // The routine rewrote the item after the sidebar read it.
    await writeFile(file, DIGEST.join("\n").replace("409A price", "409A price today"));
    await expect(service.checkDigestItem(root, file, where(first).line, where(first).raw, true)).rejects.toBeInstanceOf(
      MarkdownConflictError,
    );
    // A line moved down by one is not the line that was read.
    await writeFile(file, ["", ...DIGEST].join("\n"));
    await expect(service.checkDigestItem(root, file, where(first).line, where(first).raw, true)).rejects.toThrow(
      "This item changed in the digest since it was read.",
    );
    await writeFile(file, DIGEST.join("\n"));
    const notes = DIGEST.indexOf("- [ ] Not an item.") - 3;
    await expect(service.checkDigestItem(root, file, notes, "- [ ] Not an item.", true)).rejects.toThrow(
      "This item changed in the digest since it was read.",
    );
    expect(await readFile(file, "utf8")).toBe(DIGEST.join("\n"));
  });

  it("refuses any file but a digest, and any line that is not a checkbox", async () => {
    const daily = path.join(root, "Library/daily/2026-10-29.md");
    await writeFile(daily, "- [ ] A task on Cody's page\n");
    await expect(service.checkDigestItem(root, daily, 0, "- [ ] A task on Cody's page", true)).rejects.toThrow(
      "Only a digest's checkboxes can be ticked here.",
    );
    expect(await readFile(daily, "utf8")).toBe("- [ ] A task on Cody's page\n");
    await writeFile(file, DIGEST.join("\n"));
    await expect(service.checkDigestItem(root, file, 4, "## Top 3", true)).rejects.toThrow("not a digest checkbox");
    await expect(service.checkDigestItem(path.join(root, "Library"), file, 4, DIGEST[7], true)).rejects.toThrow();
    await expect(service.checkDigestItem(root, path.join(temporary, "elsewhere.md"), 4, DIGEST[7], true)).rejects.toThrow();
  });

  it("names digests by the vault layout", () => {
    expect(isDigestPath("Library/digests/2026-10-29 digest.md")).toBe(true);
    expect(isDigestPath("Inbox/Digests/2026-10-29.md")).toBe(true);
    expect(isDigestPath("Library/digests/2026-10-29.md")).toBe(false);
    expect(isDigestPath("Inbox/Digests/2026-10-29 digest.md")).toBe(false);
    expect(isDigestPath("Library/digests/sub/2026-10-29 digest.md")).toBe(false);
    expect(isDigestPath("Library/daily/2026-10-29.md")).toBe(false);
  });
});
