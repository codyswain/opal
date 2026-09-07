import { Clock, FileText, Files, FolderPlus, Plus, Settings, SlidersHorizontal } from 'lucide-react';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import {
  FILES_ROUTE_PATH,
  RECENT_COLLECTION,
  browseCollection,
  browseFiles,
  directoryCollection,
  queryCollection,
  serializeFilesLocation,
} from '@/renderer/features/disk-explorer/navigation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useQueryDraftsStore } from '@/renderer/features/disk-explorer/store/queryDraftsStore';
import { ThemeToggle } from '@/renderer/features/theme';
import { IconButton } from '@/renderer/shared/ui';
import { useShell } from '../context/ShellContext';
import { DirectoryTree } from './DirectoryTree';
import { SidebarItem } from './SidebarItem';
import { SidebarSection } from './SidebarSection';
import { WorkspaceHeader } from './WorkspaceHeader';

interface WorkspaceSidebarProps {
  onNavigate?: () => void;
  onClose?: () => void;
}

function rootForDirectory(
  roots: readonly string[],
  directory: string | null
): string | null {
  if (!directory) return roots[0] ?? null;
  return (
    [...roots]
      .sort((left, right) => right.length - left.length)
      .find((root) => isFsPathAtOrBelow(root, directory)) ?? null
  );
}

export function WorkspaceSidebar({
  onClose,
  onNavigate,
}: WorkspaceSidebarProps) {
  const roots = useDiskStore((state) => state.roots);
  const currentDirectory = useDiskStore((state) => state.currentDirectory);
  const currentCollection = useDiskStore((state) => state.currentCollection);
  const openFolder = useDiskStore((state) => state.openFolder);
  const { navigateFiles, location } = useShell();
  const currentRoot = rootForDirectory(roots, currentDirectory);
  const drafts = useQueryDraftsStore((state) => state.drafts);
  const draftOrder = useQueryDraftsStore((state) => state.order);
  const createDraft = useQueryDraftsStore((state) => state.create);
  const onFiles = location.pathname === FILES_ROUTE_PATH;
  const isRecent = currentCollection?.kind === 'recent';
  const currentQueryId = currentCollection?.kind === 'query' ? currentCollection.id : null;
  const newView = () => {
    const id = createDraft();
    navigateFiles(browseCollection(queryCollection(id)));
    onNavigate?.();
  };
  const recentDestination = {
    pathname: FILES_ROUTE_PATH,
    search: serializeFilesLocation({
      mode: 'browse',
      collection: RECENT_COLLECTION,
    }),
  };
  const filesDestination = currentDirectory
    ? {
        pathname: FILES_ROUTE_PATH,
        search: serializeFilesLocation({
          mode: 'browse',
          collection: directoryCollection(currentDirectory),
        }),
      }
    : FILES_ROUTE_PATH;

  const navigateToRoot = (path: string) => {
    navigateFiles(browseFiles(path));
    onNavigate?.();
  };

  const handleOpenFolder = async () => {
    await openFolder();
    const directory = useDiskStore.getState().currentDirectory;
    if (!directory) return;
    navigateFiles(browseFiles(directory));
    onNavigate?.();
  };

  return (
    <aside
      data-testid="workspace-sidebar"
      aria-label="Workspace"
      className="flex h-full min-h-0 w-full flex-col bg-sidebar text-foreground"
    >
      <WorkspaceHeader
        roots={roots}
        currentRoot={currentRoot}
        onSelectRoot={navigateToRoot}
        onOpenFolder={() => void handleOpenFolder()}
        onClose={onClose}
      />

      <nav aria-label="Primary" className="shrink-0 py-2">
        <SidebarSection>
          <SidebarItem
            to="/explorer"
            icon={FileText}
            label="Notes"
            onActivate={onNavigate}
          />
          <SidebarItem
            to={filesDestination}
            icon={Files}
            label="Files"
            active={onFiles && !isRecent && !currentQueryId}
            onActivate={onNavigate}
          />
          <SidebarItem
            to={recentDestination}
            icon={Clock}
            label="Recent"
            active={onFiles && isRecent}
            onActivate={onNavigate}
          />
        </SidebarSection>
      </nav>

      <SidebarSection
        title="Views"
        className="border-t border-border-subtle pt-1"
        action={
          <IconButton label="New view" onClick={newView} size="compact">
            <Plus aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
        }
      >
        {draftOrder.length === 0 ? (
          <p className="px-2 py-1 text-metadata text-foreground-tertiary">
            Filter any folder to start a view.
          </p>
        ) : (
          <ul aria-label="Views" className="flex flex-col">
            {draftOrder.map((id) => (
              <li key={id}>
                <SidebarItem
                  to={{
                    pathname: FILES_ROUTE_PATH,
                    search: serializeFilesLocation({ mode: 'browse', collection: queryCollection(id) }),
                  }}
                  icon={SlidersHorizontal}
                  label={drafts[id]?.name ?? 'Untitled view'}
                  active={onFiles && currentQueryId === id}
                  onActivate={onNavigate}
                />
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection
        title="Open folders"
        className="flex min-h-0 flex-1 flex-col border-t border-border-subtle pt-1"
        contentClassName="min-h-0 flex-1 px-0"
        action={
          <IconButton
            label="Open folder"
            onClick={() => void handleOpenFolder()}
            size="compact"
          >
            <FolderPlus aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
        }
      >
        <DirectoryTree onNavigate={onNavigate} />
      </SidebarSection>

      <div className="flex shrink-0 items-center gap-1 border-t border-border-subtle p-2">
        <SidebarItem
          to="/settings"
          icon={Settings}
          label="Settings"
          onActivate={onNavigate}
          className="flex-1"
        />
        <ThemeToggle />
      </div>
    </aside>
  );
}

export type { WorkspaceSidebarProps };
