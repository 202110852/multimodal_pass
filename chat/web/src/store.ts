/**
 * 브라우저 보관함 — 대화 목록과 저장한 경로.
 *
 * 로그인이 없어서 이 브라우저(localStorage)에만 남는다. 기기를 바꾸거나 사이트 데이터를
 * 지우면 사라진다. 서버의 대화 기록(mastra 스레드)은 대화 id 로 이어지지만,
 * 목록에서 지워도 서버 쪽은 남는다 (web 키로는 /api/memory 를 못 쓴다 — auth.ts).
 *
 *   stan-jeju-chats          ChatMeta[]           대화 목록
 *   stan-jeju-chat:<id>      ChatRecord           대화별 메시지와 서버 스레드 id
 *                                                (예전 형식 Msg[] 은 읽을 때 바꾼다)
 *   stan-jeju-current        string               지금 열린 대화 id
 *   stan-jeju-routes         SavedRoute[]         저장한 경로
 *
 * localStorage 는 막혀 있거나(사생활 보호 모드) 가득 찰 수 있다. 저장이 실패해도
 * 대화는 계속되어야 하므로 모든 접근을 감싼다.
 */
import type { Mode } from "./tools.js";

const CHATS_KEY = "stan-jeju-chats";
const CHAT_PREFIX = "stan-jeju-chat:";
const CURRENT_KEY = "stan-jeju-current";
const ROUTES_KEY = "stan-jeju-routes";
// 예전 단일 대화 저장 형식 — 처음 열 때 한 번 옮긴다.
const LEGACY_THREAD_KEY = "stan-jeju-thread";
const LEGACY_MESSAGES_KEY = "stan-jeju-messages";

const MAX_CHATS = 30;
const MAX_MESSAGES = 100;
const MAX_ROUTES = 50;
const TITLE_LEN = 40;

// ---------------------------------------------------------------- 타입

export interface RouteStop {
  order: number;
  poi_id: number;
  name: string;
  addr: string | null;
  from_prev_m: number | null;
  walk_min_est: number | null;
  directions_url: string;
}

/** plan-visit-order 도구 결과에서 보관할 부분. */
export interface RoutePlan {
  start: { name: string; lat: number; lon: number } | null;
  stops: RouteStop[];
  total_m: number;
}

/** 검색·상세 도구에서 모은 장소 — 일정 답변에 plan-visit-order 가 없을 때 초안 경로용. */
export interface PlaceHit {
  poi_id: number;
  name: string;
  addr: string | null;
  /** place-detail 로 고른 곳이면 답변에 이름이 없어도 넣는다. */
  pinned?: boolean;
  /** 네이버/카카오 지도 링크 — 답변 보강에 쓴다 */
  map_url?: string | null;
}

export type Role = "user" | "assistant";

export interface Msg {
  id: string;
  role: Role;
  text: string;
  mode?: Mode | null;
  /** 사용자가 멈춘 답변. 받은 데까지만 남는다. */
  stopped?: boolean;
  /** 이 답변에서 짠 방문순서 — 경로 저장 버튼이 쓴다. */
  route?: RoutePlan;
  /** 질문에 첨부한 사진 (미리보기 data URL — attach.ts) */
  images?: string[];
  /**
   * 저장한 경로를 멘션처럼 붙였을 때.
   * 화면에는 title 칩만 보이고, 모델·서버에는 prompt(+ 사용자가 친 글)를 보낸다.
   */
  routeAttach?: { id: string; title: string; prompt: string };
  /** 답변 평가 — 서버(answer_feedback)에도 남는다 */
  feedback?: { rating: "up" | "down"; reason?: string };
}

/** 경로 멘션 + 사용자 글을 모델에 보낼 한 덩어리로. */
export function withRoutePrompt(
  text: string,
  route?: { prompt: string } | null,
): string {
  const typed = text.trim();
  if (!route) return typed;
  return typed ? `${route.prompt}\n\n${typed}` : route.prompt;
}

/**
 * 대화의 메시지와 서버 스레드. 대화 id 와 스레드 id 는 보통 같지만,
 * 수정 전/후 버전을 오가던 시기(2026-09)에 만든 대화는 스레드 id 가 다를 수 있다.
 * 지금은 질문을 고치면 뒤를 지우므로 갈래는 늘 하나다. 예전에 여럿 저장된 대화는
 * 읽을 때 마지막으로 보던 갈래만 남긴다 (loadChat).
 */
export interface ChatPath {
  thread: string;
  msgs: Msg[];
}

export interface ChatRecord {
  paths: ChatPath[];
  active: string;
}

export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  count: number;
}

export interface SavedRoute {
  id: string;
  title: string;
  savedAt: number;
  /** 경로를 짠 대화와 답변 — "원래 대화 보기", 중복 저장 방지에 쓴다. */
  chatId: string;
  msgId: string;
  plan: RoutePlan;
}

// ---------------------------------------------------------------- 저수준

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  const data = JSON.stringify(value);
  try {
    localStorage.setItem(key, data);
    return true;
  } catch {
    // 가득 찼으면 오래된 대화부터 하나씩 비우며 다시 해 본다. 지금 대화는 남긴다.
    // 목록 갱신까지 실패하면 같은 대화를 또 고르게 되므로, 고른 것은 건너뛰고 횟수도 묶는다.
    const tried = new Set<string>();
    for (let i = 0; i < MAX_CHATS && dropOldestChat(key, tried); i++) {
      try {
        localStorage.setItem(key, data);
        return true;
      } catch {
        /* 한 개 더 비운다 */
      }
    }
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 무시 */
  }
}

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------- 대화

/**
 * 대화 id = 서버 스레드 id. 질문 수정(서버 기록 자르기)이 이 id 만으로 열리므로
 * 추측하기 어렵게 만든다. crypto.randomUUID 가 없는 오래된 브라우저만 예전 방식.
 */
export const newChatId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? `web-${crypto.randomUUID()}` : uid("web");

const kept = (m: Msg) => Boolean(m.text || m.stopped || m.images?.length || m.routeAttach);

export function listChats(): ChatMeta[] {
  const list = read<ChatMeta[]>(CHATS_KEY, []);
  return (Array.isArray(list) ? list : []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const singlePath = (thread: string, msgs: Msg[] = []): ChatRecord => ({
  paths: [{ thread, msgs }],
  active: thread,
});

export function activePath(rec: ChatRecord): ChatPath {
  return rec.paths.find((p) => p.thread === rec.active) ?? rec.paths[0];
}

export function loadChat(id: string): ChatRecord {
  const raw = read<unknown>(CHAT_PREFIX + id, null);
  // 예전 형식 — 메시지 배열 하나 = 갈래 하나 (스레드 id = 대화 id)
  if (Array.isArray(raw)) return singlePath(id, (raw as Msg[]).filter(kept));
  const rec = raw as ChatRecord | null;
  if (!rec || !Array.isArray(rec.paths) || rec.paths.length === 0) return singlePath(id);
  const paths = rec.paths
    .filter((p) => p && typeof p.thread === "string" && Array.isArray(p.msgs))
    .map((p) => ({ thread: p.thread, msgs: p.msgs.filter(kept) }));
  if (paths.length === 0) return singlePath(id);
  const active = paths.find((p) => p.thread === rec.active) ?? paths[paths.length - 1];
  return { paths: [active], active: active.thread };
}

function titleOf(msgs: Msg[]): string {
  const first = msgs.find((m) => m.role === "user");
  const firstText = first?.text.trim() || first?.routeAttach?.title || "새 대화";
  const line = firstText.split("\n")[0];
  return line.length > TITLE_LEN ? `${line.slice(0, TITLE_LEN)}…` : line;
}

/** 대화를 저장하고 목록을 갱신한다. 빈 대화는 목록에 올리지 않는다. */
export function saveChat(id: string, rec: ChatRecord): ChatMeta[] {
  const cur = activePath(rec);
  const list = cur.msgs.filter(kept).slice(-MAX_MESSAGES);
  const paths = [{ ...cur, msgs: list }];
  if (list.length === 0) return listChats();

  write(CHAT_PREFIX + id, { paths, active: cur.thread } satisfies ChatRecord);
  const chats = listChats();
  const now = Date.now();
  const prev = chats.find((c) => c.id === id);
  const meta: ChatMeta = {
    id,
    title: prev?.title && prev.title !== "새 대화" ? prev.title : titleOf(list),
    createdAt: prev?.createdAt ?? now,
    updatedAt: prev && prev.count === list.length ? prev.updatedAt : now,
    count: list.length,
  };
  let next = [meta, ...chats.filter((c) => c.id !== id)];
  // 개수 상한 — 오래된 것부터 지운다. 저장 중인 대화와 지금 열린 대화는 남긴다.
  if (next.length > MAX_CHATS) {
    const current = read<string>(CURRENT_KEY, "");
    const keep = new Set([id, current]);
    const drop = next
      .filter((c) => !keep.has(c.id))
      .slice(MAX_CHATS - next.filter((c) => keep.has(c.id)).length);
    for (const old of drop) remove(CHAT_PREFIX + old.id);
    const dropped = new Set(drop.map((c) => c.id));
    next = next.filter((c) => !dropped.has(c.id));
  }
  write(CHATS_KEY, next);
  return next;
}

export function deleteChat(id: string): ChatMeta[] {
  remove(CHAT_PREFIX + id);
  const next = listChats().filter((c) => c.id !== id);
  write(CHATS_KEY, next);
  return next;
}

function dropOldestChat(exceptKey: string, tried: Set<string>): boolean {
  const chats = listChats();
  const current = read<string>(CURRENT_KEY, "");
  const victim = [...chats]
    .reverse()
    .find((c) => c.id !== current && CHAT_PREFIX + c.id !== exceptKey && !tried.has(c.id));
  if (!victim) return false;
  tried.add(victim.id);
  remove(CHAT_PREFIX + victim.id);
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats.filter((c) => c.id !== victim.id)));
  } catch {
    /* 무시 */
  }
  return true;
}

/** 지금 열린 대화 id. 예전 단일 대화 형식이 남아 있으면 목록으로 옮긴다. */
export function currentChatId(): string {
  const cur = read<string>(CURRENT_KEY, "");
  if (cur) return cur;

  let legacyId: string | null = null;
  try {
    legacyId = localStorage.getItem(LEGACY_THREAD_KEY);
  } catch {
    /* 무시 */
  }
  const id = legacyId || newChatId();
  if (legacyId) {
    const legacy = read<Msg[]>(LEGACY_MESSAGES_KEY, []);
    if (Array.isArray(legacy)) saveChat(id, singlePath(id, legacy));
    remove(LEGACY_THREAD_KEY);
    remove(LEGACY_MESSAGES_KEY);
  }
  setCurrentChatId(id);
  return id;
}

export function setCurrentChatId(id: string): void {
  write(CURRENT_KEY, id);
}

// ---------------------------------------------------------------- 경로

function asPlace(raw: unknown): PlaceHit | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.poi_id !== "number" || typeof p.name !== "string" || !p.name.trim()) return null;
  const map_url =
    typeof p.map_url === "string" && p.map_url.startsWith("https://map.naver.com/")
      ? p.map_url
      : typeof p.search_url === "string" && p.search_url.startsWith("https://map.naver.com/")
        ? p.search_url
        : null;
  return {
    poi_id: p.poi_id,
    name: p.name.trim(),
    addr: typeof p.addr === "string" ? p.addr : null,
    map_url,
  };
}

/** search-places · nearby-places · place-detail 결과에서 장소만 뽑는다. */
export function extractPlacesFromTool(toolName: string, result: unknown): PlaceHit[] {
  const name = toolName.replace(/_/g, "-");
  const pinned = name === "place-detail" || toolName === "placeDetail";
  if (pinned) {
    const one = asPlace(result);
    return one ? [{ ...one, pinned: true }] : [];
  }
  const listTools = new Set([
    "search-places",
    "searchPlaces",
    "nearby-places",
    "nearbyPlaces",
    "search-downtown-stores",
    "searchDowntownStores",
  ]);
  if (!listTools.has(toolName) && !listTools.has(name)) return [];
  const results = (result as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: PlaceHit[] = [];
  for (const row of results) {
    const p = asPlace(row);
    if (p) out.push(p);
  }
  return out;
}

/**
 * 일정·후보 답변용 초안 경로.
 * 답변 본문에 이름이 나온 장소(+ place-detail)만 넣고, 본문에 나온 순서를 따른다.
 * plan-visit-order 결과가 있으면 그걸 쓰고, 없을 때만 이걸로 저장 버튼을 붙인다.
 */
export function draftRouteFromPlaces(places: PlaceHit[], answerText: string): RoutePlan | null {
  if (!places.length) return null;
  const byId = new Map<number, PlaceHit>();
  for (const p of places) {
    const prev = byId.get(p.poi_id);
    if (!prev || (p.pinned && !prev.pinned)) byId.set(p.poi_id, p);
  }
  const picked = [...byId.values()].filter((p) => p.pinned || answerText.includes(p.name));
  if (picked.length === 0) return null;

  picked.sort((a, b) => {
    const ia = answerText.indexOf(a.name);
    const ib = answerText.indexOf(b.name);
    // 본문에 없으면( pinned ) 뒤로
    const sa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
    const sb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
    return sa - sb || a.poi_id - b.poi_id;
  });

  const stops: RouteStop[] = picked.slice(0, 12).map((p, i) => ({
    order: i + 1,
    poi_id: p.poi_id,
    name: p.name,
    addr: p.addr,
    from_prev_m: null,
    walk_min_est: null,
    directions_url: "",
  }));
  return { start: null, stops, total_m: 0 };
}

/** 도구 결과가 기대한 모양인지 확인하고 보관할 부분만 뽑는다. 모양이 다르면 null. */
export function parseRoutePlan(result: unknown): RoutePlan | null {
  const r = result as Partial<RoutePlan> | null;
  if (!r || !Array.isArray(r.stops) || r.stops.length === 0) return null;
  const stops = r.stops
    .filter((s) => s && typeof s.name === "string" && typeof s.poi_id === "number")
    .map((s) => ({
      order: Number(s.order),
      poi_id: s.poi_id,
      name: s.name,
      addr: s.addr ?? null,
      from_prev_m: s.from_prev_m ?? null,
      walk_min_est: s.walk_min_est ?? null,
      // 링크로 그대로 쓰므로 우리가 만드는 네이버지도 주소만 받는다 (javascript: 등 차단)
      directions_url:
        typeof s.directions_url === "string" && s.directions_url.startsWith("https://map.naver.com/")
          ? s.directions_url
          : "",
    }));
  if (stops.length === 0) return null;
  const start = r.start && typeof r.start.name === "string" ? r.start : null;
  return { start, stops, total_m: Number(r.total_m) || 0 };
}

export function routeTitle(plan: RoutePlan): string {
  const names = plan.stops.map((s) => s.name);
  if (names.length <= 3) return names.join(" → ");
  return `${names.slice(0, 2).join(" → ")} 외 ${names.length - 2}곳`;
}

export function listRoutes(): SavedRoute[] {
  const list = read<SavedRoute[]>(ROUTES_KEY, []);
  return (Array.isArray(list) ? list : []).sort((a, b) => b.savedAt - a.savedAt);
}

/** 저장 실패(가득 참)면 null. */
export function saveRoute(plan: RoutePlan, chatId: string, msgId: string): SavedRoute[] | null {
  const routes = listRoutes();
  if (routes.some((r) => r.msgId === msgId)) return routes;
  const route: SavedRoute = { id: uid("route"), title: routeTitle(plan), savedAt: Date.now(), chatId, msgId, plan };
  const next = [route, ...routes].slice(0, MAX_ROUTES);
  return write(ROUTES_KEY, next) ? next : null;
}

export function renameRoute(id: string, title: string): SavedRoute[] {
  const t = title.trim().slice(0, 60);
  const next = listRoutes().map((r) => (r.id === id && t ? { ...r, title: t } : r));
  write(ROUTES_KEY, next);
  return next;
}

export function deleteRoute(id: string): SavedRoute[] {
  const next = listRoutes().filter((r) => r.id !== id);
  write(ROUTES_KEY, next);
  return next;
}

/** 저장한 경로를 대화에 다시 가져갈 때 입력창에 넣는 글. poi_id 가 있어야 챗봇이 다시 짤 수 있다. */
export function routePrompt(route: SavedRoute): string {
  const lines = [`저장해 둔 경로 "${route.title}"를 불러왔어요.`];
  if (route.plan.start) lines.push(`출발: ${route.plan.start.name}`);
  for (const s of route.plan.stops) lines.push(`${s.order}. ${s.name} (poi_id ${s.poi_id})`);
  lines.push("이 경로를 바탕으로 도와주세요.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- 검색

export interface SearchHit {
  chatId: string;
  title: string;
  updatedAt: number;
  msgId: string;
  role: Role;
  /** 찾은 말 앞뒤를 잘라 둔 글 — before / match / after */
  before: string;
  match: string;
  after: string;
}

const SNIPPET = 36;
const MAX_HITS = 50;

/** 모든 대화에서 글을 찾는다 (대소문자·공백 차이 무시). clean 으로 추천 질문·마크다운 기호를 걷어 낸다. */
export function searchChats(q: string, clean: (text: string) => string = (t) => t): SearchHit[] {
  const needle = q.trim().replace(/\s+/g, " ").toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const chat of listChats()) {
    for (const m of activePath(loadChat(chat.id)).msgs) {
      const text = clean(m.text).replace(/\s+/g, " ");
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const end = at + needle.length;
      hits.push({
        chatId: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        msgId: m.id,
        role: m.role,
        before: (at > SNIPPET ? "…" : "") + text.slice(Math.max(0, at - SNIPPET), at),
        match: text.slice(at, end),
        after: text.slice(end, end + SNIPPET) + (text.length > end + SNIPPET ? "…" : ""),
      });
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}
