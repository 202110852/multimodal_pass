import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";

/**
 * 네이버지도 딥링크.
 *
 * ⚠ 프로젝트 todo 에 "길안내는 위경도로 네이버지도 링크 만들어주는 stan 내부 코드 이용"
 *    이라고 되어 있다. 그 내부 코드가 있으면 이 tool 의 URL 생성부를 그걸로 교체할 것.
 *    지금은 공개 웹 URL 형식을 쓴다.
 */
export function searchUrl(name: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
}

export interface Point {
  lat: number;
  lon: number;
  name: string;
}

const pt = (p: Point) => `${p.lon},${p.lat},${encodeURIComponent(p.name)}`;

/** from 을 비우면 네이버지도가 현위치/출발지 입력을 받는다. */
export function directionsUrl(
  to: Point,
  from?: Point,
  mode: "transit" | "walk" | "car" = "transit",
): string {
  return `https://map.naver.com/p/directions/${from ? pt(from) : "-"}/${pt(to)}/-/${mode}`;
}

/** 장소 검색·상세 결과에 붙이는 네이버지도 링크.
 *  장소 카드/소개용은 검색(장소) URL 만 준다. 길찾기 URL 로 바꾸지 않는다.
 *  구간 길찾기는 plan-visit-order 가 directionsUrl 을 따로 만든다. */
export function mapLinks(name: string, _lat?: number | null, _lon?: number | null) {
  return {
    map_url: searchUrl(name),
    directions_url: null as string | null,
  };
}

export const naverMapLink = createTool({
  id: "naver-map-link",
  description:
    "장소의 네이버지도(장소 검색) 링크를 만든다. 장소를 소개·주소 안내할 때나 사용자가 " +
    "'지도 링크' 라고 하면 이 링크를 답변에 넣는다. " +
    "place-detail·search-places 결과에 map_url 이 이미 있으면 그걸 쓰고, 없을 때만 이 도구를 부른다. " +
    "길찾기(/directions) URL 로 바꾸지 않는다 — 장소 검색 URL 만 쓴다.",
  inputSchema: z.object({
    poi_id: z.number().int().optional().describe("DB 의 장소. 주면 좌표를 여기서 읽는다"),
    name: z.string().optional().describe("poi_id 없이 이름만으로 검색 링크를 만들 때"),
  }),
  outputSchema: z.object({
    name: z.string(),
    search_url: z.string(),
    directions_url: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    note: z.string().nullable(),
  }),
  execute: async ({ poi_id, name }) => {
    if (poi_id) {
      const [p] = await query<{ name: string; lat: number | null; lon: number | null }>(
        `SELECT name, lat, lon FROM v_poi_merged WHERE poi_id = $1`,
        [poi_id],
      );
      if (!p) throw new Error(`poi_id ${poi_id} 를 찾을 수 없습니다`);
      return {
        name: p.name,
        search_url: searchUrl(p.name),
        directions_url: null,
        lat: p.lat,
        lon: p.lon,
        note: "장소 검색 링크다. 길찾기 URL 은 만들지 않는다",
      } as never;
    }
    if (!name) throw new Error("poi_id 또는 name 중 하나는 필요합니다");
    return {
      name,
      search_url: searchUrl(name),
      directions_url: null,
      lat: null,
      lon: null,
      note: "장소 검색 링크다",
    } as never;
  },
});
