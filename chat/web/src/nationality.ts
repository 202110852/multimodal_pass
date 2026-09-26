/**
 * 국적(국가) 옵션 — 표시명·통화코드·검색용 별칭.
 * ProfileSetup 등에서 NationalitySelect 와 함께 사용한다.
 */

export type NationalityCode =
  | "KR"
  | "CN"
  | "JP"
  | "TW"
  | "HK"
  | "US"
  | "SG"
  | "TH"
  | "VN"
  | "MY"
  | "ID"
  | "PH"
  | "GB"
  | "DE"
  | "FR"
  | "AU"
  | "CA"
  | "RU"
  | "IN"
  | "MN"
  | "OTHER";

export type NationalityOption = {
  id: NationalityCode;
  /** UI 기본 표시명 (한국어) */
  label: string;
  /** 국제전화 국가번호. 없으면 표시·검색에서 생략 */
  callingCode?: string;
  /** 검색용 별칭 (한·영·로컬명 등) */
  aliases: string[];
};

/** 제주 방문이 많은 국적 위주 + 기타 */
export const NATIONALITY_OPTS: NationalityOption[] = [
  {
    id: "KR",
    label: "대한민국",
    callingCode: "82",
    aliases: [
      "한국",
      "남한",
      "코리아",
      "korea",
      "south korea",
      "republic of korea",
      "rok",
      "대한민국",
      "大韓民國",
      "韩国",
      "韓國",
    ],
  },
  {
    id: "CN",
    label: "중국",
    callingCode: "86",
    aliases: [
      "중화인민공화국",
      "중국대륙",
      "차이나",
      "china",
      "prc",
      "people's republic of china",
      "peoples republic of china",
      "中国",
      "中國",
      "中华人民共和国",
    ],
  },
  {
    id: "JP",
    label: "일본",
    callingCode: "81",
    aliases: ["니혼", "닛폰", "japan", "nippon", "nihon", "日本", "ジャパン"],
  },
  {
    id: "TW",
    label: "대만",
    callingCode: "886",
    aliases: [
      "타이완",
      "중화민국",
      "taiwan",
      "republic of china",
      "roc",
      "formosa",
      "台灣",
      "台湾",
      "中華民國",
    ],
  },
  {
    id: "HK",
    label: "홍콩",
    callingCode: "852",
    aliases: [
      "향항",
      "hong kong",
      "hongkong",
      "hksar",
      "香港",
      "hong kong sar",
    ],
  },
  {
    id: "US",
    label: "미국",
    callingCode: "1",
    aliases: [
      "미합중국",
      "아메리카",
      "usa",
      "us",
      "united states",
      "united states of america",
      "america",
      "美國",
      "美国",
    ],
  },
  {
    id: "SG",
    label: "싱가포르",
    callingCode: "65",
    aliases: ["싱가폴", "singapore", "sg", "狮城", "新加坡"],
  },
  {
    id: "TH",
    label: "태국",
    callingCode: "66",
    aliases: ["타이", "thailand", "siam", "ไทย", "泰国", "泰國"],
  },
  {
    id: "VN",
    label: "베트남",
    callingCode: "84",
    aliases: ["월남", "vietnam", "viet nam", "vn", "越南", "Việt Nam"],
  },
  {
    id: "MY",
    label: "말레이시아",
    callingCode: "60",
    aliases: ["말레이", "malaysia", "my", "马来西亚", "馬來西亞"],
  },
  {
    id: "ID",
    label: "인도네시아",
    callingCode: "62",
    aliases: ["인니", "indonesia", "id", "印尼", "印度尼西亚"],
  },
  {
    id: "PH",
    label: "필리핀",
    callingCode: "63",
    aliases: ["필핀", "philippines", "ph", "filipinas", "菲律宾", "菲律賓"],
  },
  {
    id: "GB",
    label: "영국",
    callingCode: "44",
    aliases: [
      "영국",
      "브리튼",
      "uk",
      "gb",
      "united kingdom",
      "great britain",
      "britain",
      "england",
      "英国",
      "英國",
    ],
  },
  {
    id: "DE",
    label: "독일",
    callingCode: "49",
    aliases: ["도이칠란트", "germany", "deutschland", "de", "德国", "德國"],
  },
  {
    id: "FR",
    label: "프랑스",
    callingCode: "33",
    aliases: ["불란서", "france", "fr", "法国", "法國", "フランス"],
  },
  {
    id: "AU",
    label: "호주",
    callingCode: "61",
    aliases: ["오스트레일리아", "australia", "au", "澳洲", "オーストラリア"],
  },
  {
    id: "CA",
    label: "캐나다",
    callingCode: "1",
    aliases: ["canada", "ca", "加拿大", "カナダ"],
  },
  {
    id: "RU",
    label: "러시아",
    callingCode: "7",
    aliases: [
      "러시아연방",
      "russia",
      "russian federation",
      "ru",
      "россия",
      "俄罗斯",
      "俄羅斯",
    ],
  },
  {
    id: "IN",
    label: "인도",
    callingCode: "91",
    aliases: ["인디아", "india", "bharat", "in", "印度", "インド"],
  },
  {
    id: "MN",
    label: "몽골",
    callingCode: "976",
    aliases: ["mongolia", "mn", "монгол", "蒙古", "モンゴル"],
  },
  {
    id: "OTHER",
    label: "기타",
    aliases: ["other", "etc", "그외", "그 외", "其他", "その他"],
  },
];

export function isNationalityCode(value: string | null | undefined): value is NationalityCode {
  return NATIONALITY_OPTS.some((o) => o.id === value);
}

export function getNationalityOption(id: NationalityCode | undefined): NationalityOption | undefined {
  if (!id) return undefined;
  return NATIONALITY_OPTS.find((o) => o.id === id);
}

/** 표시용: "대한민국 - +82" / 통화코드 없으면 라벨만 */
export function formatNationalityLabel(opt: NationalityOption): string {
  if (!opt.callingCode) return opt.label;
  return `${opt.label} - +${opt.callingCode}`;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** 검색어로 옵션 필터. 빈 문자열이면 전체.
 *  labels 가 있으면 현재 로케일 표시명도 검색에 포함한다.
 */
export function filterNationalities(
  query: string,
  labels?: Partial<Record<NationalityCode, string>>,
): NationalityOption[] {
  const q = normalizeQuery(query);
  if (!q) return NATIONALITY_OPTS;

  const qDigits = q.replace(/[^\d]/g, "");
  const qNoPlus = q.replace(/^\+/, "");

  return NATIONALITY_OPTS.filter((opt) => {
    const localized = labels?.[opt.id] ?? "";
    const haystack = [
      opt.id,
      opt.label,
      localized,
      ...opt.aliases,
      opt.callingCode ? `+${opt.callingCode}` : "",
      opt.callingCode ?? "",
    ]
      .join(" ")
      .toLowerCase();

    if (haystack.includes(q) || haystack.includes(qNoPlus)) return true;
    if (qDigits && opt.callingCode && opt.callingCode.includes(qDigits)) return true;
    return false;
  });
}
