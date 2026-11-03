import { parentFsPath } from '@/common/fsPaths';
import { useDiskStore } from '../store/diskStore';

let activeDragSourcePath: string | null = null;

export function setActiveDragSourcePath(path: string): void {
  activeDragSourcePath = path;
}

export function getActiveDragSourcePath(): string | null {
  return activeDragSourcePath;
}

export function clearActiveDragSourcePath(): void {
  activeDragSourcePath = null;
}

/** The file of the tree row being dragged; null while a folder or nothing from the tree is. */
export function draggedTreeFile(): string | null {
  const source = activeDragSourcePath;
  const folder = source ? parentFsPath(source) : null;
  const listed = folder ? useDiskStore.getState().listings[folder] : undefined;
  return listed?.some((entry) => entry.path === source && !entry.isDirectory) ? source : null;
}
