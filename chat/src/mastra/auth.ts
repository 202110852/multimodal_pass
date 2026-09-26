import { timingSafeEqual } from "node:crypto";
import type { Middleware } from "@mastra/core/server";
import { loadEnvFiles } from "./env.js";

/** admin.ts 의 라우트 접두사. admin.ts 를 import 하면 라우트 등록까지 딸려 오므로 따로 둔다. */
const ADMIN_PREFIX = "/admin/";

/**
 * 관리자 토큰으로만 여는 Mastra 기본 API.
 * /api/memory 는 저장된 대화(스레드·메시지)를 그대로 돌려준다. 공개 web 키로 열어 두면
 * 남의 대화를 읽을 수 있다. 채팅 UI 는 agent.stream 만 쓰므로 막아도 지장이 없다.
 */
const ADMIN_ONLY_PREFIXES = [ADMIN_PREFIX, "/api/memory"];

/**
 * API 키 + Origin 게이트.
 *
 * 솔직한 전제: 프론트는 브라우저 SPA 라 번들에 들어간 키는 소스보기로 보인다.
 * 그래서 이 계층이 막아 주는 것은 '남의 서비스에서 우리 API 를 몰래 쓰는 것'과
 * '아무 생각 없이 긁는 스크립트' 까지다. 작정한 사람은 번들에서 키를 꺼낼 수 있다.
 *
 * 비용 상한을 실제로 잡아 주는 것은 nginx 의 요청 수 제한이다 (DEPLOY.md 참고).
 * 서버 간 호출용으로는 브라우저에 넣지 않은 별도 키를 발급해 쓴다.
 */

const PUBLIC_PATHS = new Set(["/health", "/api/health"]);

function keys(): string[] {
  loadEnvFiles();
  return (process.env.API_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function allowedOrigins(): string[] {
  loadEnvFiles();
  const extra = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ["https://stan.lkim.me", "http://localhost:5173", ...extra];
}

/** 길이를 먼저 비교하면 길이가 새므로, 해시 없이 쓰려면 길이 체크 후 고정시간 비교. */
function sameKey(given: string, known: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(known);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedKey(h: (n: string) => string | undefined): string | null {
  const direct = h("x-api-key");
  if (direct) return direct.trim();
  const auth = h("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export const apiGuard: Middleware = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // CORS 프리플라이트는 통과시켜야 한다. 여기서 막으면 브라우저가 본 요청을 아예 안 보낸다.
  if (c.req.method === "OPTIONS" || PUBLIC_PATHS.has(path)) return next();

  // 1) Origin 게이트 — 브라우저가 보낸 요청이면 허용 목록에 있어야 한다.
  //    (curl 처럼 Origin 이 없는 요청은 이 단계를 건너뛰고 키로만 판단한다.)
  const origin = c.req.header("origin");
  if (origin && !allowedOrigins().includes(origin)) {
    return c.json({ error: "origin_not_allowed", origin }, 403);
  }

  // 2) 관리자 API — 공개 web 키로는 열리지 않는다. 브라우저 번들에 없는 ADMIN_TOKEN 만 받는다.
  if (ADMIN_ONLY_PREFIXES.some((p) => path.startsWith(p))) {
    loadEnvFiles();
    const token = process.env.ADMIN_TOKEN?.trim();
    if (!token) {
      if (process.env.NODE_ENV === "production") {
        return c.json({ error: "admin_disabled: ADMIN_TOKEN 미설정" }, 503);
      }
      return next(); // 로컬 개발 편의
    }
    const given = c.req.header("x-admin-token")?.trim();
    if (!given || !sameKey(given, token)) {
      return c.json({ error: "admin_unauthorized" }, 401);
    }
    return next();
  }

  // 3) API 키
  const configured = keys();
  if (configured.length === 0) {
    if (process.env.NODE_ENV === "production") {
      // 운영에서 키가 비어 있으면 열어 두지 않는다.
      return c.json({ error: "server_misconfigured: API_KEYS 미설정" }, 500);
    }
    return next(); // 로컬 개발 편의
  }

  const given = presentedKey((n) => c.req.header(n));
  if (!given || !configured.some((k) => sameKey(given, k))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  return next();
};
