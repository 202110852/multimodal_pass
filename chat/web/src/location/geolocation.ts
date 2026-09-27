import type { LocationCopy } from "./strings.js";

export type GeoCoords = { latitude: number; longitude: number };

export function isValidCoords(coords: unknown): coords is GeoCoords {
  if (!coords || typeof coords !== "object") return false;
  const { latitude, longitude } = coords as GeoCoords;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    !Number.isNaN(latitude) &&
    !Number.isNaN(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function parseStoredCoords(raw: string | null): GeoCoords | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isValidCoords(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** GPS 조회 최대 대기 시간 (초과 시 실패 처리) */
const GEOLOCATION_TIMEOUT_MS = 10000;

/** 브라우저 위치 조회. 실패 시 GeolocationPositionError(또는 미지원 Error)를 던진다. */
export function getBrowserPosition(): Promise<GeoCoords> {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("Geolocation not supported"));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      reject,
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60000 },
    );
  });
}

export function isPermissionDeniedError(error: unknown): boolean {
  return (error as GeolocationPositionError | undefined)?.code === 1;
}

/** 위치 조회 실패 사유를 사용자 안내 문구로 바꾼다 */
export function describeGeolocationError(error: unknown, copy: LocationCopy): string {
  switch ((error as GeolocationPositionError | undefined)?.code) {
    case 1:
      return copy.geoDenied;
    case 2:
      return copy.geoUnavailable;
    case 3:
      return copy.geoTimeout;
    default:
      return navigator.geolocation ? copy.geoGeneric : copy.geoUnsupported;
  }
}
