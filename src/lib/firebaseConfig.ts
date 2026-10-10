import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase 웹 앱 설정값 (가이드 2단계에서 콘솔이 보여 주는 firebaseConfig).
 * 공개돼도 되는 값이다 — 누가 무엇을 읽고 쓸 수 있는지는 firestore.rules 가 정하고,
 * API 키는 콘솔에서 우리 사이트 주소로만 쓰게 제한한다 (가이드 6단계).
 * 아직 프로젝트를 만들기 전이면 null.
 */
export const FIREBASE_WEB_CONFIG: FirebaseOptions | null = null;
