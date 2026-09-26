import { FOLLOWUP_MARK } from "./answer.js";

/** 도구에서 모은 장소 → 답변에 빠짐없이 붙일 지도 링크. */
export type MapLinkHit = {
  name: string;
  url: string;
  /** place-detail 등 — 본문에 이름이 없어도 붙인다 */
  force?: boolean;
};

export function naverSearchUrl(name: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
}

function linkLabel(url: string, locale: string): string {
  const kakao = /map\.kakao\.com|place\.map\.kakao\.com/i.test(url);
  if (locale === "en" || locale === "latin") {
    return kakao ? "Open in Kakao Map" : "View on Naver Map";
  }
  if (locale === "ja") {
    return kakao ? "カカオマップで見る" : "ネイバー地図で見る";
  }
  if (locale === "zh") {
    return kakao ? "在 Kakao 地图查看" : "在 Naver 地图查看";
  }
  return kakao ? "카카오맵에서 보기" : "네이버지도에서 보기";
}

function isMapUrl(s: unknown): s is string {
  return (
    typeof s === "string" &&
    (s.startsWith("https://map.naver.com/") ||
      s.startsWith("https://place.map.kakao.com/") ||
      s.startsWith("https://map.kakao.com/"))
  );
}

/** 한 장소 행에서 쓸 URL. map_url → search_url → place_url → 이름 검색. */
export function placeMapUrl(row: Record<string, unknown>): string | null {
  for (const key of ["map_url", "search_url", "place_url"] as const) {
    if (isMapUrl(row[key])) return row[key];
  }
  if (typeof row.name === "string" && row.name.trim()) {
    return naverSearchUrl(row.name.trim());
  }
  return null;
}

/**
 * 장소 관련 도구 결과에서 지도 링크를 모은다.
 * 모델이 답변에 링크를 빼먹어도 화면에서 보강한다.
 */
export function extractMapLinksFromTool(
  toolName: string,
  result: unknown,
): MapLinkHit[] {
  const id = toolName.replace(/_/g, "-");
  const out: MapLinkHit[] = [];

  if (id === "place-detail" || toolName === "placeDetail") {
    if (result && typeof result === "object") {
      const row = result as Record<string, unknown>;
      const url = placeMapUrl(row);
      if (url && typeof row.name === "string" && row.name.trim()) {
        out.push({ name: row.name.trim(), url, force: true });
      }
    }
    return out;
  }

  if (id === "naver-map-link" || toolName === "naverMapLink") {
    if (result && typeof result === "object") {
      const row = result as Record<string, unknown>;
      const url = placeMapUrl(row);
      if (url && typeof row.name === "string" && row.name.trim()) {
        out.push({ name: row.name.trim(), url, force: true });
      }
    }
    return out;
  }

  if (
    id === "search-places" ||
    toolName === "searchPlaces" ||
    id === "nearby-places" ||
    toolName === "nearbyPlaces" ||
    id === "search-downtown-stores" ||
    toolName === "searchDowntownStores"
  ) {
    const results = (result as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) return out;
    for (const row of results) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const url = placeMapUrl(r);
      if (url && typeof r.name === "string" && r.name.trim()) {
        out.push({ name: r.name.trim(), url });
      }
    }
    return out;
  }

  if (id === "kakao-search-places" || toolName === "kakaoSearchPlaces") {
    const places = (result as { places?: unknown; ok?: boolean } | null)?.places;
    if (!Array.isArray(places)) return out;
    for (const row of places) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const url = placeMapUrl(r);
      const name =
        typeof r.name === "string"
          ? r.name.trim()
          : typeof r.place_name === "string"
            ? r.place_name.trim()
            : "";
      if (url && name) out.push({ name, url });
    }
    return out;
  }

  if (id === "plan-visit-order" || toolName === "planVisitOrder") {
    const stops = (result as { stops?: unknown } | null)?.stops;
    if (!Array.isArray(stops)) return out;
    for (const row of stops) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      // 구간 길찾기가 아니라 장소 검색 링크로 통일
      if (typeof r.name === "string" && r.name.trim()) {
        out.push({ name: r.name.trim(), url: naverSearchUrl(r.name.trim()), force: true });
      }
    }
    return out;
  }

  if (id === "search-faq" || toolName === "searchFaq") {
    const PLACE_HINTS: [RegExp, string][] = [
      [/제주여행자센터/, "제주여행자센터"],
      [/칠성로\s*상점가|칠성로상점가/, "칠성로상점가"],
      [/중앙지하상가/, "중앙지하상가"],
      [/중앙로\s*상점가|중앙로상점가/, "중앙로상점가"],
      [/동문(?:재래)?시장/, "동문재래시장"],
      [/관덕정/, "관덕정"],
      [/제주목관아|목관아/, "제주목관아"],
    ];
    const results = (result as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) return out;
    const seen = new Set<string>();
    for (const row of results) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const blob = [r.menu_name, r.question, r.answer]
        .filter((x) => typeof x === "string")
        .join("\n");
      for (const [re, name] of PLACE_HINTS) {
        if (re.test(blob) && !seen.has(name)) {
          seen.add(name);
          out.push({ name, url: naverSearchUrl(name), force: true });
        }
      }
    }
    return out;
  }

  return out;
}

/**
 * 답변에 지도 링크가 **아예 없을 때만** 도구 결과로 보강한다.
 * 모델이 이미 map_url 을 넣었는데 URL 형식이 다르다고 한 번 더 붙이는 일을 막는다.
 * (참고 DB/도구에 네이버 링크가 있으면 모델이 그걸 쓰므로, 화면에 이미 링크가 보이면 따로 넣지 않는다.)
 */
export function ensureAnswerMapLinks(
  text: string,
  links: MapLinkHit[],
  locale = "ko",
): string {
  if (!text || !links.length) return text;

  // 본문에 네이버·카카오 지도 링크가 하나라도 있으면 보강 생략
  if (
    /https:\/\/map\.naver\.com\/|https:\/\/naver\.me\/|https:\/\/place\.map\.kakao\.com\/|https:\/\/map\.kakao\.com\//i.test(
      text,
    )
  ) {
    return text;
  }

  const markAt = text.lastIndexOf(FOLLOWUP_MARK);
  const hasMark = markAt >= 0 && (markAt === 0 || text[markAt - 1] === "\n");
  let body = hasMark ? text.slice(0, markAt).trimEnd() : text;
  const tail = hasMark ? text.slice(markAt) : "";

  const ordered = [...links]
    .filter((l) => l.name && l.url && isMapUrl(l.url))
    .sort((a, b) => b.name.length - a.name.length);

  const toAdd: MapLinkHit[] = [];
  const seen = new Set<string>();
  for (const L of ordered) {
    if (seen.has(L.url)) continue;
    seen.add(L.url);
    // 본문에 이름이 나온 곳, 또는 force 인 것만
    if (body.includes(L.name) || L.force) toAdd.push(L);
  }
  if (!toAdd.length) {
    // 이름이 안 보여도 링크가 전무하면 상위 몇 개만이라도 붙인다
    toAdd.push(...ordered.slice(0, 5));
  }

  const lines = toAdd
    .filter((l, i, arr) => arr.findIndex((x) => x.url === l.url) === i)
    .slice(0, 5)
    .map((l) => `- ${l.name}: [${linkLabel(l.url, locale)}](${l.url})`);
  if (!lines.length) return text;

  body = `${body.trimEnd()}\n\n${lines.join("\n")}`;
  if (!tail) return body;
  return `${body.trimEnd()}\n\n${tail.replace(/^\n+/, "")}`;
}
