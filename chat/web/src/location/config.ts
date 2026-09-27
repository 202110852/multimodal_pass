import type { GeoCoords } from "./geolocation.js";

/** 위치를 아직 모를 때 지도 중심 (제주시청) */
export const DEFAULT_MAP_CENTER: GeoCoords = { latitude: 33.4996, longitude: 126.5312 };

/** 검색 결과에 이 지역이 있으면 다른 지역 결과는 뺀다 */
export const PRIORITY_REGION_KEYWORD = "제주";

/** 장소 검색을 먼저 좁힐 제주도 영역 (카카오 rect: 왼쪽 아래 경도,위도,오른쪽 위 경도,위도) */
export const PRIORITY_REGION_RECT = "126.08,33.10,126.99,33.60";

/** 경유지 최대 개수 (카카오모빌리티 자동차 길찾기 API 의 waypoints 한도) */
export const MAX_WAYPOINTS = 5;

/** GPS 위치 캐시 유지 시간 */
export const AUTO_LOCATION_TTL_MS = 5 * 60 * 1000;

export const STORAGE_KEYS = {
  selectedLocation: "location_selected",
  currentCoordinates: "location_coords",
  autoLocationSavedAt: "location_auto_saved_at",
} as const;
