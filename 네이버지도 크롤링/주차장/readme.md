# 주차장 정보 보강 (모두의주차장 → 네이버)

원본 CSV(`작업/주차장_csv_다운로드/`)의 요금·유료시간 등이 비어 있거나 부정확해서  
**모두의주차장**을 우선 쓰고, 실패 시 **네이버 플레이스**로 보강한다.

| 문서 | 내용 |
| --- | --- |
| **이 파일** | API·매칭·파싱·스크립트 — 처음부터 재구현용 |
| [`작업/주차장_csv_다운로드/readme.md`](../../작업/주차장_csv_다운로드/readme.md) | 원본/결과 CSV 위치·실행 명령·컬럼·110건 요약 |

---

## 재구현 스펙 (제주시 유료 — 정식 경로)

### 0. 한 줄 흐름

```text
원본 CSV(유료+좌표)
  → 모두의주차장 검색/핀 매칭
  → type=P&id={seq} 상세(SSR)에서 정보 탭 필드 파싱
  → 실패 시 네이버 플레이스 매칭·수집 → 같은 양식 컬럼으로 매핑
  → 작업/주차장_csv_다운로드/제주특별자치도_제주시_주차장정보_모두의주차장보강.csv 저장
```

### 1. 환경

```bash
pip3 install playwright pygeohash
python3 -m playwright install chromium
```

- Python 3.9+
- 요청 시 `User-Agent`, `Origin: https://app.modu.kr`, `Referer: https://app.modu.kr/` 권장
- 건당 `sleep` ~0.3~0.4초 (과도한 연타 금지)

### 2. 입력 필터

- 원본: `작업/주차장_csv_다운로드/제주특별자치도_제주시_주차장정보.csv` (utf-8-sig)
- 조건: `요금정보 == "유료"` **그리고** `주차장명`·`위도`·`경도` 모두 있음  
  → 약 **110건** (무료·무좌표 제외)

### 3. 모두의주차장 API

베이스: `https://api.modu.cloud`  
지도 UI: `https://app.modu.kr/map`

| 용도 | Method / URL | 파라미터·비고 |
| --- | --- | --- |
| 시간 기본값 | `GET /ticket/time-filter-options` | `defaults.date`, `defaults.durationId` (예: `PT1H`) |
| 장소 검색 | `GET /poi/search/place` | `q={검색어}`, `type=naver` → `places[]` name/address/lat/lng |
| 주변 핀·요금표 | `GET /poi/pins` | `geohash` (precision **6**, 쉼표 join), `durationId`, `parkingDate` |
| 상세(정보 탭) | `GET https://app.modu.kr/map?type=P&id={seq}&parkingDate=…&durationId=…` | **별도 REST 없음**. HTML SSR의 JSON 파싱 |

#### 3.1 geohash

- 라이브러리: `pygeohash`
- 좌표 주변 Δ≈0.003 격자를 샘플링해 precision 6 해시 집합 생성 후 `join(",")`
- 앱도 `bboxes(swLat,swLng,neLat,neLng,6)` 방식 (한국 영역 대략 lat 33–39, lng 124–132)

#### 3.2 `/poi/pins` 응답에서 쓰는 필드

각 `data[].parkinglots[]`:

- `parkinglotSeq`, `name`, `latitude`, `longitude`
- `calcPrice`: `{"30":0,"60":2000,…}` (분→원) → 현장 요금 보강용
- `options`: 예 `["장애인"]`, `["기계식"]`
- `isFree`, `isClosed`, `qty`

딥링크 타입은 **`type=P`** (`PUBLIC` 문자열 URL은 404 나는 경우 있음).

#### 3.3 상세 SSR 파싱 (`type=P&id=`)

1. HTML을 받은 뒤 `\"` → `"` 등으로 unescape  
2. 정규식으로 추출:

```text
"times":[...],"prices":[...],"openFree":{...},"modifyDate":"..."
```

3. 매핑

| 양식 컬럼 | JSON |
| --- | --- |
| `운영 시간` | `openFree.operationTime` |
| `운영시간_평일` 등 | `times` 중 title=`유료 운영시간` → contents key=평일/토요일/일요일/공휴일 |
| `초기무료`/`기본요금`/`추가 요금`/`할증 기준시간` | `prices` 중 title=`시간요금` (키 `추가요금` → 컬럼 `추가 요금`) |
| `주소` | `newAddress` (없으면 `address` 지번) |
| `추가정보` | `options` join |
| `현장 요금` | HTML의 `1시간 기준 N원` 또는 `calcPrice["60"]` → `1시간 기준 {N}원` |

검증 예: seq `157572` 신제주 공영  
→ `운영 시간=12:00 ~ 22:00`, `현장 요금=1시간 기준 2,000원`, `초기무료=30분`, `추가 요금=15분당 500원`, `추가정보=장애인`

### 4. 매칭 알고리즘 (Modu)

검색 쿼리 변형 (순서대로, 중복 제거):

1. `{주차장명}`
2. `{주차장명} 주차장` (이름에 주차장 없을 때)
3. `제주시 {주차장명}` / `제주시 {주차장명} 주차장`
4. `주차빌딩` → `주차장` 치환
5. 지번에서 `동/리 + 번지` 추출 → `제주시 {…} 주차장`

후보에서 **출구·입구·관리실·전기차·충전소** 이름 제외.

판정:

| 조건 | status |
| --- | --- |
| 주소 exact/contains 또는 동+번지 공유 + 거리 ≤80m (또는 exact) | `success` |
| 거리 ≤250m | `needs_confirm` 가능 |
| 검색 실패 시 CSV 좌표 주변 pins → 이름유사+거리 | 동일 임계 |
| 그래도 없음 | `fail` → 네이버 폴백 |

거리: 하버사인. 임계 **80m / 250m**.

매칭 성공 시 `parkinglotSeq`로 **상세 SSR**까지 호출해 양식 컬럼을 채운다.  
핀만 있고 SSR 파싱 실패하면 `calcPrice`·`options`만이라도 채움.

### 5. 네이버 폴백 (Modu fail 시)

스크립트: `crawl_parking_pilot.py` (`REGION=제주시`)

1. 네이버 통합검색 HTML / 지도 검색에서 `place/{id}` 추출  
2. 주소·좌표 매칭 (동일 80/250m 철학)  
3. `https://pcmap.place.naver.com/place/{id}/home` Playwright 로드  
4. 영업시간 **펼쳐보기** 후 DOM 파싱, `ParkingmoduPrice` 요금  
5. `form_from_naver()` 로 모두의 양식 컬럼에 매핑  
   - `naver_hours` → `운영 시간`  
   - `naver_road_address` / jibun → `주소`  
   - `naver_fees_modu` → `현장 요금`  
   - 요일 paid JSON → `운영시간_평일` 등  
   - conveniences → `추가정보`

네이버 쪽 시행착오·URL은 아래 「네이버 파일럿 기록」 참고.

### 6. 출력 (반드시 이 경로)

디렉터리: **`작업/주차장_csv_다운로드/`** (원본과 동일)

| 파일 | 역할 |
| --- | --- |
| `제주특별자치도_제주시_주차장정보_모두의주차장보강.csv` | 본결과 |
| `제주특별자치도_제주시_주차장정보_모두의주차장보강.json` | JSON |
| `제주시_모두의주차장_매칭로그.jsonl` | 로그 |
| `제주시_모두의주차장_done_ids.txt` | resume |

크롤 스크립트 기본 `OUT_DIR` 이 위 폴더다.  
(`네이버지도 크롤링/주차장/jejusi_paid/` 는 구버전/임시 — 정식 결과 아님)

### 7. 실행 명령

```bash
# 전체 처음부터
python3 "네이버지도 크롤링/주차장/crawl_jeju_paid.py" --no-resume

# 10건 시험
python3 "네이버지도 크롤링/주차장/crawl_jeju_paid.py" --limit 10 --no-resume

# 이어서 (done_ids)
python3 "네이버지도 크롤링/주차장/crawl_jeju_paid.py"

# 네이버 폴백 끄기
python3 "네이버지도 크롤링/주차장/crawl_jeju_paid.py" --no-naver-fallback
```

### 8. 코드 모듈

| 파일 | 역할 |
| --- | --- |
| [`modu_client.py`](modu_client.py) | 검색/핀/상세 SSR, `MODU_FORM_FIELDS`, geohash, 거리 |
| [`crawl_modu_first.py`](crawl_modu_first.py) | `match_modu`, `flatten_row`, `form_from_naver` |
| [`crawl_jeju_paid.py`](crawl_jeju_paid.py) | 유료 필터·배치·저장·네이버 폴백 호출 |
| [`crawl_parking_pilot.py`](crawl_parking_pilot.py) | 네이버 매칭/상세 (폴백 + 서귀포 파일럿) |

### 9. 수동 API 스모크 (재현용)

```bash
# 검색
curl -sS -A 'Mozilla/5.0' -H 'Origin: https://app.modu.kr' \
  'https://api.modu.cloud/poi/search/place?q=%EC%A0%9C%EC%A3%BC%EC%8B%9C%20%EB%8F%99%EB%AC%B8&type=naver' | head

# 시간 옵션
curl -sS -A 'Mozilla/5.0' -H 'Origin: https://app.modu.kr' \
  'https://api.modu.cloud/ticket/time-filter-options'

# 상세 HTML에 초기무료 포함 여부
curl -sS -A 'Mozilla/5.0' \
  'https://app.modu.kr/map?type=P&id=157572&parkingDate=2026-09-10&durationId=PT1H' \
  | rg -o '초기무료|operationTime|1시간 기준' | head
```

### 10. 실제 실행 결과 (2026-09-10)

대상 110건: modu success 104 / needs_confirm 5 / naver success 1.

---

## 네이버 파일럿 기록 (서귀포·폴백용)

초기에는 네이버만으로 서귀포 1곳·10곳을 시험했다.  
**제주시 유료 정식 경로는 위 재구현 스펙(Modu 우선)** 이다.

대상(파일럿): **매일올레시장 공영주차빌딩**  
(= 네이버 `서귀포매일올레시장공영주차장`, place id `17043242`)

샘플:

- [`naver_enrich_sample_매일올레시장.json`](naver_enrich_sample_매일올레시장.json)
- [`naver_enrich_sample_매일올레시장.csv`](naver_enrich_sample_매일올레시장.csv)

### 목표 필드 (당시)

| 필드 | 원본 CSV | 네이버에서 기대 |
| --- | --- | --- |
| 요금 | 일부만 있음 / 형식 제각각 | 시간대별 요금표 |
| 유료 운영시간(요금 받는 시간) | 특기사항 문장에만 가끔 | 구조화된 시간대 |
| 장애인 주차 구역 | 대부분 공란 | 유무 |
| 화장실 | 없음 | 유무 |
| 운영시간 | 거의 전부 `00:00~23:59` | 실제 영업/개방 정보 |

### 시행착오 타임라인

#### 1) 검색어를 CSV 주차장명 그대로 넣으면 실패

- 검색: `매일올레시장 공영주차빌딩` → 업체 없음  
- POI명: `서귀포매일올레시장공영주차장`  
→ 지역명+완화 검색 필요

#### 2) 입·출구 POI 혼재

같은 이름에 입구/출구가 따로 있음 → 카테고리·좌표로 본체만

#### 3) `map.naver.com` iframe cross-origin

자동화는 `pcmap.place.naver.com/place/{id}/home` 직접 오픈

#### 4) 옛 API curl

`v5/api` 302/404, place 페이지 429.  
`/p/api/place/summary/{id}` 는 200이지만 요금/편의 없음

#### 5) place id

`search.naver.com` HTML의 `place/{숫자}` 또는  
`https://map.naver.com/p/entry/place/17043242`

#### 6) 홈 탭 요금·시간

- `ParkingmoduPrice` / UI 가격표  
- 영업시간 **펼쳐보기** 후 요일별 유료/무료 파싱  
- Apollo `openingHours` 비는 경우 많음  
- 화장실·장애인 공식 필드 약함

#### 7) `__APOLLO_STATE__`

- `PlaceDetailBase:{id}` → name, phone, address, conveniences  
- `ParkingmoduPrice:{id}` → 요금 구간

### 네이버 URL 요약

```text
https://map.naver.com/p/search/{query}
https://pcmap.place.naver.com/place/{placeId}/home
https://map.naver.com/p/entry/place/{placeId}
https://map.naver.com/p/api/place/summary/{placeId}
https://search.naver.com/search.naver?query={query}
```

### 서귀포 네이버 파일럿 10곳

```bash
python3 "네이버지도 크롤링/주차장/crawl_parking_pilot.py" --limit 10
```

출력: `pilot_10/` — **제주시 정식 결과 경로 아님** (success 10/10).

---

## 원본·결과 위치

- 원본 제주: `작업/주차장_csv_다운로드/제주특별자치도_제주시_주차장정보.csv`
- 원본 서귀포: `작업/주차장_csv_다운로드/제주특별자치도_서귀포시_주차장정보.csv`
- **제주시 보강 결과:** `작업/주차장_csv_다운로드/제주특별자치도_제주시_주차장정보_모두의주차장보강.csv`
- 서귀포 포털 보강: `작업/주차장_csv_다운로드/제주특별자치도_서귀포시_주차장정보_서귀포주차포털보강.csv`

---

## 체크리스트

- [x] 매칭 단계 설계 + Playwright 네이버 파일럿
- [x] 서귀포 10곳 네이버 파일럿 (`pilot_10/`)
- [x] Modu API(검색/핀) + SSR 상세 파싱
- [x] 제주시 유료 전체(110) Modu→Naver → **작업/주차장_csv_다운로드** 저장
- [ ] needs_confirm·공란 건 수동 검수
- [ ] 장애인·화장실 공공데이터 교차 검토

---

## 한 줄 결론

제주시 유료는 **모두의주차장(`api.modu.cloud` + `type=P` SSR) 우선**, 실패 시 네이버,  
결과는 **모두의 정보 탭 양식**으로 `작업/주차장_csv_다운로드/`에 둔다.
