import pg from "pg";
import { loadEnvFiles } from "./env.js";

loadEnvFiles();

/**
 * 도메인 DB(Postgres) 접속.
 *
 * 로컬 개발 기본은 DB off — PG 미설정 또는 LOCAL_NO_DB=1 이면 연결하지 않는다.
 * 추후 Supabase(Postgres) 연동 시 PG_URL / PG_* 를 채우면 다시 켠다.
 *
 * 스키마·적재는 이 저장소의 `db-pg/` 와 `api-db-pipeline/` 이 담당한다.
 * 챗봇은 읽기만 한다 — 특히 뷰(v_poi_merged 등)를 읽는다.
 */
const { Pool, types } = pg;

// node-postgres 는 정밀도 보호를 위해 int8(bigint)·numeric 을 문자열로 준다.
// poi_id 는 bigserial, metric.value·거리는 numeric 이라 그대로면 tool 출력 검증에 걸린다.
// 이 프로젝트 규모(POI 1만여 건)에서는 number 로 안전하게 들어간다.
types.setTypeParser(20, (v) => Number.parseInt(v, 10)); // int8
types.setTypeParser(1700, (v) => Number.parseFloat(v)); // numeric

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** Postgres 도메인 DB를 쓸지. 에이전트 메모리(LibSQL)와는 별개다. */
export function isDbEnabled(): boolean {
  loadEnvFiles();
  if (truthy(process.env.LOCAL_NO_DB)) return false;
  if (process.env.PG_URL?.trim()) return true;
  if (process.env.PGUSER?.trim()) return true;
  return false;
}

export class DbDisabledError extends Error {
  constructor(message = "도메인 DB가 비활성입니다 (로컬 모드). 추후 Supabase 연동 예정.") {
    super(message);
    this.name = "DbDisabledError";
  }
}

export const pool: pg.Pool | null = isDbEnabled()
  ? new Pool(
      process.env.PG_URL
        ? { connectionString: process.env.PG_URL }
        : {
            host: process.env.PGHOST ?? "127.0.0.1",
            port: Number(process.env.PGPORT ?? 5432),
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE ?? "stan_jeju",
          },
    )
  : null;

/**
 * 읽기/쓰기 공용.
 * DB off 이면 빈 배열 — tool 은 "결과 없음"으로 통과한다.
 * INSERT … RETURNING 이 빈 배열이면 호출 측에서 쓰기 실패로 보면 된다.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!pool) return [];
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/** 도메인 목록 — tool 설명과 입력 검증에 쓴다. poi_domain 테이블과 같아야 한다. */
export const DOMAINS = [
  "tourism",
  "store",
  "parking",
  "ev_charger",
  "fair_price",
  "good_restaurant",
  "odii",
  "hub_tourism",
  "tour_info",
  "restroom",
  "locker",
  "tsdo",
] as const;
