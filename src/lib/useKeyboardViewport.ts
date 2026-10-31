import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Mobile Safari's keyboard changes the visual viewport without resizing the layout viewport. */
export function useKeyboardViewport() {
  useEffect(() => {
    if (Platform.OS !== 'web' || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => {
      // Pinch zoom must keep its normal scrolling behavior.
      if (viewport.scale === 1) document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
      else document.documentElement.style.removeProperty('--app-height');
    };
    update();
    viewport.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
}
