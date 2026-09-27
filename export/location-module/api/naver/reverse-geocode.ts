import { fetchNaverApi } from "./_upstream.js";
import {
  guardGetRequest,
  queryString,
  sendUpstreamJson,
  type ApiRequest,
  type ApiResponse,
} from "../_http.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!guardGetRequest(req, res)) return;

  const coords = queryString(req, "coords");
  if (!coords) {
    return res.status(400).json({ error: "coords is required (longitude,latitude)" });
  }

  const params = new URLSearchParams({
    coords,
    output: "json",
    sourcecrs: queryString(req, "sourcecrs") ?? "epsg:4326",
    orders: queryString(req, "orders") ?? "roadaddr,addr,admcode",
  });

  const upstream = await fetchNaverApi("/map-reversegeocode/v2/gc", params);
  if (!upstream) {
    return res.status(500).json({ error: "Naver API credentials not configured" });
  }
  return sendUpstreamJson(res, upstream.status, upstream.body);
}
