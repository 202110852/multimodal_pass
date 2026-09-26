# multimodal-pass chat

복합경로 안내 챗봇의 Mastra 백엔드 + 웹 UI.

**챗봇 API:** 웹 UI 기본은 배포 API(`api.stan.lkim.me`)를 그대로 쓴다.
동작 방향은 **시스템 프롬프트**(`prompts/system-prompt.txt`)로 맞춘다.

**로컬 Mastra**(`npm run dev` / `dev:all`)를 띄울 때: 도메인 Postgres 미설정이면 DB 도구는 빈 결과로 통과하고, 에이전트 메모리는 로컬 LibSQL 에 둔다.

```bash
cd chat/web
cp .env.local.example .env.local   # VITE_API_KEY
npm run dev                        # 프록시 → api.stan.lkim.me

# 로컬 백엔드까지 개발할 때
cd chat
cp .env.example .env               # FACTCHAT_API_KEY (+ 선택 KAKAO_*)
npm run dev:all                    # mastra(:4111) + web (MASTRA_URL 로컬)
```

도메인 DB(추후 Supabase)를 켤 때는 `.env` 에 `PG_URL` 또는 `PGUSER` 등을 채운다.
`LOCAL_NO_DB=1` 이면 PG 값이 있어도 강제 off.

## 구조

```
src/mastra/
  index.ts          Mastra 인스턴스 (LibSQL 또는 PostgresStore)
  model.ts          FactChat 게이트웨이 (OpenAI 호환)
  env.ts            .env 탐색 (chat/ → 저장소 루트)
  db.ts             pg 풀 + isDbEnabled (로컬 off 지원)
  prompt.ts         시스템 프롬프트 파일 읽기/쓰기 (+ format.ts 규칙을 뒤에 붙임)
  format.ts         답변 형식 규칙 — 사진·추천 질문 (화면과 짝, /admin 에서 안 바뀜)
  admin.ts          /admin/system-prompt (GET·PUT)
  reports.ts        /admin/reports (제보 목록·상태 변경·대화 보기)
  chat.ts           /chat/threads/:id/truncate · fork
  feedback.ts       /chat/feedback · /admin/feedback · /admin/threads/:id
  bugs.ts           /chat/bug-reports · /admin/bug-reports
  messages.ts       저장된 대화 읽기 도우미 (Postgres mastra 스키마)
  agents/jeju.ts    에이전트
prompts/
  system-prompt.txt 시스템 프롬프트 — 매 요청마다 읽는다. /admin 에서 수정
  tools/            장소·FAQ·카카오 경로 등
scripts/
  ask.ts            CLI 질문
  smoke.ts          tool SQL 검증 (도메인 DB 필요)
web/                채팅 UI (Vite + React) — web/README.md
```

제품·복합경로 기획은 저장소 루트 [`chatbot_기획.md`](../chatbot_기획.md) 를 본다.

## 채팅 모드 (레거시 + 길찾기)

사용자는 모드를 고르지 않는다. 에이전트가 대화 맥락으로 정하고, 그 턴에 쓴 tool 로 드러난다.
화면은 답변 위에 작은 라벨을 붙인다 (`web/src/tools.ts` 의 `modeOf`).

| 모드 | tool | 비고 |
|------|------|------|
| 후보 선택 | `search-downtown-stores` · `search-places` · … | 도메인 DB off 시 빈 결과 |
| 길찾기 | `plan-visit-order` · `kakao-directions` · `compare-directions` | 카카오 키 있으면 동작 |
| FAQ | `search-faq` | DB off 시 빈 결과 |
| 오류 제보 | `report-issue` | DB off 시 저장 skip |

모드 규칙은 `prompts/system-prompt.txt` 에 있다 — `/admin` 에서 고친다.

전환하려면 이전 턴이 보여야 한다. 에이전트에 `Memory`(최근 20개 메시지, tool 결과 포함)를
붙였다.

---

아래는 기존 화면 기능 설명이다.

| 기능 | 동작 |
|------|------|
| 추천 질문 | 답변 끝의 `[추천질문]` 블록(`format.ts`)을 `web/src/answer.ts` 가 떼어 버튼으로 보인다. 마지막 답변에만 |
| 답변 속 사진 | `v_poi_image`(대표 사진 1장) → 도구의 `image_url` → 마크다운 이미지. 허용 호스트의 https 만 표시(`markdown.ts`), 깨지면 숨김 |
| 멈춤 | 답변 중에는 보내기 자리에 멈춤. 누르면 **보내기 취소** — 그 질문과 받던 답을 화면·서버 기억에서 지우고 글·사진을 입력창에 돌려놓는다. 서버는 멈춘 직후(0.3초 안) 질문을 저장하므로 0.8초 뒤 `/truncate` 로 지운다. 못 지우면 "응답을 멈췄습니다"로 남긴다 |
| 질문 수정 후 재전송 | 내 질문에 마우스를 올리면 복사·수정. 고쳐 보내면 그 질문부터 뒤의 대화를 화면에서 바로 지우고, 서버 기억에서도 지운 뒤(`POST /chat/threads/:id/truncate`) 새 답을 받는다. 서버에서 못 지우면 화면을 되돌린다 |
| 답변 언어 | 사용자의 가장 최근 질문 언어로 답한다 (`format.ts` 의 답변 언어 규칙). 장소 검색은 한국어로 바꿔 넣고, 외국어 이름(`poi_i18n`)으로도 찾는다 |

수정 전/후 버전을 오가는 방식(`/fork`)을 한때 썼다가 "고치면 지우기"로 바꿨다.
그때 브라우저에 여러 갈래로 저장된 대화는 읽을 때 마지막으로 보던 갈래만 남긴다(`store.ts` 의 `loadChat`).
`/fork` 는 그 시기에 열어 둔 화면을 위해 남겨 두었다.
| 복사 | 답변 아래 복사 버튼. 사진 줄·추천 질문은 빼고 마크다운 원문을 복사 |
| 사진 첨부 | 입력창 사진 버튼·붙여넣기·끌어다 놓기, 한 번에 3장. 브라우저에서 긴 변 1024px JPEG 로 줄여 보내고(`attach.ts`), 보관함에는 512px 미리보기만 둔다. 모델은 `cl/openrouter/free`(vision) 로 확인 |
| 음성 입력 | 마이크 버튼 → 말하고 다시 누르면 입력창에 글이 들어간다. **브라우저 내장 음성인식**(`voice.ts`) — 크롬·엣지·사파리. 없으면 버튼을 숨긴다 |
| 대화 검색 | 대화 목록 패널 검색창 — 모든 대화에서 찾고, 누르면 그 메시지로 이동해 강조 |
| 대화 내보내기 | 대화 목록의 **내보내기** → 그 대화를 마크다운 파일로 (`exportChat.ts`) |
| 버그 리포트 | 어느 화면에서든 우클릭 → **버그 리포트 보내기** (Shift+우클릭은 브라우저 메뉴). 페이지 전체 캡처 + 보던 영역, 앱 내부 상태, 브라우저 환경, 최근 콘솔·네트워크·동작 기록을 `/chat/bug-reports` 로 보낸다 (`web/src/debug/`). `/admin` **버그 리포트** 탭에서 본다. 관리자 토큰·API 키는 담지 않고, 서버도 비밀처럼 보이는 이름의 값을 가린다 |
| 좋아요/싫어요 | 답변 아래. 싫어요는 이유(선택)를 받는다. `answer_feedback` 에 남고 `/admin` **피드백** 탭에서 본다 |
| 대화 목록 | 헤더 **대화 목록** — 이전 대화로 전환·삭제. 제목은 첫 질문. 최근 30개 |
| 저장한 경로 | 방문순서를 짠 답변 아래 **이 경로 저장** → 헤더 **저장한 경로** 에서 펼치기·이름 바꾸기·삭제·원래 대화·**대화에서 쓰기**(poi_id 를 붙인 글을 입력창에 넣는다). 최근 50개 |

대화 목록과 저장한 경로는 **이 브라우저의 localStorage 에만** 있다 (`web/src/store.ts`).
로그인이 없어서 기기를 바꾸거나 사이트 데이터를 지우면 사라진다.
대화 id 가 곧 서버 스레드 id 라 전환하면 챗봇 기억도 그 대화로 이어진다 (버전 방식 시기의 대화는 스레드 id 가 따로 저장돼 있다).
목록에서 지워도 서버의 스레드는 남는다.
새 대화 id 는 `web-<UUID>` 다 — 질문 수정 API 가 스레드 id 만으로 열리므로 추측하기 어렵게 만든다.
(그 API 는 공개 web 키로 열리지만 내용은 돌려주지 않고, `resource=web` 스레드만 자른다.) 저장 공간이 차면 오래된 대화부터 비운다(지금 대화는 남김).
예전 단일 대화 저장 형식(`stan-jeju-thread`/`stan-jeju-messages`)은 처음 열 때 목록으로 옮긴다.

스트리밍 중 답변은 마크다운 블록 단위로 그린다(`markdownBlocks`). 통째로 innerHTML 을 바꾸면
받은 사진까지 매 글자마다 새로 불러와 깜빡인다.

## tool 11개

DB 설계할 때 만든 뷰가 그대로 tool이 된다.

| tool | 읽는 곳 | 쓰는 상황 |
|------|---------|-----------|
| `kakao-search-places` | 카카오맵 Local API | 키워드·주변 업종 검색, 출발·도착 좌표 확인 |
| `kakao-directions` | 카카오맵 / 카카오모빌리티 API | 도보·자전거·대중교통·자동차 경로, 거리·예상 시간·제공 요금 |
| `search-downtown-stores` | `poi` (`source=downtown_store`, downtown_stores.csv) | 원도심 조합원·쿠폰·지역화폐·네이버 링크 |
| `search-places` | `v_poi_merged` + `poi_keyword` (pg_trgm) | 이름·키워드로 찾기 |
| `nearby-places` | `earthdistance` + `v_poi_visible` | "근처 주차장", "가까운 화장실" |
| `place-detail` | `v_poi_merged` + `v_poi_merged_i18n` + `v_poi_attr` | 상세. 소스가 달라도 항목 이름이 같다 |
| `check-metric` | `poi_metric` | 혼잡도·주차 여석·충전기 가용 |
| `get-weather` | `weather_ai_brief` · `weather_forecast` · `weather_warning` | 일정·실외활동 판단 |
| `naver-map-link` | `v_poi_merged` 좌표 | 길안내 링크 |
| `search-faq` | `faq` | 쿠폰·여행자센터·면세·상점가 안내 |
| `report-issue` | `place_report` (쓰기) | 틀린 정보 제보 |
| `plan-visit-order` | `v_poi_merged` 좌표 | 확정된 방문지의 순서 (최근접 이웃 + 2-opt, 직선거리) |

세 가지가 tool 안에 녹아 있다:

- **노출 정책** — `search`/`nearby` 는 `v_poi_visible` 을 조인한다. `poi_visibility` 에 규칙을 넣으면
  (내국인 카지노 차단 등) 에이전트 코드를 고치지 않아도 바로 걸린다.
- **소스 통합** — `v_poi_merged` 라서 관광공사 + 비짓제주 + 착한가격업소가 한 건으로 나오고
  `sources` 에 출처가 다 들어 있다.
- **공통 항목** — `place-detail` 의 `facts` 는 `attr_dict.common_key` 로 정리돼 있어
  주차·이용시간·휴무일이 소스와 무관하게 같은 라벨로 나온다.

## 배포

`stan.lkim.me`(프론트) / `api.stan.lkim.me`(백엔드) 로 서비스 중이다.
nginx · launchd · certbot 구성과 재배포 절차는 [`DEPLOY.md`](DEPLOY.md).

## LLM — Mindlogic FactChat 게이트웨이

Anthropic 에 직접 붙지 않는다. 동국대 WISE 캠퍼스가 제공하는
**FactChat API Gateway**(OpenAI 호환)를 통한다.

| | |
|---|---|
| Base URL | `https://factchat-cloud.mindlogic.ai/v1/gateway` |
| 인증 | `Authorization: Bearer <키>` (`x-api-key` 도 지원) |
| 모델 | `claude-opus-5` (기본) · `claude-sonnet-5` · `gpt-5` |
| 키 발급 | FactChat 좌측 하단 **개발자 설정 → API 키 생성** (재조회 불가) |
| 문서 | <https://docs.mindlogic.ai> |

키 이름은 `FACTCHAT_API_KEY` 를 쓴다. `LLM_API_KEY` / `ANTHROPIC_API_KEY` 도 순서대로 받아 준다
(게이트웨이 키는 32자 영숫자로 `sk-ant-*` 형식이 아니다 — Anthropic 키와 헷갈리지 말 것).
모델·엔드포인트는 `LLM_MODEL` / `LLM_BASE_URL` 로 바꿀 수 있다.

**tool calling 지원은 실제 호출로 확인했다** (`finish_reason=tool_calls`).

## 에이전트 메모리

도메인 DB off(로컬 기본)이면 **LibSQL**(`file:./.mastra/local-memory.db`)에 스레드·메시지를 저장한다.
Postgres(추후 Supabase)를 켠 경우에는 `PostgresStore` + `mastra` 스키마를 쓴다.
`/api/memory/*` 는 남의 대화를 돌려주므로 `ADMIN_TOKEN` 으로만 열린다 (`auth.ts`).
화면의 대화 기록은 브라우저 localStorage 에 따로 둔다.

## 검증 상태

로컬 Postgres(POI 12,368건)에 대고 실제로 돌려서 확인했다.

| 항목 | 결과 |
|------|------|
| `npm run smoke` | tool 9개 전부 통과 (FAQ 1순위·방문순서 방향까지 검사) |
| `npm run typecheck` | 통과 |
| `npm run ask` (한국어) | "관덕정 근처 주차장" → tool 5단계, 요금·운영시간·길찾기 링크 |
| `npm run ask` (일본어) | 흑돼지 맛집 → tool 6단계, 일본어 응답 |
| `npm run ask` (날씨) | "내일 비 와?" → 실내 장소 추천, tool 4단계 |
| `npm run dev` | `GET /api/agents` → 200, tool 6개 · model `claude-opus-5` |
| `npm run dev:all` + 브라우저 | 스트리밍·tool 진행표시·마크다운·링크 렌더 확인 |

## 주의할 점 (직접 밟은 것들)

- **`maxSteps` 기본값은 5다.** '검색 → 상세 → 근처 → 링크' 흐름이 중간에 끊긴다.
  에이전트에 `defaultOptions: { maxSteps: 15 }` 를 걸어 뒀다.
  프론트에서 `generate()`/`stream()` 을 직접 부를 때도 넘겨야 한다.
  (이 버전의 옵션명은 `defaultOptions` — `defaultGenerateOptions` 는 없고 `*Legacy` 만 있다.)
- **`.env` 를 import 사이드이펙트로 읽으면 안 된다.** `mastra dev` 는 코드를
  `.mastra/output/` 으로 번들하는데, 번들러가 부수효과만 있는 import 를 제거한다.
  `env.ts` 의 `loadEnvFiles()` 를 **호출해서** 쓴다. 경로도 `import.meta.url` 이 아니라
  `process.cwd()` 에서 위로 올라가며 찾는다(번들 후에는 파일 위치가 달라진다).
- **`poi_id` 는 `bigserial`** 이라 node-postgres 가 문자열로 준다.
  `db.ts` 에서 int8·numeric 파서를 설정해 뒀다.

## 알려진 한계

- **`naver-map-link` 는 공개 웹 URL 형식**을 쓴다. 프로젝트 todo 에 "네이버지도 링크를 만드는
  stan 내부 코드"가 있다고 되어 있으니, 그 코드가 있으면 URL 생성부를 교체할 것.
- **날씨 데이터가 오래되면** 현재 시각 창이 비어 가장 최근 예보를 돌려주고 `stale_from` 에
  기준 시각을 넣는다. 에이전트가 사용자에게 시점을 밝히도록 지시해 뒀다.
- **벡터 검색(RAG) 없음.** 지금은 `pg_trgm` 부분일치 + 키워드 83,558건으로 찾는다.
  의미 검색이 필요해지면 `db-pg/04_vector.sql` 을 적용하고 tool 을 하나 더 만든다.
- **웹 UI 는 `web/` 에 있다.** 장소 카드·지도 임베드·대화 목록은 아직 없다 — `web/README.md` 참고.

## 카카오 장소 검색·경로 조회

저장소 루트 `.env` 또는 `chat/.env`의 `KAKAO_MOBILITY_REST_API_KEY`를 그대로 사용한다.
별도 앱 키를 쓰려면 `KAKAO_REST_API_KEY`를 추가한다. 장소 검색과 도보·자전거·대중교통은
`KAKAO_REST_API_KEY` 우선, 자동차는 `KAKAO_MOBILITY_REST_API_KEY` 우선이며 없으면 다른 키를 쓴다.
키는 서버에서만 읽으며 프론트 환경변수에 넣지 않는다. 해당 앱의 API 사용 권한이 필요하다.

- “카카오맵에서 제주 관덕정 근처 카페 찾아줘”
- “관덕정에서 제주동문시장까지 걸어서 얼마나 걸려?”
- “제주공항에서 동문시장까지 버스로 가는 법 알려줘”
- “제주공항에서 관덕정까지 자동차 경로 알려줘”

출발지·이동수단이 없으면 챗봇이 확인한다. 이름이 애매하면 후보를 확인하고 검색 결과의 좌표를 쓴다.
카카오 장소 ID는 DB의 `poi_id`와 별개다. 검색 응답에는 영업시간·평점이 없으므로 추정하지 않는다.
자동차 요금은 예상 택시요금과 통행료다. 경로는 최대 3개, 구간 안내는 최대 60개로 제한한다.
권한 오류·한도 초과·12초 연결 제한·경로 없음은 실패 결과로 돌려주며 시간을 임의 생성하지 않는다.

```bash
npm run test:kakao   # 네트워크·실제 키 없이 입력/요청/실패 처리 검사
npm run smoke:kakao # 실제 키 사용: 장소 검색 2회, 네 이동수단 경로 각 1회
```

2026-09-17 로컬 키로 관덕정→제주동문시장 장소 검색 및 네 이동수단 조회 성공 확인.
API 기준: [카카오맵 REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api),
[카카오모빌리티 자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions.html).
