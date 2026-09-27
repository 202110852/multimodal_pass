#!/usr/bin/env bash
# 로컬 OmniRoute 설정(제공자·콤보·키)을 Cloud Run 에 반영한다.
#
#   cd chat && npm run omniroute:sync               # 스냅샷 업로드 + Cloud Run 재시작
#   bash scripts/omniroute-sync.sh --no-restart     # 업로드만 (deploy-cloudrun.sh 가 사용)
#
# 로컬 대시보드에서 제공자·콤보를 바꾼 뒤 실행한다. 클라우드에서 쌓인 사용 기록은 덮어써진다.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_cloudrun-common.sh

RESTART=1
[[ "${1:-}" == "--no-restart" ]] && RESTART=0

DB="$OMNIROUTE_HOME/storage.sqlite"
[[ -f "$DB" ]] || fail "OmniRoute 설정 DB 가 없습니다: $DB"
command -v sqlite3 >/dev/null || fail "sqlite3 가 없습니다"

SNAPSHOT_DIR=$(mktemp -d -t omniroute-snapshot)
trap 'rm -rf "$SNAPSHOT_DIR"' EXIT

# OmniRoute 가 켜져 있어도 일관된 한 파일로 떠낸다 (WAL 내용까지 합쳐진다). 파일 복사는 깨질 수 있다.
sqlite3 "$DB" ".backup '$SNAPSHOT_DIR/storage.sqlite'"

gcloud storage buckets describe "gs://$OMNIROUTE_BUCKET" --project "$PROJECT" >/dev/null 2>&1 ||
  fail "버킷 gs://$OMNIROUTE_BUCKET 이 없습니다. 먼저 npm run deploy:cloudrun 을 실행하세요."
gcloud storage cp "$SNAPSHOT_DIR/storage.sqlite" "gs://$OMNIROUTE_BUCKET/storage.sqlite" --project "$PROJECT" --quiet
echo "OmniRoute 설정 스냅샷 업로드: gs://$OMNIROUTE_BUCKET/storage.sqlite"

if [[ "$RESTART" == 1 ]]; then
  # 이미지는 그대로 두고 새 리비전을 만들어 컨테이너가 스냅샷을 다시 읽게 한다.
  gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --update-env-vars "OMNIROUTE_SNAPSHOT_AT=$(date +%Y%m%d%H%M%S)" --quiet
  echo "Cloud Run 재시작 완료"
fi
