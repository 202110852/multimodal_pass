import { domToJpeg } from "modern-screenshot";
import { useCallback, useEffect, useRef, useState } from "react";
import { collectContext, describeElement, type DebugContext } from "./collector.js";

/**
 * 어느 화면에서든 우클릭 → "버그 리포트 보내기".
 * 화면 캡처 + 디버깅 정보(collector.ts)를 /chat/bug-reports 로 보낸다. /admin 의 버그 리포트 탭에서 본다.
 * Shift+우클릭은 브라우저 기본 메뉴. 이 창 안에서는 기본 메뉴를 그대로 쓴다(붙여넣기 등).
 */

const BASE = import.meta.env.VITE_MASTRA_URL || window.location.origin;
const API_KEY = import.meta.env.VITE_API_KEY;
const MAX_SHOT_CHARS = 3_800_000; // 서버 한도 3MB(디코딩) 안쪽
const MAX_CANVAS_EDGE = 7000;
const CAPTURE_TIMEOUT = 15_000;

interface Capture {
  dataUrl: string;
  /** 캡처 배율과 사용자가 보던 영역 (관리자 화면이 그 부분을 보여 준다) */
  meta: { scale: number; width: number; height: number; viewport: { x: number; y: number; w: number; h: number } };
}

const screenName = () => (location.pathname.startsWith("/admin") ? `admin${location.hash || "#prompt"}` : "chat");

/** 페이지 전체를 JPEG 로. 고정 요소(헤더·입력창)가 제자리에 오도록 부분이 아니라 전체를 찍는다. */
async function capture(): Promise<Capture | null> {
  const el = document.documentElement;
  const width = el.scrollWidth;
  const height = el.scrollHeight;
  const viewport = { x: Math.round(scrollX), y: Math.round(scrollY), w: innerWidth, h: innerHeight };
  let scale = Math.min(devicePixelRatio || 1, 1.5, MAX_CANVAS_EDGE / Math.max(width, height));
  for (const quality of [0.72, 0.55, 0.4]) {
    try {
      const dataUrl = await domToJpeg(document.body, {
        width,
        height,
        scale,
        quality,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
        font: false,
        timeout: 5000, // 이미지 하나당
        fetch: { requestInit: { cache: "force-cache", mode: "cors" } },
        filter: (node) => !(node instanceof Element && node.closest("[data-bug-ignore]")),
      });
      if (dataUrl.length <= MAX_SHOT_CHARS) return { dataUrl, meta: { scale, width, height, viewport } };
      scale *= 0.7;
    } catch (e) {
      console.warn("[bug-report] 화면 캡처 실패", e);
      return null;
    }
  }
  return null;
}

type Phase = "idle" | "capturing" | "editing" | "sending" | "done";

export function BugReporter() {
  const [menu, setMenu] = useState<{ x: number; y: number; target: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shot, setShot] = useState<Capture | null>(null);
  const [includeShot, setIncludeShot] = useState(true);
  const [ctx, setCtx] = useState<DebugContext | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bugId, setBugId] = useState<number | null>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  // 우클릭
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (e.shiftKey) return; // 브라우저 기본 메뉴
      if (phaseRef.current !== "idle") return; // 이미 리포트를 쓰는 중
      const t = e.target as Element | null;
      if (t?.closest?.("[data-bug-ignore]")) return; // 리포트 창 안에서는 기본 메뉴
      e.preventDefault();
      const sel = window.getSelection()?.toString().trim();
      setMenu({
        x: Math.min(e.clientX, innerWidth - 230),
        y: Math.min(e.clientY, innerHeight - 90),
        target: describeElement(t) + (sel ? ` | 선택한 글: "${sel.slice(0, 200)}"` : ""),
      });
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  // 메뉴 닫기 — 바깥 클릭·Esc·스크롤·창 크기
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".bug-menu")) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const reset = useCallback(() => {
    setPhase("idle");
    setShot(null);
    setCtx(null);
    setNote("");
    setError(null);
    setBugId(null);
    setIncludeShot(true);
  }, []);

  useEffect(() => {
    if (phase !== "editing") return;
    noteBox.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && reset();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, reset]);

  const start = async () => {
    const target = menu?.target;
    setMenu(null);
    setPhase("capturing");
    // 메뉴가 화면에서 사라진 뒤에 찍는다. 탭이 백그라운드면 requestAnimationFrame 이 멈추므로 시간으로도 끊는다.
    await Promise.race([
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      new Promise((r) => setTimeout(r, 120)),
    ]);
    // 캡처가 오래 걸리면(큰 이미지·느린 기기) 캡처 없이 진행한다
    const shotOrNull = Promise.race([capture(), new Promise<null>((r) => setTimeout(() => r(null), CAPTURE_TIMEOUT))]);
    const [c, context] = await Promise.all([shotOrNull, collectContext({ target: { element: target }, screen: screenName() })]);
    if (c) context.app.capture = c.meta;
    setShot(c);
    setCtx(context);
    setPhase("editing");
  };

  const submit = async () => {
    if (!ctx) return;
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch(`${BASE}/chat/bug-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
        body: JSON.stringify({
          note: note.trim() || null,
          pageUrl: location.href,
          userAgent: navigator.userAgent,
          context: includeShot ? ctx : { ...ctx, app: { ...ctx.app, capture: null } },
          screenshot: includeShot ? (shot?.dataUrl ?? null) : null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { bugId?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setBugId(json.bugId ?? null);
      setPhase("done");
      setTimeout(reset, 2200);
    } catch (e) {
      setError(`보내지 못했습니다: ${(e as Error).message}`);
      setPhase("editing");
    }
  };

  const errors = ctx?.console.filter((c) => c.level === "error").length ?? 0;
  const failedRequests = ctx?.network.filter((n) => n.error || (n.status ?? 0) >= 400).length ?? 0;

  return (
    <>
      {menu && (
        <div className="bug-menu" data-bug-ignore role="menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" onClick={() => void start()}>
            버그 리포트 보내기
          </button>
          <p>Shift+우클릭: 브라우저 메뉴</p>
        </div>
      )}

      {phase === "capturing" && (
        <div className="bug-toast" data-bug-ignore role="status">
          화면을 담는 중…
        </div>
      )}

      {(phase === "editing" || phase === "sending" || phase === "done") && ctx && (
        <div className="bug-backdrop" data-bug-ignore>
          <div className="bug-dialog" role="dialog" aria-modal="true" aria-label="버그 리포트">
            {phase === "done" ? (
              <div className="bug-done">
                <strong>접수했습니다{bugId ? ` (#${bugId})` : ""}</strong>
                <p>알려 주셔서 고맙습니다.</p>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <h2>버그 리포트</h2>
                <label className="bug-note">
                  어떤 문제가 있었나요? (선택)
                  <textarea
                    ref={noteBox}
                    value={note}
                    rows={3}
                    maxLength={2000}
                    placeholder="예: 멈춤을 눌렀는데 질문이 입력창에 돌아오지 않아요"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>

                {shot ? (
                  <div className="bug-shot">
                    <label>
                      <input type="checkbox" checked={includeShot} onChange={(e) => setIncludeShot(e.target.checked)} />
                      화면 캡처 함께 보내기 ({Math.round((shot.dataUrl.length * 0.75) / 1024)}KB)
                    </label>
                    {includeShot && <img src={shot.dataUrl} alt="보낼 화면 캡처" />}
                  </div>
                ) : (
                  <p className="meta">화면을 캡처하지 못했습니다. 나머지 정보만 보냅니다.</p>
                )}

                <details>
                  <summary>
                    함께 보내는 정보 — 브라우저·앱 상태, 콘솔 {ctx.console.length}건(오류 {errors}),
                    네트워크 {ctx.network.length}건(실패 {failedRequests}), 최근 동작 {ctx.breadcrumbs.length}건
                  </summary>
                  <p className="meta">관리자 토큰·API 키 같은 비밀값은 보내지 않습니다.</p>
                  <pre>{JSON.stringify(ctx, null, 2).slice(0, 20000)}</pre>
                </details>

                {error && <div className="error">{error}</div>}

                <div className="edit-actions">
                  <button type="button" className="ghost" onClick={reset} disabled={phase === "sending"}>
                    취소
                  </button>
                  <button type="submit" disabled={phase === "sending"}>
                    {phase === "sending" ? "보내는 중…" : "보내기"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
