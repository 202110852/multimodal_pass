import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

/**
 * /api 를 Mastra 서버로 프록시한다. 브라우저에는 같은 오리진이라 CORS 가 필요 없다.
 *
 * 기본 대상은 **배포된 챗봇 API** (`https://api.stan.lkim.me`) 다.
 * 시스템 프롬프트만 바꿔도 동작이 바뀌므로, 평소에는 원격 API 를 그대로 쓴다.
 *
 * 로컬 백엔드까지 띄울 때만 MASTRA_URL 로 가리킨다.
 *   MASTRA_URL=http://127.0.0.1:4111 npm run dev   # 또는 npm run dev:all
 *   MASTRA_URL=http://127.0.0.1:4470 npm run dev   # launchd 배포본
 */
const TARGET = process.env.MASTRA_URL ?? "https://api.stan.lkim.me";

const proxyOptions: ProxyOptions = {
  target: TARGET,
  changeOrigin: true,
  secure: true,
  configure(proxy) {
    // 프록시는 서버→서버 홉이다. 브라우저의 Origin 을 그대로 넘기면
    // 배포 nginx 의 Origin 허용목록(stan.lkim.me / localhost:5173)에 걸려
    // 포트가 다른 순간 403 이 난다. 떼고 보낸다 —
    // 인증은 x-api-key 가 담당하고, Origin 없는 요청은 게이트를 통과한다.
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.removeHeader("origin");
      proxyReq.removeHeader("referer");
    });

    // 기본 500 은 원인을 숨긴다. 무엇이 안 됐는지 그대로 돌려준다.
    proxy.on("error", (err, _req, res) => {
      const body = JSON.stringify({
        error: "proxy_unreachable",
        target: TARGET,
        detail: String((err as NodeJS.ErrnoException).code ?? err.message),
        hint:
          "챗봇 API 에 닿지 못했습니다. 배포 API 기본은 api.stan.lkim.me 입니다. " +
          "로컬 백엔드를 띄웠다면 MASTRA_URL=http://127.0.0.1:4111 을 지정하세요.",
      });
      const r = res as unknown as import("node:http").ServerResponse;
      if (!r.headersSent) r.writeHead(502, { "Content-Type": "application/json" });
      r.end(body);
    });
  },
};

/** 버그 리포트에 넣을 빌드 정보 */
function buildInfo() {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (dirty) commit += "-dirty";
  } catch {
    /* git 이 없는 곳에서 빌드 */
  }
  return { time: new Date().toISOString(), commit };
}

const WEB_ROOT = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 카카오맵 JavaScript 키. chat/web 의 env 파일에 있으면 그 값을, 없으면 저장소 루트 .env 값을 쓴다.
 * 루트 .env 에는 서버 비밀도 있어 envDir 을 통째로 옮기지 않고 이 키 하나만 가져온다.
 */
function kakaoAppKey(mode: string): string {
  const key = "VITE_KAKAO_APP_KEY";
  return loadEnv(mode, WEB_ROOT, key)[key] || loadEnv(mode, REPO_ROOT, key)[key] || "";
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __BUILD__: JSON.stringify(buildInfo()),
    "import.meta.env.VITE_KAKAO_APP_KEY": JSON.stringify(kakaoAppKey(mode)),
  },
  server: {
    port: 5173,
    // 같은 네트워크의 휴대폰에서도 접속할 수 있게 모든 인터페이스에서 받는다
    host: true,
    proxy: {
      "/api": proxyOptions,
      // 관리자 API. 키는 앞부분 일치라 "/admin/" 로 두면 SPA 경로 /admin/ 까지 넘어간다.
      "/admin/system-prompt": proxyOptions,
      "/admin/reports": proxyOptions,
      "/chat/threads": proxyOptions,
      "/chat/feedback": proxyOptions,
      "/chat/weather-suggestion": proxyOptions,
      "/admin/feedback": proxyOptions,
      "/admin/threads": proxyOptions,
      "/chat/bug-reports": proxyOptions,
      "/admin/bug-reports": proxyOptions,
    },
  },
}));
