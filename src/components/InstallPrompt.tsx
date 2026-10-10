import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const noSubscribe = () => () => {};

const DISMISS_KEY = 'ai-note.install-dismissed-at';
const DISMISS_DAYS = 14;
function dismissedRecently(): boolean {
  try {
    const at = Number(globalThis.localStorage?.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * 홈 화면 설치 안내 (D-10, X-12, Q-14).
 * Android 크롬: [앱 설치] 버튼, iPhone 사파리: 공유 → 홈 화면에 추가 안내. 설치 후에는 숨김.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // 정적 HTML 과 첫 화면이 같도록 처음엔 숨기고(서버 값), 브라우저에서 확인 후 표시 (hydration 일치)
  const standalone = useSyncExternalStore(noSubscribe, isStandalone, () => true);
  const ios = useSyncExternalStore(noSubscribe, isIOS, () => false);
  const [appInstalled, setAppInstalled] = useState(false);
  // "나중에" 를 누르면 14일 동안 숨김 (디자인 점검: 홈 맨 위를 계속 차지하던 것)
  const dismissedAtLoad = useSyncExternalStore(noSubscribe, dismissedRecently, () => true);
  const [dismissed, setDismissed] = useState(false);
  const installed = standalone || appInstalled || dismissed || dismissedAtLoad;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setAppInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <Card style={styles.card} mode="outlined">
      <Card.Title title="홈 화면에 앱 아이콘 만들기" titleVariant="titleMedium" />
      <Card.Content>
        {ios ? (
          <Text variant="bodyMedium">
            사파리 아래쪽 <Text style={styles.bold}>공유 버튼(□↑)</Text> → <Text style={styles.bold}>홈 화면에 추가</Text> → 추가.{'\n'}
            처음 로그인하기 전에 설치해 주세요. 사파리와 홈 화면 앱은 저장 공간이 따로입니다.
          </Text>
        ) : deferred ? (
          <Text variant="bodyMedium">아래 버튼을 누르면 앱처럼 아이콘이 생기고 주소창 없이 열립니다.</Text>
        ) : (
          <Text variant="bodyMedium">
            크롬 오른쪽 위 메뉴(⋮) → <Text style={styles.bold}>앱 설치</Text> 또는 <Text style={styles.bold}>홈 화면에 추가</Text>
          </Text>
        )}
      </Card.Content>
      <Card.Actions>
        <Button
          onPress={() => {
            try {
              globalThis.localStorage?.setItem(DISMISS_KEY, String(Date.now()));
            } catch {
              // 저장 못 해도 이번에는 숨김
            }
            setDismissed(true);
          }}>
          나중에
        </Button>
        {deferred && (
          <>
            <Button
              mode="contained"
              icon="download"
              onPress={async () => {
                await deferred.prompt();
                const { outcome } = await deferred.userChoice;
                if (outcome === 'accepted') setAppInstalled(true);
                setDeferred(null);
              }}>
              앱 설치
            </Button>
          </>
        )}
      </Card.Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  bold: { fontWeight: '700' },
});
