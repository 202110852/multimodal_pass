#!/usr/bin/env bash
# Mastra 백엔드 + OmniRoute 를 Google Cloud Run 에 배포한다. 로컬 Docker 없이 Cloud Build 가 chat/Dockerfile 로 빌드한다.
#
#   cd chat && npm run deploy:cloudrun
#
# 사전 준비(최초 1회): gcloud auth login, 결제 계정이 연결된 프로젝트
# 설정값(.env, 선택): GCP_PROJECT, CLOUD_RUN_REGION(기본 asia-northeast3), CLOUD_RUN_SERVICE(기본 stan-chat-api),
#                     OMNIROUTE_HOME(기본 ~/.omniroute)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_cloudrun-common.sh

ENV_FILE=$(mktemp -t cloudrun-env)
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"

# 저장소 루트 .env → chat/.env 순으로 읽고(가까운 파일이 우선), Cloud Run 에 넘길 값만 JSON 으로 쓴다.
# 로컬 전용 값은 뺀다: ngrok, 프론트 번들용 VITE_*, 포트·호스트(Cloud Run 이 정함), 로컬 LibSQL 설정.
# OmniRoute 설정 DB 의 API 키를 푸는 STORAGE_ENCRYPTION_KEY 는 로컬 OmniRoute 의 .env 에서 가져온다.
python3 - "$ENV_FILE" "$OMNIROUTE_HOME/.env" <<'PY'
import json
import re
import sys
from pathlib import Path

LOCAL_ONLY = re.compile(
    r"^(NGROK_.*|VITE_.*|MASTRA_HOST|MASTRA_PORT|PORT|LOCAL_NO_DB|MASTRA_LIBSQL_URL|NODE_ENV"
    r"|GCP_PROJECT|CLOUD_RUN_REGION|CLOUD_RUN_SERVICE|OMNIROUTE_HOME)$"
)


def read_env_file(path):
    values = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("\"'")
        if value:
            values[key.strip()] = value
    return values


values = {}
for path in (Path("../.env"), Path(".env")):
    for key, value in read_env_file(path).items():
        if not LOCAL_ONLY.match(key):
            values[key] = value

encryption_key = read_env_file(Path(sys.argv[2])).get("STORAGE_ENCRYPTION_KEY")
if encryption_key:
    values["STORAGE_ENCRYPTION_KEY"] = encryption_key

required = ("API_KEYS", "ADMIN_TOKEN", "CORS_ORIGINS", "PG_URL", "STORAGE_ENCRYPTION_KEY")
missing = [k for k in required if not values.get(k)]
if missing:
    sys.exit(f"✗ {', '.join(missing)} 가 없습니다. 운영(NODE_ENV=production)과 OmniRoute 에 필요합니다.")

Path(sys.argv[1]).write_text(json.dumps(values, ensure_ascii=False), encoding="utf-8")
print(f"환경변수 {len(values)}개를 넘깁니다: {', '.join(sorted(values))}")
PY

echo "프로젝트 $PROJECT · 리전 $REGION · 서비스 $SERVICE"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format "value(projectNumber)")
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# ── 최초 1회 준비 (이미 되어 있으면 건너뛴다) ──────────────────────
# OmniRoute 설정 스냅샷 버킷: 비공개, Cloud Run 서비스 계정만 읽는다.
if ! gcloud storage buckets describe "gs://$OMNIROUTE_BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$OMNIROUTE_BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets add-iam-policy-binding "gs://$OMNIROUTE_BUCKET" --project "$PROJECT" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/storage.objectViewer >/dev/null
gcloud storage objects describe "gs://$OMNIROUTE_BUCKET/storage.sqlite" --project "$PROJECT" >/dev/null 2>&1 ||
  bash scripts/omniroute-sync.sh --no-restart

# ── 배포 ─────────────────────────────────────────────────────────
# --max-instances 1: 트래픽이 몰려도 1대까지만 켜져 비용 상한이 생긴다.
# --timeout 600: 답변 스트리밍이 길어도 끊기지 않게 한다.
# 버킷 마운트(Cloud Storage 볼륨)는 2세대 실행 환경에서만 된다.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --execution-environment gen2 \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 1Gi \
  --timeout 600 \
  --env-vars-file "$ENV_FILE" \
  --clear-volumes \
  --clear-volume-mounts \
  --add-volume "name=omniroute,type=cloud-storage,bucket=$OMNIROUTE_BUCKET,readonly=true" \
  --add-volume-mount "volume=omniroute,mount-path=/mnt/omniroute" \
  --quiet

# ── 저장 공간 정리 규칙 (배포 후: 저장소·버킷은 첫 배포 때 만들어진다) ──
# 이미지는 최근 2개만 남긴다. OmniRoute 층이 커서 쌓이면 무료 저장 한도(0.5GB)를 크게 넘는다.
POLICY_FILE=$(mktemp -t ar-cleanup)
cat > "$POLICY_FILE" <<'JSON'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "1d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --project "$PROJECT" --location "$REGION" --policy "$POLICY_FILE" --no-dry-run --quiet >/dev/null
rm -f "$POLICY_FILE"

# 배포할 때 올라가는 소스 압축 파일은 7일 뒤 지운다.
LIFECYCLE_FILE=$(mktemp -t gcs-lifecycle)
echo '{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 7}}]}' > "$LIFECYCLE_FILE"
gcloud storage buckets update "gs://run-sources-${PROJECT}-${REGION}" --project "$PROJECT" \
  --lifecycle-file "$LIFECYCLE_FILE" --quiet >/dev/null 2>&1 || true
rm -f "$LIFECYCLE_FILE"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format "value(status.url)")
echo
echo "배포 완료: $URL"
echo "상태 확인: curl $URL/health"
echo "OmniRoute 설정을 바꾸면: npm run omniroute:sync"
