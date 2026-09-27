import { fetchNaverApi } from "./_upstream.js";
import {
  guardGetRequest,
  queryString,
  sendUpstreamJson,
  type ApiRequest,
  type ApiResponse,
} from "../_http.js";

/** NCP Geocoding REST는 language=kor|eng 만 받는다 */
function normalizeLanguage(input: string): "kor" | "eng" {
  const tag = input.trim().toLowerCase();
  return tag === "eng" || tag.startsWith("en") ? "eng" : "kor";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!guardGetRequest(req, res)) return;

  const query = queryString(req, "query");
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const params = new URLSearchParams({ query });
  const count = queryString(req, "count");
  const language = queryString(req, "language");
  if (count) params.set("count", count);
  if (language) params.set("language", normalizeLanguage(language));

  const upstream = await fetchNaverApi("/map-geocode/v2/geocode", params);
  if (!upstream) {
    return res.status(500).json({ error: "Naver API credentials not configured" });
  }
  return sendUpstreamJson(res, upstream.status, upstream.body);
}
