import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/renderer/App";
import "@/renderer/styles/index.css";

// The global interface is already declared in @/renderer/shared/types

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);