import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { usePrivacyStore } from "./privacyStore";
import "./privacy.css";

/** Display privacy preserves the mounted app, including editors and in-flight saves. */
export function PrivacyBoundary({ children }: { children: React.ReactNode }) {
  const shielded = usePrivacyStore((state) => state.shielded);
  const returnButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (shielded) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      document.body.setAttribute("data-opal-shield", "true");
      content.current?.setAttribute("inert", "");
      returnButton.current?.focus();
    } else {
      document.body.removeAttribute("data-opal-shield");
      content.current?.removeAttribute("inert");
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    }
    return () => {
      document.body.removeAttribute("data-opal-shield");
    };
  }, [shielded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "h"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) usePrivacyStore.getState().toggle();
        return;
      }
      if (!usePrivacyStore.getState().shielded) return;
      if (event.key === "Tab") {
        event.preventDefault();
        returnButton.current?.focus();
      }
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target === returnButton.current
      )
        return;
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
      <div
        ref={content}
        data-opal-private-content
        hidden={shielded}
        aria-hidden={shielded || undefined}
        style={shielded ? undefined : { display: "contents" }}
      >
        {children}
      </div>
      {shielded &&
        createPortal(
          <div
            data-opal-privacy-shield
            role="dialog"
            aria-modal="true"
            aria-labelledby="opal-privacy-heading"
            className="opal-privacy-screen"
          >
            <div className="opal-privacy-drag drag-handle" />
            <div className="opal-privacy-message">
              <span className="opal-privacy-emblem">
                <ShieldCheck size={25} strokeWidth={1.4} />
              </span>
              <p className="opal-privacy-wordmark">OPAL</p>
              <h1 id="opal-privacy-heading">A moment of privacy.</h1>
              <p>Your place is kept. Everything is out of view.</p>
              <button
                ref={returnButton}
                onClick={() => usePrivacyStore.getState().reveal()}
              >
                Return to Opal
              </button>
              <span className="opal-privacy-shortcut">
                ⌘ / Ctrl + Shift + H
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
