import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/renderer/App";
import "@/renderer/styles/index.css";
import { mark, measure } from "@/renderer/shared/perf/marks";
import { installDropGuard } from "@/renderer/shared/dropGuard";

installDropGuard(window);

// The global interface is already declared in @/renderer/shared/types

mark("opal:render-start");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// requestAnimationFrame fires after the first paint, so this measures time to
// something the user can actually see rather than time to mount.
requestAnimationFrame(() => {
  mark("opal:first-paint");
  const elapsed = measure("opal:launch", "opal:render-start", "opal:first-paint");
  if (elapsed !== null) {
    console.info(`[perf] renderer first paint: ${elapsed.toFixed(1)}ms`);
  }
});
