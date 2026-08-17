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
