import React, { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Link2, Trash2 } from 'lucide-react';
import type { DiskEntry } from '@/types/disk';
import type { ItemMetadata } from '@/types/metadata';
import { Button } from '@/renderer/shared/ui';
import { useFilesNavigation } from '../../navigation/FilesNavigationContext';
import { RelatedChooser } from './RelatedChooser';

export const DetailsPanel: React.FC<{ entry: DiskEntry }> = ({ entry }) => {
  const tagsId = useId();
  const descriptionId = useId();
  const navigation = useFilesNavigation();
  const [details, setDetails] = useState<ItemMetadata | null>(null);
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, []);

  const applyDetails = (next: ItemMetadata) => {
    setDetails(next);
    setTags(next.properties.tags.join(', '));
    setDescription(next.properties.description);
  };

  const load = async () => {
    const token = ++request.current;
    setLoading(true);
    setError(null);
    setStatus(null);
    let result;
    try {
      result = await window.metadataAPI.read(entry.path);
    } catch {
      if (!alive.current || token !== request.current) return;
      setLoading(false);
      setDetails(null);
      setError('Could not load Details.');
      return;
    }
    if (!alive.current || token !== request.current) return;
    setLoading(false);
    if (!result.success) {
      setDetails(null);
      setError(result.error);
      return;
    }
    applyDetails(result.data);
  };

  useEffect(() => {
    void load();
    // The component is keyed by path; this runs once for its selected item.
  }, []);

  const parsedTags = tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const dirty = !!details && (
    description !== details.properties.description ||
    parsedTags.length !== details.properties.tags.length ||
    parsedTags.some((tag, index) => tag !== details.properties.tags[index])
  );

  const save = async () => {
    if (!details || saving || mutating || !dirty) return;
    const token = ++request.current;
    setSaving(true);
    setError(null);
    setStatus('Saving…');
    let result;
    try {
      result = await window.metadataAPI.saveProperties(
        entry.path,
        { tags: parsedTags, description },
        details.revision
      );
    } catch {
      if (!alive.current || token !== request.current) return;
      setSaving(false);
      setStatus(null);
      setError('Could not save Details.');
      return;
    }
    if (!alive.current || token !== request.current) return;
    setSaving(false);
    if (!result.success) {
      setStatus(null);
      setError(result.error);
      return;
    }
    applyDetails(result.data);
    setStatus('Saved');
  };

  const connect = async (target: string): Promise<string | null> => {
    if (dirty) return 'Save or reload your property changes before editing related items.';
    if (mutating) return 'Another related item change is still in progress.';
    const token = ++request.current;
    setMutating(true);
    setError(null);
    let result;
    try {
      result = await window.metadataAPI.addRelated(entry.path, target);
    } catch {
      if (!alive.current || token !== request.current) return 'The selected item changed.';
      setMutating(false);
      setError('Could not connect the related item.');
      return 'Could not connect the related item.';
    }
    if (!alive.current || token !== request.current) return 'The selected item changed.';
    setMutating(false);
    if (!result.success) {
      setError(result.error);
      return result.error;
    }
    applyDetails(result.data);
    return null;
  };

  const remove = async (edgeId: string) => {
    if (dirty || mutating) return;
    const token = ++request.current;
    setMutating(true);
    setError(null);
    let result;
    try {
      result = await window.metadataAPI.removeRelated(entry.path, edgeId);
    } catch {
      if (!alive.current || token !== request.current) return;
      setMutating(false);
      setError('Could not remove the related item.');
      return;
    }
    if (!alive.current || token !== request.current) return;
    setMutating(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    applyDetails(result.data);
  };

  if (loading) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading Details…</div>;
  }

  if (!details) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" className="text-sm text-destructive">{error ?? 'Details are unavailable.'}</p>
        <Button variant="outline" onClick={() => void load()}>Reload Details</Button>
      </div>
    );
  }

  return (
    <div data-disk-shortcuts-ignore="true" className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <section aria-labelledby={`${tagsId}-properties`} className="space-y-3">
        <h3 id={`${tagsId}-properties`} className="text-sm font-medium">Properties</h3>
        <div className="space-y-1">
          <label htmlFor={tagsId} className="text-xs font-medium">Tags</label>
          <input
            id={tagsId}
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              setStatus(null);
            }}
            placeholder="work, urgent"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-2xs text-muted-foreground">Separate tags with commas.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={descriptionId} className="text-xs font-medium">Description</label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setStatus(null);
            }}
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={!dirty || saving || mutating} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {status ? <p role="status" className="text-xs text-muted-foreground">{status}</p> : null}
          {error ? (
            <Button size="compact" variant="outline" onClick={() => void load()}>
              Reload Details
            </Button>
          ) : null}
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </section>

      <section aria-labelledby={`${tagsId}-related`} className="mt-6 border-t border-border/60 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`${tagsId}-related`} className="text-sm font-medium">Related</h3>
          <Button
            size="compact"
            variant="outline"
            aria-label="Add related item"
            disabled={dirty || mutating}
            onClick={() => setChooserOpen(true)}
          >
            <Link2 aria-hidden className="h-4 w-4" />
            Add
          </Button>
        </div>

        {dirty ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Save or reload your property changes before editing related items.
          </p>
        ) : null}

        {details.incomplete ? (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
            <p className="font-medium">Related results may be incomplete.</p>
            {details.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}

        {details.related.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No related items.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {details.related.map((related) => {
              const available = related.status === 'available' && !!related.targetPath;
              const statusLabel = related.status === 'missing'
                ? 'Missing'
                : related.status === 'ambiguous'
                  ? 'Ambiguous'
                  : null;
              return (
                <li key={related.edgeId} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={related.targetName}>{related.targetName}</p>
                    <p className="text-2xs text-muted-foreground">
                      {related.direction === 'incoming' ? 'Linked from this item' : 'Linked to this item'}
                      {statusLabel ? ` · ${statusLabel}` : ''}
                    </p>
                    {statusLabel ? <span className="sr-only">{statusLabel}</span> : null}
                  </div>
                  <Button
                    size="compact"
                    variant="ghost"
                    aria-label={`Open ${related.targetName}`}
                    disabled={!available}
                    onClick={() => {
                      if (!related.targetPath) return;
                      if (related.targetKind === 'directory') {
                        navigation.navigateDirectory(related.targetPath);
                      } else {
                        navigation.openFile(related.targetPath);
                      }
                    }}
                  >
                    <ExternalLink aria-hidden className="h-4 w-4" />
                    Open
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove related item ${related.targetName}`}
                    disabled={dirty || mutating}
                    onClick={() => void remove(related.edgeId)}
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RelatedChooser
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        onConnect={connect}
      />
    </div>
  );
};
