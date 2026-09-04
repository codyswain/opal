import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/renderer/shared/components/Button";
import { NavbarItem, NavbarItemProps } from "./NavbarItem";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { ThemeToggle } from "@/renderer/features/theme";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

interface NavbarProps {
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  
  items: NavbarItemProps[];
}

const Navbar: React.FC<NavbarProps> = ({
  toggleLeftSidebar,
  toggleRightSidebar,
  isLeftSidebarOpen,
  isRightSidebarOpen,
  items,
}) => {
  const location = useLocation();
  const { canGoBack, canGoForward, goBack, goForward } = useFileExplorerStore();

  const renderWindowControls = () => (
    // pl-[78px] clears the macOS traffic lights, which the OS now draws itself
    // via titleBarStyle: 'hiddenInset'.
    <div className="flex items-center space-x-2 no-drag pl-[78px]">
      <div className="space-x-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goBack}
          aria-label="Go back"
          title="Go back"
          disabled={!canGoBack()}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goForward}
          aria-label="Go forward"
          title="Go forward"
          disabled={!canGoForward()}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  const renderNavItems = () => (
    <ul className="flex items-center space-x-2 no-drag">
      {items.map((item) => (
        <NavbarItem
          key={item.to}
          {...item}
          isActive={location.pathname === item.to}
        />
      ))}
    </ul>
  );

  const renderSidebarControls = () => (
    <div className="flex items-center space-x-1.5 no-drag">
      <ThemeToggle />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={toggleLeftSidebar}
        aria-label={
          isLeftSidebarOpen ? 'Hide navigation sidebar' : 'Show navigation sidebar'
        }
      >
        {isLeftSidebarOpen ? (
          <PanelLeftClose className="h-3.5 w-3.5" />
        ) : (
          <PanelLeftOpen className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={toggleRightSidebar}
        aria-label={
          isRightSidebarOpen ? 'Hide inspector sidebar' : 'Show inspector sidebar'
        }
      >
        {isRightSidebarOpen ? (
          <PanelRightClose className="h-3.5 w-3.5" />
        ) : (
          <PanelRightOpen className="h-3.5 w-3.5" />
        )}
      </Button>
      <Link to="/settings">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Open settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </div>
  );

  return (
    <nav data-testid="navbar" className="fixed top-0 left-0 right-0 h-10 bg-background border-b border-border flex items-center justify-between px-3 z-20 drag-handle">
      {renderWindowControls()}
      {renderNavItems()}
      {renderSidebarControls()}
    </nav>
  );
};

export default Navbar;
