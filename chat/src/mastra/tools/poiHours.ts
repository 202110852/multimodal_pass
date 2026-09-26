import { query } from "../db.js";

export type PoiHours = {
  hours: string | null;
  restdate: string | null;
};

/**
 * 대표 poi_id 목록에 대해 이용시간(usetime)·휴무일(restdate)을 모은다.
 * 클러스터 구성원 attrs 와 downtown_store 의 naver_hours 등도 폴백으로 본다.
 * 추천·일정 전에 검색 결과에 붙여, place-detail 을 매번 부르지 않아도 되게 한다.
 */
export async function hoursForPois(poiIds: number[]): Promise<Map<number, PoiHours>> {
  const out = new Map<number, PoiHours>();
  const ids = [...new Set(poiIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return out;

  for (const id of ids) out.set(id, { hours: null, restdate: null });

  const fromAttr = await query<{
    poi_id: number;
    hours: string | null;
    restdate: string | null;
  }>(
    `
    WITH roots AS (SELECT unnest($1::int[]) AS poi_id),
    cluster AS (
      SELECT r.poi_id AS root_id, p.poi_id
        FROM roots r
        JOIN poi p ON p.poi_id = r.poi_id OR p.canonical_poi_id = r.poi_id
    )
    SELECT c.root_id AS poi_id,
           nullif(trim(both ' /' from string_agg(DISTINCT
             CASE WHEN a.common_key = 'usetime' THEN a.field_value END, ' / ')), '') AS hours,
           nullif(trim(both ' /' from string_agg(DISTINCT
             CASE WHEN a.common_key = 'restdate' THEN a.field_value END, ' / ')), '') AS restdate
      FROM cluster c
      JOIN v_poi_attr a ON a.poi_id = c.poi_id
     WHERE a.common_key IN ('usetime', 'restdate')
     GROUP BY c.root_id
    `,
    [ids],
  );

  for (const row of fromAttr) {
    out.set(row.poi_id, {
      hours: row.hours || null,
      restdate: row.restdate || null,
    });
  }

  const missing = ids.filter((id) => !out.get(id)?.hours);
  if (!missing.length) return out;

  // common_key 가 없는 downtown_store·기타 소스 폴백
  const fromAttrs = await query<{
    poi_id: number;
    hours: string | null;
    restdate: string | null;
  }>(
    `
    WITH roots AS (SELECT unnest($1::int[]) AS poi_id),
    cluster AS (
      SELECT r.poi_id AS root_id, p.attrs
        FROM roots r
        JOIN poi p ON p.poi_id = r.poi_id OR p.canonical_poi_id = r.poi_id
    ),
    picked AS (
      SELECT c.root_id AS poi_id,
             nullif(trim(COALESCE(
               nullif(c.attrs->>'naver_hours',''),
               nullif(c.attrs->>'opentimefood',''),
               nullif(c.attrs->>'opentime',''),
               nullif(c.attrs->>'usetime',''),
               nullif(c.attrs->>'use_time',''),
               nullif(c.attrs->>'hours_mon','')
             )), '') AS hours,
             nullif(trim(COALESCE(
               nullif(c.attrs->>'restdate',''),
               nullif(c.attrs->>'restdatefood',''),
               nullif(c.attrs->>'shop_holiday','')
             )), '') AS restdate
        FROM cluster c
    )
    SELECT poi_id,
           nullif(trim(both ' /' from string_agg(DISTINCT hours, ' / ')), '') AS hours,
           nullif(trim(both ' /' from string_agg(DISTINCT restdate, ' / ')), '') AS restdate
      FROM picked
     WHERE hours IS NOT NULL OR restdate IS NOT NULL
     GROUP BY poi_id
    `,
    [missing],
  );

  for (const row of fromAttrs) {
    const cur = out.get(row.poi_id) ?? { hours: null, restdate: null };
    out.set(row.poi_id, {
      hours: cur.hours || row.hours || null,
      restdate: cur.restdate || row.restdate || null,
    });
  }

  return out;
}

export function attachHours<T extends { poi_id: number }>(
  rows: T[],
  map: Map<number, PoiHours>,
): (T & PoiHours)[] {
  return rows.map((r) => {
    const h = map.get(r.poi_id);
    return {
      ...r,
      hours: h?.hours ?? null,
      restdate: h?.restdate ?? null,
    };
  });
}
