import {
  guardGetRequest,
  queryString,
  sendUpstreamJson,
  type ApiRequest,
  type ApiResponse,
} from "../_http.js";

const KAKAO_KEYWORD_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
/** 카카오 키워드 검색 제한: page 1~45, size 1~15 */
const MAX_PAGE = 45;
const MAX_SIZE = 15;

function clampInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10) || fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!guardGetRequest(req, res)) return;

  const query = queryString(req, "query");
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const restApiKey = process.env.KAKAO_REST_API_KEY?.trim();
  if (!restApiKey) {
    return res.status(500).json({ error: "Kakao REST API key not configured" });
  }

  const url = new URL(KAKAO_KEYWORD_SEARCH_URL);
  url.search = new URLSearchParams({
    query,
    page: String(clampInt(queryString(req, "page"), 1, MAX_PAGE)),
    size: String(clampInt(queryString(req, "size"), MAX_SIZE, MAX_SIZE)),
  }).toString();

  const upstream = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${restApiKey}`, Accept: "application/json" },
  });

  return sendUpstreamJson(res, upstream.status, await upstream.text());
}
