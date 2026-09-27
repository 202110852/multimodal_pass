import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CloseIcon, SpinnerIcon } from "./icons.js";
import type { RouteSlot, SearchOutcome } from "./route.js";

type RouteInputProps = {
  slot: RouteSlot;
  /** 색 점 구분용: origin · destination · waypoint */
  tone: "origin" | "destination" | "waypoint";
  /** 확정된 장소 이름. 편집 중이 아니면 이 값을 보여준다. */
  committedName: string;
  placeholder: string;
  ariaLabel: string;
  clearLabel: string;
  searching: boolean;
  /** 이 칸의 검색 결과가 지금 지도에 핀으로 떠 있는지. 떠 있는 동안 검색어를 남겨 둔다. */
  pinned: boolean;
  autoFocus?: boolean;
  onSearch: (slot: RouteSlot, query: string) => Promise<SearchOutcome>;
  /** 글자를 고칠 때 (떠 있는 결과 핀을 걷는 용도) */
  onEdit: () => void;
  onClear: (slot: RouteSlot) => void;
};

/**
 * 출발·도착·경유지 검색 입력칸.
 * 편집 중에만 임시 입력값(draft)을 쓰고, 편집이 끝나면 확정된 이름을 다시 보여준다.
 */
export function RouteInput({
  slot,
  tone,
  committedName,
  placeholder,
  ariaLabel,
  clearLabel,
  searching,
  pinned,
  autoFocus,
  onSearch,
  onEdit,
  onClear,
}: RouteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // 핀을 띄우자마자 blur 하므로, 다음 렌더 전에도 onBlur 가 최신 값을 보게 ref 로 둔다
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const value = draft ?? committedName;

  // 핀에서 장소를 고르거나 핀을 걷으면, 포커스가 없을 때 확정된 이름으로 되돌린다
  useEffect(() => {
    if (!pinned && document.activeElement !== inputRef.current) setDraft(null);
  }, [pinned]);

  // 모바일 키보드를 내려 지도가 보이게
  const blur = () => inputRef.current?.blur();

  // 한글 조합을 끝내는 Enter 는 조합 중(isComposing) 이벤트와 확정 후 이벤트가 두 번 온다 — 한 번만 검색한다
  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const query = value.trim();
    if (!query) return;

    const outcome = await onSearch(slot, query);
    if (outcome === "many") {
      pinnedRef.current = true;
      blur();
    } else if (outcome === "single") {
      setDraft(null);
      blur();
    }
  };

  return (
    <div className={`route-input ${tone}`}>
      {searching ? (
        <SpinnerIcon className="route-input-icon" />
      ) : (
        <span className="route-input-dot" aria-hidden="true" />
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onFocus={(event) => {
          // 지우기 버튼이 draft 를 "" 로 바꾼 직후 포커스를 주므로, 렌더 전 값이 아니라 대기 중인 최신 값을 봐야 한다
          setDraft((current) => current ?? committedName);
          event.target.select();
        }}
        onBlur={() => {
          if (!pinnedRef.current) setDraft(null);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onEdit();
        }}
        onKeyDown={(event) => void onKeyDown(event)}
      />
      {value && (
        <button
          type="button"
          className="route-input-clear"
          // 지우고 나서 바로 다시 입력할 수 있게 포커스를 유지한다
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setDraft("");
            onClear(slot);
            inputRef.current?.focus();
          }}
          aria-label={clearLabel}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
