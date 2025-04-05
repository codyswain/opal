import { NavbarItemProps } from "../components/NavbarItem";
import { Home, Notebook, Book, Clock} from "lucide-react";

const navbarItems: NavbarItemProps[] = [
  // TODO: add this in
  // { to: "/", icon: Home, text: "Home" },
  { to: "/explorer", icon: Book, text: "Explorer"},
  { to: "/feed", icon: Clock, text: "Feed"}
];

export default navbarItems;