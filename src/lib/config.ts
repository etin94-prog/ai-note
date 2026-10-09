/** GitHub Pages 하위 경로. app.json experiments.baseUrl 과 같아야 한다. */
export const BASE_URL = '/ai-note';

export const APP_NAME = '우리집 학원 노트';
export const APP_SHORT_NAME = '학원노트';

/** 앱 데이터 형식 버전. 구조가 바뀌면 올리고 변환 함수를 추가한다. */
export const SCHEMA_VERSION = 1;

export const THEME_COLOR = '#2563EB';

/** 배포 커밋 (CI 가 EXPO_PUBLIC_BUILD_SHA 로 주입). 화면에 표시해 폰이 어느 버전인지 확인. */
export const BUILD_VERSION = (process.env.EXPO_PUBLIC_BUILD_SHA ?? 'dev').slice(0, 7);
