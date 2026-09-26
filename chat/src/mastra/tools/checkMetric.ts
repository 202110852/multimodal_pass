import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";

/**
 * 시계열 지표. 집중률(예측)·주차 여석·전기차 충전 가능 대수가 모두 같은 테이블에 있다.
 * congestion_rate 는 '방문자 추이 예측'이라 미래 일자가 정상이다.
 */
export const checkMetric = createTool({
  id: "check-metric",
  description:
    "장소의 시계열 지표를 조회한다. congestion_rate=관광지 집중률(미래 예측값), " +
    "parking_avail=주차 잔여면수, ev_fast_avail/ev_slow_avail=충전기 가용 대수. " +
    "'사람 많아?', '주차 자리 있어?' 같은 질문에 쓴다.",
  inputSchema: z.object({
    poi_id: z.number().int(),
    metric: z
      .enum([
        "congestion_rate",
        "parking_avail",
        "parking_total",
        "parking_congestion",
        "ev_fast_avail",
        "ev_slow_avail",
      ])
      .default("congestion_rate"),
    days: z.number().int().min(1).max(30).default(10).describe("오늘 기준 앞뒤 조회 일수"),
  }),
  outputSchema: z.object({
    points: z.array(z.object({ at: z.string(), value: z.number().nullable() })),
    note: z.string(),
  }),
  execute: async ({ poi_id, metric, days }) => {
    const points = await query(
      `
      SELECT to_char(observed_at, 'YYYY-MM-DD HH24:MI') AS at, value
      FROM poi_metric
      WHERE poi_id = $1 AND metric = $2
        AND observed_at BETWEEN now() - ($3 || ' days')::interval
                            AND now() + ($3 || ' days')::interval
      ORDER BY observed_at
      `,
      [poi_id, metric, days],
    );
    const note =
      metric === "congestion_rate"
        ? "집중률은 방문자 추이 '예측'이라 미래 일자가 정상이다. 값이 클수록 혼잡."
        : "실시간 수집 시점의 스냅샷이다. 오래된 값이면 그렇다고 말할 것.";
    return { points, note } as never;
  },
});
