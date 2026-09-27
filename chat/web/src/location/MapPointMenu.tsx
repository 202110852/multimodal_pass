import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppLocale } from "../locale.js";
import { getAddressFromCoords } from "./geocoding.js";
import { CloseIcon, SpinnerIcon } from "./icons.js";
import type { MapPick } from "./KakaoMap.js";
import { isWaypointSlot, type RouteSlot } from "./route.js";
import { locationCopy } from "./strings.js";
import { useTranslatedText } from "./useTranslatedText.js";

const EDGE_MARGIN_PX = 8;

type MapPointMenuProps = {
  pick: MapPick;
  locale: AppLocale;
  /** name 은 경로 칸에 보여줄 이름 (장소명 또는 주소, 모르면 null) */
  onSelect: (slot: RouteSlot, name: string | null) => void;
  /** 빈 경유지 칸을 채우거나 새 경유지로 추가한다 */
  onAddWaypoint: (name: string | null) => void;
  /** 경유지가 최대 개수만큼 다 차 있으면 false */
  canAddWaypoint: boolean;
  onClose: () => void;
};

/**
 * 고른 지점 위에 뜨는 "출발지로 / 경유지로 / 도착지로" 메뉴. 경유지 칸에서 검색한 핀이면 그 칸의 "경유지로"만 보여준다.
 * 검색으로 연 지점은 장소명을 그대로 쓰고, 지도에서 누른 지점은 열린 뒤 주소를 채운다.
 */
export function MapPointMenu({ pick, locale, onSelect, onAddWaypoint, canAddWaypoint, onClose }: MapPointMenuProps) {
  const copy = locationCopy(locale);
  const menuRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState<string | null>(pick.subtitle ?? null);
  const [resolving, setResolving] = useState(!pick.title);
  const name = pick.title ?? address;
  const waypointSlot = pick.slot && isWaypointSlot(pick.slot) ? pick.slot : null;
  const title = useTranslatedText(name ?? copy.pickedPoint, locale);
  const subtitle = useTranslatedText(pick.title ? address ?? "" : "", locale);

  useEffect(() => {
    if (pick.title) {
      setAddress(pick.subtitle ?? null);
      setResolving(false);
      return;
    }

    let cancelled = false;
    setResolving(true);
    setAddress(null);
    getAddressFromCoords(pick.coords.latitude, pick.coords.longitude).then((resolved) => {
      if (cancelled) return;
      setAddress(resolved);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pick]);

  // 고른 지점 바로 위에 띄우되, 지도 가장자리에서는 잘리지 않게 안쪽으로 민다
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const parent = menu?.parentElement;
    if (!menu || !parent) return;
    const halfWidth = menu.offsetWidth / 2;
    const left = Math.min(
      Math.max(pick.x, halfWidth + EDGE_MARGIN_PX),
      parent.clientWidth - halfWidth - EDGE_MARGIN_PX,
    );
    const fitsAbove = pick.y - menu.offsetHeight - 16 >= EDGE_MARGIN_PX;
    menu.style.left = `${left}px`;
    menu.style.top = `${fitsAbove ? pick.y - 16 : pick.y + 16}px`;
    menu.classList.toggle("below", !fitsAbove);
  }, [pick, title, subtitle]);

  return (
    <div ref={menuRef} className="map-point-menu" role="menu" aria-label={copy.pickedPoint}>
      <div className="map-point-menu-head">
        {resolving && <SpinnerIcon className="inline-start" />}
        <span className="map-point-menu-text">
          <span className={pick.title ? "map-point-menu-title" : "map-point-menu-address"}>{title}</span>
          {subtitle && <span className="map-point-menu-address">{subtitle}</span>}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={copy.closeMenu}>
          <CloseIcon />
        </button>
      </div>
      <div className="map-point-menu-actions">
        {waypointSlot ? (
          <button type="button" role="menuitem" className="waypoint" onClick={() => onSelect(waypointSlot, name)}>
            {copy.setWaypoint}
          </button>
        ) : (
          <>
            <button type="button" role="menuitem" className="origin" onClick={() => onSelect("origin", name)}>
              {copy.setOrigin}
            </button>
            <button
              type="button"
              role="menuitem"
              className="waypoint"
              disabled={!canAddWaypoint}
              onClick={() => onAddWaypoint(name)}
            >
              {copy.setWaypoint}
            </button>
            <button type="button" role="menuitem" className="destination" onClick={() => onSelect("destination", name)}>
              {copy.setDestination}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
