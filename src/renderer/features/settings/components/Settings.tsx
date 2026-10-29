import React from "react";
import { FolderOpen, FolderPlus, X } from "lucide-react";
import { basenameFsPath } from "@/common/fsPaths";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useTheme, type Theme } from "@/renderer/features/theme";
import { Button, IconButton, SegmentedControl } from "@/renderer/shared/ui";

const Section: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <section className="grid gap-4 border-t border-border-subtle py-6 sm:grid-cols-[13rem_1fr]">
    <div>
      <h3 className="text-ui font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-control text-foreground-secondary">{description}</p>
    </div>
    <div className="min-w-0">{children}</div>
  </section>
);

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const Settings: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const roots = useDiskStore((state) => state.roots);
  const openFolder = useDiskStore((state) => state.openFolder);
  const closeRoot = useDiskStore((state) => state.closeRoot);

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <h2 className="mb-6 text-heading font-semibold">Settings</h2>

      <Section title="Appearance" description="Follow the system or pick a side.">
        <SegmentedControl label="Theme" value={theme} onValueChange={(value) => setTheme(value as Theme)} options={THEME_OPTIONS} />
      </Section>

      <Section title="Library" description="The folders Opal can see. Nothing outside them is ever read.">
        <ul className="flex flex-col gap-1" aria-label="Opened folders">
          {roots.length === 0 ? <li className="text-control text-foreground-secondary">No folders are open yet.</li> : null}
          {roots.map((root) => (
            <li key={root} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2" title={root}>
              <FolderOpen aria-hidden className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui text-foreground">{basenameFsPath(root)}</span>
                <span className="block truncate text-2xs text-muted-foreground">{root}</span>
              </span>
              <IconButton label={`Close ${basenameFsPath(root)}`} onClick={() => void closeRoot(root)}>
                <X aria-hidden className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="compact" className="mt-3" onClick={() => void openFolder()}>
          <FolderPlus aria-hidden className="h-3.5 w-3.5" />
          Open folder…
        </Button>
      </Section>
    </div>
  );
};
