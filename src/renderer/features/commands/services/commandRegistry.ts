

import { BehaviorSubject, Observable } from "rxjs";

export type CommandType = 'paneToggle' | 'navigation' | 'action';

export interface Command {
  id: string;
  name: string;
  type: CommandType;
  shortcut?: string[];
  keywords: string[];
  perform: () => void;
}

class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private commandsSubject: BehaviorSubject<Command[]> = new BehaviorSubject<Command[]>([]);

  private emitCommands(): void {
    this.commandsSubject.next(this.getAllCommands());
  }

  registerCommand(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new Error(`Command with id ${command.id} already exists`);
    }
    this.commands.set(command.id, command);
    this.emitCommands();
  }

  unregisterCommand(command: Command): void {
    if (!this.commands.has(command.id)) {
      throw new Error(`Command with id ${command.id} does not exist`);
    }
    this.commands.delete(command.id);
    this.emitCommands();
  }

  getCommand(id: string): Command | undefined {
    if (!this.commands.has(id)) {
      throw new Error(`Command with id ${id} does not exist`);
    }
    return this.commands.get(id);
  }

  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  executeCommand(id: string): void {
    const command = this.commands.get(id);
    if (!command) {
      throw new Error(`Command with id ${id} does not exist`);
    }
    command.perform();
  }

  getCommandsObservable(): Observable<Command[]> {
    return this.commandsSubject.asObservable();
  }
}

export const commandRegistry = new CommandRegistry();