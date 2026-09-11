import React, { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { basenameFsPath } from '@/common/fsPaths';
import { Button, SegmentedControl, Switch } from '@/renderer/shared/ui';
import type { CollectionScope } from '@/types/collectionQuery';
import { FolderPickerDialog } from './FolderPickerDialog';

interface ScopeControlProps {
  scope: CollectionScope;
  roots: readonly string[];
  origin: string | null;
  onChange: (scope: CollectionScope) => void;
}

/**
 * Scope is deliberately separate from filter chips: a view created from a
 * folder starts recursive, while folder browsing lists direct children, so
 * the scope must always be visible.
 */
export const ScopeControl: React.FC<ScopeControlProps> = ({ scope, roots, origin, onChange }) => {
  const [picking, setPicking] = useState(false);
  const chosen = scope.kind === 'folders' ? scope.folders : [];
  const includeDescendants = scope.kind === 'folders' ? scope.includeDescendants : true;

  const setMode = (mode: 'all' | 'folders') => {
    if (mode === 'all') onChange({ kind: 'all-roots' });
    else onChange({ kind: 'folders', folders: chosen.length > 0 ? chosen : [origin ?? roots[0]].filter(Boolean), includeDescendants });
  };
  const addFolder = (folder: string) => {
    if (chosen.includes(folder)) return;
    onChange({ kind: 'folders', folders: [...chosen, folder], includeDescendants });
  };
  const removeFolder = (folder: string) => {
    const next = chosen.filter((candidate) => candidate !== folder);
    // A scope needs at least one folder; removing the last widens to all roots.
    if (next.length === 0) onChange({ kind: 'all-roots' });
    else onChange({ kind: 'folders', folders: next, includeDescendants });
  };

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="query-scope">
      <SegmentedControl
        label="Scope"
        value={scope.kind === 'all-roots' ? 'all' : 'folders'}
        onValueChange={setMode}
        options={[
          { value: 'all', label: 'All opened folders' },
          { value: 'folders', label: 'Chosen folders', disabled: roots.length === 0 && !origin },
        ]}
      />
      {scope.kind === 'folders' ? (
        <>
          <ul className="flex flex-wrap items-center gap-1" aria-label="Scope folders">
            {chosen.map((folder) => (
              <li key={folder} className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs" title={folder}>
                <span className="max-w-48 truncate">{basenameFsPath(folder)}</span>
                <button type="button" aria-label={`Remove ${basenameFsPath(folder)} from scope`} onClick={() => removeFolder(folder)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <Button size="compact" variant="outline" onClick={() => setPicking(true)}>
            <FolderPlus aria-hidden className="h-3.5 w-3.5" />
            Choose folder…
          </Button>
          <label className="flex items-center gap-1 text-xs">
            <Switch
              label="Include subfolders"
              checked={includeDescendants}
              onCheckedChange={(value) => onChange({ kind: 'folders', folders: chosen, includeDescendants: value })}
            />
            Include subfolders
          </label>
          <FolderPickerDialog open={picking} roots={roots} onOpenChange={setPicking} onChoose={addFolder} />
        </>
      ) : null}
    </div>
  );
};
