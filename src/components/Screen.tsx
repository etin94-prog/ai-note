import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useLayout } from '@/lib/useLayout';

/**
 * 화면 공통 여백·최대 폭.
 * 폰: 최대 720px 한 줄. PC(wide 화면을 쓰는 화면): 최대 1400px.
 */
export function Screen({ children, wide: allowWide = false }: PropsWithChildren<{ wide?: boolean }>) {
  const { wide } = useLayout();
  return (
    <ScrollView contentContainerStyle={[styles.content, { maxWidth: allowWide && wide ? 1400 : 720 }]}>{children}</ScrollView>
  );
}

/**
 * PC 에서는 여러 단으로 나란히, 폰에서는 위아래로 (X-17).
 * flex: 각 단의 상대 폭 (기본 모두 1)
 */
export function Columns({ children, flex }: { children: ReactNode[]; flex?: number[] }) {
  const { wide } = useLayout();
  if (!wide) return <>{children}</>;
  return (
    <View style={styles.cols}>
      {children.map((c, i) =>
        c ? (
          <View key={i} style={{ flex: flex?.[i] ?? 1, minWidth: 0 }}>
            {c}
          </View>
        ) : null,
      )}
    </View>
  );
}

/**
 * PC: 왼쪽 본문 + 오른쪽 고정 상세 패널 (X-18, X-19). 폰: 본문만 (패널은 화면 이동으로 대신).
 * 패널과 본문은 각자 스크롤된다.
 */
export function SplitView({ main, panel }: { main: ReactNode; panel: ReactNode | null }) {
  const { wide } = useLayout();
  if (!wide) return <>{main}</>;
  return (
    <View style={styles.split}>
      <ScrollView style={styles.splitMain} contentContainerStyle={styles.splitMainContent}>
        {main}
      </ScrollView>
      <View style={styles.panel}>
        <ScrollView contentContainerStyle={styles.panelContent}>{panel}</ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, width: '100%', alignSelf: 'center' },
  cols: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  split: { flex: 1, flexDirection: 'row' },
  splitMain: { flex: 1 },
  splitMainContent: { padding: 16, paddingBottom: 96 },
  panel: { width: 460, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: '#D1D5DB', backgroundColor: '#FAFAFB' },
  panelContent: { padding: 16, paddingBottom: 48 },
});
