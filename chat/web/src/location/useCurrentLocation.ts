import { useCallback, useEffect, useRef, useState } from "react";
import type { AppLocale } from "../locale.js";
import { getAddressFromCoords } from "./geocoding.js";
import {
  describeGeolocationError,
  getBrowserPosition,
  isPermissionDeniedError,
  type GeoCoords,
} from "./geolocation.js";
import {
  clearSavedLocation,
  readValidAutoLocation,
  saveAutoLocation,
  type SavedLocation,
} from "./locationStorage.js";
import { LOCATION_SYSTEM_TEXT, locationCopy } from "./strings.js";

export type LocationStatus = "loading" | "ready" | "failed";

export type CurrentLocation = {
  status: LocationStatus;
  /** 한국어 주소 원문. status가 "ready"일 때만 값이 있다. */
  address: string | null;
  coords: GeoCoords | null;
  /** GPS로 현재 위치를 다시 조회한다. 성공하면 true. */
  refresh: () => Promise<boolean>;
};

async function detectBrowserLocation(): Promise<SavedLocation> {
  const coords = await getBrowserPosition();
  const address =
    (await getAddressFromCoords(coords.latitude, coords.longitude)) ??
    LOCATION_SYSTEM_TEXT.unknownAddress;
  saveAutoLocation(address, coords);
  return { address, coords };
}

/**
 * 지도에 쓰는 현재(GPS) 위치 상태. 진입 시 5분 내 캐시가 있으면 쓰고, 없으면 GPS를 조회한다.
 * 주소는 늘 한국어로 저장하므로 언어를 바꿔도 다시 조회하지 않는다.
 */
export function useCurrentLocation(
  locale: AppLocale,
  notify: (message: string) => void,
): CurrentLocation {
  const [status, setStatus] = useState<LocationStatus>("loading");
  const [address, setAddress] = useState<string | null>(null);
  const [coords, setCoords] = useState<GeoCoords | null>(null);

  // 언어·알림 함수가 바뀌어도 초기화 effect가 다시 돌지 않도록 ref로 읽는다
  const copyRef = useRef(locationCopy(locale));
  copyRef.current = locationCopy(locale);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const applyLocation = useCallback((location: SavedLocation) => {
    setAddress(location.address);
    setCoords(location.coords);
    setStatus("ready");
  }, []);

  const markFailed = useCallback(() => {
    clearSavedLocation();
    setAddress(null);
    setCoords(null);
    setStatus("failed");
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initLocation = async () => {
      const cached = readValidAutoLocation();
      if (cached) {
        applyLocation(cached);
        return;
      }

      try {
        const detected = await detectBrowserLocation();
        if (!cancelled) applyLocation(detected);
      } catch (error) {
        if (cancelled) return;
        markFailed();
        notifyRef.current(
          isPermissionDeniedError(error)
            ? copyRef.current.permissionNeeded
            : copyRef.current.locateFailed,
        );
      }
    };

    void initLocation();
    return () => {
      cancelled = true;
    };
  }, [applyLocation, markFailed]);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      applyLocation(await detectBrowserLocation());
      return true;
    } catch (error) {
      markFailed();
      notifyRef.current(describeGeolocationError(error, copyRef.current));
      return false;
    }
  }, [applyLocation, markFailed]);

  return { status, address, coords, refresh };
}
