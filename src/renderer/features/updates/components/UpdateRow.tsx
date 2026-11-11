import * as React from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { SidebarItem } from '@/renderer/features/shell/components/SidebarItem';
import { selectUpdating, useUpdatesStore } from '../store/updatesStore';

/**
 * "Update ready", above Settings, only while a newer build is ready. One
 * click installs it: Opal saves, closes, swaps itself and reopens. Its
 * tooltip is the build's one line of notes.
 */
export function UpdateRow() {
  const state = useUpdatesStore((store) => store.state);
  const updating = useUpdatesStore(selectUpdating);
  if (!state || !(state.showRow || state.busy === 'installing')) return null;
  return (
    <SidebarItem
      icon={ArrowDownToLine}
      label={updating ? 'Updating…' : 'Update ready'}
      title={state.available?.notes || undefined}
      disabled={updating}
      onActivate={() => void useUpdatesStore.getState().install()}
    />
  );
}
