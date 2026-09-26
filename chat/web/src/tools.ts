import type { UiCopy } from "./copy.js";

/**
 * 대화 모드 (chatbot_기획.md §3). 사용자가 고르지 않고, 그 턴에 쓰인 tool 로 드러난다.
 * 한 턴에 여러 tool 이 돌면 뒤쪽(제보 > 길찾기 > FAQ > 후보) 이 그 턴의 목적이다.
 */
export type Mode = "candidate" | "route" | "faq" | "report";

const MODE_OF: Record<string, Mode> = {
  "kakao-directions": "route",
  kakaoDirections: "route",
  "compare-directions": "route",
  compareDirections: "route",
  "report-issue": "report",
  reportIssue: "report",
  "plan-visit-order": "route",
  planVisitOrder: "route",
  "search-faq": "faq",
  searchFaq: "faq",
};

const RANK: Mode[] = ["candidate", "faq", "route", "report"];

/** tool 진행 상황을 현재 UI 언어로. */
export function toolLabel(name: string | undefined, tool: UiCopy["tool"]): string {
  if (!name) return tool.thinking;
  return tool.labels[name] ?? tool.running(name);
}

/** tool 이름들로 그 턴의 모드를 정한다. tool 을 안 썼으면 null (라벨 없음). */
export function modeOf(tools: string[]): Mode | null {
  if (!tools.length) return null;
  return tools
    .map((t) => MODE_OF[t] ?? "candidate")
    .reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a));
}
