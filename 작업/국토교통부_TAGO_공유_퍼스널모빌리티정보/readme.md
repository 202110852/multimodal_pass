# TAGO 공유 퍼스널모빌리티 — 실측 조회 메모

조회 시각: **2026-09-26 18:37** (KST)  
스펙·에러코드: `문서/국토교통부_TAGO_공유_퍼스널모빌리티정보/`  
원본 응답 샘플: `samples/`

---

## 결론 (이 프로젝트 기준)

| 항목 | 실측 |
| --- | --- |
| 현재 데이터 있는 지역 | **세종특별시 (`citycode=12`)만** |
| 제주 | **없음** (`GetPMProvider`에 제주 행 0) |
| 운영사 | `ALPACA`, `GBIKE` (가이드 샘플 `SWING`은 현재 0건) |
| 장치 수 (당시) | ALPACA **1,368** · GBIKE **3,092** |
| 불러오는 값 | 장치ID · 배터리 · 위도/경도 · 운영사 · 지역 |

원도심 챗봇에 **제주 킥보드 실시간 위치를 당장 쓸 수 없다.**  
세종 데이터로 API 동작·필드만 검증 가능.

---

## 인증 (실측)

- `.env`의 `TOUR_API_SERVICE_KEY`로 호출 성공 (`resultCode=00`).
- **Encoding 키**를 curl `--data-urlencode`에 넣으면 이중 인코딩 → `30` / 403.
  - Encoding 키: 쿼리에 **그대로** 붙이기
  - Decoding 키: `--data-urlencode` / `urllib.parse.urlencode` 사용
- 이 API **활용신청** 안 된 키면 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(30).

```bash
# Decoding 키 예
curl -sS -G "${PM_API_BASE_URL:-https://apis.data.go.kr/1613000/PersonalMobilityInfo}/GetPMProvider" \
  --data-urlencode "serviceKey=${PM_API_SERVICE_KEY:-$TOUR_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=100" \
  --data-urlencode "_type=json"
```

---

## 1) GetPMProvider — 실측 전체 목록

`totalCount=2` (페이징해도 동일).

| citycode | cityname | providername |
| --- | --- | --- |
| `12` | 세종특별시 | ALPACA |
| `12` | 세종특별시 | GBIKE |

### 필터 동작

| 파라미터 | 실측 |
| --- | --- |
| `providerName=ALPACA` / `GBIKE` | 해당 1건만 |
| `providerName=SWING` | `totalCount=0` |
| `cityName=제주` 등 | **무시됨** — 어떤 값이든 위 2건이 그대로 옴 |

→ 지역 필터는 `cityName`에 의존하지 말고, **응답의 `citycode`/`cityname`을 보고 판별**.

샘플: `samples/GetPMProvider_all.json`

---

## 2) GetPMListByProvider — 실측

필수: `providerName` + `cityCode`  
응답 item은 **소문자** 키.

| provider | cityCode | totalCount | 비고 |
| --- | --- | --- | ---: |
| ALPACA | 12 | 1368 | 샘플 200건 배터리 30–100 (avg≈64) |
| GBIKE | 12 | 3092 | 샘플 200건 배터리 30–100 (avg≈55) |
| SWING | 12 | 0 | 가이드 예제는 현재 무효 |

응답 필드 (실측):

| 필드 | 예 |
| --- | --- |
| `vehicleid` | `425055` |
| `providername` | `ALPACA` |
| `citycode` / `cityname` | `12` / `세종특별시` |
| `latitude` / `longitude` | `36.32547` / `127.348305` (WGS84) |
| `battery` | `30` … `100` (문자열 숫자) |

좌표 범위 샘플 (각 200건):

- ALPACA: lat ≈ 36.325–36.354 · lon ≈ 127.324–127.400
- GBIKE: lat ≈ 36.441–36.479 · lon ≈ 127.210–127.369

샘플 파일:

- `samples/GetPMListByProvider_12_ALPACA.json`
- `samples/GetPMListByProvider_12_GBIKE.json`
- `samples/GetPMListByProvider_stats_sample.json` (ALPACA)
- `samples/GetPMListByProvider_stats_GBIKE.json`
- `samples/probe_summary.json`

---

## 재조회 방법

```bash
# 운영사·지역
curl -sS -G "https://apis.data.go.kr/1613000/PersonalMobilityInfo/GetPMProvider" \
  --data-urlencode "serviceKey=${TOUR_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=100" \
  --data-urlencode "_type=json"

# 장치 (세종 ALPACA)
curl -sS -G "https://apis.data.go.kr/1613000/PersonalMobilityInfo/GetPMListByProvider" \
  --data-urlencode "serviceKey=${TOUR_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=20" \
  --data-urlencode "_type=json" \
  --data-urlencode "providerName=ALPACA" \
  --data-urlencode "cityCode=12"
```

제주 커버리지가 생기면 `GetPMProvider`에 제주 행이 생긴다. 그때 `citycode`로 `GetPMListByProvider`를 다시 찍으면 된다.
