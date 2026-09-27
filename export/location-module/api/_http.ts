/**
 * /api 서버리스 함수 공용 전처리.
 *
 * 프록시가 서버에 보관된 네이버·카카오 키로 대신 호출하므로, 다른 웹사이트가
 * 이 프록시를 공짜 게이트웨이로 쓰지 못하게 Origin/Referer를 검사한다.
 * (curl 등 직접 호출까지 막으려면 별도 레이트리밋이 필요하다)
 */

export type ApiRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
};

export type ApiResponse = {
  setHeader: (key: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
    send: (body: string) => void;
  };
};

function headerValue(req: ApiRequest, name: string): string | undefined {
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? String(value) : undefined;
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** 요청이 도달한 자기 자신의 출처. 도메인이 무엇이든 동일 출처 요청은 통과시킨다. */
function selfOrigin(req: ApiRequest): string | undefined {
  const host = headerValue(req, "x-forwarded-host") ?? headerValue(req, "host");
  if (!host) return undefined;
  const proto = headerValue(req, "x-forwarded-proto") ?? "https";
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

function getAllowedOrigins(req: ApiRequest): string[] {
  const origins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const own = selfOrigin(req);
  if (own) origins.push(own);

  if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  if (process.env.VERCEL_ENV !== "production") {
    origins.push(
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
    );
  }

  return origins;
}

/**
 * 동일 출처 GET에는 브라우저가 Origin을 보내지 않으므로 Origin이 "있을 때만" 검증하고,
 * 없으면 Referer로 타 사이트 임베드 여부를 확인한다.
 */
function applyCors(req: ApiRequest, res: ApiResponse): boolean {
  const allowed = getAllowedOrigins(req);

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const origin = headerValue(req, "origin");
  if (origin) {
    if (!allowed.includes(origin)) return false;
    res.setHeader("Access-Control-Allow-Origin", origin);
    return true;
  }

  const referer = headerValue(req, "referer");
  const refererOrigin = referer ? safeOrigin(referer) : undefined;
  return !refererOrigin || allowed.includes(refererOrigin);
}

/** false를 반환하면 이미 응답을 보냈으므로 핸들러는 즉시 종료해야 한다. */
export function guardGetRequest(req: ApiRequest, res: ApiResponse): boolean {
  if (!applyCors(req, res)) {
    res.status(403).json({ error: "Forbidden origin" });
    return false;
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return false;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return false;
  }
  return true;
}

export function queryString(req: ApiRequest, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 2xx만 본문을 그대로 전달하고, 그 외에는 상태 코드만 유지한 표준 에러로 바꾼다
 * (업스트림 오류 본문에 계정·키 관련 정보가 섞여 나올 수 있다).
 */
export function sendUpstreamJson(res: ApiResponse, status: number, body: string) {
  res.setHeader("Content-Type", "application/json");
  if (status >= 200 && status < 300) {
    return res.status(status).send(body);
  }
  return res.status(status).json({ error: "Upstream request failed", upstreamStatus: status });
}
