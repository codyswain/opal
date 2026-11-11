import type { IpcMain } from "electron";
import path from "path";
import type { VaultResult } from "@/types/vault";
import { validDate } from "@/common/vaultModel";
import { isStackKind } from "@/common/stackModel";
import { isVariantName, isVariantSide } from "@/common/variants";
import { REASON_LIMIT } from "@/common/dailyTest";
import type { DayService } from "./DayService";
import type { StackService } from "./StackService";
import type { TestService } from "./TestService";
import type { TouchedService } from "./TouchedService";
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
const lineIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000;
/** One line of text, as a checkbox line is read. */
const oneLine = (value: unknown): value is string =>
  nonempty(value, 8192) && !/[\r\n]/.test(value);
const choice = (value: unknown): value is "a" | "b" | "neither" =>
  value === "a" || value === "b" || value === "neither";
/** An answer's reason: empty or one line. */
const reason = (value: unknown): value is string =>
  typeof value === "string" && value.length <= REASON_LIMIT * 4 && !value.includes("\0");
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
      stacks: StackService;
      touched?: TouchedService;
      tests?: TestService;
    },
  ) {}
  registerAll(): void {
    const { ipc, service, days, stacks } = this.deps;
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
    const { touched } = this.deps;
    ipc.handle("vault:touched-week", (_, root: unknown, day: unknown) =>
      target(root) && date(day) && touched
        ? this.respond(() => touched.week(root, day))
        : invalid(),
    );
    ipc.handle("vault:stack", (_, root: unknown, kind: unknown, head: unknown) =>
      target(root) && isStackKind(kind) && target(head)
        ? this.respond(() => stacks.stack(root, kind, head))
        : invalid(),
    );
    ipc.handle(
      "vault:check-digest-item",
      (_, root: unknown, file: unknown, line: unknown, raw: unknown, checked: unknown) =>
        target(root) && target(file) && lineIndex(line) && oneLine(raw) && typeof checked === "boolean"
          ? this.respond(() => service.checkDigestItem(root, file, line, raw, checked))
          : invalid(),
    );
    const { tests } = this.deps;
    ipc.handle("vault:test", (_, root: unknown, today: unknown) =>
      target(root) && date(today) && tests
        ? this.respond(() => tests.test(root, today))
        : invalid(),
    );
    ipc.handle(
      "vault:answer-test",
      (_, root: unknown, day: unknown, id: unknown, picked: unknown, why: unknown) =>
        target(root) && date(day) && oneLine(id) && choice(picked) && reason(why) && tests
          ? this.respond(() => tests.answer(root, day, id, picked, why))
          : invalid(),
    );
    ipc.handle("vault:variants", () => (tests ? this.respond(() => tests.sides()) : invalid()));
    ipc.handle("vault:set-variant", (_, name: unknown, side: unknown) =>
      isVariantName(name) && isVariantSide(side) && tests
        ? this.respond(() => tests.setSide(name, side))
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
