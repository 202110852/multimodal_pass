import { useRef, type FormEvent } from "react";
import type { AppLocale } from "../locale.js";
import { MAX_WAYPOINTS } from "./config.js";
import { BookmarkIcon, CloseIcon, ListIcon, PlusIcon, ResetIcon, SwapIcon } from "./icons.js";
import type { RouteSlot, SearchOutcome, Waypoint, WaypointId } from "./route.js";
import { RouteInput } from "./RouteInput.js";
import { locationCopy } from "./strings.js";
import { useDragReorder } from "./useDragReorder.js";

type RouteSearchPanelProps = {
  locale: AppLocale;
  /** 확정된 출발지·도착지 이름. 비어 있으면 placeholder 를 보여준다. */
  originName: string;
  destinationName: string;
  waypoints: Waypoint[];
  searchingSlot: RouteSlot | null;
  /** 지금 지도에 결과 핀을 띄운 칸 */
  resultsSlot: RouteSlot | null;
  /** 지울 것이 있을 때만 "다시입력" 을 누를 수 있다 */
  canReset: boolean;
  /** 출발지·도착지가 모두 정해졌을 때만 "경로 저장하기" 를 누를 수 있다 (경유지는 선택) */
  canSaveRoute: boolean;
  onSearch: (slot: RouteSlot, query: string) => Promise<SearchOutcome>;
  onEdit: () => void;
  onClear: (slot: RouteSlot) => void;
  /** 출발(0) · 경유지 · 도착(마지막) 을 한 줄로 본 순서에서 from 칸을 to 자리로 옮긴다 */
  onReorder: (from: number, to: number) => void;
  onAddWaypoint: () => void;
  onRemoveWaypoint: (id: WaypointId) => void;
  onReset: () => void;
  onSaveRoute: () => void;
  onOpenSavedRoutes: () => void;
};

type RouteField = {
  slot: RouteSlot;
  tone: "origin" | "destination" | "waypoint";
  committedName: string;
  placeholder: string;
  ariaLabel: string;
  /** 경유지만 새로 추가됐을 때 바로 입력하게 하고, 삭제 버튼을 단다 */
  waypointId?: WaypointId;
  autoFocus?: boolean;
};

/**
 * 지도 상단 통합 길찾기 검색창: 출발 → 경유지 → 도착 입력칸과 다시입력·경유지 추가·저장 목록·경로 저장 버튼.
 * 각 칸 앞의 손잡이를 끌어 순서를 바꾸며, 맨 위 칸이 출발지, 맨 아래 칸이 도착지가 된다.
 * Enter 로 검색해 결과가 하나면 바로 그 칸으로 정하고, 여럿이면 지도에 핀으로 띄워 고르게 한다.
 */
export function RouteSearchPanel({
  locale,
  originName,
  destinationName,
  waypoints,
  searchingSlot,
  resultsSlot,
  canReset,
  canSaveRoute,
  onSearch,
  onEdit,
  onClear,
  onReorder,
  onAddWaypoint,
  onRemoveWaypoint,
  onReset,
  onSaveRoute,
  onOpenSavedRoutes,
}: RouteSearchPanelProps) {
  const copy = locationCopy(locale);
  const listRef = useRef<HTMLOListElement>(null);
  const { draggingIndex, isDragging, itemStyle, handleProps } = useDragReorder(listRef, onReorder);

  const fields: RouteField[] = [
    {
      slot: "origin",
      tone: "origin",
      committedName: originName,
      placeholder: copy.originPlaceholder,
      ariaLabel: copy.originSearch,
    },
    ...waypoints.map((waypoint, index): RouteField => ({
      slot: waypoint.id,
      tone: "waypoint",
      committedName: waypoint.point ? waypoint.point.name ?? copy.pickedPoint : "",
      placeholder: `${copy.waypointSearch} ${index + 1}`,
      ariaLabel: `${copy.waypointSearch} ${index + 1}`,
      waypointId: waypoint.id,
      autoFocus: !waypoint.point,
    })),
    {
      slot: "destination",
      tone: "destination",
      committedName: destinationName,
      placeholder: copy.destinationPlaceholder,
      ariaLabel: copy.destinationSearch,
    },
  ];

  return (
    <form className="route-search" role="search" onSubmit={(event: FormEvent) => event.preventDefault()}>
      <ol ref={listRef} className={`route-search-fields${isDragging ? " dragging" : ""}`}>
        {fields.map((field, index) => (
          <li
            key={field.slot}
            className={`route-search-field${draggingIndex === index ? " dragged" : ""}`}
            style={itemStyle(index)}
          >
            <button
              type="button"
              className="route-search-handle"
              aria-label={`${field.ariaLabel} · ${copy.dragToReorder}`}
              title={copy.dragToReorder}
              {...handleProps(index)}
            >
              <SwapIcon />
            </button>
            <RouteInput
              slot={field.slot}
              tone={field.tone}
              committedName={field.committedName}
              placeholder={field.placeholder}
              ariaLabel={field.ariaLabel}
              clearLabel={copy.clearSearch}
              searching={searchingSlot === field.slot}
              pinned={resultsSlot === field.slot}
              autoFocus={field.autoFocus}
              onSearch={onSearch}
              onEdit={onEdit}
              onClear={onClear}
            />
            {field.waypointId && (
              <button
                type="button"
                className="icon-btn route-search-remove"
                onClick={() => field.waypointId && onRemoveWaypoint(field.waypointId)}
                aria-label={copy.removeWaypoint}
                title={copy.removeWaypoint}
              >
                <CloseIcon />
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="route-search-actions">
        <button type="button" onClick={onReset} disabled={!canReset}>
          <ResetIcon />
          {copy.resetRoute}
        </button>
        <button type="button" onClick={onAddWaypoint} disabled={waypoints.length >= MAX_WAYPOINTS}>
          <PlusIcon />
          {copy.addWaypoint}
        </button>
        <button type="button" className="route-search-list" onClick={onOpenSavedRoutes}>
          <ListIcon />
          {copy.savedRoutes}
        </button>
        <button type="button" className="route-search-save" onClick={onSaveRoute} disabled={!canSaveRoute}>
          <BookmarkIcon />
          {copy.saveRoute}
        </button>
      </div>
    </form>
  );
}
