#!/usr/bin/env bash
# Cloud Run 베이스 이미지(node + OmniRoute)를 Cloud Build 로 만들어 Artifact Registry 에 올린다.
# OmniRoute 버전을 바꿀 때만 실행한다. 버전을 바꾸면 chat/Dockerfile 의 BASE_IMAGE 태그도 같이 바꾼다.
#   npm run build:base-image            # 기본 3.8.50
#   OMNIROUTE_VERSION=3.9.0 npm run build:base-image
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_cloudrun-common.sh

VERSION="${OMNIROUTE_VERSION:-3.8.50}"
# 배포용 저장소(cloud-run-source-deploy)는 최신 2개만 남기는 정리 정책이 있어 베이스를 따로 둔다.
REPO="base-images"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/omniroute:${VERSION}"

if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  echo "▶ Artifact Registry 저장소 생성: $REPO"
  gcloud artifacts repositories create "$REPO" --repository-format docker \
    --location "$REGION" --project "$PROJECT" --description "Cloud Run 베이스 이미지 (정리 정책 없음)"
fi

CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT
cat >"$CONFIG" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "--build-arg", "OMNIROUTE_VERSION=${VERSION}", "-t", "${IMAGE}", "."]
images: ["${IMAGE}"]
EOF

echo "▶ 베이스 이미지 빌드: $IMAGE"
gcloud builds submit docker/base --project "$PROJECT" --region "$REGION" --config "$CONFIG"

echo "✓ 완료: $IMAGE"
