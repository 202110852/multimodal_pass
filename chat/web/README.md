# 웹 UI

`chat/` 의 Mastra 에이전트에 붙는 채팅 화면. Vite + React.

```bash
cd chat/web
cp .env.local.example .env.local   # VITE_API_KEY 를 채운다 (팀에서 받는다)
npm install
npm run dev                        # → http://localhost:5173
```

Vite 프록시 기본 대상은 **배포된 챗봇 API(`api.stan.lkim.me`)** 다.
백엔드를 띄울 필요가 없다. 시스템 프롬프트를 바꾸면 같은 API 로 동작이 바뀐다.

로컬 백엔드까지 직접 고칠 때만 로컬을 가리킨다.

```bash
MASTRA_URL=http://127.0.0.1:4470 npm run dev   # 배포본이 그 머신에 떠 있을 때
cd chat && npm run dev:all                      # 자체 mastra dev(:4111) + web
```

### 클론 후 한 번만

`VITE_API_KEY` 가 없으면 화면 상단에 그렇게 뜬다 (요청을 보내기 전에).
키는 배포 번들에 이미 들어 있는 공개값이지만, 교체를 쉽게 하려고 저장소에 두지 않는다.

`VITE_MASTRA_URL` 은 **비워 둔다.** 값을 넣으면 프록시를 건너뛰고 브라우저가 직접
공개 도메인으로 나가서 요청 수 제한(분당 20건)을 타고, Origin 검사에도 걸린다.

### 프록시가 하는 일

1. **기본 대상은 배포 챗봇 API.** 로컬은 `MASTRA_URL` 로 지정.
2. **Origin/Referer 를 떼고 보낸다.** 서버→서버 홉에서 Origin 검사에 걸리지 않게 한다.
3. 백엔드에 닿지 못하면 **502 + 원인 JSON** 을 돌려준다.

## 구조

```
web/src/
  App.tsx       채팅 화면 전부 (스트리밍·스레드·상태표시)
  markdown.ts   marked + DOMPurify
  tools.ts      tool 이름 → 한국어 진행 문구
  styles.css    라이트/다크 (prefers-color-scheme)
```

- **프록시** — `vite.config.ts` 가 `/api` 등을 배포 API(또는 `MASTRA_URL`)로 넘긴다.
- **스트리밍** — `@mastra/client-js` 의 `agent.stream()` + `processDataStream()`.
- **대화 이어가기** — 스레드 id 를 `localStorage` 에 두고 `memory.thread` 로 넘긴다.
