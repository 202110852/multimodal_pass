import { loadEnvFiles } from "./env.js";

/**
 * 에이전트 메모리(mastra 스키마)에 저장된 대화를 직접 다루는 도우미.
 * 제보 탭의 대화 보기(reports.ts)와 질문 수정 후 재전송(chat.ts)이 같이 쓴다.
 */

/** 에이전트 메모리 스키마 (index.ts 와 같은 값). SQL 에 직접 들어가므로 이름 형식을 확인한다. */
export function memorySchema(): string {
  loadEnvFiles();
  const s = process.env.MASTRA_PG_SCHEMA ?? "mastra";
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`MASTRA_PG_SCHEMA 형식 오류: ${s}`);
  return s;
}

interface StoredPart {
  type?: string;
  text?: string;
  mimeType?: string;
  toolInvocation?: { toolName?: string };
  toolName?: string;
}

/**
 * 저장된 메시지(format 2)에서 사람이 읽을 부분만 뽑는다. 형식이 달라도 죽지 않게.
 * 첨부 사진은 { type: "file", mimeType: "image/…", data: "data:…" } 로 저장된다 — 개수만 센다.
 */
export function readable(content: string): { text: string; tools: string[]; images: number } {
  try {
    const c = JSON.parse(content) as { parts?: StoredPart[]; content?: unknown };
    const parts = Array.isArray(c.parts) ? c.parts : [];
    const text = parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n")
      .trim();
    const tools = parts
      .map((p) => p.toolInvocation?.toolName ?? (p.type?.startsWith("tool-") ? p.toolName : undefined))
      .filter((t): t is string => !!t);
    const images = parts.filter(
      (p) => (p.type === "file" || p.type === "image") && (p.mimeType ?? "image/").startsWith("image/"),
    ).length;
    return { text: text || (typeof c.content === "string" ? c.content : ""), tools, images };
  } catch {
    return { text: content, tools: [], images: 0 };
  }
}
