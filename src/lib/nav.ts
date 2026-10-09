import { type Href, router } from 'expo-router';

/**
 * 저장 후 이전 화면으로. 주소로 바로 열었거나 새로고침해서 돌아갈 기록이 없으면 fallback 으로 이동.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
