import type { AppLocale as LocationLocale } from "../locale.js";

type TargetLocale = Exclude<LocationLocale, "ko">;

const HANGUL = /[가-힣]/;

/** NFD 한글을 완성형(NFC)으로 맞춤 */
export function normalizeKoreanText(text: string): string {
  return text.normalize("NFC");
}

function hasHangul(text: string): boolean {
  return HANGUL.test(normalizeKoreanText(text));
}

const GOOGLE_TL: Record<TargetLocale, string> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
};

const MYMEMORY_PAIR: Record<TargetLocale, string> = {
  en: "ko|en",
  zh: "ko|zh-CN",
  ja: "ko|ja",
};

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/**
 * 번역 결과 영속 캐시.
 * 메모리 캐시만 있으면 새로고침·재방문마다 다시 호출하게 되고,
 * 무료 공개 엔드포인트라 호출이 많으면 IP 차단 위험이 있다.
 */
const STORAGE_KEY = "ko_translate_cache_v1";
const MAX_ENTRIES = 2000;
const PERSIST_DEBOUNCE_MS = 1000;

function cacheKey(locale: LocationLocale, text: string): string {
  return `${locale}\u0000${text}`;
}

let persistedLoaded = false;

/** 시크릿 모드·사이트 데이터 차단 등에서는 localStorage 접근 자체가 throw할 수 있다 */
function loadPersistedCache(): void {
  if (persistedLoaded) return;
  persistedLoaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && !cache.has(key)) cache.set(key, value);
    }
  } catch {
    // 접근 불가하거나 손상된 값이면 메모리 캐시만 사용한다
  }
}

function writeCache(entries: [string, string][]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function persistNow(): void {
  try {
    writeCache([...cache.entries()]);
  } catch {
    // 용량 초과일 수 있으므로 최근 항목 절반만 남기고 한 번 더 시도한다
    try {
      writeCache([...cache.entries()].slice(-Math.floor(MAX_ENTRIES / 2)));
    } catch {
      // 그래도 실패하면 이번 세션은 메모리 캐시만 사용한다
    }
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** 번역이 한꺼번에 끝나는 경우가 많으므로 쓰기를 묶는다 */
function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

function rememberTranslation(key: string, value: string): void {
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) {
    // Map은 삽입 순서를 보존하므로 가장 오래된 항목부터 버린다
    const excess = cache.size - MAX_ENTRIES;
    let removed = 0;
    for (const oldKey of cache.keys()) {
      if (removed >= excess) break;
      cache.delete(oldKey);
      removed += 1;
    }
  }
  schedulePersist();
}

function parseGtx(data: unknown): string | null {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  const parts: string[] = [];
  for (const chunk of data[0]) {
    if (Array.isArray(chunk) && typeof chunk[0] === "string") parts.push(chunk[0]);
  }
  const joined = parts.join("");
  return joined.trim() ? joined : null;
}

async function tryGoogleGtx(text: string, tl: string): Promise<string | null> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseGtx(await res.json());
}

async function tryMyMemory(text: string, langpair: string): Promise<string | null> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    responseStatus?: number;
    responseData?: { translatedText?: string };
  };
  if (data.responseStatus !== 200) return null;
  const translated = data.responseData?.translatedText;
  return typeof translated === "string" && translated.trim() ? translated.trim() : null;
}

/** 캐시에 있으면 동기 반환, 없으면 null. 초기 렌더 깜빡임 완화용 (네트워크 호출 없음). */
export function peekCachedKoTranslation(text: string, targetLocale: LocationLocale): string | null {
  const trimmed = normalizeKoreanText(text).trim();
  if (!trimmed || targetLocale === "ko" || !hasHangul(trimmed)) return null;
  loadPersistedCache();
  return cache.get(cacheKey(targetLocale, trimmed)) ?? null;
}

/**
 * 한국어 원문을 선택 언어로 번역한다. (구글 비공식 엔드포인트 → MyMemory 순, 실패 시 원문 유지)
 * `ko`이거나 한글이 없으면 원문을 그대로 반환한다.
 */
export async function translateKoText(text: string, targetLocale: LocationLocale): Promise<string> {
  const trimmed = normalizeKoreanText(text).trim();
  if (!trimmed || targetLocale === "ko" || !hasHangul(trimmed)) {
    return normalizeKoreanText(text);
  }

  loadPersistedCache();

  const key = cacheKey(targetLocale, trimmed);
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const work = (async () => {
    try {
      const google = await tryGoogleGtx(trimmed, GOOGLE_TL[targetLocale]);
      if (google) {
        rememberTranslation(key, google);
        return google;
      }
    } catch {
      // 다음 번역기로 넘어간다
    }
    try {
      const myMemory = await tryMyMemory(trimmed, MYMEMORY_PAIR[targetLocale]);
      if (myMemory) {
        rememberTranslation(key, myMemory);
        return myMemory;
      }
    } catch {
      // 원문을 유지한다
    }
    return trimmed;
  })();

  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}
