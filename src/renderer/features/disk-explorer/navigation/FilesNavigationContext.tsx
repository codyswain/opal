import { createContext, useContext } from 'react';
import { useDiskStore } from '../store/diskStore';
import { useTabsStore } from '../store/tabsStore';

export interface FilesNavigationActions {
  navigateDirectory(path: string): void;
  openFile(path: string): void;
  returnToFolder(): void;
  closeFile(path: string): void;
}
// Stores and standalone explorer consumers do not require a Router.
const localActions: FilesNavigationActions = {
  navigateDirectory(path) {
    useDiskStore.getState().navigateToDirectory(path);
    useTabsStore.setState({ openedPath: null, activePath: null });
  },
  openFile(path) {
    useTabsStore.getState().openFile(path);
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
