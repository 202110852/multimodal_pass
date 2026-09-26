# 네이버지도 범용 장소 매칭 · 크롤링 · 키워드

주차장 전용 작업(`네이버지도 크롤링/주차장/`)과는 **별도**.  
CSV 한 행(음식점·쇼핑·관광지·숙박 등)을 네이버 플레이스와 매칭해 URL을 확보하고, **그 가게 페이지의 공개 정보만** 모아 원문 저장한 뒤 키워드를 뽑는다.

구현 스크립트: [`crawl_place_pilot.py`](crawl_place_pilot.py)

```bash
python3 "네이버지도 크롤링/범용/crawl_place_pilot.py"
python3 "네이버지도 크롤링/범용/crawl_place_pilot.py" --title "도두해녀의집" --out-dir pilot_dodu
python3 "네이버지도 크롤링/범용/crawl_place_pilot.py" --csv downtown_stores.csv --out-dir downtown
```

`downtown_stores.csv` 는 `naver_link`가 있으면 **링크를 우선**해 place id를 쓰고, 없거나 `nmap://`(좌표만)이면 이전처럼 매장명 검색한다. 중단 후 다시 돌리면 `done_ids.txt`로 이어서 한다.

---

## 0. 구현 전제 (이것부터)

1. **API를 치지 않는다.** GraphQL·map summary curl은 실패하거나 부족하다. Chromium(Playwright)으로 페이지를 연 뒤 DOM / `window.__APOLLO_STATE__` 를 읽는다.
2. 자동화 URL은 `map.naver.com` iframe이 아니라 **`pcmap.place.naver.com`** 이다.
3. 클래스명(`IY7ZX`, `dtDQt`, `oPmH_`, `agO5z`, `place_apply_pui` …)은 빌드마다 바뀐다. **하드코딩 금지.** 실측 클래스는 힌트만.
4. 매장마다 탭·섹션이 없다. **없으면 시도하지 않거나, 열었는데 이 가게가 아니면 저장하지 않는다.** 에러로 중단하지 않음.
5. **다른 가게는 절대 수집하지 않는다.** `주변`, `함께 가볼만한 *`, `이 장소와 비슷한 *` 및 같은 카드 UI.
6. **홈은 한 번만 연다.** 매칭 때 연 홈을 확정 뒤 재오픈하지 않는다. 다른 후보로 떠난 뒤에만 다시 연다.
7. **`출처 N건 전체보기`는 클릭하지 않는다.** 이미 펼쳐져 있어도 그 이후(개별 리뷰)는 저장에서 자른다.
8. **리뷰 키워드 `더보기`는 한 번만.** 최대 6번 반복하지 않는다.

원본 CSV는 덮어쓰지 않는다. 네이버 값은 `naver_*` / `keywords` 로 병기.

---

## 1. 입력

필수에 가깝게: **이름** + (도로명 또는 지번) + 가능하면 **위도·경도**.  
`downtown_stores.csv` 는 `naver_link`가 있으면 검색보다 링크가 우선.

| 소스 | 경로 | 이름 | 주소 | 좌표 | 링크 |
| --- | --- | --- | --- | --- | --- |
| 비짓제주 | `작업/비짓제주_OPEN_API/contents_kr.csv` | `title` | `roadaddress` / `address` | `latitude` / `longitude` | 없음 → 매장명 검색 |
| 원도심 매장 | `downtown_stores.csv` | `name` | `address` | `latitude` / `longitude` | `naver_link` (`naver.me` 우선, `nmap://`는 검색 폴백) |

---

## 2. 산출물

`--out-dir` 없으면 `pilot_1/`.

| 파일 | 내용 |
| --- | --- |
| `crawled.txt` | 검수. `항목: 내용`. **빈 항목은 넣지 않음** |
| `enriched_*.json` | 매칭 + 상세 전체 |
| `enriched_*.csv` | 평탄 1행 |
| `match_log.jsonl` | 시도 쿼리·place id |

### 저장 필드 (구현 시 이 이름 유지)

| 필드 | 출처 | 비고 |
| --- | --- | --- |
| `naver_place_id` | 매칭 | |
| `naver_map_url` | `https://map.naver.com/p/entry/place/{id}` | |
| `naver_place_home_url` | `https://pcmap.place.naver.com/place/{id}/home` | |
| `naver_name` / `naver_category` | 홈 Apollo `PlaceDetailBase` | |
| `naver_place_plus` | 홈 헤더 `플레이스 플러스` | 있으면 `Y`. 인기메뉴 카드 필수 검수 |
| `naver_micro_reviews` | 홈 헤더 `span.oPmH_` 또는 `microReviews` | 슬로건. 예: `제주 바다를 품은 전복죽의 진수` |
| `naver_road_address` / `naver_jibun_address` | Apollo | |
| `naver_directions` | 홈 주소 블록 **내용 더보기** 후 | |
| `naver_phone` / `naver_homepage` | Apollo 또는 홈 `전화번호`/`홈페이지` 행 | 안내/복사 버튼 텍스트 제외 |
| `naver_lat` / `naver_lng` | Apollo `coordinate` x=lng, y=lat | |
| `naver_wait_status` | 홈 상단 현장대기/테이블링 | 없으면 공란 |
| `naver_hours*` | 홈 영업시간 펼침 | status / summary / note / days json / raw |
| `naver_conveniences` | Apollo `conveniences` | |
| `naver_description` | 홈 또는 정보 탭 `소개` | |
| `naver_ai_briefing` | 홈 섹션 헤더 `AI 브리핑` | |
| `naver_popular_menus` / `naver_peak_hours` / `naver_visitor_hours` / `naver_avg_pay` / `naver_insights_raw` | 홈 인사이트 카드 | 없으면 공란 |
| `naver_menus` | Apollo `Menu:` 노드 이름 | 가격은 정보/메뉴 영역에 있을 수 있음 |
| `naver_news` | **`/feed`만** 최근 3 | 이 가게 작성 글만 |
| `naver_booking` | 예약 탭 | 없으면 공란 |
| `naver_visitor_keywords` | 리뷰 `이런 점이 좋았어요` `{keyword, count}` | |
| `info_sections` / `information_raw` | 정보 탭 | 이 매장만. 추천 섹션 절단 |
| `keywords` / `keywords_source` | 위 필드에서 후추출 | 원문을 버린 채 키워드만 남기지 않음 |

---

## 3. 전체 실행 순서

```text
A. 검색어 만들기
B. `naver_link`가 있으면 단축링크를 따라 place id (검색 생략)
   링크가 없거나 nmap:// 이면 네이버 통합검색 HTML에서 place/{숫자} 후보
   없으면 map.naver.com/p/search
C. 후보마다 pcmap .../place/{id}/home 로드
   → 주소·좌표만으로 매칭 판정 (이 단계에서 홈 상세도 같이 파싱)
D. success / needs_confirm 이면 보강:
   1) 매칭 때 연 홈에서 대기·휠·인기메뉴·AI 브리핑 (이미 홈이면 재오픈하지 않음)
   2) 탭바에 `소식`이 있을 때만 /restaurant/{id}/feed 열고 소식 3 (이 가게일 때만)
   3) 탭바에 `예약`이 있을 때만 예약 탭
   4) 리뷰 탭 방문자 키워드
   5) /place/{id}/information
E. 원문 저장 후 키워드 추출
F. crawled.txt / csv / json
```

임계값: 주소 일치 → success. 좌표 ≤ **80m** → success. ≤ **250m** → needs_confirm. 그 외 fail.

---

## 4. 매칭 구현

### 4.1 검색어

순서대로 중복 없이:

1. `이름`
2. `{지역} {이름}` (제주시/서귀포시 등)
3. `{이름} {유형}`, `{지역} {이름} {유형}`
4. 이름에서 `본점|지점|1호점|2호점` 제거한 base
5. 지번/도로명에서 `동|리 + 번지` 추출 후 `{지역} {동번지} {이름}`

`N층` 같은 잡음은 검색어에서 뺀다.

### 4.2 place id

```text
https://search.naver.com/search.naver?query={quote}
```

HTML에서 `place/` 또는 `entry/place/` 뒤 **6자리 이상 숫자**. 앞에서부터 고유 15개.

없으면:

```text
https://map.naver.com/p/search/{quote}?c=15.00,0,0,0,dh
```

페이지·iframe URL/HTML에서 같은 정규식. 최대 20개.

### 4.3 주소 유사

정규화: 공백 제거, `제주특별자치도`→`제주`, 괄호 제거.  
한쪽이 다른 쪽을 포함하면 일치.  
아니면 토큰(동/읍/면/리/로/길, 숫자)으로 동·번지 동시 히트.

### 4.4 후보 홈 로드

```text
https://pcmap.place.naver.com/place/{id}/home
```

locale `ko-KR`. `window.__APOLLO_STATE__` 에서 `PlaceDetailBase:` 키:

- `name`, `category`, `roadAddress`, `address`, `phone`, `conveniences`
- `coordinate.x` = 경도, `coordinate.y` = 위도
- `Menu:` / `MenuItem` / `PlaceMenu` 의 `name`

이 홈 로드에서 영업시간·소개·찾아가는길까지 같이 읽고, 확정되면 **같은 홈에서** 휠로 인기메뉴·AI 브리핑을 이어서 읽는다. 주소가 맞아 바로 확정되면 홈을 다시 열지 않는다. 다른 후보를 보다가 확정된 가게 홈을 떠난 뒤에만 한 번 다시 연다.

---

## 5. 홈 탭 수집

### 5.1 펼치기 규칙 (중요)

클릭 **하는 것** (exact 텍스트):

- `펼쳐보기` — 영업시간
- `내용 더보기` — 주소/찾아가는길

클릭 **하지 않는 것**:

- 사진·메뉴의 그냥 `더보기` (정보 블록이 밀림)
- `수정 제안하기`
- **`출처 N건 전체보기`** (AI 브리핑 개별 리뷰가 펼쳐짐)

동작: Playwright `get_by_text(..., exact=True)` 로 보이는 것만 여러 라운드 클릭. `evaluate` click만으로는 영업 상태칩이 안 열리는 경우가 있음.

영업시간: 먼저 `영업 전` / `영업 중` / `오늘 휴무` 칩을 클릭해 블록을 연 다음 `펼쳐보기`.

찾아가는길: `찾아가는길` 또는 `주소` 헤더를 `scroll_into_view` 한 뒤 `내용 더보기`.

### 5.2 헤더

| 항목 | 찾는 법 |
| --- | --- |
| 상호·카테고리 | Apollo. 실측 힌트 `span.IY7ZX`, `span.dtDQt` |
| 슬로건 | 헤더 근처 `div.wt9L1 > span.oPmH_` 전부 (2~80자). Apollo `microReviews` 보강. `AI 요약` 칩과 구분 |

### 5.3 대기

홈 상단 `현장대기` / `테이블링` 블록. 실측 힌트 `div.zgXvm`.  
`안내`, `새로고침` 만 있으면 빈값.

### 5.4 영업시간 파싱

본문에서 `영업시간` ~ (`전화번호`|`편의`|`소개`|`주소`|…) 블록.

- 요일 키: 월~일, 매일, 평일, 주말, 공휴일
- `11:00 - 다음 날 02:00` 형태 → `days[요일].open`
- 브레이크타임, 라스트오더, 유료/무료(주차장 겸용) → note 또는 day.break
- `naver_hours` = 대표 구간 (매일 open 우선)
- `naver_hours_status` = `영업 전` / `영업 중` / `휴무` (페이지에 있는 그대로 저장)

### 5.5 소개·전화·홈페이지

본문 섹션 제목 `소개` / `찾아가는길`.  
전화: Apollo `phone` 없으면 `0xx-xxxx-xxxx`.  
홈페이지: `홈페이지` 다음 `https://…`.

### 5.6 지연 로드: 인사이트 카드 · AI 브리핑 · Place+

주소/영업시간 **아래**에 있다. `window.scrollBy` 만으로는 IntersectionObserver가 안 돈다. **한 번에 너무 많이 내리면** 카드를 건너뛴다.

**휠 (1차)**

1. `#app-root` hover
2. `page.mouse.wheel(0, 1200)` 최대 4번
3. **인기메뉴가 보이면** 즉시 중단
4. `AI 브리핑`만으로는 멈추지 않음 (상단에 먼저 나와 인기메뉴를 건너뜀)

**플레이스 플러스 검수 (2차)**

홈 헤더에 `플레이스 플러스`(`span.uMM13`)가 있으면 인기메뉴 카드가 **있어야** 한다.

- 1차 휠로 못 찾으면 맨 위로 돌아가 `wheel(0, 700)` 최대 6번 재시도
- 그래도 없으면 `인기메뉴(플레이스 플러스인데 스크롤 검수 실패)` 로 기록
- 플러스가 아닌 가게는 카드 없어도 정상 공란

본문에 `인기 많은 메뉴` 또는 `1회 결제 시 평균` 또는 `매장에서 결제된` 이 있으면 인사이트.  
섹션 헤더 첫 줄이 정확히 `AI 브리핑` 이면 그 **부모 `place_section` 토큰**의 `place_section_content`.

`closest('[class*="place_section"]')` 금지. `place_section_header_title` 자신도 그 문자열을 포함해서 **제목만** 읽게 된다. 클래스 토큰이 정확히 `place_section` 인 조상만 쓴다.

인사이트 카드는 헤더가 없을 수 있다. 본문 문구로 `div.place_section` 을 찾는다. 실측 힌트 `agO5z`.

파싱 예 (공백 정규화 후):

- `(\d) 순위 (상승|하락)? (메뉴명)` → `popular_menus`
- `(요일) … 가장 인기` → `peak_hours`
- `(\d{1,2})시 방문자(\d+)%` → `visitor_hours`
- `1회 결제 … 만원대` → `avg_pay`
- 원문 전체 → `insights_raw`

없으면 **더 스크롤해서 비슷한 맛집을 긁지 말고** 공란.

**AI 브리핑 저장 규칙**

- 섹션 안 요약 `더보기`만 클릭한다.
- **`출처 N건 전체보기`는 클릭하지 않는다.**
- 이미 펼쳐져 있어도 `출처 N건 전체보기` **이후(개별 리뷰)는 잘라서 저장하지 않는다.**

### 5.7 메뉴

Apollo 메뉴 이름. 홈/정보 미리보기에 가격이 있으면 정보 섹션으로 남을 수 있음. 파일럿은 이름 위주.

---

## 6. 소식 — 잘못된 경로를 열지 말 것

홈의 `li.place_apply_pui` 는 **이 가게 소식이 아니다.** 비슷한 맛집·추천 카드와 클래스가 같다. 길이로 걸러도 다른 가게(도도름, 제주따이)가 들어온다.

### 하지 말 것

- 홈에서 `소식` 글자 클릭 후 같은 `li` 전부 querySelector
- `/ugc` 로 이동해 같은 클래스 긁기
- 상호 필터로 비운 뒤 “소식 없음”으로 끝내기만 하고, 그전에 타매장 글을 저장하기

### 할 것

1. 상호가 비어 있으면 소식 수집 **시작하지 않음**
2. 직접 이동만:

```text
https://pcmap.place.naver.com/restaurant/{placeId}/feed
https://pcmap.place.naver.com/place/{placeId}/feed   # 위가 실패할 때
```

3. 현재 URL에 `{placeId}` 와 `/feed` 가 둘 다 있을 때만 읽기
4. `div.place_section_content ul > li.place_apply_pui` (힌트). 섹션 제목이 `주변`/`비슷한 맛집` 등이면 그 `li` 스킵
5. 카드 **첫 줄(작성 상호)** 이 이 가게 이름과 같거나, 정규화 후 이름이 첫 줄에 포함될 때만 채택
6. 최근 **3개**. 타매장이면 **저장하지 않음** (빈 목록)

파일럿: 돌담 `/feed` → 알림테이블링 / 설 연휴 / 항정살 재입고. 도두 → 본인 피드 없음 (제주따이 저장 안 함).

---

## 7. 예약 · 리뷰 키워드 · 정보 탭

탭이 있을 때만. `get_by_role("tab")` 또는 `a._tab-menu`. 실패 시 URL 직접.

| 탭 | URL | 저장 |
| --- | --- | --- |
| 예약 | `/restaurant/{id}/ticket` 또는 `/place/{id}/booking` | `방문예약` 또는 `N예약혜택` 블록. 없으면 공란 |
| 리뷰 | `/restaurant/{id}/review/visitor` | `이런 점이 좋았어요` 의 `"키워드"` + 인원. 키워드 `더보기`는 **한 번만** (최대 6번 금지) |
| 정보 | `/place/{id}/information` | 헤더별 `{title, body}` + raw |

정보 탭: `펼쳐보기`/`내용 더보기` 후 헤더(`h2.place_section_header` / `.place_section_header_title`)로 자른다.  
알려진 헤더 예: 소개, 위생 정보, 편의시설 및 서비스, 반려동물 동반, 주차, 좌석·공간, 결제수단, SNS.

**제외 헤더:** `주변`, `함께 가볼만한…`, `이 장소와 비슷한…`, `홈/소식/메뉴/예약/리뷰/사진/정보` 탭 이름.

리뷰 키워드 `더보기`: 블록을 찾은 뒤 **1회만** 클릭하고 멈춘다. 펼쳐진 목록을 더 늘리려고 반복하지 않는다.

정보 탭이 사실상 홈 미리보기만 나오는 가게(도두 `[메뉴11]`)는 빈 정보로 두거나 메뉴 가격만 보강. **소개 대용으로 AI 브리핑을 넣지 않음.**

---

## 8. 수집하지 않는 것

- 다른 가게 추천·주변·비슷한 맛집·함께 가볼만한 카페
- 클립, 방문자 사진 갤러리, 테마리스트, 블로그 리뷰 목록 (키워드 소스 아님)
- 홈 소식 영역에 섞인 타매장 카드
- 원본 CSV `tag` 를 네이버 `keywords` 에 합치기

---

## 9. 키워드 추출

### 9.1 현재 구현

원문을 저장한 **다음**에 뽑는다.

**축약/불용어를 타지 않고 원문 유지 (삭제 금지):**

1. 상호
2. 카테고리
3. 도로명·지번 주소
4. 전화
5. 영업시간 대표 구간 (`naver_hours`, 예: `11:00 - 다음 날 02:00`)
6. 메뉴명 전체, 인기메뉴명
7. 슬로건

그다음 불용어·길이(2~30자) 필터를 타는 것: 편의, 방문자키워드, 해시태그.

소개 문장을 쪼개 키워드에 넣지 않는다 (파일럿에서 리뷰 문장·`접기`가 섞였음).

불용어 예: `제주`, `맛집`, `예약`, `영업전`, `리뷰`, `네이버` … (레이블. 주소 원문 전체는 keep 이라 유지)

`keywords_source` 에 출처 키를 남긴다.

### 9.2 다음 키워드 가공 메모 (아직 미구현)

구현할 때 아래를 **후처리 규칙**으로 넣는다. 원문 필드(`naver_hours_status`, `naver_ai_briefing` 등)는 그대로 두고, **키워드 목록만** 가공한다.

**영업상태**

- `영업 전` / `영업전` / `영업 중` / `영업중` 은 키워드에 넣으면 “지금 열었는지”가 검색·태그에 악영향을 준다 → **키워드에서는 삭제**
- `휴무`, `연휴`, `임시휴무`, `정기휴무`, `오늘 휴무`, `추석 휴무` 등은 실제 운영 정보이므로 **영업상태 자체는 살린다** (원문 `naver_hours_status`·`naver_hours_note`·요일 raw 유지, 키워드에도 휴무·연휴 문구는 남김)
- 정리: 상태 필드는 유지. 키워드 토큰만 `영업전`/`영업중` 계열을 빼고, 휴무·연휴는 남긴다

**반복되는 양식 제거**

키워드(및 AI 브리핑을 키워드 소스로 쓸 때)에서 잘라낸다.

- UI: `좋아요`, `더보기`, `접기`, `펼쳐보기`, `안내`, `새로고침`, `저장`, `공유`, `출발`, `도착`
- 브리핑 틀: `사용자들의 리뷰를 바탕으로 요약했습니다.`, `사용자 리뷰에 기반해 정리한 정보는 다음과 같습니다.`, `출처 N건 전체보기`, `AI 답변으로 정확하지 않은 정보가 포함될 수 있어요.`
- 푸터: `이용약관`, `고객센터`, `리뷰운영정책`, `신고센터`, `네이버`
- 인사이트 축 숫자만 있는 줄 (`17`, `19`, `21` 같은 단독 시각 라벨)

**작성자 명 제거**

AI 브리핑·리뷰 인용에 붙는 닉네임은 키워드가 아니다.

- 예: `남낙타`, `써녕리`, `윤댕`, `동동이`, `쥬쥬`, `momo`, `dks****`, `hgs****`, `꼬꼬마`
- 패턴: 한글 2~6자 단독 줄, `****` 포함 아이디, `+2` 같은 카운트 칩
- `이런 점이 좋았어요` 의 **고정 키워드**(`음식이 맛있어요` 등)는 작성자가 아니므로 유지

**날짜 제거**

- `YY.MM.DD.` / `YYYY.MM.DD.`
- `2026년 02월 10일 화요일` 형태
- 기간 `2024.07.16. ~ 2024.07.25.`
- 키워드에는 넣지 않음. 소식·브리핑 **원문**에는 남겨도 됨

---

## 10. crawled.txt 형식

```text
항목: 한 줄 값

항목:
여러 줄
```

값이 없으면 해당 항목 행 자체를 출력하지 않음.

---

## 11. URL 목록

```text
# place id
https://search.naver.com/search.naver?query={query}

# 사람용 지도
https://map.naver.com/p/entry/place/{id}
https://map.naver.com/p/search/{query}

# 자동화
https://pcmap.place.naver.com/place/{id}/home
https://pcmap.place.naver.com/place/{id}/information
https://pcmap.place.naver.com/restaurant/{id}/feed      # 소식. 홈에서 긁지 말 것
https://pcmap.place.naver.com/restaurant/{id}/review/visitor
https://pcmap.place.naver.com/restaurant/{id}/ticket    # 예약 있을 때만

# 키워드 부족. 이것만으로 상세 대체 금지
https://map.naver.com/p/api/place/summary/{id}
```

---

## 12. 파일럿 (2026-09-10)

| | 돌담흑돼지 연동 본점 | 도두해녀의집 |
| --- | --- | --- |
| 출력 | [`pilot_1/`](pilot_1/) | [`pilot_dodu/`](pilot_dodu/) |
| place id | `1766357276` | `13391363` |
| 매칭 | 주소 일치, ~4.5m | 주소 일치, ~5.3m |
| 슬로건 | 제주도민의 찐맛집 인정 | 제주 바다를 품은 전복죽의 진수 |
| 소식 | `/feed` 본인 글 3 | 본인 피드 없음 (타매장 미저장) |
| 인기메뉴·평균결제 | 있음 | 홈에 카드 없음 |
| 대기/예약 | 테이블링·방문예약 | 없음 |
| 정보 탭 | 소개·세스코·주차 불가 등 | 메뉴 미리보기만 (`메뉴11`) |

검수 원문: `pilot_1/crawled.txt`, `pilot_dodu/crawled.txt`.

---

## 13. 주차장 폴더에서 가져올 것 / 가져오지 말 것

가져올 것: Playwright + Apollo, 주소·좌표 매칭, 영업시간 펼침 파싱, ToS·sleep.

가져오지 말 것: 공영주차장 필터, 모두의주차장 요금, GraphQL 직접 호출.

---

## 14. 시간낭비 가드 (대량 돌릴 때)

| 상황 | 가드 |
| --- | --- |
| 인기메뉴/AI 브리핑이 1차 휠(1200×4)에 안 보임 | Place+면 700×6 재시도. 아니면 중단. 비슷한 맛집까지 내리지 않음 |
| 탭 바에 `소식` 없음 | `/feed` 를 열지 않음 |
| 탭 바에 `예약` 없음 | ticket/booking 을 열지 않음 |
| 정보 탭 본문이 메뉴 미리보기뿐 | expander 8라운드 반복 금지 |
| 홈을 매칭용으로 이미 연 경우 | **재오픈하지 않고** 같은 홈에서 휠만 |
| AI 브리핑 `출처 N건 전체보기` | 클릭 금지. 이미 펼쳐져 있어도 그 이후는 저장에서 절단 |
| 리뷰 `이런 점이 좋았어요` 더보기 | **1회만**. 6회 반복 금지 |

---

## 한 줄

`pcmap` 홈에서 이 가게만 펼쳐 읽고, 소식은 `/feed`+작성 상호가 맞을 때만, 추천 카드는 열지도 않는다. 키워드는 원문 다음에 뽑고, 상호·주소·전화·영업시간·메뉴는 축약해도 지우지 않는다. `영업전`은 키워드에서 빼되 휴무·연휴 상태는 살린다.
