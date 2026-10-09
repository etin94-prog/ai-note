# 우리집 학원 노트 (ai-note)

가족 학원 일정·학원비 납부/환불 기록·입력(웹 폼·엑셀·채팅·카톡 가져오기)을 한 곳에서 관리하는 웹앱(PWA).

- 웹 주소: https://etin94-prog.github.io/ai-note/ — 폰에서 열고 **홈 화면에 추가 / 앱 설치**
- 요구사항: [docs/Requirement.md](docs/Requirement.md) · 구현 계획: [docs/구현계획서.md](docs/구현계획서.md)
- 설정 가이드: [GitHub 데이터 저장소](docs/guide/GitHub_데이터저장소_가이드.md) · [Firebase](docs/guide/Firebase_설정가이드.md)

## 저장 모드
가족 데이터는 이 저장소에 없습니다. 앱에서 둘 중 하나를 연결합니다 (Requirement 1.5).

| 모드 | 저장 위치 |
|---|---|
| GitHub | 비공개 저장소 `ai-note-data` (기기별 토큰) |
| Firebase | Firestore (무료 Spark 요금제) |

## 개발
```bash
npm install
npm test            # 저장소 계약 테스트 등
npm run typecheck
npm run build:web   # dist/ (GitHub Pages 와 같은 /ai-note 경로)
node scripts/serve-dist.mjs   # http://localhost:4173/ai-note/
```

## 개인정보
실제 가족 데이터(엑셀·카톡 내보내기·카드 내역·백업)는 저장소에 커밋하지 않습니다. 테스트는 `fixtures/`의 가상 데이터만 사용합니다.
