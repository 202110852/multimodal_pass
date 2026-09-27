/** tool 들의 SQL 을 DB 에 대고 직접 검증한다 (LLM·API 키 불필요). */
import { searchPlaces } from "../src/mastra/tools/searchPlaces.js";
import { nearbyPlaces } from "../src/mastra/tools/nearbyPlaces.js";
import { placeDetail } from "../src/mastra/tools/placeDetail.js";
import { checkMetric } from "../src/mastra/tools/checkMetric.js";
import { getWeather } from "../src/mastra/tools/getWeather.js";
import { naverMapLink } from "../src/mastra/tools/naverMapLink.js";
import { reportIssue } from "../src/mastra/tools/reportIssue.js";
import { planVisitOrder } from "../src/mastra/tools/planVisitOrder.js";
import { isDbEnabled, pool } from "../src/mastra/db.js";

if (!isDbEnabled() || !pool) {
  console.log("도메인 DB 가 비활성입니다 (로컬 모드). smoke 는 Postgres 가 있을 때만 동작합니다.");
  process.exit(0);
}

const db = pool;

const run = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const r = await fn();
    console.log(`\n■ ${label}`);
    console.log(JSON.stringify(r, null, 1).slice(0, 700));
    return r as never;
  } catch (e) {
    console.log(`\n✗ ${label} 실패: ${(e as Error).message}`);
    throw e;
  }
};

const exec = (t: { execute?: unknown }, input: unknown) =>
  (t.execute as (i: unknown, c: unknown) => Promise<unknown>)(input, {});

const s = await run("search-places '올레'", () =>
  exec(searchPlaces, { q: "올레", audience: "domestic", limit: 3 }));
const first = (s as { results: { poi_id: number }[] }).results[0];

await run("nearby-places 관덕정 300m 주차장", () =>
  exec(nearbyPlaces, { lat: 33.5137, lon: 126.5219, radius_m: 300,
                       domain: "parking", audience: "domestic", limit: 3 }));

await run(`place-detail poi_id=${first.poi_id}`, () =>
  exec(placeDetail, { poi_id: first.poi_id, lang: "ko" }));

const cong = await run("check-metric 집중률 (있는 POI)", async () => {
  const { rows } = await db.query(
    "SELECT poi_id FROM poi_metric WHERE metric='congestion_rate' LIMIT 1");
  return exec(checkMetric, { poi_id: rows[0].poi_id, metric: "congestion_rate", days: 10 });
});
void cong;

await run("get-weather brief", () => exec(getWeather, { kind: "brief", hours: 24 }));
await run("get-weather forecast (경로 2지점)", () =>
  exec(getWeather, {
    kind: "forecast",
    hours: 6,
    points: [
      { name: "제주공항", lat: 33.5066, lon: 126.4929 },
      { name: "성산일출봉", lat: 33.4581, lon: 126.9425 },
    ],
  }));
await run("naver-map-link", () => exec(naverMapLink, { poi_id: first.poi_id }));

// 방문순서 — 관덕정·동문시장·사라봉. 서→동 순으로 이어져야 한다.
const ids = await db.query<{ poi_id: number; name: string }>(
  `SELECT DISTINCT ON (name) poi_id, name FROM v_poi_merged
    WHERE name IN ('관덕정', '동문재래시장', '사라봉') AND lat IS NOT NULL ORDER BY name, poi_id`);
const route = (await run("plan-visit-order", () =>
  exec(planVisitOrder, { poi_ids: [...ids.rows].reverse().map((r) => r.poi_id) }))) as {
  stops: { name: string }[];
};
const names = route.stops.map((x) => x.name).join(" → ");
if (names !== "관덕정 → 동문재래시장 → 사라봉" && names !== "사라봉 → 동문재래시장 → 관덕정") {
  throw new Error(`방문순서가 이상하다: ${names}`);
}
await run("plan-visit-order (출발지=사라봉)", () =>
  exec(planVisitOrder, {
    poi_ids: ids.rows.map((r) => r.poi_id),
    start: { poi_id: ids.rows.find((r) => r.name === "사라봉")!.poi_id },
  }));

// 제보 — 저장되는지만 보고 지운다.
const rep = (await run("report-issue", () =>
  exec(reportIssue, { poi_id: first.poi_id, place_name: "스모크", issue_type: "hours",
                     detail: "smoke test — 자동 삭제" }))) as { report_id: number };
await db.query("DELETE FROM place_report WHERE report_id = $1", [rep.report_id]);

await db.end();
console.log("\n=== 8개 tool 전부 통과 ===");
