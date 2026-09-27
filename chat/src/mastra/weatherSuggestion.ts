import { registerApiRoute } from "@mastra/core/server";
import { JEJU_CITY_HALL, fetchTomorrowDaytime, isRainCode, isSnowCode } from "./lib/weather.js";

/**
 * 빈 채팅 화면의 날씨 칩 — 내일 낮(06~21시) 제주시 예보로 질문 문구를 고른다.
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

function langOf(raw: string | undefined): Lang {
  const s = (raw ?? "ko").toLowerCase();
  if (s.startsWith("ja")) return "ja";
  if (s.startsWith("zh")) return "zh";
  if (s.startsWith("en") || s === "latin") return "en";
  return "ko";
}

type TomorrowDaytime = { codes: number[]; temps: number[]; probs: number[] };

function classify({ codes, temps, probs }: TomorrowDaytime): WeatherKind {
  if (codes.length === 0 && temps.length === 0) return "fallback";

  const maxPop = probs.length ? Math.max(...probs) : 0;
  const maxTmp = temps.length ? Math.max(...temps) : null;
  const minTmp = temps.length ? Math.min(...temps) : null;
  const clearish = codes.length > 0 && codes.filter((c) => c <= 1).length >= codes.length / 2;

  if (codes.some(isSnowCode)) return "snow";
  if (codes.some(isRainCode) || maxPop >= 60) return "rain";
  if (maxTmp != null && maxTmp >= 30) return "hot";
  if (minTmp != null && minTmp <= 5) return "cold";
  if (maxPop <= 30 && clearish) return "clear";
  return "cloudy";
}

export async function buildWeatherSuggestion(langRaw?: string): Promise<{
  kind: WeatherKind;
  text: string;
  index: number;
  day: string | null;
}> {
  const lang = langOf(langRaw);
  const { day, ...daytime } = await fetchTomorrowDaytime(JEJU_CITY_HALL);
  const kind = classify(daytime);
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
