import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  JEJU_CITY_HALL,
  fetchForecast,
  fetchJejuWarnings,
  isRainyHour,
  type Coords,
  type HourlyWeather,
} from "../lib/weather.js";

/**
 * 기상청 실시간 날씨. 경로의 출발·경유·도착 좌표를 넘기면 지점(격자)마다 예보를 준다.
 * 좌표를 안 주면 사용자 현재 위치(웹이 requestContext.userLocation 으로 보냄), 그것도 없으면 제주시청.
 */

const MAX_POINTS = 6;

const pointSchema = z.object({
  name: z.string().optional().describe("지점 이름 (예: 출발 제주공항, 도착 성산일출봉)"),
  lat: z.number().min(33).max(34).describe("위도"),
  lon: z.number().min(126).max(127.1).describe("경도"),
});

const hourlySchema = z.object({
  at: z.string(),
  temp_c: z.number().nullable(),
  precip_prob: z.number().nullable(),
  precip: z.string().nullable().describe("강수량 (예: '1mm 미만', '2.0mm'). 없으면 null"),
  wind_ms: z.number().nullable(),
  humidity: z.number().nullable(),
  sky: z.string(),
});

const locationSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  source: z.enum(["input", "user_location", "default"]),
  current: z
    .object({
      at: z.string(),
      temp_c: z.number().nullable(),
      precip_1h: z.string().nullable(),
      wind_ms: z.number().nullable(),
      humidity: z.number().nullable(),
      precip_type: z.string(),
    })
    .nullable(),
  summary: z
    .object({
      temp_min_c: z.number().nullable(),
      temp_max_c: z.number().nullable(),
      max_precip_prob: z.number().nullable(),
      rainy_hours: z.array(z.string()).describe("비·눈이 오거나 강수확률 60% 이상인 시각"),
      max_wind_ms: z.number().nullable(),
    })
    .nullable(),
  hourly: z.array(hourlySchema),
  error: z.string().nullable(),
});

const warningSchema = z.object({
  region: z.string(),
  kind: z.string(),
  level: z.string(),
  command: z.string(),
  issued_at: z.string(),
  effective_at: z.string(),
});

type Place = Coords & { name: string; source: "input" | "user_location" | "default" };

function userLocationOf(raw: unknown): Coords | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lon } = raw as { lat?: unknown; lon?: unknown };
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function maxOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

function minOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.min(...nums) : null;
}

function summarize(hourly: HourlyWeather[]) {
  return {
    temp_min_c: minOf(hourly.map((h) => h.temp_c)),
    temp_max_c: maxOf(hourly.map((h) => h.temp_c)),
    max_precip_prob: maxOf(hourly.map((h) => h.precip_prob)),
    rainy_hours: hourly.filter(isRainyHour).map((h) => h.at.slice(5, 16).replace("T", " ")),
    max_wind_ms: maxOf(hourly.map((h) => h.wind_ms)),
  };
}

export const getWeather = createTool({
  id: "get-weather",
  description:
    "기상청 실시간 날씨(현재 실황·시간별 예보)와 제주 기상특보를 가져온다. " +
    "경로를 안내할 때는 출발·경유·도착 좌표를 points 로 넘겨 구간별 날씨를 본다. " +
    "points 를 비우면 사용자 현재 위치(없으면 제주시청) 기준이다. " +
    "도보·자전거·킥보드 구간을 넣거나 실외 일정을 짜기 전에 확인한다. " +
    "kind=brief 는 현재 + 요약, forecast 는 시간별 예보까지, warning 은 특보만.",
  inputSchema: z.object({
    kind: z.enum(["brief", "forecast", "warning"]).default("brief"),
    hours: z.number().int().min(1).max(72).default(12).describe("앞으로 몇 시간을 볼지 (최대 3일)"),
    points: z
      .array(pointSchema)
      .max(MAX_POINTS)
      .optional()
      .describe("날씨를 볼 지점 좌표 (최대 6개). 좌표는 kakao-search-places·place-detail 결과를 쓴다"),
  }),
  outputSchema: z.object({
    kind: z.string(),
    locations: z.array(locationSchema),
    warnings: z.array(warningSchema).nullable().describe("null 이면 특보를 조회하지 못한 것 (없음과 다르다)"),
    note: z.string().nullable(),
  }),
  execute: async ({ kind, hours, points }, context) => {
    const places: Place[] = points?.length
      ? points.map((p, i) => ({ lat: p.lat, lon: p.lon, name: p.name ?? `지점 ${i + 1}`, source: "input" }))
      : (() => {
          const user = userLocationOf(context?.requestContext?.get("userLocation"));
          return user
            ? [{ ...user, name: "현재 위치", source: "user_location" as const }]
            : [{ ...JEJU_CITY_HALL, name: "제주시청", source: "default" as const }];
        })();

    const warningsPromise = fetchJejuWarnings().catch(() => null);

    const locations =
      kind === "warning"
        ? []
        : await Promise.all(
            places.map(async (place) => {
              try {
                const { current, hourly } = await fetchForecast(place, hours);
                return {
                  ...place,
                  current,
                  summary: summarize(hourly),
                  hourly: kind === "forecast" ? hourly : [],
                  error: null,
                };
              } catch (err) {
                return { ...place, current: null, summary: null, hourly: [], error: String((err as Error).message ?? err) };
              }
            }),
          );

    const warnings = await warningsPromise;
    const failed = locations.filter((l) => l.error).length;
    const notes = [
      places[0]?.source === "default" ? "사용자 위치를 모른다 — 제주시청 기준임을 밝힐 것." : null,
      failed ? `${failed}개 지점의 예보를 불러오지 못했다.` : null,
      warnings === null ? "기상특보를 조회하지 못했다." : null,
    ].filter(Boolean);

    return { kind, locations, warnings, note: notes.length ? notes.join(" ") : null };
  },
});
