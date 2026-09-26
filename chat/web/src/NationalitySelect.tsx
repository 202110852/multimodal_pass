import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  filterNationalities,
  getNationalityOption,
  type NationalityCode,
  type NationalityOption,
} from "./nationality.js";

type Props = {
  value?: NationalityCode;
  onChange: (value: NationalityCode | undefined) => void;
  /** 로케일별 표시명 (없으면 nationality.ts 기본 label) */
  labels?: Partial<Record<NationalityCode, string>>;
  placeholder?: string;
  clearLabel?: string;
  emptyLabel?: string;
  "aria-label"?: string;
};

function displayLabel(opt: NationalityOption, labels?: Partial<Record<NationalityCode, string>>): string {
  const name = labels?.[opt.id] ?? opt.label;
  if (!opt.callingCode) return name;
  return `${name} - +${opt.callingCode}`;
}

/** 검색 가능한 국적 콤보박스. 라벨·별칭·통화코드로 필터한다. */
export function NationalitySelect({
  value,
  onChange,
  labels,
  placeholder = "선택해 주세요",
  clearLabel = "국적 선택 해제",
  emptyLabel = "검색 결과가 없습니다",
  "aria-label": ariaLabel = "국적",
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = getNationalityOption(value);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const options = filterNationalities(open ? query : "", labels);
  const displayValue = open ? query : selected ? displayLabel(selected, labels) : "";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  const pick = (id: NationalityCode | undefined) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const openList = () => {
    setOpen(true);
    setQuery("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      else setHighlight((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openList();
      else setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const hit = options[highlight];
      if (hit) pick(hit.id);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="nationality-select" ref={rootRef}>
      <div className={`nationality-control${open ? " open" : ""}`}>
        <input
          ref={inputRef}
          type="text"
          className="nationality-input"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[highlight] ? `${listId}-${options[highlight].id}` : undefined}
          placeholder={placeholder}
          value={displayValue}
          autoComplete="off"
          spellCheck={false}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {value && !open && (
          <button type="button" className="nationality-clear" aria-label={clearLabel} onClick={() => pick(undefined)}>
            ×
          </button>
        )}
        <span className="nationality-chevron" aria-hidden="true" />
      </div>

      {open && (
        <ul id={listId} className="nationality-list" role="listbox" aria-label={ariaLabel}>
          {options.length === 0 ? (
            <li className="nationality-empty" role="presentation">
              {emptyLabel}
            </li>
          ) : (
            options.map((opt, i) => (
              <li
                key={opt.id}
                id={`${listId}-${opt.id}`}
                role="option"
                aria-selected={value === opt.id}
                className={[
                  "nationality-option",
                  value === opt.id ? "selected" : "",
                  i === highlight ? "highlight" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt.id);
                }}
              >
                <span className="nationality-option-label">{labels?.[opt.id] ?? opt.label}</span>
                {opt.callingCode && (
                  <span className="nationality-option-code">+{opt.callingCode}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
