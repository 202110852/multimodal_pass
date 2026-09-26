import { registerApiRoute } from "@mastra/core/server";
import { isDbEnabled, query } from "./db.js";
import { memorySchema, readable } from "./messages.js";

/**
 * 답변 평가 (좋아요/싫어요).
 *
 *   POST /chat/feedback                 { threadId, messageKey, rating, reason?, question, answer }
 *     rating: "up" | "down" | null (null 이면 취소). 채팅 화면이 공개 web 키로 부른다.
 *     브라우저 채팅(resource=web) 스레드에 대해서만 받는다 — 아무 id 로 쌓이지 않게.
 *
 *   GET  /admin/feedback?rating=down    목록 (최근 200건) + 건수
 *   GET  /admin/threads/:threadId       평가가 나온 대화 (관리자)
 *
 * /admin/ 은 auth.ts 가 ADMIN_TOKEN 으로 막는다.
 */

const RESOURCE = "web";
const THREAD_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MESSAGE_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_TEXT = 4000;
const MAX_REASON = 500;
const LIMIT = 200;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const feedbackRoutes = [
  registerApiRoute("/chat/feedback", {
    method: "POST",
    handler: async (c) => {
      const b = await c.req.json().catch(() => null);
      const rating = b?.rating;
      if (
        !b ||
        typeof b.threadId !== "string" ||
        !THREAD_ID.test(b.threadId) ||
        typeof b.messageKey !== "string" ||
        !MESSAGE_KEY.test(b.messageKey) ||
        !(rating === "up" || rating === "down" || rating === null) ||
        (b.reason != null && typeof b.reason !== "string") ||
        (rating !== null && (typeof b.question !== "string" || typeof b.answer !== "string" || !b.answer.trim()))
      ) {
        return c.json({ error: "invalid_body" }, 400);
      }

      if (!isDbEnabled()) {
        return c.json({ ok: true, rating, skipped: true, reason: "db_disabled" });
      }

      const [thread] = await query<{ resourceId: string }>(
        `SELECT "resourceId" FROM ${memorySchema()}.mastra_threads WHERE id = $1`,
        [b.threadId],
      );
      if (!thread || thread.resourceId !== RESOURCE) return c.json({ error: "not_found" }, 404);

      if (rating === null) {
        await query("DELETE FROM answer_feedback WHERE thread_id = $1 AND message_key = $2", [
          b.threadId,
          b.messageKey,
        ]);
        return c.json({ ok: true, rating: null });
      }

      const reason = rating === "down" && b.reason?.trim() ? clip(b.reason.trim(), MAX_REASON) : null;
      await query(
        `INSERT INTO answer_feedback (thread_id, message_key, rating, reason, question, answer)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (thread_id, message_key) DO UPDATE
           SET rating = EXCLUDED.rating, reason = EXCLUDED.reason,
               question = EXCLUDED.question, answer = EXCLUDED.answer, updated_at = now()`,
        [
          b.threadId,
          b.messageKey,
          rating === "up" ? 1 : -1,
          reason,
          clip(b.question, MAX_TEXT),
          clip(b.answer, MAX_TEXT),
        ],
      );
      return c.json({ ok: true, rating });
    },
  }),

  registerApiRoute("/admin/feedback", {
    method: "GET",
    handler: async (c) => {
      const r = c.req.query("rating");
      if (r && r !== "up" && r !== "down") return c.json({ error: "invalid_rating" }, 400);
      if (!isDbEnabled()) {
        return c.json({ items: [], counts: { up: 0, down: 0 }, limit: LIMIT, skipped: true, reason: "db_disabled" });
      }
      const rating = r === "up" ? 1 : r === "down" ? -1 : null;
      const [items, counts] = await Promise.all([
        query(
          `SELECT feedback_id, thread_id, rating, reason, question, answer, updated_at
             FROM answer_feedback
            WHERE ($1::smallint IS NULL OR rating = $1)
            ORDER BY updated_at DESC
            LIMIT ${LIMIT}`,
          [rating],
        ),
        query<{ rating: number; n: number }>(
          "SELECT rating, count(*)::int AS n FROM answer_feedback GROUP BY rating",
        ),
      ]);
      return c.json({
        items,
        counts: {
          up: counts.find((x) => x.rating === 1)?.n ?? 0,
          down: counts.find((x) => x.rating === -1)?.n ?? 0,
        },
        limit: LIMIT,
      });
    },
  }),

  registerApiRoute("/admin/threads/:threadId", {
    method: "GET",
    handler: async (c) => {
      const threadId = c.req.param("threadId");
      if (!THREAD_ID.test(threadId)) return c.json({ error: "invalid_id" }, 400);
      if (!isDbEnabled()) return c.json({ messages: [], skipped: true, reason: "db_disabled" });
      const rows = await query<{ role: string; content: string; created_at: string }>(
        `SELECT role, content, "createdAtZ" AS created_at
           FROM ${memorySchema()}.mastra_messages
          WHERE thread_id = $1
          ORDER BY "createdAt"`,
        [threadId],
      );
      const messages = rows
        .map((r) => ({ role: r.role, created_at: r.created_at, ...readable(r.content) }))
        .filter((m) => m.text || m.tools.length || m.images);
      return c.json({ messages });
    },
  }),
];
