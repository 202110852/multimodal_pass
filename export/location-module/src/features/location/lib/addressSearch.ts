import { LOCATION_API, PRIORITY_REGION_KEYWORD } from "../config";
import type { LocationLocale } from "../strings";
import { loadNaverGeocoder, type NaverGeocodeAddress } from "./naverSdk";

export interface AddressSearchResult {
  placeName: string;
  address: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  category?: string;
}

type KakaoPlace = {
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  category_name?: string;
};

const MAX_RESULTS = 10;
const NAVER_SDK_TIMEOUT_MS = 10000;

/** 괄호·하이픈이 붙은 긴 주소를 단계적으로 짧게 만든 검색어 목록 */
function buildQueryVariants(query: string): string[] {
  const trimmed = query.trim();
  const variants: string[] = [];
  const add = (value: string) => {
    const variant = value.trim();
    if (variant.length >= 2 && !variants.includes(variant)) variants.push(variant);
  };

  add(trimmed);
  add(trimmed.replace(/\s*\([^)]*\)/g, ""));
  add(trimmed.split("(")[0] ?? "");
  add(trimmed.split(/[-–]/)[0] ?? "");
  return variants;
}

/** "도제원로41" → "도제원로41번길", "도제원로41길" 도 함께 검색 */
function buildRoadNameVariants(query: string): string[] {
  const trimmed = query.trim();
  const variants = [trimmed];
  const match = trimmed.match(/^(.+?)(\d+)$/);
  if (match && !/(번길|길|로|대로)$/.test(trimmed)) {
    const [, prefix, number] = match;
    variants.push(`${prefix}${number}번길`, `${prefix}${number}길`);
  }
  return variants;
}

function toResult(
  placeName: string,
  address: string,
  roadAddress: string,
  x: string | undefined,
  y: string | undefined,
  category?: string,
): AddressSearchResult | null {
  const latitude = Number.parseFloat(y ?? "");
  const longitude = Number.parseFloat(x ?? "");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { placeName, address, roadAddress, latitude, longitude, category };
}

function fromNaverAddresses(addresses: NaverGeocodeAddress[], query: string): AddressSearchResult[] {
  return addresses
    .map((addr) =>
      toResult(
        addr.roadAddress || addr.jibunAddress || query,
        addr.jibunAddress || "",
        addr.roadAddress || "",
        addr.x,
        addr.y,
      ),
    )
    .filter((result): result is AddressSearchResult => result !== null);
}

function prioritizeRegion(results: AddressSearchResult[]): AddressSearchResult[] {
  const keyword = PRIORITY_REGION_KEYWORD;
  if (!keyword) return results;
  const inRegion = (r: AddressSearchResult) => `${r.address}${r.roadAddress}`.includes(keyword);
  return [...results.filter(inRegion), ...results.filter((r) => !inRegion(r))];
}

async function searchNaverViaProxy(
  query: string,
  locale: LocationLocale,
): Promise<{ results: AddressSearchResult[]; forbidden: boolean }> {
  const url = new URL(LOCATION_API.naverGeocode, window.location.origin);
  url.searchParams.set("query", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  // NCP Geocoding REST는 kor|eng 만 지원한다
  url.searchParams.set("language", locale === "en" ? "eng" : "kor");

  const res = await fetch(url.toString());
  if (!res.ok) return { results: [], forbidden: res.status === 403 };

  const data = await res.json();
  if (data?.status !== "OK") return { results: [], forbidden: false };
  return { results: fromNaverAddresses(data.addresses ?? [], query), forbidden: false };
}

async function searchNaverViaSdk(
  query: string,
  locale: LocationLocale,
): Promise<AddressSearchResult[]> {
  const sdk = await loadNaverGeocoder(locale);
  const service = sdk?.maps.Service;
  if (!service) return [];

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve([]), NAVER_SDK_TIMEOUT_MS);
    service.geocode({ query }, (status, response) => {
      window.clearTimeout(timeoutId);
      if (status !== service.Status.OK) {
        resolve([]);
        return;
      }
      resolve(fromNaverAddresses(response?.v2?.addresses ?? [], query));
    });
  });
}

/** 네이버 Geocoding은 주소만 찾으므로 장소명(상호·관광지)은 카카오 키워드 검색으로 보완 */
async function searchKakaoPlaces(query: string): Promise<AddressSearchResult[]> {
  const seen = new Set<string>();
  const results: AddressSearchResult[] = [];

  for (const variant of buildRoadNameVariants(query)) {
    if (results.length >= MAX_RESULTS) break;
    try {
      const url = new URL(LOCATION_API.kakaoSearch, window.location.origin);
      url.searchParams.set("query", variant);
      url.searchParams.set("size", String(MAX_RESULTS));

      const res = await fetch(url.toString());
      if (!res.ok) continue;

      const data: { documents?: KakaoPlace[] } = await res.json();
      for (const doc of data.documents ?? []) {
        const key = doc.place_name + doc.address_name;
        if (seen.has(key)) continue;
        seen.add(key);

        const result = toResult(
          doc.place_name,
          doc.address_name,
          doc.road_address_name,
          doc.x,
          doc.y,
          doc.category_name,
        );
        if (result) results.push(result);
      }
    } catch {
      // 실패 시 다음 검색어 변형으로 넘어간다
    }
  }

  return prioritizeRegion(results.slice(0, MAX_RESULTS));
}

/** 주소·장소 검색: 네이버 주소(프록시 → SDK) → 카카오 장소명 순으로 시도 */
export async function searchAddress(
  query: string,
  locale: LocationLocale,
): Promise<AddressSearchResult[]> {
  if (!query.trim()) return [];

  const variants = buildQueryVariants(query);
  let geocodingForbidden = false;

  for (const variant of variants) {
    try {
      const { results, forbidden } = await searchNaverViaProxy(variant, locale);
      if (forbidden) geocodingForbidden = true;
      if (results.length > 0) return results;
    } catch {
      // 실패 시 다음 폴백 경로로 넘어간다
    }
  }

  if (!geocodingForbidden) {
    for (const variant of variants) {
      try {
        const results = await searchNaverViaSdk(variant, locale);
        if (results.length > 0) return results;
      } catch {
        // 실패 시 다음 폴백 경로로 넘어간다
      }
    }
  }

  return searchKakaoPlaces(query);
}
