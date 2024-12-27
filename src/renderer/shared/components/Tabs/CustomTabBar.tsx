import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/renderer/shared/components/Button';
import { cn } from '@/renderer/shared/utils';

interface Tab {
  id: string;
  title: string;
}

interface CustomTabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabDragStart: (id: string, e: React.DragEvent) => void;
}

const CustomTabBar: React.FC<CustomTabBarProps> = ({
  tabs,
  activeTab,
  onTabClick,
  onTabClose,
  onTabDragStart,
}) => {
  return (
    <div className="flex bg-background border-b border-border overflow-x-auto mt-2">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center px-3 py-2 border-r border-border cursor-pointer group",
            activeTab === tab.id
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          )}
          onClick={() => onTabClick(tab.id)}
          draggable
          onDragStart={(e) => onTabDragStart(tab.id, e)}
        >
          <span className="mr-2 truncate max-w-[120px]">{tab.title}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
};

export default CustomTabBar;