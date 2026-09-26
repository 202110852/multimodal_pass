# 교통약자 이동지원 현황 실시간 정보

행정안전부·한국지역정보개발원이 전국 광역자치단체 교통약자 이동지원센터·차량 정보를 통합 개방한 OpenAPI.

| | |
| --- | --- |
| 포털 | [data.go.kr/data/15140825](https://www.data.go.kr/data/15140825/openapi.do) |
| 인증키·활용신청 현황 | [마이페이지 인증키 발급현황](https://www.data.go.kr/iim/api/selectAPIAcountView.do) |
| 제공기관 | 행정안전부 한국지역정보개발원 |
| 분류 | 사회복지 - 취약계층지원 |
| API 유형 | REST |
| 포맷 | JSON / XML (`type=json` 권장) |
| Base URL | `https://apis.data.go.kr/B551982/tsdo_v2` |
| 원천(기관) | `https://ido.sharedata.go.kr/B551982/tsdo/...` |
| 비용 | 무료 · 이용허락 제한 없음 |
| 트래픽 | 개발 5,000/일 · 운영은 활용사례 등록 시 증설 가능 |
| 심의 | 개발·운영 자동승인 |
| 프로젝트 `.env` | `TSDO_API_SERVICE_KEY`, `TSDO_API_BASE_URL` |

---

## 서비스 개요

제공 항목 4종:

1. **센터 현황** — 위치·전화·예약사이트·운영시간·요금·이용대상 등
2. **차량 기본정보** — 차종·정원·휠체어 수용·정비일 등
3. **차량 운행이력** — 기간별 운행가능 여부
4. **차량 이용가능(실시간)** — 총/운행중/가용 대수, 예약·대기 건수

키워드: 교통약자, 장애인 택시, 특장차, 이동지원, 실시간

---

## 인증 · 프로젝트 설정

공공데이터포털 **Decoding** 서비스키를 `serviceKey` 쿼리에 넣는다.  
(이미 URL-encoded 된 Encoding 키를 쓸 때는 추가 encode 하지 말 것.)

**이 API는 별도 활용신청이 필요하다.** 관광공사·기상청과 같은 계정 키라도, 해당 데이터셋에 신청·승인되지 않으면 `K30`이 난다.

신청·키 확인 경로:

1. [포털 상세](https://www.data.go.kr/data/15140825/openapi.do) → **활용신청** (자동승인)
2. [인증키 발급현황](https://www.data.go.kr/iim/api/selectAPIAcountView.do)에서 Decoding 키·신청 상태 확인

`.env`:

```bash
# 공공데이터포털 — 교통약자 이동지원 (tsdo_v2)
# https://www.data.go.kr/data/15140825/openapi.do 활용신청 후 키 사용

TSDO_API_SERVICE_KEY=${TOUR_API_SERVICE_KEY}

TSDO_API_BASE_URL=https://apis.data.go.kr/B551982/tsdo_v2
```

동일 포털 계정이면 Tour/기상청 키와 같아도 되지만, **반드시 이 OpenAPI에 활용신청**을 먼저 한다.

---

## 오퍼레이션

| # | 경로 | 요약 | 비고 |
| --- | --- | --- | --- |
| 1 | `GET /center_info_v2` | 센터 현황 | |
| 2 | `GET /info_vehicle_v2` | 차량 기본정보 | |
| 3 | `GET /info_vehicle_use_v2` | 차량 이용가능(실시간) | |
| 4 | `GET /info_vehicle_operation_v2` | 차량 운행이력 | `fromCrtrYmd`·`toCrtrYmd` 필수 |

기관 원천 URL 예: `https://ido.sharedata.go.kr/B551982/tsdo/center_info` (게이트웨이 `_v2` 경로와 대응).

### 공통 요청 파라미터

| 파라미터 | 구분 | 설명 |
| --- | --- | --- |
| `serviceKey` | 필수 | 포털 인증키 |
| `pageNo` | 옵션 | 페이지번호 (예: `1`) |
| `numOfRows` | 옵션 | 한 페이지 건수 (예: `10`) |
| `type` | 옵션 | `json` / `xml` |
| `stdgCd` | 옵션 | 지자체 법정동코드 10자리. [법정동코드](https://www.code.go.kr/stdcode/regCodeL.do) 참조 |

### `stdgCd` 참고 (지역마다 단위가 다름)

`stdgCd`는 법정동코드 10자리지만, **등록된 센터의 코드 단위가 지역마다 다르다.**  
제주만 고장이 아니라, 시군으로 쪼개진 곳 / 광역만 있는 곳이 섞여 있다.

| 구분 | 지역 | 예시 |
| --- | --- | --- |
| 시군 코드로 조회됨 | 경기, 충북, 전남, 경북, 경남, 강원, 전북 등 | 충북 청주 `4311000000` |
| 광역 코드만 있음 | 제주, 서울, 부산, 인천, 대전, 충남 | 제주 `5000000000`, 서울 `1100000000`, 부산 `2600000000` |

**제주**

| 지역 | 코드 | 비고 |
| --- | --- | --- |
| 제주특별자치도 | `5000000000` | 센터 1건 (`IJEJU1`) · 이 코드로 조회 |
| 제주시 / 서귀포시 | `5011000000` / `5013000000` | **NODATA** (미사용) |

제주·서울·부산처럼 광역만 있는 곳은 시군 코드로 조회하면 비어 있다.

### 호출 예

```bash
# Decoding 키는 --data-urlencode 로 넘길 것 (쿼리에 그대로 붙이면 K30 날 수 있음)
# Encoding 키(이미 % 인코딩)는 쿼리에 그대로 붙여도 됨

# 센터 현황 (제주)
curl -sS -G "${TSDO_API_BASE_URL}/center_info_v2" \
  --data-urlencode "serviceKey=${TSDO_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=10" \
  --data-urlencode "type=json" --data-urlencode "stdgCd=5000000000"

# 실시간 이용가능
curl -sS -G "${TSDO_API_BASE_URL}/info_vehicle_use_v2" \
  --data-urlencode "serviceKey=${TSDO_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=10" \
  --data-urlencode "type=json" --data-urlencode "stdgCd=5000000000"

# 차량 기본정보
curl -sS -G "${TSDO_API_BASE_URL}/info_vehicle_v2" \
  --data-urlencode "serviceKey=${TSDO_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=10" \
  --data-urlencode "type=json" --data-urlencode "stdgCd=5000000000"

# 운행이력 (기간 필수, YYYYMMDD)
curl -sS -G "${TSDO_API_BASE_URL}/info_vehicle_operation_v2" \
  --data-urlencode "serviceKey=${TSDO_API_SERVICE_KEY}" \
  --data-urlencode "pageNo=1" --data-urlencode "numOfRows=10" \
  --data-urlencode "type=json" --data-urlencode "stdgCd=5000000000" \
  --data-urlencode "fromCrtrYmd=20260901" --data-urlencode "toCrtrYmd=20260906"
```

성공 시 `header.resultCode` = `K0` (`NORMAL_SERVICE`).

---

## 1. center_info_v2 — 센터 현황

센터ID·주소·좌표·전화·예약 URL·앱명·운영/예약시간·이용대상·요금 안내 등.

| 필드 | 설명 |
| --- | --- |
| `totCrtrYmd` | 집계기준일자 (`YYYYMMDD`) |
| `stdgCd` | 지자체 코드 |
| `lclgvNm` | 지자체명 |
| `cntrId` | 센터ID |
| `cntrNm` | 센터명 |
| `cntrRoadNmAddr` | 도로명주소 |
| `cntrLotnoAddr` | 지번주소 |
| `lat` / `lot` | 위도 / 경도 |
| `cntrTelno` | 센터 전화 |
| `rsvtSiteUrlAddr` | 예약 웹사이트 |
| `appSrvcNm` | 앱 서비스명 |
| `mngInstNm` / `mngInstTelno` | 관리기관명 / 전화 |
| `wkdyRsvtBgngTm` / `wkdyRsvtEndTm` | 평일 예약 시작·종료 (`HHMMSS`) |
| `wkdyOprBgngTm` / `wkdyOprEndTm` | 평일 운행 시작·종료 |
| `wkndOperYn` | 주말운영 `Y/N` |
| `wkndOperHrExpln` | 주말운영시간 설명 |
| `wtjrOprRgnNm` / `btjrOprRgnNm` | 관내 / 관외 운행지역 |
| `utztnTrgtExpln` | 이용대상 설명 |
| `dayVhclUtztnNmtm` | 일일이용횟수 |
| `bfhdRsvtPrdExpln` | 사전예약기간 설명 |
| `bscCrgExpln` / `exchrgCrgExpln` | 기본요금 / 할증요금 설명 |
| `hldVhclTcntom` | 보유차량 총대수 |
| `rsvtGdMttr` | 예약안내사항 |

---

## 2. info_vehicle_v2 — 차량 기본정보

| 필드 | 설명 |
| --- | --- |
| `totCrtrYmd` | 집계기준일자 |
| `stdgCd` / `lclgvNm` | 지자체 코드 / 명 |
| `cntrId` / `cntrNm` | 센터ID / 명 |
| `vhclId` | 차량 고유 ID |
| `vhclUsgNm` | 유형 (승용/승합/특장) |
| `vhclMdlNm` | 차종 (예: 카니발) |
| `fbctnYr` | 제작연도 |
| `lastMtncYmd` | 최종 정비일자 |
| `mpsgrYn` | 다인승 가능 `Y/N` |
| `rdcpctCnt` | 탑승정원 (휠체어+일반) |
| `wchrActcCntom` | 휠체어 수용 수 |
| `gnrlBrdgPsbltyCnt` | 일반인 탑승가능 수 |
| `tdrvgDstnc` | 누적 주행거리 |
| `tdyOprNmtm` | 금일 운행 횟수 |
| `tdyTdrvgDstnc` | 금일 주행거리 |

---

## 3. info_vehicle_use_v2 — 이용가능(실시간)

| 필드 | 설명 |
| --- | --- |
| `totDt` | 집계기준일시 (`YYYYMMDDHHMMSS`) |
| `stdgCd` / `lclgvNm` | 지자체 코드 / 명 |
| `cntrId` / `cntrNm` | 센터ID / 명 |
| `tvhclCntom` | 센터 총 차량 대수 |
| `oprVhclCntom` | 운행 중 대수 |
| `avlVhclCntom` | 현재 가용 대수 |
| `rsvtNocs` | 예약 건수 |
| `wtngNocs` | 대기 건수 |

챗봇·무장애 안내용으로 **가장 유용한 실시간 엔드포인트**.

---

## 4. info_vehicle_operation_v2 — 운행이력

추가 필수: `fromCrtrYmd`, `toCrtrYmd` (`YYYYMMDD`).

| 필드 | 설명 |
| --- | --- |
| `operSttsYn` | 집계 기준 운행가능 `Y/N` |
| `totDt` | 집계기준일자 |
| `stdgCd` / `lclgvNm` | 지자체 코드 / 명 |
| `cntrId` / `cntrNm` | 센터ID / 명 |
| `vhclId` | 차량 ID |
| `vhclUsgNm` / `vhclMdlNm` | 유형 / 차종 |

---

## 에러 코드 (게이트웨이)

| resultCode | 메시지 | 의미 |
| --- | --- | --- |
| `K0` | NORMAL_SERVICE | 정상 |
| `K01` | APPLICATION_ERROR | GW/앱 내부 오류 |
| `K02` | DB_ERROR | DB 오류 |
| `K03` | NODATA_ERROR | 데이터 없음 |
| `K04` | HTTP_ERROR | HTTP/기관 응답 처리 실패 |
| `K05` | SERVICETIMEOUT_ERROR | 연결·대기 초과 |
| `K10` | INVALID_REQUEST_PARAMETER_ERROR | 파라미터 오류 |
| `K11` | NO_MANDATORY_REQUEST_PARAMETERS_ERROR | 필수 파라미터 누락 |
| `K12` | NO_OPENAPI_SERVICE_ERROR | 서비스 없음/폐기 |
| `K20` | SERVICE_ACCESS_DENIED_ERROR | 접근 거부 (활용신청·권한) |
| `K22` | LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR | 일일 호출 초과 |
| `K30` | SERVICE_KEY_IS_NOT_REGISTERED_ERROR | **미등록 키 / 해당 API 미신청** |
| `K31` | DEADLINE_HAS_EXPIRED_ERROR | 키 기한 만료 |
| `K32` | UNREGISTERED_IP_ERROR | 미등록 IP |

포털 공통 안내: [오픈API 에러코드](https://www.data.go.kr/data/15140825/openapi.do) 참고.

---

## 조회 테스트 기록

### 2026-09-06 (실패)

| 호출 | 결과 |
| --- | --- |
| `apis.data.go.kr/.../tsdo_v2/...` | TLS connect timeout |
| `ido.sharedata.go.kr/.../tsdo/...` | `K30` (키 미등록/인코딩) |
| `ido.../tsdo_v2/*_v2` | `K12` (기관 호스트에는 `_v2` 없음) |

### 2026-09-10 (정상)

포털 GW TLS 복구. Encoding 키 또는 Decoding 키+URL encode 시 `K0`.

| 호출 | 결과 |
| --- | --- |
| `center_info_v2` (전국) | `K0` · totalCount **161** |
| `info_vehicle_use_v2` (전국) | `K0` · totalCount **159** |
| `center_info_v2` · `stdgCd=5000000000` | `K0` · 제주특별자치도 교통약자이동지원센터 |
| `info_vehicle_use_v2` · `stdgCd=5000000000` | `K0` · 총 647 / 운행 79 / 가용 80 / 대기 6 |
| `stdgCd=5011000000` · `5013000000` | `K3` NODATA |
| Decoding 키를 쿼리에 raw 삽입 | `K30` (인코딩 필요) |
| `ido.sharedata.go.kr` 직접 | 계속 `K30` → **포털 GW `tsdo_v2` 사용** |
