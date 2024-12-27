import React from "react";
import { Link } from "react-router-dom";
import { LucideIcon } from "lucide-react";

export interface NavbarItemProps {
  to: string;
  icon: LucideIcon;
  text: string;
  isActive?: boolean;
}

export const NavbarItem: React.FC<NavbarItemProps> = ({ to, icon: Icon, text, isActive }) => (
  <li>
    <Link
      to={to}
      className={`flex items-center px-3 py-1 rounded-md text-sm ${
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      }`}
    >
      <Icon className="h-4 w-4 mr-2" />
      {text}
    </Link>
  </li>
);