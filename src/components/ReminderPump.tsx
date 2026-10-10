import { useEffect } from 'react';
import { Platform } from 'react-native';

import { nowLocal } from '@/domain/dates';
import { setDevicePrefs, useReminders } from '@/state/useReminders';

/** 지금 이 브라우저가 휴대폰 알림을 보낼 수 있는지 */
export function osNotifySupported() {
  return Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestOsNotify(): Promise<boolean> {
  if (!osNotifySupported()) return false;
  const r = await Notification.requestPermission();
  return r === 'granted';
}

async function show(title: string, body: string, tag: string) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: '/ai-note/icons/icon-192.png', badge: '/ai-note/icons/icon-192.png' });
    else new Notification(title, { body, tag });
  } catch {
    // 미지원·거부여도 앱 안 알림함은 그대로 (N-26)
  }
}

/**
 * 휴대폰 알림 (N-26): 이 기기에서 버튼으로 권한을 허용했고 앱이 열려 있을 때만.
 * 알림 시각이 15분 넘게 지난 것은 보내지 않는다 (앱을 늦게 연 경우 한꺼번에 울리지 않게).
 */
export function ReminderPump() {
  const { inbox, prefs } = useReminders();
  useEffect(() => {
    if (!prefs.os || !osNotifySupported() || Notification.permission !== 'granted') return;
    const cutoff = nowLocal(new Date(Date.now() - 15 * 60_000));
    const fresh = inbox.filter((i) => !prefs.fired.includes(i.id) && i.at >= cutoff);
    if (fresh.length === 0) return;
    for (const i of fresh.slice(0, 3)) void show(i.title, i.body, i.id);
    setDevicePrefs({ fired: [...prefs.fired, ...fresh.map((i) => i.id)] });
  }, [inbox, prefs]);
  return null;
}
