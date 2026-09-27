/** 위치 선택 페이지 경로. 라우터에 이 경로로 `LocationSelectPage`를 등록한다. */
export const LOCATION_PAGE_PATH = "/location";

/** returnTo가 없거나 허용되지 않은 값일 때 돌아갈 경로 */
export const DEFAULT_RETURN_TO = "/";

/** 위치 선택 후 돌아갈 수 있는 경로. open redirect 방지용 화이트리스트. */
export const RETURN_TO_PATHS: ReadonlySet<string> = new Set([DEFAULT_RETURN_TO]);

/** 검색 결과에서 먼저 보여줄 지역 키워드 (예: "제주"). null이면 정렬하지 않는다. */
export const PRIORITY_REGION_KEYWORD: string | null = null;

/** 자동(GPS) 위치 캐시 유지 시간 */
export const AUTO_LOCATION_TTL_MS = 5 * 60 * 1000;

/** 서버 프록시 경로 (api/ 폴더의 서버리스 함수) */
export const LOCATION_API = {
  naverGeocode: "/api/naver/geocode",
  naverReverseGeocode: "/api/naver/reverse-geocode",
  kakaoSearch: "/api/kakao/search",
} as const;

export const STORAGE_KEYS = {
  selectedLocation: "selectedLocation",
  currentCoordinates: "currentCoordinates",
  isManualLocation: "isManualLocation",
  autoLocationSavedAt: "locationPrefetchAt",
  recentLocations: "recentLocations",
} as const;
