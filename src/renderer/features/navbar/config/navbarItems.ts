import { NavbarItemProps } from "../components/NavbarItem";
import { Home, Notebook, Book} from "lucide-react";

const navbarItems: NavbarItemProps[] = [
  // TODO: add this in
  // { to: "/", icon: Home, text: "Home" },
  { to: "/notes", icon: Notebook, text: "Notes" },
  { to: "/explorer", icon:  Book, text: "Explorer"}
];

export default navbarItems;