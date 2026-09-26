import { registerApiRoute } from "@mastra/core/server";
import { isDbEnabled, query } from "./db.js";

/**
 * 버그 리포트 — 화면 어디서든 우클릭 → 버그 리포트 (web/src/debug/).
 *
 *   POST   /chat/bug-reports                   { note?, pageUrl, userAgent?, context, screenshot? }
 *     공개 web 키로 받는다 (관리자 화면도 같은 키로 보낸다). 요청 수는 nginx 가 묶는다.
 *
 *   GET    /admin/bug-reports?status=new       목록 (캡처·전체 정보는 빼고)
 *   GET    /admin/bug-reports/:id              전체 정보
 *   GET    /admin/bug-reports/:id/screenshot   캡처 (image/jpeg)
 *   PATCH  /admin/bug-reports/:id              { status }
 *   DELETE /admin/bug-reports/:id
 *
 * 브라우저가 비밀값을 빼고 보내지만, 이름이 비밀처럼 보이는 값은 서버에서도 한 번 더 가린다.
 */

const STATUSES = ["new", "checked", "fixed", "rejected"] as const;
type Status = (typeof STATUSES)[number];
const isStatus = (v: unknown): v is Status => STATUSES.includes(v as Status);

const MAX_NOTE = 2000;
const MAX_URL = 2000;
const MAX_CONTEXT = 1_000_000; // JSON 문자 수
const MAX_SHOT = 3 * 1024 * 1024; // 디코딩한 바이트
const LIMIT = 200;
const SECRET_KEY = /token|password|passwd|secret|api[-_]?key|authorization|cookie/i;
const SHOT = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/;

/** 이름이 비밀처럼 보이는 값을 가린다. 깊이·개수를 묶어 이상한 입력에 버틴다. */
function scrub(v: unknown, depth = 0): unknown {
  if (depth > 12) return "[깊이 초과]";
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, 500)) {
      out[k] = SECRET_KEY.test(k) && x != null && x !== "" ? "[가림]" : scrub(x, depth + 1);
    }
    return out;
  }
  return v;
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : null);

export const bugRoutes = [
  registerApiRoute("/chat/bug-reports", {
    method: "POST",
    handler: async (c) => {
      const b = await c.req.json().catch(() => null);
      if (!b || typeof b.pageUrl !== "string" || !b.context || typeof b.context !== "object") {
        return c.json({ error: "invalid_body" }, 400);
      }
      const context = scrub(b.context);
      const json = JSON.stringify(context);
      if (json.length > MAX_CONTEXT) return c.json({ error: "context_too_large" }, 413);

      let shot: Buffer | null = null;
      if (b.screenshot != null) {
        const m = typeof b.screenshot === "string" ? SHOT.exec(b.screenshot) : null;
        if (!m) return c.json({ error: "invalid_screenshot" }, 400);
        shot = Buffer.from(m[2], "base64");
        if (shot.length > MAX_SHOT) return c.json({ error: "screenshot_too_large" }, 413);
      }

      const ip = (c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0] ?? "").trim() || null;
      if (!isDbEnabled()) {
        return c.json({ ok: true, bugId: null, skipped: true, reason: "db_disabled" });
      }
      const [row] = await query<{ bug_id: number }>(
        `INSERT INTO bug_report (note, page_url, user_agent, context, screenshot, client_ip)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING bug_id`,
        [
          clip(b.note, MAX_NOTE)?.trim() || null,
          clip(b.pageUrl, MAX_URL),
          clip(b.userAgent, 1000),
          json,
          shot,
          ip,
        ],
      );
      if (!row) return c.json({ error: "insert_failed" }, 500);
      return c.json({ ok: true, bugId: row.bug_id });
    },
  }),

  registerApiRoute("/admin/bug-reports", {
    method: "GET",
    handler: async (c) => {
      const status = c.req.query("status");
      if (status && !isStatus(status)) return c.json({ error: "invalid_status", allowed: STATUSES }, 400);
      if (!isDbEnabled()) {
        return c.json({
          items: [],
          counts: Object.fromEntries(STATUSES.map((s) => [s, 0])),
          limit: LIMIT,
          skipped: true,
          reason: "db_disabled",
        });
      }
      const [items, counts] = await Promise.all([
        query(
          `SELECT bug_id, note, page_url, user_agent, status, created_at,
                  screenshot IS NOT NULL AS has_screenshot,
                  coalesce(octet_length(screenshot), 0) AS screenshot_bytes,
                  context->'app'->>'screen' AS screen,
                  jsonb_array_length(coalesce(context->'console', '[]'::jsonb)) AS console_count,
                  (SELECT count(*)::int FROM jsonb_array_elements(coalesce(context->'console', '[]'::jsonb)) e
                    WHERE e->>'level' = 'error') AS error_count
             FROM bug_report
            WHERE ($1::text IS NULL OR status = $1)
            ORDER BY created_at DESC
            LIMIT ${LIMIT}`,
          [status ?? null],
        ),
        query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM bug_report GROUP BY status"),
      ]);
      return c.json({
        items,
        counts: Object.fromEntries(STATUSES.map((s) => [s, counts.find((r) => r.status === s)?.n ?? 0])),
        limit: LIMIT,
      });
    },
  }),

  registerApiRoute("/admin/bug-reports/:id", {
    method: "GET",
    handler: async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
      if (!isDbEnabled()) return c.json({ error: "not_found", reason: "db_disabled" }, 404);
      const [row] = await query(
        `SELECT bug_id, note, page_url, user_agent, context, status, client_ip, created_at,
                screenshot IS NOT NULL AS has_screenshot
           FROM bug_report WHERE bug_id = $1`,
        [id],
      );
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json(row);
    },
  }),

  registerApiRoute("/admin/bug-reports/:id/screenshot", {
    method: "GET",
    handler: async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
      if (!isDbEnabled()) return c.json({ error: "not_found", reason: "db_disabled" }, 404);
      const [row] = await query<{ screenshot: Buffer | null }>(
        "SELECT screenshot FROM bug_report WHERE bug_id = $1",
        [id],
      );
      if (!row?.screenshot) return c.json({ error: "not_found" }, 404);
      const png = row.screenshot[0] === 0x89;
      return c.body(new Uint8Array(row.screenshot), 200, {
        "Content-Type": png ? "image/png" : "image/jpeg",
        "Cache-Control": "private, no-store",
      });
    },
  }),

  registerApiRoute("/admin/bug-reports/:id", {
    method: "PATCH",
    handler: async (c) => {
      const id = Number(c.req.param("id"));
      const body = await c.req.json().catch(() => null);
      if (!Number.isInteger(id) || !isStatus(body?.status)) {
        return c.json({ error: "invalid_body", allowed: STATUSES }, 400);
      }
      if (!isDbEnabled()) return c.json({ error: "not_found", reason: "db_disabled" }, 404);
      const [row] = await query(
        "UPDATE bug_report SET status = $2 WHERE bug_id = $1 RETURNING bug_id, status",
        [id, body.status],
      );
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json(row);
    },
  }),

  registerApiRoute("/admin/bug-reports/:id", {
    method: "DELETE",
    handler: async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
      if (!isDbEnabled()) return c.json({ error: "not_found", reason: "db_disabled" }, 404);
      const rows = await query("DELETE FROM bug_report WHERE bug_id = $1 RETURNING bug_id", [id]);
      if (!rows.length) return c.json({ error: "not_found" }, 404);
      return c.json({ ok: true });
    },
  }),
];
