import { useCallback, useEffect, useRef, useState } from "react";
import { splitAnswer } from "./answer.js";
import { registerState } from "./debug/collector.js";
import { renderMarkdown } from "./markdown.js";
import { TUNNEL_HEADERS } from "./tunnel.js";

// 개발: 같은 오리진 + Vite 프록시(기본 배포 API Cloud Run).
// 로컬 Mastra / 배포 번들은 MASTRA_URL · VITE_MASTRA_URL.
const BASE = import.meta.env.VITE_MASTRA_URL || window.location.origin;

// 관리자 토큰은 번들에 넣지 않는다. 직접 입력받아 이 탭에만 보관한다.
const TOKEN_KEY = "stan-admin-token";

type Tab = "prompt" | "reports" | "feedback" | "bugs";
const TABS: Tab[] = ["prompt", "reports", "feedback", "bugs"];

function describe(status: number, body: { error?: string; detail?: string }): string {
  if (status === 401) return "토큰이 올바르지 않습니다.";
  if (status === 503) return "서버에 ADMIN_TOKEN 이 설정되지 않아 관리자 기능이 꺼져 있습니다.";
  if (status === 409) return "다른 곳에서 먼저 저장했습니다. 다시 불러온 뒤 수정해 주세요.";
  if (status === 429) return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
  return `오류 (${status}): ${body.detail ?? body.error ?? "알 수 없음"}`;
}

type Api = <T>(method: string, path: string, body?: unknown) => Promise<T | null>;

/**
 * 관리자 API 호출. 실패하면 error 에 사람이 읽을 문장을 넣고 null 을 준다.
 * 401 이면 토큰을 지워 로그인 화면으로 돌아간다.
 */
function useApi(token: string, onUnauthorized: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api: Api = useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: {
            ...TUNNEL_HEADERS,
            "x-admin-token": token,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) onUnauthorized();
          setError(describe(res.status, json));
          return null;
        }
        return json as T;
      } catch (e) {
        setError(`서버에 닿지 못했습니다: ${(e as Error).message}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [token, onUnauthorized],
  );

  return { api, busy, error, setError };
}

export function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1) as Tab;
    return TABS.includes(h) ? h : "prompt";
  });

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
  }, []);

  const unauthorized = useCallback(() => {
    logout();
    setLoginError("토큰이 올바르지 않습니다.");
  }, [logout]);

  useEffect(() => {
    history.replaceState(null, "", tab === "prompt" ? location.pathname : `#${tab}`);
  }, [tab]);

  // 버그 리포트에 담을 상태 — 토큰 값은 넣지 않는다
  const debugSnapshot = useRef<() => unknown>(() => null);
  debugSnapshot.current = () => ({ tab, loggedIn: Boolean(token), loginError });
  useEffect(() => registerState("admin", () => debugSnapshot.current()), []);

  if (!token) {
    return (
      <div className="app admin">
        <header>
          <div>
            <h1>관리자</h1>
            <p>시스템 프롬프트 · 제보 관리</p>
          </div>
        </header>
        <main>
          <form
            className="login"
            onSubmit={(e) => {
              e.preventDefault();
              const t = tokenInput.trim();
              if (!t) return;
              sessionStorage.setItem(TOKEN_KEY, t);
              setToken(t);
              setTokenInput("");
              setLoginError(null);
            }}
          >
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="관리자 토큰"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button type="submit" disabled={!tokenInput.trim()}>
              들어가기
            </button>
          </form>
          {loginError && <div className="error">{loginError}</div>}
        </main>
      </div>
    );
  }

  return (
    <div className="app admin">
      <header>
        <div>
          <h1>관리자</h1>
          <nav className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "prompt"} onClick={() => setTab("prompt")}>
              시스템 프롬프트
            </button>
            <button type="button" role="tab" aria-selected={tab === "reports"} onClick={() => setTab("reports")}>
              제보
            </button>
            <button type="button" role="tab" aria-selected={tab === "feedback"} onClick={() => setTab("feedback")}>
              피드백
            </button>
            <button type="button" role="tab" aria-selected={tab === "bugs"} onClick={() => setTab("bugs")}>
              버그 리포트
            </button>
          </nav>
        </div>
        <div className="actions">
          <a className="ghost" href="/">
            챗봇
          </a>
          <button type="button" className="ghost" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      {/* 둘 다 띄워 두고 보이기만 바꾼다 — 탭을 옮겨도 편집 중인 프롬프트가 남는다 */}
      <PromptTab token={token} hidden={tab !== "prompt"} onUnauthorized={unauthorized} />
      <ReportsTab token={token} hidden={tab !== "reports"} onUnauthorized={unauthorized} />
      <FeedbackTab token={token} hidden={tab !== "feedback"} onUnauthorized={unauthorized} />
      <BugsTab token={token} hidden={tab !== "bugs"} onUnauthorized={unauthorized} />
    </div>
  );
}

// ---------------------------------------------------------------- 시스템 프롬프트

interface PromptRes {
  content: string;
  updatedAt: string;
}

interface TabProps {
  token: string;
  hidden: boolean;
  onUnauthorized: () => void;
}

function PromptTab({ token, hidden, onUnauthorized }: TabProps) {
  const { api, busy, error } = useApi(token, onUnauthorized);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState<PromptRes | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNotice(null);
    const r = await api<PromptRes>("GET", "/admin/system-prompt");
    if (r) {
      setSaved(r);
      setContent(r.content);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!saved) return;
    setNotice(null);
    const r = await api<PromptRes>("PUT", "/admin/system-prompt", {
      content,
      baseUpdatedAt: saved.updatedAt,
    });
    if (r) {
      setSaved(r);
      setContent(r.content);
      setNotice("저장했습니다. 다음 답변부터 반영됩니다.");
    }
  };

  const dirty = saved !== null && content !== saved.content;

  // 저장하지 않은 수정이 있으면 창을 닫기 전에 묻는다.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <>
      <main hidden={hidden}>
        <p className="meta">
          {saved
            ? `마지막 저장 ${new Date(saved.updatedAt).toLocaleString("ko-KR")}`
            : "불러오는 중"}
          {" · 답변 형식 규칙(사진·추천 질문)은 화면과 맞물려 있어 코드(format.ts)에 따로 있고 여기 내용 뒤에 붙습니다."}
        </p>
        <textarea
          className="prompt"
          value={content}
          spellCheck={false}
          disabled={!saved}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (dirty && !busy) void save();
            }
          }}
        />
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
      </main>

      <form
        hidden={hidden}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <span className="meta">
          {content.length.toLocaleString()}자{dirty ? " · 수정됨" : ""}
        </span>
        <button
          type="button"
          className="ghost"
          disabled={busy || !dirty}
          onClick={() => saved && setContent(saved.content)}
        >
          되돌리기
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
          다시 불러오기
        </button>
        <button type="submit" disabled={busy || !dirty || !content.trim()}>
          {busy ? "…" : "저장"}
        </button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- 제보

const STATUSES = ["new", "checked", "fixed", "rejected"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  new: "새 제보",
  checked: "확인 중",
  fixed: "반영함",
  rejected: "반려",
};

const ISSUE_LABEL: Record<string, string> = {
  hours: "영업시간",
  address: "주소",
  closed: "폐업·휴업",
  phone: "전화",
  price: "요금·가격",
  location: "지도 위치",
  other: "기타",
};

interface Report {
  report_id: number;
  poi_id: number | null;
  place_name: string;
  place_addr: string | null;
  issue_type: string;
  detail: string;
  thread_id: string | null;
  status: Status;
  created_at: string;
}

interface ReportsRes {
  reports: Report[];
  counts: Record<Status, number>;
  limit: number;
}

interface ThreadMsg {
  role: string;
  text: string;
  images?: number;
  tools: string[];
  created_at: string;
}

function ReportsTab({ token, hidden, onUnauthorized }: TabProps) {
  const { api, busy, error } = useApi(token, onUnauthorized);
  const [filter, setFilter] = useState<Status | "all">("new");
  const [data, setData] = useState<ReportsRes | null>(null);

  const load = useCallback(async () => {
    const q = filter === "all" ? "" : `?status=${filter}`;
    const r = await api<ReportsRes>("GET", `/admin/reports${q}`);
    if (r) setData(r);
  }, [api, filter]);

  // 숨겨진 동안에는 부르지 않는다. 탭을 열 때마다 새로 받는다.
  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, load]);

  const setStatus = async (report: Report, status: Status) => {
    const r = await api<{ report_id: number; status: Status }>(
      "PATCH",
      `/admin/reports/${report.report_id}`,
      { status },
    );
    if (!r) return;
    // 목록을 다시 받지 않고 고친다 — API 는 요청 수 제한(nginx)을 받는다.
    setData((d) => {
      if (!d) return d;
      const counts = { ...d.counts };
      counts[report.status] -= 1;
      counts[status] += 1;
      const reports = d.reports
        .map((x) => (x.report_id === r.report_id ? { ...x, status } : x))
        .filter((x) => filter === "all" || x.status === filter);
      return { ...d, counts, reports };
    });
  };

  const total = data ? STATUSES.reduce((s, k) => s + data.counts[k], 0) : 0;

  return (
    <main hidden={hidden}>
      <div className="filters">
        {(["new", "checked", "fixed", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? "on" : ""}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "전체" : STATUS_LABEL[f]}
            {data && <span className="count">{f === "all" ? total : data.counts[f]}</span>}
          </button>
        ))}
        <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
          새로고침
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {data && data.reports.length === 0 && (
        <p className="empty-note">
          {filter === "new" ? "새 제보가 없습니다." : "해당하는 제보가 없습니다."}
        </p>
      )}

      {data?.reports.map((r) => (
        <ReportCard key={r.report_id} report={r} api={api} busy={busy} onStatus={setStatus} />
      ))}

      {data && data.reports.length >= data.limit && (
        <p className="meta">최근 {data.limit}건까지만 보여 줍니다.</p>
      )}
    </main>
  );
}

function ReportCard({
  report: r,
  api,
  busy,
  onStatus,
}: {
  report: Report;
  api: Api;
  busy: boolean;
  onStatus: (r: Report, s: Status) => void;
}) {
  const [thread, setThread] = useState<ThreadMsg[] | null>(null);
  const [open, setOpen] = useState(false);

  const toggleThread = async () => {
    if (!open && thread === null) {
      const res = await api<{ messages: ThreadMsg[] }>("GET", `/admin/reports/${r.report_id}/thread`);
      if (!res) return;
      setThread(res.messages);
    }
    setOpen((o) => !o);
  };

  return (
    <article className={`report status-${r.status}`}>
      <div className="report-head">
        <span className="issue">{ISSUE_LABEL[r.issue_type] ?? r.issue_type}</span>
        <strong>{r.place_name}</strong>
        <span className="meta">
          #{r.report_id} · {new Date(r.created_at).toLocaleString("ko-KR")}
        </span>
      </div>
      {r.place_addr && (
        <p className="meta">
          {r.place_addr}
          {r.poi_id != null && ` · poi_id ${r.poi_id}`}
        </p>
      )}
      <p className="detail">{r.detail}</p>

      <div className="report-actions">
        <div className="seg" role="group" aria-label="처리 상태">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={r.status === s ? "on" : ""}
              disabled={busy || r.status === s}
              onClick={() => onStatus(r, s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {r.thread_id && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void toggleThread()}>
            {open ? "대화 닫기" : "대화 보기"}
          </button>
        )}
      </div>

      {open && thread && (
        <ThreadView messages={thread} />
      )}
    </article>
  );
}

/** 저장된 챗봇 답변에는 추천 질문 블록이 붙어 있다 — 채팅 화면처럼 떼어서 보여 준다. */
function AssistantTurn({ text }: { text: string }) {
  const { body, followups } = splitAnswer(text);
  return (
    <>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
      {followups.length > 0 && <p className="meta">추천 질문: {followups.join(" / ")}</p>}
    </>
  );
}

/** 저장된 대화 — 제보·피드백 탭이 같이 쓴다. */
function ThreadView({ messages }: { messages: ThreadMsg[] }) {
  return (
    <div className="thread">
      {messages.length === 0 && <p className="meta">저장된 대화가 없습니다.</p>}
      {messages.map((m, i) => (
        <div key={i} className={`turn ${m.role}`}>
          <span className="who">{m.role === "user" ? "사용자" : "챗봇"}</span>
          <div>
            {m.images ? <p className="meta">[사진 {m.images}장]</p> : null}
            {m.text &&
              (m.role === "user" ? <p>{m.text}</p> : <AssistantTurn text={m.text} />)}
            {m.tools.length > 0 && <p className="meta">도구: {m.tools.join(", ")}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 피드백

type RatingFilter = "down" | "up" | "all";

interface FeedbackItem {
  feedback_id: number;
  thread_id: string;
  rating: 1 | -1;
  reason: string | null;
  question: string;
  answer: string;
  updated_at: string;
}

interface FeedbackRes {
  items: FeedbackItem[];
  counts: { up: number; down: number };
  limit: number;
}

function FeedbackTab({ token, hidden, onUnauthorized }: TabProps) {
  const { api, busy, error } = useApi(token, onUnauthorized);
  const [filter, setFilter] = useState<RatingFilter>("down");
  const [data, setData] = useState<FeedbackRes | null>(null);

  const load = useCallback(async () => {
    const q = filter === "all" ? "" : `?rating=${filter}`;
    const r = await api<FeedbackRes>("GET", `/admin/feedback${q}`);
    if (r) setData(r);
  }, [api, filter]);

  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, load]);

  const label: Record<RatingFilter, string> = { down: "싫어요", up: "좋아요", all: "전체" };
  const count = (f: RatingFilter) =>
    !data ? null : f === "all" ? data.counts.up + data.counts.down : data.counts[f];

  return (
    <main hidden={hidden}>
      <div className="filters">
        {(["down", "up", "all"] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {label[f]}
            {data && <span className="count">{count(f)}</span>}
          </button>
        ))}
        <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
          새로고침
        </button>
      </div>
      {data && data.counts.up + data.counts.down > 0 && (
        <p className="meta">
          만족도 {Math.round((data.counts.up / (data.counts.up + data.counts.down)) * 100)}% (좋아요{" "}
          {data.counts.up} · 싫어요 {data.counts.down})
        </p>
      )}

      {error && <div className="error">{error}</div>}
      {data && data.items.length === 0 && <p className="empty-note">해당하는 평가가 없습니다.</p>}
      {data?.items.map((it) => <FeedbackCard key={it.feedback_id} item={it} api={api} busy={busy} />)}
      {data && data.items.length >= data.limit && (
        <p className="meta">최근 {data.limit}건까지만 보여 줍니다.</p>
      )}
    </main>
  );
}

function FeedbackCard({ item, api, busy }: { item: FeedbackItem; api: Api; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadMsg[] | null>(null);
  const [full, setFull] = useState(false);

  const toggleThread = async () => {
    if (!open && thread === null) {
      const res = await api<{ messages: ThreadMsg[] }>(
        "GET",
        `/admin/threads/${encodeURIComponent(item.thread_id)}`,
      );
      if (!res) return;
      setThread(res.messages);
    }
    setOpen((o) => !o);
  };

  return (
    <article className={`report feedback ${item.rating > 0 ? "up" : "down"}`}>
      <div className="report-head">
        <span className="issue">{item.rating > 0 ? "좋아요" : "싫어요"}</span>
        <strong className="question">{item.question || "(질문 없음)"}</strong>
        <span className="meta">{new Date(item.updated_at).toLocaleString("ko-KR")}</span>
      </div>
      {item.reason && <p className="detail reason-text">이유: {item.reason}</p>}
      <div className={`answer${full ? " full" : ""}`}>
        <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.answer) }} />
      </div>
      <div className="report-actions">
        <button type="button" className="ghost" onClick={() => setFull((f) => !f)}>
          {full ? "답변 접기" : "답변 펼치기"}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void toggleThread()}>
          {open ? "대화 닫기" : "대화 보기"}
        </button>
      </div>
      {open && thread && <ThreadView messages={thread} />}
    </article>
  );
}

// ---------------------------------------------------------------- 버그 리포트

interface BugItem {
  bug_id: number;
  note: string | null;
  page_url: string;
  user_agent: string | null;
  status: Status;
  created_at: string;
  has_screenshot: boolean;
  screenshot_bytes: number;
  screen: string | null;
  console_count: number;
  error_count: number;
}

interface BugsRes {
  items: BugItem[];
  counts: Record<Status, number>;
  limit: number;
}

interface CaptureMeta {
  scale: number;
  width: number;
  height: number;
  viewport: { x: number; y: number; w: number; h: number };
}

interface BugDetail {
  bug_id: number;
  note: string | null;
  page_url: string;
  user_agent: string | null;
  status: Status;
  client_ip: string | null;
  created_at: string;
  has_screenshot: boolean;
  context: {
    app?: Record<string, unknown> & { capture?: CaptureMeta | null; build?: { time: string; commit: string } | null };
    environment?: Record<string, unknown>;
    state?: Record<string, unknown>;
    storage?: unknown;
    console?: { at: string; level: string; message: string }[];
    network?: { at: string; method: string; url: string; status: number | null; ms: number; error?: string }[];
    breadcrumbs?: { at: string; kind: string; detail: string }[];
    target?: unknown;
  };
}

/** 브라우저 이름을 짧게 — 목록용 */
function shortUa(ua: string | null): string {
  if (!ua) return "알 수 없음";
  const browser =
    /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "기타";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` · ${os}` : ""}`;
}

const time = (iso: string) => new Date(iso).toLocaleString("ko-KR");

function BugsTab({ token, hidden, onUnauthorized }: TabProps) {
  const { api, busy, error } = useApi(token, onUnauthorized);
  const [filter, setFilter] = useState<Status | "all">("new");
  const [data, setData] = useState<BugsRes | null>(null);

  const load = useCallback(async () => {
    const q = filter === "all" ? "" : `?status=${filter}`;
    const r = await api<BugsRes>("GET", `/admin/bug-reports${q}`);
    if (r) setData(r);
  }, [api, filter]);

  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, load]);

  const setStatus = async (item: BugItem, status: Status) => {
    const r = await api<{ bug_id: number; status: Status }>("PATCH", `/admin/bug-reports/${item.bug_id}`, { status });
    if (!r) return;
    setData((d) => {
      if (!d) return d;
      const counts = { ...d.counts };
      counts[item.status] -= 1;
      counts[status] += 1;
      const items = d.items
        .map((x) => (x.bug_id === item.bug_id ? { ...x, status } : x))
        .filter((x) => filter === "all" || x.status === filter);
      return { ...d, counts, items };
    });
  };

  const remove = async (item: BugItem) => {
    const r = await api<{ ok: boolean }>("DELETE", `/admin/bug-reports/${item.bug_id}`);
    if (!r) return;
    setData((d) =>
      d && {
        ...d,
        counts: { ...d.counts, [item.status]: d.counts[item.status] - 1 },
        items: d.items.filter((x) => x.bug_id !== item.bug_id),
      },
    );
  };

  const total = data ? STATUSES.reduce((n, k) => n + data.counts[k], 0) : 0;

  return (
    <main hidden={hidden}>
      <div className="filters">
        {(["new", "checked", "fixed", "rejected", "all"] as const).map((f) => (
          <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
            {f === "all" ? "전체" : STATUS_LABEL[f]}
            {data && <span className="count">{f === "all" ? total : data.counts[f]}</span>}
          </button>
        ))}
        <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
          새로고침
        </button>
      </div>
      <p className="meta">어느 화면에서든 우클릭 → "버그 리포트 보내기"로 접수됩니다.</p>

      {error && <div className="error">{error}</div>}
      {data && data.items.length === 0 && <p className="empty-note">해당하는 버그 리포트가 없습니다.</p>}
      {data?.items.map((it) => (
        <BugCard
          key={it.bug_id}
          item={it}
          token={token}
          api={api}
          busy={busy}
          onStatus={(st) => void setStatus(it, st)}
          onDelete={() => void remove(it)}
        />
      ))}
      {data && data.items.length >= data.limit && <p className="meta">최근 {data.limit}건까지만 보여 줍니다.</p>}
    </main>
  );
}

function BugCard({
  item,
  token,
  api,
  busy,
  onStatus,
  onDelete,
}: {
  item: BugItem;
  token: string;
  api: Api;
  busy: boolean;
  onStatus: (s: Status) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<BugDetail | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const toggle = async () => {
    if (!open && !detail) {
      const d = await api<BugDetail>("GET", `/admin/bug-reports/${item.bug_id}`);
      if (!d) return;
      setDetail(d);
    }
    setOpen((o) => !o);
  };

  return (
    <article className={`report bug status-${item.status}`}>
      <div className="report-head">
        <span className="issue">#{item.bug_id}</span>
        <strong className="question">{item.note || "(설명 없음)"}</strong>
        <span className="meta">{time(item.created_at)}</span>
      </div>
      <p className="meta">
        {item.screen ?? item.page_url} · {shortUa(item.user_agent)}
        {item.error_count > 0 && <span className="bug-errors"> · 오류 {item.error_count}건</span>}
        {item.has_screenshot && ` · 캡처 ${Math.round(item.screenshot_bytes / 1024)}KB`}
      </p>
      <div className="report-actions">
        <div className="seg" role="group" aria-label="처리 상태">
          {STATUSES.map((s) => (
            <button key={s} type="button" className={item.status === s ? "on" : ""} disabled={busy || item.status === s} onClick={() => onStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void toggle()}>
            {open ? "접기" : "자세히"}
          </button>
          <button
            type="button"
            className={`ghost danger${armed ? " armed" : ""}`}
            disabled={busy}
            onClick={() => (armed ? onDelete() : setArmed(true))}
          >
            {armed ? "정말 삭제" : "삭제"}
          </button>
        </div>
      </div>
      {open && detail && <BugDetailView detail={detail} token={token} />}
    </article>
  );
}

function Section({ title, count, children, open = false }: { title: string; count?: number; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="bug-section" open={open}>
      <summary>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </summary>
      {children}
    </details>
  );
}

const Json = ({ value }: { value: unknown }) => <pre className="json">{JSON.stringify(value, null, 2)}</pre>;

function BugDetailView({ detail, token }: { detail: BugDetail; token: string }) {
  const c = detail.context ?? {};
  const [copied, setCopied] = useState(false);
  const cons = c.console ?? [];
  const net = c.network ?? [];
  const crumbs = c.breadcrumbs ?? [];
  const env = c.environment as Record<string, unknown> | undefined;

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2)).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bug-detail">
      {detail.has_screenshot && <Screenshot id={detail.bug_id} token={token} meta={c.app?.capture ?? null} />}

      <dl className="bug-summary">
        <dt>화면</dt>
        <dd>{detail.page_url}</dd>
        <dt>시각</dt>
        <dd>{time(detail.created_at)}</dd>
        <dt>브라우저</dt>
        <dd>{detail.user_agent}</dd>
        {env && (
          <>
            <dt>창 크기</dt>
            <dd>
              {JSON.stringify((env.viewport as object) ?? {})} · DPR {String(env.devicePixelRatio)} · {String(env.language)} ·{" "}
              {String(env.timeZone)}
            </dd>
          </>
        )}
        <dt>빌드</dt>
        <dd>{c.app?.build ? `${c.app.build.commit} (${time(c.app.build.time)})` : "알 수 없음"}</dd>
        <dt>IP</dt>
        <dd>{detail.client_ip ?? "-"}</dd>
        {c.target != null && (
          <>
            <dt>우클릭한 곳</dt>
            <dd>{JSON.stringify(c.target)}</dd>
          </>
        )}
      </dl>

      <Section title="콘솔" count={cons.length} open={cons.some((x) => x.level === "error")}>
        <ul className="bug-log">
          {cons.length === 0 && <li className="meta">기록 없음</li>}
          {cons.map((x, i) => (
            <li key={i} className={`lv-${x.level}`}>
              <span className="meta">{x.at.slice(11, 23)}</span> <b>{x.level}</b> <code>{x.message}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="네트워크" count={net.length} open={net.some((n) => n.error || (n.status ?? 0) >= 400)}>
        <div className="bug-table-wrap">
          <table className="bug-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>요청</th>
                <th>상태</th>
                <th>ms</th>
              </tr>
            </thead>
            <tbody>
              {net.map((n, i) => (
                <tr key={i} className={n.error || (n.status ?? 0) >= 400 ? "bad" : ""}>
                  <td>{n.at.slice(11, 23)}</td>
                  <td>
                    {n.method} {n.url}
                  </td>
                  <td>{n.error ?? n.status ?? "…"}</td>
                  <td>{n.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="최근 동작" count={crumbs.length}>
        <ul className="bug-log">
          {crumbs.map((x, i) => (
            <li key={i}>
              <span className="meta">{x.at.slice(11, 23)}</span> <b>{x.kind}</b> <code>{x.detail}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="앱 상태 (내부 변수)" open>
        <Json value={c.state ?? {}} />
      </Section>
      <Section title="브라우저 환경">
        <Json value={env ?? {}} />
      </Section>
      <Section title="저장소">
        <Json value={c.storage ?? {}} />
      </Section>
      <Section title="앱 정보">
        <Json value={c.app ?? {}} />
      </Section>

      <div className="edit-actions">
        <button type="button" className="ghost" onClick={() => void copy()}>
          {copied ? "복사됨" : "전체 JSON 복사"}
        </button>
      </div>
    </div>
  );
}

/** 캡처는 관리자 토큰이 필요해서 <img src> 로 바로 못 건다 — 받아서 blob 주소로 보여 준다. */
function Screenshot({ id, token, meta }: { id: number; token: string; meta: CaptureMeta | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(!meta);

  useEffect(() => {
    let revoke: string | null = null;
    fetch(`${BASE}/admin/bug-reports/${id}/screenshot`, { headers: { ...TUNNEL_HEADERS, "x-admin-token": token } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      })
      .catch(() => setFailed(true));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [id, token]);

  if (failed) return <p className="meta">캡처를 불러오지 못했습니다.</p>;
  if (!url) return <p className="meta">캡처를 불러오는 중…</p>;

  // 보던 화면만: 페이지 전체 캡처에서 그 영역을 잘라 보여 준다
  // 카드 안에 들어오게 — 넓어도 720px, 좁은 창에서는 창 폭에 맞춘다
  const shown = Math.min(720, window.innerWidth - 90);
  const k = meta ? Math.min(1, shown / meta.width) : 1;
  const v = meta?.viewport;

  return (
    <div className="bug-screenshot">
      {meta && (
        <div className="seg">
          <button type="button" className={!full ? "on" : ""} onClick={() => setFull(false)}>
            보던 화면
          </button>
          <button type="button" className={full ? "on" : ""} onClick={() => setFull(true)}>
            전체 페이지
          </button>
        </div>
      )}
      {meta && v && !full ? (
        <div className="crop" style={{ width: v.w * k, height: v.h * k }}>
          <img
            src={url}
            alt="보던 화면"
            style={{ width: meta.width * k, height: meta.height * k, transform: `translate(${-v.x * k}px, ${-v.y * k}px)` }}
          />
        </div>
      ) : (
        <div className="full" style={meta ? { width: meta.width * k } : undefined}>
          <img src={url} alt="페이지 전체 캡처" />
          {meta && v && (
            <span
              className="viewport-mark"
              style={{ left: v.x * k, top: v.y * k, width: v.w * k, height: v.h * k }}
              title="사용자가 보던 영역"
            />
          )}
        </div>
      )}
    </div>
  );
}
