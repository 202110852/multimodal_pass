import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 음성 입력 — 브라우저 내장 음성인식(Web Speech API).
 *
 * 서버에서 받아쓸 모델이 아직 없다 (OmniRoute 에 Whisper 인증 정보가 없다 — DEPLOY.md).
 * 크롬·엣지·사파리가 지원하고 파이어폭스는 없다. 없으면 마이크 버튼을 숨긴다.
 * 크롬은 음성을 구글 서버로 보내 인식한다 — 버튼 제목에 적어 둔다.
 *
 * 실시간 표시는 하지 않는다. 말을 마치면(또는 버튼을 다시 누르면) 인식된 글을
 * 입력창에 넣고, 사용자가 확인한 뒤 보낸다.
 */

interface RecognitionResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = () => ctor() !== null;

const ERRORS: Record<string, string> = {
  "not-allowed": "마이크 권한이 없습니다. 브라우저 주소창의 권한 설정에서 마이크를 허용해 주세요.",
  "service-not-allowed": "이 브라우저에서 음성인식을 쓸 수 없습니다.",
  "no-speech": "말소리가 들리지 않았습니다. 다시 눌러 말씀해 주세요.",
  "audio-capture": "마이크를 찾지 못했습니다.",
  network: "음성인식 서버에 닿지 못했습니다. 인터넷 연결을 확인해 주세요.",
  "language-not-supported": "한국어 음성인식을 지원하지 않는 브라우저입니다.",
};

export function useVoiceInput(onText: (text: string) => void, language?: string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const deliver = useRef(onText);
  deliver.current = onText;

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    // 채팅에서 선택한 언어를 우선한다. "ko" 처럼 지역이 없으면 ko-KR 로.
    const lang = language || navigator.language || "ko-KR";
    r.lang = /^ko(-|$)/i.test(lang) ? "ko-KR" : lang;
    r.continuous = true; // 말 사이에 잠깐 쉬어도 끊지 않는다 — 버튼으로 끝낸다
    r.interimResults = false;
    heard.current = "";
    setError(null);
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard.current += e.results[i][0].transcript;
      }
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? `음성인식 오류: ${e.error}`);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const text = heard.current.trim();
      if (text) deliver.current(text);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch (e) {
      rec.current = null;
      setError(`음성인식을 시작하지 못했습니다: ${(e as Error).message}`);
    }
  }, [language]);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { listening, error, start, stop, clearError: () => setError(null) };
}
