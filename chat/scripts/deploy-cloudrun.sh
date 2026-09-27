#!/usr/bin/env bash
# Mastra 백엔드를 Google Cloud Run 에 배포한다. 로컬 Docker 없이 Cloud Build 가 chat/Dockerfile 로 빌드한다.
#
#   cd chat && npm run deploy:cloudrun
#
# 사전 준비(최초 1회): gcloud auth login, 결제 계정이 연결된 프로젝트
# 설정값(.env, 선택): GCP_PROJECT, CLOUD_RUN_REGION(기본 asia-northeast3), CLOUD_RUN_SERVICE(기본 stan-chat-api)
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "✗ $1" >&2
  exit 1
}

command -v gcloud >/dev/null || fail "gcloud 가 없습니다: brew install --cask gcloud-cli"
gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . ||
  fail "gcloud 로그인이 필요합니다: gcloud auth login"

ENV_FILE=$(mktemp -t cloudrun-env)
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"

# 저장소 루트 .env → chat/.env 순으로 읽고(가까운 파일이 우선), Cloud Run 에 넘길 값만 JSON 으로 쓴다.
# 로컬 전용 값은 뺀다: ngrok, 프론트 번들용 VITE_*, 포트·호스트(Cloud Run 이 정함), 로컬 LibSQL 설정.
python3 - "$ENV_FILE" <<'PY'
import json
import re
import sys
from pathlib import Path

LOCAL_ONLY = re.compile(
    r"^(NGROK_.*|VITE_.*|MASTRA_HOST|MASTRA_PORT|PORT|LOCAL_NO_DB|MASTRA_LIBSQL_URL|NODE_ENV"
    r"|GCP_PROJECT|CLOUD_RUN_REGION|CLOUD_RUN_SERVICE)$"
)

values = {}
for path in (Path("../.env"), Path(".env")):
    if not path.exists():
        continue
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if value and not LOCAL_ONLY.match(key):
            values[key] = value

missing = [k for k in ("API_KEYS", "ADMIN_TOKEN", "CORS_ORIGINS", "PG_URL") if not values.get(k)]
if missing:
    sys.exit(f"✗ .env 에 {', '.join(missing)} 가 없습니다. 운영(NODE_ENV=production)에서 필요합니다.")

Path(sys.argv[1]).write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")
print(f"환경변수 {len(values)}개를 넘깁니다: {', '.join(sorted(values))}")
PY

read_env() {
  local key="$1" file value
  for file in .env ../.env; do
    [[ -f "$file" ]] || continue
    value=$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g" || true)
    if [[ -n "$value" ]]; then
      echo "$value"
      return
    fi
  done
}

PROJECT=$(read_env GCP_PROJECT)
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}
[[ -n "$PROJECT" ]] || fail "GCP 프로젝트가 없습니다. .env 에 GCP_PROJECT 를 넣거나 gcloud config set project <ID>"
REGION=$(read_env CLOUD_RUN_REGION)
REGION=${REGION:-asia-northeast3}
SERVICE=$(read_env CLOUD_RUN_SERVICE)
SERVICE=${SERVICE:-stan-chat-api}

echo "프로젝트 $PROJECT · 리전 $REGION · 서비스 $SERVICE"

# --max-instances 1: 트래픽이 몰려도 1대까지만 켜져 비용 상한이 생긴다.
# --timeout 600: 답변 스트리밍이 길어도 끊기지 않게 한다.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 1Gi \
  --timeout 600 \
  --env-vars-file "$ENV_FILE" \
  --quiet

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format "value(status.url)")
echo
echo "배포 완료: $URL"
echo "상태 확인: curl $URL/health"
echo "Vercel 의 VITE_MASTRA_URL 을 이 주소로 바꾸고 Redeploy 한다."
