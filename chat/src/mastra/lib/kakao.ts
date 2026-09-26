import { z } from "zod";
import { loadEnvFiles } from "../env.js";

export class KakaoError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** 외부 응답/예외 원문에는 인증 정보가 들어갈 수 있으므로 노출하지 않는다. */
export function kakaoFailure(error: unknown) {
  return error instanceof KakaoError
    ? { code: error.code, message: error.message }
    : { code: "INVALID_RESPONSE", message: "카카오 API 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요." };
}

export async function kakaoGet(path: string, params: URLSearchParams, mobility = false): Promise<unknown> {
  loadEnvFiles();
  const key = mobility
    ? process.env.KAKAO_MOBILITY_REST_API_KEY || process.env.KAKAO_REST_API_KEY
    : process.env.KAKAO_REST_API_KEY || process.env.KAKAO_MOBILITY_REST_API_KEY;
  if (!key) throw new KakaoError("MISSING_KEY", "서버에 KAKAO_REST_API_KEY 또는 KAKAO_MOBILITY_REST_API_KEY 설정이 필요합니다.");
  let response: Response;
  try {
    response = await fetch(`${mobility ? "https://apis-navi.kakaomobility.com" : "https://dapi.kakao.com"}${path}?${params}`, {
      headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
  } catch {
    throw new KakaoError("NETWORK_ERROR", "카카오 API 연결이 지연되거나 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) {
    const message = response.status === 401 ? "카카오 REST API 키 인증을 확인해 주세요."
      : response.status === 403 ? "카카오 앱의 API 사용 권한 및 활성화 설정을 확인해 주세요."
      : response.status === 429 ? "카카오 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
      : "카카오 API 요청에 실패했습니다.";
    throw new KakaoError(`HTTP_${response.status}`, message);
  }
  return response.json();
}

export const kakaoPoint = z.object({
  name: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export const nonnegative = z.number().finite().nonnegative();
