import { Command, commandRegistry } from "@/renderer/features/commands";
import { useRegisterActions, Action, KBarProvider } from "kbar";
import { useEffect, useState, useCallback } from "react";

interface KBarContentProps {
  actions: Action[];
  children: React.ReactNode;
}

export const KBarContent: React.FC<KBarContentProps> = ({
  actions,
  children,
}) => {
  useRegisterActions(actions, [actions]);

  return <>{children}</>;
};

const KBarActionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [actions, setActions] = useState<Action[]>([]);

  const updateActions = useCallback((commands: Command[]) => {
    const registryActions = commands.map((command: Command) => ({
      id: command.id,
      name: command.name,
      shortcut: command.shortcut,
      perform: command.perform,
    }));
    setActions(registryActions);
  }, []);

  useEffect(() => {
    const subscription = commandRegistry
      .getCommandsObservable()
      .subscribe(updateActions);

    return () => {
      subscription.unsubscribe();
    };
  }, [updateActions]);

  return (
    <KBarProvider actions={actions} options={{ disableScrollbarManagement: true }}>
      <KBarContent actions={actions}>{children}</KBarContent>
    </KBarProvider>
  );
};

export { KBarActionsProvider };
