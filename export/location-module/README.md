# 위치 헤더 모듈

`/main` 상단의 위치 헤더(현재 위치 표시 + 새로고침)와 위치 설정 페이지(`/location`)를 다른 저장소에서 쓰기 위한 독립 모듈.
이 폴더는 원본 서비스 빌드에 포함되지 않는다.

## 전제 (대상 저장소)

- Vite + React + TypeScript, `@/` → `src/` 별칭
- Tailwind + shadcn/ui: `@/components/ui/{button,card,input}`, `@/hooks/use-toast`, `@/lib/utils`(`cn`), 앱 루트에 `<Toaster />`
- `react-router-dom` v6, `lucide-react`
- Vercel 배포 (`api/` 서버리스 함수). 다른 서버라면 같은 경로·응답으로 프록시를 구현한다.

## 복사

| 이 폴더 | 대상 저장소 |
| --- | --- |
| `src/features/location/` | `src/features/location/` |
| `api/_http.ts`, `api/naver/`, `api/kakao/` | `api/` (루트) |

대상에 이미 `api/_http.ts`가 있으면 이름을 바꿔 import 경로를 맞춘다.

## 환경변수

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `VITE_NAVER_NCP_KEY_ID` | 클라이언트 | 네이버 지도 JS SDK (프록시 실패 시 폴백) |
| `NAVER_API_KEY_ID`, `NAVER_API_KEY` | 서버 | 네이버 Geocoding / Reverse Geocoding |
| `KAKAO_REST_API_KEY` | 서버 | 카카오 장소명 검색 |
| `ALLOWED_ORIGINS` (선택) | 서버 | 프록시 호출 허용 도메인, 쉼표 구분. 자기 도메인은 자동 허용 |

네이버 클라우드 콘솔에서 새 서비스 도메인을 Web 서비스 URL에 등록해야 SDK 폴백이 동작한다.

## 설정 (`src/features/location/config.ts`)

- `RETURN_TO_PATHS`: 헤더를 넣는 페이지 경로를 모두 추가 (위치 선택 후 돌아갈 곳)
- `DEFAULT_RETURN_TO`: 기본 복귀 경로
- `PRIORITY_REGION_KEYWORD`: 검색 결과 우선 지역 (원본 서비스는 `"제주"`)

## 사용

`locale`(`"ko" | "en" | "zh" | "ja"`, 기본 `"ko"`)은 대상 앱의 언어 상태에서 넘긴다.

```tsx
// App.tsx
import { LOCATION_PAGE_PATH, LocationSelectPage } from "@/features/location";

<Route path={LOCATION_PAGE_PATH} element={<LocationSelectPage locale={locale} />} />
```

```tsx
// 헤더를 넣을 페이지 (경로가 RETURN_TO_PATHS에 있어야 함)
import { LocationHeader, useCurrentLocation } from "@/features/location";

export default function HomePage() {
  const location = useCurrentLocation(locale);
  // location.coords / location.address 로 주변 데이터 조회 등에 활용

  return (
    <div className="bg-background min-h-screen pb-20">
      <LocationHeader location={location} returnTo="/" locale={locale} />
      {/* ... */}
    </div>
  );
}
```

페이지에 검색창이 있어 모바일 키보드가 헤더를 가린다면
`useKeyboardTopInset(검색창포커스여부)` 값을 `topOffset`으로 넘긴다.

## 다국어·기계번역

- 헤더 문구: `strings.ts`의 4개 언어 사전
- 주소: 동·읍·면까지 잘라서 브라우저에서 기계번역 (`lib/koTranslate.ts`)
  - 구글 번역 비공식 엔드포인트(`translate.googleapis.com`, `client=gtx`) → MyMemory 무료 API 순
  - 결과는 localStorage(`ko_translate_cache_v1`, 최대 2000개)에 캐시
  - 두 엔드포인트 모두 예고 없이 차단·제한될 수 있고, 구글 경로는 공식 API가 아님. 실패하면 한국어 원문을 표시
- 위치 설정 페이지와 토스트 문구는 원본과 같이 한국어

## 원본과 다른 점

- `locale`을 원본의 `AppLocaleContext` 대신 props로 받음
- 헤더 외 기능(매장 조회, 지도 이동, 제주 전용 좌표 폴백) 제외
- 기존 네이버 지도 스크립트를 제거·재로드하지 않음 (대상 앱의 지도와 충돌 방지). 그래서 SDK 폴백의 언어는 최초 로드 시점 값으로 고정
