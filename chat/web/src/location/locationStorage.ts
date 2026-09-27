import { AUTO_LOCATION_TTL_MS, STORAGE_KEYS } from "./config.js";
import { parseStoredCoords, type GeoCoords } from "./geolocation.js";

export type SavedLocation = { address: string; coords: GeoCoords };

/** TTL 안에 GPS로 받아 둔 위치가 있으면 반환 (재진입 시 GPS 재조회 방지) */
export function readValidAutoLocation(): SavedLocation | null {
  const savedAt = Number(localStorage.getItem(STORAGE_KEYS.autoLocationSavedAt));
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > AUTO_LOCATION_TTL_MS) return null;

  const coords = parseStoredCoords(localStorage.getItem(STORAGE_KEYS.currentCoordinates));
  const address = localStorage.getItem(STORAGE_KEYS.selectedLocation);
  if (!coords || !address) return null;
  return { address, coords };
}

export function saveAutoLocation(address: string, coords: GeoCoords): void {
  localStorage.setItem(STORAGE_KEYS.selectedLocation, address);
  localStorage.setItem(STORAGE_KEYS.currentCoordinates, JSON.stringify(coords));
  localStorage.setItem(STORAGE_KEYS.autoLocationSavedAt, Date.now().toString());
}

/** 위치 조회 실패 시 이전 위치가 남아 잘못 표시되지 않도록 저장값을 지운다 */
export function clearSavedLocation(): void {
  localStorage.removeItem(STORAGE_KEYS.selectedLocation);
  localStorage.removeItem(STORAGE_KEYS.currentCoordinates);
  localStorage.removeItem(STORAGE_KEYS.autoLocationSavedAt);
}
