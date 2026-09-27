import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { LOCATION_SYSTEM_TEXT, type LocationLocale } from "../strings";
import { searchAddress } from "../lib/addressSearch";
import { getAddressFromCoords } from "../lib/geocoding";
import { getBrowserPosition, isPermissionDeniedError, type GeoCoords } from "../lib/geolocation";
import {
  clearManualLocation,
  clearSavedLocation,
  readManualLocation,
  readValidAutoLocation,
  saveAutoLocation,
  saveManualLocation,
  type SavedLocation,
} from "../lib/locationStorage";

export type LocationStatus = "loading" | "ready" | "failed";

export type CurrentLocation = {
  status: LocationStatus;
  /** 한국어 주소 원문 (표시용 번역은 LocationHeader가 한다). status가 "ready"일 때만 값이 있다. */
  address: string | null;
  coords: GeoCoords | null;
  /** 사용자가 위치 선택 페이지에서 직접 고른 위치인지 (false면 GPS 위치) */
  isManual: boolean;
  /** GPS로 현재 위치를 다시 조회한다 */
  refresh: () => Promise<void>;
};

type ResolvedLocation = { address: string; coords: GeoCoords; isManual: boolean };

async function geocodeFirstResult(address: string, locale: LocationLocale): Promise<GeoCoords | null> {
  const [first] = await searchAddress(address, locale);
  return first ? { latitude: first.latitude, longitude: first.longitude } : null;
}

/** 저장된 수동 위치를 좌표·표시 주소까지 채워 복원한다. 좌표를 끝내 못 구하면 null. */
async function restoreManualLocation(
  saved: SavedLocation,
  locale: LocationLocale,
): Promise<ResolvedLocation | null> {
  const coords = saved.coords ?? (await geocodeFirstResult(saved.address, locale));
  if (!coords) return null;

  const address =
    (await getAddressFromCoords(coords.latitude, coords.longitude, locale)) ?? saved.address;
  saveManualLocation(address, coords);
  return { address, coords, isManual: true };
}

async function detectBrowserLocation(locale: LocationLocale): Promise<ResolvedLocation> {
  const coords = await getBrowserPosition();
  const address =
    (await getAddressFromCoords(coords.latitude, coords.longitude, locale)) ??
    LOCATION_SYSTEM_TEXT.unknownAddress;
  saveAutoLocation(address, coords);
  return { address, coords, isManual: false };
}

/**
 * 헤더에 표시할 현재 위치 상태.
 * 진입 시 우선순위: 직접 고른 위치 → 5분 내 GPS 캐시 → GPS 조회.
 */
export function useCurrentLocation(locale: LocationLocale = "ko"): CurrentLocation {
  const { toast } = useToast();
  const [status, setStatus] = useState<LocationStatus>("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [isManual, setIsManual] = useState(false);

  // locale을 초기화 effect의 deps에 두면 언어 전환만으로 GPS를 다시 조회하므로 ref로 읽는다
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const applyLocation = useCallback((location: ResolvedLocation) => {
    setAddress(location.address);
    setCoords(location.coords);
    setIsManual(location.isManual);
    setStatus("ready");
  }, []);

  const markFailed = useCallback(() => {
    clearSavedLocation();
    setAddress(null);
    setCoords(null);
    setIsManual(false);
    setStatus("failed");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initLocation = async () => {
      const manual = readManualLocation();
      if (manual) {
        try {
          const restored = await restoreManualLocation(manual, localeRef.current);
          if (cancelled) return;
          if (restored) {
            applyLocation(restored);
            return;
          }
        } catch {
          // 아래 안내 후 GPS로 폴백
        }
        if (cancelled) return;
        clearManualLocation();
        toast({
          title: "주소 검색 실패",
          description: "주소를 찾지 못했습니다. 현재 위치(GPS)로 다시 시도합니다.",
          variant: "destructive",
        });
      }

      const cached = readValidAutoLocation();
      if (cached) {
        applyLocation({ ...cached, isManual: false });
        return;
      }

      try {
        const detected = await detectBrowserLocation(localeRef.current);
        if (!cancelled) applyLocation(detected);
      } catch (error) {
        if (cancelled) return;
        markFailed();
        toast(
          isPermissionDeniedError(error)
            ? {
                title: "위치 권한 필요",
                description: "위치 권한을 허용하면 자동으로 현재 위치가 설정됩니다.",
                duration: 2000,
              }
            : {
                title: "위치를 불러올 수 없습니다",
                description: "현재 위치를 확인하지 못했습니다. 상단에서 위치를 직접 설정해 주세요.",
                duration: 2000,
              },
        );
      }
    };

    initLocation();
    return () => {
      cancelled = true;
    };
  }, [applyLocation, markFailed, toast]);

  // 언어를 바꿔도 좌표는 그대로이므로 GPS 재조회 없이 주소만 새 언어로 다시 받는다.
  // 최초 진입은 위 초기화 effect가 처리하므로 건너뛴다.
  const resolvedLocaleRef = useRef(locale);
  useEffect(() => {
    if (resolvedLocaleRef.current === locale) return;
    resolvedLocaleRef.current = locale;
    if (!coords) return;

    let cancelled = false;
    getAddressFromCoords(coords.latitude, coords.longitude, locale)
      .then((resolved) => {
        if (cancelled || !resolved) return;
        setAddress(resolved);
        if (isManual) {
          saveManualLocation(resolved, coords);
        } else {
          saveAutoLocation(resolved, coords);
        }
      })
      .catch(() => {
        // 재조회 실패 시 기존 주소를 그대로 둔다
      });

    return () => {
      cancelled = true;
    };
  }, [locale, coords, isManual]);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      applyLocation(await detectBrowserLocation(localeRef.current));
      toast({ title: "위치 업데이트 완료", description: "현재 위치가 업데이트되었습니다." });
    } catch {
      markFailed();
      toast({
        title: "위치 업데이트 실패",
        description: "위치를 가져올 수 없습니다. 위치 설정에서 직접 선택해 주세요.",
        variant: "destructive",
        duration: 2000,
      });
    }
  }, [applyLocation, markFailed, toast]);

  return { status, address, coords, isManual, refresh };
}
