import { query } from "../db.js";

export type ParkingFacts = {
  capacity: string | null;
  parking_fee: string | null;
  category: string | null;
};

/**
 * 주차장 poi 의 면수(용량)·요금·구분을 모은다.
 * 차량 일정에서 방문지 주변 주차장을 고를 때 쓴다.
 */
export async function parkingFactsForPois(
  poiIds: number[],
): Promise<Map<number, ParkingFacts>> {
  const out = new Map<number, ParkingFacts>();
  const ids = [...new Set(poiIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return out;
  for (const id of ids) out.set(id, { capacity: null, parking_fee: null, category: null });

  const rows = await query<{
    poi_id: number;
    capacity: string | null;
    parking_fee: string | null;
    category: string | null;
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
             CASE WHEN a.common_key = 'capacity' THEN a.field_value END, ' / ')), '') AS capacity,
           nullif(trim(both ' /' from string_agg(DISTINCT
             CASE WHEN a.common_key = 'parking_fee' THEN a.field_value END, ' / ')), '') AS parking_fee,
           nullif(trim(both ' /' from string_agg(DISTINCT
             CASE WHEN a.common_key = 'category' THEN a.field_value END, ' / ')), '') AS category
      FROM cluster c
      JOIN v_poi_attr a ON a.poi_id = c.poi_id
     WHERE a.common_key IN ('capacity', 'parking_fee', 'category')
     GROUP BY c.root_id
    `,
    [ids],
  );

  for (const row of rows) {
    out.set(row.poi_id, {
      capacity: row.capacity || null,
      parking_fee: row.parking_fee || null,
      category: row.category || null,
    });
  }
  return out;
}

export function attachParkingFacts<T extends { poi_id: number }>(
  rows: T[],
  map: Map<number, ParkingFacts>,
): (T & ParkingFacts)[] {
  return rows.map((r) => {
    const p = map.get(r.poi_id);
    return {
      ...r,
      capacity: p?.capacity ?? null,
      parking_fee: p?.parking_fee ?? null,
      category: p?.category ?? null,
    };
  });
}
