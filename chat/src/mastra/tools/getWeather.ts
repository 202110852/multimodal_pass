import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";

/**
 * 날씨. 격자 단위라 장소와 FK 가 없다 — 제주 원도심 단일 격자 기준이다.
 * ai_brief 는 수집 파이프라인이 만들어 둔 요약(JSONB)이고,
 * weather_forecast 는 시각·항목별 원값이다.
 */
export const getWeather = createTool({
  id: "get-weather",
  description:
    "제주 원도심 날씨를 가져온다. 일정을 짜거나 실외 활동을 추천하기 전에 확인한다. " +
    "kind=brief 는 요약, forecast 는 시각별 예보, warning 은 현재 기상특보.",
  inputSchema: z.object({
    kind: z.enum(["brief", "forecast", "warning"]).default("brief"),
    hours: z.number().int().min(1).max(72).default(24).describe("forecast 일 때 앞으로 몇 시간"),
  }),
  outputSchema: z.object({
    kind: z.string(),
    brief: z.unknown().nullable(),
    forecast: z.array(z.object({ at: z.string(), category: z.string(), value: z.string() })),
    warnings: z.array(
      z.object({ wrn: z.string(), lvl: z.string(), reg: z.string().nullable(), ed_tm: z.string().nullable() }),
    ),
    stale_from: z.string().nullable().describe("현재 시각 창에 예보가 없어 과거분을 준 경우 그 기준 시각"),
    note: z.string().nullable(),
  }),
  execute: async ({ kind, hours }) => {
    let brief: unknown = null;
    let forecast: unknown[] = [];
    let warnings: unknown[] = [];
    let stale: string | null = null;

    if (kind === "brief") {
      const [row] = await query<{ payload: unknown }>(
        `SELECT payload FROM weather_ai_brief ORDER BY generated_at DESC LIMIT 1`,
      );
      brief = row?.payload ?? null;
    } else if (kind === "forecast") {
      const sql = `
        SELECT DISTINCT ON (fcst_at, category)
               to_char(fcst_at, 'YYYY-MM-DD HH24:MI') AS at, category, value
        FROM weather_forecast
        WHERE fcst_at BETWEEN $2::timestamptz AND $2::timestamptz + ($1 || ' hours')::interval
          AND category IN ('TMP','T1H','SKY','PTY','POP','REH','WSD','PCP')
        ORDER BY fcst_at, category, base_at DESC`;
      forecast = await query(sql, [hours, new Date().toISOString()]);
      if (forecast.length === 0) {
        // 수집이 멈춰 있으면 현재 시각 창이 비어 있다. 데이터가 아예 없는 것과
        // 오래된 것은 다르므로, 가장 최근 예보를 주고 언제 것인지 알려준다.
        const [latest] = await query<{ at: string }>(
          `SELECT to_char(min(fcst_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') AS at
             FROM weather_forecast WHERE fcst_at >= (SELECT max(base_at) FROM weather_forecast)`,
        );
        if (latest?.at) {
          forecast = await query(sql, [hours, latest.at]);
          stale = latest.at;
        }
      }
    } else {
      warnings = await query(
        `SELECT wrn, lvl, reg_ko AS reg, ed_tm
           FROM weather_warning
          WHERE tm_ef IS NULL OR tm_ef <= now()
          ORDER BY tm_fc DESC LIMIT 20`,
      );
    }
    return {
      kind, brief, forecast, warnings,
      stale_from: stale,
      note: stale
        ? `수집이 최신이 아니다. ${stale} 기준 예보를 돌려준다 — 사용자에게 시점을 밝힐 것.`
        : null,
    } as never;
  },
});
