import path from 'path';

/**
 * The app-managed configuration directory for the current library. One folder
 * under userData so a whole library configuration can be copied or moved.
 * Nothing here is ever written into an opened root.
 *
 *   <userData>/library/activity.json       personal activity (Recent)
 *   <userData>/library/views/<id>.yaml     saved views
 *   <userData>/library/views/.trash/       removed views kept for undo
 *   <userData>/library/library.json        library preferences (view order)
 *   <userData>/library/index/              chat embedding index (disposable)
 *   <userData>/library/chat/<id>.json      chat conversations
 */
export function libraryDirectory(userDataDir: string): string {
  return path.join(userDataDir, 'library');
}

export function activityStorePath(userDataDir: string): string {
  return path.join(libraryDirectory(userDataDir), 'activity.json');
}

export function viewsDirectory(libraryDir: string): string {
  return path.join(libraryDir, 'views');
}

export function viewsTrashDirectory(libraryDir: string): string {
  return path.join(viewsDirectory(libraryDir), '.trash');
}

export function libraryPreferencesPath(libraryDir: string): string {
  return path.join(libraryDir, 'library.json');
}

export function chatIndexDirectory(libraryDir: string): string {
  return path.join(libraryDir, 'index');
}

export function chatConversationsDirectory(libraryDir: string): string {
  return path.join(libraryDir, 'chat');
}
