import { useEffect, useState } from "react";

type VirtualKeyboardLike = {
  overlaysContent: boolean;
  addEventListener: (type: "geometrychange", listener: () => void) => void;
  removeEventListener: (type: "geometrychange", listener: () => void) => void;
};

function getVirtualKeyboard(): VirtualKeyboardLike | undefined {
  return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
}

/**
 * 모바일에서 입력창 포커스로 키보드가 열리면 브라우저가 화면을 위로 밀어 sticky 헤더가 가려진다.
 * 밀린 만큼(visualViewport.offsetTop 실측)을 반환하므로 헤더에 translateY로 적용한다.
 */
export function useKeyboardTopInset(inputFocused: boolean): number {
  const [topInset, setTopInset] = useState(0);

  useEffect(() => {
    if (!inputFocused) {
      setTopInset(0);
      return;
    }

    const virtualKeyboard = getVirtualKeyboard();
    if (virtualKeyboard) {
      try {
        virtualKeyboard.overlaysContent = true;
      } catch {
        // 지원하지 않는 브라우저는 무시
      }
    }

    const sync = () => {
      setTopInset(Math.max(0, Math.round(window.visualViewport?.offsetTop ?? 0)));
    };

    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    virtualKeyboard?.addEventListener("geometrychange", sync);
    return () => {
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      virtualKeyboard?.removeEventListener("geometrychange", sync);
      setTopInset(0);
    };
  }, [inputFocused]);

  return topInset;
}
