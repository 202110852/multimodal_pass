import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";
import { searchUrl } from "./naverMapLink.js";

/**
 * 원도심(칠성로·중앙로·지하상가) 자율상권 조합원 매장.
 * 시드: api-db-pipeline/meta/downtown_stores.csv → poi source=downtown_store.
 *
 * 여행자소비쿠폰·지역화폐·고유가 지원금 플래그와 네이버 플레이스 딥링크가 있어
 * 원도심 매장·쿠폰 참여처 질문에는 search-places 보다 이 도구를 쓴다.
 */

export const DOWNTOWN_AREAS = ["칠성로", "중앙로", "지하상가"] as const;

function asBool(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "1" || v === "true" || v === "True" || v === "Y") {
    return true;
  }
  if (v === false || v === 0 || v === "0" || v === "false" || v === "False" || v === "N") {
    return false;
  }
  return null;
}

function pickMapUrl(attrs: Record<string, unknown>, name: string): string {
  for (const key of ["naver_map_url", "naver_link", "matched_site_url"]) {
    const u = attrs[key];
    if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
  }
  return searchUrl(name);
}

function normArea(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "");
  if (/칠성/.test(s)) return "칠성로";
  if (/중앙로/.test(s)) return "중앙로";
  if (/지하|중앙지하/.test(s)) return "지하상가";
  return raw;
}

/** category 컬럼에 실제로 있는 큰 분류. 일식·돈까스 같은 메뉴는 여기가 아니다. */
const COARSE_CATEGORY = /음식점|카페|디저트|쇼핑|기타/;

/**
 * 요리 이름 → 키워드·메뉴에 적힌 말.
 * 원도심 목록에는 '일식'이 거의 없고 돈까스·초밥·우동으로 있다.
 */
const CUISINE_ALIASES: { key: string; terms: string[] }[] = [
  {
    key: "일식",
    terms: ["일식", "돈까스", "돈가스", "돈카츠", "카츠", "초밥", "스시", "우동", "소바", "라멘"],
  },
  { key: "중식", terms: ["중식", "중식당", "짜장", "짬뽕", "탕수육"] },
  { key: "양식", terms: ["양식", "파스타", "피자", "스테이크"] },
];

function expandFoodTerms(raw: string): { terms: string[]; cuisines: string[] } {
  const q = raw.trim();
  if (!q) return { terms: [], cuisines: [] };
  const terms = new Set<string>();
  const cuisines: string[] = [];
  for (const piece of q.split(/\s+/)) {
    if (piece) terms.add(piece);
  }
  for (const c of CUISINE_ALIASES) {
    if (!q.includes(c.key)) continue;
    cuisines.push(c.key);
    for (const t of c.terms) terms.add(t);
  }
  if (!terms.size) terms.add(q);
  return { terms: [...terms], cuisines };
}

/** 상호·키워드·메뉴·업종 부분 일치. $i 는 이미 params 에 넣은 검색어 번호. */
function keywordMatchSql(i: number): string {
  return `(
        p.name ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'naver_name','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'keywords','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'naver_menus','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'naver_popular_menus','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'naver_category','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'category','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'naver_description','') ILIKE '%' || $${i} || '%'
        OR COALESCE(p.attrs->>'naver_ai_briefing','') ILIKE '%' || $${i} || '%'
        OR EXISTS (
          SELECT 1 FROM poi_keyword k
           WHERE k.poi_id = p.poi_id AND k.keyword ILIKE '%' || $${i} || '%'
        )
      )`;
}

function truthySql(alias: string, key: string, want: boolean, params: unknown[]): string {
  params.push(key);
  const i = params.length;
  if (want) {
    return `(${alias}.attrs->>$${i}) IN ('1','true','True','Y')`;
  }
  return `(${alias}.attrs->>$${i}) IS NOT NULL AND (${alias}.attrs->>$${i}) NOT IN ('1','true','True','Y')`;
}

const HOUR_DAYS = [
  ["월", "hours_mon"],
  ["화", "hours_tue"],
  ["수", "hours_wed"],
  ["목", "hours_thu"],
  ["금", "hours_fri"],
  ["토", "hours_sat"],
  ["일", "hours_sun"],
] as const;

/** attrs 에서 사람이 읽을 영업시간·요일별·상태 문자열을 뽑는다. */
function pickHours(a: Record<string, unknown>): {
  hours: string | null;
  hours_status: string | null;
  hours_by_day: string | null;
} {
  const status =
    typeof a.naver_hours_status === "string" && a.naver_hours_status.trim()
      ? a.naver_hours_status.trim()
      : null;

  const byDayParts: string[] = [];
  for (const [label, key] of HOUR_DAYS) {
    const v = a[key];
    if (typeof v === "string" && v.trim()) byDayParts.push(`${label} ${v.trim()}`);
  }
  if (!byDayParts.length && a.naver_hours_days_json) {
    let days: unknown = a.naver_hours_days_json;
    if (typeof days === "string") {
      try {
        days = JSON.parse(days);
      } catch {
        days = null;
      }
    }
    if (days && typeof days === "object" && !Array.isArray(days)) {
      for (const [d, info] of Object.entries(days as Record<string, unknown>)) {
        if (info && typeof info === "object" && typeof (info as { open?: unknown }).open === "string") {
          byDayParts.push(`${d} ${(info as { open: string }).open}`);
        } else if (typeof info === "string" && info.trim()) {
          byDayParts.push(`${d} ${info.trim()}`);
        }
      }
    }
  }
  if (!byDayParts.length && a.hours && typeof a.hours === "object") {
    for (const [d, h] of Object.entries(a.hours as Record<string, unknown>)) {
      if (typeof h === "string" && h.trim()) byDayParts.push(`${d} ${h.trim()}`);
    }
  }
  const hours_by_day = byDayParts.length ? byDayParts.join(", ") : null;

  let hours: string | null =
    typeof a.naver_hours === "string" && a.naver_hours.trim() ? a.naver_hours.trim() : null;
  if (!hours && hours_by_day) hours = hours_by_day;
  if (!hours && typeof a.hours === "string" && a.hours.trim()) hours = a.hours.trim();

  return { hours, hours_status: status, hours_by_day };
}

export const searchDowntownStores = createTool({
  id: "search-downtown-stores",
  description:
    "제주 원도심(칠성로·중앙로·지하상가) 자율상권 조합원 매장을 찾는다. " +
    "여행자소비쿠폰·지역화폐·고유가 지원금·업종·상권·키워드로 좁힐 수 있다. " +
    "q 는 상호뿐 아니라 keywords·메뉴(naver_menus)·네이버 업종을 부분 일치로 찾는다. " +
    "일식은 키워드에 '일식'이 적어도 돈까스·돈가스·초밥·스시·우동·소바·라멘·카츠까지 함께 찾는다. " +
    "음식 종류·메뉴는 category 가 아니라 q 에 넣는다. category 는 음식점·카페·쇼핑만. " +
    "키워드가 안 맞으면 음식점 전체로 넓히지 않는다. " +
    "원도심 매장·쿠폰 되는 가게·칠성로/중앙로 쇼핑 질문은 search-places 보다 이 도구를 먼저 쓴다. " +
    "결과의 hours·hours_status·hours_by_day 로 방문 시각에 문이 열린 곳만 추천한다. " +
    "결과의 여행자소비쿠폰·지역화폐·고유가지원금 필드를 답변에 「여행자소비쿠폰」「지역화폐」「고유가 지원금」으로 쓰고, " +
    "downtown_coupon·localpay·oil_subsidy·유류보조 같은 내부/옛 이름은 사용자에게 말하지 않는다. " +
    "map_url 은 네이버 플레이스 주소이므로 답변에 그대로 넣는다.",
  inputSchema: z.object({
    q: z
      .string()
      .optional()
      .describe(
        "상호·키워드·메뉴(예: 일식, 돈까스, 초밥, 흑돼지). " +
          "일식은 돈까스·초밥·우동 등 메뉴 키워드도 함께 찾는다. 비우면 필터만으로 목록",
      ),
    area: z
      .enum(DOWNTOWN_AREAS)
      .optional()
      .describe("상권. 칠성로 / 중앙로 / 지하상가(중앙지하상가)"),
    category: z
      .string()
      .optional()
      .describe("큰 분류만. 음식점·카페·쇼핑. 일식·돈까스 같은 메뉴는 q 에 넣는다"),
    downtown_coupon: z
      .boolean()
      .optional()
      .describe("true 면 여행자소비쿠폰 참여 매장만"),
    localpay: z.boolean().optional().describe("true 면 지역화폐 사용 가능 매장만"),
    oil_subsidy: z.boolean().optional().describe("true 면 고유가 지원금 대상 매장만"),
    limit: z.number().int().min(1).max(30).default(10),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        poi_id: z.number(),
        name: z.string(),
        addr: z.string().nullable(),
        area: z.string().nullable().describe("상권: 칠성로·중앙로·지하상가"),
        category: z.string().nullable(),
        phone: z.string().nullable(),
        hours: z.string().nullable().describe("영업시간 요약. 없으면 null"),
        hours_status: z
          .string()
          .nullable()
          .describe("수집 시점 상태 예: 영업 중·영업 전·영업 종료·휴무. 참고용"),
        hours_by_day: z
          .string()
          .nullable()
          .describe("요일별 영업시간. 방문 요일·시각과 대조할 때 쓴다"),
        // 사용자에게 보이는 이름. 내부 attrs 키(downtown_coupon 등)를 그대로 쓰지 않는다.
        여행자소비쿠폰: z.boolean().nullable().describe("true 면 여행자소비쿠폰 사용 가능"),
        지역화폐: z.boolean().nullable().describe("true 면 지역화폐 사용 가능"),
        고유가지원금: z.boolean().nullable().describe("true 면 고유가 지원금 대상 (유류보조라고 하지 말 것)"),
        parking: z.string().nullable(),
        map_url: z.string().describe("네이버지도/플레이스 URL. 답변에 그대로 넣는다"),
        image_url: z.string().nullable(),
        keywords: z.array(z.string()).nullable(),
        matched_terms: z
          .array(z.string())
          .nullable()
          .describe("q 가 키워드·메뉴·업종에서 걸린 말. 일식 검색이면 돈까스·초밥 등"),
        summary: z.string().nullable(),
      }),
    ),
    total_matched: z.number().describe("필터에 걸린 전체 건수(limit 전)"),
    note: z.string().nullable(),
  }),
  execute: async ({ q, area, category, downtown_coupon, localpay, oil_subsidy, limit }) => {
    const areaNorm = normArea(area);
    const params: unknown[] = [];
    const where: string[] = ["p.source = 'downtown_store'", "p.is_active"];

    if (downtown_coupon !== undefined) {
      where.push(truthySql("p", "downtown_coupon", downtown_coupon, params));
    }
    if (localpay !== undefined) {
      where.push(truthySql("p", "localpay", localpay, params));
    }
    if (oil_subsidy !== undefined) {
      where.push(truthySql("p", "oil_subsidy", oil_subsidy, params));
    }

    if (areaNorm) {
      params.push(areaNorm === "지하상가" ? "지하" : areaNorm);
      where.push(`p.attrs->>'store_type' ILIKE '%' || $${params.length} || '%'`);
    }

    // '일식'처럼 큰 분류가 아닌 category 는 키워드 검색으로 넘긴다.
    // category='일식' 은 업종 컬럼에 없어 0건이 되고, 모델이 음식점 전체로 넓힌다.
    let categoryFilter = category?.trim() ?? "";
    let queryText = q?.trim() ?? "";
    if (categoryFilter && !COARSE_CATEGORY.test(categoryFilter)) {
      queryText = [queryText, categoryFilter].filter(Boolean).join(" ");
      categoryFilter = "";
    }
    const { terms, cuisines } = expandFoodTerms(queryText);

    if (categoryFilter) {
      params.push(categoryFilter);
      const i = params.length;
      where.push(
        `(p.attrs->>'category' ILIKE '%' || $${i} || '%' OR p.attrs->>'naver_category' ILIKE '%' || $${i} || '%')`,
      );
    }

    const termIndexes: number[] = [];
    if (terms.length) {
      const ors = terms.map((t) => {
        params.push(t);
        const i = params.length;
        termIndexes.push(i);
        return keywordMatchSql(i);
      });
      where.push(`(${ors.join(" OR ")})`);
      // 일식·중식·양식은 음식점·카페만. 키워드에 메뉴가 섞인 쇼핑 매장을 빼기 위함.
      if (cuisines.length && !categoryFilter) {
        where.push(
          `(COALESCE(p.attrs->>'category','') ILIKE '%음식점%' OR COALESCE(p.attrs->>'category','') ILIKE '%카페%')`,
        );
      }
    }

    const whereSql = where.join(" AND ");

    const countRows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM poi p WHERE ${whereSql}`,
      params,
    );
    const total = countRows[0]?.n ?? 0;

    const listParams = [...params];
    let orderSql = "p.name";
    if (cuisines.length && termIndexes.length) {
      const rank = termIndexes
        .map(
          (i) =>
            `COALESCE(p.attrs->>'naver_category','') ILIKE '%' || $${i} || '%' OR COALESCE(p.attrs->>'category','') ILIKE '%' || $${i} || '%'`,
        )
        .join(" OR ");
      orderSql = `CASE WHEN (${rank}) THEN 0 ELSE 1 END, p.name`;
    } else if (queryText) {
      listParams.push(queryText);
      orderSql = `similarity(p.name, $${listParams.length}) DESC, p.name`;
    }
    listParams.push(limit);

    const rows = await query<{
      poi_id: number;
      name: string;
      addr: string | null;
      attrs: Record<string, unknown>;
      image_url: string | null;
      keywords: string[] | null;
    }>(
      `
      SELECT COALESCE(p.canonical_poi_id, p.poi_id) AS poi_id,
             p.name,
             COALESCE(NULLIF(p.attrs->>'naver_road_address',''), p.addr) AS addr,
             p.attrs,
             COALESCE(
               NULLIF(p.attrs->>'image_url',''),
               (SELECT i.image_url FROM v_poi_image i
                 WHERE i.poi_id = COALESCE(p.canonical_poi_id, p.poi_id) LIMIT 1)
             ) AS image_url,
             (SELECT array_agg(DISTINCT k.keyword)
                FROM poi_keyword k WHERE k.poi_id = p.poi_id) AS keywords
      FROM poi p
      WHERE ${whereSql}
      ORDER BY ${orderSql}
      LIMIT $${listParams.length}
      `,
      listParams,
    );

    const results = rows.map((r) => {
      const a = r.attrs ?? {};
      const { hours, hours_status, hours_by_day } = pickHours(a);
      const kwRaw =
        typeof a.keywords === "string"
          ? a.keywords.split("|").map((s) => s.trim()).filter(Boolean)
          : [];
      const menuBlob = [
        typeof a.keywords === "string" ? a.keywords : "",
        typeof a.naver_menus === "string" ? a.naver_menus : "",
        typeof a.naver_popular_menus === "string" ? a.naver_popular_menus : "",
        typeof a.naver_category === "string" ? a.naver_category : "",
        typeof a.category === "string" ? a.category : "",
        typeof a.naver_description === "string" ? a.naver_description : "",
        ...(r.keywords ?? []),
      ].join("\n");
      const matched_terms = terms.filter((t) => menuBlob.includes(t));
      const keywords = [...new Set([...matched_terms, ...(r.keywords ?? []), ...kwRaw])].slice(0, 12);
      return {
        poi_id: r.poi_id,
        name: r.name,
        addr: r.addr,
        area: normArea(typeof a.store_type === "string" ? a.store_type : null),
        category:
          (typeof a.category === "string" && a.category) ||
          (typeof a.naver_category === "string" && a.naver_category) ||
          null,
        phone:
          (typeof a.phone === "string" && a.phone) ||
          (typeof a.naver_phone === "string" && a.naver_phone) ||
          null,
        hours,
        hours_status,
        hours_by_day,
        여행자소비쿠폰: asBool(a.downtown_coupon),
        지역화폐: asBool(a.localpay),
        고유가지원금: asBool(a.oil_subsidy),
        parking: typeof a.parking === "string" ? a.parking : null,
        map_url: pickMapUrl(a, r.name),
        image_url: r.image_url,
        keywords: keywords.length ? keywords : null,
        matched_terms: matched_terms.length ? matched_terms : null,
        summary:
          (typeof a.naver_description === "string" && a.naver_description.slice(0, 240)) ||
          (typeof a.naver_ai_briefing === "string" && a.naver_ai_briefing.slice(0, 240)) ||
          null,
      };
    });

    const notes: string[] = [];
    if (cuisines.length) {
      const extra = CUISINE_ALIASES.filter((c) => cuisines.includes(c.key)).flatMap((c) => c.terms);
      notes.push(
        `«${cuisines.join("·")}» 검색은 키워드·메뉴의 ${extra.join("·")}까지 함께 찾았다. ` +
          "matched_terms 에 걸린 매장을 그 메뉴로 추천한다. " +
          "정확히 못 찾았다고 말하거나 음식점 전체로 넓히지 않는다.",
      );
    }
    if (total > results.length) {
      notes.push(`조건에 맞는 매장이 ${total}곳이다. 상위 ${results.length}곳만 돌려줬다.`);
    } else if (total === 0) {
      notes.push(
        "이 키워드로 상호·키워드·메뉴가 맞는 원도심 조합원 매장이 없다. " +
          "음식점 전체로 넓혀 추천하지 말고, 없다고 말한다.",
      );
    }

    return {
      results,
      total_matched: total,
      note: notes.length ? notes.join(" ") : null,
    } as never;
  },
});
