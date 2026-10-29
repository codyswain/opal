import { describe, expect, it, vi } from "vitest";
import type { IpcMain } from "electron";
import { VaultHandlers } from "@/main/vault/VaultHandlers";
import type { VaultService } from "@/main/vault/VaultService";
import type { DayService } from "@/main/vault/DayService";

const DIGEST = "/vault/Library/digests/2026-09-08 digest.md";
const LINE = "- [ ] **Answer Tom on the 409A price**";

describe("Vault IPC validation", () => {
  it("rejects malformed arguments before touching the filesystem", async () => {
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const service = {
      createDay: vi.fn(),
      checkDigestItem: vi.fn(),
    };
    const days = {
      day: vi.fn(),
    };
    new VaultHandlers({
      ipc: {
        handle: (
          name: string,
          handler: (...args: unknown[]) => Promise<unknown>,
        ) => handlers.set(name, handler),
      } as unknown as IpcMain,
      service: service as unknown as VaultService,
      days: days as unknown as DayService,
    }).registerAll();
    for (const [channel, args] of [
      ["create-day", [null, "2026-09-08"]],
      ["create-day", ["relative", "2026-09-08"]],
      ["create-day", ["/vault", "2026-02-30"]],
      ["day", [undefined, "2026-09-08"]],
      ["day", ["vault", "2026-09-08"]],
      ["day", ["/vault\0", "2026-09-08"]],
      ["day", ["/vault", "2026-9-8"]],
      ["day", ["/vault", 20260908]],
      ["check-digest-item", ["vault", DIGEST, 4, LINE, true]],
      ["check-digest-item", ["/vault", "digest.md", 4, LINE, true]],
      ["check-digest-item", ["/vault", DIGEST, -1, LINE, true]],
      ["check-digest-item", ["/vault", DIGEST, 1.5, LINE, true]],
      ["check-digest-item", ["/vault", DIGEST, "4", LINE, true]],
      ["check-digest-item", ["/vault", DIGEST, 4, "", true]],
      ["check-digest-item", ["/vault", DIGEST, 4, `${LINE}\n- [ ] More`, true]],
      ["check-digest-item", ["/vault", DIGEST, 4, "x".repeat(9000), true]],
      ["check-digest-item", ["/vault", DIGEST, 4, LINE, "true"]],
    ] as Array<[string, unknown[]]>) {
      expect(
        await handlers.get(`vault:${channel}`)?.({}, ...args),
      ).toMatchObject({ success: false, error: "Invalid vault request." });
    }
    [...Object.values(service), ...Object.values(days)].forEach((method) =>
      expect(method).not.toHaveBeenCalled(),
    );
    await handlers.get("vault:create-day")?.({}, "/vault", "2026-09-08");
    expect(service.createDay).toHaveBeenCalledWith("/vault", "2026-09-08");
    await handlers.get("vault:day")?.({}, "/vault", "2026-09-08");
    expect(days.day).toHaveBeenCalledWith("/vault", "2026-09-08");
    await handlers.get("vault:check-digest-item")?.({}, "/vault", DIGEST, 4, LINE, false);
    expect(service.checkDigestItem).toHaveBeenCalledWith("/vault", DIGEST, 4, LINE, false);
  });
});
