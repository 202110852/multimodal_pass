/**
 * CLI 로 에이전트에 한 번 물어본다 — 웹 UI 없이 동작을 확인하는 용도.
 *   npm run ask -- "관덕정 근처 주차장 알려줘"
 */
import { requireLlmKey } from "../src/mastra/env.js";
import { mastra } from "../src/mastra/index.js";

requireLlmKey();

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('사용법: npm run ask -- "질문"');
  process.exit(1);
}

const agent = mastra.getAgent("jejuAgent");
const res = await agent.generate(question);

console.log("\n" + (res.text ?? "(빈 응답)"));
const steps = (res as { steps?: unknown[] }).steps;
if (steps?.length) console.error(`\n[tool 호출 ${steps.length}단계]`);
process.exit(0);
