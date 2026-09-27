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
export const GEOLOCATION_TIMEOUT_MS = 10000;

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
export function describeGeolocationError(error: unknown): string {
  switch ((error as GeolocationPositionError | undefined)?.code) {
    case 1:
      return "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.";
    case 2:
      return "위치 정보를 사용할 수 없습니다.";
    case 3:
      return "위치 요청 시간이 초과되었습니다. 잠시 후 다시 시도하거나 주소를 검색해 주세요.";
    default:
      return navigator.geolocation
        ? "위치를 가져올 수 없습니다."
        : "브라우저가 위치 서비스를 지원하지 않습니다.";
  }
}
