# KorWithService2 → CSV 재현 가이드

서비스: `KorWithService2` (무장애여행)  
매뉴얼: `문서/개방데이터_활용매뉴얼(무장애여행)/…v4.3`  
재수집: `python3 "작업/실행파일/한국관광공사_무장애여행 조회/fetch_with_tour.py"`

국문(`KorService2`)과 **동일 bbox**.  
`contentid`는 국문과 동일 → intro/info는 국문 CSV를 쓰고, 여기에는 **`with_*`만** 둔다.

## 범위

| 항목 | 값 |
| --- | --- |
| Base URL | `https://apis.data.go.kr/B551011/KorWithService2` |
| 목록 | `areaBasedList2` 제주시(`lDongRegnCd=50`, `lDongSignguCd=110`) |
| 필터 | 국문과 동일 bbox (`mapx`/`mapy`) |
| 인증 | 루트 `.env`의 `TOUR_API_SERVICE_KEY` (Decoding) |

```
mapx: 126.5135625 ~ 126.5363125
mapy: 33.5040625  ~ 33.5213125
```

## 파이프라인

```
1) areaBasedList2 제주시 전량
2) bbox 필터 + contentid 중복 제거
3) contentid마다: detailCommon2 + detailWithTour2
4) tour_content.csv 저장
```

## 출력 CSV

| 파일 | 출처 |
| --- | --- |
| `tour_content.csv` | 목록 + common + `with_*` |

**미생성:** `tour_detailIntro2_*`, `tour_detailInfo2_repeat`/`room`, 이미지 CSV  
→ 국문과 값이 동일해서 국문 폴더를 사용.

컬럼 설명: `csv_columns.md`
