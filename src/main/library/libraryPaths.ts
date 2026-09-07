import path from 'path';

/**
 * The app-managed configuration directory for the current library. One folder
 * under userData so a whole library configuration can be copied or moved.
 * Nothing here is ever written into an opened root.
 *
 *   <userData>/library/activity.json       personal activity (Recent)
 *   <userData>/library/views/<id>.yaml     saved views (later slice)
 *   <userData>/library/library.json        library preferences (later slice)
 */
export function libraryDirectory(userDataDir: string): string {
  return path.join(userDataDir, 'library');
}

export function activityStorePath(userDataDir: string): string {
  return path.join(libraryDirectory(userDataDir), 'activity.json');
}
