import React from 'react';
import { Button } from '@/renderer/shared/ui';
import type { MarkdownSaveState } from './useMarkdownDocument';

interface EditorStatusProps {
  saveState: MarkdownSaveState;
  error: string | null;
  hasFrontmatter: boolean;
  words: number;
  onReloadFromDisk: () => void;
  onKeepMine: () => void;
  onRetry: () => void;
}

const LABELS: Record<MarkdownSaveState, string> = {
  clean: 'Saved',
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  conflict: 'Changed on disk',
  error: 'Not saved',
};

export const EditorStatus: React.FC<EditorStatusProps> = ({ saveState, error, hasFrontmatter, words, onReloadFromDisk, onKeepMine, onRetry }) => (
  <div className="flex shrink-0 flex-col gap-1 border-t border-border/60 px-4 py-1.5 text-2xs text-muted-foreground" data-disk-shortcuts-ignore="true">
    <div className="flex items-center gap-3">
      <span role="status" data-testid="editor-save-state" data-state={saveState}>{LABELS[saveState]}</span>
      <span>{words} {words === 1 ? 'word' : 'words'}</span>
      {hasFrontmatter ? <span>Properties are edited in Details</span> : null}
      <span className="flex-1" />
      {saveState === 'error' ? (
        <Button size="compact" variant="outline" onClick={onRetry}>Retry</Button>
      ) : null}
    </div>
    {saveState === 'conflict' ? (
      <div role="alert" data-testid="editor-conflict" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-foreground">
        <span className="flex-1">This note changed on disk since you opened it. Reload it to take the disk version, or keep your text and overwrite it.</span>
        <Button size="compact" variant="outline" onClick={onReloadFromDisk}>Reload from disk</Button>
        <Button size="compact" onClick={onKeepMine}>Keep mine</Button>
      </div>
    ) : saveState === 'error' && error ? (
      <p role="alert" className="text-xs text-destructive">{error}</p>
    ) : null}
  </div>
);
