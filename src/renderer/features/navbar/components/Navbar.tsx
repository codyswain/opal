import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/renderer/shared/components/Button";
import { NavbarItem, NavbarItemProps } from "./NavbarItem";
import {
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Square,
  X,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react";
import { ThemeToggle } from "@/renderer/features/theme";

interface NavbarProps {
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomPane: () => void;
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  isBottomPaneOpen: boolean;
  items: NavbarItemProps[];
}

const Navbar: React.FC<NavbarProps> = ({
  toggleLeftSidebar,
  toggleRightSidebar,
  toggleBottomPane,
  isLeftSidebarOpen,
  isRightSidebarOpen,
  isBottomPaneOpen,
  items,
}) => {
  const location = useLocation();

  const handleWindowAction = (action: "minimize" | "maximize" | "close") => {
    window.electron[action]();
  };

  const renderWindowControls = () => (
    <div className="flex items-center space-x-2 no-drag">
      {[
        { action: "close", icon: X },
        { action: "minimize", icon: Minus },
        { action: "maximize", icon: Square },
      ].map(({ action, icon: Icon }) => (
        <Button
          key={action}
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() =>
            handleWindowAction(action as "minimize" | "maximize" | "close")
          }
        >
          <span className="sr-only">{action}</span>
          <Icon className="h-4 w-4 mr-2" />
        </Button>
      ))}
    </div>
  );

  const renderNavItems = () => (
    <ul className="flex items-center space-x-2 no-drag mx-auto">
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
    <div className="flex items-center space-x-2 no-drag">
      <ThemeToggle />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={toggleLeftSidebar}
      >
        {isLeftSidebarOpen ? (
          <PanelLeftClose className="h-4 w-4" />
        ) : (
          <PanelLeftOpen className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={toggleRightSidebar}
      >
        {isRightSidebarOpen ? (
          <PanelRightClose className="h-4 w-4" />
        ) : (
          <PanelRightOpen className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={toggleBottomPane}
      >
        {isBottomPaneOpen ? (
          <ChevronsDown className="h-4 w-4" />
        ) : (
          <ChevronsUp className="h-4 w-4" />
        )}
      </Button>
      <Link to="/settings">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 h-12 bg-background border-b border-border flex items-center justify-between px-4 z-20 drag-handle">
      {renderWindowControls()}
      {renderNavItems()}
      {renderSidebarControls()}
    </nav>
  );
};

export default Navbar;
