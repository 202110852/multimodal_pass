# Cloud Run 이미지의 베이스: node + OmniRoute. 버전을 올릴 때만 다시 만든다 (npm run build:base-image).
#
# OmniRoute 설치(약 5분)와 그 층 업로드(약 3분)가 배포 빌드 시간의 대부분이었다.
# 베이스로 분리해 두면 배포 빌드는 백엔드 코드 층만 새로 만들고 올린다.
# onnxruntime 의 윈도우·맥용 바이너리는 리눅스에서 쓰지 않으므로 지운다.
FROM node:24-slim
ARG OMNIROUTE_VERSION=3.8.50
RUN npm install -g "omniroute@${OMNIROUTE_VERSION}" \
    && find /usr/local/lib/node_modules/omniroute -type d \
       \( -path "*/onnxruntime-node/bin/*/darwin" -o -path "*/onnxruntime-node/bin/*/win32" \) \
       -prune -exec rm -rf {} + \
    && npm cache clean --force
