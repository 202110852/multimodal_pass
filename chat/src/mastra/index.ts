import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { PostgresStore } from "@mastra/pg";
import { jejuAgent } from "./agents/jeju.js";
import { adminRoutes } from "./admin.js";
import { apiGuard } from "./auth.js";
import { bugRoutes } from "./bugs.js";
import { chatRoutes } from "./chat.js";
import { isDbEnabled } from "./db.js";
import { feedbackRoutes } from "./feedback.js";
import { reportRoutes } from "./reports.js";
import { weatherSuggestionRoutes } from "./weatherSuggestion.js";
import { chatRootDir, loadEnvFiles } from "./env.js";

const DEFAULT_LOCAL_MEMORY_PATH = ".mastra/local-memory.db";

/**
 * LibSQL 접속 URL.
 * `file:` 상대 경로는 cwd 가 아니라 chat/ 기준으로 풀어야 `mastra dev` 에서도 열린다.
 * 원격 URL(libsql://, http:// 등)은 그대로 쓴다.
 */
function localMemoryUrl(): string {
  const configured = process.env.MASTRA_LIBSQL_URL?.trim();
  if (configured && !configured.startsWith("file:")) return configured;

  const rawPath = configured ? configured.slice("file:".length) : DEFAULT_LOCAL_MEMORY_PATH;
  const absolutePath = resolve(chatRootDir(), rawPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  return `file:${absolutePath}`;
}

/**
 * 에이전트 메모리 저장소.
 *
 * - 도메인 DB(Postgres) off → 로컬 LibSQL 파일 (원격/로컬 PG 불필요)
 * - Postgres on → 기존처럼 mastra 스키마 (추후 Supabase URL 도 여기로)
 */
function createStorage() {
  loadEnvFiles();
  if (!isDbEnabled()) {
    return new LibSQLStore({
      id: "local-memory-store",
      url: localMemoryUrl(),
    });
  }

  const connectionString = (() => {
    if (process.env.MASTRA_PG_URL) return process.env.MASTRA_PG_URL;
    if (process.env.PG_URL) return process.env.PG_URL;
    const user = encodeURIComponent(process.env.PGUSER ?? "");
    const pw = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : "";
    const auth = user ? `${user}${pw}@` : "";
    const host = process.env.PGHOST ?? "127.0.0.1";
    const port = process.env.PGPORT ?? "5432";
    const db = process.env.PGDATABASE ?? "stan_jeju";
    return `postgresql://${auth}${host}:${port}/${db}`;
  })();

  return new PostgresStore({
    id: "stan-jeju-store",
    connectionString,
    schemaName: process.env.MASTRA_PG_SCHEMA ?? "mastra",
  });
}

/** 프론트(localhost:5173) ↔ 로컬 Mastra. 원격 배포 Origin 은 남겨 두되 기본 개발은 로컬. */
function allowedOrigins(): string[] {
  const extra = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    "https://stan.lkim.me",
    "http://localhost:5173",
    "http://localhost:4111",
    ...extra,
  ];
}

export const mastra = new Mastra({
  agents: { jejuAgent },
  storage: createStorage(),
  server: {
    host: process.env.MASTRA_HOST ?? "127.0.0.1",
    port: Number(process.env.MASTRA_PORT ?? 4111),
    middleware: apiGuard,
    apiRoutes: [
      ...adminRoutes,
      ...reportRoutes,
      ...chatRoutes,
      ...feedbackRoutes,
      ...bugRoutes,
      ...weatherSuggestionRoutes,
    ],
    cors: {
      origin: allowedOrigins(),
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "x-api-key", "x-admin-token"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    },
  },
});
