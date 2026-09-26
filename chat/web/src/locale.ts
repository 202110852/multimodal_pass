/**
 * 브라우저 언어 → 앱 언어 4종 감지.
 * 이식 기준: stan_jejuonedosim/docs/browser-locale-auto-detect.md
 */

export type AppLocale = "ko" | "en" | "zh" | "ja";

export const LOCALE_STORAGE_KEY = "app_locale";

/** UI 드롭다운·칩 순서 */
export const APP_LOCALES: AppLocale[] = ["ko", "zh", "en", "ja"];

export const LOCALE_MENU_LABELS: Record<AppLocale, string> = {
  ko: "한국어",
  en: "English",
  zh: "中文",
  ja: "日本語",
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "ko" || value === "en" || value === "zh" || value === "ja";
}

/** 브라우저 언어가 4개에 안 맞을 때 기본값 */
const DEFAULT_BROWSER_LOCALE: AppLocale = "en";

function mapLanguageTagToAppLocale(tag: string): AppLocale | null {
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("en")) return "en";
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("ja")) return "ja";
  return null;
}

/**
 * 브라우저 언어 목록에서 첫 매칭 로케일.
 * 우선순위: navigator.languages → navigator.language → en
 */
export function detectBrowserLocale(): AppLocale {
  if (typeof navigator === "undefined") return DEFAULT_BROWSER_LOCALE;
  const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const tag of candidates) {
    const locale = mapLanguageTagToAppLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_BROWSER_LOCALE;
}

export function setStoredLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* 무시 */
  }
}

/**
 * 1) localStorage 유효값 → 그대로
 * 2) 없으면 브라우저 감지 후 저장
 */
export function getInitialLocale(): AppLocale {
  try {
    if (typeof localStorage === "undefined") return detectBrowserLocale();
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(stored)) return stored;
  } catch {
    return detectBrowserLocale();
  }
  const detected = detectBrowserLocale();
  setStoredLocale(detected);
  return detected;
}
