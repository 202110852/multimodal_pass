import { AUTO_LOCATION_TTL_MS, STORAGE_KEYS } from "../config";
import { isValidCoords, parseStoredCoords, type GeoCoords } from "./geolocation";

export type SavedLocation = { address: string; coords: GeoCoords | null };

export type RecentLocation = {
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
};

const MAX_RECENT_LOCATIONS = 5;

function readCoords(): GeoCoords | null {
  return parseStoredCoords(localStorage.getItem(STORAGE_KEYS.currentCoordinates));
}

function writeCoords(coords: GeoCoords | null): void {
  if (coords) {
    localStorage.setItem(STORAGE_KEYS.currentCoordinates, JSON.stringify(coords));
  } else {
    localStorage.removeItem(STORAGE_KEYS.currentCoordinates);
  }
}

/** 사용자가 위치 선택 페이지에서 직접 고른 위치. 좌표는 없을 수 있다(주소만 저장된 최근 위치). */
export function readManualLocation(): SavedLocation | null {
  if (localStorage.getItem(STORAGE_KEYS.isManualLocation) !== "true") return null;

  const address = localStorage.getItem(STORAGE_KEYS.selectedLocation);
  if (!address) {
    clearManualLocation();
    return null;
  }
  return { address, coords: readCoords() };
}

export function saveManualLocation(address: string, coords: GeoCoords | null): void {
  localStorage.setItem(STORAGE_KEYS.selectedLocation, address);
  writeCoords(coords);
  localStorage.setItem(STORAGE_KEYS.isManualLocation, "true");
  localStorage.removeItem(STORAGE_KEYS.autoLocationSavedAt);
}

export function clearManualLocation(): void {
  localStorage.removeItem(STORAGE_KEYS.isManualLocation);
}

/** TTL 안에 GPS로 받아 둔 자동 위치가 있으면 반환 (재진입 시 GPS 재조회 방지) */
export function readValidAutoLocation(): (SavedLocation & { coords: GeoCoords }) | null {
  if (localStorage.getItem(STORAGE_KEYS.isManualLocation) === "true") return null;

  const savedAt = Number(localStorage.getItem(STORAGE_KEYS.autoLocationSavedAt));
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > AUTO_LOCATION_TTL_MS) return null;

  const coords = readCoords();
  const address = localStorage.getItem(STORAGE_KEYS.selectedLocation);
  if (!coords || !address) return null;
  return { address, coords };
}

export function saveAutoLocation(address: string, coords: GeoCoords): void {
  localStorage.setItem(STORAGE_KEYS.selectedLocation, address);
  writeCoords(coords);
  localStorage.setItem(STORAGE_KEYS.autoLocationSavedAt, Date.now().toString());
  localStorage.removeItem(STORAGE_KEYS.isManualLocation);
}

/** 위치 조회 실패 시 이전 위치가 남아 잘못 표시되지 않도록 저장값을 지운다 */
export function clearSavedLocation(): void {
  localStorage.removeItem(STORAGE_KEYS.selectedLocation);
  localStorage.removeItem(STORAGE_KEYS.currentCoordinates);
  localStorage.removeItem(STORAGE_KEYS.autoLocationSavedAt);
}

export function readRecentLocations(): RecentLocation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentLocations) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 같은 이름은 맨 앞으로 옮기고 최대 5개까지 유지한다. 갱신된 목록을 반환. */
export function saveRecentLocation(location: RecentLocation): RecentLocation[] {
  const updated = [
    location,
    ...readRecentLocations().filter((saved) => saved.name !== location.name),
  ].slice(0, MAX_RECENT_LOCATIONS);
  localStorage.setItem(STORAGE_KEYS.recentLocations, JSON.stringify(updated));
  return updated;
}

export function recentLocationCoords(location: RecentLocation): GeoCoords | null {
  const coords = { latitude: location.latitude, longitude: location.longitude };
  return isValidCoords(coords) ? coords : null;
}
