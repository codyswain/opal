import { localDate } from "@/common/vaultModel";
import {
  focusFile,
  type FilesHistoryMutation,
  type FilesNavigationIntent,
} from "@/renderer/features/disk-explorer/navigation";

/**
 * Today is a shortcut, not a screen: it opens the day's log page in the
 * editor, creating it from the vault's template first when it does not exist.
 * Resolves false when no opened folder is a vault (no `Inbox/Logs`).
 */
export async function openToday(
  navigateFiles: (intent: FilesNavigationIntent) => void,
  history: FilesHistoryMutation = "push",
): Promise<boolean> {
  const vaults = await window.vaultAPI.discover();
  if ("error" in vaults) throw new Error(vaults.error);
  const root = vaults.data[0]?.path;
  if (!root) return false;
  const date = localDate();
  const created = await window.vaultAPI.createDay(root, date);
  if ("error" in created) throw new Error(created.error);
  const folder = `${root}/Inbox/Logs`;
  navigateFiles(focusFile(folder, `${folder}/${date}.md`, history));
  return true;
}
