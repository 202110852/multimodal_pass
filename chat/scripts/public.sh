#!/usr/bin/env bash
# 로컬 백엔드(Mastra, 4111)를 ngrok 고정 도메인으로 외부에 공개한다. Ctrl+C 로 끈다.
#
#   cd chat && npm run public
#
# 백엔드가 이미 켜져 있으면(npm run dev:all 등) 터널만 연다.
# 필요한 값(chat/.env 또는 저장소 루트 .env): NGROK_DOMAIN, API_KEYS, ADMIN_TOKEN, CORS_ORIGINS
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=4111

# 셸 값 → chat/.env → 저장소 루트 .env 순서. src/mastra/env.ts 와 같은 우선순위다.
read_env() {
  local key="$1" file value
  if [[ -n "${!key:-}" ]]; then
    echo "${!key}"
    return
  fi
  for file in .env ../.env; do
    [[ -f "$file" ]] || continue
    value=$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g" || true)
    if [[ -n "$value" ]]; then
      echo "$value"
      return
    fi
  done
}

fail() {
  echo "✗ $1" >&2
  exit 1
}

command -v ngrok >/dev/null || fail "ngrok 이 없습니다: brew install ngrok"

NGROK_DOMAIN=$(read_env NGROK_DOMAIN)
[[ -n "$NGROK_DOMAIN" ]] ||
  fail "NGROK_DOMAIN 이 없습니다. https://dashboard.ngrok.com/domains 의 무료 도메인을 .env 에 넣으세요."

# 외부에 열리면 개발 모드의 '키 없으면 통과'가 곧 누구나 통과다. 비어 있으면 켜지 않는다.
[[ -n "$(read_env API_KEYS)" ]] ||
  fail "API_KEYS 가 없습니다. chat/web/.env.local 의 VITE_API_KEY 와 같은 값을 .env 에 넣으세요."
[[ -n "$(read_env ADMIN_TOKEN)" ]] ||
  fail "ADMIN_TOKEN 이 없습니다 (openssl rand -hex 24). 없으면 관리자 API 와 저장된 대화가 공개됩니다."
[[ -n "$(read_env CORS_ORIGINS)" ]] ||
  echo "! CORS_ORIGINS 가 비어 있습니다. 배포 프론트 도메인(예: https://xxx.vercel.app)을 넣지 않으면 브라우저 요청이 403 입니다." >&2

echo "공개 주소: https://${NGROK_DOMAIN}  (Vercel 의 VITE_MASTRA_URL 에 이 값을 넣는다)"

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "이미 켜진 백엔드(:$PORT)를 공개합니다. .env 를 바꿨다면 백엔드를 다시 켜야 반영됩니다."
  exec ngrok http "$PORT" --url "https://${NGROK_DOMAIN}"
fi

exec concurrently -k -n mastra,ngrok -c green,magenta \
  "mastra dev" \
  "ngrok http $PORT --url https://${NGROK_DOMAIN} --log stdout"
