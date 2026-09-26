import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { kakaoPoint } from "../lib/kakao.js";
import { getKakaoDirections } from "./kakaoDirections.js";

/**
 * 같은 출발·도착에 대해 여러 이동수단 경로를 한꺼번에 조회한다.
 * 택시 요금은 카카오 자동차 경로의 fare.taxi, 버스는 transit 요금·환승을 쓴다.
 * 공유 킥보드/자전거는 지원하지 않는다.
 */

const ProfileMode = z.enum(["walk", "taxi", "bus", "car"]);

function fareWon(fare: unknown): number | null {
  if (fare == null || typeof fare !== "object") return null;
  const f = fare as Record<string, unknown>;
  for (const k of ["taxi", "value", "min", "toll"]) {
    const v = f[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  }
  return null;
}

function summarize(
  mode: "walk" | "taxi" | "bus" | "car",
  raw: Awaited<ReturnType<typeof getKakaoDirections>>,
) {
  if (!raw.ok) {
    return {
      mode,
      ok: false as const,
      error: raw.error,
      duration_minutes: null,
      distance_m: null,
      fare_won: null,
      transfers: null,
      directions_url: null,
      note: null as string | null,
    };
  }
  const best = raw.routes[0] as {
    duration_minutes?: number;
    distance_m?: number;
    fare?: unknown;
    transfers?: number | null;
    directions_url?: string | null;
  };
  let fare_won: number | null = null;
  let note: string | null = null;
  if (mode === "taxi") {
    const f = best.fare as { taxi?: number } | null | undefined;
    fare_won = typeof f?.taxi === "number" ? Math.round(f.taxi) : fareWon(best.fare);
    note = "자동차 경로 기준 예상 택시요금이다. 실제와 다를 수 있다.";
  } else if (mode === "car") {
    const f = best.fare as { toll?: number; taxi?: number } | null | undefined;
    fare_won = typeof f?.toll === "number" ? Math.round(f.toll) : null;
    note = fare_won != null ? "통행료(toll) 예상값이다. 연료비는 포함하지 않는다." : "통행료 정보가 없다.";
  } else if (mode === "bus") {
    fare_won = fareWon(best.fare);
    note = "대중교통(버스·환승 포함) 예상 요금·시간이다.";
  } else {
    note = "도보 예상 시간·거리이다.";
  }
  return {
    mode,
    ok: true as const,
    error: null,
    duration_minutes: best.duration_minutes ?? null,
    distance_m: best.distance_m ?? null,
    fare_won,
    transfers: best.transfers ?? null,
    directions_url: best.directions_url ?? null,
    note,
  };
}

/** 프로필 이동수단 → 카카오 API mode. taxi는 car API의 taxi 요금을 쓴다. */
function toKakaoMode(m: z.infer<typeof ProfileMode>): "walk" | "transit" | "car" {
  if (m === "walk") return "walk";
  if (m === "bus") return "transit";
  return "car"; // taxi · car
}

export const compareDirections = createTool({
  id: "compare-directions",
  description:
    "같은 출발·도착에 대해 도보·택시·버스(대중교통)·차량 경로의 시간·요금을 한꺼번에 비교한다. " +
    "프로필에 택시·버스가 있거나, 구간별로 어떤 수단이 나을지 고를 때 쓴다. " +
    "공유 킥보드/자전거는 넣지 않는다. 실패 수단은 ok=false 로 두고 추측하지 않는다. " +
    "car·taxi 가 NO_ROUTE이면 출발·도착을 인근 주차장(PK6) 또는 도로 좌표로 바꿔 한 번만 다시 조회한다.",
  inputSchema: z.object({
    origin: kakaoPoint.describe("출발 좌표·이름"),
    destination: kakaoPoint.describe("도착 좌표·이름"),
    modes: z
      .array(ProfileMode)
      .min(1)
      .max(4)
      .describe("비교할 수단. walk·taxi·bus·car. 프로필에 있는 것만 넣는다(shared_bike 제외)"),
  }),
  outputSchema: z.object({
    origin: kakaoPoint,
    destination: kakaoPoint,
    options: z.array(
      z.object({
        mode: ProfileMode,
        ok: z.boolean(),
        error: z.unknown().nullable(),
        duration_minutes: z.number().nullable(),
        distance_m: z.number().nullable(),
        fare_won: z.number().nullable().describe("예상 요금(원). 택시는 택시요금, 버스는 교통요금, 차량은 통행료"),
        transfers: z.number().nullable(),
        directions_url: z.string().nullable(),
        note: z.string().nullable(),
      }),
    ),
    hint: z.string().describe("시간·요금을 함께 보고 고르라는 안내"),
  }),
  execute: async ({ origin, destination, modes }) => {
    const unique = [...new Set(modes)];
    const settled = await Promise.all(
      unique.map(async (m) => {
        const raw = await getKakaoDirections({
          origin,
          destination,
          mode: toKakaoMode(m),
        });
        return summarize(m, raw);
      }),
    );
    return {
      origin,
      destination,
      options: settled,
      hint:
        "성공한 옵션의 duration_minutes·fare_won 을 함께 보고 추천한다. " +
        "값이 없는 항목은 모른다고 하고 지어내지 않는다. " +
        "차량이 프로필에 있으면 차량을 기본으로 두되, 더 짧거나 싼 대안이 있으면 함께 안내한다.",
    } as never;
  },
});
