# Cloud Run 용 이미지: Mastra 백엔드 + OmniRoute(LLM 라우터). 배포: npm run deploy:cloudrun
#
# libsql 같은 네이티브 모듈이 있어 맥에서 만든 .mastra/output 을 그대로 쓰면 안 된다.
# 리눅스 컨테이너 안에서 설치·빌드한다. OmniRoute 는 Node 22.22.2+ 또는 24 를 요구한다.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx mastra build

FROM node:24-slim

# OmniRoute 는 이미지에서 가장 큰 층(압축 약 800MB)이다. 버전을 고정하고 맨 앞에 두어
# 백엔드 코드만 바뀐 배포에서는 이 층을 다시 저장하지 않게 한다.
# onnxruntime 의 윈도우·맥용 바이너리는 리눅스에서 쓰지 않으므로 지운다.
ARG OMNIROUTE_VERSION=3.8.50
RUN npm install -g "omniroute@${OMNIROUTE_VERSION}" \
    && find /usr/local/lib/node_modules/omniroute -type d \
       \( -path "*/onnxruntime-node/bin/*/darwin" -o -path "*/onnxruntime-node/bin/*/win32" \) \
       -prune -exec rm -rf {} + \
    && npm cache clean --force

WORKDIR /app
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0
COPY --from=build /app/.mastra/output ./.mastra/output
# 시스템 프롬프트는 cwd(/app) 기준 prompts/ 에서 읽는다. /admin 에서 수정한 내용은 재배포·재시작 시 사라진다.
COPY prompts ./prompts
COPY docker/start.sh ./start.sh
CMD ["sh", "./start.sh"]
