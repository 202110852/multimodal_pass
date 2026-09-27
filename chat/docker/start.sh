#!/bin/sh
# Cloud Run 컨테이너 시작: OmniRoute(컨테이너 내부 127.0.0.1:20128) → Mastra(Cloud Run 이 준 PORT).
# Mastra 는 LLM_BASE_URL=http://127.0.0.1:20128/v1 로 OmniRoute 를 부른다. OmniRoute 는 외부에 열리지 않는다.
set -eu

SNAPSHOT="/mnt/omniroute/storage.sqlite"
OMNIROUTE_DATA="/tmp/omniroute"
OMNIROUTE_PORT=20128

# 마운트된 버킷은 읽기 전용이다. OmniRoute 는 DB 에 기록도 하므로 쓰기 가능한 곳에 복사해서 쓴다.
# 클라우드에서 쌓인 기록은 재시작하면 사라지고, 설정은 스냅샷(npm run omniroute:sync) 기준으로 돌아간다.
[ -f "$SNAPSHOT" ] || { echo "OmniRoute 설정 스냅샷이 없습니다: $SNAPSHOT" >&2; exit 1; }
mkdir -p "$OMNIROUTE_DATA"
cp "$SNAPSHOT" "$OMNIROUTE_DATA/storage.sqlite"

# HOSTNAME 을 지정하지 않으면 컨테이너 호스트명으로 바인딩되어 127.0.0.1 로 닿지 않는다.
DATA_DIR="$OMNIROUTE_DATA" PORT="$OMNIROUTE_PORT" HOSTNAME=127.0.0.1 \
  omniroute serve --no-open --no-tray --port "$OMNIROUTE_PORT" &

# 첫 채팅 요청이 OmniRoute 준비 전에 오지 않도록 뜰 때까지 기다린다.
waited=0
until node -e "fetch('http://127.0.0.1:${OMNIROUTE_PORT}/').then(() => process.exit(0), () => process.exit(1))"; do
  waited=$((waited + 1))
  [ "$waited" -lt 60 ] || { echo "OmniRoute 가 60초 안에 뜨지 않았습니다" >&2; exit 1; }
  sleep 1
done
echo "OmniRoute 준비 완료 (${waited}초)"

export MASTRA_PORT="${PORT:-8080}"
exec node .mastra/output/index.mjs
