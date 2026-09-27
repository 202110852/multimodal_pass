import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

type DragState = { from: number; to: number; offset: number };

type DragGeometry = {
  startY: number;
  /** 드래그 시작 시점의 각 항목 세로 중심 */
  centers: number[];
  /** 끌던 항목이 한 칸 옮겨 갈 때 다른 항목이 비켜나는 거리 (항목 높이 + 간격) */
  step: number;
  minOffset: number;
  maxOffset: number;
};

/**
 * 세로 목록을 손잡이로 끌어 순서를 바꾼다. 마우스·터치 모두 포인터 이벤트로 처리한다.
 * listRef 의 직계 자식들이 순서를 바꿀 항목이며, 놓는 순간 onReorder(from, to) 를 부른다.
 */
export function useDragReorder(listRef: RefObject<HTMLElement | null>, onReorder: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const geometryRef = useRef<DragGeometry | null>(null);

  const start = (index: number, event: PointerEvent<HTMLElement>) => {
    const list = listRef.current;
    if (!list || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const rects = Array.from(list.children).map((child) => child.getBoundingClientRect());
    const dragged = rects[index];
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    geometryRef.current = {
      startY: event.clientY,
      centers: rects.map((rect) => rect.top + rect.height / 2),
      step: dragged.height + gap,
      minOffset: rects[0].top - dragged.top,
      maxOffset: rects[rects.length - 1].bottom - dragged.bottom,
    };
    setDrag({ from: index, to: index, offset: 0 });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const geometry = geometryRef.current;
    if (!drag || !geometry) return;
    const { startY, centers, step, minOffset, maxOffset } = geometry;
    const offset = Math.min(Math.max(event.clientY - startY, minOffset), maxOffset);
    const draggedCenter = centers[drag.from] + offset;

    // 이웃 칸을 절반 넘게 덮으면 그 자리로 들어간다
    let to = drag.from;
    while (to < centers.length - 1 && centers[to + 1] - step / 2 < draggedCenter) to += 1;
    while (to > 0 && centers[to - 1] + step / 2 > draggedCenter) to -= 1;
    setDrag({ from: drag.from, to, offset });
  };

  const cancel = () => {
    geometryRef.current = null;
    setDrag(null);
  };

  const end = () => {
    if (drag && drag.to !== drag.from) onReorder(drag.from, drag.to);
    cancel();
  };

  /** 키보드로도 옮길 수 있게: 손잡이에 포커스를 두고 ↑/↓ */
  const keyDown = (index: number, event: KeyboardEvent<HTMLElement>) => {
    const count = listRef.current?.children.length ?? 0;
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
    if (to === null || to < 0 || to >= count) return;
    event.preventDefault();
    onReorder(index, to);
  };

  /** 끌리는 항목은 포인터를 따라가고, 그 사이에 낀 항목들은 한 칸씩 비켜난다 */
  const itemStyle = (index: number): CSSProperties | undefined => {
    const step = geometryRef.current?.step ?? 0;
    if (!drag) return undefined;
    if (index === drag.from) return { transform: `translateY(${drag.offset}px)` };
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-step}px)` };
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return { transform: `translateY(${step}px)` };
    return undefined;
  };

  const handleProps = (index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => start(index, event),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyDown(index, event),
  });

  return { draggingIndex: drag?.from ?? null, isDragging: drag !== null, itemStyle, handleProps };
}
