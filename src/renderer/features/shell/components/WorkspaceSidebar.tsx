import { FileText, Files, FolderPlus, Settings } from 'lucide-react';
import { isFsPathAtOrBelow } from '@/common/fsPaths';
import {
  FILES_ROUTE_PATH,
  browseFiles,
  serializeFilesLocation,
} from '@/renderer/features/disk-explorer/navigation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
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
  const openFolder = useDiskStore((state) => state.openFolder);
  const { navigateFiles } = useShell();
  const currentRoot = rootForDirectory(roots, currentDirectory);
  const filesDestination = currentDirectory
    ? {
        pathname: FILES_ROUTE_PATH,
        search: serializeFilesLocation({
          mode: 'browse',
          directory: currentDirectory,
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
            onActivate={onNavigate}
          />
        </SidebarSection>
      </nav>

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
