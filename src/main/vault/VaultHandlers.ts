import type { IpcMain } from "electron";
import path from "path";
import { MARKDOWN_DOCUMENT_LIMIT } from "@/types/markdown";
import type { VaultResult } from "@/types/vault";
import { validDraft } from "./DraftRepository";
import { validDate } from "@/common/vaultModel";
import type { VaultService } from "./VaultService";

const nonempty = (value: unknown, limit = 32768): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= limit &&
  !value.includes("\0");
const target = (value: unknown): value is string =>
  nonempty(value) && path.isAbsolute(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && validDate(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MARKDOWN_DOCUMENT_LIMIT;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const invalid = (): VaultResult<never> => ({
  success: false,
  error: "Invalid vault request.",
});

export class VaultHandlers {
  constructor(
    private deps: { ipc: Pick<IpcMain, "handle">; service: VaultService },
  ) {}
  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle("vault:discover", () => this.respond(() => service.discover()));
    ipc.handle("vault:read-day", (_, root: unknown, day: unknown) =>
      target(root) && date(day)
        ? this.respond(() => service.readDay(root, day))
        : invalid(),
    );
    ipc.handle("vault:create-day", (_, root: unknown, day: unknown) =>
      target(root) && date(day)
        ? this.respond(() => service.createDay(root, day))
        : invalid(),
    );
    ipc.handle(
      "vault:save-journal",
      (_, file: unknown, original: unknown, next: unknown) =>
        target(file) && text(original) && text(next)
          ? this.respond(() => service.saveJournal(file, original, next))
          : invalid(),
    );
    ipc.handle(
      "vault:add-focus",
      (_, root: unknown, day: unknown, input: unknown) => {
        if (
          !target(root) ||
          !date(day) ||
          !record(input) ||
          !nonempty(input.title, 2000) ||
          (input.taskId !== undefined && !nonempty(input.taskId, 2000)) ||
          Object.keys(input).some((key) => key !== "title" && key !== "taskId")
        )
          return invalid();
        const clean = {
          title: input.title,
          ...(input.taskId === undefined
            ? {}
            : { taskId: input.taskId as string }),
        };
        return this.respond(() => service.addFocus(root, day, clean));
      },
    );
    ipc.handle(
      "vault:update-focus",
      (_, root: unknown, day: unknown, id: unknown, patch: unknown) => {
        if (
          !target(root) ||
          !date(day) ||
          !nonempty(id, 200) ||
          !record(patch) ||
          !Object.keys(patch).length ||
          Object.keys(patch).some(
            (key) => key !== "completed" && key !== "remove",
          ) ||
          (patch.completed !== undefined &&
            typeof patch.completed !== "boolean") ||
          (patch.remove !== undefined && typeof patch.remove !== "boolean") ||
          (patch.completed === undefined && patch.remove !== true)
        )
          return invalid();
        const clean = {
          completed: patch.completed as boolean | undefined,
          remove: patch.remove as boolean | undefined,
        };
        return this.respond(() => service.updateFocus(root, day, id, clean));
      },
    );
    ipc.handle("vault:list-drafts", () =>
      this.respond(() => service.listDrafts()),
    );
    ipc.handle("vault:put-draft", (_, draft: unknown) =>
      validDraft(draft) && target(draft.path)
        ? this.respond(() => service.putDraft(draft))
        : invalid(),
    );
    ipc.handle("vault:clear-draft", (_, file: unknown, version: unknown) =>
      target(file) && nonempty(version, 200)
        ? this.respond(() => service.clearDraft(file, version))
        : invalid(),
    );
  }

  private async respond<T>(
    operation: () => Promise<T>,
  ): Promise<VaultResult<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "The vault request could not be completed.",
      };
    }
  }
}
