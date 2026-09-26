# 국토교통부_(TAGO)_공유 퍼스널모빌리티정보 서비스

국토교통부·국가대중교통정보센터(TAGO)가 공유 퍼스널모빌리티(개인형이동장치/PM, 전동킥보드 등)의 **운영사·지역·장치 위치·배터리** 정보를 통합 개방한 OpenAPI.  
복합경로 안내(대중교통 ↔ 킥보드) 등에 활용.

| | |
| --- | --- |
| 포털 | [data.go.kr/data/15117668](https://www.data.go.kr/data/15117668/openapi.do) |
| 인증키·활용신청 현황 | [마이페이지 인증키 발급현황](https://www.data.go.kr/iim/api/selectAPIAcountView.do) |
| 제공기관 | 국토교통부 |
| 관리부서 | 모빌리티총괄과 · `054-459-7906` |
| 분류 | 교통및물류 - 물류등기타 |
| API 유형 | REST (GET) |
| 포맷 | JSON / XML (`_type=json` 권장) |
| Base URL | `https://apis.data.go.kr/1613000/PersonalMobilityInfo` |
| 영문 서비스명 | `PersonalMobilityInfo` |
| 데이터 갱신주기 | 약 10초 |
| 비용 | 무료 · 이용허락 제한 없음 |
| 트래픽 | 개발 10,000/일 · 운영은 활용사례 등록 시 증설 가능 |
| 심의 | 개발·운영 자동승인 |
| 참고문서 | `오픈API활용가이드_국토교통부(TAGO)_퍼스널모빌리티정보v1.1.docx` |
| 프로젝트 `.env` | `PM_API_SERVICE_KEY`, `PM_API_BASE_URL` |

---

## 서비스 개요

제공 항목 2종:

1. **운영사 목록** (`GetPMProvider`) — 지역별 정보제공 가능 운영사·지역코드
2. **장치 목록** (`GetPMListByProvider`) — 지역·운영사 기준 탑승가능 PM (장치ID·배터리·좌표)

키워드: 개인형이동장치, 공유킥보드, 전동킥보드, 공유 모빌리티, PM, TAGO

호출 순서 권장:

1. `GetPMProvider`로 `cityCode`·`providerName` 확인
2. `GetPMListByProvider`에 그 값을 넣어 주변 장치 조회

---

## 인증 · 프로젝트 설정

공공데이터포털 **Decoding** 서비스키를 `serviceKey` 쿼리에 넣는다.  
(이미 URL-encoded 된 Encoding 키를 쓸 때는 추가 encode 하지 말 것.  
`--data-urlencode` / `urlencode`에 Encoding 키를 넣으면 이중 인코딩으로 `30`·403이 난다.)

**이 API는 별도 활용신청이 필요하다.** 관광공사·기상청과 같은 계정 키라도, 해당 데이터셋에 신청·승인되지 않으면 `30`(`SERVICE_KEY_IS_NOT_REGISTERED_ERROR`)이 난다.

> **커버리지·필터 실측**은 `작업/국토교통부_TAGO_공유_퍼스널모빌리티정보/` 참고.  
> (문서 작성 시점과 달리 지역·운영사 목록은 수시로 바뀐다.)

신청·키 확인 경로:

1. [포털 상세](https://www.data.go.kr/data/15117668/openapi.do) → **활용신청** (자동승인)
2. [인증키 발급현황](https://www.data.go.kr/iim/api/selectAPIAcountView.do)에서 Decoding 키·신청 상태 확인

`.env`:

```bash
# 공공데이터포털 — TAGO 공유 퍼스널모빌리티 (PersonalMobilityInfo)
# https://www.data.go.kr/data/15117668/openapi.do 활용신청 후 키 사용

PM_API_SERVICE_KEY=${TOUR_API_SERVICE_KEY}

PM_API_BASE_URL=https://apis.data.go.kr/1613000/PersonalMobilityInfo
```

동일 포털 계정이면 Tour/기상청 키와 같아도 되지만, **반드시 이 OpenAPI에 활용신청**을 먼저 한다.

---

## 오퍼레이션

| # | 경로 | 요약 | 비고 |
| --- | --- | --- | --- |
| 1 | `GET /GetPMProvider` | 지역별 공유전동킥보드 운영사 목록 | `providerName`·`cityName` 옵션 (미입력 시 전체) |
| 2 | `GET /GetPMListByProvider` | 지역·운영사 기반 탑승가능 PM 목록 | `providerName`·`cityCode` **필수** |

### 공통 요청 파라미터

| 파라미터 | 구분 | 설명 |
| --- | --- | --- |
| `serviceKey` | 필수 | 포털 인증키 (URL Encode) |
| `pageNo` | 옵션 | 페이지 번호 (예: `1`) |
| `numOfRows` | 옵션 | 한 페이지 건수 |
| `_type` | 옵션 | `xml` / `json` (**밑줄 `_type`** — 타 API의 `type`과 다름) |

### 호출 예

```bash
# Decoding 키는 --data-urlencode 로 넘길 것 (Encoding 키면 쿼리에 그대로)

# 1) 운영사·지역코드 조회
curl -sS -G "${PM_API_BASE_URL}/GetPMProvider" \
  --data-urlencode "serviceKey=${PM_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=100" \
  --data-urlencode "_type=json"

# 2) 해당 운영사·지역코드로 장치 목록 (예: 세종 ALPACA)
curl -sS -G "${PM_API_BASE_URL}/GetPMListByProvider" \
  --data-urlencode "serviceKey=${PM_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=20" \
  --data-urlencode "_type=json" \
  --data-urlencode "providerName=ALPACA" \
  --data-urlencode "cityCode=12"
```

성공 시 `header.resultCode` = `00` (`NORMAL SERVICE.`).

> **응답 필드명 주의:** 요청은 camelCase(`providerName`, `cityCode`)인데, XML/JSON 응답 item은 소문자(`providername`, `citycode`, `vehicleid`)인 경우가 많다. 파싱 시 대소문자에 주의.

---

## 1. GetPMProvider — 지역별 운영사 목록

정보제공 가능한 지역·운영사 조합을 조회한다.  
`GetPMListByProvider`에 넣을 `cityCode`·`providerName`을 여기서 확인한다.

### 추가 요청 파라미터

| 파라미터 | 구분 | 설명 |
| --- | --- | --- |
| `providerName` | 옵션 | 운영사명 (예: `ALPACA`). 미입력 시 전체. **실측상 정상 필터** |
| `cityName` | 옵션 | 시군 단위 지역명 (가이드 표기). **실측상 무시되는 경우가 있음** — 응답의 `cityname`/`citycode`로 판별 |

### 응답 item

| 필드 | 설명 |
| --- | --- |
| `citycode` | 지역코드 (예: `12` = 세종특별시) |
| `cityname` | 지역명 |
| `providername` | 정보제공 가능 운영사명 |

가이드 샘플:

```
GET .../GetPMProvider?serviceKey=...&providerName=SWING&cityName=세종&numOfRows=10&pageNo=1&_type=xml
```

---

## 2. GetPMListByProvider — 탑승가능 PM 목록

지역·운영사 기준으로 **현재 탑승 가능**한 공유전동킥보드 목록을 조회한다.

### 추가 요청 파라미터

| 파라미터 | 구분 | 설명 |
| --- | --- | --- |
| `providerName` | 필수 | 운영사명 (예: `SWING`) — `GetPMProvider`로 확인 |
| `cityCode` | 필수 | 지역번호 (예: `12`) — `GetPMProvider`로 확인 |

### 응답 item

| 필드 | 설명 |
| --- | --- |
| `providername` | 운영사명 |
| `vehicleid` | 장치 ID |
| `battery` | 배터리 잔량 (0–100) |
| `citycode` | 지역번호 |
| `cityname` | 지역명 |
| `latitude` | GPS 위도 (WGS84) |
| `longitude` | GPS 경도 (WGS84) |

가이드 샘플:

```
GET .../GetPMListByProvider?serviceKey=...&providerName=SWING&cityCode=12&numOfRows=2&pageNo=1&_type=xml
```

---

## 에러 코드

### 공공데이터포털

| 코드 | 메시지 | 설명 |
| --- | --- | --- |
| `1` | `APPLICATION_ERROR` | 어플리케이션 에러 |
| `4` | `HTTP_ERROR` | HTTP 에러 |
| `12` | `NO_OPENAPI_SERVICE_ERROR` | 서비스 없음·폐기 |
| `20` | `SERVICE_ACCESS_DENIED_ERROR` | 서비스 접근 거부 |
| `22` | `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR` | 요청 한도 초과 |
| `30` | `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | 미등록·미신청 키 |
| `31` | `DEADLINE_HAS_EXPIRED_ERROR` | 활용기간 만료 |
| `32` | `UNREGISTERED_IP_ERROR` | 미등록 IP |
| `99` | `UNKNOWN_ERROR` | 기타 |

포털 게이트웨이 오류는 XML(`OpenAPI_ServiceResponse`)로만 올 수 있다.

### 제공기관 (TAGO)

| 코드 | 메시지 | 설명 |
| --- | --- | --- |
| `99` | `INVALID_REQUEST_PARAMETER_ERROR` | 잘못된 요청 파라미터 |

---

## 프로젝트 활용 메모

- **실측(2026-09-26):** 제공 지역은 세종(`12`)만. 제주 행 없음 → 원도심 PM 후보는 현재 불가. 커버리지 생기면 `작업/…` 재조회.
- 복합경로에서 PM이 필요할 때: `GetPMProvider` → `citycode`/`providername` 확인 → `GetPMListByProvider`.
- 좌표는 WGS84. 카카오/네이버와 동일 계열.
- `cityName` 필터는 실측상 신뢰하기 어렵다. 응답 필드로 지역을 걸러라.
- 갱신주기 약 10초 · 개발 트래픽 1만/일.
