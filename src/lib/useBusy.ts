import { useCallback, useRef, useState } from 'react';

/**
 * 저장 버튼용: 누르는 즉시 진행 표시를 켜고, 끝날 때까지 다시 눌리지 않게 한다.
 * 사용: const [busy, run] = useBusy();  <Button loading={busy} disabled={busy} onPress={() => run(save)} />
 */
export function useBusy(): [boolean, (fn: () => unknown | Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback((fn: () => unknown | Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    void Promise.resolve()
      .then(fn)
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }, []);
  return [busy, run];
}
