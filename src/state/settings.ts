/**
 * 기기별 설정 (이 기기에만 저장). GitHub 토큰은 화면에 다시 보여주지 않고
 * 백업·내보내기 파일에도 넣지 않는다 (G-08).
 */
/** demo = 체험 모드: 메모리에만 저장, 새로고침하면 사라짐 (화면 확인·시연용) */
export type StorageMode = 'github' | 'firebase' | 'demo';

export interface DeviceSettings {
  mode: StorageMode | null;
  /** 이 기기를 쓰는 가족 구성원 (U-13) */
  memberId: string;
  /** 커밋 메시지에 표시할 기기 이름, 예: "엄마 아이폰" */
  deviceName: string;
  github: { owner: string; repo: string; token: string };
  firebase: { familyId: string };
}

const KEY = 'ai-note.device-settings.v1';

export const DEFAULT_SETTINGS: DeviceSettings = {
  mode: null,
  memberId: '',
  deviceName: '',
  github: { owner: 'etin94-prog', repo: 'ai-note-data', token: '' },
  firebase: { familyId: '' },
};

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(): DeviceSettings {
  const raw = storage()?.getItem(KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const s = JSON.parse(raw) as Partial<DeviceSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      github: { ...DEFAULT_SETTINGS.github, ...s.github },
      firebase: { ...DEFAULT_SETTINGS.firebase, ...s.firebase },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: DeviceSettings) {
  storage()?.setItem(KEY, JSON.stringify(s));
}
