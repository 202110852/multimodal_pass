import { loadEnvFiles } from "../env.js";

/**
 * 기상청 실시간 날씨. 예전 수집 파이프라인(api_visitkorea/api-db-pipeline/fetch/weather.py)이
 * weather_forecast 를 채우던 API 를 요청마다 직접 부른다.
 *
 * - 공공데이터포털 단기예보(VilageFcstInfoService_2.0, KMA_API_SERVICE_KEY)
 *   초단기실황(현재) · 초단기예보(6시간, 1시간 간격) · 단기예보(3일, 1시간 간격)
 * - 기상청 API허브 특보현황(wrn_now_data, KMA_APIHUB_AUTH_KEY). 응답은 EUC-KR 텍스트다.
 *
 * 좌표는 기상청 격자(nx, ny, 5km)로 바꿔 조회한다. 같은 격자·발표시각 응답은 10분간 재사용한다.
 */

export type Coords = { lat: number; lon: number };

export type HourlyWeather = {
  at: string;
  temp_c: number | null;
  precip_prob: number | null;
  precip: string | null;
  wind_ms: number | null;
  humidity: number | null;
  sky: string;
};

export type CurrentWeather = {
  at: string;
  temp_c: number | null;
  precip_1h: string | null;
  wind_ms: number | null;
  humidity: number | null;
  precip_type: string;
};

export type Forecast = { grid: { nx: number; ny: number }; current: CurrentWeather | null; hourly: HourlyWeather[] };

export type WeatherWarning = {
  region: string;
  kind: string;
  level: string;
  command: string;
  issued_at: string;
  effective_at: string;
};

export const JEJU_CITY_HALL: Coords = { lat: 33.4996, lon: 126.5312 };

const VILAGE_BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const DEFAULT_WRN_NOW_URL = "https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php";
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60_000;

const SKY_KO: Record<string, string> = { "1": "맑음", "3": "구름많음", "4": "흐림" };
const PTY_KO: Record<string, string> = {
  "0": "없음",
  "1": "비",
  "2": "비/눈",
  "3": "눈",
  "4": "소나기",
  "5": "빗방울",
  "6": "빗방울눈날림",
  "7": "눈날림",
};

/** 기상청 격자 변환 (Lambert Conformal Conic, 기상청 단기예보 활용가이드의 공식) */
export function toKmaGrid({ lat, lon }: Coords): { nx: number; ny: number } {
  const RE = 6371.00877 / 5.0; // 지구 반경 / 격자 간격(km)
  const DEGRAD = Math.PI / 180;
  const slat1 = 30 * DEGRAD;
  const slat2 = 60 * DEGRAD;
  const olon = 126 * DEGRAD;
  const olat = 38 * DEGRAD;
  const XO = 43;
  const YO = 136;

  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5));
  const sf = (Math.pow(Math.tan(Math.PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1)) / sn;
  const ro = (RE * sf) / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
  const ra = (RE * sf) / Math.pow(Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5), sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/** 한국 시각의 년월일·시·분 (서버가 UTC 여도 맞게) */
function kstParts(date: Date): { ymd: string; hour: number; minute: number } {
  const kst = new Date(date.getTime() + 9 * 3_600_000);
  const ymd = kst.toISOString().slice(0, 10).replaceAll("-", "");
  return { ymd, hour: kst.getUTCHours(), minute: kst.getUTCMinutes() };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 초단기실황: 매시 정시 발표, 10분 뒤부터 조회 가능 → 40분 전 정시 */
function ncstBase(now: Date): { date: string; time: string } {
  const { ymd, hour } = kstParts(new Date(now.getTime() - 40 * 60_000));
  return { date: ymd, time: `${pad2(hour)}00` };
}

/** 초단기예보: 매시 30분 발표, 45분 뒤부터 조회 가능 */
function ultraBase(now: Date): { date: string; time: string } {
  const { ymd, hour } = kstParts(new Date(now.getTime() - 45 * 60_000));
  return { date: ymd, time: `${pad2(hour)}30` };
}

/** 단기예보: 02·05·08·11·14·17·20·23시 발표, 10분 뒤부터 조회 가능 */
function vilageBase(now: Date): { date: string; time: string } {
  const { ymd, hour } = kstParts(new Date(now.getTime() - 10 * 60_000));
  const slot = [23, 20, 17, 14, 11, 8, 5, 2].find((s) => s <= hour);
  if (slot !== undefined) return { date: ymd, time: `${pad2(slot)}00` };
  const yesterday = kstParts(new Date(now.getTime() - 10 * 60_000 - 24 * 3_600_000)).ymd;
  return { date: yesterday, time: "2300" };
}

type KmaItem = {
  category: string;
  baseDate: string;
  baseTime: string;
  fcstDate?: string;
  fcstTime?: string;
  fcstValue?: string;
  obsrValue?: string;
};

const cache = new Map<string, { at: number; items: Promise<KmaItem[]> }>();

function serviceKey(): string {
  loadEnvFiles();
  const key = process.env.KMA_API_SERVICE_KEY?.trim();
  if (!key) throw new Error("KMA_API_SERVICE_KEY 가 없습니다");
  // 포털의 "인코딩" 키는 이미 % 인코딩돼 있다 — 다시 인코딩하면 "등록되지 않은 서비스키" 가 된다.
  return key.includes("%") ? key : encodeURIComponent(key);
}

async function requestKma(operation: string, base: { date: string; time: string }, grid: { nx: number; ny: number }): Promise<KmaItem[]> {
  const query = new URLSearchParams({
    pageNo: "1",
    numOfRows: "1000",
    dataType: "JSON",
    base_date: base.date,
    base_time: base.time,
    nx: String(grid.nx),
    ny: String(grid.ny),
  });
  const url = `${VILAGE_BASE}/${operation}?serviceKey=${serviceKey()}&${query}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let data: { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: KmaItem[] } | "" } } };
  try {
    data = JSON.parse(text);
  } catch {
    // 키 오류 등은 XML 로 온다
    throw new Error(`기상청 ${operation} 응답 오류: ${text.slice(0, 120)}`);
  }
  const code = data.response?.header?.resultCode;
  if (code === "03") return []; // NO_DATA
  if (code !== "00") throw new Error(`기상청 ${operation} ${code}: ${data.response?.header?.resultMsg}`);
  const items = data.response?.body?.items;
  return typeof items === "object" ? items.item ?? [] : [];
}

function fetchKma(operation: string, base: { date: string; time: string }, grid: { nx: number; ny: number }): Promise<KmaItem[]> {
  const key = `${operation}:${base.date}${base.time}:${grid.nx},${grid.ny}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;
  const items = requestKma(operation, base, grid);
  cache.set(key, { at: Date.now(), items });
  items.catch(() => cache.delete(key));
  return items;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoKst(date: string, time: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

/** 예보 항목을 시각별로 모은다: { "2026-09-28T06:00": { TMP: "23", POP: "30", ... } } */
function pivotByTime(items: KmaItem[]): Map<string, Record<string, string>> {
  const byTime = new Map<string, Record<string, string>>();
  for (const it of items) {
    if (!it.fcstDate || !it.fcstTime) continue;
    const at = isoKst(it.fcstDate, it.fcstTime);
    const row = byTime.get(at) ?? {};
    row[it.category] = it.fcstValue ?? "";
    byTime.set(at, row);
  }
  return byTime;
}

function skyText(row: Record<string, string>): string {
  const pty = row.PTY ?? "0";
  if (pty !== "0" && PTY_KO[pty]) return PTY_KO[pty];
  return SKY_KO[row.SKY ?? ""] ?? "알 수 없음";
}

function precipText(v: string | undefined): string | null {
  if (!v || v === "강수없음" || v === "0") return null;
  return v;
}

/** 강수형태가 있거나 강수확률 60% 이상이면 비 오는 시각으로 본다 */
export function isRainyHour(h: HourlyWeather): boolean {
  return (h.precip_prob ?? 0) >= 60 || h.precip !== null || /비|눈|소나기|빗방울/.test(h.sky);
}

/** 좌표의 현재 날씨(초단기실황)와 앞으로 hours 시간(1~72) 시간별 예보 (앞 6시간은 초단기예보 우선) */
export async function fetchForecast(coords: Coords, hours: number, now = new Date()): Promise<Forecast> {
  const grid = toKmaGrid(coords);
  const [ncst, ultra, vilage] = await Promise.all([
    fetchKma("getUltraSrtNcst", ncstBase(now), grid).catch(() => []),
    fetchKma("getUltraSrtFcst", ultraBase(now), grid).catch(() => []),
    fetchKma("getVilageFcst", vilageBase(now), grid),
  ]);

  const obs: Record<string, string> = {};
  for (const it of ncst) obs[it.category] = it.obsrValue ?? "";
  const current: CurrentWeather | null = ncst.length
    ? {
        at: isoKst(ncst[0]!.baseDate, ncst[0]!.baseTime),
        temp_c: num(obs.T1H),
        precip_1h: precipText(obs.RN1),
        wind_ms: num(obs.WSD),
        humidity: num(obs.REH),
        precip_type: PTY_KO[obs.PTY ?? "0"] ?? "없음",
      }
    : null;

  const ultraRows = pivotByTime(ultra);
  const vilageRows = pivotByTime(vilage);
  const nowHour = `${isoKst(kstParts(now).ymd, `${pad2(kstParts(now).hour)}00`)}`;
  const times = [...new Set([...ultraRows.keys(), ...vilageRows.keys()])]
    .filter((at) => at >= nowHour)
    .sort()
    .slice(0, Math.min(Math.max(hours, 1), 72));

  const hourly = times.map((at): HourlyWeather => {
    const u = ultraRows.get(at);
    const v = vilageRows.get(at) ?? {};
    // 초단기예보에는 강수확률이 없어 단기예보 값을 쓴다
    const row = u ? { ...v, ...u, TMP: u.T1H ?? v.TMP, PCP: u.RN1 ?? v.PCP } : v;
    return {
      at,
      temp_c: num(row.TMP),
      precip_prob: num(v.POP),
      precip: precipText(row.PCP),
      wind_ms: num(row.WSD),
      humidity: num(row.REH),
      sky: skyText(row),
    };
  });

  return { grid, current, hourly };
}

/** 내일 06~21시(KST) 시간별 예보 — 빈 화면 날씨 칩용 */
export async function fetchTomorrowDaytime(coords: Coords, now = new Date()): Promise<{ day: string; hours: HourlyWeather[] }> {
  const { hourly } = await fetchForecast(coords, 72, now);
  const tomorrow = kstParts(new Date(now.getTime() + 24 * 3_600_000)).ymd;
  const day = `${tomorrow.slice(0, 4)}-${tomorrow.slice(4, 6)}-${tomorrow.slice(6, 8)}`;
  const hours = hourly.filter((h) => {
    const hour = Number(h.at.slice(11, 13));
    return h.at.startsWith(day) && hour >= 6 && hour <= 21;
  });
  return { day, hours };
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
