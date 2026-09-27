import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { chatModel } from "../model.js";
import { systemPrompt } from "../prompt.js";
import { searchPlaces } from "../tools/searchPlaces.js";
import { nearbyPlaces } from "../tools/nearbyPlaces.js";
import { placeDetail } from "../tools/placeDetail.js";
import { checkMetric } from "../tools/checkMetric.js";
import { getWeather } from "../tools/getWeather.js";
import { naverMapLink } from "../tools/naverMapLink.js";
import { reportIssue } from "../tools/reportIssue.js";
import { planVisitOrder } from "../tools/planVisitOrder.js";

import { kakaoSearchPlaces } from "../tools/kakaoSearchPlaces.js";
import { kakaoDirections } from "../tools/kakaoDirections.js";
import { compareDirections } from "../tools/compareDirections.js";

export const jejuAgent = new Agent({
  id: "jeju-agent",
  name: "제주 AI 여행 비서",
  // 프롬프트 본문은 prompts/system-prompt.txt — /admin 에서 수정한다. 매 요청마다 새로 읽는다.
  instructions: systemPrompt,
  model: chatModel,
  // 기본 maxSteps 는 5라 '검색 → 상세 → 근처 → 링크' 흐름이 중간에 끊긴다.
  // 복합 이동(주차·수단 비교·충전)까지 가려면 여유가 필요하다.
  defaultOptions: { maxSteps: 20 },
  // 모드(후보 선택·길찾기·오류 제보)는 대화 맥락으로 바뀐다 — 이전 턴이 보여야 한다.
  // 저장소는 Mastra 인스턴스의 storage(로컬 LibSQL 또는 Postgres)를 물려받는다.
  // 도구 결과도 기록에 들어가므로, 앞서 찾은 좌표·수단을 경로 비교에 다시 쓸 수 있다.
  memory: new Memory({ options: { lastMessages: 20 } }),
  tools: {
    searchPlaces,
    kakaoSearchPlaces,
    kakaoDirections,
    compareDirections,
    nearbyPlaces,
    placeDetail,
    checkMetric,
    getWeather,
    naverMapLink,
    reportIssue,
    planVisitOrder,
  },
});
