/**
 * 카카오맵 JS SDK 로더와 이 앱에서 쓰는 만큼의 타입.
 * services 라이브러리로 역지오코딩·주소 검색·장소 검색까지 브라우저에서 처리한다.
 * 카카오 개발자 콘솔의 [플랫폼 > Web]에 서비스 도메인(개발: http://localhost:5173)을 등록해야 한다.
 */

export type KakaoLatLng = { getLat(): number; getLng(): number };

export type KakaoPoint = { x: number; y: number };

export type KakaoLatLngBounds = { extend(position: KakaoLatLng): void };

export type KakaoMap = {
  setCenter(position: KakaoLatLng): void;
  getCenter(): KakaoLatLng;
  panTo(position: KakaoLatLng): void;
  setLevel(level: number): void;
  /** padding 은 위·오른쪽·아래·왼쪽 순서의 픽셀 여백 */
  setBounds(bounds: KakaoLatLngBounds, top?: number, right?: number, bottom?: number, left?: number): void;
  relayout(): void;
  getProjection(): {
    coordsFromContainerPoint(point: KakaoPoint): KakaoLatLng;
    containerPointFromCoords(position: KakaoLatLng): KakaoPoint;
  };
};

/** 지도 마우스 이벤트 (click·rightclick). point 는 지도 컨테이너 기준 픽셀 좌표. */
export type KakaoMouseEvent = { latLng: KakaoLatLng; point: KakaoPoint };

export type KakaoCustomOverlay = {
  setPosition(position: KakaoLatLng): void;
  setMap(map: KakaoMap | null): void;
};

type KakaoStatus = "OK" | "ZERO_RESULT" | "ERROR";
type KakaoSortBy = "accuracy" | "distance";
type KakaoCallback<T> = (result: T[], status: KakaoStatus) => void;

type KakaoRegionAddress = {
  address_name: string;
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  main_address_no?: string;
  sub_address_no?: string;
};

type KakaoRoadAddress = {
  address_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  road_name: string;
  main_building_no: string;
  sub_building_no: string;
  building_name?: string;
};

export type KakaoCoord2AddressResult = {
  address: KakaoRegionAddress | null;
  road_address: KakaoRoadAddress | null;
};

export type KakaoAddressSearchResult = {
  address_name: string;
  x: string;
  y: string;
  address: { address_name: string } | null;
  road_address: { address_name: string; building_name?: string } | null;
};

export type KakaoPlace = {
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  category_name?: string;
};

type KakaoGeocoder = {
  coord2Address(lng: number, lat: number, callback: KakaoCallback<KakaoCoord2AddressResult>): void;
  addressSearch(
    query: string,
    callback: KakaoCallback<KakaoAddressSearchResult>,
    options?: { size?: number },
  ): void;
};

type KakaoPlaces = {
  keywordSearch(
    query: string,
    callback: KakaoCallback<KakaoPlace>,
    /** location 을 주고 sort 를 DISTANCE 로 하면 그 좌표에서 가까운 순으로 돌려준다 */
    options?: { size?: number; rect?: string; location?: KakaoLatLng; sort?: KakaoSortBy },
  ): void;
};

export type KakaoMapsApi = {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  Point: new (x: number, y: number) => KakaoPoint;
  LatLngBounds: new () => KakaoLatLngBounds;
  event: {
    addListener(target: KakaoMap, type: string, handler: (event?: KakaoMouseEvent) => void): void;
    removeListener(target: KakaoMap, type: string, handler: (event?: KakaoMouseEvent) => void): void;
  };
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
  CustomOverlay: new (options: {
    position: KakaoLatLng;
    content: HTMLElement | string;
    yAnchor?: number;
    zIndex?: number;
    /** true 면 오버레이를 눌러도 지도 click 이벤트가 나지 않는다 */
    clickable?: boolean;
  }) => KakaoCustomOverlay;
  services: {
    Geocoder: new () => KakaoGeocoder;
    Places: new () => KakaoPlaces;
    Status: Record<KakaoStatus, KakaoStatus>;
    SortBy: { ACCURACY: KakaoSortBy; DISTANCE: KakaoSortBy };
  };
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsApi };
  }
}

const SDK_URL = "https://dapi.kakao.com/v2/maps/sdk.js";
const SERVICE_TIMEOUT_MS = 10000;

let loadPromise: Promise<KakaoMapsApi> | null = null;

export function kakaoMapAppKey(): string | undefined {
  return import.meta.env.VITE_KAKAO_APP_KEY || undefined;
}

/** SDK를 한 번만 불러온다. 키가 없거나 로드에 실패하면 reject (다음 호출에서 다시 시도). */
export function loadKakaoMaps(): Promise<KakaoMapsApi> {
  const ready = window.kakao?.maps;
  if (ready?.services) return Promise.resolve(ready);

  const appKey = kakaoMapAppKey();
  if (!appKey) return Promise.reject(new Error("VITE_KAKAO_APP_KEY 미설정"));

  if (!loadPromise) {
    loadPromise = new Promise<KakaoMapsApi>((resolve, reject) => {
      const params = new URLSearchParams({ appkey: appKey, autoload: "false", libraries: "services" });
      const script = document.createElement("script");
      script.async = true;
      script.src = `${SDK_URL}?${params.toString()}`;
      script.onload = () => {
        const maps = window.kakao?.maps;
        if (!maps) {
          reject(new Error("카카오맵 SDK 초기화 실패"));
          return;
        }
        maps.load(() => resolve(maps));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("카카오맵 SDK 로드 실패"));
      };
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

/** 콜백형 services 호출을 Promise로 감싼다. 결과 없음·오류·시간 초과는 빈 배열. */
export function callKakaoService<T>(
  api: KakaoMapsApi,
  invoke: (callback: KakaoCallback<T>) => void,
): Promise<T[]> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve([]), SERVICE_TIMEOUT_MS);
    invoke((result, status) => {
      window.clearTimeout(timeoutId);
      resolve(status === api.services.Status.OK ? result : []);
    });
  });
}
