import type { PropsWithChildren, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLayout } from '@/lib/useLayout';
import { DETAIL_WIDTH } from '@/lib/responsive';
import { PALETTE } from '@/lib/theme';

/**
 * 화면 공통 여백·최대 폭.
 * 폰: 최대 720px 한 줄. PC(wide 화면을 쓰는 화면): 최대 1400px.
 */
export function Screen({ children, wide: allowWide = false }: PropsWithChildren<{ wide?: boolean }>) {
  const { wide, gutter } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.fill} enabled={Platform.OS !== 'web'} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={64 + insets.top}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: 96 + insets.bottom, maxWidth: allowWide && wide ? 1440 : 760 }]}>{children}</ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * PC 에서는 여러 단으로 나란히, 폰에서는 위아래로 (X-17).
 * flex: 각 단의 상대 폭 (기본 모두 1)
 */
export function Columns({ children, flex }: { children: ReactNode[]; flex?: number[] }) {
  const { tablet, fontScale } = useLayout();
  if (!tablet || fontScale > 1.3) return <>{children}</>;
  return (
    <View style={styles.cols}>
      {children.map((c, i) =>
        c ? (
          <View key={i} style={{ flexGrow: flex?.[i] ?? 1, flexBasis: 320, minWidth: 0 }}>
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
  return (
    <View style={styles.split}>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.splitMain} contentContainerStyle={styles.splitMainContent}>
        {main}
      </ScrollView>
      {panel && <View style={styles.panel}>
        <ScrollView contentContainerStyle={styles.panelContent}>{panel}</ScrollView>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  content: { padding: 16, width: '100%', alignSelf: 'center' },
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' },
  split: { flex: 1, flexDirection: 'row' },
  splitMain: { flex: 1, minWidth: 0 },
  splitMainContent: { padding: 24, paddingBottom: 112 },
  panel: { width: DETAIL_WIDTH, borderLeftWidth: 1, borderColor: PALETTE.line, backgroundColor: PALETTE.card },
  panelContent: { padding: 16, paddingBottom: 48 },
});
