import { Linking, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

const LINK_RE = /(https?:\/\/[^\s)]+|0\d{1,2}-\d{3,4}-\d{4})/g;

/** 공지 원문처럼 긴 글: 링크는 열기, 전화번호는 전화 걸기로 누를 수 있게 */
export function LinkedText({ children }: { children: string }) {
  const parts = children.split(LINK_RE);
  return (
    <Text variant="bodyMedium" style={styles.body} selectable>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={styles.link} onPress={() => void Linking.openURL(p.startsWith('http') ? p : `tel:${p.replace(/-/g, '')}`)}>
            {p}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 22 },
  link: { color: '#2563EB', textDecorationLine: 'underline' },
});
