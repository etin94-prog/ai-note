import { useEffect, useRef } from 'react';
import { Platform, type View } from 'react-native';

/** Keep desktop keyboard navigation inside an open dialog and restore its trigger. */
export function useDialogFocus(open: boolean) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const previous = document.activeElement as HTMLElement | null;
    // Paper mounts portal children after the parent's effect; resolve the host lazily.
    const controls = () => Array.from((ref.current as unknown as HTMLElement | null)?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
      .filter((el) => el.getAttribute('aria-disabled') !== 'true' && !el.closest('[aria-hidden="true"]') && !el.dataset.testid?.endsWith('-backdrop') && el.getClientRects().length > 0);
    const timer = setTimeout(() => controls()[0]?.focus(), 100);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls();
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0]?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return ref;
}
