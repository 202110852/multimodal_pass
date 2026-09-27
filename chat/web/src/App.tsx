import { MastraClient, RequestContext } from "@mastra/client-js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { splitAnswer } from "./answer.js";
import { MAX_IMAGES, imagePart, prepareImage, type Attachment } from "./attach.js";
import { downloadChat } from "./exportChat.js";
import { registerState } from "./debug/collector.js";
import { Library, type Panel } from "./Library.js";
import { markdownBlocks } from "./markdown.js";
import { ProfileSetup } from "./ProfileSetup.js";
import { useAppLocale } from "./AppLocaleContext.js";
import { hasProfile, loadProfile, profileForAgent, type UserProfile } from "./profile.js";
import { agentUserText, resolveReplyLang } from "./replyLang.js";
import { hostedChat } from "./embed.js";
import {
  activePath,
  currentChatId,
  deleteChat,
  deleteRoute,
  draftRouteFromPlaces,
  extractPlacesFromTool,
  listChats,
  listRoutes,
  loadChat,
  newChatId,
  parseRoutePlan,
  renameRoute,
  routePrompt,
  saveChat,
  saveRoute,
  setCurrentChatId,
  toggleRouteFavorite,
  withRoutePrompt,
  type ChatRecord,
  type Msg,
  type PlaceHit,
  type RoutePlan,
  type SavedRoute,
} from "./store.js";
import { ensureAnswerMapLinks, extractMapLinksFromTool, type MapLinkHit } from "./mapLink.js";
import { applyProfileSuggestions } from "./profileSuggestions.js";

/** 입력창·메시지에 붙는 경로 멘션 (화면에는 제목만). */
export type RouteMention = { id: string; title: string; prompt: string };
import { modeOf, toolLabel } from "./tools.js";
import { useVoiceInput, voiceSupported } from "./voice.js";

const AGENT_ID = "jeju-agent";

// 대화는 Mastra storage(로컬 LibSQL 또는 Postgres)에 스레드로 남는다. 스레드 id = 브라우저 보관함의 대화 id.
// 대화 목록·메시지·저장한 경로는 store.ts 가 localStorage 에 둔다.
const PLAN_TOOLS = new Set(["plan-visit-order", "planVisitOrder"]);

// 개발: 같은 오리진 + Vite 프록시(기본 배포 API api.stan.lkim.me).
// 로컬 Mastra: MASTRA_URL=http://127.0.0.1:4111. 배포 번들: VITE_MASTRA_URL.
// 이 키는 번들에 들어가므로 비밀이 아니다. 남의 사이트에서 우리 API 를 쓰는 것과
// 무심한 스크래핑을 막는 용도이고, 비용 상한은 nginx 의 요청 수 제한이 잡는다.
const API_KEY = import.meta.env.VITE_API_KEY;

const BASE_URL = import.meta.env.VITE_MASTRA_URL || window.location.origin;

// 멈춤을 위해 요청마다 만든다 — client-js 는 abortSignal 을 클라이언트 옵션으로만 받는다.
function makeClient(abortSignal: AbortSignal): MastraClient {
  return new MastraClient({
    baseUrl: BASE_URL,
    abortSignal,
    ...(API_KEY ? { headers: { "x-api-key": API_KEY } } : {}),
  });
}

/**
 * 사진만 보내고 글을 비웠을 때 넣는 질문. 화면에도 이 글로 남긴다 — 질문 수정이 서버 기록과 글로 맞춰 보기 때문.
 * 선택된 채팅 언어에 맞춘다 (iframe에서는 호스트 사이트의 언어).
 */
const IMAGE_ONLY_TEXT = {
  ko: "이 사진에 대해 알려줘",
  ja: "この写真について教えてください",
  zh: "请介绍一下这张照片",
  en: "Tell me about this photo",
};

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
    body: JSON.stringify(body),
  });
}

/**
 * 스트림 중 오류를 사람이 읽을 수 있는 문장으로. 402(크레딧 소진)가 제일 흔하다 —
 * 그냥 두면 답이 도입부에서 잘린 채 끝나서 원인을 알 수 없다.
 */
function describeError(err: unknown): string {
  const raw =
    typeof err === "string" ? err : JSON.stringify(err ?? {}, null, 0);
  if (/402|크레딧|credit|Payment Required/i.test(raw)) {
    return (
      "LLM 크레딧·모델 권한 문제로 답변을 끝내지 못했습니다.\n" +
      "FactChat 은 개인 크레딧을, OmniRoute 는 대시보드 Logs 와 LLM_MODEL 을 확인해 주세요."
    );
  }
  if (/429|rate.?limit/i.test(raw)) return "요청이 몰려 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  if (/proxy_unreachable|ECONNREFUSED|502/i.test(raw))
    return (
      "백엔드에 닿지 못했습니다.\n" +
      "로컬 백엔드를 띄웠다면 MASTRA_URL 로 주소를 지정하세요 " +
      "(예: MASTRA_URL=http://127.0.0.1:4470 npm run dev)."
    );
  if (/origin_not_allowed|403 Forbidden/i.test(raw))
    return "허용되지 않은 출처입니다. 배포 API 의 Origin 허용목록을 확인하세요.";
  if (/401|unauthorized/i.test(raw)) return "API 인증에 실패했습니다. 키를 확인해 주세요.";
  if (/403|forbidden/i.test(raw)) return "접근이 거부되었습니다.";
  return `응답 중 오류가 발생했습니다.\n${raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 200)}`;
}

/** 지도에서 정한 경로 — 입력창에 붙일 멘션과 "저장한 경로" 에 넣을 계획 */
export type MapRouteRequest = RouteMention & { plan: RoutePlan };

type AppProps = {
  /** 지도에서 "경로 저장하기" 를 누를 때마다 새 id 로 들어온다 — 경로를 저장하고, 새 대화를 열어 입력창에 붙인다 */
  routeRequest?: MapRouteRequest | null;
  /** 지도 화면 안에서 열렸을 때만 준다 — 저장한 경로의 "지도에서 보기" */
  onShowRouteOnMap?: (route: SavedRoute) => void;
  /** 지도의 "저장 목록" 을 누를 때마다 늘어난다 — 보관함의 "저장한 경로" 탭을 연다 (0 이면 요청 없음) */
  savedRoutesRequest?: number;
  /**
   * 지도 화면에서만 준다 — 챗봇 창이 숨겨져 있어도 보관함을 띄울 수 있게 보관함을 창 밖(body)에 그리고,
   * 보관함에서 대화가 필요한 동작(대화에서 쓰기 · 대화 열기)을 하면 이걸 불러 챗봇 창을 연다.
   */
  onRevealChat?: () => void;
};

export function App({ routeRequest = null, onShowRouteOnMap, savedRoutesRequest = 0, onRevealChat }: AppProps = {}) {
  const { t, locale } = useAppLocale();
  // 클론 직후에는 .env.local 이 없어 키가 비어 있다. 요청을 보내 401 을 받기 전에
  // 화면에서 먼저 알려 준다 — 그러지 않으면 원인을 짐작하기 어렵다.
  const missingKey = !API_KEY;
  const [chatId, setChatId] = useState(currentChatId);
  // 대화 하나에 갈래(수정 전/후 버전)가 여럿일 수 있다. 화면은 지금 갈래만 그린다.
  const [chat, setChat] = useState<ChatRecord>(() => loadChat(chatId));
  const messages = activePath(chat).msgs;
  const [chats, setChats] = useState(listChats);
  const [routes, setRoutes] = useState(listRoutes);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  /** 사용자가 위로 올리면 false — 답변 스트리밍 중에도 강제로 맨 아래로 끌어내리지 않는다 */
  const stickBottom = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const placeholderFit = useRef<HTMLSpanElement>(null);
  const composerField = useRef<HTMLDivElement>(null);
  const composerRow = useRef<HTMLDivElement>(null);
  const aborter = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachedRoute, setAttachedRoute] = useState<RouteMention | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** 검색 결과에서 연 메시지 — 그 자리로 스크롤하고 잠깐 강조한다 */
  const [focusMsg, setFocusMsg] = useState<string | null>(null);
  /** 최초 오픈 시 프로필이 없으면 입력창을 연다 (임베드 포함). 새 대화는 일반 모드만. */
  const [profileOpen, setProfileOpen] = useState(() => !hasProfile());
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile());
  const [suggestions, setSuggestions] = useState(t.suggestions);
  const canVoice = voiceSupported();
  const voice = useVoiceInput((text) => {
    setInput((v) => (v.trim() ? `${v.trimEnd()} ${text}` : text));
    box.current?.focus();
  }, locale);

  useEffect(() => {
    window.addEventListener("stan-chat:hide", voice.stop);
    return () => window.removeEventListener("stan-chat:hide", voice.stop);
  }, [voice.stop]);

  // 빈 화면 칩: 프로필(0·1·3) + 기상청 예보(2). 쿠폰(4)은 고정.
  useEffect(() => {
    const withProfile = applyProfileSuggestions(t.suggestions, profile, locale);
    setSuggestions(withProfile);
    if (missingKey) return;
    let cancelled = false;
    const lang = locale;
    (async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/chat/weather-suggestion?lang=${encodeURIComponent(lang)}`,
          { headers: { ...(API_KEY ? { "x-api-key": API_KEY } : {}) } },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { text?: string; index?: number };
        if (cancelled || typeof data.text !== "string" || !data.text.trim()) return;
        const idx =
          typeof data.index === "number" && data.index >= 0 ? data.index : t.weatherSuggestionIndex;
        setSuggestions((prev) => {
          const base = prev.length ? prev : withProfile;
          if (idx >= base.length) return base;
          const next = [...base];
          next[idx] = data.text!;
          return next;
        });
      } catch {
        /* 실패 시 프로필·기본 칩 유지 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, t.suggestions, t.weatherSuggestionIndex, missingKey, profile]);

  const composerPlaceholder = voice.listening ? t.app.listening : t.app.placeholder;
  // 모바일에서 placeholder 가 두 줄로 줄바꿈되면 field-sizing 때문에 입력칸이 두꺼워진다.
  // 네이티브 placeholder 대신 한 줄 오버레이를 쓰고, 가로가 부족하면 scale 로 줄인다.
  useLayoutEffect(() => {
    const span = placeholderFit.current;
    if (!span || input) return;
    const fit = () => {
      span.style.transform = "scale(1)";
      const avail = span.parentElement?.clientWidth ?? span.clientWidth;
      const need = span.scrollWidth;
      const s = need > 0 ? Math.min(1, avail / need) : 1;
      span.style.transform = `scale(${s})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    const shell = span.parentElement;
    if (shell) ro.observe(shell);
    ro.observe(span);
    return () => ro.disconnect();
  }, [input, composerPlaceholder, canVoice, attachedRoute]);

  // 사진 첨부 버튼 가로는 빈 입력(한 줄) 높이. 줄이 늘면 세로만 입력창에 맞춘다.
  useLayoutEffect(() => {
    const field = composerField.current;
    const row = composerRow.current;
    const ta = box.current;
    if (!field || !row || !ta) return;
    const sync = () => {
      const taCs = getComputedStyle(ta);
      const fontSize = parseFloat(taCs.fontSize) || 15;
      const line =
        taCs.lineHeight === "normal" ? fontSize * 1.2 : parseFloat(taCs.lineHeight) || fontSize * 1.7;
      const taChrome =
        (parseFloat(taCs.paddingTop) || 0) +
        (parseFloat(taCs.paddingBottom) || 0) +
        (parseFloat(taCs.borderTopWidth) || 0) +
        (parseFloat(taCs.borderBottomWidth) || 0);
      const fieldCs = getComputedStyle(field);
      const fieldChrome =
        (parseFloat(fieldCs.paddingTop) || 0) +
        (parseFloat(fieldCs.paddingBottom) || 0) +
        (parseFloat(fieldCs.borderTopWidth) || 0) +
        (parseFloat(fieldCs.borderBottomWidth) || 0);
      const base = Math.round(line + taChrome + fieldChrome);
      if (base > 0) row.style.setProperty("--attach-size", `${base}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(field);
    return () => ro.disconnect();
  }, []);

  // 답변 속 사진이 깨지면 빈 틀 대신 숨긴다. error 는 버블링하지 않아 캡처로 잡는다.
  useEffect(() => {
    const hide = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLImageElement && t.classList.contains("photo")) t.hidden = true;
    };
    document.addEventListener("error", hide, true);
    return () => document.removeEventListener("error", hide, true);
  }, []);

  // 버그 리포트에 담을 내부 상태 — 늘 최신 값을 읽도록 ref 로 둔다
  const debugSnapshot = useRef<() => unknown>(() => null);
  debugSnapshot.current = () => ({
    chatId,
    activeThread: chat.active,
    busy,
    status,
    error,
    notice,
    panel,
    focusMsg,
    preparing,
    dragging,
    input,
    attachments: attachments.map((a) => ({ id: a.id, sendChars: a.send.length, thumbChars: a.thumb.length })),
    attachedRoute: attachedRoute ? { id: attachedRoute.id, title: attachedRoute.title } : null,
    voice: { supported: canVoice, listening: voice.listening, error: voice.error },
    missingKey,
    profile: profile
      ? {
          transport: profile.transport ?? [],
          travelTypes: profile.travelTypes ?? [],
          nationality: profile.nationality ?? null,
          ageGroup: profile.ageGroup ?? null,
          language: profile.language ?? null,
          accessibility: profile.accessibility ?? [],
          fuelType: profile.fuelType ?? null,
          chargePorts: profile.chargePorts ?? [],
          parkingPrivileges: profile.parkingPrivileges ?? [],
          electricCar: profile.fuelType === "ev",
        }
      : null,
    messageCount: messages.length,
    messages: messages.slice(-30).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      mode: m.mode ?? null,
      stopped: m.stopped ?? false,
      images: m.images?.length ?? 0,
      route: m.route ? m.route.stops.map((s) => s.name) : null,
      feedback: m.feedback ?? null,
    })),
    chats: chats.map((c) => ({ id: c.id, title: c.title, count: c.count, updatedAt: c.updatedAt })),
    routes: routes.map((r) => ({ id: r.id, title: r.title, stops: r.plan.stops.length, chatId: r.chatId })),
  });
  useEffect(() => registerState("chat", () => debugSnapshot.current()), []);

  const nearBottom = (threshold = 96) => {
    const main = mainRef.current;
    if (main) {
      const style = getComputedStyle(main);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return main.scrollHeight - main.scrollTop - main.clientHeight <= threshold;
      }
    }
    const doc = document.documentElement;
    return doc.scrollHeight - window.scrollY - window.innerHeight <= threshold;
  };

  useEffect(() => {
    const onScroll = () => {
      stickBottom.current = nearBottom();
    };
    const main = mainRef.current;
    main?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (focusMsg) return; // 검색으로 연 자리를 맨 아래 스크롤이 덮지 않게
    if (!stickBottom.current) return;
    // 스트리밍 중 smooth 는 사용자가 올린 스크롤을 계속 끌어내린다
    bottom.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth" });
  }, [messages, status, focusMsg, busy]);

  useEffect(() => {
    if (!focusMsg) return;
    const el = document.querySelector(`[data-msg-id="${CSS.escape(focusMsg)}"]`);
    el?.scrollIntoView({ block: "center" });
    el?.classList.add("flash");
    const t = setTimeout(() => {
      el?.classList.remove("flash");
      setFocusMsg(null);
    }, 2200);
    return () => clearTimeout(t);
  }, [focusMsg]);

  useEffect(() => {
    if (voice.error) setNotice(voice.error);
  }, [voice.error]);

  // 스트리밍 중에는 매 토큰마다 쓰지 않는다. 답이 끝난 뒤 한 번 저장한다.
  useEffect(() => {
    if (!busy) setChats(saveChat(chatId, chat));
  }, [chatId, chat, busy]);

  /** 특정 갈래의 메시지를 고친다. 스트리밍은 시작할 때의 갈래에 쓴다 (도중에 바뀌어도 섞이지 않게). */
  const updatePath = useCallback((thread: string, fn: (m: Msg[]) => Msg[]) => {
    setChat((c) => ({
      ...c,
      paths: c.paths.map((p) => (p.thread === thread ? { ...p, msgs: fn(p.msgs) } : p)),
    }));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * thread 를 주면 그 갈래에 보낸다 (질문 수정으로 방금 만든 갈래 — 상태가 아직 안 바뀌었다).
   * images 를 주면 그 사진을 보낸다. 안 주면 입력창에 붙여 둔 사진을 보낸다.
   * route 를 주면 그 경로 멘션을 쓴다. 안 주면(새 질문) 입력창에 붙인 경로를 쓴다.
   */
  const send = useCallback(
    async (
      text: string,
      target?: string,
      images?: { send: string; thumb: string }[],
      /** 이 질문이 그 대화의 몇 번째(0부터) 질문인지 — 멈춤으로 되돌릴 때 서버 기록에서 찾는다 */
      nthOverride?: number,
      route?: RouteMention | null,
    ) => {
      const pics = images ?? (target === undefined ? attachments : []);
      const mention = route !== undefined ? route : target === undefined ? attachedRoute : null;
      const typed = text.trim();
      const agentBody = withRoutePrompt(typed, mention);
      // 경로·사진만 있어도 보낸다. 화면에는 사용자가 친 글(+ 경로 칩)만 남긴다.
      if ((!typed && !mention && !pics.length) || busy || missingKey || preparing) return;
      stickBottom.current = true;
      if (!agentBody && !pics.length) return;
      const thread = target ?? chat.active;
      const nth = nthOverride ?? messages.filter((m) => m.role === "user").length;
      const setMessages = (fn: (m: Msg[]) => Msg[]) => updatePath(thread, fn);
      if (target === undefined) {
        setInput("");
        setAttachments([]);
        setAttachedRoute(null);
      }
      setError(null);
      setBusy(true);
      setStatus(t.app.thinking);

      let streamError: string | null = null;
      const used: string[] = [];
      const placeHits = new Map<number, PlaceHit>();
      const mapLinks: MapLinkHit[] = [];
      let plannedRoute = false;
      const replyId = `a-${Date.now()}`;
      const userId = `u-${Date.now()}`;
      const displayText = typed || (mention ? "" : IMAGE_ONLY_TEXT[locale]);
      setMessages((m) => [
        ...m,
        {
          id: userId,
          role: "user",
          text: displayText,
          ...(pics.length ? { images: pics.map((p) => p.thumb) } : {}),
          ...(mention ? { routeAttach: mention } : {}),
        },
        { id: replyId, role: "assistant", text: "" },
      ]);

      const ctrl = new AbortController();
      aborter.current = ctrl;
      const markStopped = () =>
        setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, stopped: true } : x)));

      // 프로필·UI 언어를 매 요청 시점에 다시 읽는다 (설정 직후 같은 스레드에서도 반영)
      const replyLang = resolveReplyLang(hostedChat ? locale : loadProfile()?.language ?? profile?.language, locale);
      const modelPayload = agentBody || IMAGE_ONLY_TEXT[locale];
      const modelText = agentUserText(modelPayload, replyLang);
      const agentProfile = profileForAgent(loadProfile() ?? profile);

      /**
       * 멈춤 = 보내기 취소. 서버에서 이 질문부터 지운 뒤, 화면에서도 지우고 글·사진·경로를 입력창에 돌려놓는다.
       * 서버는 멈춘 직후(0.3초 안)에 질문(과 받은 데까지의 답)을 저장하므로 조금 기다렸다 지운다.
       * 이 동안 busy 를 유지한다 — 되돌린 질문을 곧바로 다시 보내면 새 질문까지 지워질 수 있다.
       * 서버에서 못 지우면 예전처럼 "응답을 멈췄습니다"로 남긴다 (기억과 화면이 어긋나지 않게).
       */
      const retract = async () => {
        setStatus(t.app.stopping);
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let ok = false;
        try {
          for (const delay of [800, 1500]) {
            await wait(delay);
            const res = await postJson(`/chat/threads/${encodeURIComponent(thread)}/truncate`, {
              index: nth,
              text: modelText,
            });
            if (res.status === 409) continue; // 아직 저장 전일 수 있다
            if (!res.ok) break;
            ok = true;
            if (((await res.json()) as { deleted?: number }).deleted) break;
          }
        } catch {
          ok = false;
        }
        if (!ok) {
          markStopped();
          setNotice(t.app.retractFail);
          return;
        }
        setMessages((m) => {
          const at = m.findIndex((x) => x.id === userId);
          return at < 0 ? m : m.slice(0, at);
        });
        setInput((cur) => (cur.trim() ? cur : typed));
        if (pics.length) {
          setAttachments((cur) =>
            cur.length
              ? cur
              : pics.map((p, i) => ({ id: `${Date.now()}-${i}`, send: p.send, thumb: p.thumb })),
          );
        }
        if (mention) setAttachedRoute((cur) => cur ?? mention);
      };
      try {
        const agent = makeClient(ctrl.signal).getAgent(AGENT_ID);
        const input = pics.length
          ? [
              {
                role: "user" as const,
                content: [{ type: "text" as const, text: modelText }, ...pics.map((p) => imagePart(p.send))],
              },
            ]
          : modelText;
        const requestContext = new RequestContext();
        requestContext.set("replyLang", replyLang);
        if (agentProfile) requestContext.set("userProfile", agentProfile);
        const res = await agent.stream(input as Parameters<typeof agent.stream>[0], {
          memory: { thread, resource: "web" },
          maxSteps: 15,
          requestContext,
        });

        // chunk 는 SDK 의 판별 유니온이라 type 으로 좁히면 payload 가 따라온다
        await res.processDataStream({
          onChunk: async (chunk) => {
            if (chunk.type === "text-delta") {
              const piece = chunk.payload.text;
              if (!piece) return;
              setStatus(null);
              setMessages((m) =>
                m.map((x) => (x.id === replyId ? { ...x, text: x.text + piece } : x)),
              );
            } else if (chunk.type === "tool-call") {
              setStatus(toolLabel(chunk.payload.toolName, t.tool));
              used.push(chunk.payload.toolName);
              const mode = modeOf(used);
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, mode } : x)));
            } else if (chunk.type === "tool-result") {
              const toolName = chunk.payload.toolName;
              for (const link of extractMapLinksFromTool(toolName, chunk.payload.result)) {
                if (!mapLinks.some((x) => x.url === link.url)) mapLinks.push(link);
              }
              if (PLAN_TOOLS.has(toolName)) {
                // 방문순서 — 답변 아래 '이 경로 저장' 버튼이 쓴다. 여러 번 짜면 마지막 것.
                const route = parseRoutePlan(chunk.payload.result);
                if (route) {
                  plannedRoute = true;
                  setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, route } : x)));
                }
              } else {
                // 일정·후보만 짜도 저장할 수 있게 장소 후보를 모아 둔다.
                for (const p of extractPlacesFromTool(toolName, chunk.payload.result)) {
                  const prev = placeHits.get(p.poi_id);
                  if (!prev || (p.pinned && !prev.pinned)) placeHits.set(p.poi_id, p);
                }
              }
            } else if (chunk.type === "error") {
              // 스트림이 조용히 끝나면 답이 잘린 것처럼 보인다. 반드시 드러낸다.
              streamError = describeError(chunk.payload?.error);
            }
          },
        });
        // 모델이 지도 링크를 빼먹으면 이 턴 도구 결과로 보강하고,
        // plan-visit-order 가 없으면 답변에 나온 장소로 초안 경로를 붙인다.
        if (!ctrl.signal.aborted && !streamError && (mapLinks.length > 0 || placeHits.size > 0)) {
          setMessages((m) => {
            const reply = m.find((x) => x.id === replyId);
            if (!reply) return m;
            let text = reply.text;
            let route = reply.route;
            if (mapLinks.length > 0 && text) {
              const patched = ensureAnswerMapLinks(text, mapLinks, replyLang);
              if (patched !== text) text = patched;
            }
            if (!plannedRoute && !route && placeHits.size > 0) {
              route = draftRouteFromPlaces([...placeHits.values()], text) ?? undefined;
            }
            if (text === reply.text && route === reply.route) return m;
            return m.map((x) =>
              x.id === replyId ? { ...x, text, ...(route ? { route } : {}) } : x,
            );
          });
        }
        // 멈추면 client-js 는 예외 없이 스트림을 닫기도 하고(읽는 중), 던지기도 한다(연결 중).
        if (ctrl.signal.aborted) await retract();
        else if (streamError) setError(streamError);
      } catch (e) {
        if (ctrl.signal.aborted) {
          await retract();
          return;
        }
        setError(
          `응답을 받지 못했습니다: ${(e as Error).message}\n` +
            "VITE_API_KEY 와 프록시 대상(MASTRA_URL)을 확인하세요.",
        );
      } finally {
        aborter.current = null;
        setBusy(false);
        setStatus(null);
        // 모바일은 키보드가 다시 올라오면 화면이 가려지므로 답변 후 자동 포커스하지 않는다.
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          box.current?.focus();
        }
      }
    },
    [busy, missingKey, chat.active, updatePath, attachments, attachedRoute, preparing, messages, t, profile, locale],
  );

  const stop = () => aborter.current?.abort();

  /**
   * 질문 수정 후 재전송. 그 질문부터 뒤의 대화를 화면과 서버 기억에서 지우고 새로 받는다.
   * 화면은 바로 지운다. 서버에서 못 지우면 되돌리고 보내지 않는다 — 서버에 수정 전 대화가
   * 남은 채로 답이 나오면 기억이 어긋난다 (chat/src/mastra/chat.ts 의 truncate).
   */
  const resend = async (index: number, text: string): Promise<boolean> => {
    const original = messages[index];
    if (busy || missingKey || !original || original.role !== "user") return false;
    // 사진은 보관해 둔 미리보기로 다시 보낸다 (원본은 보관하지 않는다 — attach.ts)
    const pics = (original.images ?? []).map((u) => ({ send: u, thumb: u }));
    const mention = original.routeAttach ?? null;
    if (!text.trim() && !pics.length && !mention) return false;
    const thread = chat.active;
    const before = messages;
    const nth = messages.slice(0, index).filter((m) => m.role === "user").length;
    updatePath(thread, (m) => m.slice(0, index));
    setBusy(true);
    setError(null);
    setStatus(t.app.truncating);
    let ok = false;
    try {
      // 서버에는 언어 잠금이 붙은 글이 저장된다. 경로 멘션·예전 원문 조합을 모두 시도한다.
      const replyLang = resolveReplyLang(hostedChat ? locale : loadProfile()?.language ?? profile?.language, locale);
      const body = withRoutePrompt(original.text, mention);
      const candidates = [
        agentUserText(body, replyLang),
        body,
        agentUserText(original.text, replyLang),
        original.text,
      ].filter((v, i, arr) => v && arr.indexOf(v) === i);
      for (const text of candidates) {
        const res = await postJson(`/chat/threads/${encodeURIComponent(thread)}/truncate`, {
          index: nth,
          text,
        });
        if (res.ok) {
          ok = true;
          break;
        }
        if (res.status !== 409) {
          setError(
            describeError(`${res.status} ${await res.text().catch(() => "")}`),
          );
          break;
        }
      }
      if (!ok) {
        setError("이 질문은 서버 기록에서 찾지 못해 다시 보낼 수 없습니다. 새 대화에서 물어봐 주세요.");
      }
    } catch (e) {
      setError(`서버에 닿지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setStatus(null);
    }
    if (!ok) {
      updatePath(thread, () => before);
      return false;
    }
    void send(text, thread, pics, nth, mention);
    return true;
  };

  /** msgId 를 주면 열고 나서 그 메시지로 스크롤한다 (검색 결과). */
  const openChat = (id: string, msgId?: string) => {
    if (busy) return;
    stickBottom.current = !msgId;
    const rec = loadChat(id);
    setFocusMsg(msgId ?? null);
    setCurrentChatId(id);
    setChatId(id);
    setChat(rec);
    setError(null);
    setPanel(null);
  };

  const newChat = () => {
    if (busy) return;
    if (messages.length === 0) {
      // 이미 빈 새 대화 — 프로필만 없으면 다시 묻는다
      if (!hostedChat && !hasProfile()) setProfileOpen(true);
      return;
    }
    openChat(newChatId());
    if (!hostedChat && !hasProfile()) setProfileOpen(true);
    box.current?.focus();
  };

  const onProfileDone = (saved: UserProfile | null) => {
    setProfile(saved ?? loadProfile());
    setProfileOpen(false);
    box.current?.focus();
  };

  const removeChat = (id: string) => {
    setChats(deleteChat(id));
    if (id === chatId) openChat(newChatId());
  };

  const saveRouteOf = (msg: Msg) => {
    if (!msg.route) return;
    const next = saveRoute(msg.route, chatId, msg.id);
    if (next) {
      setRoutes(next);
      setNotice(t.app.routeSaved);
    } else {
      setNotice(t.app.routeSaveFail);
    }
  };

  // 답변을 받는 중이면 대화를 바꿀 수 없으므로, 끝난 뒤에 처리한다
  const handledRouteRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!routeRequest || busy || handledRouteRequest.current === routeRequest.id) return;
    handledRouteRequest.current = routeRequest.id;
    const targetChatId = messages.length > 0 ? newChatId() : chatId;
    if (targetChatId !== chatId) openChat(targetChatId);

    const { plan, ...mention } = routeRequest;
    const saved = saveRoute(plan, targetChatId, null, mention.title);
    if (saved) {
      setRoutes(saved);
      setNotice(t.app.routeSaved);
    } else {
      setNotice(t.app.routeSaveFail);
    }

    setInput("");
    setAttachments([]);
    setAttachedRoute(mention);
    setTimeout(() => box.current?.focus(), 0);
  }, [routeRequest, busy]);

  useEffect(() => {
    if (savedRoutesRequest > 0) setPanel("routes");
  }, [savedRoutesRequest]);

  const withLibraryPortal = (library: ReactNode) =>
    onRevealChat ? createPortal(<div className="library-layer">{library}</div>, document.body) : library;

  const applyRoute = (r: SavedRoute) => {
    setAttachedRoute({ id: r.id, title: r.title, prompt: routePrompt(r) });
    setPanel(null);
    onRevealChat?.();
    setTimeout(() => box.current?.focus(), 0);
  };

  const exportChat = (id: string) => {
    const rec = id === chatId ? chat : loadChat(id);
    const title = chats.find((c) => c.id === id)?.title ?? "대화";
    downloadChat(title, activePath(rec).msgs);
  };

  /** 사진 붙이기 — 버튼·붙여넣기·끌어다 놓기 공통 */
  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) return;
    const room = MAX_IMAGES - attachments.length;
    if (room <= 0) {
      setNotice(t.app.photoLimit(MAX_IMAGES));
      return;
    }
    if (list.length > room) setNotice(t.app.photoLimitPartial(room));
    setPreparing((n) => n + Math.min(room, list.length));
    for (const f of list.slice(0, room)) {
      try {
        const a = await prepareImage(f);
        setAttachments((cur) => (cur.length < MAX_IMAGES ? [...cur, a] : cur));
      } catch (e) {
        setNotice((e as Error).message);
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };

  /** 답변 평가. 같은 걸 다시 누르면 취소. 서버에 먼저 남기고, 실패하면 화면을 되돌린다. */
  const rate = async (msg: Msg, rating: "up" | "down" | null, reason?: string) => {
    const thread = chat.active;
    const idx = messages.findIndex((m) => m.id === msg.id);
    const question = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user")?.text ?? "";
    const prev = msg.feedback;
    const next = rating ? { rating, ...(reason ? { reason } : {}) } : undefined;
    const apply = (fb: Msg["feedback"]) =>
      updatePath(thread, (ms) => ms.map((m) => (m.id === msg.id ? { ...m, feedback: fb } : m)));
    apply(next);
    try {
      const res = await postJson("/chat/feedback", {
        threadId: thread,
        messageKey: msg.id,
        rating,
        reason: reason ?? null,
        question,
        answer: splitAnswer(msg.text).body,
      });
      if (!res.ok) throw new Error(String(res.status));
      if (rating === "down" && reason !== undefined) setNotice(t.app.feedbackThanks);
    } catch {
      apply(prev);
      setNotice(t.app.feedbackFail);
    }
  };

  const savedMsgIds = new Set(routes.map((r) => r.msgId));

  return (
    <div
      className={`app${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <header>
        <div>
          <h1>{t.app.title}</h1>
          <p>{t.app.subtitle}</p>
        </div>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => setPanel("chats")}>
            {t.app.chats}
          </button>
          <button type="button" className="ghost" onClick={() => setPanel("routes")}>
            {t.app.routes}{routes.length > 0 && <span className="count">{routes.length}</span>}
          </button>
          <button type="button" className="ghost" onClick={newChat} disabled={busy || messages.length === 0}>
            {t.app.newChat}
          </button>
          <button
            type="button"
            className="ghost profile-btn"
            onClick={() => setProfileOpen(true)}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5.5 19.5c1.8-3.2 4-4.8 6.5-4.8s4.7 1.6 6.5 4.8" />
            </svg>
            {t.app.settings}
          </button>
        </div>
      </header>

      {panel && withLibraryPortal(
        <Library
          panel={panel}
          onPanel={setPanel}
          onClose={() => setPanel(null)}
          chats={chats}
          currentChat={chatId}
          busy={busy}
          onOpenChat={(id, msgId) => {
            openChat(id, msgId);
            onRevealChat?.();
          }}
          onDeleteChat={removeChat}
          onExportChat={exportChat}
          routes={routes}
          onRenameRoute={(id, t) => setRoutes(renameRoute(id, t))}
          onToggleFavoriteRoute={(id) => setRoutes(toggleRouteFavorite(id))}
          onDeleteRoute={(id) => setRoutes(deleteRoute(id))}
          onUseRoute={applyRoute}
          onShowRouteOnMap={
            onShowRouteOnMap &&
            ((r) => {
              setPanel(null);
              onShowRouteOnMap(r);
            })
          }
        />,
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      {profileOpen && <ProfileSetup initial={profile} onDone={onProfileDone} />}

      <main ref={mainRef}>
        {missingKey && (
          <div className="error">{t.app.missingKey}</div>
        )}

        {messages.length === 0 && !missingKey && (
          <div className="empty">
            <p>{t.app.empty}</p>
            <div className="chips">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <UserMessage
              key={m.id}
              msg={m}
              busy={busy}
              onResend={(t) => resend(i, t)}
            />
          ) : (
            <AssistantMessage
              key={m.id}
              msg={m}
              streaming={busy && i === messages.length - 1}
              // 추천 질문은 마지막 답변에만. 지난 답변의 버튼은 맥락이 어긋난다.
              onAsk={!busy && i === messages.length - 1 ? (q) => void send(q) : undefined}
              routeSaved={savedMsgIds.has(m.id)}
              onSaveRoute={() => saveRouteOf(m)}
              onShowRoutes={() => setPanel("routes")}
              onRate={(r, reason) => rate(m, r, reason)}
            />
          ),
        )}

        {status && (
          <div className="row assistant">
            <div className="bubble status">
              <span className="dot" />
              {status}
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        <div ref={bottom} />
      </main>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {(attachments.length > 0 || preparing > 0) && (
          <div className="attachments">
            {attachments.map((a) => (
              <div key={a.id} className="thumb">
                <img src={a.thumb} alt="첨부한 사진" />
                <button
                  type="button"
                  aria-label="사진 빼기"
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </div>
            ))}
            {preparing > 0 && <div className="thumb loading" aria-label="사진 준비 중" />}
          </div>
        )}
        <div className="composer-row" ref={composerRow}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = ""; // 같은 사진을 다시 고를 수 있게
            }}
          />
          <button
            type="button"
            className="tool-btn"
            aria-label={t.app.attachPhoto}
            title={`${t.app.attachPhoto} (max ${MAX_IMAGES})`}
            disabled={busy || attachments.length >= MAX_IMAGES}
            onClick={() => fileInput.current?.click()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="M4 17l5-5 4 4 3-3 4 4" />
            </svg>
          </button>
          <div
            ref={composerField}
            className={`composer-field${canVoice ? " has-voice" : ""}${attachedRoute ? " has-mention" : ""}`}
          >
            {attachedRoute && (
              <div className="composer-mentions">
                <RouteMentionChip
                  title={attachedRoute.title}
                  onRemove={() => setAttachedRoute(null)}
                />
              </div>
            )}
            {!input && (
              <span className="composer-placeholder" aria-hidden="true">
                <span ref={placeholderFit} className="composer-placeholder-text">
                  {composerPlaceholder}
                </span>
              </span>
            )}
            <textarea
              ref={box}
              value={input}
              rows={1}
              aria-label={composerPlaceholder}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                // 한글 조합 중 Enter 는 글자 확정용이다 — 여기서 보내면 마지막 글자가 두 번 간다
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            {canVoice && (
              <button
                type="button"
                className={`tool-btn voice-in-field${voice.listening ? " listening" : ""}`}
                aria-label={voice.listening ? "음성 입력 끝내기" : "음성으로 입력"}
                title={voice.listening ? "다시 누르면 끝냅니다" : "음성으로 입력 (브라우저 음성인식)"}
                aria-pressed={voice.listening}
                disabled={busy && !voice.listening}
                onClick={() => (voice.listening ? voice.stop() : voice.start())}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                </svg>
              </button>
            )}
          </div>
          {busy ? (
            <button type="button" className="stop" onClick={stop} aria-label={t.app.stop}>
              {t.app.stop}
            </button>
          ) : (
            <button
              type="submit"
              disabled={
                (!input.trim() && attachments.length === 0 && !attachedRoute) ||
                preparing > 0 ||
                missingKey
              }
            >
              {t.app.send}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API 가 막힌 환경(오래된 브라우저·권한 거부) 대비
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/;

/** 복사한 글에는 사진 마크다운(주소 줄)이 섞이지 않게 뺀다. */
function copyable(body: string): string {
  return body
    .split("\n")
    .filter((l) => !IMAGE_LINE.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function UserMessage({
  msg,
  busy,
  onResend,
}: {
  msg: Msg;
  busy: boolean;
  onResend: (text: string) => Promise<boolean>;
}) {
  const { t } = useAppLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.text);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = area.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const submit = async () => {
    const t = draft.trim();
    if ((!t && !msg.images?.length && !msg.routeAttach) || busy) return;
    if (t === msg.text.trim()) {
      setEditing(false);
      return;
    }
    if (await onResend(t)) setEditing(false);
  };

  if (editing) {
    return (
      <div className="row user" data-msg-id={msg.id}>
        <form
          className="edit"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={area}
            value={draft}
            rows={2}
            aria-label={t.app.edit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(msg.text);
                setEditing(false);
              } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <p className="meta">
            {t.app.editMeta}
            {msg.images?.length ? t.app.editMetaPhotos(msg.images.length) : ""}
            {msg.routeAttach ? ` 경로 「${msg.routeAttach.title}」은 그대로 다시 붙습니다.` : ""}
          </p>
          <div className="edit-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setDraft(msg.text);
                setEditing(false);
              }}
            >
              {t.app.cancel}
            </button>
            <button type="submit" disabled={busy || (!draft.trim() && !msg.images?.length && !msg.routeAttach)}>
              {t.app.send}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="row user" data-msg-id={msg.id}>
      <div className="stack user-stack">
        {msg.images && msg.images.length > 0 && <PhotoStrip images={msg.images} />}
        {msg.routeAttach && <RouteMentionChip title={msg.routeAttach.title} />}
        {msg.text && <div className="bubble">{msg.text}</div>}
        <div className="user-tools">
          {!busy && (
            <div className="msg-tools">
              <button
                type="button"
                className="icon"
                onClick={async () => {
                  if (await copyText(msg.text)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
              >
                {copied ? t.app.copied : t.app.copy}
              </button>
              <button
                type="button"
                className="icon"
                onClick={() => {
                  setDraft(msg.text);
                  setEditing(true);
                }}
              >
                {t.app.edit}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  streaming,
  onAsk,
  routeSaved,
  onSaveRoute,
  onShowRoutes,
  onRate,
}: {
  msg: Msg;
  streaming: boolean;
  onAsk?: (q: string) => void;
  routeSaved: boolean;
  onSaveRoute: () => void;
  onShowRoutes: () => void;
  onRate: (rating: "up" | "down" | null, reason?: string) => void;
}) {
  const { t } = useAppLocale();
  const [copied, setCopied] = useState(false);
  const [askReason, setAskReason] = useState(false);
  const { body, followups } = splitAnswer(msg.text);
  // 답변 중 모드 뱃지는 본문보다 먼저 온다(tool 호출 시점). 본문 없을 때도 보여야 한다.
  const showMode = Boolean(streaming && msg.mode);
  if (!body && !msg.stopped && !showMode) return null;

  const copy = async () => {
    if (await copyText(copyable(body))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="row assistant" data-msg-id={msg.id}>
      <div className="stack">
        {streaming && msg.mode && (
          <span className={`mode mode-${msg.mode}`}>{t.mode[msg.mode]}</span>
        )}
        {body && (
          <div className="bubble md">
            {markdownBlocks(body).map((html, i) => (
              // 블록 순서는 뒤에만 붙으므로 인덱스 key 가 안정적이다
              <div key={i} className="md-block" dangerouslySetInnerHTML={{ __html: html }} />
            ))}
          </div>
        )}
        {!streaming && (
          <div className="msg-tools">
            {msg.stopped && <span className="stopped">{t.app.stopped}</span>}
            {body && (
              <>
                <button
                  type="button"
                  className={`icon vote${msg.feedback?.rating === "up" ? " on" : ""}`}
                  aria-label={t.app.like}
                  aria-pressed={msg.feedback?.rating === "up"}
                  title={t.app.like}
                  onClick={() => {
                    setAskReason(false);
                    onRate(msg.feedback?.rating === "up" ? null : "up");
                  }}
                >
                  <ThumbIcon />
                </button>
                <button
                  type="button"
                  className={`icon vote down${msg.feedback?.rating === "down" ? " on" : ""}`}
                  aria-label={t.app.dislike}
                  aria-pressed={msg.feedback?.rating === "down"}
                  title={t.app.dislike}
                  onClick={() => {
                    if (msg.feedback?.rating === "down") {
                      setAskReason(false);
                      onRate(null);
                    } else {
                      onRate("down");
                      setAskReason(true);
                    }
                  }}
                >
                  <ThumbIcon />
                </button>
                <button type="button" className="icon" onClick={() => void copy()}>
                  {copied ? t.app.copied : t.app.copy}
                </button>
              </>
            )}
            {msg.route &&
              (routeSaved ? (
                <button type="button" className="icon saved" onClick={onShowRoutes}>
                  {t.app.savedRoute}
                </button>
              ) : (
                <button type="button" className="icon accent" onClick={onSaveRoute}>
                  {t.app.saveRoute(msg.route.stops.length)}
                </button>
              ))}
          </div>
        )}
        {askReason && !streaming && (
          <ReasonForm
            onSubmit={(reason) => {
              setAskReason(false);
              onRate("down", reason);
            }}
            onSkip={() => setAskReason(false)}
          />
        )}
        {onAsk && followups.length > 0 && (
          <div className="followups">
            {followups.map((q) => (
              <button key={q} type="button" onClick={() => onAsk(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThumbIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7zm0 0l4-7a2 2 0 0 1 2.9 2.3L13 10h5.3a2 2 0 0 1 2 2.4l-1.4 6.5A2 2 0 0 1 17 20.5H7" />
    </svg>
  );
}

/** 싫어요 이유 — 고르거나 적어서 보낸다. 건너뛰어도 싫어요는 이미 남아 있다. */
function ReasonForm({ onSubmit, onSkip }: { onSubmit: (reason: string) => void; onSkip: () => void }) {
  const { t } = useAppLocale();
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const reason = [picked, text.trim()].filter(Boolean).join(" — ");
  return (
    <form
      className="reason"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) onSubmit(reason);
      }}
    >
      <p className="meta">{t.app.reasonTitle}</p>
      <div className="reason-chips">
        {t.app.reasons.map((r) => (
          <button
            key={r}
            type="button"
            className={picked === r ? "on" : ""}
            aria-pressed={picked === r}
            onClick={() => setPicked(picked === r ? null : r)}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        value={text}
        maxLength={300}
        placeholder={t.app.reasonPlaceholder}
        aria-label={t.app.reasonTitle}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="edit-actions">
        <button type="button" className="ghost" onClick={onSkip}>
          {t.app.close}
        </button>
        <button type="submit" disabled={!reason}>
          {t.app.send}
        </button>
      </div>
    </form>
  );
}

/** 질문에 붙인 사진. 누르면 크게 본다 (Esc·바깥 클릭으로 닫기). */
function PhotoStrip({ images }: { images: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <>
      <div className="photo-strip">
        {images.map((src, i) => (
          <button key={i} type="button" onClick={() => setOpen(src)} aria-label={`첨부 사진 ${i + 1} 크게 보기`}>
            <img src={src} alt={`첨부 사진 ${i + 1}`} />
          </button>
        ))}
      </div>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={() => setOpen(null)}>
          <img src={open} alt="첨부 사진" />
        </div>
      )}
    </>
  );
}

/** 저장한 경로 멘션 칩 — 입력창·보낸 질문에 제목만 보여 준다. */
function RouteMentionChip({ title, onRemove }: { title: string; onRemove?: () => void }) {
  return (
    <span className="route-mention" title={title}>
      <svg className="route-mention-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5a4 4 0 0 0-4 4c0 2.6 4 8 4 8s4-5.4 4-8a4 4 0 0 0-4-4Zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
      </svg>
      <span className="route-mention-label">{title}</span>
      {onRemove && (
        <button type="button" className="route-mention-x" aria-label="경로 빼기" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
