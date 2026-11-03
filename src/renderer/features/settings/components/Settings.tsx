import React, { useState } from "react";
import { Folder, FolderPlus, X } from "lucide-react";
import { basenameFsPath } from "@/common/fsPaths";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useRecentStore } from "@/renderer/features/disk-explorer/store/recentStore";
import { useTheme, type Theme } from "@/renderer/features/theme";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  SegmentedControl,
} from "@/renderer/shared/ui";
import { useSettingsStore } from "../store/settingsStore";

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section aria-label={title} className="flex flex-col gap-2">
    <h3 className="text-label text-foreground-tertiary">{title}</h3>
    {children}
  </section>
);

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const AppearanceSection: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <Section title="Appearance">
      <div className="flex items-center justify-between gap-4">
        <span className="text-ui text-foreground">Theme</span>
        <SegmentedControl label="Theme" value={theme} onValueChange={(value) => setTheme(value as Theme)} options={THEME_OPTIONS} />
      </div>
    </Section>
  );
};

const FoldersSection: React.FC = () => {
  const roots = useDiskStore((state) => state.roots);
  const openFolder = useDiskStore((state) => state.openFolder);
  const closeRoot = useDiskStore((state) => state.closeRoot);
  return (
    <Section title="Folders">
      <p className="text-ui text-foreground-secondary">The folders Opal can see. Nothing outside them is ever read.</p>
      <ul className="flex flex-col gap-0.5" aria-label="Opened folders">
        {roots.length === 0 ? <li className="text-ui text-foreground-tertiary">No folders are open yet.</li> : null}
        {roots.map((root) => (
          <li key={root} className="flex h-row items-center gap-2 rounded-row pl-2 transition-hover hover:bg-surface-hover" title={root}>
            <Folder aria-hidden className="h-4 w-4 shrink-0 text-icon" />
            <span className="shrink-0 text-ui text-foreground">{basenameFsPath(root)}</span>
            <span className="min-w-0 flex-1 truncate text-metadata text-foreground-tertiary">{root}</span>
            <IconButton label={`Close ${basenameFsPath(root)}`} onClick={() => void closeRoot(root)}>
              <X aria-hidden className="h-3.5 w-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="compact" className="self-start" onClick={() => void openFolder()}>
        <FolderPlus aria-hidden className="h-3.5 w-3.5" />
        Open folder…
      </Button>
    </Section>
  );
};

const RecentSection: React.FC = () => {
  const clear = useRecentStore((state) => state.clear);
  const [state, setState] = useState<"idle" | "confirming" | "cleared" | "failed">("idle");
  const clearHistory = async () => {
    setState((await clear()) ? "cleared" : "failed");
  };
  return (
    <Section title="Recent">
      {state === "confirming" ? (
        <div role="group" aria-label="Confirm clearing recent history" className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-ui text-foreground">Clear all recent history? Files are not affected.</span>
          <Button size="compact" onClick={() => void clearHistory()}>
            Clear
          </Button>
          <Button size="compact" variant="ghost" onClick={() => setState("idle")}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <span role="status" className="min-w-0 flex-1 text-ui text-foreground-secondary">
            {state === "cleared"
              ? "Recent history cleared."
              : state === "failed"
                ? "Recent history could not be cleared."
                : "Recent lists the files you opened or edited."}
          </span>
          <Button size="compact" variant="outline" onClick={() => setState("confirming")}>
            Clear history
          </Button>
        </div>
      )}
    </Section>
  );
};

/** Settings is a dialog over the current page, opened by Cmd+, and the sidebar gear. */
export const SettingsDialog: React.FC = () => {
  const open = useSettingsStore((state) => state.open);
  const setOpen = useSettingsStore((state) => state.setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="settings-dialog" className="max-w-lg p-5">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Theme, opened folders and recent history.</DialogDescription>
        </DialogHeader>
        <div className="mt-5 flex flex-col gap-6">
          <AppearanceSection />
          <FoldersSection />
          <RecentSection />
        </div>
      </DialogContent>
    </Dialog>
  );
};
