import { useEffect, useRef, useState } from "react";
import { useAppLocale } from "./AppLocaleContext.js";
import { splitAnswer } from "./answer.js";
import { plainText } from "./markdown.js";
import { searchChats, type ChatMeta, type RoutePlan, type SavedRoute, type SearchHit } from "./store.js";

export type Panel = "chats" | "routes";

function when(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function distance(m: number | null): string {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/** 오른쪽에서 열리는 보관함 — 대화 목록 / 저장한 경로. */
export function Library({
  panel,
  onPanel,
  onClose,
  chats,
  currentChat,
  busy,
  onOpenChat,
  onDeleteChat,
  onExportChat,
  routes,
  onRenameRoute,
  onDeleteRoute,
  onUseRoute,
}: {
  panel: Panel;
  onPanel: (p: Panel) => void;
  onClose: () => void;
  chats: ChatMeta[];
  currentChat: string;
  busy: boolean;
  onOpenChat: (id: string, msgId?: string) => void;
  onDeleteChat: (id: string) => void;
  onExportChat: (id: string) => void;
  routes: SavedRoute[];
  onRenameRoute: (id: string, title: string) => void;
  onDeleteRoute: (id: string) => void;
  onUseRoute: (r: SavedRoute) => void;
}) {
  const { t } = useAppLocale();
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const chatIds = new Set(chats.map((c) => c.id));

  return (
    <div className="library-backdrop" onClick={onClose}>
      <aside
        className="library"
        role="dialog"
        aria-modal="true"
        aria-label={t.library.label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="library-head">
          <nav className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "chats"} onClick={() => onPanel("chats")}>
              {t.library.chats} <span className="count">{chats.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={panel === "routes"} onClick={() => onPanel("routes")}>
              {t.library.routes} <span className="count">{routes.length}</span>
            </button>
          </nav>
          <button ref={closeBtn} type="button" className="ghost" onClick={onClose} aria-label={t.library.close}>
            {t.library.close}
          </button>
        </div>

        <p className="library-note">{t.library.note}</p>

        {panel === "chats" ? (
          <ChatsPanel
            chats={chats}
            currentChat={currentChat}
            busy={busy}
            onOpenChat={onOpenChat}
            onDeleteChat={onDeleteChat}
            onExportChat={onExportChat}
          />
        ) : (
          <ul className="route-list">
            {routes.length === 0 && (
              <li className="empty-note">{t.library.emptyRoutes}</li>
            )}
            {routes.map((r) => (
              <RouteItem
                key={r.id}
                route={r}
                busy={busy}
                chatExists={chatIds.has(r.chatId)}
                onRename={(t) => onRenameRoute(r.id, t)}
                onDelete={() => onDeleteRoute(r.id)}
                onUse={() => onUseRoute(r)}
                onOpenChat={() => onOpenChat(r.chatId, r.msgId)}
              />
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function ChatsPanel({
  chats,
  currentChat,
  busy,
  onOpenChat,
  onDeleteChat,
  onExportChat,
}: {
  chats: ChatMeta[];
  currentChat: string;
  busy: boolean;
  onOpenChat: (id: string, msgId?: string) => void;
  onDeleteChat: (id: string) => void;
  onExportChat: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  // 입력이 멈추면 찾는다 — 대화가 많으면 매 글자마다 전부 읽기엔 무겁다
  useEffect(() => {
    const t = setTimeout(
      () => setHits(q.trim() ? searchChats(q, (text) => plainText(splitAnswer(text).body)) : []),
      150,
    );
    return () => clearTimeout(t);
  }, [q, chats]);

  const searching = q.trim().length > 0;

  return (
    <>
      <input
        type="search"
        className="chat-search"
        placeholder="대화 내용 검색"
        aria-label="대화 내용 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {searching ? (
        <ul className="hit-list">
          {hits.length === 0 && <li className="empty-note">찾는 말이 들어간 대화가 없습니다.</li>}
          {hits.map((h) => (
            <li key={`${h.chatId}:${h.msgId}`}>
              <button type="button" disabled={busy} onClick={() => onOpenChat(h.chatId, h.msgId)}>
                <span className="meta">
                  {h.title} · {when(h.updatedAt)} · {h.role === "user" ? "내 질문" : "답변"}
                </span>
                <span className="snippet">
                  {h.before}
                  <mark>{h.match}</mark>
                  {h.after}
                </span>
              </button>
            </li>
          ))}
          {hits.length >= 50 && <li className="meta">앞의 50건만 보여 줍니다. 더 자세히 검색해 보세요.</li>}
        </ul>
      ) : (
        <ul className="chat-list">
          {chats.length === 0 && <li className="empty-note">아직 대화가 없습니다.</li>}
          {chats.map((c) => (
            <ChatItem
              key={c.id}
              chat={c}
              current={c.id === currentChat}
              busy={busy}
              onOpen={() => onOpenChat(c.id)}
              onDelete={() => onDeleteChat(c.id)}
              onExport={() => onExportChat(c.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** 지우기는 두 번 눌러야 한다 — 되돌릴 수 없다. */
function useConfirm(): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const ask = () => {
    if (armed) return true;
    setArmed(true);
    return false;
  };
  return [armed, ask];
}

function ChatItem({
  chat,
  current,
  busy,
  onOpen,
  onDelete,
  onExport,
}: {
  chat: ChatMeta;
  current: boolean;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [armed, ask] = useConfirm();
  return (
    <li className={current ? "current" : ""}>
      <button type="button" className="chat-open" disabled={busy || current} onClick={onOpen}>
        <span className="title">{chat.title}</span>
        <span className="meta">
          {when(chat.updatedAt)} · 메시지 {chat.count}
          {current && " · 지금 대화"}
        </span>
      </button>
      <button type="button" className="icon" disabled={busy && current} onClick={onExport} title="마크다운 파일로 받기">
        내보내기
      </button>
      <button
        type="button"
        className={`icon danger${armed ? " armed" : ""}`}
        disabled={busy && current}
        onClick={() => ask() && onDelete()}
      >
        {armed ? "정말 삭제" : "삭제"}
      </button>
    </li>
  );
}

function RouteItem({
  route,
  busy,
  chatExists,
  onRename,
  onDelete,
  onUse,
  onOpenChat,
}: {
  route: SavedRoute;
  busy: boolean;
  chatExists: boolean;
  onRename: (t: string) => void;
  onDelete: () => void;
  onUse: () => void;
  onOpenChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(route.title);
  const [armed, ask] = useConfirm();

  const commit = () => {
    if (draft.trim() && draft.trim() !== route.title) onRename(draft);
    setEditing(false);
  };

  return (
    <li className="route-item">
      {editing ? (
        <form
          className="rename"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            autoFocus
            value={draft}
            maxLength={60}
            aria-label="경로 이름"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(route.title);
                setEditing(false);
              }
            }}
          />
        </form>
      ) : (
        <button type="button" className="route-open" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="title">{route.title}</span>
          <span className="meta">
            {when(route.savedAt)} · {route.plan.stops.length}곳
            {route.plan.total_m > 0 && ` · 직선 ${distance(route.plan.total_m)}`}
          </span>
        </button>
      )}

      {open && <RouteStops plan={route.plan} />}

      <div className="route-actions">
        <button type="button" className="icon" disabled={busy} onClick={onUse}>
          대화에서 쓰기
        </button>
        {chatExists && (
          <button type="button" className="icon" disabled={busy} onClick={onOpenChat}>
            원래 대화
          </button>
        )}
        <button
          type="button"
          className="icon"
          onClick={() => {
            setDraft(route.title);
            setEditing(true);
          }}
        >
          이름 바꾸기
        </button>
        <button
          type="button"
          className={`icon danger${armed ? " armed" : ""}`}
          onClick={() => ask() && onDelete()}
        >
          {armed ? "정말 삭제" : "삭제"}
        </button>
      </div>
    </li>
  );
}

/** 방문순서 목록 — 저장한 경로 펼치기와 답변 아래 미리보기에서 같이 쓴다. */
export function RouteStops({ plan }: { plan: RoutePlan }) {
  return (
    <ol className="route-stops">
      {plan.start && (
        <li className="start">
          <span className="num">출발</span>
          <span className="name">{plan.start.name}</span>
        </li>
      )}
      {plan.stops.map((s) => (
        <li key={`${s.order}-${s.poi_id}`}>
          <span className="num">{s.order}</span>
          <span className="name">
            {s.name}
            {s.addr && <span className="meta">{s.addr}</span>}
          </span>
          <span className="leg">
            {s.from_prev_m != null && (
              <>
                {distance(s.from_prev_m)}
                {s.walk_min_est != null && ` · 도보 ${s.walk_min_est}분`}
              </>
            )}
            {s.directions_url && (
              <a href={s.directions_url} target="_blank" rel="noopener noreferrer">
                길찾기
              </a>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
