import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { FirestoreRepository } from '@/data/firebase/FirestoreRepository';
import { syncChildMirror, type MirrorResult } from '@/data/github/childMirrorSync';
import { FetchGitHubApi } from '@/data/github/GitHubApi';
import { FakeGitHubApi } from '@/data/github/FakeGitHubApi';
import { GitHubRepository } from '@/data/github/GitHubRepository';
import { MemoryRepository } from '@/data/memory/MemoryRepository';
import type { Collection, Repository, WriteContext } from '@/data/repository';
import { MIRROR_REPOS, type MirrorSource } from '@/domain/childMirror';
import { memberById, type MemberId } from '@/domain/types';
import { firebaseConfigFromEnv, getFirebase } from '@/lib/firebase';

import { type AccountLink, watchMyStatus, watchUser } from '@/data/firebase/family';

import { DEFAULT_SETTINGS, type DeviceSettings, loadSettings, saveSettings } from './settings';

/** Firebase 모드 로그인·가족 연결 상태 */
export interface AccountState {
  /** 이 빌드에 Firebase 설정값이 들어 있는지 */
  configured: boolean;
  /** 로그인 확인이 끝났는지 */
  ready: boolean;
  user: { uid: string; email: string | null } | null;
  /** 가족에 연결됨 (부모가 승인함) */
  link: AccountLink | null;
  /** 가입 요청을 보내고 승인 대기 중 */
  pending: boolean;
}

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
  /** Firebase 모드 계정 상태 (다른 모드에서는 configured 만 의미 있음) */
  account: AccountState;
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
const MIRROR_COLLECTIONS: Collection[] = ['academies', 'enrollments', 'events', 'exceptions', 'places', 'holidays', 'reminderPolicies'];

export function buildRepo(s: DeviceSettings): Repository | null {
  if (s.mode === 'demo') {
    // 시험용: 느린 네트워크에서 저장 중 표시가 어떻게 보이는지 확인 (값 = 지연 ms, 새로고침하면 데이터는 사라짐)
    const slow = Number(globalThis.localStorage?.getItem('ai-note.debug-latency') ?? 0);
    if (slow > 0) return new GitHubRepository(new FakeGitHubApi(slow), { optimistic: true });
    return new MemoryRepository(undefined, 'ai-note.demo-data.v1');
  }
  if (s.mode === 'github' && s.github.token) {
    // 저장하면 화면에 먼저 반영하고 GitHub 전송은 뒤에서 (전송 중·실패는 SavingBar 가 알림)
    return new GitHubRepository(new FetchGitHubApi({ owner: s.github.owner, repo: s.github.repo }, s.github.token), { optimistic: true });
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
  // localStorage(외부 저장소)는 hydration 이 끝난 뒤에만 읽을 수 있다
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSettings(loadSettings()), []);
  // ── Firebase 모드: 로그인 + 가족 연결 확인 (연결돼야 데이터 저장소를 연다) ──
  const fbMode = settings.mode === 'firebase';
  const [fbUser, setFbUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [fbReady, setFbReady] = useState(false);
  const [fbStatus, setFbStatus] = useState<{ link: AccountLink | null; pending: boolean }>({ link: null, pending: false });
  useEffect(() => {
    const fb = fbMode ? getFirebase() : null;
    if (!fb) return;
    return watchUser(fb.auth, (u) => {
      setFbUser(u ? { uid: u.uid, email: u.email } : null);
      setFbReady(true);
    });
  }, [fbMode]);
  const familyId = settings.firebase.familyId;
  useEffect(() => {
    const fb = fbMode ? getFirebase() : null;
    if (!fb || !fbUser || !familyId) return;
    const off = watchMyStatus(fb.db, familyId, fbUser.uid, (st) => setFbStatus({ link: st.link, pending: st.pending }));
    return () => {
      off();
      setFbStatus({ link: null, pending: false });
    };
  }, [fbMode, fbUser, familyId]);
  const account: AccountState = useMemo(
    () => ({
      configured: !!firebaseConfigFromEnv(),
      ready: fbReady,
      user: fbMode ? fbUser : null,
      link: fbMode && fbUser && familyId ? fbStatus.link : null,
      pending: fbMode && !!fbUser && !!familyId && fbStatus.pending,
    }),
    [fbMode, fbReady, fbUser, familyId, fbStatus],
  );
  const linked = !!account.link;

  // Firebase 모드는 승인된 계정일 때만 저장소를 연다 (그 전에는 권한이 없어 오류만 난다)
  const repo = useMemo(() => (settings.mode === 'firebase' && !linked ? null : buildRepo(settings)), [settings, linked]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);

  // Firebase 모드에서 "나는 누구" 는 기기 설정이 아니라 부모가 승인한 계정 연결을 따른다
  const linkMember = account.link?.memberId;
  useEffect(() => {
    if (linkMember && settings.memberId !== linkMember) {
      const next = { ...settings, memberId: linkMember };
      saveSettings(next);
      // 승인된 구성원으로 기기 설정을 맞춤 (외부 상태인 계정 연결과 동기화)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings(next);
    }
  }, [linkMember, settings]);
  const isChild = fbMode ? account.link?.role === 'child' : memberById(settings.memberId)?.role === 'child';
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
    // GitHub 원격 저장소와 동기화 (상태는 비동기 응답 후에만 바뀜)
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      const [academies, enrollments, events, exceptions, places, holidays, reminderPolicies] = await Promise.all(
        MIRROR_COLLECTIONS.map((c) => repo.list(c)),
      );
      const src = { academies, enrollments, events, exceptions, places, holidays, reminderPolicies } as unknown as MirrorSource;
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
    () => ({ settings, updateSettings, repo, isChild, readOnly, account, writeContext, refresh, lastSyncAt, syncError, mirror, syncMirrors }),
    [settings, updateSettings, repo, isChild, readOnly, account, writeContext, refresh, lastSyncAt, syncError, mirror, syncMirrors],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRepository() {
  const v = useContext(Ctx);
  if (!v) throw new Error('RepositoryProvider 가 필요합니다');
  return v;
}
