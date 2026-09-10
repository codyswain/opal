import { describe, expect, it, vi } from "vitest";
import type { IpcMain } from "electron";
import { VaultHandlers } from "@/main/vault/VaultHandlers";
import type { VaultService } from "@/main/vault/VaultService";

describe("Vault IPC validation", () => {
  it("rejects malformed arguments before touching the filesystem", async () => {
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const service = {
      readDay: vi.fn(),
      createDay: vi.fn(),
      saveJournal: vi.fn(),
      addFocus: vi.fn(),
      updateFocus: vi.fn(),
      putDraft: vi.fn(),
      clearDraft: vi.fn(),
    };
    new VaultHandlers({
      ipc: {
        handle: (
          name: string,
          handler: (...args: unknown[]) => Promise<unknown>,
        ) => handlers.set(name, handler),
      } as unknown as IpcMain,
      service: service as unknown as VaultService,
    }).registerAll();
    for (const [channel, args] of [
      ["read-day", ["/vault", "2026-02-30"]],
      ["create-day", [null, "2026-09-08"]],
      ["save-journal", ["/vault/a.md", {}, "text"]],
      ["add-focus", ["/vault", "2026-09-08", { title: " " }]],
      ["update-focus", ["/vault", "2026-09-08", "id", { completed: "yes" }]],
      ["update-focus", ["/vault", "2026-09-08", "id", {}]],
      ...[" ", "x".repeat(2001), 42, "bad\0title"].map(title =>
        ["update-focus", ["/vault", "2026-09-08", "id", { title }]]),
      ["put-draft", [{ path: "/x", text: "x", version: "v" }]],
      ["clear-draft", ["/x", ""]],
    ] as Array<[string, unknown[]]>) {
      expect(
        await handlers.get(`vault:${channel}`)?.({}, ...args),
      ).toMatchObject({ success: false, error: "Invalid vault request." });
    }
    Object.values(service).forEach((method) =>
      expect(method).not.toHaveBeenCalled(),
    );
    await handlers.get("vault:update-focus")?.({}, "/vault", "2026-09-08", "id", { title: "Revised task" });
    expect(service.updateFocus).toHaveBeenCalledWith("/vault", "2026-09-08", "id", expect.objectContaining({ title: "Revised task" }));
  });
});
