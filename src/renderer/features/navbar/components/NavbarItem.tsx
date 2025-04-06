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
      className={`flex items-center px-2 py-0.5 rounded-md text-xs ${
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      }`}
    >
      <Icon className="h-3.5 w-3.5 mr-1.5" />
      {text}
    </Link>
  </li>
);