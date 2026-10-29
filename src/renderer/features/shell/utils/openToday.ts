import { localDate } from "@/common/vaultModel";
import { recordOpened } from "@/renderer/features/disk-explorer/activity/recordActivity";
import {
  focusFile,
  type FilesNavigationIntent,
} from "@/renderer/features/disk-explorer/navigation";
import type { OpenOptions } from "@/renderer/features/disk-explorer/store/tabsStore";
import { useTodayPage } from "../store/todayPageStore";

/**
 * Today is a shortcut, not a screen: it opens the day's page in the editor,
 * which the main process creates from the vault's template first when it does
 * not exist, and counts as an open for Recent. Resolves false when no opened
 * folder is a vault.
 */
export async function openToday(
  navigateFiles: (intent: FilesNavigationIntent, options?: Pick<OpenOptions, "newTab">) => void,
  options: Pick<OpenOptions, "newTab"> = {},
): Promise<boolean> {
  const vaults = await window.vaultAPI.discover();
  if ("error" in vaults) throw new Error(vaults.error);
  const root = vaults.data[0]?.path;
  if (!root) return false;
  const date = localDate();
  const created = await window.vaultAPI.createDay(root, date);
  if ("error" in created) throw new Error(created.error);
  const page = created.data.path;
  useTodayPage.setState({ date, path: page });
  recordOpened(page);
  navigateFiles(focusFile(page), options);
  return true;
}
