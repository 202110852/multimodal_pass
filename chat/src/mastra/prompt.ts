import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadEnvFiles } from "./env.js";
import type { RequestContext } from "@mastra/core/request-context";
import { FORMAT_RULES, languageDirective, profileDirective } from "./format.js";
import { pingTourApi } from "./lib/tourApi.js";

/**
 * 시스템 프롬프트는 DB 가 아니라 텍스트 파일에 둔다.
 *
 * 파일은 cwd 에서 위로 올라가며 찾는다. 실행 경로마다 cwd 가 다르다 —
 * 배포(launchd)는 chat/, `mastra dev` 는 chat/src/mastra/public/ 이다.
 * import.meta.url 도 번들 위치(.mastra/output/)를 가리키므로 쓸 수 없다.
 * 못 찾으면 새로 만들지 않고 오류를 낸다 — 엉뚱한 곳에 프롬프트가 생기는 것을 막는다.
 *
 * 매 요청마다 파일을 새로 읽는다. /admin 에서 저장하면 재시작 없이 다음 답변부터 반영된다.
 */

export const MAX_PROMPT_BYTES = 100_000;

export function promptPath(): string {
  loadEnvFiles();
  const rel = process.env.SYSTEM_PROMPT_FILE ?? "prompts/system-prompt.txt";
  if (isAbsolute(rel)) return rel;
  const tried: string[] = [];
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth++) {
    const candidate = resolve(dir, rel);
    if (existsSync(candidate)) return candidate;
    tried.push(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`시스템 프롬프트 파일을 찾지 못했습니다 (찾아본 곳: ${tried.join(", ")})`);
}

export interface PromptFile {
  content: string;
  updatedAt: string;
  path: string;
}

export async function readSystemPrompt(): Promise<PromptFile> {
  const path = promptPath();
  const [content, st] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  return { content, updatedAt: st.mtime.toISOString(), path };
}

/** 임시 파일에 쓴 뒤 rename — 쓰는 도중에 들어온 요청이 반쯤 쓰인 프롬프트를 읽지 않게. */
export async function writeSystemPrompt(content: string): Promise<PromptFile> {
  const path = promptPath();
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
  return readSystemPrompt();
}

/** Asia/Seoul 기준 현재 시각. 영업시간·「지금 출발」판단에 쓴다. */
export function nowKstDirective(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const y = parts.year;
  const m = parts.month;
  const d = parts.day;
  const weekday = parts.weekday;
  const hour = parts.hour;
  const minute = parts.minute;
  return `# 현재 시각 (Asia/Seoul)
지금은 ${y}-${m}-${d} ${weekday} ${hour}:${minute} 이다.
장소 추천과 「지금 출발」일정(제주 전역·관광지·식당·카페 등 모두)은
이 시각(또는 사용자가 말한 출발·방문 시각)을 기준으로 영업·이용시간을 확인한다.
이 시각에 문이 닫힌 곳은 추천하지 않는다.

`;
}

/**
 * 에이전트의 instructions 로 쓴다.
 * [언어 지시] + [현재 시각] + [프로필] + 편집 가능한 파일 + 형식 규칙 + [언어 지시 한 번 더].
 */
export async function systemPrompt({ requestContext }: { requestContext?: RequestContext } = {}): Promise<string> {
  // TourAPI 는 답변에 쓰지 않고 요청만 보낸다 (구성도·공모전용).
  pingTourApi();
  const lang = languageDirective(requestContext?.get("replyLang"));
  const profile = profileDirective(requestContext?.get("userProfile"));
  const nowKst = nowKstDirective();
  return `${lang.head}${nowKst}${profile}${(await readSystemPrompt()).content.trimEnd()}\n${FORMAT_RULES}${lang.tail}`;
}
