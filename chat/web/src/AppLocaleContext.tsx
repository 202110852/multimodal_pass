/**
 * 앱 UI 언어 Context.
 * 이식 기준: stan_jejuonedosim/docs/browser-locale-auto-detect.md
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getInitialLocale,
  isAppLocale,
  LOCALE_STORAGE_KEY,
  setStoredLocale,
  type AppLocale,
} from "./locale.js";
import { UI_COPY, type UiCopy } from "./copy.js";
import { embedParentOrigin, hostedChat, initialHostLocale } from "./embed.js";

type AppLocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: UiCopy;
};

const AppLocaleContext = createContext<AppLocaleContextValue | null>(null);

export function AppLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => hostedChat ? initialHostLocale ?? "en" : getInitialLocale());

  const setLocale = useCallback((next: AppLocale) => {
    if (hostedChat) return; // The embedding site's selection owns the chat language.
    setLocaleState(next);
    setStoredLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (hostedChat) {
      const onConfig = (event: MessageEvent) => {
        if (event.origin !== embedParentOrigin || event.source !== window.parent) return;
        if (event.data?.type === "stan-chat:config" && isAppLocale(event.data.locale)) {
          setLocaleState(event.data.locale);
        }
      };
      window.addEventListener("message", onConfig);
      return () => window.removeEventListener("message", onConfig);
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LOCALE_STORAGE_KEY || !isAppLocale(e.newValue)) return;
      setLocaleState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale, t: UI_COPY[locale] }),
    [locale, setLocale],
  );

  return <AppLocaleContext.Provider value={value}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale(): AppLocaleContextValue {
  const ctx = useContext(AppLocaleContext);
  if (!ctx) throw new Error("useAppLocale must be used within AppLocaleProvider");
  return ctx;
}
