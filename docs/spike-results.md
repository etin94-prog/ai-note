# Sprint 0 기술 확인 결과 (스파이크)

> 구현계획서 5장 Sprint 0 표 기준. 실기기 확인은 엄마 iPhone 우선.

| # | 확인 | 기기 | 결과 | 날짜 | 메모 |
|---|---|---|---|---|---|
| S0-1 | `/ai-note/` 직접 URL·새로고침 | PC (로컬 dist) | ✅ 통과 | 10-09 | SPA + 404.html 대체. 상세 경로 직접 접속 시 앱 정상 표시 |
| S0-1 | 〃 | GitHub Pages 실배포 | ⏳ 저장소 생성 후 | | |
| S0-2 | 홈 화면 설치 → 전체 화면 실행 | iPhone / Android | ⏳ | | manifest·아이콘 로드는 로컬에서 확인 |
| S0-3 | 비행기 모드 완전 종료 → 재실행 | iPhone / Android | ⏳ | | 서비스워커 사전 캐시 28개 파일 |
| S0-4 | GitHub 모드 기기 간 동기화 (60초 내) | 엄마 iPhone ↔ 아빠 폰 | ⏳ 토큰 발급 후 | | 가짜 GitHub 로 자동 테스트 통과 |
| S0-5 | Firebase 모드 기기 간 동기화 (5초 내) | 〃 | ⏳ Firebase 설정 후 | | |
| S0-6 | 동시 저장 (같은/다른 항목) | 2대 | ⏳ | | 자동 테스트 통과: 다른 항목 보존, 같은 항목 충돌 |
| S0-7 | 엑셀 템플릿 왕복 | PC·폰 | ⏳ Sprint 3 전 | | |
| S0-8 | Paper 바텀시트·칩·스낵바, iPhone 키보드 | iPhone | ⏳ | | |
| S0-9 | 서비스워커 `showNotification` | iPhone / Android | ⏳ | | |

## 개발 중 발견·결정
| 날짜 | 내용 |
|---|---|
| 10-09 | Expo SDK 57: 하단 탭은 `expo-router/js-tabs`. 정적 출력(static)에서 탭의 Suspense 로 **hydration 불일치** 발생 → 데이터가 모두 클라이언트에서 오는 앱이라 **SPA 출력(single) + `public/index.html` 템플릿**으로 전환 |
| 10-09 | 서비스워커 사전 캐시에서 사용하지 않는 아이콘 폰트 제외 (7.3MB → 4.2MB). 남은 대부분은 Firebase SDK 포함 번들 → Firebase 모드에서만 불러오도록 분리 예정 |
| 10-09 | JDK 미설치로 Firestore 에뮬레이터 계약 테스트 보류 → JDK 설치 후 추가 |
