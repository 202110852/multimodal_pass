import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadEnvFiles } from "./env.js";

/**
 * Mindlogic FactChat API Gateway.
 *
 * 동국대 WISE 캠퍼스가 제공하는 게이트웨이로, 여러 LLM 제공사를 하나의
 * OpenAI 호환 인터페이스로 묶어 준다. Anthropic 에 직접 붙는 것이 아니라
 * 이 게이트웨이를 통한다 — 키도 Anthropic 키가 아니라 FactChat 발급 키다.
 *
 *   Base : https://factchat-cloud.mindlogic.ai/v1/gateway
 *   인증 : Authorization: Bearer <키>   (x-api-key 도 지원)
 *   모델 : claude-opus-5 / claude-sonnet-5 / gpt-5
 *
 * tool calling 지원은 실제 호출로 확인했다 (finish_reason=tool_calls).
 */
export const DEFAULT_BASE_URL = "https://factchat-cloud.mindlogic.ai/v1/gateway";
export const DEFAULT_MODEL = "claude-opus-5";

function apiKey(): string {
  loadEnvFiles();
  const k =
    process.env.FACTCHAT_API_KEY ??
    process.env.LLM_API_KEY ??
    process.env.ANTHROPIC_API_KEY;
  if (!k) {
    throw new Error(
      "LLM 키가 없습니다. chat/.env 또는 저장소 루트 .env 에 FACTCHAT_API_KEY 를 넣으세요.\n" +
        `(.env 탐색 결과: ${loadEnvFiles().join(", ") || "찾지 못함"}, cwd=${process.cwd()})`,
    );
  }
  return k;
}

function build() {
  loadEnvFiles();
  const gateway = createOpenAICompatible({
    name: "factchat",
    baseURL: process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: apiKey(),
  });
  return gateway(process.env.LLM_MODEL ?? DEFAULT_MODEL);
}

export const chatModel = build();
