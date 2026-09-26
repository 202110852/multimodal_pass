import type { AppLocale } from "./locale.js";
import type {
  Accessibility,
  NationalityCode,
  Transport,
  TravelType,
  UserProfile,
} from "./profile.js";

/**
 * 빈 화면 칩 중 프로필로 채우는 자리 (0, 1, 3).
 * 2=날씨, 4=여행자소비쿠폰(원도심) 은 고정.
 */
export const PROFILE_CHIP_INDICES = [0, 1, 3] as const;

type L = AppLocale;

function natVisitor(code: NationalityCode, loc: L): string | null {
  if (code === "KR") return null;
  const name: Record<Exclude<NationalityCode, "KR">, Record<L, string>> = {
    TW: { ko: "대만", en: "Taiwanese", zh: "台湾", ja: "台湾" },
    CN: { ko: "중국", en: "Chinese", zh: "中国", ja: "中国" },
    JP: { ko: "일본", en: "Japanese", zh: "日本", ja: "日本" },
    HK: { ko: "홍콩", en: "Hong Kong", zh: "香港", ja: "香港" },
    US: { ko: "미국", en: "US", zh: "美国", ja: "アメリカ" },
    SG: { ko: "싱가포르", en: "Singaporean", zh: "新加坡", ja: "シンガポール" },
    TH: { ko: "태국", en: "Thai", zh: "泰国", ja: "タイ" },
    VN: { ko: "베트남", en: "Vietnamese", zh: "越南", ja: "ベトナム" },
    MY: { ko: "말레이시아", en: "Malaysian", zh: "马来西亚", ja: "マレーシア" },
    ID: { ko: "인도네시아", en: "Indonesian", zh: "印尼", ja: "インドネシア" },
    PH: { ko: "필리핀", en: "Filipino", zh: "菲律宾", ja: "フィリピン" },
    GB: { ko: "영국", en: "British", zh: "英国", ja: "イギリス" },
    DE: { ko: "독일", en: "German", zh: "德国", ja: "ドイツ" },
    FR: { ko: "프랑스", en: "French", zh: "法国", ja: "フランス" },
    AU: { ko: "호주", en: "Australian", zh: "澳大利亚", ja: "オーストラリア" },
    CA: { ko: "캐나다", en: "Canadian", zh: "加拿大", ja: "カナダ" },
    RU: { ko: "러시아", en: "Russian", zh: "俄罗斯", ja: "ロシア" },
    IN: { ko: "인도", en: "Indian", zh: "印度", ja: "インド" },
    MN: { ko: "몽골", en: "Mongolian", zh: "蒙古", ja: "モンゴル" },
    OTHER: { ko: "해외", en: "international", zh: "海外", ja: "海外" },
  };
  const n = name[code][loc];
  if (loc === "ko") return `${n} 여행객이 많이 간 장소 추천해 줘`;
  if (loc === "en") return `Places popular with ${n} visitors`;
  if (loc === "zh") return `${n}游客常去的地方推荐`;
  return `${n}の旅行者がよく行く場所を教えて`;
}

function accessChip(a: Accessibility, loc: L): string {
  const map: Record<Accessibility, Record<L, string>> = {
    mobility: {
      ko: "휠체어·지체로 가기 편한 장소 추천해 줘",
      en: "Wheelchair-friendly places",
      zh: "适合轮椅出行的地方",
      ja: "車いすで行きやすい場所は？",
    },
    infant: {
      ko: "유모차 끌고 가기 좋은 곳 알려줘",
      en: "Stroller-friendly spots",
      zh: "适合推婴儿车去的地方",
      ja: "ベビーカーで行きやすい場所は？",
    },
    pet: {
      ko: "반려동물 동반 가능한 카페·식당",
      en: "Pet-friendly cafes or restaurants",
      zh: "可携宠的咖啡店或餐厅",
      ja: "ペット同伴できるカフェ・食堂",
    },
    visual: {
      ko: "시각 편의 있는 관광지 추천해 줘",
      en: "Sightseeing with visual accessibility",
      zh: "有视觉无障碍设施的景点",
      ja: "視覚バリアフリーのある観光地",
    },
    hearing: {
      ko: "청각 편의·자막 안내 있는 곳",
      en: "Places with hearing support or captions",
      zh: "有听觉无障碍或字幕导览的地方",
      ja: "聴覚サポート・字幕案内がある場所",
    },
  };
  return map[a][loc];
}

function transportChip(t: Transport, loc: L): string {
  const map: Record<Transport, Record<L, string>> = {
    car: {
      ko: "주차가 편리한 여행 경로 추천해 줘",
      en: "Recommend a trip route with easy parking",
      zh: "停车方便的旅行路线推荐",
      ja: "駐車しやすい旅行ルートをすすめて",
    },
    walk: {
      ko: "걸어서 돌기 좋은 코스 짜 줘",
      en: "A good walking itinerary",
      zh: "适合步行逛的路线",
      ja: "歩いて回れるコースを組んで",
    },
    bus: {
      ko: "버스로 다니기 편한 일정 알려줘",
      en: "A bus-friendly day plan",
      zh: "方便坐公交的行程",
      ja: "バスで回りやすい日程は？",
    },
    taxi: {
      ko: "택시로 짧게 도는 코스 추천해 줘",
      en: "A short taxi-friendly route",
      zh: "适合打车短途逛的路线",
      ja: "タクシーで短く回るコースは？",
    },
    shared_bike: {
      ko: "킥보드·자전거로 가기 좋은 곳",
      en: "Spots good by bike or scooter",
      zh: "适合骑车或滑板车去的地方",
      ja: "キックボード・自転車で行きやすい場所",
    },
  };
  return map[t][loc];
}

function travelChip(t: TravelType, loc: L): string {
  const map: Record<TravelType, Record<L, string>> = {
    food: {
      ko: "제주 맛집 코스 추천해 줘",
      en: "Recommend a Jeju food route",
      zh: "济州美食路线推荐",
      ja: "済州グルメコースをすすめて",
    },
    shopping: {
      ko: "쇼핑하기 좋은 거리·상점가 알려줘",
      en: "Good shopping streets or markets",
      zh: "适合购物的街道或商圈",
      ja: "ショッピングしやすい通り・商店街",
    },
    culture: {
      ko: "문화·역사 명소 추천해 줘",
      en: "Culture and history highlights",
      zh: "推荐文化历史景点",
      ja: "文化・歴史スポットを教えて",
    },
    nature: {
      ko: "자연·휴양하기 좋은 곳 알려줘",
      en: "Nature and relaxation spots",
      zh: "适合自然休闲的地方",
      ja: "自然・リゾートにおすすめは？",
    },
    experience: {
      ko: "체험할 만한 액티비티 추천해 줘",
      en: "Fun activities to try",
      zh: "推荐可体验的活动",
      ja: "体験できるアクティビティは？",
    },
  };
  return map[t][loc];
}

function dietChips(p: UserProfile, loc: L): string[] {
  const out: string[] = [];
  if (p.dietHalal) {
    out.push(
      loc === "ko"
        ? "할랄 식당 추천해 줘"
        : loc === "en"
          ? "Halal restaurants please"
          : loc === "zh"
            ? "清真餐厅推荐"
            : "ハラールの店を教えて",
    );
  }
  if (p.vegetarian === "vegan" || p.vegetarian === "lacto_ovo") {
    out.push(
      loc === "ko"
        ? "채식하기 좋은 식당 알려줘"
        : loc === "en"
          ? "Good vegetarian or vegan spots"
          : loc === "zh"
            ? "适合素食的餐厅"
            : "ベジ・ヴィーガン向けの店は？",
    );
  }
  if (p.dietWheatFree) {
    out.push(
      loc === "ko"
        ? "밀가루 없는 메뉴 있는 곳"
        : loc === "en"
          ? "Places with wheat-free options"
          : loc === "zh"
            ? "有无麸质或无面粉菜单的地方"
            : "小麦を使わないメニューがある店",
    );
  }
  if (p.allergies?.includes("pork")) {
    out.push(
      loc === "ko"
        ? "돼지고기 없는 식당 추천해 줘"
        : loc === "en"
          ? "Restaurants without pork"
          : loc === "zh"
            ? "没有猪肉的餐厅"
            : "豚肉のない店を教えて",
    );
  }
  return out;
}

function valueChip(level: number | undefined, loc: L): string | null {
  if (level == null) return null;
  if (level <= 3) {
    return loc === "ko"
      ? "가성비 좋은 착한가격업소 알려줘"
      : loc === "en"
        ? "Budget-friendly good-value spots"
        : loc === "zh"
          ? "性价比高的平价好店"
          : "コスパの良い良心価格店は？";
  }
  if (level >= 7) {
    return loc === "ko"
      ? "특별한 경험 할 만한 곳 추천해 줘"
      : loc === "en"
        ? "Special experience-worthy places"
        : loc === "zh"
          ? "值得特别体验的地方"
          : "特別な体験ができる場所は？";
  }
  return null;
}

function placeChip(level: number | undefined, loc: L): string | null {
  if (level == null) return null;
  if (level <= 3) {
    return loc === "ko"
      ? "실내에서 즐기기 좋은 곳 알려줘"
      : loc === "en"
        ? "Good indoor places"
        : loc === "zh"
          ? "适合室内玩的地方"
          : "屋内で楽しめる場所は？";
  }
  if (level >= 7) {
    return loc === "ko"
      ? "야외에서 즐기기 좋은 곳 알려줘"
      : loc === "en"
        ? "Good outdoor places"
        : loc === "zh"
          ? "适合户外玩的地方"
          : "屋外で楽しめる場所は？";
  }
  return null;
}

/** 프로필이 비면 쓰는 기본 3개 (로케일별). */
export function defaultProfileChips(loc: L): [string, string, string] {
  if (loc === "en") {
    return [
      "Recommend a trip route with easy parking",
      "Where's good black pork?",
      "Budget-friendly spots near Dongmun Market",
    ];
  }
  if (loc === "zh") {
    return ["停车方便的旅行路线推荐", "有什么好吃的黑猪肉店？", "东门市场附近的平价好店"];
  }
  if (loc === "ja") {
    return [
      "駐車しやすい旅行ルートをすすめて",
      "黒豚がおいしい店教えて",
      "東門市場付近の良心価格店",
    ];
  }
  return [
    "주차가 편리한 여행 경로 추천해 줘",
    "흑돼지 잘하는 집 알려줘",
    "동문시장 근처 착한가격업소 알려줘",
  ];
}

/**
 * 프로필에서 추천 질문 후보를 우선순위대로 모은 뒤 중복 없이 3개를 고른다.
 */
export function buildProfileChips(profile: UserProfile | null, loc: L): [string, string, string] {
  const fallbacks = defaultProfileChips(loc);
  if (!profile) return fallbacks;

  const candidates: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s?.trim()) return;
    if (candidates.includes(s)) return;
    candidates.push(s);
  };

  // 1) 국적 (한국 제외)
  if (profile.nationality) push(natVisitor(profile.nationality, loc));

  // 2) 배리어프리
  for (const a of profile.accessibility ?? []) push(accessChip(a, loc));

  // 3) 이동수단 (차량 우선)
  const transports = profile.transport ?? [];
  const order: Transport[] = ["car", "walk", "bus", "taxi", "shared_bike"];
  for (const t of order) {
    if (transports.includes(t)) push(transportChip(t, loc));
  }

  // 4) 여행 유형
  const travelOrder: TravelType[] = ["food", "shopping", "culture", "nature", "experience"];
  for (const t of travelOrder) {
    if (profile.travelTypes?.includes(t)) push(travelChip(t, loc));
  }

  // 5) 식이
  for (const s of dietChips(profile, loc)) push(s);

  // 6) 소비·실내외
  push(valueChip(profile.valuePref, loc));
  push(placeChip(profile.placePref, loc));

  // 돼지고기 알레르기면 흑돼지 기본 칩은 쓰지 않음
  const porkFree = profile.allergies?.includes("pork");
  for (const f of fallbacks) {
    if (porkFree && /흑돼지|black pork|黑猪|黒豚/.test(f)) continue;
    push(f);
  }

  while (candidates.length < 3) {
    for (const f of fallbacks) {
      push(f);
      if (candidates.length >= 3) break;
    }
    break;
  }

  return [candidates[0]!, candidates[1]!, candidates[2]!];
}

/** suggestions 배열의 0·1·3만 프로필 칩으로 채운다. */
export function applyProfileSuggestions(
  base: string[],
  profile: UserProfile | null,
  loc: L,
): string[] {
  const chips = buildProfileChips(profile, loc);
  const next = [...base];
  PROFILE_CHIP_INDICES.forEach((idx, i) => {
    if (idx < next.length) next[idx] = chips[i]!;
  });
  return next;
}
