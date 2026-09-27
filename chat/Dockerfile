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

# OmniRoute 가 설치된 베이스 (docker/base/Dockerfile, npm run build:base-image 로 만든다).
# 매 배포마다 OmniRoute 를 설치·업로드하지 않으므로 빌드가 코드 층만큼만 걸린다.
FROM asia-northeast3-docker.pkg.dev/multimodal-pass-api/base-images/omniroute:3.8.50

WORKDIR /app
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0
COPY --from=build /app/.mastra/output ./.mastra/output
# 시스템 프롬프트는 cwd(/app) 기준 prompts/ 에서 읽는다. /admin 에서 수정한 내용은 재배포·재시작 시 사라진다.
COPY prompts ./prompts
COPY docker/start.sh ./start.sh
CMD ["sh", "./start.sh"]
