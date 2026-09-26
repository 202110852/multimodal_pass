import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query, DOMAINS } from "../db.js";
import { collapseSamePlaces } from "./collapsePlaces.js";
import { mapLinks } from "./naverMapLink.js";
import { attachHours, hoursForPois } from "./poiHours.js";
import { parkingFactsForPois } from "./poiParking.js";

/**
 * 좌표 근처 장소. PostGIS 없이 earthdistance GiST 인덱스로 돈다.
 * "이 근처 주차장" / "가까운 충전소" 같은 질문이 여기로 온다.
 */
export const nearbyPlaces = createTool({
  id: "nearby-places",
  description:
    "주어진 좌표 근처의 장소를 가까운 순으로 찾는다. '여기서 가까운 주차장', " +
    "'근처 화장실' 처럼 위치 기준 질문에 쓴다. 기준 좌표는 place-detail 로 얻은 " +
    "장소의 좌표를 쓰거나 사용자가 준 좌표를 쓴다. " +
    "결과의 hours·restdate 로 방문 시각에 이용 가능한지 확인한 뒤 추천한다. " +
    "domain=parking 이면 capacity(면수)·parking_fee·parking_category 가 함께 나온다. " +
    "map_url(장소 검색)은 답변에 그대로 넣는다.",
  inputSchema: z.object({
    lat: z.number().describe("기준 위도"),
    lon: z.number().describe("기준 경도"),
    radius_m: z.number().int().min(50).max(20000).default(1000),
    domain: z.enum(DOMAINS).optional().describe("도메인 한정"),
    audience: z.enum(["domestic", "foreign"]).default("domestic"),
    limit: z.number().int().min(1).max(30).default(8),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        poi_id: z.number(),
        name: z.string(),
        domain: z.string(),
        addr: z.string().nullable(),
        lat: z.number(),
        lon: z.number(),
        distance_m: z.number(),
        map_url: z.string().describe("네이버지도 장소 검색 링크. 답변에 그대로 넣는다"),
        directions_url: z.string().nullable().describe("장소 소개용으로는 쓰지 않는다(항상 null)"),
        image_url: z.string().nullable().describe("대표 사진. 답변에 사진을 넣을 때 이 주소만 쓴다"),
        hours: z.string().nullable().describe("이용·영업시간. 추천 전 기준 시각과 대조한다"),
        restdate: z.string().nullable().describe("휴무·쉬는 날"),
        capacity: z.string().nullable().describe("주차장 면수(구획수). 주차장이 아니면 null"),
        parking_fee: z.string().nullable().describe("주차 요금. 주차장이 아니면 null"),
        parking_category: z.string().nullable().describe("주차장 구분·유형"),
      }),
    ),
  }),
  execute: async ({ lat, lon, radius_m, domain, audience, limit }) => {
    const rows = await query<{
      poi_id: number;
      name: string;
      domain: string;
      addr: string | null;
      lat: number;
      lon: number;
      distance_m: number;
      image_url: string | null;
    }>(
      `
      SELECT m.poi_id, m.name, m.domain, m.addr, m.lat, m.lon,
             (SELECT i.image_url FROM v_poi_image i WHERE i.poi_id = m.poi_id) AS image_url,
             round(earth_distance(ll_to_earth($1, $2),
                                  ll_to_earth(m.lat, m.lon))::numeric) AS distance_m
      FROM v_poi_merged m
      JOIN v_poi_visible v ON v.poi_id = m.poi_id AND v.audience = $5
      WHERE m.lat IS NOT NULL
        AND earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(m.lat, m.lon)
        AND earth_distance(ll_to_earth($1, $2), ll_to_earth(m.lat, m.lon)) <= $3
        AND ($4::text IS NULL OR m.domain = $4)
      ORDER BY distance_m
      LIMIT $6
      `,
      [lat, lon, radius_m, domain ?? null, audience, limit],
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
