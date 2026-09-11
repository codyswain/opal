import React from 'react';
import { FolderOpen, MessageSquare, SlidersHorizontal, PenLine } from 'lucide-react';
import { Button } from '@/renderer/shared/ui';
import { useDiskStore } from '../store/diskStore';

const FEATURES = [
  { Icon: PenLine, title: 'Write in Markdown', text: 'Notes are plain files on disk. Edits save as you type, frontmatter and all.' },
  { Icon: SlidersHorizontal, title: 'Build views', text: 'Filter any folder by kind, tags or activity and save the result to the sidebar.' },
  { Icon: MessageSquare, title: 'Ask your library', text: 'Chat answers from your own files and cites the passages it used.' },
];

/** The first thing a new person sees: what Opal is for, and the one action that unlocks it. */
export const WelcomePanel: React.FC = () => {
  const openFolder = useDiskStore((state) => state.openFolder);
  return (
    <div data-testid="welcome-panel" className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <span aria-hidden className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-focus/10 text-focus">
          <FolderOpen className="h-7 w-7" />
        </span>
        <h2 className="text-lg font-semibold text-foreground">Open a folder to begin</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Opal works directly on folders you already have. Nothing is imported or copied; your files stay exactly where they are.
        </p>
        <Button className="mt-5" onClick={() => void openFolder()}>
          <FolderOpen aria-hidden className="h-4 w-4" />
          Open folder…
        </Button>
        <p className="mt-2 text-2xs text-muted-foreground">or press <kbd className="rounded border border-border-subtle bg-surface px-1 font-sans">⌘O</kbd></p>
        <ul className="mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
          {FEATURES.map(({ Icon, title, text }) => (
            <li key={title} className="rounded-lg border border-border-subtle bg-surface p-3">
              <Icon aria-hidden className="mb-2 h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground">{title}</p>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
