/** 실제 키로 검색 2회 + 이동수단별 조회 1회. 키·요청 헤더는 출력하지 않는다. */
import { searchKakaoPlaces } from "../src/mastra/tools/kakaoSearchPlaces.js";
import { getKakaoDirections } from "../src/mastra/tools/kakaoDirections.js";
const origin = await searchKakaoPlaces({ query: "제주 관덕정", limit: 1 });
const destination = await searchKakaoPlaces({ query: "제주 동문재래시장", limit: 1 });
for (const [name, result] of [["origin", origin], ["destination", destination]] as const)
  console.log(name, JSON.stringify(result));
if (!origin.ok || !destination.ok || !origin.places.length || !destination.places.length) process.exit(1);
for (const mode of ["walk", "bicycle", "transit", "car"] as const) {
  const result = await getKakaoDirections({ origin: origin.places[0], destination: destination.places[0], mode });
  console.log(mode, JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
