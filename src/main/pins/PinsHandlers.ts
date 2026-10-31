import type { IpcMain } from "electron";
import path from "path";
import type { PinsResult } from "@/types/pins";
import { PINS_LIMIT, type PinsService } from "./PinsService";

const absolute = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 32768 &&
  !value.includes("\0") &&
  path.isAbsolute(value);
const pathList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= PINS_LIMIT && value.every(absolute);
const invalid = (): PinsResult<never> => ({
  success: false,
  error: "Invalid pins request.",
});

export class PinsHandlers {
  constructor(
    private deps: {
      ipc: Pick<IpcMain, "handle">;
      service: PinsService;
    },
  ) {}

  registerAll(): void {
    const { ipc, service } = this.deps;
    ipc.handle("pins:list", () => this.respond(() => service.list()));
    ipc.handle("pins:set", (_, root: unknown, paths: unknown) =>
      absolute(root) && pathList(paths)
        ? this.respond(() => service.set(root, paths))
        : invalid(),
    );
  }

  private async respond<T>(operation: () => Promise<T>): Promise<PinsResult<T>> {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "The pins could not be saved.",
      };
    }
  }
}
