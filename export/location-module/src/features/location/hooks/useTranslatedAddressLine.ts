import { useEffect, useState } from "react";
import { resolveSystemText, type LocationLocale } from "../strings";
import { normalizeKoreanText, peekCachedKoTranslation, translateKoText } from "../lib/koTranslate";

const KOREAN_LOCALITY_SUFFIX = /(동|읍|면)$/;

/** "제주시 일도일동 관덕로 1" → "제주시 일도일동" (헤더에는 동·읍·면까지만 표시) */
function trimAddressToLocality(address: string): string {
  const parts = address.trim().split(/\s+/);
  const localityIndex = parts.findIndex((part) => KOREAN_LOCALITY_SUFFIX.test(part));
  if (localityIndex === -1) return address;
  return parts.slice(0, localityIndex + 1).join(" ");
}

/** 헤더 주소 한 줄: 고정 문구는 언어별 사전, 실제 주소는 동·읍·면까지 잘라 기계번역 */
export function useTranslatedAddressLine(address: string, locale: LocationLocale): string {
  const systemText = resolveSystemText(locale, address);
  const source = systemText ?? normalizeKoreanText(trimAddressToLocality(address));

  const [translated, setTranslated] = useState(
    () => systemText ?? peekCachedKoTranslation(source, locale) ?? source,
  );

  useEffect(() => {
    if (systemText !== null || locale === "ko") {
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
  }, [source, locale, systemText]);

  return translated;
}
