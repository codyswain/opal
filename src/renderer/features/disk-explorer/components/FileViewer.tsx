import React, { useState } from 'react';
import { toOpalFileUrl } from '@/common/opalFileUrl';
import type { DiskEntry } from '@/types/disk';
import { Button } from '@/renderer/shared/ui';
import { useTextFile } from '../hooks/useTextFile';

/**
 * The page for a file that is not Markdown: images inline, PDFs in
 * Chromium's own viewer, text as plain text, and anything else handed to the
 * app macOS opens it with.
 */
export const FileViewer: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  switch (entry.kind) {
    case 'image':
      return (
        // Flex, not grid: a grid's auto row would let a tall image overflow max-h-full.
        <div className="flex h-full items-center justify-center p-8">
          <img
            key={entry.path}
            src={toOpalFileUrl(entry.path)}
            alt={entry.name}
            decoding="async"
            data-testid="image-viewer"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    case 'pdf':
      return (
        <embed
          key={entry.path}
          // Chromium's viewer opens without its thumbnail rail.
          src={`${toOpalFileUrl(entry.path)}#navpanes=0`}
          type="application/pdf"
          data-testid="pdf-viewer"
          className="h-full w-full"
        />
      );
    case 'text':
      return <TextViewer key={entry.path} entry={entry} />;
    default:
      return <OpenInDefaultApp entry={entry} message="Opal can't show this file." />;
  }
};

const TextViewer: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const { text, truncated, error, isLoading } = useTextFile(entry.path);
  if (error) return <OpenInDefaultApp entry={entry} message={error} />;
  if (isLoading || text === null) {
    return <p role="status" className="p-8 text-ui text-foreground-tertiary">Opening file…</p>;
  }
  return (
    <div className="h-full overflow-auto">
      <pre
        data-testid="text-viewer"
        className="mx-auto max-w-reading whitespace-pre-wrap break-words px-8 py-10 font-mono text-control text-foreground"
      >
        {text}
      </pre>
      {truncated ? (
        <p className="mx-auto max-w-reading px-8 pb-10 text-metadata text-foreground-tertiary">
          Showing the first part of this file only.
        </p>
      ) : null}
    </div>
  );
};

const OpenInDefaultApp: React.FC<{ entry: DiskEntry; message: string }> = ({ entry, message }) => {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    const result = await window.diskAPI.openExternal(entry.path);
    setError(result.success ? null : result.error);
  };
  return (
    <div
      data-testid="open-in-default-app"
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <p className="text-ui text-foreground-tertiary">{message}</p>
      <Button variant="outline" size="compact" onClick={() => void open()}>
        Open in default app
      </Button>
      {error ? <p role="alert" className="text-ui text-foreground">{error}</p> : null}
    </div>
  );
};
