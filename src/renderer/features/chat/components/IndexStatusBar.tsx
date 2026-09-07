import React from 'react';
import { Link } from 'react-router-dom';
import { Database, RefreshCw, Square } from 'lucide-react';
import { formatRelativeTime } from '@/common/relativeTime';
import { basenameFsPath } from '@/common/fsPaths';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/renderer/shared/ui';
import type { IndexProgress, LibraryIndexStatus } from '@/types/chat';

interface IndexStatusBarProps {
  status: LibraryIndexStatus | null;
  error: string | null;
  onUpdate: () => void;
  onCancel: () => void;
}

const needsKey = (message: string | null) => !!message && /API key/i.test(message);
const count = (value: number, singular: string, plural = `${singular}s`) => `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

export function describeProgress(progress: IndexProgress): string {
  const file = progress.currentFile ? ` · ${basenameFsPath(progress.currentFile)}` : '';
  switch (progress.phase) {
    case 'scanning':
      return `Scanning your library… ${count(progress.done, 'file')} found`;
    case 'reading':
      return `Reading files ${Math.min(progress.done + 1, progress.total).toLocaleString()} of ${progress.total.toLocaleString()}${file}`;
    case 'embedding':
      return progress.total === 0
        ? 'Nothing new to embed'
        : `Embedding passages ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}${file}`;
  }
}

const Skipped: React.FC<{ skipped: LibraryIndexStatus['skipped'] }> = ({ skipped }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-foreground">
        {count(skipped.length, 'file')} skipped
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="max-h-72 w-96 overflow-auto p-3 text-xs">
      <p className="mb-2 font-medium text-foreground">Not indexed</p>
      <ul className="flex flex-col gap-1.5">
        {skipped.slice(0, 50).map((item) => (
          <li key={item.path} className="flex flex-col" title={item.path}>
            <span className="truncate text-foreground">{basenameFsPath(item.path)}</span>
            <span className="text-muted-foreground">{item.reason}</span>
          </li>
        ))}
        {skipped.length > 50 ? <li className="text-muted-foreground">and {skipped.length - 50} more</li> : null}
      </ul>
    </PopoverContent>
  </Popover>
);

/** Where the library index stands, and the one explicit control that spends API calls. */
export const IndexStatusBar: React.FC<IndexStatusBarProps> = ({ status, error, onUpdate, onCancel }) => {
  const problem = error ?? status?.error ?? null;
  const progress = status?.indexing ? status.progress : null;
  const fraction = progress && progress.total > 0 ? Math.min(1, progress.done / progress.total) : null;
  return (
    <div data-testid="chat-index-status" className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Database aria-hidden className="h-4 w-4" />
        {status?.indexing ? (
          <span role="status" className="min-w-0 flex-1 truncate">{progress ? describeProgress(progress) : 'Indexing your library…'}</span>
        ) : status?.ready ? (
          <span role="status" className="flex flex-wrap items-center gap-x-1">
            <span>
              {count(status.files, 'file')}, {count(status.chunks, 'passage')}
              {status.lastIndexedAt ? `, updated ${formatRelativeTime(status.lastIndexedAt, Date.now())}` : ''}
            </span>
            {status.cancelled ? <span>· stopped early</span> : null}
            {status.staleFiles > 0 ? <span>· {count(status.staleFiles, 'change')} since</span> : null}
            {status.skipped.length > 0 ? <><span>·</span><Skipped skipped={status.skipped} /></> : null}
          </span>
        ) : (
          <span role="status">Your library is not indexed yet. Indexing sends the text of your Markdown, text and PDF files to OpenAI for embeddings.</span>
        )}
        {!status?.indexing ? <span className="flex-1" /> : null}
        {needsKey(problem) ? (
          <Link to="/settings" className="text-focus underline underline-offset-2">Add your OpenAI API key in Settings</Link>
        ) : problem ? (
          <span role="alert" className="text-destructive">{problem}</span>
        ) : null}
        {status?.indexing ? (
          <Button size="compact" variant="outline" onClick={onCancel}>
            <Square aria-hidden className="h-3 w-3" />
            Stop
          </Button>
        ) : (
          <Button size="compact" variant={status?.ready ? 'ghost' : 'default'} onClick={onUpdate}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            {status?.ready ? 'Update index' : 'Index library'}
          </Button>
        )}
      </div>
      {status?.indexing ? (
        <div
          role="progressbar"
          aria-label="Indexing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
          className="relative h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={fraction === null ? 'absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-focus' : 'h-full rounded-full bg-focus transition-[width] duration-300'}
            style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};
