import { registerApiRoute } from "@mastra/core/server";
import { isDbEnabled, query } from "./db.js";

/**
 * 빈 채팅 화면의 날씨 칩 — 기상청 격자 예보(weather_forecast)로 내일 제주 상황을 본다.
 * PTY·POP·TMP·SKY 로 질문 문구를 고른다.
 */

export type WeatherKind = "rain" | "snow" | "hot" | "cold" | "clear" | "cloudy" | "fallback";

type Lang = "ko" | "en" | "ja" | "zh";

const CHIP: Record<WeatherKind, Record<Lang, string>> = {
  rain: {
    ko: "내일 비 온대. 실내로 갈 만한 곳",
    en: "Rain tomorrow — indoor spots?",
    ja: "明日は雨。屋内スポットは？",
    zh: "明天有雨，有室内景点吗？",
  },
  snow: {
    ko: "내일 눈 온대. 실내 명소 추천해 줘",
    en: "Snow tomorrow — indoor sights?",
    ja: "明日は雪。屋内のおすすめは？",
    zh: "明天有雪，推荐室内景点？",
  },
  hot: {
    ko: "내일 더운데 시원한 실내 어디?",
    en: "Hot tomorrow — cool indoor places?",
    ja: "明日暑い。涼しい屋内は？",
    zh: "明天很热，有凉快的室内吗？",
  },
  cold: {
    ko: "내일 추운데 따뜻한 실내 어디?",
    en: "Cold tomorrow — warm indoor spots?",
    ja: "明日寒い。暖かい屋内は？",
    zh: "明天很冷，有暖和的室内吗？",
  },
  clear: {
    ko: "내일 맑대. 야외 걷기 좋은 코스",
    en: "Clear tomorrow — good outdoor walk?",
    ja: "明日は晴れ。散歩におすすめは？",
    zh: "明天晴，适合户外散步的路线？",
  },
  cloudy: {
    ko: "내일 흐린데 가볍게 걷기 좋은 곳",
    en: "Cloudy tomorrow — easy walking spots?",
    ja: "明日くもり。軽く歩ける場所は？",
    zh: "明天阴天，适合轻松走走的地方？",
  },
  fallback: {
    ko: "내일 날씨에 맞는 일정",
    en: "A plan that fits tomorrow's weather",
    ja: "明日の天気に合うプラン",
    zh: "按明天天气安排行程",
  },
};

/** 빈 화면 suggestions 배열에서 날씨 칩 위치 (로케일 공통). */
export const WEATHER_CHIP_INDEX = 2;

type FcstRow = { category: string; value: string };

function langOf(raw: string | undefined): Lang {
  const s = (raw ?? "ko").toLowerCase();
  if (s.startsWith("ja")) return "ja";
  if (s.startsWith("zh")) return "zh";
  if (s.startsWith("en") || s === "latin") return "en";
  return "ko";
}

function num(v: string | undefined): number | null {
  if (v == null || v === "" || v === "강수없음") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function classify(rows: FcstRow[]): WeatherKind {
  const byCat = (cat: string) => rows.filter((r) => r.category === cat).map((r) => r.value);

  const ptys = byCat("PTY").map((v) => Number(v)).filter((n) => Number.isFinite(n));
  const pops = byCat("POP").map((v) => num(v)).filter((n): n is number => n != null);
  const tmps = [...byCat("TMP"), ...byCat("T1H")]
    .map((v) => num(v))
    .filter((n): n is number => n != null);
  const skys = byCat("SKY").map((v) => Number(v)).filter((n) => Number.isFinite(n));

  const maxPop = pops.length ? Math.max(...pops) : 0;
  const maxTmp = tmps.length ? Math.max(...tmps) : null;
  const minTmp = tmps.length ? Math.min(...tmps) : null;
  const hasRain = ptys.some((p) => p === 1 || p === 2 || p === 4 || p === 5 || p === 6);
  const hasSnow = ptys.some((p) => p === 2 || p === 3 || p === 6 || p === 7);
  const clearish = skys.length > 0 && skys.filter((s) => s === 1).length >= skys.length / 2;

  if (hasSnow) return "snow";
  if (hasRain || maxPop >= 60) return "rain";
  if (maxTmp != null && maxTmp >= 30) return "hot";
  if (minTmp != null && minTmp <= 5) return "cold";
  if (maxPop <= 30 && clearish) return "clear";
  if (rows.length === 0) return "fallback";
  return "cloudy";
}

async function tomorrowForecast(): Promise<{ rows: FcstRow[]; day: string | null }> {
  if (!isDbEnabled()) return { rows: [], day: null };

  // 내일 06~21시(KST) 낮 시간대 — 여행 일정에 쓰는 구간
  const bounds = await query<{ start_at: string; end_at: string; day: string }>(
    `SELECT
       to_char(((date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day')
                AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD') AS day,
       ((date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day' + interval '6 hours')
         AT TIME ZONE 'Asia/Seoul') AS start_at,
       ((date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') + interval '1 day' + interval '21 hours')
         AT TIME ZONE 'Asia/Seoul') AS end_at`,
  );
  const b = bounds[0];
  if (!b) return { rows: [], day: null };

  const rows = await query<FcstRow>(
    `SELECT DISTINCT ON (fcst_at, category)
            category, value
       FROM weather_forecast
      WHERE fcst_at >= $1::timestamptz
        AND fcst_at < $2::timestamptz
        AND category IN ('TMP','T1H','SKY','PTY','POP')
      ORDER BY fcst_at, category, base_at DESC`,
    [b.start_at, b.end_at],
  );

  if (rows.length > 0) return { rows, day: b.day };

  // 수집이 비면 가장 최근 base 기준의 '다음날'에 해당하는 구간을 못 쓰므로
  // 앞으로 24~48시간 창으로 대체한다.
  const fallback = await query<FcstRow>(
    `SELECT DISTINCT ON (fcst_at, category)
            category, value
       FROM weather_forecast
      WHERE fcst_at BETWEEN now() + interval '18 hours' AND now() + interval '42 hours'
        AND category IN ('TMP','T1H','SKY','PTY','POP')
      ORDER BY fcst_at, category, base_at DESC`,
  );
  return { rows: fallback, day: b.day };
}

export async function buildWeatherSuggestion(langRaw?: string): Promise<{
  kind: WeatherKind;
  text: string;
  index: number;
  day: string | null;
}> {
  const lang = langOf(langRaw);
  const { rows, day } = await tomorrowForecast();
  const kind = classify(rows);
  return { kind, text: CHIP[kind][lang], index: WEATHER_CHIP_INDEX, day };
}

export const weatherSuggestionRoutes = [
  registerApiRoute("/chat/weather-suggestion", {
    method: "GET",
    handler: async (c) => {
      const lang = c.req.query("lang") ?? "ko";
      try {
        const out = await buildWeatherSuggestion(lang);
        return c.json(out);
      } catch (e) {
        return c.json(
          {
            kind: "fallback" as WeatherKind,
            text: CHIP.fallback[langOf(lang)],
            index: WEATHER_CHIP_INDEX,
            day: null,
            error: String((e as Error).message ?? e),
          },
          200,
        );
      }
    },
  }),
];
