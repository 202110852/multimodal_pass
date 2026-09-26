import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

/**
 * 답변 속 사진은 DB 에 실제로 있는 이미지 호스트의 https 주소만 보여 준다.
 * 이미지는 열리는 순간 요청이 나가므로, 모델이 지어낸 주소나 DB 원문에 섞인
 * 추적용 이미지가 사용자 브라우저에서 요청되지 않게 한다.
 * 호스트 목록은 db-pg/05_chat.sql 의 v_poi_image 가 고르는 소스와 맞춘다.
 */
const IMAGE_HOSTS = [
  /^api\.cdn\.visitjeju\.net$/,
  /^tong\.visitkorea\.or\.kr$/,
  /^search\.pstatic\.net$/,
  /^pcmap\.place\.naver\.com$/,
  /^lh3\.googleusercontent\.com$/,
  /^[a-z0-9-]+\.ktcdn\.co\.kr$/,
  /^stan-[a-z0-9-]+\.s3\.ap-northeast-2\.amazonaws\.com$/,
];

function isAllowedImage(src: string | null): boolean {
  if (!src) return false;
  try {
    const u = new URL(src);
    return u.protocol === "https:" && IMAGE_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // 링크는 새 탭으로. 네이버지도 딥링크가 대부분이라 대화를 떠나지 않게 한다.
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    if (!isAllowedImage(node.getAttribute("src"))) {
      node.remove();
      return;
    }
    node.removeAttribute("srcset");
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
    // 네이버 이미지 서버는 외부 Referer 를 거절하기도 한다. 방문 페이지도 알릴 필요가 없다.
    node.setAttribute("referrerpolicy", "no-referrer");
    // 깨진 이미지는 App 의 error 캡처 리스너가 숨긴다 (onerror 속성은 sanitize 에서 빠진다)
    node.setAttribute("class", "photo");
  }
});

/**
 * GFM 은 물결표 하나짜리도 취소선으로 본다. 한국어 답변에는 범위 표기가 흔해서
 * ("24~28도", "09:00~18:00", "초속 7~8.5m") 멀리 떨어진 두 개가 짝지어져
 * 문장 한 덩어리가 취소선이 되어 버린다. 홀로 쓰인 물결표는 escape 한다.
 */
function escapeLoneTildes(src: string): string {
  return src.replace(/(?<!~)~(?!~)/g, "\\~");
}

/**
 * CommonMark 는 `**‘동문시장’**이라고` 처럼 닫는 ** 앞이 문장부호이고 뒤가 글자면
 * 강조로 치지 않는다 (영어 기준 규칙). 한국어 답변에서 흔해서 ** 가 그대로 보인다.
 * 한 줄 안의 **…** 는 직접 <strong> 으로 바꾼다. 코드 안은 건드리지 않는다.
 */
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;
function strongCjk(src: string): string {
  return src
    .split(CODE)
    .map((part, i) =>
      i % 2 ? part : part.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, "<strong>$1</strong>"),
    )
    .join("");
}

const prepare = (src: string) => strongCjk(escapeLoneTildes(src));

/**
 * 스트리밍 중에는 글자가 올 때마다 다시 그린다. 답변 전체를 innerHTML 로 갈아 끼우면
 * 이미 받은 사진까지 매번 새 요소가 되어 다시 불러오고 깜빡인다.
 * 최상위 블록(문단·목록·표 …)으로 나눠 두면 다 받은 블록의 문자열은 그대로라
 * React 가 건드리지 않고, 지금 받는 마지막 블록만 바뀐다.
 */
export function markdownBlocks(src: string): string[] {
  return marked
    .lexer(prepare(src))
    .filter((t) => t.type !== "space")
    .map((t) => DOMPurify.sanitize(marked.parser([t] as never, { async: false }) as string));
}

/** 에이전트 출력은 마크다운이다. DB 내용이 섞이므로 반드시 sanitize 한다. */
export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(
    marked.parse(prepare(src), { async: false }) as string,
  );
}

/** 검색·미리보기용 — 마크다운 기호를 걷어낸 글. 사진은 빼고 링크는 글자만 남긴다. */
export function plainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!~|])/g, "$1");
}
