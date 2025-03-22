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
  ChevronsUp,
  ChevronsDown,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { ThemeToggle } from "@/renderer/features/theme";
import { useFileExplorerStore } from "@/renderer/features/file-explorer-v2/store/fileExplorerStore";

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
  const { canGoBack, canGoForward, goBack, goForward } = useFileExplorerStore();

  const handleWindowAction = (action: "minimize" | "maximize" | "close") => {
    window.electron[action]();
  };

  const renderWindowControls = () => (
    <div className="flex items-center space-x-1.5 no-drag ml-2">
      {/* Apple-style buttons */}
      <button
        className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
        onClick={() => handleWindowAction("close")}
        title="Close"
      />
      <button
        className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors"
        onClick={() => handleWindowAction("minimize")}
        title="Minimize"
      />
      <button
        className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors"
        onClick={() => handleWindowAction("maximize")}
        title="Maximize"
      />
    </div>
  );

  const renderNavItems = () => (
    <ul className="flex items-center space-x-2 no-drag">
      <li className="flex items-center mr-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={goBack}
          title="Go back"
          disabled={!canGoBack()}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={goForward}
          title="Go forward"
          disabled={!canGoForward()}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </li>
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
