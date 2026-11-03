import { dailyHeadDate } from "@/common/stackModel";
import { localDate } from "@/common/vaultModel";
import { recordOpened } from "@/renderer/features/disk-explorer/activity/recordActivity";
import {
  filesLocationKey,
  focusFile,
  stackLocation,
  type FilesNavigationIntent,
} from "@/renderer/features/disk-explorer/navigation";
import { useStackStore } from "@/renderer/features/disk-explorer/store/stackStore";
import {
  selectActiveTab,
  selectCurrentLocation,
  useTabsStore,
  type OpenOptions,
} from "@/renderer/features/disk-explorer/store/tabsStore";

type NavigateFiles = (intent: FilesNavigationIntent, options?: Pick<OpenOptions, "newTab">) => void;

/** The first opened folder that is a vault, or null. */
async function vaultRoot(): Promise<string | null> {
  const vaults = await window.vaultAPI.discover();
  if ("error" in vaults) throw new Error(vaults.error);
  return vaults.data[0]?.path ?? null;
}

/** The daily page for `date`, which the main process creates from the vault's template when it does not exist. */
async function dayPage(root: string, date: string): Promise<string> {
  const created = await window.vaultAPI.createDay(root, date);
  if ("error" in created) throw new Error(created.error);
  return created.data.path;
}

/**
 * Shows the stream headed by `head` with `page` at the top of the view. A
 * tab that already shows the stream scrolls there; a new history entry or
 * tab starts there, as it would returning to a place saved on it.
 */
function showInStream(
  navigateFiles: NavigateFiles,
  head: string,
  page: string,
  options: Pick<OpenOptions, "newTab">,
): void {
  const location = stackLocation("daily", head);
  const current = selectCurrentLocation(useTabsStore.getState());
  const shown = !options.newTab && current !== null && filesLocationKey(current) === filesLocationKey(location);
  navigateFiles({ location }, options);
  if (shown) {
    useStackStore.getState().scrollToSection(head, page);
    return;
  }
  if (page === head) return;
  const tabs = useTabsStore.getState();
  const tab = selectActiveTab(tabs);
  if (tab) tabs.saveView(tab.id, tab.index, { stack: { anchor: page, offset: 0 } });
}

/**
 * Daily is a shortcut, not a screen: it opens the stream of daily pages
 * with today's at the top of the view, which the main process creates from
 * the vault's template first when it does not exist, and counts as an open
 * for Recent. When the tab already shows that stream, it scrolls back to
 * today's page. Resolves false when no opened folder is a vault.
 */
export async function openDaily(
  navigateFiles: NavigateFiles,
  options: Pick<OpenOptions, "newTab"> = {},
): Promise<boolean> {
  const root = await vaultRoot();
  if (!root) return false;
  const page = await dayPage(root, localDate());
  recordOpened(page);
  showInStream(navigateFiles, page, page, options);
  return true;
}

/**
 * Opens the daily page for any day, creating it from the template when it
 * does not exist. A later day opens in the stream, scrolled to its page
 * above today's; today opens Daily; an earlier day opens its page alone,
 * since the stream leaves out a blank past page. Resolves false when no
 * opened folder is a vault.
 */
export async function openDailyPage(
  navigateFiles: NavigateFiles,
  date: string,
  options: Pick<OpenOptions, "newTab"> = {},
): Promise<boolean> {
  const today = localDate();
  if (date === today) return openDaily(navigateFiles, options);
  const root = await vaultRoot();
  if (!root) return false;
  const page = await dayPage(root, date);
  recordOpened(page);
  const head = date > today ? await dayPage(root, today) : null;
  // Until the cleanup commit either page can be an old Inbox/Logs page, which the stream does not hold.
  if (head && dailyHeadDate(head) && dailyHeadDate(page)) showInStream(navigateFiles, head, page, options);
  else navigateFiles(focusFile(page), options);
  return true;
}
