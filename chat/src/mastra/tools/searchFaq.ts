import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { query } from "../db.js";

/**
 * 원도심 상점가 FAQ (FAQ 모드). 시드는 api-db-pipeline/meta/downtown_faq.csv.
 *
 * 53건뿐이라 SQL 유사도 대신 메모리에서 점수를 매긴다.
 * '어디', '있나요' 처럼 거의 모든 문항에 들어가는 말은 가중치가 낮아지도록
 * 문항 빈도(df)로 나눠 준다 — 그러지 않으면 "화장실 어디 있어요?" 가
 * 아무 '어디' 문항이나 끌어온다.
 */

interface Faq {
  faq_id: number;
  category: string;
  menu_name: string;
  question: string;
  answer: string;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; rows: Faq[] } | null = null;

async function allFaq(): Promise<Faq[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await query<Faq>(
    "SELECT faq_id, category, menu_name, question, answer FROM faq ORDER BY faq_id",
  );
  cache = { at: Date.now(), rows };
  return rows;
}

export const FAQ_CATEGORIES = ["일반 안내", "칠성로 상점가", "중앙지하상가", "중앙로 상점가"] as const;

// 조사·어미를 떼서 '주차장이'·'쿠폰은' 도 맞게 한다. 한 번만 뗀다.
const TAIL = /(에서는|에서|으로|하나요|있나요|인가요|나요|까요|은|는|이|가|을|를|에|로|도|의|요)$/;

function tokens(q: string): string[] {
  const out = new Set<string>();
  for (const raw of q.toLowerCase().split(/[\s,.?!·/()"'~]+/)) {
    if (raw.length < 2) continue;
    out.add(raw);
    const cut = raw.replace(TAIL, "");
    if (cut.length >= 2) out.add(cut);
  }
  return [...out];
}

// 사용자 표현 → FAQ 주제(menu_name). 글자가 겹치지 않는 흔한 표현만 잇는다.
// ("몇 시까지 해?" 는 '운영 시간' 과 공통 글자가 없다.)
const TOPIC_ALIASES: [RegExp, string][] = [
  [/몇\s*시|영업|문\s*(열|닫)|오픈|마감|언제까지/, "운영시간"],
  [/전화|번호|문의/, "연락처"],
  [/담배|흡연/, "흡연"],
  [/강아지|애견|고양이|반려|펫/, "반려동물"],
  [/뭐\s*(팔|사)|파는|살\s*만|품목|쇼핑/, "판매품목"],
  [/쉴|쉬는|쉬어|벤치|앉을/, "휴게공간"],
  [/호텔|잘\s*곳|묵을|게스트하우스|숙박/, "숙소"],
  [/밥|식당|맛집|먹을/, "음식점"],
  [/커피|디저트/, "카페"],
  [/차\s*(대|세우)|파킹/, "주차"],
  [/노선|정류장/, "버스"],
  [/볼거리|구경|축제|행사/, "관광"],
  [/택스\s*리펀|tax\s*refund|환급/i, "면세환급"],
];

const head = (f: Faq) => `${f.category} ${f.menu_name} ${f.question}`.toLowerCase();

export const searchFaq = createTool({
  id: "search-faq",
  description:
    "원도심 상점가(칠성로·중앙지하상가·중앙로) FAQ 를 찾는다. 여행자소비쿠폰, 제주여행자센터, " +
    "면세 환급, 상점가의 운영시간·연락처·버스·주차·화장실·흡연·반려동물·휴게공간 같은 " +
    "고정 안내 질문이면 장소 검색보다 먼저 쓴다. 쿠폰 참여 매장 목록은 이 도구만으로 끝내지 말고 " +
    "search-downtown-stores(downtown_coupon=true) 로 실제 매장을 이어서 안내한다. " +
    "답은 answer 를 바탕으로 하고 발급·사용 조건을 지어내지 않는다.",
  inputSchema: z.object({
    q: z.string().min(1).describe("사용자 질문 그대로 또는 핵심 키워드"),
    category: z
      .enum(FAQ_CATEGORIES)
      .optional()
      .describe("상점가가 분명할 때만 준다. 쿠폰·여행자센터·면세는 '일반 안내'"),
    limit: z.number().int().min(1).max(10).default(4),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        faq_id: z.number(),
        category: z.string(),
        menu_name: z.string(),
        question: z.string(),
        answer: z.string(),
        score: z.number(),
      }),
    ),
    topics: z
      .array(z.object({ category: z.string(), menu_names: z.array(z.string()) }))
      .nullable()
      .describe("맞는 문항이 없을 때 FAQ 에 있는 주제 목록 — 되물을 때 쓴다"),
  }),
  execute: async ({ q, category, limit }) => {
    const rows = await allFaq();
    const pool = category ? rows.filter((f) => f.category === category) : rows;
    const toks = tokens(q);
    for (const [re, menu] of TOPIC_ALIASES) if (re.test(q)) toks.push(menu.toLowerCase());

    const df = new Map(toks.map((t) => [t, rows.filter((f) => head(f).includes(t)).length]));
    const weight = (t: string) => Math.log((rows.length + 1) / ((df.get(t) ?? 0) + 1)) + 0.1;

    const results = pool
      .map((f) => {
        const h = head(f);
        const a = f.answer.toLowerCase();
        // 답변 본문만 겹치는 것은 순위를 가를 때만 쓴다. 답변에 지나가듯 나온 말
        // ('흑돼지거리에서 5분')로 엉뚱한 문항이 뽑히지 않게, 질문·주제가 맞아야 결과에 넣는다.
        let hit = 0;
        let extra = 0;
        for (const t of toks) {
          if (h.includes(t)) hit += 2 * weight(t);
          else if (a.includes(t)) extra += 0.5 * weight(t);
        }
        return { ...f, hit, score: Math.round((hit + extra) * 100) / 100 };
      })
      .filter((f) => f.hit >= 1)
      .sort((x, y) => y.score - x.score || x.faq_id - y.faq_id)
      .slice(0, limit)
      .map(({ hit: _hit, ...f }) => f);

    const topics = results.length
      ? null
      : FAQ_CATEGORIES.map((c) => ({
          category: c,
          menu_names: [...new Set(rows.filter((f) => f.category === c).map((f) => f.menu_name))],
        }));

    return { results, topics };
  },
});
