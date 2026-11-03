import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
} from '@/common/fsPaths';

export type AppPathMutationKind = 'rename' | 'move';

export interface AppPathMutation {
  kind: AppPathMutationKind;
  oldPath: string;
  newPath: string;
}

/** `trashed` is Move to Trash in Opal; `external` is any other file that went away. */
export type PathRemovalReason = 'external' | 'trashed' | 'root-removed';
export interface PreparedPathMutation {
  commit(): void;
  rollback(): void;
}

export interface PathMutationParticipant {
  id: string;
  /**
   * Preparation must not mutate state. The coordinator prepares every
   * participant before synchronously committing any of them.
   */
  prepareAppMutation?: (
    mutation: AppPathMutation
  ) => PreparedPathMutation | void;
  preparePathRemoval?: (
    paths: readonly string[],
    reason: PathRemovalReason
  ) => PreparedPathMutation | void;
  prepareAllowedRoots?: (
    roots: readonly string[]
  ) => PreparedPathMutation | void;
}

export interface PathMutationCoordinator {
  register(participant: PathMutationParticipant): () => void;
  applyAppMutation(mutation: AppPathMutation): boolean;
  applyExternalRemoval(paths: readonly string[]): boolean;
  applyTrash(path: string): boolean;
  applyRootRemoval(rootPath: string): boolean;
  reconcileAllowedRoots(roots: readonly string[]): boolean;
}

function normalizedMutation(
  mutation: AppPathMutation
): AppPathMutation | null {
  const oldPath = normalizeFsPath(mutation.oldPath);
  const newPath = normalizeFsPath(mutation.newPath);
  if (
    !isAbsoluteFsPath(oldPath) ||
    !isAbsoluteFsPath(newPath) ||
    oldPath === newPath ||
    isFsPathAtOrBelow(oldPath, newPath)
  ) {
    return null;
  }
  return { ...mutation, oldPath, newPath };
}

function normalizedRemovalPaths(paths: readonly string[]): string[] {
  const normalized = [
    ...new Set(
      paths
        .filter((path) => typeof path === 'string' && isAbsoluteFsPath(path))
        .map(normalizeFsPath)
    ),
  ].sort((left, right) => left.length - right.length);

  return normalized.filter(
    (path, index) =>
      !normalized
        .slice(0, index)
        .some((parent) => isFsPathAtOrBelow(parent, path))
  );
}

function normalizedAllowedRoots(roots: readonly string[]): string[] | null {
  const normalized = roots.map(normalizeFsPath);
  if (normalized.some((root) => !isAbsoluteFsPath(root))) return null;
  return [...new Set(normalized)];
}

export function createPathMutationCoordinator(): PathMutationCoordinator {
  const participants = new Map<string, PathMutationParticipant>();

  const prepare = (
    callback: (participant: PathMutationParticipant) =>
      | PreparedPathMutation
      | void
  ) => {
    const prepared: PreparedPathMutation[] = [];
    for (const participant of participants.values()) {
      const transaction = callback(participant);
      if (transaction) prepared.push(transaction);
    }

    const committed: PreparedPathMutation[] = [];
    try {
      for (const transaction of prepared) {
        committed.push(transaction);
        transaction.commit();
      }
    } catch (error) {
      for (const transaction of committed.reverse()) {
        try {
          transaction.rollback();
        } catch {
          // Preserve the original commit error after attempting every rollback.
        }
      }
      throw error;
    }
  };

  return {
    register(participant) {
      participants.set(participant.id, participant);
      return () => {
        if (participants.get(participant.id) === participant) {
          participants.delete(participant.id);
        }
      };
    },
    applyAppMutation(mutation) {
      const normalized = normalizedMutation(mutation);
      if (!normalized) return false;
      prepare((participant) =>
        participant.prepareAppMutation?.(normalized)
      );
      return true;
    },
    applyExternalRemoval(paths) {
      const normalized = normalizedRemovalPaths(paths);
      if (normalized.length === 0) return false;
      prepare((participant) =>
        participant.preparePathRemoval?.(normalized, 'external')
      );
      return true;
    },
    applyTrash(path) {
      const normalized = normalizedRemovalPaths([path]);
      if (normalized.length !== 1) return false;
      prepare((participant) =>
        participant.preparePathRemoval?.(normalized, 'trashed')
      );
      return true;
    },
    applyRootRemoval(rootPath) {
      const normalized = normalizedRemovalPaths([rootPath]);
      if (normalized.length !== 1) return false;
      prepare((participant) =>
        participant.preparePathRemoval?.(normalized, 'root-removed')
      );
      return true;
    },
    reconcileAllowedRoots(roots) {
      const normalized = normalizedAllowedRoots(roots);
      if (!normalized) return false;
      prepare((participant) =>
        participant.prepareAllowedRoots?.(normalized)
      );
      return true;
    },
  };
}

export const pathMutationCoordinator = createPathMutationCoordinator();
