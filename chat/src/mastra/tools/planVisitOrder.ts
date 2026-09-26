import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";
import { directionsUrl, searchUrl, type Point } from "./naverMapLink.js";
import { hoursForPois } from "./poiHours.js";

/**
 * 확정된 방문지의 방문순서 (길찾기 모드 1차 — chatbot_기획.md §7).
 *
 * 직선거리 기준이다. 실제 도로·대중교통 소요는 반영하지 않는다(다음 스텝: 카카오 경로).
 * 장소가 많아야 십수 곳이라 최근접 이웃으로 시작해 2-opt 로 꼬인 구간을 푼다.
 * 출발점이 없으면 모든 장소를 출발점으로 한 번씩 해 보고 가장 짧은 것을 고른다.
 */

const WALK_M_PER_MIN = 67; // 시속 4km
const DETOUR = 1.3; // 직선거리 → 실제 보행거리 보정
const WALKABLE_M = 3000; // 이보다 먼 구간은 도보 시간을 내지 않는다 (택시·버스·차량 안내)

function haversine(a: Point, b: Point): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** path[0] 은 고정(출발점). 나머지 순서를 최근접 이웃 → 2-opt 로 정한다. 복귀 없는 열린 경로. */
function solve(pts: Point[], d: number[][]): { order: number[]; total: number } {
  const n = pts.length;
  const order = [0];
  const left = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  while (left.size) {
    const cur = order[order.length - 1];
    let best = -1;
    for (const j of left) if (best < 0 || d[cur][j] < d[cur][best]) best = j;
    order.push(best);
    left.delete(best);
  }

  const len = (o: number[]) => o.slice(1).reduce((s, v, i) => s + d[o[i]][v], 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (len(cand) + 1e-6 < len(order)) {
          order.splice(0, n, ...cand);
          improved = true;
        }
      }
    }
  }
  return { order, total: len(order) };
}

export const planVisitOrder = createTool({
  id: "plan-visit-order",
  description:
    "방문할 장소들의 방문순서를 짠다. 확정된 코스뿐 아니라, 일정·계획·코스를 제안할 때도 쓴다. " +
    "후보만 고르는 중(아직 장소를 고르지 않음)에는 쓰지 않는다. " +
    "장소가 2곳 이상이면 poi_id 목록으로 부른다. " +
    "호출 전에 각 장소가 출발·도착 예정 시각에 영업 중인지 확인한 뒤, 열린 곳만 넣는다. " +
    "출발 위치(숙소·현위치 좌표나 장소)가 있으면 start 로 준다. " +
    "거리는 직선거리 기반 추정이라 답변에 그 점을 밝힌다.",
  inputSchema: z.object({
    poi_ids: z
      .array(z.number().int())
      .min(1)
      .max(12)
      .describe("확정된 방문지 poi_id. 순서는 상관없다"),
    start: z
      .object({
        poi_id: z.number().int().optional().describe("출발지가 DB 장소일 때"),
        lat: z.number().optional(),
        lon: z.number().optional(),
        name: z.string().optional().describe("좌표로 줄 때 표시 이름 (예: 숙소)"),
      })
      .optional()
      .describe("출발 위치. 없으면 전체 이동거리가 가장 짧은 곳에서 시작한다"),
  }),
  outputSchema: z.object({
    start: z.object({ name: z.string(), lat: z.number(), lon: z.number() }).nullable(),
    stops: z.array(
      z.object({
        order: z.number(),
        poi_id: z.number(),
        name: z.string(),
        addr: z.string().nullable(),
        lat: z.number().nullable(),
        lon: z.number().nullable(),
        from_prev_m: z.number().nullable().describe("이전 지점에서 직선거리(m)"),
        walk_min_est: z.number().nullable().describe("도보 추정(분) — 우회 보정 포함, 참고용. 3km 넘는 구간은 null — 차량·대중교통 이동으로 안내"),
        directions_url: z.string().describe("이전 지점 → 여기 네이버 길찾기 (첫 곳은 현위치 기준)"),
        hours: z.string().nullable().describe("이용·영업시간. 답변에 함께 안내한다"),
        restdate: z.string().nullable().describe("휴무·쉬는 날"),
      }),
    ),
    total_m: z.number().describe("직선거리 합"),
    unplaced: z
      .array(z.object({ poi_id: z.number(), name: z.string().nullable(), reason: z.string() }))
      .describe("좌표가 없거나 찾지 못해 순서에 넣지 못한 곳 — 맨 끝에 따로 안내한다"),
    note: z.string(),
  }),
  execute: async ({ poi_ids, start }) => {
    const ids = [...new Set(poi_ids)];
    if (start?.poi_id) ids.push(start.poi_id);
    const found = await query<{ poi_id: number; name: string; addr: string | null; lat: number | null; lon: number | null }>(
      "SELECT poi_id, name, addr, lat, lon FROM v_poi_merged WHERE poi_id = ANY($1::bigint[])",
      [ids],
    );
    const byId = new Map(found.map((r) => [r.poi_id, r]));

    let origin: Point | null = null;
    if (start?.poi_id) {
      const s = byId.get(start.poi_id);
      if (s?.lat != null && s.lon != null) origin = { lat: s.lat, lon: s.lon, name: s.name };
    } else if (start?.lat != null && start.lon != null) {
      origin = { lat: start.lat, lon: start.lon, name: start.name ?? "출발지" };
    }

    const placed: { poi_id: number; addr: string | null; pt: Point }[] = [];
    const unplaced: { poi_id: number; name: string | null; reason: string }[] = [];
    for (const id of new Set(poi_ids)) {
      if (id === start?.poi_id && origin) continue; // 출발지를 방문지로 또 넣지 않는다
      const r = byId.get(id);
      if (!r) unplaced.push({ poi_id: id, name: null, reason: "DB 에 없는 poi_id" });
      else if (r.lat == null || r.lon == null) unplaced.push({ poi_id: id, name: r.name, reason: "좌표 없음" });
      else placed.push({ poi_id: id, addr: r.addr, pt: { lat: r.lat, lon: r.lon, name: r.name } });
    }

    let seq: number[] = []; // placed 의 인덱스
    let total = 0;
    if (placed.length) {
      const pts = origin ? [origin, ...placed.map((p) => p.pt)] : placed.map((p) => p.pt);
      const d = pts.map((a) => pts.map((b) => haversine(a, b)));
      if (origin) {
        const r = solve(pts, d);
        seq = r.order.slice(1).map((i) => i - 1);
        total = r.total;
      } else {
        // 출발점 후보를 하나씩 앞으로 옮겨 풀고 가장 짧은 것을 쓴다.
        let best: { seq: number[]; total: number } | null = null;
        for (let s = 0; s < pts.length; s++) {
          const perm = [s, ...pts.keys()].filter((v, i, a) => a.indexOf(v) === i);
          const sub = perm.map((i) => pts[i]);
          const r = solve(sub, perm.map((i) => perm.map((j) => d[i][j])));
          if (!best || r.total < best.total) best = { seq: r.order.map((i) => perm[i]), total: r.total };
        }
        seq = best!.seq;
        total = best!.total;
      }
    }

    type Stop = {
      order: number;
      poi_id: number;
      name: string;
      addr: string | null;
      lat: number | null;
      lon: number | null;
      from_prev_m: number | null;
      walk_min_est: number | null;
      directions_url: string;
      hours: string | null;
      restdate: string | null;
    };
    const hoursMap = await hoursForPois(placed.map((p) => p.poi_id).concat(unplaced.map((u) => u.poi_id)));
    let prev: Point | null = origin;
    const stops: Stop[] = seq.map((idx, i) => {
      const p = placed[idx];
      const dist = prev ? Math.round(haversine(prev, p.pt)) : null;
      const h = hoursMap.get(p.poi_id);
      const stop = {
        order: i + 1,
        poi_id: p.poi_id,
        name: p.pt.name,
        addr: p.addr,
        lat: p.pt.lat,
        lon: p.pt.lon,
        from_prev_m: dist,
        walk_min_est:
          dist == null || dist > WALKABLE_M
            ? null
            : Math.max(1, Math.round((dist * DETOUR) / WALK_M_PER_MIN)),
        directions_url: directionsUrl(p.pt, prev ?? undefined, "walk"),
        hours: h?.hours ?? null,
        restdate: h?.restdate ?? null,
      };
      prev = p.pt;
      return stop;
    });
    for (const u of unplaced) {
      if (u.name) {
        const h = hoursMap.get(u.poi_id);
        stops.push({
          order: stops.length + 1,
          poi_id: u.poi_id,
          name: u.name,
          addr: byId.get(u.poi_id)?.addr ?? null,
          lat: null,
          lon: null,
          from_prev_m: null,
          walk_min_est: null,
          directions_url: searchUrl(u.name),
          hours: h?.hours ?? null,
          restdate: h?.restdate ?? null,
        });
      }
    }

    return {
      start: origin ? { name: origin.name, lat: origin.lat, lon: origin.lon } : null,
      stops,
      total_m: Math.round(total),
      unplaced,
      note:
        "직선거리로 짠 순서다. 실제 도로·대중교통 소요는 반영하지 않았다. " +
        "호출 전에 각 장소가 방문 예정 시각에 영업 중인지 확인했어야 한다. " +
        "도보 시간은 직선거리×1.3 을 시속 4km 로 나눈 참고값이고, 3km 넘는 구간은 비워 둔다.",
    };
  },
});
