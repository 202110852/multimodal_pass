import { callKakaoService, loadKakaoMaps, type KakaoCoord2AddressResult } from "./kakaoSdk.js";

function buildingNumber(main: string | undefined, sub: string | undefined): string {
  if (!main) return "";
  return sub ? `${main}-${sub}` : main;
}

/** 도로명이 있으면 "시 동 도로명 번지", 없으면 "시 동 지번" (시·도는 뺀다) */
function formatAddress({ address, road_address: road }: KakaoCoord2AddressResult): string | null {
  // 도로명 주소의 region_3depth_name은 동 지역에서 비어 있어 지번 주소의 동 이름을 쓴다
  const city = address?.region_2depth_name || road?.region_2depth_name || "";
  const locality = address?.region_3depth_name || road?.region_3depth_name || "";

  if (road?.road_name) {
    const number = buildingNumber(road.main_building_no, road.sub_building_no);
    return [city, locality, road.road_name, number].filter(Boolean).join(" ");
  }
  if (address) {
    const lot = buildingNumber(address.main_address_no, address.sub_address_no);
    return [city, locality, lot].filter(Boolean).join(" ") || address.address_name;
  }
  return null;
}

/** 좌표 → 한국어 주소. SDK를 못 불러오거나 결과가 없으면 null. */
export async function getAddressFromCoords(latitude: number, longitude: number): Promise<string | null> {
  try {
    const api = await loadKakaoMaps();
    const geocoder = new api.services.Geocoder();
    const [first] = await callKakaoService<KakaoCoord2AddressResult>(api, (done) =>
      geocoder.coord2Address(longitude, latitude, done),
    );
    return first ? formatAddress(first) : null;
  } catch {
    return null;
  }
}
