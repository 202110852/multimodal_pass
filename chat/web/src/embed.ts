import { isAppLocale } from "./locale.js";

export const embedded = new URLSearchParams(window.location.search).get("embed") === "1";

function trustedParent(): string | null {
  if (!embedded || window.parent === window) return null;
  try {
    const parent = new URL(document.referrer);
    const localDev = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(parent.hostname);
    return parent.origin === "https://chat.stan.ai.kr" || localDev ? parent.origin : null;
  } catch {
    return null;
  }
}

export const embedParentOrigin = trustedParent();
export const hostedChat = embedParentOrigin !== null;
const requestedLocale = new URLSearchParams(window.location.search).get("lang");
export const initialHostLocale = hostedChat && isAppLocale(requestedLocale) ? requestedLocale : null;
