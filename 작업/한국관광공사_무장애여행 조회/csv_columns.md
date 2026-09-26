# 무장애여행 Tour CSV 컬럼

국문 intro/info와 중복이므로 **이 폴더는 `tour_content.csv`만** 둔다.  
`contentid`로 국문 `tour_content` / intro / info에 조인.

```
tour_content  ← 목록 + common + with_*   PK=contentid
              (intro/info → 국문 폴더)
```

## `tour_content.csv`

공통 식별·주소·좌표·`lDong*`·`lclsSystm*`·`homepage`/`telname`/`overview`는 국문과 같은 계열.

**없음:** `pet_*`, `detailinfo_num`, intro/info 자식 CSV  
**있음:** `detailWithTour2` → `with_*` (매뉴얼 고정, empty여도 컬럼 유지)

| 컬럼 | 구분 | 설명 |
|------|------|------|
| `with_parking` | 지체 | 주차 |
| `with_publictransport` | 지체 | 대중교통 |
| `with_route` | 지체 | 접근로 |
| `with_ticketoffice` | 지체 | 매표소 |
| `with_promotion` | 지체 | 홍보물 |
| `with_wheelchair` | 지체 | 휠체어 |
| `with_exit` | 지체 | 출입통로 |
| `with_elevator` | 지체 | 엘리베이터 |
| `with_restroom` | 지체 | 화장실 |
| `with_auditorium` | 지체 | 관람석 |
| `with_room` | 지체 | 객실(무장애) |
| `with_handicapetc` | 지체 | 기타 |
| `with_braileblock` | 시각 | 점자블록 |
| `with_helpdog` | 시각 | 보조견 |
| `with_guidehuman` | 시각 | 안내요원 |
| `with_audioguide` | 시각 | 오디오가이드 |
| `with_bigprint` | 시각 | 큰활자 홍보물 |
| `with_brailepromotion` | 시각 | 점자 홍보물 |
| `with_guidesystem` | 시각 | 유도안내설비 |
| `with_blindhandicapetc` | 시각 | 기타 |
| `with_signguide` | 청각 | 수화안내 |
| `with_videoguide` | 청각 | 자막 비디오 |
| `with_hearingroom` | 청각 | 객실 |
| `with_hearinghandicapetc` | 청각 | 기타 |
| `with_stroller` | 영유아 | 유모차 |
| `with_lactationroom` | 영유아 | 수유실 |
| `with_babysparechair` | 영유아 | 유아용 보조의자 |
| `with_infantsfamilyetc` | 영유아 | 기타 |
