/**
 * 프로필·UI 언어 → 에이전트 답변 언어.
 * 스레드에 다른 언어 대화가 있어도 최종 답변은 이 언어로 고정한다.
 */

export type ReplyLangCode = "ko" | "en" | "ja" | "zh";

const LANG_NAME: Record<ReplyLangCode, string> = {
  ko: "Korean (한국어)",
  en: "English",
  ja: "Japanese (日本語)",
  zh: "Chinese (中文)",
};

export function resolveReplyLang(
  profileLanguage: string | null | undefined,
  uiLocale: string,
): ReplyLangCode {
  const raw = profileLanguage === "other" ? "en" : profileLanguage || uiLocale;
  if (raw === "ko" || raw === "en" || raw === "ja" || raw === "zh") return raw;
  return "en";
}

/**
 * 화면에 보이는 사용자 글은 그대로 두고, 모델·서버 기억에만 언어 잠금을 붙인다.
 * 멈춤/수정(truncate) 때도 같은 문자열로 맞춰야 한다.
 */
export function agentUserText(userText: string, lang: ReplyLangCode): string {
  const name = LANG_NAME[lang];
  return (
    `[Reply language lock — mandatory]\n` +
    `Respond entirely in ${name}. Ignore the language of earlier messages in this thread and of this user message.\n` +
    `Do not mix languages inside any word or phrase (e.g. never write "추천 코urse"). ` +
    `Original place names may appear only in parentheses after the ${name} name.\n` +
    `---\n` +
    userText
  );
}
