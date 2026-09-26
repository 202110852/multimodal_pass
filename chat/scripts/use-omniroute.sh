#!/usr/bin/env bash
# OmniRoute 로 LLM 제공자를 전환한다.
#   사용: chat/scripts/use-omniroute.sh <OmniRoute API 키> [모델]
#   되돌리기: chat/scripts/use-omniroute.sh --revert
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV="$ROOT/.env"
MODEL_DEFAULT="cl/Claude Opus 4.8"

strip() {  # 기존 전환 블록 제거
  python3 - "$ENV" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1]); t = p.read_text(encoding='utf-8')
t = re.sub(r'\n# ---- OmniRoute 전환 \(자동 생성\) ----\n(?:.*\n)*?# ---- /OmniRoute ----\n', '\n', t)
p.write_text(t, encoding='utf-8')
PY
}

if [[ "${1:-}" == "--revert" ]]; then
  strip
  echo "→ FactChat 으로 되돌림 (model.ts 기본값)"
else
  KEY="${1:?OmniRoute API 키가 필요합니다. 대시보드 → Endpoints 에서 발급하세요}"
  MODEL="${2:-$MODEL_DEFAULT}"
  strip
  cat >> "$ENV" <<EOF

# ---- OmniRoute 전환 (자동 생성) ----
# 되돌리려면: chat/scripts/use-omniroute.sh --revert
LLM_BASE_URL=http://127.0.0.1:20128/v1
LLM_MODEL=$MODEL
FACTCHAT_API_KEY=$KEY
# ---- /OmniRoute ----
EOF
  echo "→ OmniRoute 로 전환 (model=$MODEL)"
fi

cd "$ROOT/chat"
MASTRA_PORT=4470 PGDATABASE=stan_jeju npx mastra build >/dev/null 2>&1
launchctl kickstart -k "gui/$(id -u)/me.lkim.stan-api"
sleep 12
printf "  API 상태: %s\n" "$(curl -s -o /dev/null -w '%{http_code}' https://api.stan.lkim.me/api/agents --max-time 10)  (401=정상, 인증 요구)"
