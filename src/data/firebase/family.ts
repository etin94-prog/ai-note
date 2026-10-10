import {
  type Auth,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { collection, deleteDoc, doc, type Firestore, getDoc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';

import { memberById, type MemberId, type Role } from '@/domain/types';

/**
 * Firebase 모드의 로그인·가족 연결 (U-01~U-08, 가이드 7단계).
 *
 * 구조: families/{가족코드}                     — { ownerUid, createdAt }
 *       families/{가족코드}/accountLinks/{uid}  — { memberId, role, email }  ← 이 문서가 있어야 가족 데이터를 볼 수 있음
 *       families/{가족코드}/joinRequests/{uid}  — { email, memberId, requestedAt }  ← 부모가 승인하면 accountLinks 로
 * 누가 무엇을 할 수 있는지는 firestore.rules 가 강제한다 (앱 코드는 편의일 뿐).
 * 비밀번호는 Firebase 가 보관하고 앱·저장소에는 남기지 않는다.
 */

export interface AccountLink {
  memberId: MemberId;
  role: Role;
  email: string;
}

export interface JoinRequest {
  uid: string;
  email: string;
  memberId: MemberId;
  requestedAt: string;
}

/** 가족 코드: 헷갈리는 글자(0·O·1·I·L)를 뺀 8자, 'ABCD-EFGH' */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeFamilyCode(rand: () => number = Math.random): string {
  const pick = () => ALPHABET[Math.floor(rand() * ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `${part()}-${part()}`;
}

/** 입력한 코드 정리: 소문자·공백·빠진 하이픈 허용 */
export function normalizeFamilyCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Firebase 오류 코드 → 사람이 읽는 문장 */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-email': '이메일 주소 형식이 맞지 않습니다.',
    'auth/missing-password': '비밀번호를 입력해 주세요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다. [로그인]을 눌러 주세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않습니다.',
    'auth/user-not-found': '가입되지 않은 이메일입니다.',
    'auth/wrong-password': '비밀번호가 맞지 않습니다.',
    'auth/too-many-requests': '여러 번 틀려 잠시 막혔습니다. 조금 뒤에 다시 시도해 주세요.',
    'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
    'auth/unauthorized-domain': '이 주소가 Firebase 승인된 도메인에 없습니다 (가이드 3-4).',
    'auth/operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인을 켜야 합니다 (가이드 3).',
    'permission-denied': '권한이 없습니다. 가족 코드가 맞는지, 승인됐는지 확인해 주세요.',
  };
  return map[code] ?? (e instanceof Error ? e.message : String(e));
}

export const watchUser = (auth: Auth, cb: (u: User | null) => void) => onAuthStateChanged(auth, cb);
export const logIn = (auth: Auth, email: string, password: string) => signInWithEmailAndPassword(auth, email.trim(), password);
export const signUp = (auth: Auth, email: string, password: string) => createUserWithEmailAndPassword(auth, email.trim(), password);
export const logOut = (auth: Auth) => signOut(auth);
export const resetPassword = (auth: Auth, email: string) => sendPasswordResetEmail(auth, email.trim());

const familyRef = (db: Firestore, fid: string) => doc(db, 'families', fid);
const linkRef = (db: Firestore, fid: string, uid: string) => doc(db, 'families', fid, 'accountLinks', uid);
const requestRef = (db: Firestore, fid: string, uid: string) => doc(db, 'families', fid, 'joinRequests', uid);

/** 새 가족 만들기 — 만든 사람은 부모로 연결된다 (부모 구성원만 고를 수 있음) */
export async function createFamily(db: Firestore, user: { uid: string; email: string | null }, memberId: MemberId): Promise<string> {
  if (memberById(memberId)?.role !== 'parent') throw new Error('가족은 부모(아빠·엄마)가 만들어야 합니다.');
  const fid = makeFamilyCode();
  const batch = writeBatch(db);
  batch.set(familyRef(db, fid), { ownerUid: user.uid, createdAt: new Date().toISOString() });
  batch.set(linkRef(db, fid, user.uid), { memberId, role: 'parent', email: user.email ?? '' } satisfies AccountLink);
  await batch.commit();
  return fid;
}

/** 가족 코드로 참여 요청 (부모 승인 전에는 아무 데이터도 볼 수 없음) */
export async function requestJoin(db: Firestore, fid: string, user: { uid: string; email: string | null }, memberId: MemberId) {
  await setDoc(requestRef(db, fid, user.uid), { email: user.email ?? '', memberId, requestedAt: new Date().toISOString() });
}

export const cancelJoin = (db: Firestore, fid: string, uid: string) => deleteDoc(requestRef(db, fid, uid));

/** 내 연결 상태 실시간 구독: 연결됨 / 승인 대기 / 없음 */
export function watchMyStatus(db: Firestore, fid: string, uid: string, cb: (s: { link: AccountLink | null; pending: boolean; error?: string }) => void) {
  let link: AccountLink | null = null;
  let pending = false;
  const emit = (error?: string) => cb({ link, pending, ...(error ? { error } : {}) });
  const off1 = onSnapshot(
    linkRef(db, fid, uid),
    (s) => {
      link = s.exists() ? (s.data() as AccountLink) : null;
      emit();
    },
    () => {
      link = null;
      emit();
    },
  );
  const off2 = onSnapshot(
    requestRef(db, fid, uid),
    (s) => {
      pending = s.exists();
      emit();
    },
    () => {
      pending = false;
      emit();
    },
  );
  return () => {
    off1();
    off2();
  };
}

/** 부모: 가입 요청·연결된 계정 목록 구독 */
export function watchFamilyAccounts(db: Firestore, fid: string, cb: (s: { requests: JoinRequest[]; links: (AccountLink & { uid: string })[] }) => void) {
  let requests: JoinRequest[] = [];
  let links: (AccountLink & { uid: string })[] = [];
  const emit = () => cb({ requests, links });
  const off1 = onSnapshot(collection(db, 'families', fid, 'joinRequests'), (s) => {
    requests = s.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<JoinRequest, 'uid'>) }));
    emit();
  });
  const off2 = onSnapshot(collection(db, 'families', fid, 'accountLinks'), (s) => {
    links = s.docs.map((d) => ({ uid: d.id, ...(d.data() as AccountLink) }));
    emit();
  });
  return () => {
    off1();
    off2();
  };
}

/** 부모: 요청 승인 — 역할은 구성원에 따라 정해진다 (아빠·엄마 = 부모, 아들·딸 = 자녀) */
export async function approveJoin(db: Firestore, fid: string, req: JoinRequest, memberId: MemberId) {
  const role = memberById(memberId)?.role ?? 'child';
  const batch = writeBatch(db);
  batch.set(linkRef(db, fid, req.uid), { memberId, role, email: req.email } satisfies AccountLink);
  batch.delete(requestRef(db, fid, req.uid));
  await batch.commit();
}

export const rejectJoin = (db: Firestore, fid: string, uid: string) => deleteDoc(requestRef(db, fid, uid));
/** 부모: 연결 끊기 (그 계정은 더 이상 가족 데이터를 볼 수 없음) */
export const removeLink = (db: Firestore, fid: string, uid: string) => deleteDoc(linkRef(db, fid, uid));

export async function familyExists(db: Firestore, fid: string): Promise<boolean> {
  try {
    return (await getDoc(familyRef(db, fid))).exists();
  } catch {
    return false;
  }
}
