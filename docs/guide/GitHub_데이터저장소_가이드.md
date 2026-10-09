# GitHub 데이터 저장소 가이드 (GitHub 모드)

> 대상: 아빠 · 소요: 약 20분 · 비용: 0원
> GitHub 모드는 가족 데이터를 **비공개 저장소의 JSON 파일**로 저장합니다. 변경할 때마다 커밋이 생겨 **누가 언제 무엇을 바꿨는지 GitHub에서 그대로 확인**할 수 있습니다.
> ⚠ 토큰은 비밀번호와 같습니다. **채팅(Claude 포함)에 붙여넣지 말고, 각 기기의 앱 화면에 직접 입력**하세요.

---

## 1. 저장소 만들기

| 저장소 | 공개 여부 | 용도 |
|---|---|---|
| `ai-note` | **Public** | 앱 소스 + GitHub Pages (웹 주소 `etin94-prog.github.io/ai-note`) |
| `ai-note-data` | **Private** | 가족 데이터 (부모 기기만 접근) |
| `ai-note-son` | **Private** | 아들 기기용 읽기 전용 사본 (본인 일정만) — Q15 결정 시 |
| `ai-note-daughter` | **Private** | 딸 기기용 읽기 전용 사본 (본인 일정만) — Q15 결정 시 |

만드는 방법: https://github.com/new → Owner `etin94-prog` → 이름 입력 → Public/Private 선택 → **"Add a README file" 체크** (빈 저장소는 API로 쓰기 어려움) → [Create repository]

### `ai-note` Pages 설정
`ai-note` 저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions**

## 2. 기기별 토큰 만들기 (fine-grained token)

기기마다 따로 만들면 폰을 잃어버렸을 때 그 기기 토큰만 끊을 수 있습니다.

1. GitHub 오른쪽 위 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → [Generate new token]**
2. 아래처럼 입력

| 항목 | 부모 기기 (엄마 아이폰 / 아빠 폰 / PC) | 자녀 기기 (아들 / 딸) |
|---|---|---|
| Token name | `ai-note 엄마 아이폰` 처럼 기기 이름 | `ai-note 아들 폰` |
| Expiration | 90일 (만료 14일 전 앱이 알려줌) | 90일 |
| Resource owner | `etin94-prog` | `etin94-prog` |
| Repository access | **Only select repositories** → `ai-note-data`, `ai-note-son`, `ai-note-daughter` | **Only select repositories** → 본인 저장소 하나 (`ai-note-son`) |
| Repository permissions → **Contents** | **Read and write** | **Read-only** |
| 그 외 권한 | 건드리지 않음 (Metadata: Read-only는 자동) | 동일 |

3. [Generate token] → 표시된 토큰(`github_pat_...`)은 **이 화면에서 한 번만** 보입니다
4. **해당 기기에서** 앱 → 더보기 → 저장 모드 → GitHub → 토큰 붙여넣기 → [연결 확인]
   - 다른 기기에서 만들었다면 그 기기 앱에 직접 옮겨 입력 (메신저·채팅으로 보내지 않기 권장)
5. 앱이 "연결됨 · ai-note-data 읽기/쓰기 확인"을 표시하면 완료

## 3. 토큰 관리
| 상황 | 할 일 |
|---|---|
| 폰 분실·교체 | Fine-grained tokens 목록에서 해당 기기 토큰 **[Revoke]** → 새 폰용 토큰 발급 |
| 만료 임박 알림 | 같은 설정으로 새 토큰 발급 → 앱에 입력 → 이전 토큰 Revoke |
| 누가 무엇을 바꿨는지 확인 | `ai-note-data` → **Commits** (커밋 메시지에 기기 이름·작업 내용) |
| 잘못된 변경 되돌리기 | 앱의 가져오기 되돌리기 또는 Claude에게 해당 커밋 되돌리기 요청 |

## 4. 하지 말 것
- `ai-note-data` 파일을 GitHub 웹에서 직접 고치기 → 앱 캐시와 어긋날 수 있음. 대량 수정은 **엑셀 동기화 파일**로
- `ai-note-data`를 Public으로 바꾸기
- 토큰을 저장소 파일·문서·채팅에 남기기
- `etin94-prog.github.io` 아래에 외부 광고·분석 스크립트를 쓰는 다른 페이지 두기 (같은 출처라 토큰 저장 공간을 공유)

---

## 완료 체크리스트
- [ ] `ai-note` (Public) + Pages Source = GitHub Actions
- [ ] `ai-note-data` (Private, README 포함)
- [ ] (Q15) `ai-note-son`, `ai-note-daughter` (Private, README 포함)
- [ ] 부모 기기별 토큰 3개 (엄마 아이폰 / 아빠 폰 / PC) — 각 기기 앱에 입력
- [ ] (Q15) 자녀 기기 토큰 2개 (읽기 전용)
