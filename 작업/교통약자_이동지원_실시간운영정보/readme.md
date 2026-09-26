# 교통약자 이동지원 실시간 운영정보 조회

교통약자 API 중 **실시간 운영정보만** 조회하는 최소 가이드.

---

## 대상 엔드포인트

- `GET https://apis.data.go.kr/B551982/tsdo_v2/info_vehicle_use_v2`
- 설명: 센터 단위 실시간 집계(총 차량, 운행중, 가용, 예약, 대기)

---

## 필수/주요 파라미터

| 파라미터 | 필수 | 설명 |
| --- | --- | --- |
| `serviceKey` | 필수 | 공공데이터포털 서비스키 |
| `type` | 옵션 | `json` 권장 |
| `stdgCd` | 옵션 | 지자체 코드(법정동코드 10자리) |
| `pageNo` | 옵션 | 페이지 번호 (`1`) |
| `numOfRows` | 옵션 | 조회 건수 (`10` 등) |

---

## 호출 예시 (제주)

제주는 시군 코드(`5011000000`, `5013000000`)가 아니라 **광역 코드 `5000000000`** 사용.

```bash
curl -sS -G "https://apis.data.go.kr/B551982/tsdo_v2/info_vehicle_use_v2" \
  --data-urlencode "serviceKey=${TSDO_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" \
  --data-urlencode "numOfRows=10" \
  --data-urlencode "type=json" \
  --data-urlencode "stdgCd=5000000000"
```

---

## 응답 필드

| 필드 | 의미 |
| --- | --- |
| `tvhclCntom` | 총 차량 대수 |
| `oprVhclCntom` | 운행중 대수 |
| `avlVhclCntom` | 가용 대수 |
| `rsvtNocs` | 예약 건수 |
| `wtngNocs` | 대기 건수 |
| `totDt` | 집계 시각 (`YYYYMMDDHHMMSS`) |

---

## 참고

- 이 엔드포인트는 **센터 단위 집계값**만 제공한다.
- 차량별 실시간 운행중 여부는 제공하지 않는다.
- 차량별 정보가 필요하면 `info_vehicle_v2`(기본정보), `info_vehicle_operation_v2`(운행이력)를 별도로 조회해야 한다.

---

## 장애인 유저 길찾기 연동 (카카오 + 동시 호출)

요구사항: **장애인 유저가 길찾기 할 때만** `카카오 길찾기(directions)`와 `info_vehicle_use_v2`를 함께 호출한다.

### 필수 설정

- 카카오 REST 키: `KAKAO_MOBILITY_REST_API_KEY`
- 카카오 Navi Base URL: `KAKAO_MOBILITY_NAVI_BASE_URL`
- TSDO Decoding 키: `TSDO_API_SERVICE_KEY`

### 1) 트리거(조건)

아래 중 하나를 “장애인(휠체어 등) 길찾기”로 판단해서 조건을 건다.

- 사용자가 `접근성 모드`(장애인/휠체어)로 요청했을 때
- “장애인 택시/특장차” 이용이 필요한 목적지 탐색일 때

### 2) 동시 호출(병렬 권장)

동시에 2개를 호출하고, 응답을 UI에 합쳐서 제공한다.

1. **카카오 길찾기(자동차 길찾기)**
   - `GET ${KAKAO_MOBILITY_NAVI_BASE_URL}/v1/directions`
   - Header: `Authorization: KakaoAK ${KAKAO_MOBILITY_REST_API_KEY}`
2. **교통약자 실시간 운영정보**
   - `GET https://apis.data.go.kr/B551982/tsdo_v2/info_vehicle_use_v2`
   - 파라미터: `serviceKey`, `stdgCd`, `pageNo`, `numOfRows`, `type=json`

> 참고: `stdgCd`는 목적지 기준 행정구역 코드로 결정한다. (제주만 예외적으로 `5000000000`만 사용)

### 3) 결합해서 보여줄 정보

- 카카오 응답: 예상 시간/거리/경로
- `info_vehicle_use_v2` 응답: `oprVhclCntom`(운행중), `avlVhclCntom`(가용), `rsvtNocs`(예약), `wtngNocs`(대기), `totDt`(집계 시각)

### 4) 주의사항

- `info_vehicle_use_v2`는 **센터 단위 집계**다. “차량별 운행중”을 보여줄 수는 없다.
