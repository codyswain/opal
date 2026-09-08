import React from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { TagCount } from '@/types/collectionQuery';
import { SegmentedControl } from '@/renderer/shared/ui';
import type { CollectionViewMode } from '../CollectionView';
import { FilterChips } from './FilterChips';
import { FilterMenu } from './FilterMenu';
import type { EditableChip } from './editableFilters';

interface ListToolbarProps {
  /** The breadcrumb or the view's name. */
  leading: React.ReactNode;
  chips: EditableChip[];
  onChipsChange: (chips: EditableChip[]) => void;
  tagSuggestions?: TagCount[];
  layout: CollectionViewMode;
  onLayout: (layout: CollectionViewMode) => void;
  /** The Display and Views buttons, then anything the surface adds (Preview). */
  actions: React.ReactNode;
  headerRef?: React.Ref<HTMLDivElement>;
}

/**
 * One toolbar for every list: what narrows the rows on the left, how they are
 * shown on the right. Bastion's Episodes bar, which the owner named, is the
 * reference: Filter with its chips, then count, layout, Display and Views.
 */
export const ListToolbar: React.FC<ListToolbarProps> = ({ leading, chips, onChipsChange, tagSuggestions, layout, onLayout, actions, headerRef }) => (
  <div ref={headerRef} data-disk-shortcuts-ignore="true" data-testid="list-toolbar" className="flex min-h-11 shrink-0 flex-wrap items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
    {leading}
    <div className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />
    <FilterMenu chips={chips} onChange={onChipsChange} />
    <FilterChips chips={chips} onChange={onChipsChange} tagSuggestions={tagSuggestions} />
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <SegmentedControl
        label="Layout"
        value={layout}
        onValueChange={(value) => onLayout(value as CollectionViewMode)}
        options={[
          { value: 'list', label: 'List', icon: <ListIcon aria-hidden className="h-3.5 w-3.5" /> },
          { value: 'gallery', label: 'Gallery', icon: <LayoutGrid aria-hidden className="h-3.5 w-3.5" /> },
        ]}
      />
      {actions}
    </div>
  </div>
);
