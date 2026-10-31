import { useEffect } from 'react';
import { Platform } from 'react-native';

import { BASE_URL, BUILD_VERSION } from '@/lib/config';
import { useRepository } from '@/state/RepositoryContext';

/** 한 번 새로고침한 대상 버전 — 새로고침해도 여전히 옛 화면이면 다시 하지 않는다 (무한 새로고침 방지) */
const TRIED_KEY = 'ai-note.update-tried.v1';

/** 배포된 최신 버전 (빌드가 dist/version.json 에 기록) */
async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: string }).version;
    return v ? v.slice(0, 7) : null;
  } catch {
    return null;
  }
}

/**
 * 앱을 열 때·다시 볼 때 새 버전이 배포됐으면 저절로 새로고침해 바로 새 화면으로 (기기마다 손댈 것 없음).
 * 보내는 중인 저장이 있으면 다 보낸 뒤에 새로고침한다.
 */
export function UpdateChecker() {
  const { repo } = useRepository();
  useEffect(() => {
    if (Platform.OS !== 'web' || BUILD_VERSION === 'dev' || typeof document === 'undefined') return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const latest = await latestVersion();
        if (!latest || latest === BUILD_VERSION) return;
        let tried: string | null = null;
        try {
          tried = sessionStorage.getItem(TRIED_KEY);
          sessionStorage.setItem(TRIED_KEY, latest);
        } catch {
          // 저장 못 하면 그냥 한 번 새로고침
        }
        if (tried === latest) return;
        await repo?.flush(15_000);
        location.reload();
      } finally {
        busy = false;
      }
    };
    void check();
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [repo]);
  return null;
}
