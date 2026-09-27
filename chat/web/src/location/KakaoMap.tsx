import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { AddressSearchResult } from "./addressSearch.js";
import { DEFAULT_MAP_CENTER } from "./config.js";
import type { GeoCoords } from "./geolocation.js";
import type { RouteSlot } from "./route.js";
import {
  kakaoMapAppKey,
  loadKakaoMaps,
  type KakaoCustomOverlay,
  type KakaoLatLng,
  type KakaoMap as KakaoMapInstance,
  type KakaoMapsApi,
  type KakaoMouseEvent,
} from "./kakaoSdk.js";

/** 제주 전역이 보이는 확대 수준 / 내 위치 주변 확대 수준 */
const OVERVIEW_LEVEL = 9;
const DETAIL_LEVEL = 4;
/** 검색으로 고른 장소를 보여줄 확대 수준 */
const FOCUS_LEVEL = 3;
/** 코드로 지도를 옮긴 직후의 zoom·center 이벤트가 방금 띄운 메뉴를 닫지 않게 무시하는 시간 */
const PROGRAMMATIC_MOVE_GRACE_MS = 500;
/** 이 시간 동안 손가락이 거의 움직이지 않으면 꾹 누른 것으로 본다 */
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const CLICK_AFTER_LONG_PRESS_MS = 400;
/** 지도를 끌거나 확대하면 떠 있는 메뉴를 닫는다 */
const DISMISS_EVENTS = ["click", "dragstart", "zoom_start"] as const;
/** 검색 결과 핀을 한눈에 담을 때 남길 여백 (위: 검색창, 아래: 버튼·요약 카드) */
const RESULT_BOUNDS_PADDING = { top: 90, right: 40, bottom: 200, left: 40 } as const;
/** fitTo 에서 덮개 아래로 더 남길 여백 — 좌표 위로 솟는 핀 머리가 들어갈 자리 */
const FIT_PIN_ROOM_PX = 56;
/** 핀 꼬리 높이. 메뉴를 핀 머리 위에 띄울 때 더한다. */
const RESULT_PIN_TAIL_PX = 8;

/**
 * 꾹 누르기(모바일)·우클릭(데스크톱)·검색 결과 핀으로 고른 지점. x·y 는 지도 컨테이너 기준 픽셀.
 * 검색 결과 핀은 장소명(title)·주소(subtitle)와 검색한 칸(slot)을 함께 가진다.
 */
export type MapPick = {
  coords: GeoCoords;
  x: number;
  y: number;
  title?: string;
  subtitle?: string;
  slot?: RouteSlot;
};

/** 지도에 그릴 경유지 핀 */
export type MapWaypoint = { coords: GeoCoords; label: string };

export type KakaoMapControls = {
  /** 지도를 좌표로 옮기고 그 지점의 컨테이너 픽셀 좌표를 돌려준다. 지도가 아직 없으면 null. */
  focus: (coords: GeoCoords) => { x: number; y: number } | null;
  /** 지금 보고 있는 지도의 중심. 지도가 아직 없으면 null. */
  getCenter: () => GeoCoords | null;
  /** 좌표들이 모두 보이게 지도를 맞춘다. topInset: 지도 위를 덮는 검색창 등의 높이(px) */
  fitTo: (coords: GeoCoords[], topInset?: number) => void;
};

type Pin = { overlay: KakaoCustomOverlay; label: HTMLElement };

type MapHandle = {
  api: KakaoMapsApi;
  map: KakaoMapInstance;
  me: KakaoCustomOverlay;
  origin: Pin;
  destination: Pin;
};

type KakaoMapProps = {
  ref?: Ref<KakaoMapControls>;
  /** 지도 중심·내 위치 마커 좌표. null이면 제주 전역을 보여준다. */
  center: GeoCoords | null;
  origin: GeoCoords | null;
  destination: GeoCoords | null;
  originLabel: string;
  destinationLabel: string;
  waypoints: MapWaypoint[];
  /** 지도에 핀으로 보여줄 검색 결과. 핀을 누르면 onPick 으로 그 장소를 넘긴다. */
  results: AddressSearchResult[];
  onPick: (pick: MapPick) => void;
  /** 지도를 누르거나 끌거나 확대할 때 (떠 있는 메뉴 닫기용) */
  onInteract: () => void;
  /** 지도 위에 겹쳐 그릴 요소 (고른 지점 메뉴 등) */
  children?: ReactNode;
  missingKeyText: string;
  loadFailedText: string;
};

function toGeoCoords(latLng: KakaoLatLng): GeoCoords {
  return { latitude: latLng.getLat(), longitude: latLng.getLng() };
}

function createPin(api: KakaoMapsApi, className: string, text: string): Pin {
  const label = document.createElement("div");
  label.className = className;
  label.textContent = text;
  const position = new api.LatLng(DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude);
  return { overlay: new api.CustomOverlay({ position, content: label, yAnchor: 1, zIndex: 4 }), label };
}

/** 좌표가 있으면 그 자리에 보이고, 없으면 지도에서 뺀다 */
function placeOverlay(handle: MapHandle, overlay: KakaoCustomOverlay, coords: GeoCoords | null) {
  if (!coords) {
    overlay.setMap(null);
    return;
  }
  overlay.setPosition(new handle.api.LatLng(coords.latitude, coords.longitude));
  overlay.setMap(handle.map);
}

/**
 * 모바일 꾹 누르기 감지. 카카오맵 SDK에는 longpress 이벤트가 없어 터치 이벤트로 직접 판단한다.
 * 끌기·두 손가락 확대로 번지면 취소한다.
 */
function attachLongPress(
  container: HTMLElement,
  onLongPress: (x: number, y: number) => void,
): { detach: () => void; justLongPressed: () => boolean } {
  let timer: number | undefined;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  // 꾹 누른 뒤 손을 떼면 카카오가 click 을 보낸다 — 그 click 이 방금 띄운 메뉴를 닫지 않게 잠깐 무시한다
  let ignoreClickUntil = 0;

  const cancel = () => {
    window.clearTimeout(timer);
    start = null;
  };

  const onTouchEnd = () => {
    if (fired) ignoreClickUntil = Date.now() + CLICK_AFTER_LONG_PRESS_MS;
    fired = false;
    cancel();
  };

  const onTouchStart = (event: TouchEvent) => {
    cancel();
    fired = false;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    timer = window.setTimeout(() => {
      if (!start) return;
      const rect = container.getBoundingClientRect();
      onLongPress(start.x - rect.left, start.y - rect.top);
      navigator.vibrate?.(20);
      fired = true;
      start = null;
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!start) return;
    const touch = event.touches[0];
    const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
    if (event.touches.length !== 1 || moved > LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
  };

  // 길게 누를 때 뜨는 브라우저 메뉴(이미지 저장 등)를 막는다. 데스크톱 우클릭은 카카오 rightclick 이 처리한다.
  const onContextMenu = (event: Event) => event.preventDefault();

  const options = { capture: true, passive: true } as const;
  container.addEventListener("touchstart", onTouchStart, options);
  container.addEventListener("touchmove", onTouchMove, options);
  container.addEventListener("touchend", onTouchEnd, options);
  container.addEventListener("touchcancel", onTouchEnd, options);
  container.addEventListener("contextmenu", onContextMenu);
  return {
    detach: () => {
      cancel();
      container.removeEventListener("touchstart", onTouchStart, options);
      container.removeEventListener("touchmove", onTouchMove, options);
      container.removeEventListener("touchend", onTouchEnd, options);
      container.removeEventListener("touchcancel", onTouchEnd, options);
      container.removeEventListener("contextmenu", onContextMenu);
    },
    justLongPressed: () => fired || Date.now() < ignoreClickUntil,
  };
}

export function KakaoMap({
  ref,
  center,
  origin,
  destination,
  originLabel,
  destinationLabel,
  waypoints,
  results,
  onPick,
  onInteract,
  children,
  missingKeyText,
  loadFailedText,
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const hasCenteredRef = useRef(false);
  const ignoreDismissUntilRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(() =>
    kakaoMapAppKey() ? "loading" : "failed",
  );

  // 지도 이벤트는 한 번만 등록하므로 최신 콜백은 ref 로 읽는다
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const originLabelRef = useRef(originLabel);
  originLabelRef.current = originLabel;
  const destinationLabelRef = useRef(destinationLabel);
  destinationLabelRef.current = destinationLabel;

  useImperativeHandle(
    ref,
    () => ({
      focus: (coords) => {
        const handle = handleRef.current;
        const container = containerRef.current;
        if (!handle || !container) return null;
        ignoreDismissUntilRef.current = Date.now() + PROGRAMMATIC_MOVE_GRACE_MS;
        handle.map.setLevel(FOCUS_LEVEL);
        handle.map.setCenter(new handle.api.LatLng(coords.latitude, coords.longitude));
        return { x: container.clientWidth / 2, y: container.clientHeight / 2 };
      },
      getCenter: () => {
        const handle = handleRef.current;
        return handle ? toGeoCoords(handle.map.getCenter()) : null;
      },
      fitTo: (coords, topInset = 0) => {
        const handle = handleRef.current;
        if (!handle || coords.length === 0) return;
        ignoreDismissUntilRef.current = Date.now() + PROGRAMMATIC_MOVE_GRACE_MS;
        const bounds = new handle.api.LatLngBounds();
        coords.forEach(({ latitude, longitude }) => bounds.extend(new handle.api.LatLng(latitude, longitude)));
        const { top, right, bottom, left } = RESULT_BOUNDS_PADDING;
        handle.map.setBounds(bounds, Math.max(top, topInset + FIT_PIN_ROOM_PX), right, bottom, left);
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !kakaoMapAppKey()) return;

    let cancelled = false;
    let detachEvents: (() => void) | null = null;

    loadKakaoMaps()
      .then((api) => {
        if (cancelled) return;
        const initial = new api.LatLng(DEFAULT_MAP_CENTER.latitude, DEFAULT_MAP_CENTER.longitude);
        const map = new api.Map(container, { center: initial, level: OVERVIEW_LEVEL });

        const dot = document.createElement("div");
        dot.className = "map-me-dot";
        const me = new api.CustomOverlay({ position: initial, content: dot, yAnchor: 0.5, zIndex: 3 });

        handleRef.current = {
          api,
          map,
          me,
          origin: createPin(api, "map-pin origin", originLabelRef.current),
          destination: createPin(api, "map-pin destination", destinationLabelRef.current),
        };

        const onRightClick = (event?: KakaoMouseEvent) => {
          if (!event) return;
          onPickRef.current({ coords: toGeoCoords(event.latLng), x: event.point.x, y: event.point.y });
        };
        const longPress = attachLongPress(container, (x, y) => {
          const latLng = map.getProjection().coordsFromContainerPoint(new api.Point(x, y));
          onPickRef.current({ coords: toGeoCoords(latLng), x, y });
        });
        const onDismiss = () => {
          if (longPress.justLongPressed() || Date.now() < ignoreDismissUntilRef.current) return;
          onInteractRef.current();
        };
        api.event.addListener(map, "rightclick", onRightClick);
        DISMISS_EVENTS.forEach((type) => api.event.addListener(map, type, onDismiss));

        detachEvents = () => {
          api.event.removeListener(map, "rightclick", onRightClick);
          DISMISS_EVENTS.forEach((type) => api.event.removeListener(map, type, onDismiss));
          longPress.detach();
        };
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    // 헤더 높이·화면 회전으로 컨테이너 크기가 바뀌면 지도가 빈 칸을 남기지 않게 다시 잰다
    const observer = new ResizeObserver(() => handleRef.current?.map.relayout());
    observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      detachEvents?.();
      const handle = handleRef.current;
      [handle?.me, handle?.origin.overlay, handle?.destination.overlay].forEach((overlay) =>
        overlay?.setMap(null),
      );
      handleRef.current = null;
      hasCenteredRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (status !== "ready" || !handle) return;
    placeOverlay(handle, handle.me, center);
    if (!center) return;

    const position = new handle.api.LatLng(center.latitude, center.longitude);
    if (hasCenteredRef.current) {
      handle.map.panTo(position);
    } else {
      handle.map.setLevel(DETAIL_LEVEL);
      handle.map.setCenter(position);
      hasCenteredRef.current = true;
    }
  }, [center, status]);

  useEffect(() => {
    const handle = handleRef.current;
    if (status !== "ready" || !handle) return;
    placeOverlay(handle, handle.origin.overlay, origin);
    placeOverlay(handle, handle.destination.overlay, destination);
  }, [origin, destination, status]);

  // 마커는 DOM 을 직접 만든 CustomOverlay 라 언어가 바뀌면 글자를 여기서 고친다
  useEffect(() => {
    const handle = handleRef.current;
    if (status !== "ready" || !handle) return;
    handle.origin.label.textContent = originLabel;
    handle.destination.label.textContent = destinationLabel;
  }, [originLabel, destinationLabel, status]);

  useEffect(() => {
    const handle = handleRef.current;
    if (status !== "ready" || !handle) return;
    const pins = waypoints.map(({ coords, label }) => {
      const pin = createPin(handle.api, "map-pin waypoint", label);
      placeOverlay(handle, pin.overlay, coords);
      return pin.overlay;
    });
    return () => pins.forEach((overlay) => overlay.setMap(null));
  }, [waypoints, status]);

  // 검색 결과마다 장소명 핀을 꽂고, 전부 보이게 지도를 맞춘다
  useEffect(() => {
    const handle = handleRef.current;
    if (status !== "ready" || !handle || results.length === 0) return;

    const bounds = new handle.api.LatLngBounds();
    const overlays = results.map((result) => {
      const position = new handle.api.LatLng(result.latitude, result.longitude);
      bounds.extend(position);

      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "map-result-pin";
      pin.title = result.roadAddress || result.address;
      const name = document.createElement("span");
      name.className = "map-result-pin-name";
      name.textContent = result.placeName;
      pin.append(name);
      pin.addEventListener("click", () => {
        const point = handle.map.getProjection().containerPointFromCoords(position);
        onPickRef.current({
          coords: { latitude: result.latitude, longitude: result.longitude },
          x: point.x,
          y: point.y - pin.offsetHeight - RESULT_PIN_TAIL_PX,
          title: result.placeName,
          subtitle: result.roadAddress || result.address,
        });
      });

      const overlay = new handle.api.CustomOverlay({ position, content: pin, yAnchor: 1, zIndex: 5, clickable: true });
      overlay.setMap(handle.map);
      return overlay;
    });

    ignoreDismissUntilRef.current = Date.now() + PROGRAMMATIC_MOVE_GRACE_MS;
    const { top, right, bottom, left } = RESULT_BOUNDS_PADDING;
    handle.map.setBounds(bounds, top, right, bottom, left);

    return () => overlays.forEach((overlay) => overlay.setMap(null));
  }, [results, status]);

  return (
    <div className="map-canvas">
      {/* 지도 우클릭은 출발·도착 메뉴가 쓰므로 버그 리포트 메뉴를 띄우지 않는다 */}
      <div ref={containerRef} className="kakao-map" data-bug-ignore />

      {status === "failed" && (
        <p className="map-message">{kakaoMapAppKey() ? loadFailedText : missingKeyText}</p>
      )}
      {children}
    </div>
  );
}
