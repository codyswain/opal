import { useCallback } from 'react';
import { Command, commandRegistry } from '../services/commandRegistry';

export const useCommands = () => {
  const registerCommand = useCallback((command: Command) => {
    commandRegistry.registerCommand(command);
  }, []);

  const executeCommand = useCallback((id: string) => {
    commandRegistry.executeCommand(id);
  }, []);

  const getAllCommands = useCallback(() => {
    return commandRegistry.getAllCommands();
  }, []);

  const unregisterCommand = useCallback((command: Command) => {
    commandRegistry.unregisterCommand(command);
  }, []);

  return { registerCommand, executeCommand, getAllCommands, unregisterCommand };
};