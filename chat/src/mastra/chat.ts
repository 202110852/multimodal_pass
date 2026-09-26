import { registerApiRoute } from "@mastra/core/server";
import type { PoolClient } from "pg";
import { isDbEnabled, pool } from "./db.js";
import { memorySchema, readable } from "./messages.js";

/**
 * 질문 수정 후 재전송 — 서버 기억을 수정 지점에 맞춘다.
 *
 *   POST /chat/threads/:threadId/truncate  { index, text }
 *     수정 지점부터 뒤를 지운다. 채팅 화면은 이 방식을 쓴다 (고치면 지우고 새로 받는다).
 *
 *   POST /chat/threads/:threadId/fork      { index, text, newThreadId }
 *     수정 지점 앞까지를 새 스레드로 복사하고 원래 스레드는 둔다.
 *     수정 전/후 버전을 오가던 화면(2026-09-17 한때)이 썼다. 그때 열어 둔 화면을 위해 남겨 둔다.
 *
 *     index  화면에서 몇 번째(0부터) 사용자 질문인지
 *     text   그 질문의 원래 글 (서버 기록과 맞는지 확인용)
 *
 * 화면과 서버의 질문 수가 어긋날 수 있다 (서버에 닿기 전에 실패한 질문 등).
 * 그래서 index 번째 질문의 글이 맞는지 보고, 아니면 같은 글의 마지막 질문을 찾는다.
 * 둘 다 없으면 409 — 어디서 가를지 모르면 손대지 않는다.
 *
 * 공개 web 키로 열리는 API 다. 내용은 돌려주지 않고, 브라우저 채팅(resource=web)
 * 스레드만 다룬다. 스레드 id 를 아는 사람(그 브라우저)만 부를 수 있다.
 */

const RESOURCE = "web";
const THREAD_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Mastra 는 "createdAt"·"updatedAt"(시간대 없는 칸)에 UTC 시각을 넣는다.
 * now() 를 그대로 넣으면 서버 시간대(KST)로 들어가 9시간 어긋난다.
 */
const UTC_NOW = "(now() AT TIME ZONE 'UTC')";

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

type Found =
  | { kind: "no_thread" }
  | { kind: "forbidden" }
  | { kind: "no_messages" }
  | { kind: "not_found" }
  | { kind: "ok"; ids: string[]; pos: number };

/** 스레드를 잠그고, 수정할 질문의 위치(ids[pos] 부터가 그 질문과 뒤)를 찾는다. */
async function locate(client: PoolClient, schema: string, threadId: string, index: number, text: string): Promise<Found> {
  const thread = await client.query<{ resourceId: string }>(
    `SELECT "resourceId" FROM ${schema}.mastra_threads WHERE id = $1 FOR UPDATE`,
    [threadId],
  );
  if (thread.rowCount === 0) return { kind: "no_thread" };
  if (thread.rows[0].resourceId !== RESOURCE) return { kind: "forbidden" };

  const { rows } = await client.query<{ id: string; role: string; content: string }>(
    `SELECT id, role, content FROM ${schema}.mastra_messages
      WHERE thread_id = $1 ORDER BY "createdAt", id`,
    [threadId],
  );
  const users = rows.map((r, i) => ({ ...r, pos: i })).filter((r) => r.role === "user");
  if (users.length === 0) return { kind: "no_messages" };
  const byIndex = users[index];
  const target =
    byIndex && same(readable(byIndex.content).text, text)
      ? byIndex
      : [...users].reverse().find((u) => same(readable(u.content).text, text));
  if (!target) return { kind: "not_found" };
  return { kind: "ok", ids: rows.map((r) => r.id), pos: target.pos };
}

function validBody(threadId: string, body: { index?: unknown; text?: unknown } | null): body is { index: number; text: string } {
  return (
    THREAD_ID.test(threadId) &&
    Number.isInteger(body?.index) &&
    (body!.index as number) >= 0 &&
    typeof body?.text === "string"
  );
}

export const chatRoutes = [
  registerApiRoute("/chat/threads/:threadId/fork", {
    method: "POST",
    handler: async (c) => {
      const threadId = c.req.param("threadId");
      const body = await c.req.json().catch(() => null);
      const newThreadId = body?.newThreadId;
      if (!validBody(threadId, body) || typeof newThreadId !== "string" || !THREAD_ID.test(newThreadId) || newThreadId === threadId) {
        return c.json({ error: "invalid_body" }, 400);
      }

      // LibSQL 메모리 모드 — 이 API 는 Postgres mastra 스키마 SQL 이라 no-op.
      if (!isDbEnabled() || !pool) return c.json({ copied: 0, skipped: true, reason: "db_disabled" });

      const schema = memorySchema();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const exists = await client.query(`SELECT 1 FROM ${schema}.mastra_threads WHERE id = $1`, [newThreadId]);
        if (exists.rowCount) {
          await client.query("ROLLBACK");
          return c.json({ error: "thread_exists" }, 409);
        }

        const found = await locate(client, schema, threadId, body.index, body.text);
        if (found.kind === "forbidden") {
          await client.query("ROLLBACK");
          return c.json({ error: "not_found" }, 404);
        }
        if (found.kind === "not_found") {
          await client.query("ROLLBACK");
          return c.json({ error: "not_found_in_thread" }, 409);
        }
        // 원래 대화가 서버에 없거나 비어 있으면 복사할 것이 없다. 새 스레드는 첫 질문 때 생긴다.
        if (found.kind !== "ok" || found.pos === 0) {
          await client.query("COMMIT");
          return c.json({ copied: 0 });
        }

        await client.query(
          `INSERT INTO ${schema}.mastra_threads
             (id, "resourceId", title, metadata, "createdAt", "updatedAt", "createdAtZ", "updatedAtZ")
           SELECT $2, "resourceId", title, metadata, ${UTC_NOW}, ${UTC_NOW}, now(), now()
             FROM ${schema}.mastra_threads WHERE id = $1`,
          [threadId, newThreadId],
        );
        // 순서를 지키려고 시각을 그대로 옮긴다. 메시지 id 는 테이블 전체에서 유일해야 해서 새로 만든다.
        const copy = await client.query(
          `INSERT INTO ${schema}.mastra_messages
             (id, thread_id, content, role, type, "createdAt", "resourceId", "createdAtZ")
           SELECT gen_random_uuid()::text, $2, content, role, type, "createdAt", "resourceId", "createdAtZ"
             FROM ${schema}.mastra_messages
            WHERE id = ANY($1::text[])`,
          [found.ids.slice(0, found.pos), newThreadId],
        );
        await client.query("COMMIT");
        return c.json({ copied: copy.rowCount });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        return c.json({ error: "fork_failed", detail: (e as Error).message }, 500);
      } finally {
        client.release();
      }
    },
  }),

  registerApiRoute("/chat/threads/:threadId/truncate", {
    method: "POST",
    handler: async (c) => {
      const threadId = c.req.param("threadId");
      const body = await c.req.json().catch(() => null);
      if (!validBody(threadId, body)) return c.json({ error: "invalid_body" }, 400);

      // LibSQL 메모리 모드 — 화면 쪽 truncate 는 이미 했고, 서버 PG SQL 은 no-op.
      if (!isDbEnabled() || !pool) return c.json({ deleted: 0, skipped: true, reason: "db_disabled" });

      const schema = memorySchema();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await locate(client, schema, threadId, body.index, body.text);
        if (found.kind === "forbidden") {
          await client.query("ROLLBACK");
          return c.json({ error: "not_found" }, 404);
        }
        if (found.kind === "not_found") {
          await client.query("ROLLBACK");
          return c.json({ error: "not_found_in_thread" }, 409);
        }
        // 서버에 아직 없거나 빈 대화는 지울 것이 없다.
        if (found.kind !== "ok") {
          await client.query("COMMIT");
          return c.json({ deleted: 0 });
        }

        const ids = found.ids.slice(found.pos);
        await client.query(`DELETE FROM ${schema}.mastra_messages WHERE id = ANY($1::text[])`, [ids]);
        await client.query(
          `UPDATE ${schema}.mastra_threads SET "updatedAt" = ${UTC_NOW}, "updatedAtZ" = now() WHERE id = $1`,
          [threadId],
        );
        await client.query("COMMIT");
        return c.json({ deleted: ids.length });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        return c.json({ error: "truncate_failed", detail: (e as Error).message }, 500);
      } finally {
        client.release();
      }
    },
  }),
];
