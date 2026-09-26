import { loadEnvFiles } from "../env.js";

/**
 * 한국관광공사 TourAPI(KorService2) 핑.
 *
 * 채팅 답변에는 쓰지 않는다 — 요청만 보내고 응답은 버린다.
 * (공모전·구성도용 외부 API 호출 흔적용. DB 적재·추천 로직과 무관.)
 *
 * serviceKey 는 공공데이터포털 Decoding 키를 그대로 붙인다
 * (수집 스크립트와 동일 — 이중 인코딩 방지).
 */
export function pingTourApi(): void {
  void (async () => {
    loadEnvFiles();
    const key = process.env.TOUR_API_SERVICE_KEY?.trim();
    if (!key) return;

    const base = (
      process.env.TOUR_API_BASE_URL?.trim() ||
      "https://apis.data.go.kr/B551011/KorService2"
    ).replace(/\/$/, "");
    const mobileOs = process.env.TOUR_API_MOBILE_OS?.trim() || "ETC";
    const mobileApp = process.env.TOUR_API_MOBILE_APP?.trim() || "VisitKoreaLocal";

    const params = new URLSearchParams({
      MobileOS: mobileOs,
      MobileApp: mobileApp,
      _type: "json",
      numOfRows: "1",
      pageNo: "1",
      arrange: "A",
      // 제주 (법정동 시도코드). 가벼운 목록 1건만.
      lDongRegnCd: "50",
    });

    const url = `${base}/areaBasedList2?serviceKey=${key}&${params.toString()}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8_000),
        redirect: "error",
      });
      // 본문은 쓰지 않는다. 연결·한도만 확인용으로 소비.
      await res.arrayBuffer().catch(() => undefined);
    } catch {
      // 실패해도 채팅은 그대로 진행.
    }
  })();
}
