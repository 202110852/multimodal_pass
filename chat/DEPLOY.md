# 배포 — stan.lkim.me / api.stan.lkim.me

이 맥에서 직접 서비스한다 (A레코드 `183.106.180.88` = 이 머신). nginx + launchd.

| | |
|---|---|
| 프론트 | `https://stan.lkim.me` — 정적, `/opt/homebrew/var/www/stan/dist` |
| 백엔드 | `https://api.stan.lkim.me` → `127.0.0.1:4470` (Mastra) |
| 서비스 | launchd `me.lkim.stan-api` · 로그 `/tmp/stan-api.log` |
| 인증서 | `/Users/lkim/letsencrypt/config/live/stan.lkim.me/` (두 도메인 1장) |
| DB | Postgres `stan_jeju` (에이전트 메모리는 `mastra` 스키마) |

## GitHub Actions 자동 배포

`main`에 push/merge하면 [Deploy production](https://github.com/stanpay/stan_chat_api/actions/workflows/deploy.yml)이
프론트엔드와 Mastra를 함께 배포한다. Actions 화면의 **Run workflow**에서 `main`을 선택해
수동 재배포할 수도 있다. 기존 1분 주기 `me.lkim.stan-autodeploy`는 Actions 전환 후 중지한다.

- runner: 이 Mac의 `stan-production-mac` (`self-hosted`, `macOS`, `ARM64`, `stan-production`).
  설치 위치는 `/Users/lkim/actions-runner-stan`. Mac이 켜져 있고 사용자가 로그인한 동안 동작한다.
- 실행 파일: `.github/workflows/deploy.yml`, `chat/scripts/deploy.py`.
  workflow가 지정한 정확한 커밋을 임시 폴더에서 `npm ci` 후 프론트/Mastra 모두 빌드한다.
- 빌드 성공 후 운영 체크아웃을 fast-forward하고 정적 파일 교체와 Mastra 재시작을 수행한다.
  공개 HTML/JS/CSS 일치와 API health를 확인한 뒤 성공 처리한다.
- 동시 배포는 막고 진행 중인 배포를 새 push 때문에 취소하지 않는다.
  Actions 재실행은 실패 대기시간 없이 실제로 다시 빌드/배포한다.
- 추적 파일에 로컬 수정(관리자 화면의 프롬프트 수정 포함)이 있거나 main에서 벗어났거나
  운영 체크아웃보다 오래된 커밋을 배포하려 하면 실패한다. 파일을 강제로 덮거나 reset하지 않는다.
- 배포 검증 실패 시 직전 프론트/백엔드 빌드 파일을 복원한다. Git 체크아웃, 프롬프트,
  DB까지 되돌리는 것은 아니며 DB 마이그레이션과 nginx 설정 변경은 자동 실행하지 않는다.
- `.env`와 `chat/web/.env.production`은 이 Mac의 기존 파일을 사용하며 GitHub에 업로드하지 않는다.
- Git fetch는 Actions의 작업별 `GITHUB_TOKEN`(contents: read)을 사용한다.
  로그인 키체인이나 영구 PAT에 의존하지 않고 인증정보를 Git 설정 파일에 저장하지 않는다.

배포 로그는 GitHub Actions에 남는다. 마지막 성공 커밋과 오류는 각각
`~/.local/share/stan-autodeploy/deployed.json`, `failed.json`(실패 시)에 기록한다.
runner 상태는 `cd ~/actions-runner-stan && ./svc.sh status`로 확인한다.
검증 테스트: `python3 -m unittest discover -s chat/scripts -p 'test_deploy.py'`.

## 수동 재배포 (장애 대응)

평소에는 Actions의 **Run workflow**를 사용한다. 아래 명령은 Actions 배포가 실행 중이지 않을 때만 실행한다.

```bash
cd /Users/lkim/stan_chat_api/chat

# 프론트
npm --prefix web run build
rsync -a --delete web/dist/ /opt/homebrew/var/www/stan/dist/

# 백엔드
MASTRA_PORT=4470 PGDATABASE=stan_jeju npx mastra build
launchctl kickstart -k gui/$(id -u)/me.lkim.stan-api
```

프론트는 빌드 시 `web/.env.production` 의 `VITE_MASTRA_URL` 이 번들에 박힌다.
개발(`npm run dev:all`)에서는 이 값이 없어 같은 오리진 + Vite 프록시로 동작한다.

## 구성 요소

### 외부 사이트의 채팅 모달

`https://chat.stan.ai.kr` (`stanpay/stan_general`)의 채팅 모달은
`https://stan.lkim.me/?embed=1&lang=<사이트 언어>`를 iframe으로 표시한다. 일반 `/` 화면은 그대로 유지하고,
embed 모드는 모달 안에서 헤더·메시지 스크롤·입력창을 맞춘다.
`web/src/EmbedBridge.tsx`는 준비 상태, Escape 닫기, 입력 포커스를 부모에 전달한다.
부모가 보내는 `stan-chat:config`의 `locale`(ko/en/ja/zh)을 UI·답변·음성 입력에 사용한다.
첫 로딩은 `lang` 파라미터를 쓰고 이후 변경은 새로고침 없이 반영한다.
저장된 채팅 프로필의 언어보다 부모 선택을 우선하며, 일반 사이트의 저장된 UI 언어는 덮어쓰지 않는다.
인증된 부모 iframe에서도 처음 열 때 프로필이 없으면 입력창을 띄운다.
새 대화를 만들 때는 자동으로 띄우지 않으며, 이후에는 사용자가 직접 내정보를 열어 취향을 설정할 수 있다.
부모 출처를 `https://chat.stan.ai.kr`로 확인하며 대화 내용과 인증정보는 공유하지 않는다.
iframe에서 API를 부르는 Origin은 계속 `https://stan.lkim.me`이므로 API CORS를 추가로 열 필요가 없다.
모달을 닫으면 입력 포커스와 음성 입력을 해제하고 iframe은 유지한다.

호스트 설정은 `stan_general/vercel.json`의 `frame-src`와 `Permissions-Policy`에 있다.
이 사이트의 응답에 `X-Frame-Options: SAMEORIGIN`을 추가하면 외부 모달이 차단되므로 주의한다.

**nginx** — `/opt/homebrew/etc/nginx/nginx.conf` 한 파일에 전부 들어 있다.
추가한 것은 세 군데뿐이다.

1. 포트 80 블록의 `server_name` 목록에 두 도메인 추가 (ACME 갱신 + https 리다이렉트)
2. `stan.lkim.me` 443 블록 — 정적 서빙 + SPA fallback + `/assets/` 1년 캐시
3. `api.stan.lkim.me` 443 블록 — `127.0.0.1:4470` 프록시

API 블록은 `proxy_buffering off` 가 필수다. 응답이 SSE 스트리밍이라 버퍼링을 켜두면
답이 다 끝난 뒤에야 한꺼번에 도착한다. tool 이 도는 동안 수십 초가 걸려서
`proxy_read_timeout` 도 600s 로 올렸다.

수정 전 백업: `nginx.conf.bak.stan-<타임스탬프>`. 되돌리려면 그 파일을 복사하고
`nginx -t && nginx -s reload`.

**인증서** — 기존 `ssl/fullchain.pem` 은 `wenroidsofinsldkfnwelrnowietrf.rladlgus.com`
**한 도메인만** 커버하는 단일 인증서라 `lkim.me` 에 못 쓴다.
다른 `*.lkim.me` 사이트들과 같은 방식으로 certbot 으로 새로 받았다.

```bash
certbot certonly --webroot -w /opt/homebrew/var/www/acme \
  -d stan.lkim.me -d api.stan.lkim.me --cert-name stan.lkim.me \
  --config-dir /Users/lkim/letsencrypt/config \
  --work-dir /Users/lkim/letsencrypt/work \
  --logs-dir /Users/lkim/letsencrypt/logs
```

갱신은 기존 `me.lkim.certbot-renew` 가 알아서 한다 (config-dir 아래 전부 renew + nginx reload).

**서비스** — `~/Library/LaunchAgents/me.lkim.stan-api.plist`.
`WorkingDirectory` 가 `chat/` 이어야 `env.ts` 가 위로 올라가며 저장소 루트 `.env`(LLM 키)를 찾는다.

```bash
launchctl list | grep stan-api
launchctl kickstart -k gui/$(id -u)/me.lkim.stan-api   # 재시작
tail -f /tmp/stan-api.log
```

## 접근 제어

세 겹이다. 앞의 둘은 "남이 우리 API 를 쓰는 것"을 막고, **비용 상한을 실제로 잡는 건 세 번째다.**

### 1. Origin 게이트 (nginx)

허용 목록 밖 Origin 은 백엔드에 닿기 전에 403. `nginx.conf` 의 `$stan_origin_ok` 맵.

```nginx
map $http_origin $stan_origin_ok {
    default                 0;
    ""                      1;   # Origin 없는 요청(curl·서버간)은 키로 판단
    "https://stan.lkim.me"  1;
    "http://localhost:5173" 1;
}
```

Origin 헤더는 위조할 수 있다. 브라우저에서 오는 무단 사용을 막는 용도지 인증이 아니다.

### 2. API 키 (`src/mastra/auth.ts`)

`X-API-Key` 또는 `Authorization: Bearer`. 키는 루트 `.env` 의 `API_KEYS` (콤마 구분).
비교는 `timingSafeEqual`. `NODE_ENV=production` 인데 키가 비어 있으면 500 으로 막는다(열어 두지 않는다).

| 키 | 용도 | 비밀인가 |
|---|---|---|
| `web_*` | 프론트 번들 | **아니다.** 소스보기로 보인다 |
| `srv_*` | 서버 간 호출 | 그렇다. 브라우저에 넣지 말 것 |

**`web_*` 키는 비밀이 아니다.** 브라우저 SPA 에 넣는 값은 원리상 숨길 수 없다.
이 키가 하는 일은 (a) 다른 사이트가 우리 API 를 갖다 쓰는 것을 막고,
(b) 남용이 보이면 키만 갈아 끼우는 것이다. 진짜 비밀이 필요하면 로그인을 붙이고
서버가 발급한 단기 토큰을 써야 한다.

교체는 `.env` 의 `API_KEYS` 에서 `web_*` 만 새 값으로 바꾸고
`chat/web/.env.production` 도 같이 고친 뒤 프론트·백엔드를 다시 배포하면 된다.

### 3. 요청 수 제한 (nginx) — 실질적인 비용 상한

```nginx
limit_req_zone $binary_remote_addr zone=stanapi:10m rate=20r/m;
limit_req zone=stanapi burst=10 nodelay;
```

IP 당 분당 20건. 대화 한 번이 HTTP 1건이라(tool 이 여러 번 돌아도) 사람이 쓰기엔 넉넉하고,
스크립트 남용은 걸린다. 더 조이려면 `rate=` 를 낮춘다.

429 응답에는 **CORS 헤더를 따로 붙였다.** 안 붙이면 브라우저가 본문을 못 읽어
"Failed to fetch" 로만 보이고 사용자는 서버가 죽은 줄 안다.

### 확인

```bash
U=https://api.stan.lkim.me/api/agents
curl -s -o /dev/null -w '%{http_code}\n' $U                                   # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $WEB_KEY" $U          # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Origin: https://evil.com" \
                                          -H "x-api-key: $WEB_KEY" $U          # 403
```

### 관리자 페이지 (`/admin`)

`https://stan.lkim.me/admin` 에 탭이 둘 있다.

- **시스템 프롬프트** — 저장하면 `chat/prompts/system-prompt.txt` 가 바로 바뀌고,
  재시작 없이 다음 답변부터 반영된다. 사진·추천 질문 형식 규칙은 화면과 짝이라
  `src/mastra/format.ts` 에 따로 있고, 파일 내용 뒤에 항상 붙는다.
- **제보** (`/admin#reports`) — 챗봇 오류 제보(`place_report`) 목록.
  상태를 새 제보 → 확인 중 → 반영함/반려 로 바꾸고, 제보가 나온 대화를 펼쳐 본다.
  (`report-issue` 의 내용은 모델이 요약한 것이라 원래 대화를 같이 봐야 판단할 수 있다.)
  원본 DB 를 고치는 일은 여기서 하지 않는다 — 확인 후 소스/시드를 고치고 재적재한다.
- **버그 리포트** (`/admin#bugs`) — 우클릭으로 보낸 리포트(`bug_report`). 캡처(보던 화면/전체),
  콘솔·네트워크·최근 동작, 앱 상태, 브라우저 환경을 보고 처리 상태를 바꾸거나 지운다.
- **피드백** (`/admin#feedback`) — 답변 좋아요/싫어요(`answer_feedback`). 싫어요 이유, 답변,
  그 대화를 본다. 질문·답변을 함께 적어 두어 대화 스레드가 지워져도 남는다.

백엔드 API 는 모두 `/admin/` 아래이고 공개 web 키로는 열리지 않는다.

| API | |
|---|---|
| `GET/PUT /admin/system-prompt` | 프롬프트 읽기·저장 |
| `GET /admin/reports?status=new` | 제보 목록 (최근 200건) |
| `PATCH /admin/reports/:id` | `{ "status": "checked" }` 처리 상태 변경 |
| `GET /admin/reports/:id/thread` | 제보가 나온 대화 |
| `GET /admin/feedback?rating=down` | 답변 평가 목록 (최근 200건) + 건수 |
| `GET /admin/threads/:threadId` | 대화 보기 (피드백 탭) |
| `GET /admin/bug-reports?status=new` | 버그 리포트 목록 (최근 200건) |
| `GET /admin/bug-reports/:id` · `/:id/screenshot` | 전체 정보 · 캡처 이미지 |
| `PATCH` · `DELETE /admin/bug-reports/:id` | 처리 상태 변경 · 삭제 |

채팅 화면이 공개 web 키로 부르는 API (`resource=web` 스레드만 다룬다):

| API | |
|---|---|
| `POST /chat/threads/:id/truncate` | 질문 수정·멈춤 — 그 질문부터 지우기 |
| `POST /chat/threads/:id/fork` | (옛 화면용) 수정 지점 앞까지를 새 스레드로 복사 |
| `POST /chat/feedback` | 답변 좋아요/싫어요 |
| `POST /chat/bug-reports` | 버그 리포트 (캡처 3MB·정보 1MB 이내, Mastra 요청 한도 4.5MB) |

### 사진·음성

- **사진** — 브라우저가 줄여서 보낸 사진이 대화 기록(`mastra_messages`)에 그대로 남고, 이후 턴마다
  모델에 다시 들어간다. 모델이 이미지를 받아야 한다 (`cl/openrouter/free` 로 확인, `auto/vision` 은 안 됨).
- **음성** — 서버 받아쓰기가 없다. OmniRoute 에 `/v1/audio/transcriptions` 는 있지만 Whisper 를 쓸
  인증 정보(openai·openrouter·nanogpt)가 없어 400 이다. 그래서 브라우저 내장 음성인식을 쓴다.
  크롬은 음성을 구글 서버로 보내 인식한다. 파이어폭스는 지원하지 않는다.
  받아쓰기 키를 OmniRoute 에 넣으면 서버 방식(녹음 → 업로드)으로 바꿀 수 있다.

저장소 루트 `.env` 의 `ADMIN_TOKEN` 을 `x-admin-token` 헤더로 보내야 한다.
운영(`NODE_ENV=production`)에서 `ADMIN_TOKEN` 이 비어 있으면 503 으로 꺼진다.

```bash
echo "ADMIN_TOKEN=$(openssl rand -hex 24)" >> /Users/lkim/stan_chat_api/.env
launchctl kickstart -k gui/$(id -u)/me.lkim.stan-api
```

프롬프트 파일은 git 추적 대상이다. 운영에서 고친 내용은 이 체크아웃의
`git diff chat/prompts/` 로 보이니, 남길 만하면 커밋한다.

### 남은 것

- 사용자 로그인이 없다. 링크를 아는 사람은 누구나 쓴다 (요청 수 제한 안에서).
- 키 단위 사용량 집계가 없다. 누가 얼마나 썼는지 모른다.
- 관리 API(`/api/agents` 목록 등)도 같은 키로 열린다. 운영/조회 권한 분리는 없다.

## LLM 제공자 전환 (OmniRoute)

FactChat 크레딧이 소진되면 대화가 그 자리에서 멈춘다. 그 대비로
**OmniRoute**(로컬 AI 게이트웨이)를 같은 머신에 올려 뒀다. 여러 제공자를 묶어
하나가 소진되면 다음으로 자동으로 넘긴다.

| | |
|---|---|
| 대시보드 | <http://localhost:20128> — **로컬 전용** |
| API Base | `http://127.0.0.1:20128/v1` (OpenAI 호환) |
| 서비스 | launchd `me.lkim.omniroute` · 로그 `/tmp/omniroute.log` |
| 설정 | `~/omniroute/.env` (600) · 데이터 `~/.omniroute/` |

### ⚠ 바인딩 주의

기본값은 **`0.0.0.0` + 인증 없음**이다. 공인 IP가 붙은 이 머신에서 그대로 두면
누구나 `/v1/*` 을 호출할 수 있고 비용은 등록된 제공자에게 청구된다.

변수 이름이 함정이다 — **`HOST` 가 아니라 `OMNIROUTE_SERVER_HOST`** 다.
`HOST` 로 주면 조용히 무시되고 0.0.0.0 에 열린다.

```bash
OMNIROUTE_SERVER_HOST=127.0.0.1   # 필수
REQUIRE_API_KEY=true              # /v1 에도 키 요구
```

확인:

```bash
lsof -nP -iTCP:20128 -sTCP:LISTEN     # 127.0.0.1:20128 이어야 한다
curl -s -o /dev/null -w '%{http_code}\n' http://183.106.180.88:20128/   # 000
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:20128/v1/models # 401
```

또 하나: OmniRoute 는 **cwd 의 `.env` 를 자동으로 읽는다.** 저장소 루트에서 돌리면
우리 `FACTCHAT_API_KEY`·`API_KEYS` 까지 흡수한다. 그래서 `~/omniroute/` 를
전용 작업 디렉터리로 두고 launchd 의 `WorkingDirectory` 를 거기로 잡았다.

### 현재 적용된 설정

```
LLM_BASE_URL = http://127.0.0.1:20128/v1
LLM_MODEL    = auto/claude-opus        ← 자동 라우팅 별칭
```

`auto/claude-opus` 는 고정 모델이 아니라 **OmniRoute 가 고르는 별칭**이다.
현재는 `anthropic/claude-opus-4.8` 로 풀리고, 한쪽이 소진되면 다음 제공자로 넘어간다.
이게 OmniRoute 를 쓰는 이유다 — FactChat 은 크레딧이 떨어지자 그 자리에서 멈췄다.

**모델 문자열 주의.** 세 가지 표기가 섞여 있다.

| 표기 | 쓰는 곳 |
|---|---|
| `Claude Opus 4.8` | `omniroute models` CLI 출력 (사람이 읽는 이름) |
| `cl/anthropic/claude-opus-4.8` | `/v1/chat/completions` 의 `model` |
| `auto/claude-opus` | 자동 라우팅 별칭 (권장) |

CLI 이름을 그대로 `/v1` 에 넣으면 `400 invalid model format` 이 난다.
정확한 문자열은 `GET /v1/models` 로 확인한다 (575개).

### 전환 절차

1. 대시보드(<http://localhost:20128>)에 로그인 — 비밀번호는 `~/omniroute/.env` 의 `INITIAL_PASSWORD`
2. **Providers** 에서 제공자 추가 (무료: Gemini AI Studio, Groq, Cloudflare Workers AI,
   Mistral, Cohere, Vertex, Scaleway 등. 각자 본인 계정 키가 필요하다)
3. **Endpoints** 에서 OmniRoute API 키 발급
4. 저장소 루트 `.env` 의 주석 3줄을 푼다

```bash
LLM_BASE_URL=http://127.0.0.1:20128/v1
LLM_MODEL=<대시보드에서 고른 모델>
FACTCHAT_API_KEY=<OmniRoute 발급 키>
```

5. 재시작 — `launchctl kickstart -k gui/$(id -u)/me.lkim.stan-api`

또는 스크립트 한 줄로:

```bash
chat/scripts/use-omniroute.sh <OmniRoute키> [모델]   # 전환
chat/scripts/use-omniroute.sh --revert              # FactChat 으로 복귀
```

되돌리려면 그 3줄을 다시 주석 처리하고 같은 명령으로 재시작하면 FactChat 으로 돌아간다
(`model.ts` 의 기본값이 FactChat 이다).

## 점검 명령

```bash
curl -sI https://stan.lkim.me | head -1
curl -sS https://api.stan.lkim.me/api/agents | head -c 80
curl -sSI -X OPTIONS https://api.stan.lkim.me/api/agents \
  -H 'Origin: https://stan.lkim.me' -H 'Access-Control-Request-Method: POST' \
  | grep -i access-control-allow-origin
```
