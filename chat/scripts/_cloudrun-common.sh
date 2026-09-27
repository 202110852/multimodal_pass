# Cloud Run 스크립트 공용 설정. deploy-cloudrun.sh, omniroute-sync.sh 가 source 한다.
# chat/ 디렉터리에서 source 해야 한다.

fail() {
  echo "✗ $1" >&2
  exit 1
}

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

command -v gcloud >/dev/null || fail "gcloud 가 없습니다: brew install --cask gcloud-cli"
gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . ||
  fail "gcloud 로그인이 필요합니다: gcloud auth login"

PROJECT=$(read_env GCP_PROJECT)
PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}
[[ -n "$PROJECT" ]] || fail "GCP 프로젝트가 없습니다. .env 에 GCP_PROJECT 를 넣거나 gcloud config set project <ID>"
REGION=$(read_env CLOUD_RUN_REGION)
REGION=${REGION:-asia-northeast3}
SERVICE=$(read_env CLOUD_RUN_SERVICE)
SERVICE=${SERVICE:-stan-chat-api}

# 로컬 OmniRoute 데이터 폴더. 설정 DB(storage.sqlite)와 암호화 키(.env)가 있다.
OMNIROUTE_HOME=$(read_env OMNIROUTE_HOME)
OMNIROUTE_HOME=${OMNIROUTE_HOME:-$HOME/.omniroute}
# OmniRoute 설정 스냅샷을 두는 비공개 버킷. Cloud Run 이 읽기 전용으로 마운트한다.
OMNIROUTE_BUCKET="${PROJECT}-omniroute"
