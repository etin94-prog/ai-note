import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { FirestoreRepository } from '@/data/firebase/FirestoreRepository';
import { FetchGitHubApi } from '@/data/github/GitHubApi';
import { GitHubRepository } from '@/data/github/GitHubRepository';
import type { Repository, WriteContext } from '@/data/repository';
import { getFirebase } from '@/lib/firebase';

import { DEFAULT_SETTINGS, type DeviceSettings, loadSettings, saveSettings } from './settings';

interface RepositoryState {
  settings: DeviceSettings;
  updateSettings: (s: DeviceSettings) => void;
  repo: Repository | null;
  /** 현재 기기 사용자 기준 쓰기 정보 */
  writeContext: (label: string) => WriteContext;
  /** GitHub 모드: 지금 바로 최신 가져오기 */
  refresh: () => Promise<void>;
  lastSyncAt: string | null;
  syncError: string | null;
}

const Ctx = createContext<RepositoryState | null>(null);

/** GitHub 모드 주기 확인 간격 (Requirement 1.5.1: 열려 있는 동안 1분마다) */
const POLL_MS = 60_000;

function buildRepo(s: DeviceSettings): Repository | null {
  if (s.mode === 'github' && s.github.token) {
    return new GitHubRepository(new FetchGitHubApi({ owner: s.github.owner, repo: s.github.repo }, s.github.token));
  }
  if (s.mode === 'firebase' && s.firebase.familyId) {
    const fb = getFirebase();
    return fb ? new FirestoreRepository(fb.db, s.firebase.familyId) : null;
  }
  return null;
}

export function RepositoryProvider({ children }: PropsWithChildren) {
  // 정적 HTML 과 첫 화면을 맞추기 위해 기본값으로 시작하고, 브라우저에서 저장된 설정을 읽는다.
  const [settings, setSettings] = useState<DeviceSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(loadSettings()), []);
  const repo = useMemo(() => buildRepo(settings), [settings]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const updateSettings = useCallback((s: DeviceSettings) => {
    saveSettings(s);
    setSettings(s);
  }, []);

  const refresh = useCallback(async () => {
    if (!(repo instanceof GitHubRepository)) return;
    try {
      await repo.sync();
      setLastSyncAt(new Date().toISOString());
      setSyncError(null);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  }, [repo]);

  // GitHub 모드: 앱 열 때 + 화면 복귀 + 1분마다
  useEffect(() => {
    if (!(repo instanceof GitHubRepository)) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [repo, refresh]);

  const writeContext = useCallback(
    (label: string): WriteContext => ({ by: settings.memberId || 'unknown', label, device: settings.deviceName || undefined }),
    [settings.memberId, settings.deviceName],
  );

  const value = useMemo(
    () => ({ settings, updateSettings, repo, writeContext, refresh, lastSyncAt, syncError }),
    [settings, updateSettings, repo, writeContext, refresh, lastSyncAt, syncError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRepository() {
  const v = useContext(Ctx);
  if (!v) throw new Error('RepositoryProvider 가 필요합니다');
  return v;
}
