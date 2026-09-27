import { splitAnswer } from "./answer.js";
import type { Msg } from "./store.js";

/**
 * 대화 내보내기 — 대화를 마크다운 파일로 받는다.
 * 추천 질문 블록은 빼고, 사진은 "[사진 n장]" 으로 적는다(미리보기 data URL 은 너무 길다).
 * 답변 속 장소 사진(주소)은 마크다운 이미지 그대로 둔다 — 열면 보인다.
 */

/** 메시지 id 는 `u-<ms>` / `a-<ms>` 라 보낸 시각을 알 수 있다. */
function sentAt(m: Msg): Date | null {
  const ms = Number(/-(\d{12,})$/.exec(m.id)?.[1]);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

const fmt = (d: Date) =>
  d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function chatMarkdown(title: string, msgs: Msg[]): string {
  const lines = [`# ${title}`, "", `> 제주 복합경로 안내 · 내보낸 시각 ${fmt(new Date())}`, ""];
  for (const m of msgs) {
    const at = sentAt(m);
    const who = m.role === "user" ? "나" : "도우미";
    lines.push(`## ${who}${at ? ` · ${fmt(at)}` : ""}`, "");
    if (m.images?.length) lines.push(`[사진 ${m.images.length}장]`, "");
    if (m.routeAttach) lines.push(`[경로: ${m.routeAttach.title}]`, "");
    const body = m.role === "assistant" ? splitAnswer(m.text).body : m.text;
    if (body) lines.push(body, "");
    if (m.stopped) lines.push("_(응답을 멈췄습니다)_", "");
    if (m.route) {
      lines.push("**방문순서**", "");
      if (m.route.start) lines.push(`- 출발: ${m.route.start.name}`);
      for (const s of m.route.stops) {
        const leg = s.from_prev_m != null ? ` — ${s.from_prev_m}m` : "";
        lines.push(`${s.order}. ${s.name}${s.addr ? ` (${s.addr})` : ""}${leg}`);
      }
      lines.push("");
    }
    if (m.feedback) lines.push(`_평가: ${m.feedback.rating === "up" ? "좋아요" : "싫어요"}_`, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function safeName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 40) || "대화";
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${base}_${stamp}.md`;
}

export function downloadChat(title: string, msgs: Msg[]): void {
  const blob = new Blob([chatMarkdown(title, msgs)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName(title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
