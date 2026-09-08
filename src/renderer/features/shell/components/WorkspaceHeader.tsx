import {
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  Gem,
  PanelLeftClose,
} from "lucide-react";
import { basenameFsPath } from "@/common/fsPaths";
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/renderer/shared/ui";

interface WorkspaceHeaderProps {
  roots: readonly string[];
  currentRoot: string | null;
  onSelectRoot: (path: string) => void;
  onOpenFolder: () => void;
  onClose?: () => void;
}

export function WorkspaceHeader({
  currentRoot,
  onClose,
  onOpenFolder,
  onSelectRoot,
  roots,
}: WorkspaceHeaderProps) {
  const rootName = currentRoot ? basenameFsPath(currentRoot) : null;

  return (
    <div className="drag-handle flex h-header shrink-0 items-center border-b border-border-subtle pl-[78px] pr-2">
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={
              rootName
                ? `Choose workspace folder, current ${rootName}`
                : "Choose workspace folder"
            }
            className="no-drag flex h-control min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left outline-none transition-colors duration-hover ease-standard hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-surface-selected text-foreground">
              <Gem aria-hidden className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              Opal
            </span>
            <ChevronDown
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-icon"
            />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-56">
          {roots.length > 0 ? (
            <>
              <MenuLabel>Open folders</MenuLabel>
              {roots.map((root) => (
                <MenuItem key={root} onSelect={() => onSelectRoot(root)}>
                  <Folder aria-hidden className="mr-2 h-3.5 w-3.5" />
                  <span className="truncate">{basenameFsPath(root)}</span>
                  {root === currentRoot ? (
                    <Check aria-hidden className="ml-auto h-3.5 w-3.5" />
                  ) : null}
                </MenuItem>
              ))}
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem onSelect={onOpenFolder}>
            <FolderPlus aria-hidden className="mr-2 h-3.5 w-3.5" />
            Open folder…
          </MenuItem>
        </MenuContent>
      </Menu>
      {onClose ? (
        <IconButton
          label="Close workspace sidebar"
          onClick={onClose}
          className="no-drag ml-1"
        >
          <PanelLeftClose aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

export type { WorkspaceHeaderProps };
