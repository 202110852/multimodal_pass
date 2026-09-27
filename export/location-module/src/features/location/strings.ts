export type LocationLocale = "ko" | "en" | "zh" | "ja";

/**
 * 주소 자리에 저장되는 한국어 고정 문구.
 * 기계번역 대상이 아니며, 표시할 때 resolveSystemText로 현재 언어 문구로 바꾼다.
 */
export const LOCATION_SYSTEM_TEXT = {
  unknownAddress: "위치를 확인할 수 없음",
  currentLocationName: "현재 위치",
} as const;

type HeaderCopy = {
  checking: string;
  fetchFailed: string;
  unknownAddress: string;
  currentLocationName: string;
  manualLabel: string;
  currentLabel: string;
  refreshAria: string;
};

const HEADER_COPY: Record<LocationLocale, HeaderCopy> = {
  ko: {
    checking: "위치 확인 중...",
    fetchFailed: "현재 위치를 불러올 수 없음",
    unknownAddress: "위치를 확인할 수 없음",
    currentLocationName: "현재 위치",
    manualLabel: "사용자 위치",
    currentLabel: "현재 위치",
    refreshAria: "위치 새로고침",
  },
  en: {
    checking: "Checking location...",
    fetchFailed: "Could not load current location",
    unknownAddress: "Location unavailable",
    currentLocationName: "Current location",
    manualLabel: "Saved location",
    currentLabel: "Current location",
    refreshAria: "Refresh location",
  },
  zh: {
    checking: "正在确认位置...",
    fetchFailed: "无法加载当前位置",
    unknownAddress: "无法确认位置",
    currentLocationName: "当前位置",
    manualLabel: "已保存位置",
    currentLabel: "当前位置",
    refreshAria: "刷新位置",
  },
  ja: {
    checking: "位置を確認中...",
    fetchFailed: "現在地を読み込めません",
    unknownAddress: "位置を確認できません",
    currentLocationName: "現在地",
    manualLabel: "保存した位置",
    currentLabel: "現在地",
    refreshAria: "位置を更新",
  },
};

export function headerCopy(locale: LocationLocale): HeaderCopy {
  return HEADER_COPY[locale];
}

/** 저장된 값이 고정 문구면 현재 언어 문구를, 실제 주소면 null을 반환한다 */
export function resolveSystemText(locale: LocationLocale, stored: string): string | null {
  if (stored === LOCATION_SYSTEM_TEXT.unknownAddress) return HEADER_COPY[locale].unknownAddress;
  if (stored === LOCATION_SYSTEM_TEXT.currentLocationName) {
    return HEADER_COPY[locale].currentLocationName;
  }
  return null;
}
