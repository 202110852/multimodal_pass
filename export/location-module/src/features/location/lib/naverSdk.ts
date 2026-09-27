import type { LocationLocale } from "../strings";

/**
 * 네이버 지도 JS SDK의 geocoder 서브모듈 로더.
 * 서버 프록시(/api/naver/*)가 실패했을 때만 폴백으로 사용한다.
 */

export type NaverGeocodeAddress = {
  roadAddress?: string;
  jibunAddress?: string;
  x?: string;
  y?: string;
};

type NaverRegionName = { name?: string };

export type NaverReverseGeocodeItem = {
  name?: string;
  region?: {
    area1?: NaverRegionName;
    area2?: NaverRegionName;
    area3?: NaverRegionName;
    area4?: NaverRegionName;
  };
  land?: { name?: string; number1?: string; number2?: string };
};

export type NaverReverseGeocodeResponse = {
  results?: NaverReverseGeocodeItem[];
  v2?: { results?: NaverReverseGeocodeItem[] };
  result?: { results?: NaverReverseGeocodeItem[] };
};

type NaverGeocoderService = {
  Status: { OK: unknown };
  geocode: (
    options: { query: string },
    callback: (status: unknown, response: { v2?: { addresses?: NaverGeocodeAddress[] } }) => void,
  ) => void;
  reverseGeocode: (
    options: { coords: unknown; orders: string },
    callback: (status: unknown, response: { v2?: NaverReverseGeocodeResponse }) => void,
  ) => void;
};

export type NaverMapsSdk = {
  maps: {
    LatLng: new (latitude: number, longitude: number) => unknown;
    Service?: NaverGeocoderService;
  };
};

const SCRIPT_LOAD_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

let loadPromise: Promise<NaverMapsSdk | null> | null = null;

function getNaverSdk(): NaverMapsSdk | undefined {
  return (window as unknown as { naver?: NaverMapsSdk }).naver;
}

function getClientId(): string | undefined {
  return import.meta.env.VITE_NAVER_NCP_KEY_ID || undefined;
}

async function waitForGeocoder(): Promise<NaverMapsSdk | null> {
  const deadline = Date.now() + SCRIPT_LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const sdk = getNaverSdk();
    if (sdk?.maps?.Service) return sdk;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}

function injectScript(clientId: string, locale: LocationLocale): Promise<void> {
  const params = new URLSearchParams({
    ncpKeyId: clientId,
    language: locale,
    submodules: "geocoder",
  });

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${params.toString()}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Naver Maps SDK 로드 실패"));
    document.head.appendChild(script);
  });
}

/**
 * geocoder가 준비된 SDK를 반환한다. 키 미설정·로드 실패 시 null.
 * 대상 앱의 지도와 충돌하지 않도록 이미 로드된 SDK는 다시 로드하지 않으므로, 언어는 최초 로드 시점 값이 유지된다.
 */
export function loadNaverGeocoder(locale: LocationLocale): Promise<NaverMapsSdk | null> {
  const existing = getNaverSdk();
  if (existing?.maps?.Service) return Promise.resolve(existing);

  const clientId = getClientId();
  if (!clientId) return Promise.resolve(null);

  if (!loadPromise) {
    loadPromise = injectScript(clientId, locale)
      .then(waitForGeocoder)
      .catch(() => null)
      .then((sdk) => {
        if (!sdk) loadPromise = null;
        return sdk;
      });
  }
  return loadPromise;
}
