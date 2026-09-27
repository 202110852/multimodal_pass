import { PRIORITY_REGION_KEYWORD, PRIORITY_REGION_RECT } from "./config.js";
import type { GeoCoords } from "./geolocation.js";
import {
  callKakaoService,
  loadKakaoMaps,
  type KakaoAddressSearchResult,
  type KakaoMapsApi,
  type KakaoPlace,
} from "./kakaoSdk.js";

export type AddressSearchResult = {
  placeName: string;
  address: string;
  roadAddress: string;
  latitude: number;
  longitude: number;
  category?: string;
};

const MAX_ADDRESS_RESULTS = 5;
const MAX_PLACE_RESULTS = 15;

/** 괄호·하이픈이 붙은 긴 주소를 단계적으로 짧게 만든 검색어 목록 */
function buildQueryVariants(query: string): string[] {
  const variants: string[] = [];
  const add = (value: string) => {
    const variant = value.trim();
    if (variant.length >= 2 && !variants.includes(variant)) variants.push(variant);
  };

  add(query);
  add(query.replace(/\s*\([^)]*\)/g, ""));
  add(query.split("(")[0] ?? "");
  add(query.split(/[-–]/)[0] ?? "");
  return variants;
}

function toResult(
  placeName: string,
  address: string,
  roadAddress: string,
  x: string,
  y: string,
  category?: string,
): AddressSearchResult | null {
  const latitude = Number.parseFloat(y);
  const longitude = Number.parseFloat(x);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { placeName, address, roadAddress, latitude, longitude, category };
}

function isResult(result: AddressSearchResult | null): result is AddressSearchResult {
  return result !== null;
}

/** 제주 결과가 하나라도 있으면 제주 결과만 남긴다 (지도에 핀으로 띄울 때 육지까지 축소되지 않게) */
function preferRegion(results: AddressSearchResult[]): AddressSearchResult[] {
  const inRegion = results.filter((r) => `${r.address}${r.roadAddress}`.includes(PRIORITY_REGION_KEYWORD));
  return inRegion.length > 0 ? inRegion : results;
}

/** 주소 검색은 검색어 변형을 차례로 시도해 처음 찾은 결과를 쓴다 */
async function searchAddresses(api: KakaoMapsApi, query: string): Promise<AddressSearchResult[]> {
  const geocoder = new api.services.Geocoder();
  for (const variant of buildQueryVariants(query)) {
    const found = await callKakaoService<KakaoAddressSearchResult>(api, (done) =>
      geocoder.addressSearch(variant, done, { size: MAX_ADDRESS_RESULTS }),
    );
    const results = found
      .map((doc) => {
        const roadAddress = doc.road_address?.address_name ?? "";
        const jibunAddress = doc.address?.address_name ?? doc.address_name;
        const placeName = doc.road_address?.building_name || roadAddress || jibunAddress;
        return toResult(placeName, jibunAddress, roadAddress, doc.x, doc.y);
      })
      .filter(isResult);
    if (results.length > 0) return results;
  }
  return [];
}

/**
 * 상호·관광지 같은 장소명은 키워드 검색으로 찾는다. 제주 안에서 먼저 찾고, 없으면 전국에서 찾는다.
 * near 가 있으면 그 좌표에서 가까운 순으로 받는다.
 */
async function searchPlaces(
  api: KakaoMapsApi,
  query: string,
  near: GeoCoords | null,
): Promise<AddressSearchResult[]> {
  const places = new api.services.Places();
  const nearOptions = near
    ? { location: new api.LatLng(near.latitude, near.longitude), sort: api.services.SortBy.DISTANCE }
    : {};
  const keywordSearch = (rect?: string) =>
    callKakaoService<KakaoPlace>(api, (done) =>
      places.keywordSearch(query.trim(), done, { size: MAX_PLACE_RESULTS, rect, ...nearOptions }),
    );
  const inRegion = await keywordSearch(PRIORITY_REGION_RECT);
  const found = inRegion.length > 0 ? inRegion : await keywordSearch();
  return found
    .map((doc) =>
      toResult(doc.place_name, doc.address_name, doc.road_address_name, doc.x, doc.y, doc.category_name),
    )
    .filter(isResult);
}

/** 주소·장소 검색: 주소 결과를 먼저, 이어서 장소 결과를 보여준다 (제주 결과가 있으면 제주만) */
export async function searchAddress(query: string, near: GeoCoords | null = null): Promise<AddressSearchResult[]> {
  if (!query.trim()) return [];

  const api = await loadKakaoMaps();
  const [addresses, places] = await Promise.all([
    searchAddresses(api, query),
    searchPlaces(api, query, near),
  ]);

  const seen = new Set<string>();
  const unique = [...addresses, ...places].filter((result) => {
    const key = `${result.placeName}\u0000${result.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return preferRegion(unique);
}
