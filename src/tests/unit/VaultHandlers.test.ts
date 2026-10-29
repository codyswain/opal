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
      createDay: vi.fn(),
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
      ["create-day", [null, "2026-09-08"]],
      ["create-day", ["relative", "2026-09-08"]],
      ["create-day", ["/vault", "2026-02-30"]],
    ] as Array<[string, unknown[]]>) {
      expect(
        await handlers.get(`vault:${channel}`)?.({}, ...args),
      ).toMatchObject({ success: false, error: "Invalid vault request." });
    }
    Object.values(service).forEach((method) =>
      expect(method).not.toHaveBeenCalled(),
    );
    await handlers.get("vault:create-day")?.({}, "/vault", "2026-09-08");
    expect(service.createDay).toHaveBeenCalledWith("/vault", "2026-09-08");
  });
});
