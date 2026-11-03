import * as React from "react";
import { toast } from "sonner";
import { CalendarDays, Plus } from "lucide-react";
import { addDays, dailyPageDate, dayName } from "@/renderer/features/day-sidebar/dayRule";
import { useToday } from "@/renderer/features/day-sidebar/hooks/useDay";
import { selectOpenedPath, useTabsStore } from "@/renderer/features/disk-explorer/store/tabsStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@/renderer/shared/ui";
import { useShell } from "../context/ShellContext";
import { openDaily, openDailyPage } from "../utils/openDaily";
import { DailyDateDialog } from "./DailyDateDialog";
import { SidebarItem } from "./SidebarItem";

/** Cmd+click and middle-click open in a new tab, as everywhere else. */
function wantsNewTab(event: React.MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

// Radix runs onSelect while the menu still traps focus, so the dialog opens once the menu has closed.
const afterMenu = (action: () => void) => () => window.setTimeout(action, 0);

/** The day's name at the right of a menu item, "Sat, Oct 31". */
function DayHint({ date }: { date: string }) {
  return <span className="ml-auto pl-4 text-metadata tabular-nums text-foreground-tertiary">{dayName(date)}</span>;
}

interface DailyItemProps {
  onNavigate?: () => void;
}

/**
 * The Daily row opens the stream of daily pages at today's. The quiet "+"
 * at its end, shown while the pointer or focus is in the sidebar, and a
 * right-click on the row make the page for tomorrow or for a picked day.
 */
export function DailyItem({ onNavigate }: DailyItemProps) {
  const { navigateFiles } = useShell();
  const today = useToday();
  const tomorrow = addDays(today, 1);
  const openedPath = useTabsStore(selectOpenedPath);
  const [picking, setPicking] = React.useState(false);
  // A daily page restored on relaunch counts too, and the mark moves on at midnight.
  const active = dailyPageDate(openedPath) === today;

  const run = async (open: () => Promise<boolean>, failure: string) => {
    try {
      if (await open()) onNavigate?.();
      else toast.error("Open your vault folder first.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure);
    }
  };
  const goToDaily = (newTab: boolean) => {
    void run(() => openDaily(navigateFiles, { newTab }), "Could not open today's page.");
  };
  const openDay = (date: string) => {
    void run(() => openDailyPage(navigateFiles, date), "Could not open that day's page.");
  };
  const pickDate = afterMenu(() => setPicking(true));

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative">
            <SidebarItem
              icon={CalendarDays}
              label="Daily"
              active={active}
              onActivate={(event) => goToDaily(wantsNewTab(event))}
            />
            <Menu>
              <MenuTrigger asChild>
                <IconButton
                  label="New daily page"
                  className="absolute right-0 top-0 opacity-0 focus-visible:opacity-100 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100 data-[state=open]:opacity-100"
                >
                  <Plus aria-hidden className="h-4 w-4" />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="start" className="w-[216px]">
                <MenuItem onSelect={() => openDay(tomorrow)}>
                  Tomorrow
                  <DayHint date={tomorrow} />
                </MenuItem>
                <MenuItem onSelect={pickDate}>Pick a date…</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-[216px]">
          <ContextMenuItem onSelect={() => openDay(tomorrow)}>
            Tomorrow
            <DayHint date={tomorrow} />
          </ContextMenuItem>
          <ContextMenuItem onSelect={pickDate}>Pick a date…</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <DailyDateDialog open={picking} defaultDate={tomorrow} onOpenChange={setPicking} onCreate={openDay} />
    </>
  );
}
