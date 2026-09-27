import { loadEnvFiles } from "../env.js";

/**
 * 실시간 날씨.
 *
 * - 예보: Open-Meteo (키 없음, 좌표 단위). 기상청 단기예보 API 는 활용신청이 없어 403 이다.
 * - 특보: 기상청 API허브 wrn_now_data (KMA_APIHUB_AUTH_KEY). 응답은 EUC-KR 텍스트다.
 */

export type Coords = { lat: number; lon: number };

export type HourlyWeather = {
  at: string;
  temp_c: number | null;
  precip_prob: number | null;
  precip_mm: number | null;
  wind_ms: number | null;
  sky: string;
};

export type CurrentWeather = {
  at: string;
  temp_c: number | null;
  feels_like_c: number | null;
  precip_mm: number | null;
  wind_ms: number | null;
  sky: string;
};

export type Forecast = { current: CurrentWeather; hourly: HourlyWeather[] };

export type WeatherWarning = {
  region: string;
  kind: string;
  level: string;
  command: string;
  issued_at: string;
  effective_at: string;
};

export const JEJU_CITY_HALL: Coords = { lat: 33.4996, lon: 126.5312 };

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_WRN_NOW_URL = "https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php";
const TIMEOUT_MS = 8_000;

/** WMO weather code → 한국어 하늘 상태 */
const WMO_SKY: Record<number, string> = {
  0: "맑음",
  1: "대체로 맑음",
  2: "구름 조금",
  3: "흐림",
  45: "안개",
  48: "안개",
  51: "약한 이슬비",
  53: "이슬비",
  55: "강한 이슬비",
  56: "어는 이슬비",
  57: "어는 이슬비",
  61: "약한 비",
  63: "비",
  65: "강한 비",
  66: "어는 비",
  67: "어는 비",
  71: "약한 눈",
  73: "눈",
  75: "강한 눈",
  77: "싸락눈",
  80: "약한 소나기",
  81: "소나기",
  82: "강한 소나기",
  85: "눈 소나기",
  86: "강한 눈 소나기",
  95: "뇌우",
  96: "우박 동반 뇌우",
  99: "우박 동반 뇌우",
};

export function skyOf(code: number | null | undefined): string {
  if (code == null) return "알 수 없음";
  return WMO_SKY[code] ?? "알 수 없음";
}

export function isSnowCode(code: number | null | undefined): boolean {
  return code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86);
}

export function isRainCode(code: number | null | undefined): boolean {
  return code != null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
}

type OpenMeteoResponse = {
  current: {
    time: string;
    temperature_2m: number | null;
    apparent_temperature: number | null;
    precipitation: number | null;
    weather_code: number | null;
    wind_speed_10m: number | null;
  };
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
    weather_code: (number | null)[];
    wind_speed_10m: (number | null)[];
  };
};

/** 좌표의 현재 날씨와 앞으로 hours 시간(1~72) 시간별 예보 */
export async function fetchForecast({ lat, lon }: Coords, hours: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    forecast_hours: String(Math.min(Math.max(hours, 1), 72)),
    wind_speed_unit: "ms",
    timezone: "Asia/Seoul",
  });
  const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse;

  const h = data.hourly;
  return {
    current: {
      at: data.current.time,
      temp_c: data.current.temperature_2m,
      feels_like_c: data.current.apparent_temperature,
      precip_mm: data.current.precipitation,
      wind_ms: data.current.wind_speed_10m,
      sky: skyOf(data.current.weather_code),
    },
    hourly: h.time.map((at, i) => ({
      at,
      temp_c: h.temperature_2m[i] ?? null,
      precip_prob: h.precipitation_probability[i] ?? null,
      precip_mm: h.precipitation[i] ?? null,
      wind_ms: h.wind_speed_10m[i] ?? null,
      sky: skyOf(h.weather_code[i]),
    })),
  };
}

/** 내일 06~21시(KST) 시간별 예보 — 빈 화면 날씨 칩용 */
export async function fetchTomorrowDaytime(coords: Coords): Promise<{ day: string; codes: number[]; temps: number[]; probs: number[] }> {
  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    hourly: "temperature_2m,precipitation_probability,weather_code",
    forecast_days: "2",
    timezone: "Asia/Seoul",
  });
  const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const { hourly: h } = (await res.json()) as OpenMeteoResponse;

  const day = h.time[24]?.slice(0, 10) ?? "";
  const codes: number[] = [];
  const temps: number[] = [];
  const probs: number[] = [];
  h.time.forEach((at, i) => {
    const hour = Number(at.slice(11, 13));
    if (!at.startsWith(day) || hour < 6 || hour > 21) return;
    if (h.weather_code[i] != null) codes.push(h.weather_code[i]!);
    if (h.temperature_2m[i] != null) temps.push(h.temperature_2m[i]!);
    if (h.precipitation_probability[i] != null) probs.push(h.precipitation_probability[i]!);
  });
  return { day, codes, temps, probs };
}

/** "202609280500" → "2026-09-28 05:00" */
function kstStamp(raw: string): string {
  if (!/^\d{12}$/.test(raw)) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}

/** 제주 지역에 발효 중이거나 예정된 기상특보. 키가 없으면 null (조회 불가와 "특보 없음"을 구분한다). */
export async function fetchJejuWarnings(): Promise<WeatherWarning[] | null> {
  loadEnvFiles();
  const key = process.env.KMA_APIHUB_AUTH_KEY?.trim();
  if (!key) return null;
  const base = process.env.KMA_APIHUB_WRN_NOW_URL?.trim() || DEFAULT_WRN_NOW_URL;
  const params = new URLSearchParams({ fe: "f", tm: "", disp: "1", help: "0", authKey: key });
  const res = await fetch(`${base}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`기상청 특보 ${res.status}`);
  const text = new TextDecoder("euc-kr").decode(await res.arrayBuffer());

  const warnings: WeatherWarning[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    // REG_UP, REG_UP_KO, REG_ID, REG_KO, TM_FC, TM_EF, WRN, LVL, CMD, ED_TM
    const cols = line.split(",").map((c) => c.trim());
    const [, upperRegion = "", , region = "", issued = "", effective = "", kind = "", level = "", command = ""] = cols;
    if (!`${upperRegion}${region}`.includes("제주")) continue;
    warnings.push({
      region,
      kind,
      level,
      command,
      issued_at: kstStamp(issued),
      effective_at: kstStamp(effective),
    });
  }
  return warnings;
}
