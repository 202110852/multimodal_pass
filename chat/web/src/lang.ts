/**
 * 질문 언어 판별 — 챗봇이 그 언어로 답하게 서버에 알려 준다 (requestContext.replyLang).
 *
 * 규칙만으로는 긴 한국어 시스템 프롬프트에 끌려 한국어로 답하는 일이 있어서
 * (일본어 질문에 한국어로 답함) 이번 질문의 언어를 따로 짚어 준다.
 * 글자 종류로만 본다 — 영어·스페인어 같은 라틴 문자 언어는 'latin' 하나로 묶고
 * 어느 언어인지는 모델이 질문을 보고 정한다.
 *
 * 섞인 질문은 단어 수로 가른다: "관덕정 parking 어디야?" → ko, "Where is 관덕정?" → latin.
 * 띄어쓰기가 없는 중국어·일본어는 글자 두 개를 한 단어로 센다.
 */
export type ReplyLang = "ko" | "ja" | "zh" | "latin";

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const KANA = /[぀-ヿ]/;
const HAN = /[一-鿿]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

export function detectLang(text: string): ReplyLang | null {
  let ko = 0;
  let latin = 0;
  let kana = 0;
  let han = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (KANA.test(word)) kana += Math.max(1, word.length / 2);
    else if (HANGUL.test(word)) ko += 1;
    else if (HAN.test(word)) han += Math.max(1, (word.match(new RegExp(HAN.source, "g"))?.length ?? 0) / 2);
    else if (LATIN.test(word)) latin += 1;
  }
  // 가나가 조금이라도 있으면 일본어 (일본어 문장은 한자가 섞인다)
  if (kana > 0 && kana + han >= ko && kana + han >= latin) return "ja";
  const best = Math.max(ko, latin, han);
  if (best === 0) return null;
  if (ko === best) return "ko";
  if (han === best) return "zh";
  return "latin";
}
