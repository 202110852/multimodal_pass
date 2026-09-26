import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * .env 를 현재 작업 디렉터리에서 위로 올라가며 찾는다.
 *
 * import.meta.url 기준으로 잡으면 안 된다 — `mastra dev` 는 코드를
 * chat/.mastra/output/ 으로 번들해서 실행하므로 상대 경로가 어긋난다.
 * cwd 는 두 경로(tsx 직접 실행, mastra dev) 모두에서 chat/ 이다.
 *
 * 가까운 파일이 우선한다 (chat/.env → 저장소 루트 .env).
 * 이미 설정된 process.env 는 덮지 않는다 (셸 값이 최우선).
 */
function loadFile(path: string): boolean {
  if (!existsSync(path)) return false;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (val && process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

export const loadedEnvFiles: string[] = [];
let done = false;

/**
 * 반드시 호출해서 쓴다. import 사이드이펙트로 두면 안 된다 —
 * `mastra dev` 의 번들러가 부수효과만 있는 import 를 제거해 버린다.
 * 여러 번 불러도 안전하다.
 */
export function loadEnvFiles(): string[] {
  if (done) return loadedEnvFiles;
  done = true;
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth++) {
    const candidate = resolve(dir, ".env");
    if (loadFile(candidate)) loadedEnvFiles.push(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return loadedEnvFiles;
}

/** 키가 아예 없을 때만 막는다. FactChat 게이트웨이 키는 sk-ant-* 형식이 아니다. */
export function requireLlmKey(): void {
  loadEnvFiles();
  const k =
    process.env.FACTCHAT_API_KEY ??
    process.env.LLM_API_KEY ??
    process.env.ANTHROPIC_API_KEY;
  if (!k) {
    throw new Error(
      "LLM 키가 없습니다. chat/.env 또는 저장소 루트 .env 에 FACTCHAT_API_KEY 를 넣으세요.\n" +
        `(.env 를 찾아본 곳: ${loadedEnvFiles.join(", ") || "없음"})\n` +
        "FactChat 개발자 설정에서 발급합니다 (docs.mindlogic.ai).",
    );
  }
}
