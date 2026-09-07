import React from 'react';
import { Link } from 'react-router-dom';
import { Database, RefreshCw } from 'lucide-react';
import { formatRelativeTime } from '@/common/relativeTime';
import { Button } from '@/renderer/shared/ui';
import type { LibraryIndexStatus } from '@/types/chat';

interface IndexStatusBarProps {
  status: LibraryIndexStatus | null;
  error: string | null;
  onUpdate: () => void;
}

const needsKey = (message: string | null) => !!message && /API key/i.test(message);

/** Where the library index stands, and the one explicit control that spends API calls. */
export const IndexStatusBar: React.FC<IndexStatusBarProps> = ({ status, error, onUpdate }) => {
  const problem = error ?? status?.error ?? null;
  return (
    <div data-testid="chat-index-status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
      <Database aria-hidden className="h-4 w-4" />
      {status?.indexing ? (
        <span role="status">Indexing your library…</span>
      ) : status?.ready ? (
        <span role="status">
          {status.files} {status.files === 1 ? 'file' : 'files'}, {status.chunks} passages
          {status.lastIndexedAt ? `, updated ${formatRelativeTime(status.lastIndexedAt, Date.now())}` : ''}
          {status.staleFiles > 0 ? ` · ${status.staleFiles} change${status.staleFiles === 1 ? '' : 's'} since` : ''}
          {status.skipped.length > 0 ? ` · ${status.skipped.length} skipped` : ''}
        </span>
      ) : (
        <span role="status">Your library is not indexed yet. Indexing sends your Markdown and text files to OpenAI for embeddings.</span>
      )}
      <span className="flex-1" />
      {needsKey(problem) ? (
        <Link to="/settings" className="text-focus underline underline-offset-2">Add your OpenAI API key in Settings</Link>
      ) : problem ? (
        <span role="alert" className="text-destructive">{problem}</span>
      ) : null}
      <Button size="compact" variant={status?.ready ? 'ghost' : 'default'} disabled={!!status?.indexing} onClick={onUpdate}>
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        {status?.ready ? 'Update index' : 'Index library'}
      </Button>
    </div>
  );
};
