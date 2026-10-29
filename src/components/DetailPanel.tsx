import { useEffect, useEffectEvent, useRef, type PropsWithChildren } from 'react';
import { Platform, View } from 'react-native';

import { Button } from './ActionButton';

/** A desktop detail region is keyboard accessible, without trapping navigation in it. */
export function DetailPanel({ children, onClose }: PropsWithChildren<{ onClose: () => void }>) {
  const ref = useRef<View>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const previous = document.activeElement as HTMLElement | null;
    const label = previous?.getAttribute('aria-label');
    const root = ref.current as unknown as HTMLElement | null;
    const timer = setTimeout(() => root?.querySelector<HTMLElement>('[role="button"]')?.focus(), 50);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && root?.getClientRects().length && !document.querySelector('[role="dialog"]')) close();
    };
    document.addEventListener('keydown', escape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', escape);
      requestAnimationFrame(() => {
        const fallback = label ? Array.from(document.querySelectorAll<HTMLElement>('[aria-label]')).find((el) => el.getAttribute('aria-label') === label) : null;
        (previous?.isConnected ? previous : fallback)?.focus();
      });
    };
  }, []);
  return <View ref={ref}>
    <Button icon="close" onPress={onClose}>상세 닫기</Button>
    {children}
  </View>;
}
