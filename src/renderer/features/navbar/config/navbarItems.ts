import { NavbarItemProps } from "../components/NavbarItem";
import { Home, Notebook } from "lucide-react";

const navbarItems: NavbarItemProps[] = [
  // TODO: add this in
  // { to: "/", icon: Home, text: "Home" },
  { to: "/notes", icon: Notebook, text: "Notes" }
];

export default navbarItems;