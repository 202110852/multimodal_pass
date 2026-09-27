import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, type MapRouteRequest } from "./App.js";
import { useAppLocale } from "./AppLocaleContext.js";
import { searchAddress, type AddressSearchResult } from "./location/addressSearch.js";
import { MAX_WAYPOINTS } from "./location/config.js";
import { ChatIcon, CloseIcon, LocateIcon, SpinnerIcon } from "./location/icons.js";
import { KakaoMap, type KakaoMapControls, type MapPick, type MapWaypoint } from "./location/KakaoMap.js";
import { MapPointMenu } from "./location/MapPointMenu.js";
import {
  isWaypointSlot,
  mapRoutePlan,
  routeChatPrompt,
  routePointsFromPlan,
  type RoutePoint,
  type RouteSlot,
  type RouteStopForChat,
  type SearchOutcome,
  type Waypoint,
  type WaypointId,
} from "./location/route.js";
import { RouteSearchPanel } from "./location/RouteSearchPanel.js";
import { locationCopy } from "./location/strings.js";
import { useChatPanelBox } from "./location/useChatPanelBox.js";
import type { SavedRoute } from "./store.js";
import { useCurrentLocation } from "./location/useCurrentLocation.js";
import "./location/location.css";

const NOTICE_DURATION_MS = 2500;
const NO_RESULTS: AddressSearchResult[] = [];
/** 챗봇에 넘기는 경로 글은 한국어로 고정한다 (routeChatPrompt 참고) */
const CURRENT_LOCATION_PROMPT_NAME = "현재 위치";

type SearchResults = { slot: RouteSlot; items: AddressSearchResult[] };

function toRoutePoint(result: AddressSearchResult): RoutePoint {
  return {
    coords: { latitude: result.latitude, longitude: result.longitude },
    name: result.placeName,
    detail: result.roadAddress || result.address || null,
  };
}

/** 메인 화면: 전체 지도 + 상단 통합 길찾기 검색창(출발·경유·도착) + 우측 하단 현재 위치·챗봇 버튼 */
export function MapHome() {
  const { locale, t } = useAppLocale();
  const copy = locationCopy(locale);
  const [notice, setNotice] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // 처음 열 때 한 번만 붙이고 이후엔 숨기기만 한다 — 닫아도 대화·답변 스트리밍이 끊기지 않게
  const [chatMounted, setChatMounted] = useState(false);
  const mapRef = useRef<KakaoMapControls>(null);
  const [pick, setPick] = useState<MapPick | null>(null);
  // origin 이 null 이면 현재 위치를 출발지로 쓴다
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const [destination, setDestination] = useState<RoutePoint | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const nextWaypointIdRef = useRef(0);
  // 결과가 여럿인 검색은 지도에 핀으로 띄우고, 핀을 눌러 메뉴에서 고른다
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchingSlot, setSearchingSlot] = useState<RouteSlot | null>(null);
  const searchRequestIdRef = useRef(0);
  const [routeRequest, setRouteRequest] = useState<MapRouteRequest | null>(null);
  const [savedRoutesRequest, setSavedRoutesRequest] = useState(0);

  const notify = useCallback((message: string) => setNotice(message), []);
  const closePick = useCallback(() => setPick(null), []);
  const location = useCurrentLocation(locale, notify);
  const chatPanelStyle = useChatPanelBox(chatOpen);

  const mapWaypoints = useMemo<MapWaypoint[]>(
    () =>
      waypoints.flatMap((waypoint, index) =>
        waypoint.point ? [{ coords: waypoint.point.coords, label: `${copy.waypoint}${index + 1}` }] : [],
      ),
    [waypoints, copy.waypoint],
  );

  useEffect(() => {
    if (!notice) return;
    const timeoutId = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => clearTimeout(timeoutId);
  }, [notice]);

  const openChat = () => {
    setChatMounted(true);
    setChatOpen(true);
  };

  // 보관함은 챗봇 창 밖에 뜨므로 챗봇은 붙이기만 하고 열지 않는다
  const openSavedRoutes = () => {
    setSavedRoutesRequest((count) => count + 1);
    setChatMounted(true);
  };

  // 출발지를 비워 두면 현재 위치가 출발지다
  const routeStart: RoutePoint | null =
    origin ??
    (location.coords ? { coords: location.coords, name: CURRENT_LOCATION_PROMPT_NAME, detail: location.address } : null);
  const canSaveRoute = Boolean(routeStart && destination);

  /** 출발(비었으면 현재 위치) · 정해진 경유지 · 도착을 "저장한 경로" 에 넣고, 챗봇 새 대화의 입력창에 붙인다 */
  const sendRouteToChat = () => {
    const start = routeStart;
    if (!start || !destination) return;
    const filledWaypoints = waypoints.flatMap((waypoint) => (waypoint.point ? [waypoint.point] : []));
    const toStop = (label: string, point: RoutePoint): RouteStopForChat => ({
      label,
      name: point.name ?? point.detail ?? copy.pickedPoint,
      detail: point.detail,
      coords: point.coords,
    });
    const stops: RouteStopForChat[] = [
      toStop("출발", start),
      ...filledWaypoints.map((point, index) => toStop(`경유 ${index + 1}`, point)),
      toStop("도착", destination),
    ];

    const startName = origin ? routeName(origin) : copy.currentLocationName;
    const title = `${startName} → ${routeName(destination)}`;
    setRouteRequest({
      id: `map-route-${Date.now()}`,
      title,
      prompt: routeChatPrompt(stops),
      plan: mapRoutePlan(stops),
    });
    openChat();
  };

  const closeChat = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // App 이 이 이벤트로 음성 입력을 멈춘다 (임베드에서 창을 숨길 때와 같은 신호)
    window.dispatchEvent(new Event("stan-chat:hide"));
    setChatOpen(false);
  };

  const setSlotPoint = (slot: RouteSlot, point: RoutePoint | null) => {
    if (slot === "origin") setOrigin(point);
    else if (slot === "destination") setDestination(point);
    else setWaypoints((list) => list.map((waypoint) => (waypoint.id === slot ? { ...waypoint, point } : waypoint)));
  };

  /** 진행 중인 검색을 버리고 떠 있는 결과 핀을 걷는다 */
  const cancelSearch = () => {
    searchRequestIdRef.current += 1;
    setSearchingSlot(null);
    setSearchResults(null);
  };

  /**
   * 칸 하나의 검색. 지금 보고 있는 지도 중심 근처를 먼저 찾는다 (지도는 처음에 현재 위치로 이동한다).
   * 결과가 하나면 그 칸으로 바로 정하고, 여럿이면 지도에 핀으로 띄운다.
   */
  const runSearch = async (slot: RouteSlot, query: string): Promise<SearchOutcome> => {
    const requestId = ++searchRequestIdRef.current;
    setSearchingSlot(slot);
    setSearchResults(null);
    setPick(null);
    const isLatest = () => requestId === searchRequestIdRef.current;
    try {
      const found = await searchAddress(query, mapRef.current?.getCenter() ?? location.coords);
      if (!isLatest()) return "none";
      if (found.length === 0) {
        notify(copy.noResults);
        return "none";
      }
      if (found.length === 1) {
        const point = toRoutePoint(found[0]);
        setSlotPoint(slot, point);
        mapRef.current?.focus(point.coords);
        return "single";
      }
      setSearchResults({ slot, items: found });
      return "many";
    } catch {
      if (isLatest()) notify(copy.searchFailed);
      return "none";
    } finally {
      if (isLatest()) setSearchingSlot(null);
    }
  };

  // 검색 결과 핀을 누르면 어느 칸에서 검색했는지 메뉴에 알려 준다 (경유지 칸이면 "경유지로 설정"만)
  const handlePick = (next: MapPick) => {
    setPick(next.title && searchResults ? { ...next, slot: searchResults.slot } : next);
  };

  const pickedRoutePoint = (picked: MapPick, name: string | null): RoutePoint => ({
    coords: picked.coords,
    name,
    detail: picked.title ? picked.subtitle ?? null : null,
  });

  const selectPickedPoint = (slot: RouteSlot, name: string | null) => {
    if (!pick) return;
    setSlotPoint(slot, pickedRoutePoint(pick, name));
    setPick(null);
    cancelSearch();
  };

  /** 비어 있는 경유지 칸이 있으면 먼저 채우고, 없으면 새 경유지로 뒤에 붙인다 */
  const addPickedWaypoint = (name: string | null) => {
    if (!pick) return;
    const point = pickedRoutePoint(pick, name);
    const emptyWaypoint = waypoints.find((waypoint) => !waypoint.point);
    if (emptyWaypoint) {
      setSlotPoint(emptyWaypoint.id, point);
    } else {
      if (waypoints.length >= MAX_WAYPOINTS) return;
      const id: WaypointId = `waypoint-${nextWaypointIdRef.current++}`;
      setWaypoints((list) => [...list, { id, point }]);
    }
    setPick(null);
    cancelSearch();
  };

  const canAddWaypoint = waypoints.length < MAX_WAYPOINTS || waypoints.some((waypoint) => !waypoint.point);

  const clearSlot = (slot: RouteSlot) => {
    cancelSearch();
    setSlotPoint(slot, null);
  };

  const editSlot = () => {
    if (searchResults) cancelSearch();
  };

  const addWaypoint = () => {
    if (waypoints.length >= MAX_WAYPOINTS) return;
    const id: WaypointId = `waypoint-${nextWaypointIdRef.current++}`;
    setWaypoints((list) => [...list, { id, point: null }]);
  };

  const removeWaypoint = (id: WaypointId) => {
    if (searchResults?.slot === id || searchingSlot === id) cancelSearch();
    if (pick?.slot === id) setPick(null);
    setWaypoints((list) => list.filter((waypoint) => waypoint.id !== id));
  };

  /**
   * 출발 · 경유지 · 도착을 한 줄로 놓고 from 칸을 to 자리로 옮긴 뒤, 맨 앞을 출발지 · 맨 뒤를 도착지 · 사이를 경유지로 다시 나눈다.
   * 출발지를 비워 두면 현재 위치가 출발지이므로, 그 칸을 옮길 때는 현재 위치를 장소로 넘긴다.
   */
  const reorderRoute = (from: number, to: number) => {
    const currentPoint: RoutePoint | null = location.coords
      ? { coords: location.coords, name: copy.currentLocationName, detail: location.address }
      : null;
    const entries: { slot: RouteSlot; point: RoutePoint | null }[] = [
      { slot: "origin", point: origin ?? currentPoint },
      ...waypoints.map((waypoint) => ({ slot: waypoint.id, point: waypoint.point })),
      { slot: "destination", point: destination },
    ];
    const [moved] = entries.splice(from, 1);
    entries.splice(to, 0, moved);

    const first = entries[0];
    const last = entries[entries.length - 1];
    // 출발지 칸이 그대로 맨 앞이면 비워 둔 상태(= 현재 위치 따라가기)를 유지한다
    setOrigin(first.slot === "origin" ? origin : first.point);
    setDestination(last.point);
    setWaypoints(
      entries.slice(1, -1).map(({ slot, point }) => ({
        id: isWaypointSlot(slot) ? slot : `waypoint-${nextWaypointIdRef.current++}`,
        point,
      })),
    );
    setPick(null);
    cancelSearch();
  };

  const clearRoute = () => {
    setOrigin(null);
    setDestination(null);
    setWaypoints([]);
    setPick(null);
    cancelSearch();
  };

  /** 저장한 경로를 출발 · 경유지 · 도착 칸에 그대로 채우고, 챗봇을 닫아 경로 전체가 보이게 지도를 맞춘다 */
  const showSavedRoute = (route: SavedRoute) => {
    const points = routePointsFromPlan(route.plan);
    if (!points) return;
    const first = points[0];
    const last = points[points.length - 1];
    setOrigin(first);
    setDestination(last);
    setWaypoints(
      points.slice(1, -1).slice(0, MAX_WAYPOINTS).map((point) => ({
        id: `waypoint-${nextWaypointIdRef.current++}` as WaypointId,
        point,
      })),
    );
    setPick(null);
    cancelSearch();
    closeChat();
    // 칸 수가 바뀐 검색창이 다시 그려진 뒤의 높이만큼 위를 비운다
    requestAnimationFrame(() => {
      const searchPanelBottom = document.querySelector(".route-search")?.getBoundingClientRect().bottom ?? 0;
      mapRef.current?.fitTo(
        points.map((point) => point.coords),
        searchPanelBottom,
      );
    });
  };

  const routeName = (point: RoutePoint | null) => (point ? point.name ?? copy.pickedPoint : "");
  const resultsSlot = searchResults?.slot ?? null;

  return (
    <div className="map-home">
      <KakaoMap
        ref={mapRef}
        center={location.coords}
        origin={origin?.coords ?? null}
        destination={destination?.coords ?? null}
        originLabel={copy.origin}
        destinationLabel={copy.destination}
        waypoints={mapWaypoints}
        results={searchResults?.items ?? NO_RESULTS}
        onPick={handlePick}
        onInteract={closePick}
        missingKeyText={copy.mapMissingKey}
        loadFailedText={copy.mapLoadFailed}
      >
        {pick && (
          <MapPointMenu
            pick={pick}
            locale={locale}
            onSelect={selectPickedPoint}
            onAddWaypoint={addPickedWaypoint}
            canAddWaypoint={canAddWaypoint}
            onClose={closePick}
          />
        )}
      </KakaoMap>

      <RouteSearchPanel
        locale={locale}
        // 출발지를 따로 안 골랐으면 GPS 를 받은 뒤부터 현재 위치를 출발지로 보여준다
        originName={origin || !location.coords ? routeName(origin) : copy.currentLocationName}
        destinationName={routeName(destination)}
        waypoints={waypoints}
        searchingSlot={searchingSlot}
        resultsSlot={resultsSlot}
        canReset={Boolean(origin || destination || waypoints.length > 0)}
        canSaveRoute={canSaveRoute}
        onSearch={runSearch}
        onEdit={editSlot}
        onClear={clearSlot}
        onReorder={reorderRoute}
        onAddWaypoint={addWaypoint}
        onRemoveWaypoint={removeWaypoint}
        onReset={clearRoute}
        onSaveRoute={sendRouteToChat}
        onOpenSavedRoutes={openSavedRoutes}
      />

      <button
        type="button"
        className="locate-fab"
        aria-label={copy.myLocation}
        title={copy.myLocation}
        disabled={location.status === "loading"}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => void location.refresh()}
      >
        {location.status === "loading" ? <SpinnerIcon /> : <LocateIcon />}
      </button>

      {chatOpen && (
        <button
          type="button"
          className="chat-backdrop"
          tabIndex={-1}
          aria-label={copy.closeChat}
          onClick={closeChat}
        />
      )}

      {chatMounted && (
        <section
          id="chat-popup"
          className="chat-popup"
          hidden={!chatOpen}
          role="dialog"
          aria-modal="true"
          aria-label={t.app.title}
          style={chatPanelStyle}
        >
          <div className="chat-popup-bar">
            <strong>{t.app.title}</strong>
            <button type="button" className="icon-btn" onClick={closeChat} aria-label={copy.closeChat} title={copy.closeChat}>
              <CloseIcon />
            </button>
          </div>
          <div className="chat-popup-body">
            <App
              routeRequest={routeRequest}
              onShowRouteOnMap={showSavedRoute}
              savedRoutesRequest={savedRoutesRequest}
              onRevealChat={openChat}
              userLocation={location.coords}
            />
          </div>
        </section>
      )}

      <button
        type="button"
        className="chat-fab"
        aria-controls="chat-popup"
        aria-expanded={chatOpen}
        aria-label={chatOpen ? copy.closeChat : copy.openChat}
        title={chatOpen ? copy.closeChat : copy.openChat}
        // 모바일에서 하단 고정 버튼에 포커스가 가면 스크롤·주소창이 흔들린다
        onPointerDown={(event) => event.preventDefault()}
        onClick={chatOpen ? closeChat : openChat}
      >
        {chatOpen ? <CloseIcon className="chat-fab-icon" /> : <ChatIcon className="chat-fab-icon" />}
      </button>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
