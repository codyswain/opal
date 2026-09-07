import React from 'react';
import { basenameFsPath } from '@/common/fsPaths';
import { SegmentedControl, Switch } from '@/renderer/shared/ui';
import type { CollectionScope } from '@/types/collectionQuery';

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
  const choices = [...new Set([...(origin ? [origin] : []), ...roots])];
  const chosen = scope.kind === 'folders' ? scope.folders : [];
  const includeDescendants = scope.kind === 'folders' ? scope.includeDescendants : true;

  const setMode = (mode: 'all' | 'folders') => {
    if (mode === 'all') onChange({ kind: 'all-roots' });
    else onChange({ kind: 'folders', folders: chosen.length > 0 ? chosen : [origin ?? roots[0]].filter(Boolean), includeDescendants });
  };
  const toggleFolder = (folder: string) => {
    const next = chosen.includes(folder) ? chosen.filter((candidate) => candidate !== folder) : [...chosen, folder];
    if (next.length === 0) return; // A scope needs at least one folder; remove the last by switching to all roots.
    onChange({ kind: 'folders', folders: next, includeDescendants });
  };

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="query-scope">
      <SegmentedControl
        label="Scope"
        value={scope.kind === 'all-roots' ? 'all' : 'folders'}
        onValueChange={setMode}
        options={[
          { value: 'all', label: 'All opened folders' },
          { value: 'folders', label: 'Chosen folders', disabled: choices.length === 0 },
        ]}
      />
      {scope.kind === 'folders' ? (
        <>
          <ul className="flex flex-wrap items-center gap-2" aria-label="Scope folders">
            {choices.map((folder) => {
              const checked = chosen.includes(folder);
              return (
                <li key={folder}>
                  <label className="flex items-center gap-1 text-xs" title={folder}>
                    <input type="checkbox" checked={checked} onChange={() => toggleFolder(folder)} />
                    <span className="max-w-40 truncate">{basenameFsPath(folder)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="flex items-center gap-1 text-xs">
            <Switch
              label="Include subfolders"
              checked={includeDescendants}
              onCheckedChange={(value) => onChange({ kind: 'folders', folders: chosen, includeDescendants: value })}
            />
            Include subfolders
          </label>
        </>
      ) : null}
    </div>
  );
};
