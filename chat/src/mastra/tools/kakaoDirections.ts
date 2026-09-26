import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { kakaoFailure, kakaoGet, kakaoPoint, nonnegative } from "../lib/kakao.js";

export const kakaoDirectionsInput = z.object({
  origin: kakaoPoint.describe("검색 결과 또는 사용자가 제공한 출발지 좌표. 추측 금지"),
  destination: kakaoPoint.describe("검색 결과 또는 사용자가 제공한 도착지 좌표. 추측 금지"),
  mode: z.enum(["walk", "bicycle", "transit", "car"]).describe("이동수단. 불분명하면 사용자에게 확인"),
});
const stepSchema = z.object({ properties: z.object({
  guidance: z.string().optional(), type: z.string().optional(),
  distance: nonnegative.optional(), time: nonnegative.optional(),
  stops: z.array(z.object({ name: z.string() })).optional(),
  vehicles: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional(),
}) });
const routeSchema = z.object({
  properties: z.object({
    totalDistance: nonnegative, totalTime: nonnegative,
    transfers: nonnegative.optional(), fare: z.object({ value: nonnegative.optional(), min: nonnegative.optional(), max: nonnegative.optional() }).optional(),
    landingUrl: z.string().optional(),
  }),
  steps: z.array(stepSchema).optional(),
  legs: z.array(z.object({ steps: z.array(stepSchema) })).optional(),
});
const mapSchema = z.object({
  status: z.string(), route: routeSchema.optional(), routes: z.array(routeSchema).optional(),
  properties: z.object({ landingURL: z.string().optional() }).optional(),
});
const carSchema = z.object({ routes: z.array(z.object({
  result_code: z.number(), summary: z.object({ distance: nonnegative, duration: nonnegative,
    fare: z.object({ taxi: nonnegative.optional(), toll: nonnegative.optional() }).optional(),
  }).optional(),
})) });
function mapUrl(value: string | undefined): string | null {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "map.kakao.com" ? value : null; } catch { return null; }
}

export async function getKakaoDirections(input: z.input<typeof kakaoDirectionsInput>) {
  const { origin, destination, mode } = kakaoDirectionsInput.parse(input);
  const base = { source: mode === "car" ? "카카오모빌리티" : "카카오맵", mode, origin, destination };
  try {
    if (mode === "car") {
      const data = carSchema.parse(await kakaoGet("/v1/directions", new URLSearchParams({
        origin: `${origin.lon},${origin.lat}`, destination: `${destination.lon},${destination.lat}`,
        summary: "true", priority: "RECOMMEND", alternatives: "false",
      }), true));
      const routes = data.routes.filter(r => r.result_code === 0 && r.summary).map(r => ({
        distance_m: r.summary!.distance, duration_seconds: r.summary!.duration,
        duration_minutes: Math.ceil(r.summary!.duration / 60), fare: r.summary!.fare ?? null,
      }));
      if (!routes.length) return { ...base, ok: false as const, error: { code: "NO_ROUTE", message: "자동차 경로를 찾지 못했습니다." } };
      return { ...base, ok: true as const, routes, note: "현재 교통상황 기준 예상 시간입니다. taxi는 예상 택시요금, toll은 통행료(원)이며 실제 금액과 다를 수 있습니다." };
    }
    const params = new URLSearchParams({ start_x: String(origin.lon), start_y: String(origin.lat),
      end_x: String(destination.lon), end_y: String(destination.lat), s_name: origin.name, e_name: destination.name,
      input_coord: "WGS84", output_coord: "WGS84" });
    const data = mapSchema.parse(await kakaoGet(`/v2/routing/${mode === "transit" ? "publictraffic" : mode}`, params));
    const rawRoutes = mode === "transit" ? data.routes : data.route ? [data.route] : [];
    if (data.status !== "OK" || !rawRoutes?.length) return { ...base, ok: false as const,
      error: { code: "NO_ROUTE", message: "해당 이동수단의 경로를 찾지 못했습니다. 출발지·도착지를 확인하거나 다른 이동수단을 선택해 주세요." } };
    return { ...base, ok: true as const, routes: rawRoutes.slice(0, 3).map(r => ({
      distance_m: r.properties.totalDistance, duration_seconds: r.properties.totalTime,
      duration_minutes: Math.ceil(r.properties.totalTime / 60), transfers: r.properties.transfers ?? null,
      fare: r.properties.fare ?? null, directions_url: mapUrl(r.properties.landingUrl ?? data.properties?.landingURL),
      steps: (r.steps ?? r.legs?.flatMap(l => l.steps) ?? []).slice(0, 60).map(s => s.properties),
    })), note: "카카오 API 조회 기준 예상 경로입니다. 운행·도로 상황에 따라 시간과 요금이 달라질 수 있습니다." };
  } catch (error) { return { ...base, ok: false as const, error: kakaoFailure(error) }; }
}
export const kakaoDirections = createTool({
  id: "kakao-directions",
  description:
    "카카오 API로 도보·자전거·대중교통·자동차 실제 경로의 거리와 예상 소요시간을 조회한다. " +
    "여러 수단을 비교할 때는 compare-directions 를 쓴다. " +
    "택시 예상요금은 mode=car 결과의 fare.taxi 를 쓴다. " +
    "출발·도착 좌표는 장소 검색 결과나 사용자 제공 좌표를 사용한다. " +
    "이동수단과 출발지가 없으면 프로필을 보고, 없으면 확인한다. 실패 시 경로·요금을 추측하지 않는다. " +
    "mode=car 이 NO_ROUTE(자동차 경로를 찾지 못함)이면, 출발·도착을 인근 주차장(PK6) 또는 도로 좌표로 바꿔 한 번만 다시 호출한다.",
  inputSchema: kakaoDirectionsInput, execute: getKakaoDirections,
});
