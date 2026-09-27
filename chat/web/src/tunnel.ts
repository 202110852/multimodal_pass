/**
 * ngrok 무료 도메인은 브라우저 요청에 경고 페이지(HTML)를 끼워 넣는다. 이 헤더가 있으면 건너뛴다.
 * 다른 서버로는 보내지 않는다 — 커스텀 헤더라 상대 서버가 CORS 허용 헤더에 넣어 두지 않았으면 막힌다.
 */
const NGROK_HOST = /\.ngrok(-free)?\.(app|dev)$/;

function apiHostname(): string {
  const base = import.meta.env.VITE_MASTRA_URL || window.location.origin;
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
}

export const TUNNEL_HEADERS: Record<string, string> = NGROK_HOST.test(apiHostname())
  ? { "ngrok-skip-browser-warning": "true" }
  : {};
