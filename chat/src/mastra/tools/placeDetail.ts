import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";
import { mapLinks } from "./naverMapLink.js";

/**
 * 장소 상세. 여기서 attr_dict 가 일을 한다 —
 * attrs 의 원본 키(parkingfood, 주차기본요금 …)를 한글 라벨과 common_key 로 바꿔 준다.
 * 덕분에 소스가 달라도 "주차", "이용시간" 이 같은 이름으로 나온다.
 */
export const placeDetail = createTool({
  id: "place-detail",
  description:
    "poi_id 로 장소의 상세 정보를 가져온다. 주차·이용시간·휴무일·전화 같은 항목이 " +
    "소스와 무관하게 공통 이름(common_key)으로 정리되어 나온다. " +
    "추천·일정에 넣기 전에 이용시간·휴무일을 확인할 때 쓴다. " +
    "사용자가 특정 장소를 더 알고 싶어 할 때 쓴다. map_url(장소 검색)은 답변에 그대로 넣는다.",
  inputSchema: z.object({
    poi_id: z.number().int(),
    lang: z
      .enum(["ko", "en", "ja", "zh-CN", "zh-TW", "ms"])
      .default("ko")
      .describe("사용자 언어. 해당 언어가 없으면 국문으로 떨어지고 needs_translation 이 true 가 된다"),
  }),
  outputSchema: z.object({
    poi_id: z.number(),
    name: z.string(),
    domain: z.string(),
    addr: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    map_url: z.string().describe("네이버지도 장소 검색 링크. 답변에 그대로 넣는다"),
    directions_url: z.string().nullable().describe("장소 소개용으로는 쓰지 않는다(항상 null)"),
    sources: z.array(z.string()),
    image_url: z.string().nullable().describe("대표 사진. 답변에 사진을 넣을 때 이 주소만 쓴다"),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    needs_translation: z.boolean(),
    keywords: z.array(z.string()).nullable(),
    facts: z.array(
      z.object({
        common_key: z.string().nullable(),
        label: z.string().nullable(),
        value: z.string(),
        source: z.string(),
      }),
    ),
  }),
  execute: async ({ poi_id, lang }) => {
    const [base] = await query<Record<string, never>>(
      `SELECT m.poi_id, m.name, m.domain, m.addr, m.lat, m.lon, m.sources, m.keywords,
              (SELECT i.image_url FROM v_poi_image i WHERE i.poi_id = m.poi_id) AS image_url
         FROM v_poi_merged m WHERE m.poi_id = $1`,
      [poi_id],
    );
    if (!base) throw new Error(`poi_id ${poi_id} 를 찾을 수 없습니다`);

    const [i18n] = await query<Record<string, never>>(
      `SELECT title, summary, lang_code FROM v_poi_merged_i18n
        WHERE poi_id = $1 AND lang_code = $2`,
      [poi_id, lang],
    );
    const [ko] = i18n
      ? [null]
      : await query<Record<string, never>>(
          `SELECT title, summary FROM v_poi_merged_i18n
            WHERE poi_id = $1 AND lang_code = 'ko'`,
          [poi_id],
        );

    // 클러스터 구성원 전부의 attrs 를 사전과 붙여 사람이 읽을 수 있는 항목으로
    const facts = await query(
      `
      SELECT a.common_key, a.label_ko AS label, a.field_value AS value, a.source
      FROM v_poi_attr a
      JOIN poi p ON p.poi_id = a.poi_id
      WHERE p.poi_id = $1 OR p.canonical_poi_id = $1
      ORDER BY (a.common_key IS NULL), a.common_key, a.label_ko
      LIMIT 120
      `,
      [poi_id],
    );

    const text = i18n ?? ko ?? null;
    const row = base as unknown as { name: string; lat: number | null; lon: number | null };
    return {
      ...base,
      ...mapLinks(row.name, row.lat, row.lon),
      title: (text as { title?: string } | null)?.title ?? null,
      summary: (text as { summary?: string } | null)?.summary ?? null,
      needs_translation: !i18n,
      facts,
    } as never;
  },
});
