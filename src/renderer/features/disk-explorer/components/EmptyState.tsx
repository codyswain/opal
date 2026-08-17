import React from 'react';

interface EmptyStateProps {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ Icon, title, description, action }) => (
  <div className="grid flex-1 place-items-center p-6">
    <div className="flex max-w-xs flex-col items-center gap-2 text-center">
      <Icon className="h-8 w-8 opacity-25" />
      <p data-testid="empty-state-title" className="text-sm font-medium">
        {title}
      </p>
      {description && <p className="text-2xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  </div>
);
