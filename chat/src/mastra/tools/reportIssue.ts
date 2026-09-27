import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { isDbEnabled, query } from "../db.js";

/**
 * 틀린 정보 제보 (오류 제보 모드). place_report 에 쌓고 운영자가 확인한다.
 * 챗봇이 DB 에 쓰는 유일한 곳이다 — 원본 poi 는 건드리지 않는다.
 */
export const ISSUE_TYPES = ["hours", "address", "closed", "phone", "price", "location", "other"] as const;

export const reportIssue = createTool({
  id: "report-issue",
  description:
    "사용자가 장소 정보가 틀렸다고 알려 주거나, 현장에서 본 사실(예: '가보니 10시부터 연다')을 " +
    "말해 줄 때 제보를 저장한다 (영업시간·주소·폐업·전화·요금·위치 등). " +
    "DB 값으로 반박하지 말고, 장소와 내용이 분명하면 바로 한 번만 부른다. " +
    "장소가 애매하면 먼저 search-places 로 찾아 poi_id 를 넣는다.",
  inputSchema: z.object({
    poi_id: z.number().int().optional().describe("DB 장소면 넣는다. 이름·주소를 여기서 읽는다"),
    place_name: z.string().min(1).describe("장소 이름 (poi_id 가 없을 때 특히 중요)"),
    issue_type: z
      .enum(ISSUE_TYPES)
      .describe("hours=영업시간, address=주소, closed=폐업·휴업, phone=전화, price=요금·가격, location=지도 위치, other=기타"),
    detail: z
      .string()
      .min(2)
      .max(1000)
      .describe("무엇이 어떻게 다른지 사용자 말을 요약. 사용자가 아는 올바른 값이 있으면 포함"),
  }),
  outputSchema: z.object({
    report_id: z.number(),
    place_name: z.string(),
    issue_type: z.string(),
  }),
  execute: async ({ poi_id, place_name, issue_type, detail }, context) => {
    if (!isDbEnabled()) {
      // 로컬 DB off — 제보는 받지 않고 id 0 으로 통과 (크래시 방지)
      return { report_id: 0, place_name, issue_type };
    }
    let name = place_name;
    let addr: string | null = null;
    let pid: number | null = null;
    if (poi_id) {
      const [p] = await query<{ name: string; addr: string | null }>(
        "SELECT name, addr FROM v_poi_merged WHERE poi_id = $1",
        [poi_id],
      );
      // 없는 poi_id 라도 제보는 받는다. 이름은 사용자가 말한 것으로 남는다.
      if (p) {
        name = p.name;
        addr = p.addr;
        pid = poi_id;
      }
    }
    const [row] = await query<{ report_id: number }>(
      `INSERT INTO place_report (poi_id, place_name, place_addr, issue_type, detail, thread_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING report_id`,
      [pid, name, addr, issue_type, detail, context?.agent?.threadId ?? null],
    );
    if (!row) throw new Error("제보 저장에 실패했습니다.");
    return { report_id: row.report_id, place_name: name, issue_type };
  },
});
