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

// 앱 화면 파일 사전 캐시 → 오프라인 재실행 (Q-16). 데이터 요청(GitHub/Firebase)은 캐시하지 않음.
const { count, size, warnings } = await generateSW({
  globDirectory: DIST,
  // 아이콘 폰트는 실제로 쓰는 MaterialCommunityIcons 만 (나머지 폰트 ~2.7MB 제외)
  globPatterns: ['**/*.{html,js,css,png,ico,json}', '**/MaterialCommunityIcons.*.ttf'],
  globIgnores: ['404.html'],
  swDest: `${DIST}/sw.js`,
  modifyURLPrefix: { '': `${BASE}/` },
  navigateFallback: `${BASE}/index.html`,
  navigateFallbackAllowlist: [new RegExp(`^${BASE}/`)],
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
});
warnings.forEach((w) => console.warn(w));
console.log(`서비스워커: 파일 ${count}개, ${(size / 1024 / 1024).toFixed(1)}MB 사전 캐시`);
