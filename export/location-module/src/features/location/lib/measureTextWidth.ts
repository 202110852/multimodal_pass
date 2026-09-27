/**
 * 텍스트 폭 측정용 공용 probe.
 * 후보 폰트 크기마다 DOM을 붙였다 떼면 레이아웃이 매번 무효화되므로 probe 하나를 재사용한다.
 * 폰트가 Tailwind 클래스로 지정돼 있어 Canvas.measureText 대신 DOM에 붙여 잰다.
 */

let probe: HTMLSpanElement | null = null;

/** 같은 (클래스, 텍스트) 조합의 재측정을 피한다 */
const cache = new Map<string, number>();
let listenersAttached = false;

function attachInvalidation(): void {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;
  // 화면 크기·확대 배율이 바뀌면 측정값이 달라진다
  const invalidate = () => cache.clear();
  window.addEventListener("resize", invalidate, { passive: true });
  window.visualViewport?.addEventListener("resize", invalidate, { passive: true });
}

function getProbe(): HTMLSpanElement {
  if (probe?.isConnected) return probe;
  probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;white-space:nowrap;";
  document.body.appendChild(probe);
  attachInvalidation();
  return probe;
}

/** className에는 폰트 크기·굵기 등 폭에 영향을 주는 클래스를 모두 넘겨야 한다. */
export function measureTextWidth(text: string, className: string): number {
  if (typeof document === "undefined" || !text) return 0;

  const key = `${className}\u0000${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const el = getProbe();
  el.className = className;
  el.textContent = text;
  const width = el.scrollWidth;

  cache.set(key, width);
  return width;
}
