# 카카오맵 — 지도 SDK

> 원문: [카카오맵 > 이해하기 — 지도 SDK](https://developers.kakao.com/docs/ko/kakaomap/common)

지도 SDK는 웹·모바일 앱에서 카카오맵을 **표시하고 제어**하는 기능을 제공합니다.  
상세 개발 문서·레퍼런스·샘플은 Kakao Maps API 사이트에 있습니다.

## 플랫폼별 개요

| 구분 | 사용 환경 | 사용 플랫폼 키 | 개발 문서 |
| --- | --- | --- | --- |
| 지도 Web(JavaScript) SDK | 웹 서비스 | **JavaScript 키** | https://apis.map.kakao.com/web/guide/ |
| 지도 Android SDK | Android 앱 | **네이티브앱 키** | https://apis.map.kakao.com/android_v2/docs/ |
| 지도 iOS SDK | iOS 앱 | **네이티브앱 키** | https://apis.map.kakao.com/ios_v2/docs/ |

## 앱 키 주의사항

- 지도 SDK 호출 시 **지정된 플랫폼 키만** 사용합니다.
- **REST API 키를 지도 SDK에 사용하면 안 됩니다.** 잘못된 키 사용 시 에러가 발생합니다.

## 사전 설정

1. 카카오디벨로퍼스에서 앱 생성
2. **[카카오맵] > [사용 설정]** 상태를 **ON**
3. 플랫폼별 키에 정보 등록
   - Web: JavaScript 키의 **JavaScript SDK 도메인**
   - Android/iOS: 네이티브 앱 키의 **앱 정보**

## 무료 쿼터 (일간)

| API | 제공량 |
| --- | --- |
| 지도 Web(JavaScript) SDK | 300,000건 |
| 지도 Android/iOS SDK | 300,000건 |

> 개발자 계정 기준 **첫 번째로 활성화한 앱**에만 무료 쿼터 적용.  
> 상세: [쿼터_이용정책.md](./쿼터_이용정책.md)

## REST API와의 역할 구분

| 구분 | 용도 |
| --- | --- |
| 지도 SDK | 지도 UI 표시·마커·오버레이·인터랙션 |
| REST API | 주소/좌표 변환, 장소 검색, 경로 조회, 정적 지도 이미지 |

REST API 문서: [README.md](./README.md)
