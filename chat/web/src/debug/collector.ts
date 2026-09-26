/**
 * 버그 리포트용 기록 — 앱이 켜질 때부터 모은다 (main.tsx 에서 installCollectors).
 *
 * - 콘솔(error·warn·info·log), 잡히지 않은 오류와 Promise 거부
 * - 최근 네트워크 요청 (fetch) — 주소·상태·걸린 시간
 * - 최근 사용자 동작 (클릭·키 입력 종류·화면 이동)
 * - 앱이 등록한 내부 상태 (registerState)
 *
 * 비밀값은 모으지 않는다: 요청 헤더·본문은 적지 않고, 주소의 key/token 류 값은 가린다.
 * sessionStorage(관리자 토큰)는 키 이름만 적는다.
 */

type Level = "error" | "warn" | "info" | "log";
interface ConsoleEntry {
  at: string;
  level: Level;
  message: string;
}
interface NetEntry {
  at: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  error?: string;
}
interface Crumb {
  at: string;
  kind: string;
  detail: string;
}

const MAX_CONSOLE = 150;
const MAX_NET = 60;
const MAX_CRUMBS = 60;
const consoleLog: ConsoleEntry[] = [];
const netLog: NetEntry[] = [];
const crumbs: Crumb[] = [];
const states = new Map<string, () => unknown>();
const startedAt = new Date().toISOString();
let installed = false;

const now = () => new Date().toISOString();
const push = <T>(list: T[], item: T, max: number) => {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
};

const SECRET_PARAM = /(key|token|secret|password|auth)/i;

/** 주소에서 비밀스러운 쿼리 값을 가린다. data: 주소는 앞부분만. */
export function safeUrl(raw: string): string {
  if (raw.startsWith("data:")) return `${raw.slice(0, 40)}…(${raw.length}자)`;
  try {
    const u = new URL(raw, location.href);
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, "[가림]");
    return u.origin === location.origin ? u.pathname + u.search + u.hash : u.toString();
  } catch {
    return raw.slice(0, 300);
  }
}

function describe(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack.split("\n").slice(1, 6).join("\n")}` : ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "string" && x.length > 500 ? `${x.slice(0, 500)}…` : x));
  } catch {
    return String(v);
  }
}

/** 요소를 사람이 알아볼 수 있게 — 태그#id.class[aria-label] "글자" */
export function describeElement(el: Element | null): string {
  if (!el) return "";
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; cur && i < 4; i++, cur = cur.parentElement) {
    let s = cur.tagName.toLowerCase();
    if (cur.id) s += `#${cur.id}`;
    const cls = [...cur.classList].slice(0, 3).join(".");
    if (cls) s += `.${cls}`;
    const label = cur.getAttribute("aria-label");
    if (label) s += `[aria-label="${label.slice(0, 30)}"]`;
    parts.unshift(s);
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${parts.join(" > ")}${text ? ` "${text}"` : ""}`;
}

export function installCollectors(): void {
  if (installed) return;
  installed = true;

  for (const level of ["error", "warn", "info", "log"] as Level[]) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const message = args.map(describe).join(" ").slice(0, 2000);
      // 사용자가 멈춤을 누르면 client-js 가 AbortError 를 console.error 로 남긴다 — 버그가 아니라 경고로 센다
      const lv: Level = level === "error" && /AbortError|aborted/i.test(message) ? "warn" : level;
      push(consoleLog, { at: now(), level: lv, message }, MAX_CONSOLE);
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => {
    // 이미지 로드 실패 같은 리소스 오류는 캡처 단계에서 온다 — 요소만 적는다
    if (e instanceof ErrorEvent) {
      push(consoleLog, { at: now(), level: "error", message: `[uncaught] ${describe(e.error ?? e.message)} @ ${e.filename}:${e.lineno}:${e.colno}` }, MAX_CONSOLE);
    }
  });
  window.addEventListener(
    "error",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLImageElement) {
        push(consoleLog, { at: now(), level: "warn", message: `[image] 불러오지 못함 ${safeUrl(t.currentSrc || t.src)}` }, MAX_CONSOLE);
      }
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    push(consoleLog, { at: now(), level: "error", message: `[unhandledrejection] ${describe(e.reason)}` }, MAX_CONSOLE);
  });

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const t0 = performance.now();
    const entry: NetEntry = { at: now(), method, url: safeUrl(url), status: null, ms: 0 };
    push(netLog, entry, MAX_NET);
    try {
      const res = await origFetch(input, init);
      entry.status = res.status;
      entry.ms = Math.round(performance.now() - t0);
      return res;
    } catch (e) {
      entry.ms = Math.round(performance.now() - t0);
      entry.error = (e as Error).name === "AbortError" ? "aborted" : describe(e).slice(0, 300);
      throw e;
    }
  };

  document.addEventListener(
    "click",
    (e) => push(crumbs, { at: now(), kind: "click", detail: describeElement(e.target as Element) }, MAX_CRUMBS),
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      // 무엇을 입력했는지는 적지 않는다 — 특수 키만
      if (e.key.length > 1 || e.metaKey || e.ctrlKey) {
        const mods = [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
        push(crumbs, { at: now(), kind: "key", detail: [...mods, e.key].join("+") }, MAX_CRUMBS);
      }
    },
    true,
  );
  const nav = () => push(crumbs, { at: now(), kind: "navigate", detail: location.pathname + location.hash }, MAX_CRUMBS);
  window.addEventListener("hashchange", nav);
  window.addEventListener("popstate", nav);
  document.addEventListener("visibilitychange", () =>
    push(crumbs, { at: now(), kind: "visibility", detail: document.visibilityState }, MAX_CRUMBS),
  );
}

/** 화면이 자기 내부 상태를 알린다. 반환한 함수로 해제. */
export function registerState(name: string, getter: () => unknown): () => void {
  states.set(name, getter);
  return () => {
    if (states.get(name) === getter) states.delete(name);
  };
}

/** 긴 글·큰 배열·깊은 객체를 줄인다 (리포트 크기 제한). */
function shrink(v: unknown, depth = 0): unknown {
  if (typeof v === "string") {
    if (v.startsWith("data:")) return `${v.slice(0, 30)}…(${v.length}자)`;
    return v.length > 3000 ? `${v.slice(0, 3000)}…(${v.length}자)` : v;
  }
  if (typeof v === "function") return `[function ${v.name || "anonymous"}]`;
  if (depth > 8) return "[깊이 초과]";
  if (Array.isArray(v)) {
    const arr = v.length > 80 ? [...v.slice(0, 10), `…${v.length - 60}개 생략…`, ...v.slice(-50)] : v;
    return arr.map((x) => shrink(x, depth + 1));
  }
  if (v instanceof Map) return shrink(Object.fromEntries(v), depth);
  if (v instanceof Set) return shrink([...v], depth);
  if (v instanceof Element) return describeElement(v);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = shrink(x, depth + 1);
    return out;
  }
  return v;
}

function storageSummary(store: Storage | undefined, withValues: boolean) {
  const out: Record<string, unknown> = {};
  try {
    if (!store) return out;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)!;
      const val = store.getItem(k) ?? "";
      out[k] = withValues && !SECRET_PARAM.test(k) ? { bytes: val.length, preview: shrink(val.slice(0, 300)) } : { bytes: val.length };
    }
  } catch (e) {
    out._error = describe(e);
  }
  return out;
}

async function environment() {
  const n = navigator as Navigator & {
    userAgentData?: { brands: unknown; mobile: boolean; platform: string; getHighEntropyValues?: (h: string[]) => Promise<unknown> };
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
    deviceMemory?: number;
  };
  let uaHigh: unknown = null;
  try {
    uaHigh = await n.userAgentData?.getHighEntropyValues?.(["platformVersion", "model", "architecture", "fullVersionList"]);
  } catch {
    /* 지원 안 함 */
  }
  let storageEstimate: unknown = null;
  try {
    storageEstimate = await navigator.storage?.estimate?.();
  } catch {
    /* 지원 안 함 */
  }
  const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return {
    userAgent: navigator.userAgent,
    userAgentData: n.userAgentData ? { brands: n.userAgentData.brands, mobile: n.userAgentData.mobile, platform: n.userAgentData.platform, high: uaHigh } : null,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeOffsetMin: new Date().getTimezoneOffset(),
    online: navigator.onLine,
    cookieEnabled: navigator.cookieEnabled,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: n.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints,
    connection: n.connection
      ? { effectiveType: n.connection.effectiveType, downlink: n.connection.downlink, rtt: n.connection.rtt, saveData: n.connection.saveData }
      : null,
    viewport: { width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), docHeight: document.documentElement.scrollHeight },
    screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, orientation: screen.orientation?.type ?? null },
    devicePixelRatio: devicePixelRatio,
    prefers: {
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      hover: matchMedia("(hover: hover)").matches,
    },
    features: {
      speechRecognition: "SpeechRecognition" in window || "webkitSpeechRecognition" in window,
      clipboard: !!navigator.clipboard,
      randomUUID: typeof crypto?.randomUUID === "function",
      createImageBitmap: "createImageBitmap" in window,
    },
    memory: mem ? { usedMB: Math.round(mem.usedJSHeapSize / 1e6), totalMB: Math.round(mem.totalJSHeapSize / 1e6), limitMB: Math.round(mem.jsHeapSizeLimit / 1e6) } : null,
    timing: navEntry
      ? { type: navEntry.type, domContentLoadedMs: Math.round(navEntry.domContentLoadedEventEnd), loadMs: Math.round(navEntry.loadEventEnd), transferKB: Math.round(navEntry.transferSize / 1024) }
      : null,
    storageEstimate,
    referrer: document.referrer || null,
    visibility: document.visibilityState,
    title: document.title,
  };
}

export interface DebugContext {
  app: Record<string, unknown>;
  environment: unknown;
  state: Record<string, unknown>;
  storage: { local: unknown; sessionKeys: unknown };
  console: ConsoleEntry[];
  network: NetEntry[];
  breadcrumbs: Crumb[];
  target: unknown;
}

/** 리포트에 담을 정보 전체 */
export async function collectContext(extra: { target?: unknown; screen: string }): Promise<DebugContext> {
  const state: Record<string, unknown> = {};
  for (const [name, get] of states) {
    try {
      state[name] = shrink(get());
    } catch (e) {
      state[name] = { _error: describe(e) };
    }
  }
  return {
    app: {
      screen: extra.screen,
      url: location.href,
      build: typeof __BUILD__ === "undefined" ? null : __BUILD__,
      mode: import.meta.env.MODE,
      apiBase: import.meta.env.VITE_MASTRA_URL || location.origin,
      apiKeyConfigured: Boolean(import.meta.env.VITE_API_KEY),
      pageOpenedAt: startedAt,
      reportedAt: now(),
    },
    environment: await environment(),
    state,
    storage: { local: storageSummary(localStorage, true), sessionKeys: storageSummary(sessionStorage, false) },
    console: [...consoleLog],
    network: [...netLog],
    breadcrumbs: [...crumbs],
    target: extra.target ?? null,
  };
}
