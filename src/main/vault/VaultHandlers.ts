import type { IpcMain } from "electron";
import path from "path";
import type { VaultResult } from "@/types/vault";
import { validDate } from "@/common/vaultModel";
import type { DayService } from "./DayService";
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
const invalid = (): VaultResult<never> => ({
  success: false,
  error: "Invalid vault request.",
});

export class VaultHandlers {
  constructor(
    private deps: {
      ipc: Pick<IpcMain, "handle">;
      service: VaultService;
      days: DayService;
    },
  ) {}
  registerAll(): void {
    const { ipc, service, days } = this.deps;
    ipc.handle("vault:discover", () => this.respond(() => service.discover()));
    ipc.handle("vault:create-day", (_, root: unknown, day: unknown) =>
      target(root) && date(day)
        ? this.respond(() => service.createDay(root, day))
        : invalid(),
    );
    ipc.handle("vault:day", (_, root: unknown, day: unknown) =>
      target(root) && date(day)
        ? this.respond(() => days.day(root, day))
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
