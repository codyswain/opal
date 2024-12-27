import React from 'react';
import { Button } from '@/renderer/shared/components/Button';
import { LucideIcon } from 'lucide-react';

interface ContextMenuItemProps {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  className?: string;
}

const ContextMenuItem: React.FC<ContextMenuItemProps> = ({ icon: Icon, label, onClick, className }) => {
  return (
    <Button
      variant="ghost"
      className={`w-full justify-start px-2 py-1.5 text-sm ${className}`}
      onClick={onClick}
    >
      {Icon && <Icon className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
};

export default ContextMenuItem;