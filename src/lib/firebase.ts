import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { type Firestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

/**
 * Firebase 웹 설정값 — 공개돼도 되는 값 (보안은 firestore.rules 가 담당).
 * 빌드 시 EXPO_PUBLIC_FIREBASE_* 환경변수로 주입한다. (가이드: docs/guide/Firebase_설정가이드.md 2단계)
 */
export function firebaseConfigFromEnv(): FirebaseOptions | null {
  const cfg: FirebaseOptions = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };
  return cfg.apiKey && cfg.projectId ? cfg : null;
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

/** 설정이 없으면 null — 앱은 GitHub 모드만 제공한다. */
export function getFirebase() {
  const cfg = firebaseConfigFromEnv();
  if (!cfg) return null;
  if (!app) {
    app = getApps()[0] ?? initializeApp(cfg);
    // 오프라인 조회·입력 (X-09). 여러 탭에서 열어도 캐시 공유.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { app, db: db!, auth: getAuth(app) };
}
