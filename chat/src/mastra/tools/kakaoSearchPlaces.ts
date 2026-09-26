import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { kakaoFailure, kakaoGet } from "../lib/kakao.js";

export const kakaoSearchInput = z.object({
  query: z.string().trim().min(1).max(200).optional().describe("장소명 또는 키워드. 제주 검색은 지역명을 포함한다"),
  category: z.enum(["MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9", "CT1", "AG2", "PO3", "AT4", "AD5", "FD6", "CE7", "HP8", "PM9"]).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  radius_m: z.number().int().min(0).max(20000).optional(),
  sort: z.enum(["accuracy", "distance"]).default("accuracy"),
  page: z.number().int().min(1).max(45).default(1),
  limit: z.number().int().min(1).max(15).default(5),
}).superRefine((v, ctx) => {
  if (!v.query && !v.category) ctx.addIssue({ code: "custom", message: "query 또는 category가 필요합니다" });
  if ((v.lat === undefined) !== (v.lon === undefined) || ((v.radius_m !== undefined || v.sort === "distance" || !v.query) && v.lat === undefined))
    ctx.addIssue({ code: "custom", message: "위도·경도를 함께 지정하세요. 반경·거리 정렬·카테고리 검색에는 좌표가 필요합니다" });
});
const coordinate = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const responseSchema = z.object({
  meta: z.object({ total_count: z.number(), is_end: z.boolean() }),
  documents: z.array(z.object({
    id: z.string(), place_name: z.string(), category_name: z.string(),
    phone: z.string(), address_name: z.string(), road_address_name: z.string(),
    x: coordinate.pipe(z.number().min(-180).max(180)), y: coordinate.pipe(z.number().min(-90).max(90)),
    distance: z.string().optional(),
  })),
});

export async function searchKakaoPlaces(input: z.input<typeof kakaoSearchInput>) {
  const v = kakaoSearchInput.parse(input);
  try {
    const params = new URLSearchParams({ size: String(v.limit), page: String(v.page), sort: v.sort });
    if (v.query) params.set("query", v.query);
    if (v.category) params.set("category_group_code", v.category);
    if (v.lat !== undefined && v.lon !== undefined) { params.set("x", String(v.lon)); params.set("y", String(v.lat)); }
    if (v.radius_m !== undefined) params.set("radius", String(v.radius_m));
    const data = responseSchema.parse(await kakaoGet(`/v2/local/search/${v.query ? "keyword" : "category"}.json`, params));
    return {
      ok: true as const, source: "카카오맵", total_count: data.meta.total_count, is_end: data.meta.is_end,
      places: data.documents.map(p => ({
        kakao_id: p.id, name: p.place_name, category: p.category_name, phone: p.phone,
        address: p.road_address_name || p.address_name, lat: p.y, lon: p.x,
        distance_m: p.distance && Number.isFinite(Number(p.distance)) ? Number(p.distance) : null,
        place_url: `https://place.map.kakao.com/${encodeURIComponent(p.id)}`,
      })),
      note: "kakao_id는 DB poi_id와 다릅니다. 영업시간·평점은 이 검색 결과에 포함되지 않습니다.",
    };
  } catch (error) { return { ok: false as const, source: "카카오맵", error: kakaoFailure(error) }; }
}

export const kakaoSearchPlaces = createTool({
  id: "kakao-search-places",
  description:
    "카카오맵에서 장소명·키워드 또는 주변 업종(CE7 카페, FD6 음식점, PK6 주차장, OL7 주유소·충전소 등)을 검색한다. " +
    "카카오 검색 요청, DB 결과 부족, 경로의 출발지·목적지 좌표 확인, 차량 주유/충전 후보(OL7)에 사용한다. " +
    "kakao_id를 DB poi_id로 쓰지 않는다.",
  inputSchema: kakaoSearchInput,
  execute: searchKakaoPlaces,
});
