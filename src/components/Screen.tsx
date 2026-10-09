import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

/** 화면 공통 여백·최대 폭 (폰 우선, PC 에서도 읽기 좋게) */
export function Screen({ children }: PropsWithChildren) {
  return <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
});
