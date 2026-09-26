import { useEffect } from "react";
import { embedParentOrigin } from "./embed.js";

/** The host may control the shell, but never receives chat text or credentials. */
export function EmbedBridge() {
  useEffect(() => {
    const parentOrigin = embedParentOrigin;
    if (!parentOrigin) return;
    const send = (type: string, extra = {}) => window.parent.postMessage({ type, ...extra }, parentOrigin);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) send("stan-chat:close");
    };
    const focus = () => {
      const el = document.activeElement;
      send("stan-chat:focus", { focused: el instanceof HTMLElement && el.matches("input, textarea, [contenteditable=true]") });
    };
    const blur = () => send("stan-chat:focus", { focused: false });
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      if (event.data?.type === "stan-chat:visibility" && event.data.visible === false) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.dispatchEvent(new Event("stan-chat:hide"));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    send("stan-chat:ready");
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
    };
  }, []);
  return null;
}
