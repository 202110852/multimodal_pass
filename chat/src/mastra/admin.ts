import { registerApiRoute } from "@mastra/core/server";
import { MAX_PROMPT_BYTES, readSystemPrompt, writeSystemPrompt } from "./prompt.js";

/**
 * /admin 페이지가 쓰는 API. 인증(ADMIN_TOKEN)은 auth.ts 의 apiGuard 가 먼저 처리한다.
 * Mastra 는 /api 접두사를 자체 라우트용으로 예약하므로 /admin 아래에 둔다.
 */
export const adminRoutes = [
  registerApiRoute("/admin/system-prompt", {
    method: "GET",
    handler: async (c) => {
      try {
        const { content, updatedAt } = await readSystemPrompt();
        return c.json({ content, updatedAt });
      } catch (e) {
        return c.json({ error: "read_failed", detail: (e as Error).message }, 500);
      }
    },
  }),

  registerApiRoute("/admin/system-prompt", {
    method: "PUT",
    handler: async (c) => {
      const body = await c.req.json().catch(() => null);
      const content = body?.content;
      if (typeof content !== "string" || !content.trim()) {
        return c.json({ error: "invalid_body", detail: "content 는 비어 있지 않은 문자열이어야 합니다." }, 400);
      }
      if (Buffer.byteLength(content, "utf8") > MAX_PROMPT_BYTES) {
        return c.json({ error: "too_large", detail: `최대 ${MAX_PROMPT_BYTES} 바이트` }, 413);
      }

      // 다른 탭에서 먼저 저장했는데 모르고 덮어쓰는 것을 막는다.
      const base = body?.baseUpdatedAt;
      if (typeof base === "string") {
        const current = await readSystemPrompt().catch(() => null);
        if (current && current.updatedAt !== base) {
          return c.json({ error: "conflict", updatedAt: current.updatedAt }, 409);
        }
      }

      try {
        const saved = await writeSystemPrompt(content);
        return c.json({ content: saved.content, updatedAt: saved.updatedAt });
      } catch (e) {
        return c.json({ error: "write_failed", detail: (e as Error).message }, 500);
      }
    },
  }),
];
