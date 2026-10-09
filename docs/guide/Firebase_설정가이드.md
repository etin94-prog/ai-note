# Firebase 설정 가이드 (Firebase 모드, 무료 Spark 요금제)

> 대상: 아빠 (Firebase 처음 사용) · 소요: 약 20~30분 · 비용: 0원 (카드 등록 없음)
> 진행 방식: Sprint 0에서 **Claude와 함께** 진행합니다. Claude가 앱 안 브라우저로 같은 화면을 보며 다음 단계를 안내합니다.
> ⚠ 로그인·비밀번호 입력·약관 동의는 직접 하셔야 합니다. Claude는 대신 입력하지 않습니다.

Firebase 콘솔 화면은 수시로 바뀝니다. 메뉴 이름이 조금 다르면 Claude에게 화면을 보여 주세요.

---

## 0. 미리 알아둘 것

| 용어 | 뜻 |
|---|---|
| Firebase 프로젝트 | 우리 앱 전용 공간 1개 (`ai-note`) |
| Spark 요금제 | 무료 요금제. **카드를 등록하지 않으면 절대 과금되지 않음**. 무료 한도를 넘으면 그날 사용만 막힘 |
| Blaze 요금제 | 종량제. 푸시 알림 서버가 필요해지는 R1b에서만 검토. **지금은 업그레이드 버튼을 누르지 않습니다** |
| Authentication | 가족 로그인(이메일+비밀번호) |
| Firestore | 데이터 저장소 |
| 웹 앱 설정값(firebaseConfig) | 앱이 Firebase를 찾아가는 주소록. **공개돼도 되는 값**이라 앱 코드에 들어갑니다. 보안은 "보안 규칙"이 담당 |

---

## 1. 프로젝트 만들기
1. PC 브라우저에서 https://console.firebase.google.com 접속 → **아빠 Google 계정**으로 로그인
2. **[프로젝트 만들기]** (또는 "Firebase 프로젝트 시작하기")
3. 프로젝트 이름: `ai-note` → 계속
   - 아래에 표시되는 프로젝트 ID(예: `ai-note-1a2b3`)를 메모 → Claude에게 알려 주세요
4. **Google 애널리틱스: 사용 안 함** → [프로젝트 만들기]
5. 완료되면 [계속]

✅ 확인: 왼쪽 아래 요금제 표시가 **Spark** 인지 확인

## 2. 웹 앱 등록
1. 프로젝트 개요 화면에서 **웹 아이콘 `</>`** 클릭
2. 앱 닉네임: `ai-note-web`
3. "Firebase 호스팅 설정" **체크하지 않음** (우리는 GitHub Pages 사용)
4. [앱 등록] → `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }` 가 표시됨
5. 이 **firebaseConfig 블록 전체를 Claude에게 전달** (공개 가능한 값)
6. [콘솔로 이동]

## 3. 로그인 방식 켜기
1. 왼쪽 메뉴 **빌드 → Authentication** → [시작하기]
2. **로그인 방법(Sign-in method)** 탭 → **이메일/비밀번호** → **사용 설정** 켜기
   - 아래 "이메일 링크(비밀번호가 없는 로그인)"는 **끔**
3. [저장]
4. **설정(Settings) 탭 → 승인된 도메인(Authorized domains)** → [도메인 추가] → `etin94-prog.github.io` 입력 → 추가
   - `localhost`는 기본으로 있어야 함 (개발용)

## 4. Firestore 데이터베이스 만들기
1. 왼쪽 메뉴 **빌드 → Firestore Database** → [데이터베이스 만들기]
2. 데이터베이스 ID는 기본값 `(default)` 유지
3. **위치: `asia-northeast3 (서울)`** ← ⚠ 나중에 바꿀 수 없음
4. **프로덕션 모드로 시작** 선택 (모든 접근 차단 상태로 시작 → 우리가 만든 보안 규칙을 배포)
5. [만들기]

## 5. Firebase CLI 설치·로그인 (PC, 1회)
보안 규칙 배포에 사용합니다. PC 터미널(PowerShell)에서:

```bash
npm install -g firebase-tools
```
```bash
firebase login
```
- 브라우저가 열리면 **아빠 Google 계정으로 직접 로그인·허용** (사용 통계 수집 질문은 `n` 권장)

```bash
firebase projects:list
```
- 목록에 `ai-note` 프로젝트가 보이면 성공 → Claude에게 알려 주세요

이후 보안 규칙 배포(`firebase deploy --only firestore:rules`)는 Claude가 명령을 준비하고, 실행 전에 승인을 받습니다.

## 6. (권장) API 키 사용 도메인 제한
1. https://console.cloud.google.com → 상단에서 프로젝트 `ai-note` 선택
2. **API 및 서비스 → 사용자 인증 정보** → "Browser key (auto created by Firebase)" 클릭
3. **애플리케이션 제한사항: 웹사이트** → 허용할 웹사이트에 추가
   - `https://etin94-prog.github.io/*`
   - `http://localhost:*` (개발용)
4. [저장] (반영까지 수 분 걸릴 수 있음)

## 7. 가족 계정 (앱이 준비된 뒤)
1. 아빠: 앱 설치 → [가족 만들기] → 이메일·비밀번호로 가입
2. 엄마·아들·딸: 각자 폰에 앱 설치(홈 화면에 추가) → [가입 요청] → 이메일·비밀번호
3. 아빠(또는 엄마) 앱: 더보기 → 가족 구성원 → **가입 요청 승인 + 역할 지정**
   - 자녀 이메일이 없다면 부모가 관리하는 이메일 사용 가능 (비밀번호 재설정 메일 수신용)

---

## 완료 체크리스트
- [ ] 요금제 Spark (카드 미등록)
- [ ] 웹 앱 등록, firebaseConfig 전달
- [ ] 이메일/비밀번호 로그인 사용
- [ ] 승인된 도메인에 `etin94-prog.github.io`
- [ ] Firestore 생성 (서울, 프로덕션 모드)
- [ ] `firebase projects:list` 에 `ai-note` 표시
- [ ] (권장) API 키 도메인 제한

## 문제가 생기면
| 증상 | 확인 |
|---|---|
| 앱 로그인 시 `auth/unauthorized-domain` | 3-4 승인된 도메인 |
| 데이터가 안 보이고 `permission-denied` | 보안 규칙 배포 여부 (Claude가 확인) |
| `firebase` 명령을 찾을 수 없음 | 터미널을 새로 열기, `npm install -g firebase-tools` 재실행 |
| 화면에 "업그레이드" 권유 | 누르지 않기 — R1a는 Spark로 충분 |
