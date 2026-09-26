## 미구현 / 주기 작업 (최상단)

- **키워드 열 추가** — `ko/place.csv`(또는 검색용)에 키워드 컬럼 아직 없음. 검색·추천용으로 추가 필요.
- **카지노 노출 차단** — `synth-제주오리엔탈호텔카지노` 등. **한국인(국문) 검색·추천에 안 나오게**. 외국인 전용 분기만 허용. (스키마/필터 미구현)
- **집중률 업데이트 필요** — `ko/place_cnctr.csv`는 일자 가로열 스냅샷. API 일 1회 갱신이므로 **주기적 재수집** 필요. `build_unified.py`는 `has_cnctr` 플래그만 재표시.
- **날씨 업데이트 필요** — `기상청/` 스냅샷·`ai_brief.json` 주기 갱신. 현재는 **도심 단일 격자** 기준(장소별 격자 아님). 초단기/단기/중기·특보를 일정에 맞게 조합해 씀.

### 챗봇 조회 구조도

챗봇이 직접 여는 진입점은 두 개. (카카오맵 API는 추후 추가)

```
기상청/ai_brief.json                          ← 도심 격자 날씨(단독). place와 FK 없음
관광정보_다국어통합/ko/place.csv              ← 장소 검색 허브 (항상 여기부터)

ko/place.csv
│
├─ langs 에 user_lang 있음
│     → {lang}/place.csv (+ detailIntro2_* / detailInfo2_*)  place_id 연동·병합
│     → 없으면 국문(+번역). 객실(room)은 항상 ko만
│
├─ has_pet == "1"
│     → ko/place_pet.csv                      (place_id)  끝
│
├─ has_with == "1"
│     → ko/place_with.csv                     (place_id)  끝
│
├─ related_num > 0
│     → ko/place_related.csv                  (place_id)
│           ├─ rlte_place_id 있음 → ko/place.csv 재조회 (처음과 동일하게 장소 정보)
│           └─ rlte_place_id 비움 → 텍스트만 (AI 참고). 추가 조회 없음
│
├─ has_odii == "1"
│     → ko/place_odii_theme.csv               (place_id)
│           └─ tid → {lang}/place_odii_story.csv   (언어별 story). theme→place 역조회 없음
│
├─ has_cnctr == "1"
│     → ko/place_cnctr.csv                    (place_id, 일자 가로열)  끝
│
├─ contenttypeid / detailinfo_num
│     → {lang}/place_detailIntro2_*.csv       (유형별 intro)
│     → {lang}/place_detailInfo2_repeat.csv
│     → ko/place_detailInfo2_room.csv         (숙박 객실, 국문만)
│
└─ mapx / mapy
      → 네이버지도 딥링크 (카드·채팅 길안내 UI)
      → (추후) 카카오맵·모빌리티 API — 소요시간·거리·요금 수치
```

모든 다국어 항목은 해당 언어가 없으면 **한국어를 기준으로 번역**하고, 한국어도 없으면 **조회 실패**로 처리한다.

---

지역: 일도일동, 건입동, 이도일동, 삼도이동  
(동 단위 API 파라미터는 없음 → **bbox로 원도심 범위를 잡아** 수집·추천. addr의 동명은 보조.)

통합데이터를 통해 사용자 데이터 기반 방문할 장소를 추천해서 후보를 만들어냄  
사용자와 대화하며 후보를 변경, 추려냄 그 과정에서 챗봇은 해당대답에 대한 추천 질문을 제공함  
후보가 추려졌다면 방문 예정시간의 **날씨**(도심 격자 스냅샷)와 **가는데 걸리는 시간**(카카오 API 수치)을 고려해서 최종 경로·일정을 짜거나 수정요청을 보냄  
최종 목적지가 나오면 채팅 내에서 **네이버지도 딥링크**를 제공(카드와 동일).  
현재 모든 카드는 바로 네이버지도로 연결되지만 임시로 몇몇 매장은 안내페이지가 나오게 하려고 함

날씨는 최대 10일까지의 정보를 기반으로 판단하여 추후 여행일정까지 고려해주며, 실시간 업데이트, 기상특보 고려로 여행에 도움을 줌

오프라인 팜플렛으로 구역별 분리되어 찾기 어렵고, 업데이트 되지 않던 정보를 db로 정리해서 통합함

### 목적지 안내 (카카오 vs 네이버)

| 역할 | 수단 | 용도 |
| --- | --- | --- |
| **소요시간·거리·택시비 등 수치** | 카카오맵 / 카카오모빌리티 API | 대중교통·도보·택시·자동차(+도보) 경로 **정보만** 조회 |
| **실제 길안내(이용자)** | **네이버지도 딥링크** (`mapx`/`mapy`) | 카드·채팅 하이퍼링크. 이용자는 네이버로 안내 |

카카오를 쓰는 이유: 대중교통·자동차·도보 길안내 API로 소요시간·요금·거리 등을 가져오기 위함.  
이용자는 그 정보만 보고, **실제 길찾기는 네이버지도**를 연다.

개방데이터_활용매뉴얼(반려동물동반여행)은 한국관광공사_개방데이터_활용매뉴얼(국문) 내의 detailPetTour2과 완전히 같으므로 활용하지 않음  
→ 국문 원본은 `tour_pet.csv`, 챗봇은 `관광정보_다국어통합/ko/place_pet.csv`만 (`place_id` 조인)  
무장애 여행은 국문과 contentid 동일 → intro/info는 국문 재사용, 챗봇은 `ko/place_with.csv` (`place_id` 조인) + `has_with`

`has_pet=1` → 반려동물 **입장 가능성이 높은** 장소(펫 정보 있음). 반려동물 동반을 원하는 사용자에게 **우선 조회·추천**.  
`has_with=1` → **배리어프리 가능성이 높은** 장소(무장애 정보 있음). 휠체어=보장 아님. 배리어프리를 원하는 사용자에게 **우선 조회**.  
상세는 `place_pet` / `place_with`로 확인.

`TourAPI_Guide_(연관관광지)v4.1` / `TourAPI_Guide_(오디)v4.1` — **수집 원본**만 보관.  
챗봇은 `ko/place.csv`의 `related_num` / `has_odii` / `has_cnctr`가 양수이면 통합 매칭본을 조회한다.

### 연관관광지 (`related_num`) — 의도된 사용

- `related_num > 0`인 기준 장소는 **소수(현재 5곳)** — 알고 있는 범위.
- `rlte_place_id`가 **채워진 행만** 딥링크·카드 연결.
- `rlte_place_id`가 비면 → **텍스트(연관 관광지명 등)만** 두고, AI가 추천·설명에 **참고**하는 용도. (전수 place 매칭·딥링크 목표가 아님)

### 오디 theme

- 진입: `has_odii` → `place_odii_theme`(`place_id`) → `{lang}/place_odii_story`(`tid`).
- theme가 place를 **역참조**할 일은 없음(단방향). 코스형 미연결 theme는 map에 두되 story는 tid로만 필요 시 조회.

스크립트·매칭 검수 파일은 `실행파일/<작업명>/`에 둔다 (데이터 폴더와 분리).  
수동매칭(다국어·연관·오디·집중률)은 `실행파일/관광정보_다국어통합/*_place_map.csv`에 보관 — 통합 CSV를 다시 만들어도 유지된다.

흩어진 db를 병합해 하나의 챗봇형태로 정보를 제공  
챗봇을 통한 피드백으로 틀린정보 즉시 수정


## 관광정보 (챗봇에서 쓰는 법)

챗봇이 읽는 장소 DB는 `관광정보_다국어통합/` 뿐이다.  
언어별 TourAPI CSV를 묶어 **국문 허브 + 언어 오버레이** 구조.  
(스키마·매칭·재빌드 상세는 그 폴더 `readme.md` / `csv_columns.md`)

**검색은 항상 `ko/place.csv`.** `langs`는 다국어 오버레이만 (`en,ja,…`, `ko` 없음). 비면 국문만.

| 상황 | 챗봇 동작 |
| --- | --- |
| `user_lang` ∈ `langs` | `{lang}/place.csv`(+ intro/info)를 `place_id`로 **연동(병합)**. 빈 칸·객실 등은 국문으로 채움 |
| `user_lang`=ko 또는 langs에 없음 | 국문 응답. 외국어 사용자면 국문 → **번역** (오버레이 연동 없음) |
| 목적지 **수치** | `mapx`/`mapy`로 카카오 모빌리티·길찾기 API (시간·거리·요금) |
| 목적지 **안내 UI** | 동일 좌표로 **네이버지도 딥링크** |
| 반려동물 | `has_pet=1` = 입장 가능성 높음 → **우선** 후보. 상세 `ko/place_pet.csv` |
| 배리어프리 | `has_with=1` = 배리어프리 가능성 높음 → **우선** 후보. 상세 `ko/place_with.csv` (휠체어 보장 ≠) |
| 연관관광지 | `related_num > 0`이면 `ko/place_related.csv`. `rlte_place_id` 있으면 딥링크, 없으면 텍스트·AI 참고 |
| 오디 | `has_odii == "1"`이면 `ko/place_odii_theme.csv`(`place_id`) → `{lang}/place_odii_story.csv`(`tid`) |
| 집중률 | `has_cnctr == "1"`이면 `ko/place_cnctr.csv` (`place_id`, 일자 가로 컬럼). **주기 재수집 필요** |
| 숙박 객실 | `ko/place_detailInfo2_room.csv`만 (다국어 room 없음) |

한 사용자는 보통 한 언어만 쓰므로 언어별 폴더를 연다. 국문 텍스트를 place / place_lang에 이중 두지 않음.

**다국어 절반 번역:** TourAPI에 해당 언어 수록분이 없으면 `langs`에 없음 → 연동 불가, **국문 번역**으로 제공하면 됨. (의도된 동작)

### 조회 흐름

```
# 일반 검색
1) ko/place.csv 에서 장소 검색 (항상 국문 기준)
2) ko_row.langs 에 사용자 언어가 있는지 확인
3) 있으면 → 해당 언어 place.csv 연동(병합) / 없으면 → 국문(+번역)
4) has_pet·has_with 가 1 이면 상세 CSV 조인 (place_id)
5) related_num > 0 이면 place_related 조회
   - rlte_place_id 있음 → 딥링크 가능
   - 없음 → 텍스트만, AI 참고
6) has_odii == "1" 이면 odii theme·story 조회 (tid+langCode)
7) has_cnctr == "1" 이면 place_cnctr 조회

# 펫·배리어프리 필요 사용자 (우선 조회)
1) ko/place.csv 에서 has_pet=1 또는 has_with=1 인 장소를 우선 후보로
2) place_id 로 place_pet / place_with 상세 로드
3) 이후 일반과 동일하게 언어·일정·날씨 흐름
```

```
# 필요 사용자: 가능성 높은 장소부터
need_pet = user.wants_pet
need_access = user.wants_accessibility
candidates = load("ko/place.csv")
if need_pet:
    candidates = [r for r in candidates if r.has_pet == "1"]   # 우선
if need_access:
    candidates = [r for r in candidates if r.has_with == "1"]

ko_row = find(candidates, query)  # 또는 일반 검색 후 has_* 로 재정렬

if user_lang in ko_row.langs.split(","):
    ml_row = load(f"{user_lang}/place.csv").get(ko_row.place_id)
    answer = merge(ml_row, fill_missing_from=ko_row)  # 연동
else:
    answer = translate(ko_row, to=user_lang)          # 번역

if ko_row.has_pet == "1":
    answer.pet = load("ko/place_pet.csv").get(ko_row.place_id)
if ko_row.has_with == "1":
    answer.with_ = load("ko/place_with.csv").get(ko_row.place_id)

if int(ko_row.related_num or 0) > 0:
    answer.related = load("ko/place_related.csv").filter(place_id == ko_row.place_id)
    # deep_link = rows where rlte_place_id; else text_for_ai
if ko_row.has_odii == "1":
    themes = load("ko/place_odii_theme.csv").filter(place_id == ko_row.place_id)
    stories = load(f"{user_lang}/place_odii_story.csv").filter(tid in themes)
    answer.odii_stories = stories or load("ko/place_odii_story.csv").filter(tid in themes)
if ko_row.has_cnctr == "1":
    answer.cnctr = load("ko/place_cnctr.csv").get(ko_row.place_id)
```

- `has_pet` / `has_with` = **가능성 높음** 플래그(보장 아님). 상세는 분리 DB
- `related_num > 0` → 연관 조회. 딥링크는 `rlte_place_id` 있을 때만
- `has_odii` / `has_cnctr` → 오디·집중률 매칭본
- `langs`로 다국어 **연동** 여부 분기 (`ko`는 langs에 넣지 않음). 없으면 번역
- 좌표·분류·객실(room)·pet·with·related·odii theme·cnctr는 **국문(`ko/`)** — 오디 story만 `{lang}/`
- 원본 `contentid`는 언어마다 다르므로 직접 조인하지 않음 → 통합 키는 `place_id`
- 수집 원본은 국문·무장애·TourAPI_Guide 폴더, 챗봇 DB는 `관광정보_다국어통합/`만

### 폴더 역할

| 경로 | 역할 |
| --- | --- |
| `관광정보_다국어통합/ko/` | 전체 장소 허브 (room·pet·with·related·odii theme·cnctr 매칭본) |
| `관광정보_다국어통합/en\|ja\|zh-CN\|zh-TW/` | 해당 언어가 있는 장소만 (`place_id` → ko) + odii story |
| `실행파일/관광정보_다국어통합/build_unified.py` | 원본 CSV → 통합 DB 재빌드 |
| `실행파일/관광정보_다국어통합/odii_theme_place_map.csv` | 오디 theme↔place 수동 매핑(검수) |
| `TourAPI_Guide_(연관관광지)v4.1/` | 연관 **원본** (`related_tourism.csv`) |
| `TourAPI_Guide_(오디)v4.1/` | 오디 **원본** (`odii_theme` / `odii_story`) |
| `기상청/` | 날씨·특보 스냅샷 (`ai_brief.json` 등) — **주기 업데이트** |

재빌드:

```bash
python3 "작업/실행파일/관광정보_다국어통합/build_unified.py"
```

재빌드 시 `실행파일/관광정보_다국어통합/*_place_map.csv`를 **반드시 참고**한다  
(`ml_place_map` · `related_place_map` · `odii_theme_place_map` · `cnctr_place_map`).  
수동 연결·drop·별칭은 맵에만 두고, 산출 CSV만 고치면 다음 빌드에 사라진다.


## TourAPI CSV (언어별 원본)

챗봇이 직접 읽지 않는 **수집 원본**. 통합 DB의 입력이다.

| 폴더 | 서비스 |
| --- | --- |
| `한국관광공사_지역기반 관광정보 조회(국문)` | KorService2 (`tour_pet.csv` 포함, `tour_content`에 pet 없음) |
| `한국관광공사_지역기반 관광정보 조회(영문)` | EngService2 |
| `한국관광공사_지역기반 관광정보 조회(일문)` | JpnService2 |
| `한국관광공사_지역기반 관광정보 조회(중문간체)` | ChsService2 |
| `한국관광공사_지역기반 관광정보 조회(중문번체)` | ChtService2 |
| `한국관광공사_무장애여행 조회` | KorWithService2 (`with_*`만, → `place_with`) |
| `TourAPI_Guide_(연관관광지)v4.1` | TarRlteTarService1 원본 → `ko/place_related.csv` |
| `TourAPI_Guide_(오디)v4.1` | Odii 원본(다국어) → map(**tid**) → `place_odii_theme` + `place_odii_story` |

각 폴더의 상세 재현 규칙·타입 매핑은 해당 폴더 `readme.md` / `csv_columns.md` 참고.  
다국어 재수집: `작업/실행파일/한국관광공사_지역기반 관광정보 조회(영문)/fetch_multilang_tour.py`  
오디 다국어 재수집: `작업/실행파일/TourAPI_Guide_(오디)v4.1/fetch_odii.py` (`ko,en,jp,cn1,cn2`)  
무장애 재수집: `작업/실행파일/한국관광공사_무장애여행 조회/fetch_with_tour.py`

### 테이블 관계 (언어 공통)

```
tour_content                    ← 1행/콘텐츠 (pet/with 없음)
    │ PK contentid (= 통합 place_id)
    ├─ tour_pet                 ← 국문만, 1:0..1 → place_pet
    ├─ tour_detailIntro2_*      ← 타입별 1:1 (항상 1행, empty여도 유지)
    ├─ tour_detailInfo2_repeat  ← 일반 반복 0~N
    └─ tour_detailInfo2_room    ← 숙박 객실 0~N (**국문만**)

무장애 원본(별도 폴더) with_*  → place_with  (place_id = contentid)
연관 원본 related_tourism     → place_related (place_id 매칭)
오디 원본 theme/story(다국어)  → ko/place_odii_theme + {lang}/place_odii_story (map=tid)
집중률 API                    → ko/place_cnctr + has_cnctr (주기 재수집)
```

- **intro**: `contenttypeid`로 파일 1개 결정. 유무 플래그 불필요.
- **다국어 교통(77)**: `tour_detailIntro2_traffic.csv` **제외** — 전국(다국어 API)에서 교통 목록이 조회되지 않는 것으로 파악됨.
- **다국어 객실**: `tour_detailInfo2_room.csv` **제외** — 매뉴얼상 다국어 API 미제공.
- **여행코스**: 국문도 CSV 미생성(비활성). 다국어는 타입 없음.
- **info**: 있을 수도 없을 수도 있음.  
  국문: 숙박(32)→`room` / 그 외→`repeat`.  
  다국어: `repeat`만 (객실 CSV 없음).

### `tour_content.detailinfo_num` (파생)

| 값 | 의미 |
| --- | --- |
| `0` | 해당 콘텐츠에 `detailInfo2` 없음 |
| `N` | 해당 콘텐츠의 info 자식 행 수 |

어느 테이블 건수인지는 **`contenttypeid`로 결정** (타입마다 info 스키마가 다름):

| | 국문 | 다국어 | `detailinfo_num`이 세는 것 |
| --- | --- | --- | --- |
| 비숙박 | 12·14·15·28·38·39 | 75·76·78·79·82·85 (**77 교통 제외**) | `tour_detailInfo2_repeat` 행 수 |
| 숙박 | 32 | 80 | 국문: `tour_detailInfo2_room` / 다국어: room CSV 없음 → 통상 `0` |

- 국문: 숙박에는 **repeat가 없고**, 비숙박에는 **room이 없음**.
- 다국어: **room CSV 없음**. `detailinfo_num`은 `repeat` 행 수만.
- API 원본 필드 아님. info CSV와 **함께 재계산**.
- 위치: `overview` 다음(마지막). 국문·영·일·중 동일 컬럼명.
