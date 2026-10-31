// 웹 배포 빌드: expo export → GitHub Pages 보정 → 서비스워커 생성 (구현계획서 3.9, 3.11)
import { execSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';

import { generateSW } from 'workbox-build';

const DIST = 'dist';
const BASE = '/ai-note';

execSync('npx expo export -p web', { stdio: 'inherit' });

// Expo 산출물의 _expo 폴더가 Jekyll 에 무시되지 않도록
writeFileSync(`${DIST}/.nojekyll`, '');
// 없는 경로 새로고침 시 앱으로 (상세 화면은 ?id= 쿼리 방식이라 대부분 정적 경로)
copyFileSync(`${DIST}/index.html`, `${DIST}/404.html`);

// 앱이 열릴 때 최신 배포 버전과 비교 (UpdateChecker) — 캐시하지 않는다
writeFileSync(`${DIST}/version.json`, JSON.stringify({ version: process.env.EXPO_PUBLIC_BUILD_SHA ?? 'dev' }));

// 앱 화면 파일 사전 캐시 → 오프라인 재실행 (Q-16). 데이터 요청(GitHub/Firebase)은 캐시하지 않음.
const { count, size, warnings } = await generateSW({
  globDirectory: DIST,
  // 아이콘 폰트는 실제로 쓰는 MaterialCommunityIcons 만 (나머지 폰트 ~2.7MB 제외).
  // 화면(HTML)은 사전 캐시에 넣지 않는다 — 넣으면 캐시 우선이 되어 배포해도 옛 화면이 먼저 열림 (2026-10-31)
  globPatterns: ['**/*.{js,css,png,ico,json}', '**/MaterialCommunityIcons.*.ttf'],
  globIgnores: ['version.json'],
  swDest: `${DIST}/sw.js`,
  modifyURLPrefix: { '': `${BASE}/` },
  // 화면(HTML)은 네트워크 우선 → 온라인이면 항상 새 버전, 오프라인이면 마지막에 받은 화면.
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      // GitHub Pages 는 HTML 을 10분 캐시하라고 보냄 → 매번 서버에 확인
      options: { cacheName: 'pages', networkTimeoutSeconds: 4, fetchOptions: { cache: 'no-cache' } },
    },
    // 이름에 해시가 붙은 앱 코드 — 사전 캐시에 없는 (새로 배포된·이전) 파일도 한 번 받으면 오프라인에서 열림
    {
      urlPattern: ({ url }) => url.pathname.startsWith(`${BASE}/_expo/static/`),
      handler: 'CacheFirst',
      options: { cacheName: 'static', expiration: { maxEntries: 80 } },
    },
  ],
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
});
warnings.forEach((w) => console.warn(w));
console.log(`서비스워커: 파일 ${count}개, ${(size / 1024 / 1024).toFixed(1)}MB 사전 캐시`);
