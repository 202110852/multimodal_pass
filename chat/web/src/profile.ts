/**
 * 여행 취향 프로필 — 이 브라우저 localStorage 에만 둔다.
 * 비어 있어도 대화는 된다. (카카오 로그인 기본정보는 연동 후 추가)
 *
 *   stan-jeju-profile   UserProfile
 */

import { getInitialLocale, isAppLocale, setStoredLocale, type AppLocale } from "./locale.js";
import {
  isNationalityCode,
  NATIONALITY_OPTS,
  type NationalityCode,
} from "./nationality.js";
import {
  dietConditionsForAgent,
  type DietCondition,
} from "./dietConditions.js";

export type { NationalityCode, DietCondition };
export { NATIONALITY_OPTS };
export { DIET_CONDITION_OPTS, DIET_CONDITION_GUIDANCE, isDietCondition } from "./dietConditions.js";

const PROFILE_KEY = "stan-jeju-profile";

export type Transport = "walk" | "taxi" | "bus" | "car" | "shared_bike";
export type VegetarianLevel = "flexitarian" | "lacto_ovo" | "vegan";
export type TravelType = "food" | "shopping" | "experience" | "culture" | "nature";
/** 나이대 — 10대 ~ 60+ */
export type AgeGroup = "10s" | "20s" | "30s" | "40s" | "50s" | "60plus";
/** 실내(0) ↔ 실외(10). 기본 5 = 정중앙 */
export type PlacePrefLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
/** 가성비(0) ↔ 플렉스(10). 기본 5 = 가심비 */
export type ValuePrefLevel = PlacePrefLevel;
export type Language = "ko" | "en" | "ja" | "zh" | "other";
/** place_with / place_pet 과 맞춤 — 지체 / 시각 / 청각 / 영유아 / 반려동물 */
export type Accessibility = "mobility" | "visual" | "hearing" | "infant" | "pet";
/** 제주ITS·국내 충전 포트 */
export type ChargePort = "dc_combo" | "ac_slow" | "nacs" | "ac_3phase" | "dc_chademo";
export type FuelType = "gasoline_diesel" | "lpg" | "ev";
/** 공영주차 요금 감면·전용면 — 전기차는 fuelType=ev 로 별도 반영 */
export type ParkingPrivilege =
  | "compact"
  | "disabled"
  | "veteran"
  | "pregnant"
  | "multi_child";
/** 식약처 알레르기 유발물질 표시 기준 19종 */
export type Allergy =
  | "egg"
  | "milk"
  | "buckwheat"
  | "peanut"
  | "soy"
  | "wheat"
  | "mackerel"
  | "crab"
  | "shrimp"
  | "pork"
  | "peach"
  | "tomato"
  | "sulfite"
  | "walnut"
  | "chicken"
  | "beef"
  | "squid"
  | "shellfish"
  | "pine_nut";

export interface UserProfile {
  transport?: Transport[];
  vegetarian?: VegetarianLevel | null;
  dietWheatFree?: boolean;
  dietHalal?: boolean;
  /** 식이 질환 — 병명 id 만 저장. 설명은 dietConditions.ts */
  dietConditions?: DietCondition[];
  allergies?: Allergy[];
  travelTypes?: TravelType[];
  /** 0=실내 … 10=실외 (5=중간) */
  placePref?: PlacePrefLevel;
  /** 0=가성비 … 10=플렉스 (5=가심비) */
  valuePref?: ValuePrefLevel;
  nationality?: NationalityCode;
  /** 나이대 (단일 선택) */
  ageGroup?: AgeGroup;
  language?: Language;
  accessibility?: Accessibility[];
  fuelType?: FuelType;
  chargePorts?: ChargePort[];
  /** 주차 우대·감면 대상 (복수) */
  parkingPrivileges?: ParkingPrivilege[];
  updatedAt: number;
}

export const TRANSPORT_OPTS: { id: Transport; label: string }[] = [
  { id: "walk", label: "도보" },
  { id: "taxi", label: "택시" },
  { id: "bus", label: "버스" },
  { id: "car", label: "차량" },
  { id: "shared_bike", label: "공유 킥보드/자전거" },
];

export const VEGETARIAN_OPTS: { id: VegetarianLevel; label: string }[] = [
  { id: "flexitarian", label: "플렉시테리언" },
  { id: "lacto_ovo", label: "락토오보" },
  { id: "vegan", label: "비건" },
];

/** 식품등의 표시기준 — 알레르기 유발물질 (식약처 19종) */
export const ALLERGY_OPTS: { id: Allergy; label: string }[] = [
  { id: "egg", label: "난류(계란)" },
  { id: "milk", label: "우유" },
  { id: "buckwheat", label: "메밀" },
  { id: "peanut", label: "땅콩" },
  { id: "soy", label: "대두" },
  { id: "wheat", label: "밀" },
  { id: "mackerel", label: "고등어" },
  { id: "crab", label: "게" },
  { id: "shrimp", label: "새우" },
  { id: "pork", label: "돼지고기" },
  { id: "peach", label: "복숭아" },
  { id: "tomato", label: "토마토" },
  { id: "sulfite", label: "아황산류" },
  { id: "walnut", label: "호두" },
  { id: "chicken", label: "닭고기" },
  { id: "beef", label: "쇠고기" },
  { id: "squid", label: "오징어" },
  { id: "shellfish", label: "조개류(굴·전복·홍합)" },
  { id: "pine_nut", label: "잣" },
];

export const TRAVEL_OPTS: { id: TravelType; label: string }[] = [
  { id: "food", label: "음식" },
  { id: "shopping", label: "쇼핑" },
  { id: "experience", label: "체험" },
  { id: "culture", label: "문화·역사" },
  { id: "nature", label: "자연·휴양" },
];

export const AGE_GROUP_OPTS: { id: AgeGroup; label: string }[] = [
  { id: "10s", label: "10대" },
  { id: "20s", label: "20대" },
  { id: "30s", label: "30대" },
  { id: "40s", label: "40대" },
  { id: "50s", label: "50대" },
  { id: "60plus", label: "60+" },
];

const AGE_GROUP_IDS = new Set<string>(AGE_GROUP_OPTS.map((o) => o.id));

export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === "string" && AGE_GROUP_IDS.has(value);
}

export const PLACE_PREF_MIN = 0;
export const PLACE_PREF_MAX = 10;
export const PLACE_PREF_DEFAULT: PlacePrefLevel = 5;
export const VALUE_PREF_MIN = PLACE_PREF_MIN;
export const VALUE_PREF_MAX = PLACE_PREF_MAX;
export const VALUE_PREF_DEFAULT: ValuePrefLevel = 5;

export const LANGUAGE_OPTS: { id: Language; label: string }[] = [
  { id: "ko", label: "한국어" },
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "other", label: "기타" },
];

export const ACCESS_OPTS: { id: Accessibility; label: string; hint: string }[] = [
  { id: "infant", label: "영유아", hint: "유모차·수유실·유아의자 등" },
  { id: "pet", label: "반려동물", hint: "반려견·동반 가능 장소 (place_pet)" },
  { id: "mobility", label: "지체", hint: "주차·휠체어·엘리베이터 등" },
  { id: "visual", label: "시각", hint: "점자·안내요원·오디오가이드 등" },
  { id: "hearing", label: "청각", hint: "수화·자막 안내 등" },
];

export const FUEL_TYPE_OPTS: { id: FuelType; label: string }[] = [
  { id: "gasoline_diesel", label: "휘발유/디젤" },
  { id: "lpg", label: "LPG" },
  { id: "ev", label: "전기차" },
];

export const CHARGE_PORT_OPTS: { id: ChargePort; label: string }[] = [
  { id: "dc_combo", label: "DC콤보" },
  { id: "ac_slow", label: "완속" },
  { id: "nacs", label: "NACS" },
  { id: "ac_3phase", label: "AC3상" },
  { id: "dc_chademo", label: "차데모" },
];

/** 공영주차에서 자주 쓰는 감면·전용 대상 (전기차는 연료=EV) */
export const PARKING_PRIVILEGE_OPTS: { id: ParkingPrivilege; label: string }[] = [
  { id: "compact", label: "경차" },
  { id: "disabled", label: "장애인" },
  { id: "veteran", label: "국가유공자" },
  { id: "pregnant", label: "임산부" },
  { id: "multi_child", label: "다자녀" },
];

function readRaw(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as UserProfile;
    if (!p || typeof p !== "object") return null;
    return p;
  } catch {
    return null;
  }
}

/** 저장된 프로필이 있으면 반환. 없거나 깨졌으면 null. */
export function loadProfile(): UserProfile | null {
  return readRaw();
}

/** 한 번이라도 저장(또는 건너뛰기)했는지 — 없으면 새 대화 때 입력창을 띄운다. */
export function hasProfile(): boolean {
  return readRaw() !== null;
}

export function saveProfile(profile: UserProfile): boolean {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, updatedAt: Date.now() }));
    // 기타·미지원 → 앱 로케일은 영어
    if (profile.language === "other") setStoredLocale("en");
    else if (isAppLocale(profile.language)) setStoredLocale(profile.language);
    return true;
  } catch {
    return false;
  }
}

/** 비워 두고 시작 — 다시 묻지 않도록 빈 프로필을 남긴다. */
export function skipProfile(): boolean {
  return saveProfile({ updatedAt: Date.now() });
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* 무시 */
  }
}

export function emptyDraft(): Omit<UserProfile, "updatedAt"> {
  return {
    transport: [],
    vegetarian: null,
    dietWheatFree: false,
    dietHalal: false,
    dietConditions: [],
    allergies: [],
    travelTypes: [],
    placePref: PLACE_PREF_DEFAULT,
    valuePref: VALUE_PREF_DEFAULT,
    nationality: undefined,
    ageGroup: undefined,
    language: getInitialLocale() as Language,
    accessibility: [],
    fuelType: undefined,
    chargePorts: [],
    parkingPrivileges: [],
  };
}

function normalizePlacePref(value: unknown): PlacePrefLevel {
  if (typeof value === "number" && value >= PLACE_PREF_MIN && value <= PLACE_PREF_MAX) {
    return Math.round(value) as PlacePrefLevel;
  }
  // 예전 칩 형식
  if (value === "indoor") return 0;
  if (value === "outdoor") return 10;
  if (value === "either") return PLACE_PREF_DEFAULT;
  return PLACE_PREF_DEFAULT;
}

function normalizeValuePref(value: unknown): ValuePrefLevel {
  if (typeof value === "number" && value >= VALUE_PREF_MIN && value <= VALUE_PREF_MAX) {
    return Math.round(value) as ValuePrefLevel;
  }
  return VALUE_PREF_DEFAULT;
}

function normalizeNationality(profile: Record<string, unknown>): NationalityCode | undefined {
  const code = profile.nationality;
  if (typeof code === "string" && isNationalityCode(code)) return code;
  // 예전 visitor 칩
  if (profile.visitor === "korean") return "KR";
  if (profile.visitor === "foreigner") return "OTHER";
  return undefined;
}

function normalizeLanguage(profile: Record<string, unknown>): Language {
  if (profile.language === "other") return "other";
  if (isAppLocale(profile.language as string)) return profile.language as AppLocale;
  return getInitialLocale();
}

export function draftFrom(profile: UserProfile | null): Omit<UserProfile, "updatedAt"> {
  if (!profile) return emptyDraft();
  const { updatedAt: _, ...rest } = profile;
  const raw = rest as Record<string, unknown>;
  // 예전 단일 선택 형식 → 배열로
  const transport = Array.isArray(rest.transport)
    ? rest.transport
    : rest.transport
      ? [rest.transport as unknown as Transport]
      : [];
  // 예전 electricCar boolean → fuelType
  const legacy = rest as { electricCar?: boolean };
  const fuelType =
    rest.fuelType ?? (legacy.electricCar ? ("ev" as FuelType) : undefined);
  return {
    ...emptyDraft(),
    ...rest,
    transport,
    fuelType,
    nationality: normalizeNationality(raw),
    ageGroup: isAgeGroup(rest.ageGroup) ? rest.ageGroup : undefined,
    language: normalizeLanguage(raw),
    placePref: normalizePlacePref(rest.placePref),
    valuePref: normalizeValuePref(rest.valuePref),
    allergies: rest.allergies ?? [],
    dietConditions: rest.dietConditions ?? [],
    travelTypes: rest.travelTypes ?? [],
    accessibility: rest.accessibility ?? [],
    chargePorts: rest.chargePorts ?? [],
    parkingPrivileges: rest.parkingPrivileges ?? [],
  };
}

/**
 * 에이전트 requestContext 용 — 채워진 항목만 보낸다.
 * 서버가 시스템 프롬프트에 넣어, 이미 아는 취향을 다시 묻지 않게 한다.
 */
export function profileForAgent(profile: UserProfile | null): Record<string, unknown> | null {
  if (!profile) return null;
  const out: Record<string, unknown> = {};
  if (profile.transport?.length) out.transport = profile.transport;
  if (profile.travelTypes?.length) out.travelTypes = profile.travelTypes;
  if (profile.vegetarian) out.vegetarian = profile.vegetarian;
  if (profile.dietWheatFree) out.dietWheatFree = true;
  if (profile.dietHalal) out.dietHalal = true;
  const conditions = dietConditionsForAgent(profile.dietConditions);
  if (conditions.length) out.dietConditions = conditions;
  if (profile.allergies?.length) out.allergies = profile.allergies;
  if (typeof profile.placePref === "number" && profile.placePref !== PLACE_PREF_DEFAULT) {
    out.placePref = profile.placePref;
  }
  if (typeof profile.valuePref === "number" && profile.valuePref !== VALUE_PREF_DEFAULT) {
    out.valuePref = profile.valuePref;
  }
  if (profile.nationality) out.nationality = profile.nationality;
  if (profile.ageGroup) out.ageGroup = profile.ageGroup;
  if (profile.accessibility?.length) out.accessibility = profile.accessibility;
  if (profile.fuelType) out.fuelType = profile.fuelType;
  if (profile.chargePorts?.length) out.chargePorts = profile.chargePorts;
  if (profile.parkingPrivileges?.length) out.parkingPrivileges = profile.parkingPrivileges;
  return Object.keys(out).length ? out : null;
}
