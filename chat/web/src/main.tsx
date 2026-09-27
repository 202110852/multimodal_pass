import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BugReporter } from "./debug/BugReporter.js";
import { installCollectors } from "./debug/collector.js";
import { Admin } from "./Admin.js";
import { App } from "./App.js";
import { AppLocaleProvider } from "./AppLocaleContext.js";
import { EmbedBridge } from "./EmbedBridge.js";
import { embedded } from "./embed.js";
import { MapHome } from "./MapHome.js";
import "./styles.css";

// 버그 리포트용 콘솔·네트워크 기록은 앱보다 먼저 켠다 — 첫 요청부터 남도록.
installCollectors();

// 페이지가 둘뿐이라 라우터 없이 경로로 나눈다. nginx 는 모든 경로를 index.html 로 돌려준다.
const isAdmin = /^\/admin\/?$/.test(window.location.pathname);
if (embedded && !isAdmin) document.documentElement.classList.add("embedded-chat");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppLocaleProvider>
      {/* 임베드(iframe)는 호스트가 창을 띄우므로 챗봇만, 일반 접속은 지도 메인 + 챗봇 팝업 */}
      {isAdmin ? <Admin /> : embedded ? <App /> : <MapHome />}
      {!isAdmin && <EmbedBridge />}
      <BugReporter />
    </AppLocaleProvider>
  </StrictMode>,
);
