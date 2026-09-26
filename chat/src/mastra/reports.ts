import { registerApiRoute } from "@mastra/core/server";
import { isDbEnabled, query } from "./db.js";
import { memorySchema, readable } from "./messages.js";

/**
 * /admin 의 제보 목록 API. 인증(ADMIN_TOKEN)은 auth.ts 의 apiGuard 가 /admin/ 전체에 건다.
 *
 *   GET   /admin/reports?status=new     목록 (status 생략 시 전체)
 *   PATCH /admin/reports/:id            { status } — 처리 상태 변경
 *   GET   /admin/reports/:id/thread     제보가 나온 대화 (report-issue 의 detail 은 모델 요약이라
 *                                        원래 대화를 봐야 판단할 수 있다)
 */

export const REPORT_STATUSES = ["new", "checked", "fixed", "rejected"] as const;
type Status = (typeof REPORT_STATUSES)[number];
const isStatus = (v: unknown): v is Status => REPORT_STATUSES.includes(v as Status);

const LIMIT = 200;

export const reportRoutes = [
  registerApiRoute("/admin/reports", {
    method: "GET",
    handler: async (c) => {
      const status = c.req.query("status");
      if (status && !isStatus(status)) {
        return c.json({ error: "invalid_status", allowed: REPORT_STATUSES }, 400);
      }
      if (!isDbEnabled()) {
        return c.json({
          reports: [],
          counts: Object.fromEntries(REPORT_STATUSES.map((s) => [s, 0])),
          limit: LIMIT,
          skipped: true,
          reason: "db_disabled",
        });
      }
      const [reports, counts] = await Promise.all([
        query(
          `SELECT report_id, poi_id, place_name, place_addr, issue_type, detail,
                  thread_id, status, created_at
             FROM place_report
            WHERE ($1::text IS NULL OR status = $1)
            ORDER BY created_at DESC
            LIMIT ${LIMIT}`,
          [status ?? null],
        ),
        query<{ status: string; n: number }>(
          "SELECT status, count(*)::int AS n FROM place_report GROUP BY status",
        ),
      ]);
      return c.json({
        reports,
        counts: Object.fromEntries(REPORT_STATUSES.map((s) => [s, counts.find((r) => r.status === s)?.n ?? 0])),
        limit: LIMIT,
      });
    },
  }),

  registerApiRoute("/admin/reports/:id", {
    method: "PATCH",
    handler: async (c) => {
      const id = Number(c.req.param("id"));
      const body = await c.req.json().catch(() => null);
      if (!Number.isInteger(id) || !isStatus(body?.status)) {
        return c.json({ error: "invalid_body", allowed: REPORT_STATUSES }, 400);
      }
      if (!isDbEnabled()) return c.json({ error: "not_found", reason: "db_disabled" }, 404);
      const [row] = await query(
        "UPDATE place_report SET status = $2 WHERE report_id = $1 RETURNING report_id, status",
        [id, body.status],
      );
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json(row);
    },
  }),

  registerApiRoute("/admin/reports/:id/thread", {
    method: "GET",
    handler: async (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
      if (!isDbEnabled()) return c.json({ messages: [], skipped: true, reason: "db_disabled" });
      const [report] = await query<{ thread_id: string | null }>(
        "SELECT thread_id FROM place_report WHERE report_id = $1",
        [id],
      );
      if (!report) return c.json({ error: "not_found" }, 404);
      if (!report.thread_id) return c.json({ messages: [] });

      const rows = await query<{ role: string; content: string; created_at: string }>(
        `SELECT role, content, "createdAtZ" AS created_at
           FROM ${memorySchema()}.mastra_messages
          WHERE thread_id = $1
          ORDER BY "createdAt"`,
        [report.thread_id],
      );
      const messages = rows
        .map((r) => ({ role: r.role, created_at: r.created_at, ...readable(r.content) }))
        .filter((m) => m.text || m.tools.length || m.images);
      return c.json({ messages });
    },
  }),
];
