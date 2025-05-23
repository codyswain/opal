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

  const handleWindowAction = (action: "minimize" | "maximize" | "close") => {
    window.systemAPI[action]();
  };

  const renderWindowControls = () => (
    <div className="flex items-center space-x-2 no-drag ml-2">
      {/* Apple-style buttons */}
      <button
        className="w-2.5 h-2.5 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
        onClick={() => handleWindowAction("close")}
        title="Close"
      />
      <button
        className="w-2.5 h-2.5 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors"
        onClick={() => handleWindowAction("minimize")}
        title="Minimize"
      />
      <button
        className="w-2.5 h-2.5 rounded-full bg-green-500 hover:bg-green-600 transition-colors"
        onClick={() => handleWindowAction("maximize")}
        title="Maximize"
      />
      <div className="w-4"></div>
      <div className="space-x-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={goBack}
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
      >
        {isRightSidebarOpen ? (
          <PanelRightClose className="h-3.5 w-3.5" />
        ) : (
          <PanelRightOpen className="h-3.5 w-3.5" />
        )}
      </Button>
      <Link to="/settings">
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </div>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 h-10 bg-background border-b border-border flex items-center justify-between px-3 z-20 drag-handle">
      {renderWindowControls()}
      {renderNavItems()}
      {renderSidebarControls()}
    </nav>
  );
};

export default Navbar;
