/**
 * 답변 본문과 추천 질문을 나눈다.
 *
 * 에이전트는 답변 맨 끝에 아래 블록을 붙인다 (chat/src/mastra/format.ts 의 FORMAT_RULES).
 *
 *   [추천질문]
 *   - 질문
 *   - 질문
 *
 * 스트리밍 중에는 표식이 반쯤만 와 있을 수 있다("[추천"). 본문 마지막 줄이 표식의
 * 앞부분이면 숨긴다 — 그러지 않으면 한 순간 글자가 비쳤다 사라진다.
 * 모델이 형식을 안 지키면 추천 질문이 없을 뿐 본문은 그대로 보인다.
 *
 * 모델이 규칙을 어겨 넣은 poi_id 등 내부 표기는 stripInternalIds 로 화면에서 뺀다.
 */
export const FOLLOWUP_MARK = "[추천질문]";

const MAX_FOLLOWUPS = 3;
const MAX_LEN = 90; // 영어 등은 한국어보다 길다

/** 사용자에게 보이면 안 되는 내부 ID 표기. report_id(제보 번호)는 남긴다. */
const INTERNAL_ID =
  /\(\s*(?:poi_id|kakao_id|faq_id|canonical_poi_id)\s*[:=]\s*[\w-]+\s*\)?|\b(?:poi_id|kakao_id|faq_id|canonical_poi_id)\s*[:=]\s*[\w-]+/gi;
/** 스트리밍 중 아직 숫자가 덜 온 꼬리 — 잠깐 비치지 않게 */
const INTERNAL_ID_TAIL =
  /\(?\s*(?:poi_id|kakao_id|faq_id|canonical_poi_id)\s*[:=]?\s*[\w-]*\s*$/i;

export function stripInternalIds(text: string): string {
  return text
    .replace(INTERNAL_ID, "")
    .replace(INTERNAL_ID_TAIL, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(\S) ([을를이가은는도만])(?=\s|$|[.,!?，。])/g, "$1$2")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,，.。])/g, "$1");
}

export interface Answer {
  body: string;
  followups: string[];
}

export function splitAnswer(text: string): Answer {
  const at = text.lastIndexOf(FOLLOWUP_MARK);
  if (at >= 0 && (at === 0 || text[at - 1] === "\n")) {
    const followups = text
      .slice(at + FOLLOWUP_MARK.length)
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["'“”]|["'“”]$/g, "").trim())
      .map(stripInternalIds)
      .map((l) => l.trim())
      .filter((l) => l && l.length <= MAX_LEN)
      .slice(0, MAX_FOLLOWUPS);
    return { body: stripInternalIds(text.slice(0, at)).trimEnd(), followups };
  }

  const lastBreak = text.lastIndexOf("\n");
  const tail = text.slice(lastBreak + 1).trim();
  if (tail && tail.length < FOLLOWUP_MARK.length && FOLLOWUP_MARK.startsWith(tail)) {
    return { body: stripInternalIds(text.slice(0, lastBreak + 1)).trimEnd(), followups: [] };
  }
  return { body: stripInternalIds(text), followups: [] };
}
