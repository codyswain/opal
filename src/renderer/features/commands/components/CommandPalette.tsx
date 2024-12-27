import React from 'react';
import { useCommands } from '../hooks/useCommands';

export const CommandPalette: React.FC = () => {
  const { getAllCommands, executeCommand } = useCommands();
  const commands = getAllCommands();

  return (
    <div>
      {commands.map(command => (
        <button key={command.id} onClick={() => executeCommand(command.id)}>
          {command.name}
        </button>
      ))}
    </div>
  );
};