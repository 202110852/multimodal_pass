# How to Use — 택시 배차 · 주변 주차장

## 활용할 방법

1. **자동차 길찾기** — 출발지·도착지만 넣으면 목적지까지 **예상 택시비**, **걸리는 시간**, **이동 거리**를 제공  
   - Endpoint: `GET /v1/directions`  
   - 응답: `summary.fare.taxi`(원), `summary.duration`(초), `summary.distance`(m)  
   - 택시 실시간 위치·배차 후보는 API가 찾지 않음. **요금·시간·거리 추정**용

---

카카오모빌리티 길찾기 API 활용 가이드입니다.

공통 헤더:

```http
Authorization: KakaoAK ${KAKAO_MOBILITY_REST_API_KEY}
Content-Type: application/json
```

Base URL: `https://apis-navi.kakaomobility.com`

관련 문서:

| API | 파일 |
| --- | --- |
| 다중 출발지 | [다중_출발지_길찾기.md](./다중_출발지_길찾기.md) |
| 다중 목적지 | [다중_목적지_길찾기.md](./다중_목적지_길찾기.md) |
| 자동차 길찾기 | [자동차_길찾기.md](./자동차_길찾기.md) |

---

## 1. 다중 출발지 — 택시 배차

### 무엇을 할 수 있나

호출 범위 안 여러 택시 위치 → 승객(목적지)까지 **예상 시간·이동 거리**를 비교해 최적 택시를 고릅니다.

### 중요

| 정보 | 다중 출발지 API | 자동차 길찾기 API |
| --- | --- | --- |
| 예상 시간 (`duration`, 초) | ✅ | ✅ |
| 이동 거리 (`distance`, m) | ✅ | ✅ |
| **택시 요금 (`fare.taxi`, 원)** | ❌ | ✅ |

→ 배차 후보 비교는 다중 출발지, **택시비는 선택된 1건에 자동차 길찾기**를 추가 호출합니다.

### 흐름

```
여러 택시 좌표 (origins) + 승객 좌표 (destination)
                │
                ▼
  ① POST /v1/origins/directions
     → key별 distance / duration
                │
                ▼
  duration(또는 distance) 최소인 택시 선택
                │
                ▼
  ② GET /v1/directions
     → fare.taxi + distance + duration
```

### ① 다중 출발지 — 시간·거리 비교

**Endpoint:** `POST /v1/origins/directions`

**Request**

```bash
curl -X POST "https://apis-navi.kakaomobility.com/v1/origins/directions" \
  -H "Content-Type: application/json" \
  -H "Authorization: KakaoAK ${KAKAO_MOBILITY_REST_API_KEY}" \
  -d '{
    "origins": [
      { "x": "126.5312", "y": "33.4996", "key": "taxi_A" },
      { "x": "126.5401", "y": "33.4892", "key": "taxi_B" }
    ],
    "destination": {
      "x": "126.5200",
      "y": "33.5100",
      "name": "승객위치"
    },
    "radius": 5000,
    "priority": "TIME"
  }'
```

주요 파라미터:

| Name | 설명 |
| --- | --- |
| `origins[]` | 출발지(택시), 최대 30개. 각각 `x`(경도), `y`(위도), `key` 필수 |
| `destination` | 목적지(승객). `x`, `y` 필수 |
| `radius` | 탐색 반경(m), 최대 10000 |
| `priority` | `TIME`(최단 시간, 기본) / `DISTANCE`(최단 거리) |

**Response (요약)**

```json
{
  "trans_id": "...",
  "routes": [
    {
      "result_code": 0,
      "result_msg": "길찾기 성공",
      "key": "taxi_A",
      "summary": {
        "distance": 2305,
        "duration": 615
      }
    },
    {
      "result_code": 0,
      "result_msg": "길찾기 성공",
      "key": "taxi_B",
      "summary": {
        "distance": 1878,
        "duration": 408
      }
    }
  ]
}
```

꺼내는 값:

| 필드 | 의미 |
| --- | --- |
| `routes[].key` | 요청 시 넣은 출발지 식별자 |
| `routes[].summary.distance` | 이동 거리(m) |
| `routes[].summary.duration` | 예상 시간(초) |

예: `duration`이 더 짧은 `taxi_B`를 배차 후보로 선택.

### ② 자동차 길찾기 — 택시비 포함

**Endpoint:** `GET /v1/directions`

**Request**

```bash
curl -G "https://apis-navi.kakaomobility.com/v1/directions" \
  -H "Authorization: KakaoAK ${KAKAO_MOBILITY_REST_API_KEY}" \
  --data-urlencode "origin=126.5401,33.4892" \
  --data-urlencode "destination=126.5200,33.5100" \
  --data-urlencode "summary=true" \
  --data-urlencode "priority=RECOMMEND"
```

**Response에서 필요한 부분**

```json
{
  "routes": [
    {
      "result_code": 0,
      "summary": {
        "fare": {
          "taxi": 8500,
          "toll": 0
        },
        "distance": 3200,
        "duration": 540
      }
    }
  ]
}
```

| 원하는 정보 | 필드 |
| --- | --- |
| 택시비(원) | `summary.fare.taxi` |
| 통행료(원) | `summary.fare.toll` |
| 거리(m) | `summary.distance` |
| 시간(초) | `summary.duration` |

### 택시 배차 체크리스트

- [ ] 택시 좌표들을 `origins`에 `key`와 함께 넣었는가
- [ ] 승객 위치를 `destination`에 넣었는가
- [ ] `radius` 안에 출발지가 들어오는가 (벗어나면 result_code 207 등)
- [ ] `duration`/`distance`로 최적 택시 선택
- [ ] 선택된 origin → destination으로 `/v1/directions` 호출해 `fare.taxi` 확보

---

## 2. 다중 목적지 — 내 주변(또는 목적지 주변) 주차장

### 무엇을 할 수 있나

하나의 출발지에서 **여러 주차장 좌표**까지 차 기준 **예상 거리·도착 시간**을 비교해, 어디로 갈지 고릅니다.

### 중요

| 기능 | 가능 여부 | 비고 |
| --- | --- | --- |
| 여러 주차장까지 거리/시간 비교 | ✅ | 다중 목적지 API |
| 주차장 목록·좌표 제공 | ❌ | 별도 주차장 API 필요 (예: 제주 주차장 기본정보) |
| 주차장 → 목적지 **도보** 거리/시간 | ❌ | 이 내비 문서 묶음에 보행자 길찾기 없음 |
| 택시비 | ❌ | 다중 목적지는 요약만. 필요 시 자동차 길찾기 |

### 흐름

```
① 주차장 API로 후보 좌표 수집
                │
② POST /v1/destinations/directions
   origin = 현재 위치 (또는 주행 시작점)
   destinations = 주차장들
                │
③ distance / duration 비교 → 주차장 선택
                │
④ 주차장 → 최종 목적지 도보
   - 직선거리(Haversine) 근사, 또는
   - 카카오맵 등 외부 도보 길찾기 API
```

### ① 다중 목적지 — 주차장 후보 비교

**Endpoint:** `POST /v1/destinations/directions`

**Request**

```bash
curl -X POST "https://apis-navi.kakaomobility.com/v1/destinations/directions" \
  -H "Content-Type: application/json" \
  -H "Authorization: KakaoAK ${KAKAO_MOBILITY_REST_API_KEY}" \
  -d '{
    "origin": {
      "x": "126.5312",
      "y": "33.4996",
      "name": "내위치"
    },
    "destinations": [
      { "x": "126.5350", "y": "33.5010", "key": "park_1" },
      { "x": "126.5280", "y": "33.4970", "key": "park_2" }
    ],
    "radius": 5000,
    "priority": "DISTANCE"
  }'
```

주요 파라미터:

| Name | 설명 |
| --- | --- |
| `origin` | 출발지. `x`, `y` 필수 |
| `destinations[]` | 목적지(주차장), 최대 30개. `x`, `y`, `key` 필수 |
| `radius` | 탐색 반경(m), 최대 10000 |
| `priority` | `TIME` / `DISTANCE` |

**Response (요약)**

```json
{
  "trans_id": "...",
  "routes": [
    {
      "result_code": 0,
      "key": "park_1",
      "summary": {
        "distance": 1307,
        "duration": 307
      }
    },
    {
      "result_code": 0,
      "key": "park_2",
      "summary": {
        "distance": 1323,
        "duration": 320
      }
    }
  ]
}
```

### ② 주차장 → 목적지 도보

이 API만으로는 **불가**합니다. 선택지:

1. **직선거리 근사 (Haversine)** — 구현 단순, 도로·보행로 미반영  
2. **외부 도보 길찾기** — 카카오맵 등 (이 내비 API 범위 밖)  
3. 자동차 길찾기로 근사 — **도보 시간이 아님**. 비권장

### 주차장 시나리오 체크리스트

- [ ] 주차장 POI/좌표를 별도 API로 확보했는가
- [ ] 좌표를 `destinations`에 `key`와 함께 넣었는가
- [ ] `origin`을 “내 위치” 또는 “목적지 인근 접근점”으로 맞게 잡았는가
- [ ] `distance`/`duration`으로 주차장을 선택했는가
- [ ] 도보는 직선거리 또는 외부 도보 API로 처리했는가

---

## 한눈에 보기

| 유스케이스 | API | 받는 값 | 추가로 필요한 것 |
| --- | --- | --- | --- |
| 택시 배차 후보 비교 | `POST /v1/origins/directions` | distance, duration | — |
| 택시비 | `GET /v1/directions` | fare.taxi, distance, duration | 선택된 origin·destination |
| 주차장 후보 비교 | `POST /v1/destinations/directions` | distance, duration | 주차장 좌표(외부) |
| 주차장→목적지 도보 | (없음) | — | 직선거리 또는 외부 도보 API |

---

## 참고

- 다중 출발지/다중 목적지는 **경로 요약만** 제공합니다. 상세 경로·요금은 [자동차 길찾기](./자동차_길찾기.md)를 추가 요청하세요.
- 출발지/목적지 최대 30개. 초과 시 제휴 문의.
- 에러 코드: [레퍼런스.md](./레퍼런스.md), [문제_해결하기.md](./문제_해결하기.md)
- 원문: https://developers.kakaomobility.com/guide/navi-api/
