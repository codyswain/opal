import React, { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Eye, EyeOff, FolderOpen, FolderPlus, RefreshCw, Square, X } from "lucide-react";
import { basenameFsPath } from "@/common/fsPaths";
import { formatRelativeTime } from "@/common/relativeTime";
import { useChatStore } from "@/renderer/features/chat/store/chatStore";
import { describeProgress } from "@/renderer/features/chat/components/IndexStatusBar";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { useTheme, type Theme } from "@/renderer/features/theme";
import { Button, IconButton, SegmentedControl } from "@/renderer/shared/ui";
import { useSettingsStore } from "@/renderer/store/settingsStore";

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
  const { settings, updateSettings, loading } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const roots = useDiskStore((state) => state.roots);
  const openFolder = useDiskStore((state) => state.openFolder);
  const closeRoot = useDiskStore((state) => state.closeRoot);
  const index = useChatStore((state) => state.index);
  const indexError = useChatStore((state) => state.indexError);
  const [showApiKey, setShowApiKey] = useState(false);
  const keyId = useId();

  useEffect(() => {
    useChatStore.getState().subscribe();
    void useChatStore.getState().refreshIndex();
  }, []);

  const hasKey = settings.openAIKey.trim().length > 0;

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

      <Section title="OpenAI API key" description="Used by Chat to embed and answer from your library. Stored in the system keychain, never in a file.">
        <label htmlFor={keyId} className="sr-only">OpenAI API key</label>
        <div className="flex items-center gap-2">
          <input
            id={keyId}
            type={showApiKey ? "text" : "password"}
            value={settings.openAIKey}
            onChange={(event) => updateSettings({ openAIKey: event.target.value })}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            className="h-control w-full rounded-md border border-border bg-surface px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <IconButton label={showApiKey ? "Hide API key" : "Show API key"} onClick={() => setShowApiKey((previous) => !previous)}>
            {showApiKey ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          </IconButton>
        </div>
        {loading.error ? <p role="alert" className="mt-2 text-control text-destructive">{loading.error}</p> : null}
      </Section>

      <Section title="Chat index" description="Embeddings of your Markdown, text and PDF files. Built only when you ask; updated incrementally.">
        <div className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2.5">
          <Database aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-control">
            {index?.indexing ? (
              <p role="status" className="text-foreground">{index.progress ? describeProgress(index.progress) : "Indexing your library…"}</p>
            ) : index?.ready ? (
              <p role="status" className="text-foreground">
                {index.files.toLocaleString()} {index.files === 1 ? "file" : "files"}, {index.chunks.toLocaleString()} passages
                {index.lastIndexedAt ? `, updated ${formatRelativeTime(index.lastIndexedAt, Date.now())}` : ""}
                {index.staleFiles > 0 ? ` · ${index.staleFiles.toLocaleString()} pending ${index.staleFiles === 1 ? "change" : "changes"}` : ""}
                {index.skipped.length > 0 ? ` · ${index.skipped.length} skipped` : ""}
              </p>
            ) : (
              <p role="status" className="text-foreground-secondary">Not indexed yet.</p>
            )}
            {!hasKey ? <p className="mt-1 text-foreground-secondary">Add your OpenAI API key above to enable indexing.</p> : null}
            {indexError ?? index?.error ? <p role="alert" className="mt-1 text-destructive">{indexError ?? index?.error}</p> : null}
          </div>
          {index?.indexing ? (
            <Button size="compact" variant="outline" onClick={() => void useChatStore.getState().cancelIndex()}>
              <Square aria-hidden className="h-3 w-3" />
              Stop
            </Button>
          ) : (
            <Button size="compact" variant="outline" disabled={!hasKey || roots.length === 0} onClick={() => void useChatStore.getState().updateIndex()}>
              <RefreshCw aria-hidden className="h-3.5 w-3.5" />
              {index?.ready ? "Update index" : "Index library"}
            </Button>
          )}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">
          Questions and answers live in <Link to="/chat" className="underline underline-offset-2">Chat</Link>.
        </p>
      </Section>
    </div>
  );
};
