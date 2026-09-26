import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query, DOMAINS } from "../db.js";
import { collapseSamePlaces } from "./collapsePlaces.js";
import { mapLinks } from "./naverMapLink.js";
import { attachHours, hoursForPois } from "./poiHours.js";
import { parkingFactsForPois } from "./poiParking.js";

/**
 * 이름·키워드로 장소를 찾는다.
 *
 * v_poi_merged 를 읽으므로 여러 소스가 합쳐진 결과가 나온다
 * (관광공사 + 비짓제주 + 착한가격업소가 같은 가게면 한 건).
 * 한국어 부분일치는 pg_trgm 인덱스를 탄다 — 형태소 분석기가 없어도 된다.
 */
export const searchPlaces = createTool({
  id: "search-places",
  description:
    "제주 장소를 이름이나 키워드로 검색한다. 사용자가 특정 가게·관광지를 말하거나 " +
    "'흑돼지 맛집', '카페' 처럼 종류로 찾을 때 쓴다. " +
    "결과의 hours·restdate 로 방문 시각에 이용 가능한지 확인한 뒤 추천한다. " +
    "더 자세한 항목이 필요하면 poi_id 로 place-detail 을 부른다. " +
    "map_url(장소 검색 링크)은 답변에 마크다운으로 반드시 넣는다. 길찾기 URL 로 바꾸지 않는다. " +
    "이름만 다르고 같은 위치인 행은 이미 한 건으로 접혀 있다 — 둘로 나열하지 않는다. " +
    "원도심(칠성로·중앙로·지하상가) 매장·쿠폰 참여처는 search-downtown-stores 를 쓴다.",
  inputSchema: z.object({
    q: z.string().min(1).describe("검색어. 상호명 일부 또는 키워드. 한국어로 넣는다 (외국어 이름도 일부 찾지만 한국어가 정확하다)"),
    domain: z
      .enum(DOMAINS)
      .optional()
      .describe("도메인 한정. 주차장만·충전소만 찾을 때"),
    audience: z
      .enum(["domestic", "foreign"])
      .default("domestic")
      .describe("내국인/외국인. 노출 정책(내국인 카지노 차단 등)에 쓰인다"),
    limit: z.number().int().min(1).max(30).default(8),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        poi_id: z.number(),
        name: z.string(),
        domain: z.string(),
        addr: z.string().nullable(),
        lat: z.number().nullable(),
        lon: z.number().nullable(),
        map_url: z.string().describe("네이버지도 장소 검색 링크. 답변에 그대로 넣는다(길찾기로 바꾸지 않음)"),
        directions_url: z.string().nullable().describe("장소 소개용으로는 쓰지 않는다(항상 null)"),
        sources: z.array(z.string()),
        image_url: z.string().nullable().describe("대표 사진. 답변에 사진을 넣을 때 이 주소만 쓴다"),
        matched_keywords: z.array(z.string()).nullable(),
        hours: z.string().nullable().describe("이용·영업시간. 추천 전 기준 시각과 대조한다"),
        restdate: z.string().nullable().describe("휴무·쉬는 날"),
        capacity: z.string().nullable().describe("주차장 면수(구획수). 주차장이 아니면 null"),
        parking_fee: z.string().nullable().describe("주차 요금. 주차장이 아니면 null"),
        parking_category: z.string().nullable().describe("주차장 구분·유형"),
      }),
    ),
  }),
  execute: async ({ q, domain, audience, limit }) => {
    // 외국어 이름(poi_i18n)으로도 찾는다 — 모델이 한국어로 바꾸지 않고 "Dongmun Market" 을 넘겨도 나오게.
    // 병합된 장소는 대표 poi_id 로 모은다.
    const rows = await query<{
      poi_id: number;
      name: string;
      domain: string;
      addr: string | null;
      lat: number | null;
      lon: number | null;
      sources: string[];
      image_url: string | null;
      matched_keywords: string[] | null;
    }>(
      `
      WITH i18n_hit AS (
        SELECT DISTINCT COALESCE(p.canonical_poi_id, p.poi_id) AS id
          FROM poi_i18n i
          JOIN poi p USING (poi_id)
         WHERE i.lang_code <> 'ko' AND i.title ILIKE '%' || $1 || '%'
      )
      SELECT m.poi_id, m.name, m.domain, m.addr, m.lat, m.lon, m.sources,
             (SELECT i.image_url FROM v_poi_image i WHERE i.poi_id = m.poi_id) AS image_url,
             (SELECT array_agg(DISTINCT k.keyword)
                FROM poi_keyword k
               WHERE k.poi_id = m.poi_id AND k.keyword ILIKE '%' || $1 || '%'
             ) AS matched_keywords
      FROM v_poi_merged m
      JOIN v_poi_visible v ON v.poi_id = m.poi_id AND v.audience = $3
      WHERE ($2::text IS NULL OR m.domain = $2)
        AND (
          m.name ILIKE '%' || $1 || '%'
          OR EXISTS (SELECT 1 FROM poi_keyword k
                      WHERE k.poi_id = m.poi_id AND k.keyword ILIKE '%' || $1 || '%')
          OR m.poi_id IN (SELECT id FROM i18n_hit)
        )
      ORDER BY similarity(m.name, $1) DESC, m.name
      LIMIT $4
      `,
      [q, domain ?? null, audience, limit],
    );
    const collapsed = collapseSamePlaces(rows);
    const hoursMap = await hoursForPois(collapsed.map((r) => r.poi_id));
    let results = attachHours(collapsed, hoursMap).map((r) => ({
      ...r,
      ...mapLinks(r.name, r.lat, r.lon),
      capacity: null as string | null,
      parking_fee: null as string | null,
      parking_category: null as string | null,
    }));
    const parkingIds = results.filter((r) => r.domain === "parking").map((r) => r.poi_id);
    if (parkingIds.length) {
      const pmap = await parkingFactsForPois(parkingIds);
      results = results.map((r) => {
        if (r.domain !== "parking") return r;
        const p = pmap.get(r.poi_id);
        return {
          ...r,
          capacity: p?.capacity ?? null,
          parking_fee: p?.parking_fee ?? null,
          parking_category: p?.category ?? null,
        };
      });
    }
    return { results } as never;
  },
});
