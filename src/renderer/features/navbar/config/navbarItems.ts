import { NavbarItemProps } from "../components/NavbarItem";
import { Book, HardDrive } from "lucide-react";

const navbarItems: NavbarItemProps[] = [
  // TODO: add this in
  // { to: "/", icon: Home, text: "Home" },
  { to: "/explorer", icon: Book, text: "Explorer"},
  { to: "/files", icon: HardDrive, text: "Files"},
];

export default navbarItems;
