import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DiskEntry } from '@/types/disk';
import { useTextFile } from '../../hooks/useTextFile';

export const MarkdownPreview: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const { text, truncated, error, isLoading } = useTextFile(entry.path);

  if (isLoading) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (error) {
    return (
      <div
        data-testid="text-preview-error"
        className="flex-1 grid place-items-center p-6 text-sm text-destructive text-center"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {truncated && (
        <p
          data-testid="text-preview-truncated"
          className="shrink-0 border-b border-border/60 bg-muted/40 px-4 py-2 text-2xs text-muted-foreground"
        >
          Showing the first part of this file only.
        </p>
      )}
      {/* @tailwindcss/typography is already a plugin; prose gives sane defaults
          for content whose markup we do not control. */}
      <div
        data-testid="markdown-preview"
        className="flex-1 min-h-0 overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none"
      >
        {/* No rehype-raw: this renders arbitrary files off the user's disk, and
            enabling embedded HTML would execute whatever they contain. */}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text ?? ''}</ReactMarkdown>
      </div>
    </div>
  );
};
