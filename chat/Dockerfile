# Cloud Run 용 Mastra 백엔드 이미지. 배포: npm run deploy:cloudrun (scripts/deploy-cloudrun.sh)
#
# libsql 같은 네이티브 모듈이 있어 맥에서 만든 .mastra/output 을 그대로 쓰면 안 된다.
# 리눅스 컨테이너 안에서 설치·빌드한다.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx mastra build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    MASTRA_HOST=0.0.0.0
COPY --from=build /app/.mastra/output ./.mastra/output
# 시스템 프롬프트는 cwd(/app) 기준 prompts/ 에서 읽는다. /admin 에서 수정한 내용은 재배포·재시작 시 사라진다.
COPY prompts ./prompts
# Cloud Run 이 PORT 를 정해 준다.
CMD ["sh", "-c", "MASTRA_PORT=${PORT:-8080} exec node .mastra/output/index.mjs"]
