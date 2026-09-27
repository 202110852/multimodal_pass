import { useEffect, useState } from "react";
import type { AppLocale } from "../locale.js";
import { normalizeKoreanText, peekCachedKoTranslation, translateKoText } from "./koTranslate.js";

/** 한국어 텍스트를 현재 언어로 기계번역해 보여준다. 번역 전·실패 시에는 원문. */
export function useTranslatedText(text: string, locale: AppLocale): string {
  const source = normalizeKoreanText(text);
  const [translated, setTranslated] = useState(() => peekCachedKoTranslation(source, locale) ?? source);

  useEffect(() => {
    if (locale === "ko") {
      setTranslated(source);
      return;
    }

    const cached = peekCachedKoTranslation(source, locale);
    if (cached) {
      setTranslated(cached);
      return;
    }

    setTranslated(source);
    let cancelled = false;
    translateKoText(source, locale).then((result) => {
      if (!cancelled) setTranslated(result);
    });
    return () => {
      cancelled = true;
    };
  }, [source, locale]);

  return translated;
}
