import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { FirestoreRepository } from '@/data/firebase/FirestoreRepository';
import { syncChildMirror, type MirrorResult } from '@/data/github/childMirrorSync';
import { FetchGitHubApi } from '@/data/github/GitHubApi';
import { GitHubRepository } from '@/data/github/GitHubRepository';
import { MemoryRepository } from '@/data/memory/MemoryRepository';
import type { Collection, Repository, WriteContext } from '@/data/repository';
import { MIRROR_REPOS, type MirrorSource } from '@/domain/childMirror';
import { memberById, type MemberId } from '@/domain/types';
import { getFirebase } from '@/lib/firebase';

import { DEFAULT_SETTINGS, type DeviceSettings, loadSettings, saveSettings } from './settings';

export interface MirrorStatus {
  at: string;
  results: MirrorResult[];
}

interface RepositoryState {
  settings: DeviceSettings;
  updateSettings: (s: DeviceSettings) => void;
  repo: Repository | null;
  /** 이 기기 사용자가 자녀이면 true (자녀 화면: 비용·입력 숨김) */
  isChild: boolean;
  /** 쓰기 불가 (GitHub 모드 자녀 기기 = 읽기 전용 사본, G-04) */
  readOnly: boolean;
  /** 현재 기기 사용자 기준 쓰기 정보 */
  writeContext: (label: string) => WriteContext;
  /** GitHub 모드: 지금 바로 최신 가져오기 */
  refresh: () => Promise<void>;
  lastSyncAt: string | null;
  syncError: string | null;
  /** GitHub 모드 부모 기기: 자녀 사본 갱신 상태 */
  mirror: MirrorStatus | null;
  syncMirrors: () => Promise<void>;
}

const Ctx = createContext<RepositoryState | null>(null);

/** GitHub 모드 주기 확인 간격 (Requirement 1.5.1: 열려 있는 동안 1분마다) */
const POLL_MS = 60_000;
/** 데이터가 바뀐 뒤 자녀 사본을 맞추기까지 대기 (연속 입력을 한 번에) */
const MIRROR_DEBOUNCE_MS = 5_000;
const MIRROR_COLLECTIONS: Collection[] = ['academies', 'enrollments', 'events', 'exceptions', 'places', 'holidays'];

function buildRepo(s: DeviceSettings): Repository | null {
  if (s.mode === 'demo') return new MemoryRepository(undefined, 'ai-note.demo-data.v1');
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
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);

  const isChild = memberById(settings.memberId)?.role === 'child';
  const readOnly = isChild && settings.mode === 'github';
  const isParentGitHub = settings.mode === 'github' && !isChild && repo instanceof GitHubRepository;

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

  // ── 자녀 사본 (D-14): 부모 GitHub 기기에서만 ──
  const mirrorRunning = useRef(false);
  const syncMirrors = useCallback(async () => {
    if (!isParentGitHub || !repo || mirrorRunning.current) return;
    mirrorRunning.current = true;
    try {
      // list() 는 전체 데이터를 다 불러온 뒤 돌려준다 → 덜 불러온 상태로 사본을 지우는 일 방지
      const [academies, enrollments, events, exceptions, places, holidays] = await Promise.all(
        MIRROR_COLLECTIONS.map((c) => repo.list(c)),
      );
      const src = { academies, enrollments, events, exceptions, places, holidays } as unknown as MirrorSource;
      const results: MirrorResult[] = [];
      for (const [child, repoName] of Object.entries(MIRROR_REPOS) as [MemberId, string][]) {
        try {
          const api = new FetchGitHubApi({ owner: settings.github.owner, repo: repoName }, settings.github.token);
          results.push(
            await syncChildMirror(api, child, src, `[${settings.deviceName || '부모 기기'}] ${memberById(child)?.name} 사본 갱신`),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ child, changed: 0, error: msg.includes('404') ? `${repoName} 저장소 접근 권한 없음` : msg });
        }
      }
      setMirror({ at: new Date().toISOString(), results });
    } finally {
      mirrorRunning.current = false;
    }
  }, [isParentGitHub, repo, settings.github.owner, settings.github.token, settings.deviceName]);

  useEffect(() => {
    if (!isParentGitHub || !repo || !lastSyncAt) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncMirrors(), MIRROR_DEBOUNCE_MS);
    };
    const offs = MIRROR_COLLECTIONS.map((c) => repo.watch(c, schedule));
    return () => {
      offs.forEach((off) => off());
      if (timer) clearTimeout(timer);
    };
    // lastSyncAt 이 처음 생긴 뒤(첫 동기화 완료 후)에만 연결
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParentGitHub, repo, !!lastSyncAt, syncMirrors]);

  const value = useMemo(
    () => ({ settings, updateSettings, repo, isChild, readOnly, writeContext, refresh, lastSyncAt, syncError, mirror, syncMirrors }),
    [settings, updateSettings, repo, isChild, readOnly, writeContext, refresh, lastSyncAt, syncError, mirror, syncMirrors],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRepository() {
  const v = useContext(Ctx);
  if (!v) throw new Error('RepositoryProvider 가 필요합니다');
  return v;
}
