import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEnvFiles } from "../src/mastra/env.js";
import { searchKakaoPlaces, kakaoSearchInput } from "../src/mastra/tools/kakaoSearchPlaces.js";
import { getKakaoDirections, kakaoDirectionsInput } from "../src/mastra/tools/kakaoDirections.js";

const origin = { name: "출발", lat: 33.51, lon: 126.52 };
const destination = { name: "도착", lat: 33.52, lon: 126.53 };
loadEnvFiles();
test("카카오 입력·API 계약·오류 처리", async (t) => {
  const originalFetch = globalThis.fetch;
  const saved = [process.env.KAKAO_REST_API_KEY, process.env.KAKAO_MOBILITY_REST_API_KEY];
  process.env.KAKAO_REST_API_KEY = "test-only-map-key";
  process.env.KAKAO_MOBILITY_REST_API_KEY = "test-only-car-key";
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [i, key] of ["KAKAO_REST_API_KEY", "KAKAO_MOBILITY_REST_API_KEY"].entries()) {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    }
  });
  await t.test("잘못된 검색·좌표 입력 거절", () => {
    for (const input of [{}, { query: "제주", lat: 33 }, { query: "제주", sort: "distance" }, { category: "CE7" }, { query: "제주", limit: 16 }])
      assert.equal(kakaoSearchInput.safeParse(input).success, false);
    assert.equal(kakaoDirectionsInput.safeParse({ origin: { ...origin, lat: 91 }, destination, mode: "car" }).success, false);
  });
  await t.test("카테고리 검색의 좌표 순서 및 빈 결과", async () => {
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      assert.equal(u.pathname, "/v2/local/search/category.json");
      assert.equal(u.searchParams.get("x"), "126.52");
      assert.equal(u.searchParams.get("y"), "33.51");
      assert.equal((init?.headers as Record<string, string>).Authorization, "KakaoAK test-only-map-key");
      return Response.json({ meta: { total_count: 0, is_end: true }, documents: [] });
    };
    const result = await searchKakaoPlaces({ category: "CE7", lat: origin.lat, lon: origin.lon, radius_m: 500 });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.places, []);
  });
  await t.test("자동차의 키·좌표·시간·요금", async () => {
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      assert.equal(u.hostname, "apis-navi.kakaomobility.com");
      assert.equal(u.searchParams.get("origin"), "126.52,33.51");
      assert.equal((init?.headers as Record<string, string>).Authorization, "KakaoAK test-only-car-key");
      return Response.json({ routes: [{ result_code: 0, summary: { distance: 1000, duration: 121, fare: { taxi: 4300, toll: 0 } } }] });
    };
    const result = await getKakaoDirections({ origin, destination, mode: "car" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.routes[0].duration_minutes, 3);
  });
  await t.test("실패 응답에 비밀·가짜 경로가 포함되지 않음", async () => {
    for (const status of [401, 403, 429, 500]) {
      globalThis.fetch = async () => new Response("secret-upstream-body", { status });
      const result = await getKakaoDirections({ origin, destination, mode: "walk" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, `HTTP_${status}`);
      assert.equal(JSON.stringify(result).includes("secret"), false);
      assert.equal("routes" in result, false);
    }
    globalThis.fetch = async () => { throw new Error("secret-network-error"); };
    const network = await searchKakaoPlaces({ query: "제주" });
    assert.equal(network.ok, false);
    if (!network.ok) assert.equal(network.error.code, "NETWORK_ERROR");
    globalThis.fetch = async () => Response.json({ status: "NO_RESULTS" });
    const missing = await getKakaoDirections({ origin, destination, mode: "transit" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "NO_ROUTE");
    globalThis.fetch = async () => Response.json({ status: "OK", route: { properties: { totalTime: "bad" } } });
    const invalid = await getKakaoDirections({ origin, destination, mode: "walk" });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.code, "INVALID_RESPONSE");
    delete process.env.KAKAO_REST_API_KEY;
    delete process.env.KAKAO_MOBILITY_REST_API_KEY;
    const noKey = await searchKakaoPlaces({ query: "제주" });
    assert.equal(noKey.ok, false);
    if (!noKey.ok) assert.equal(noKey.error.code, "MISSING_KEY");
  });
});
