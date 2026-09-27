import { LOCATION_API } from "../config";
import type { LocationLocale } from "../strings";
import {
  loadNaverGeocoder,
  type NaverReverseGeocodeItem,
  type NaverReverseGeocodeResponse,
} from "./naverSdk";

const REVERSE_GEOCODE_ORDERS = "roadaddr,addr,admcode";
const NAVER_SDK_TIMEOUT_MS = 10000;

function formatReverseGeocodeItem(item: NaverReverseGeocodeItem): string {
  const area2 = item.region?.area2?.name ?? "";
  const area3 = item.region?.area3?.name ?? "";
  const number1 = item.land?.number1 ?? "";
  const number2 = item.land?.number2 ? `-${item.land.number2}` : "";

  if (item.name === "roadaddr") {
    return [area2, area3, item.land?.name ?? "", `${number1}${number2}`]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  const lot = number1 ? `${number1}${number2}` : "";
  return [area2, area3, lot].filter(Boolean).join(" ").trim();
}

function pickAddress(response: NaverReverseGeocodeResponse | undefined): string | null {
  const results =
    response?.results ?? response?.v2?.results ?? response?.result?.results ?? [];

  for (const type of ["roadaddr", "addr", "admcode", "legalcode"]) {
    const item = results.find((result) => result?.name === type);
    const formatted = item ? formatReverseGeocodeItem(item) : "";
    if (formatted) return formatted;
  }
  return null;
}

async function reverseGeocodeViaProxy(latitude: number, longitude: number): Promise<string | null> {
  const url = new URL(LOCATION_API.naverReverseGeocode, window.location.origin);
  url.searchParams.set("coords", `${longitude},${latitude}`);
  url.searchParams.set("orders", REVERSE_GEOCODE_ORDERS);
  url.searchParams.set("sourcecrs", "epsg:4326");

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = await res.json();
  if (data?.status?.code !== 0) return null;
  return pickAddress(data);
}

async function reverseGeocodeViaSdk(
  latitude: number,
  longitude: number,
  locale: LocationLocale,
): Promise<string | null> {
  const sdk = await loadNaverGeocoder(locale);
  const service = sdk?.maps.Service;
  if (!sdk || !service) return null;

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(null), NAVER_SDK_TIMEOUT_MS);
    service.reverseGeocode(
      { coords: new sdk.maps.LatLng(latitude, longitude), orders: REVERSE_GEOCODE_ORDERS },
      (status, response) => {
        window.clearTimeout(timeoutId);
        resolve(status === service.Status.OK ? pickAddress(response?.v2) : null);
      },
    );
  });
}

/** 좌표 → "구 동 도로명 번지" 형식 주소. 서버 프록시 → JS SDK 순으로 시도하고, 모두 실패하면 null. */
export async function getAddressFromCoords(
  latitude: number,
  longitude: number,
  locale: LocationLocale,
): Promise<string | null> {
  const attempts = [
    () => reverseGeocodeViaProxy(latitude, longitude),
    () => reverseGeocodeViaSdk(latitude, longitude, locale),
  ];
  for (const attempt of attempts) {
    try {
      const address = await attempt();
      if (address) return address;
    } catch {
      // 실패 시 다음 폴백 경로로 넘어간다
    }
  }
  return null;
}
