import type { AppLocale } from "../locale.js";

/**
 * 주소 자리에 저장되는 한국어 고정 문구.
 * 기계번역 대상이 아니며, 표시할 때 resolveSystemText로 현재 언어 문구로 바꾼다.
 */
export const LOCATION_SYSTEM_TEXT = {
  unknownAddress: "위치를 확인할 수 없음",
} as const;

export type LocationCopy = {
  unknownAddress: string;
  currentLocationName: string;
  myLocation: string;
  originPlaceholder: string;
  destinationPlaceholder: string;
  originSearch: string;
  destinationSearch: string;
  dragToReorder: string;
  waypoint: string;
  waypointSearch: string;
  addWaypoint: string;
  removeWaypoint: string;
  setWaypoint: string;
  searchResults: string;
  clearSearch: string;
  noResults: string;
  searchFailed: string;
  permissionNeeded: string;
  locateFailed: string;
  geoDenied: string;
  geoUnavailable: string;
  geoTimeout: string;
  geoUnsupported: string;
  geoGeneric: string;
  mapMissingKey: string;
  mapLoadFailed: string;
  openChat: string;
  closeChat: string;
  setOrigin: string;
  setDestination: string;
  origin: string;
  destination: string;
  resetRoute: string;
  saveRoute: string;
  savedRoutes: string;
  pickedPoint: string;
  closeMenu: string;
};

const LOCATION_COPY: Record<AppLocale, LocationCopy> = {
  ko: {
    unknownAddress: "위치를 확인할 수 없음",
    currentLocationName: "현재 위치",
    myLocation: "현재 위치로 이동",
    originPlaceholder: "출발지 검색",
    destinationPlaceholder: "도착지 검색",
    originSearch: "출발지 검색",
    destinationSearch: "도착지 검색",
    dragToReorder: "끌어서 순서 바꾸기",
    waypoint: "경유",
    waypointSearch: "경유지 검색",
    addWaypoint: "경유지 추가",
    removeWaypoint: "경유지 삭제",
    setWaypoint: "경유지로 설정",
    searchResults: "검색 결과",
    clearSearch: "검색어 지우기",
    noResults: "검색 결과가 없습니다.",
    searchFailed: "검색 중 오류가 발생했습니다.",
    permissionNeeded: "위치 권한을 허용하면 현재 위치가 자동으로 설정됩니다.",
    locateFailed: "현재 위치를 확인하지 못했습니다.",
    geoDenied: "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요.",
    geoUnavailable: "위치 정보를 사용할 수 없습니다.",
    geoTimeout: "위치 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
    geoUnsupported: "브라우저가 위치 서비스를 지원하지 않습니다.",
    geoGeneric: "위치를 가져올 수 없습니다.",
    mapMissingKey: "카카오맵 키(VITE_KAKAO_APP_KEY)가 설정되지 않았습니다.",
    mapLoadFailed: "지도를 불러오지 못했습니다.",
    openChat: "챗봇 열기",
    closeChat: "챗봇 닫기",
    setOrigin: "출발지로 설정",
    setDestination: "도착지로 설정",
    origin: "출발",
    destination: "도착",
    resetRoute: "다시입력",
    saveRoute: "경로 저장하기",
    savedRoutes: "저장 목록",
    pickedPoint: "선택한 위치",
    closeMenu: "메뉴 닫기",
  },
  en: {
    unknownAddress: "Location unavailable",
    currentLocationName: "Current location",
    myLocation: "Go to my location",
    originPlaceholder: "Start",
    destinationPlaceholder: "Destination",
    originSearch: "Search start",
    destinationSearch: "Search destination",
    dragToReorder: "Drag to reorder",
    waypoint: "Stop",
    waypointSearch: "Search stop",
    addWaypoint: "Add stop",
    removeWaypoint: "Remove stop",
    setWaypoint: "Set as stop",
    searchResults: "Search results",
    clearSearch: "Clear search",
    noResults: "No results found.",
    searchFailed: "Something went wrong while searching.",
    permissionNeeded: "Allow location access to set your current location automatically.",
    locateFailed: "Couldn't find your current location.",
    geoDenied: "Location permission denied. Please allow it in your browser settings.",
    geoUnavailable: "Location information is unavailable.",
    geoTimeout: "Location request timed out. Please try again.",
    geoUnsupported: "This browser does not support location services.",
    geoGeneric: "Couldn't get your location.",
    mapMissingKey: "Kakao Map key (VITE_KAKAO_APP_KEY) is not set.",
    mapLoadFailed: "Couldn't load the map.",
    openChat: "Open chatbot",
    closeChat: "Close chatbot",
    setOrigin: "Set as start",
    setDestination: "Set as destination",
    origin: "Start",
    destination: "Destination",
    resetRoute: "Reset",
    saveRoute: "Save route",
    savedRoutes: "Saved",
    pickedPoint: "Selected point",
    closeMenu: "Close menu",
  },
  zh: {
    unknownAddress: "无法确认位置",
    currentLocationName: "当前位置",
    myLocation: "移动到当前位置",
    originPlaceholder: "出发地",
    destinationPlaceholder: "目的地",
    originSearch: "搜索出发地",
    destinationSearch: "搜索目的地",
    dragToReorder: "拖动以调整顺序",
    waypoint: "途经",
    waypointSearch: "搜索途经地",
    addWaypoint: "添加途经地",
    removeWaypoint: "删除途经地",
    setWaypoint: "设为途经地",
    searchResults: "搜索结果",
    clearSearch: "清除搜索",
    noResults: "没有搜索结果。",
    searchFailed: "搜索时发生错误。",
    permissionNeeded: "允许位置权限后将自动设置当前位置。",
    locateFailed: "无法确认当前位置。",
    geoDenied: "位置权限被拒绝，请在浏览器设置中允许。",
    geoUnavailable: "无法使用位置信息。",
    geoTimeout: "位置请求超时，请稍后重试。",
    geoUnsupported: "此浏览器不支持定位服务。",
    geoGeneric: "无法获取位置。",
    mapMissingKey: "未设置 Kakao 地图密钥 (VITE_KAKAO_APP_KEY)。",
    mapLoadFailed: "无法加载地图。",
    openChat: "打开聊天机器人",
    closeChat: "关闭聊天机器人",
    setOrigin: "设为出发地",
    setDestination: "设为目的地",
    origin: "出发",
    destination: "到达",
    resetRoute: "重新输入",
    saveRoute: "保存路线",
    savedRoutes: "已存列表",
    pickedPoint: "所选位置",
    closeMenu: "关闭菜单",
  },
  ja: {
    unknownAddress: "位置を確認できません",
    currentLocationName: "現在地",
    myLocation: "現在地へ移動",
    originPlaceholder: "出発地",
    destinationPlaceholder: "目的地",
    originSearch: "出発地を検索",
    destinationSearch: "目的地を検索",
    dragToReorder: "ドラッグして並べ替え",
    waypoint: "経由",
    waypointSearch: "経由地を検索",
    addWaypoint: "経由地を追加",
    removeWaypoint: "経由地を削除",
    setWaypoint: "経由地に設定",
    searchResults: "検索結果",
    clearSearch: "検索語を消去",
    noResults: "検索結果がありません。",
    searchFailed: "検索中にエラーが発生しました。",
    permissionNeeded: "位置情報を許可すると現在地が自動で設定されます。",
    locateFailed: "現在地を確認できません。",
    geoDenied: "位置情報の権限が拒否されました。ブラウザ設定で許可してください。",
    geoUnavailable: "位置情報を利用できません。",
    geoTimeout: "位置情報の取得がタイムアウトしました。もう一度お試しください。",
    geoUnsupported: "このブラウザは位置情報サービスに対応していません。",
    geoGeneric: "位置を取得できません。",
    mapMissingKey: "Kakao マップキー (VITE_KAKAO_APP_KEY) が設定されていません。",
    mapLoadFailed: "地図を読み込めません。",
    openChat: "チャットボットを開く",
    closeChat: "チャットボットを閉じる",
    setOrigin: "出発地に設定",
    setDestination: "目的地に設定",
    origin: "出発",
    destination: "到着",
    resetRoute: "リセット",
    saveRoute: "ルートを保存",
    savedRoutes: "保存一覧",
    pickedPoint: "選択した位置",
    closeMenu: "メニューを閉じる",
  },
};

export function locationCopy(locale: AppLocale): LocationCopy {
  return LOCATION_COPY[locale];
}

/** 저장된 값이 고정 문구면 현재 언어 문구를, 실제 주소면 null을 반환한다 */
export function resolveSystemText(locale: AppLocale, stored: string): string | null {
  return stored === LOCATION_SYSTEM_TEXT.unknownAddress ? LOCATION_COPY[locale].unknownAddress : null;
}
