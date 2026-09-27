import { useLayoutEffect, useState, type CSSProperties } from "react";

/** 챗봇 버튼 위치·크기 (location.css 의 .chat-fab 과 같은 값) */
const FAB_BOTTOM_PX = 24;
const FAB_SIZE_PX = 60;
const FAB_GAP_PX = 12;
const TOP_GAP_PX = 12;
const PANEL_MAX_HEIGHT_PX = 680;
const PANEL_MIN_HEIGHT_PX = 160;
/** 뷰포트가 이만큼 넘게 줄면 가상 키보드가 열린 것으로 본다 */
const KEYBOARD_THRESHOLD_PX = 80;

type PanelBox = { bottom: number; height: number };

function computePanelBox(): PanelBox {
  const viewport = window.visualViewport;
  const viewportTop = Math.round(viewport?.offsetTop ?? 0);
  const keyboardInset = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    : 0;
  const keyboardOpen = keyboardInset > KEYBOARD_THRESHOLD_PX;

  // 키보드가 열리면 버튼 위가 아니라 키보드 바로 위에 붙여 입력창이 가려지지 않게 한다
  const bottom = keyboardOpen ? keyboardInset + 8 : FAB_BOTTOM_PX + FAB_SIZE_PX + FAB_GAP_PX;
  const height = window.innerHeight - bottom - TOP_GAP_PX - viewportTop;
  return {
    bottom,
    height: Math.max(PANEL_MIN_HEIGHT_PX, Math.min(PANEL_MAX_HEIGHT_PX, height)),
  };
}

/** 열려 있는 동안 화면·키보드 크기에 맞춰 챗봇 팝업의 bottom·height 를 계산한다 */
export function useChatPanelBox(open: boolean): CSSProperties {
  const [box, setBox] = useState<PanelBox | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const apply = () => setBox(computePanelBox());
    apply();

    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
    };
  }, [open]);

  if (!box) return {};
  return {
    bottom: `calc(${box.bottom}px + env(safe-area-inset-bottom))`,
    height: `calc(${box.height}px - env(safe-area-inset-bottom))`,
  };
}
