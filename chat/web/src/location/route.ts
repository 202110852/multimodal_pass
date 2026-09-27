import type { RoutePlan, RouteStop } from "../store.js";
import type { GeoCoords } from "./geolocation.js";

export type RouteRole = "origin" | "destination";
export type WaypointId = `waypoint-${number}`;
/** 경로에서 장소 하나가 들어가는 칸: 출발·도착 또는 경유지 */
export type RouteSlot = RouteRole | WaypointId;

/** name: 장소명(모르면 null), detail: 이름 아래에 보여줄 주소 (이름이 곧 주소면 null) */
export type RoutePoint = { coords: GeoCoords; name: string | null; detail: string | null };

/** 추가만 하고 아직 장소를 안 정한 경유지는 point 가 null */
export type Waypoint = { id: WaypointId; point: RoutePoint | null };

/** 검색 한 번의 결과: 없음 / 하나라 바로 정함 / 여럿이라 지도에 핀으로 띄움 */
export type SearchOutcome = "none" | "single" | "many";

export function isWaypointSlot(slot: RouteSlot): slot is WaypointId {
  return slot.startsWith("waypoint-");
}

/** 챗봇에 넘길 경로의 한 지점. label 은 "출발" · "경유 1" · "도착" 처럼 역할을 적는다. */
export type RouteStopForChat = { label: string; name: string; detail: string | null; coords: GeoCoords };

/**
 * 지도에서 정한 경로를 챗봇 입력으로 옮길 글. 챗봇 지시문이 한국어라 문구는 한국어로 고정한다.
 * 이름만으로는 같은 이름의 장소를 헷갈릴 수 있어 주소와 좌표를 함께 적는다.
 */
export function routeChatPrompt(stops: RouteStopForChat[]): string {
  const lines = ["지도에서 정한 경로를 불러왔어요."];
  for (const { label, name, detail, coords } of stops) {
    const address = detail && detail !== name ? `, ${detail}` : "";
    lines.push(`${label}: ${name} (${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}${address})`);
  }
  lines.push("이 경로를 바탕으로 도와주세요.");
  return lines.join("\n");
}

/**
 * 저장한 경로를 지도에 다시 펼칠 지점들로 바꾼다 (출발 → 들를 곳 순서). 출발이 따로 없으면 첫 곳이 출발이다.
 * 챗봇이 짠 경로처럼 좌표가 없는 곳이 하나라도 있거나 지점이 둘 미만이면 지도에 그릴 수 없어 null.
 */
export function routePointsFromPlan(plan: RoutePlan): RoutePoint[] | null {
  const points: RoutePoint[] = [];
  if (plan.start) {
    points.push({ coords: { latitude: plan.start.lat, longitude: plan.start.lon }, name: plan.start.name, detail: null });
  }
  for (const stop of plan.stops) {
    if (stop.lat == null || stop.lon == null) return null;
    points.push({ coords: { latitude: stop.lat, longitude: stop.lon }, name: stop.name, detail: stop.addr });
  }
  return points.length >= 2 ? points : null;
}

const EARTH_RADIUS_M = 6_371_000;

/** 두 지점 사이 직선(대원) 거리, 미터 */
function straightDistanceM(a: GeoCoords, b: GeoCoords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/**
 * 지도에서 정한 경로를 "저장한 경로" 형식으로 바꾼다. 첫 지점이 출발, 나머지가 차례로 들를 곳이다.
 * 지도에서 고른 곳은 장소 DB 에 없어 poi_id 대신 좌표를 두고, 구간 거리는 직선 거리로 적는다.
 */
export function mapRoutePlan([start, ...rest]: RouteStopForChat[]): RoutePlan {
  let previous = start.coords;
  const stops: RouteStop[] = rest.map((stop, index) => {
    const fromPrevM = straightDistanceM(previous, stop.coords);
    previous = stop.coords;
    return {
      order: index + 1,
      poi_id: null,
      name: stop.name,
      addr: stop.detail && stop.detail !== stop.name ? stop.detail : null,
      from_prev_m: fromPrevM,
      walk_min_est: null,
      directions_url: "",
      lat: stop.coords.latitude,
      lon: stop.coords.longitude,
    };
  });
  return {
    start: { name: start.name, lat: start.coords.latitude, lon: start.coords.longitude },
    stops,
    total_m: stops.reduce((sum, stop) => sum + (stop.from_prev_m ?? 0), 0),
  };
}
