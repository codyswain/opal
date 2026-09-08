import { createContext, useContext } from 'react';
import { useDiskStore } from '../store/diskStore';
import { useTabsStore } from '../store/tabsStore';
import type { FilesCollection } from './filesLocation';

export interface FilesNavigationActions {
  navigateDirectory(path: string): void;
  /** Browse Recent or a query collection; records no activity. */
  navigateCollection(collection: FilesCollection): void;
  openFile(path: string): void;
  /** Single-click open: the file takes the preview slot until it is pinned. */
  previewFile(path: string): void;
  returnToFolder(): void;
  closeFile(path: string): void;
}
// Stores and standalone explorer consumers do not require a Router.
const localActions: FilesNavigationActions = {
  navigateDirectory(path) {
    useDiskStore.getState().navigateToDirectory(path);
    useTabsStore.setState({ openedPath: null, activePath: null });
  },
  navigateCollection(collection) {
    useDiskStore.getState().navigateToCollection(collection);
    useTabsStore.setState({ openedPath: null, activePath: null });
  },
  openFile(path) {
    useTabsStore.getState().openFile(path);
  },
  previewFile(path) {
    useTabsStore.getState().openPreview(path);
  },
  returnToFolder() {
    useTabsStore.setState({ openedPath: null, activePath: null });
  },
  closeFile(path) {
    useTabsStore.getState().close(path);
  },
};
export const FilesNavigationContext =
  createContext<FilesNavigationActions>(localActions);
export const useFilesNavigation = () => useContext(FilesNavigationContext);
