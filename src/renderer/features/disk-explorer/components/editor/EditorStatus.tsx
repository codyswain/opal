import React from 'react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/shared/ui';
import type { MarkdownSaveState } from './useMarkdownDocument';

interface EditorStatusProps {
  saveState: MarkdownSaveState;
  error: string | null;
  properties: number;
  words: number;
  /** A log page, which only the vault's scripts write. */
  readOnly?: boolean;
  propertiesOpen: boolean;
  onToggleProperties: () => void;
  onKeepMine: () => void;
  onKeepDisk: () => void;
  onRetry: () => void;
}

// Autosave keeps pages saved, so only a problem gets words; the tab shows unsaved edits.
const LABELS: Record<MarkdownSaveState, string> = {
  clean: '',
  saved: '',
  dirty: '',
  saving: '',
  conflict: 'Changed on disk',
  error: 'Not saved',
};

// Buttons must not take focus from the editor: a blur would start a save,
// swap this status line mid-click, and lose the click.
const keepEditorFocus = (event: React.MouseEvent) => event.preventDefault();

const count = (value: number, one: string, many: string) => `${value.toLocaleString()} ${value === 1 ? one : many}`;

/**
 * The page's footer, muted and on the right like Obsidian's: "N properties ·
 * N words", and any save problem. That line is the properties toggle, plain
 * text until the pointer is on it; on a log page it starts with "Read-only".
 */
export const EditorStatus: React.FC<EditorStatusProps> = ({
  saveState, error, properties, words, readOnly = false, propertiesOpen, onToggleProperties, onKeepMine, onKeepDisk, onRetry,
}) => (
  <div className="opal-editor-status flex shrink-0 flex-col gap-1 px-4 pb-2 pt-1 font-sans text-control tabular-nums text-foreground-tertiary">
    <div className="flex items-center justify-end gap-1.5">
      <span role="status" data-testid="editor-save-state" data-state={saveState} className="mr-auto font-medium text-foreground empty:hidden">
        {LABELS[saveState]}
      </span>
      {saveState === 'error' ? (
        <Button size="compact" variant="outline" onMouseDown={keepEditorFocus} onClick={onRetry}>Retry</Button>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-properties-toggle=""
            aria-pressed={propertiesOpen}
            aria-keyshortcuts="Meta+Shift+I"
            onMouseDown={keepEditorFocus}
            onClick={onToggleProperties}
            className="-mx-1.5 -my-0.5 rounded-[4px] px-1.5 py-0.5 outline-none transition-hover hover:bg-surface-hover hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-focus aria-pressed:text-foreground"
          >
            {[readOnly ? 'Read-only' : null, properties > 0 ? count(properties, 'property', 'properties') : null, count(words, 'word', 'words')]
              .filter(Boolean)
              .join(' · ')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span>{propertiesOpen ? 'Hide properties' : 'Show properties'}</span>
          <span aria-hidden className="ml-2 font-mono text-metadata text-foreground-tertiary">⌘⇧I</span>
        </TooltipContent>
      </Tooltip>
    </div>
    {saveState === 'conflict' ? (
      <div role="alert" data-testid="editor-conflict" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground">
        <span className="flex-1">This note changed on disk in the lines you were editing. Both versions are shown in the page: pick one for each change, or for all of them here.</span>
        <Button size="compact" variant="outline" onMouseDown={keepEditorFocus} onClick={onKeepDisk}>Keep disk version</Button>
        <Button size="compact" onMouseDown={keepEditorFocus} onClick={onKeepMine}>Keep mine</Button>
      </div>
    ) : saveState === 'error' && error ? (
      <p role="alert" className="text-xs font-medium text-foreground">{error}</p>
    ) : null}
  </div>
);
