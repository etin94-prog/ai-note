import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, SegmentedButtons, Snackbar, Text, TextInput } from 'react-native-paper';

import { ImportPreview } from '@/components/ImportPreview';
import { Screen } from '@/components/Screen';
import { today } from '@/domain/dates';
import { parseKakaoExport, parseMessage, parsePasted, type ParsedItem } from '@/domain/kakao';
import { useRepository } from '@/state/RepositoryContext';

/** 브라우저에서 .txt 여러 개 선택 (파일은 서버로 보내지 않고 이 기기에서만 읽음, X-29) */
function pickTextFiles(): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') return resolve([]);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    input.click();
  });
}

/**
 * 입력 (I-04, X-20): 학원 카톡 대화 파일 가져오기 / 알림톡·문자 붙여넣기.
 * 채팅 입력·엑셀은 다음 단계 (Sprint 3-2, 3-3).
 */
export default function InputScreen() {
  const { repo, isChild } = useRepository();
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [snack, setSnack] = useState<{ text: string; undo?: () => void } | null>(null);

  if (isChild) return <Screen><Text>부모만 사용할 수 있습니다.</Text></Screen>;
  if (!repo) return <Screen><Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text></Screen>;

  const parsePaste = () => setItems(parsePasted(text, today()));
  const loadFiles = async () => {
    const picked = await pickTextFiles();
    if (picked.length === 0) return;
    const all = picked.flatMap((f) => parseKakaoExport(f.text).map((m) => parseMessage(m)).filter((x): x is ParsedItem => !!x));
    // 같은 파일을 두 번 고른 경우 등 — 지문으로 중복 제거
    const unique = [...new Map(all.map((i) => [i.fingerprint, i])).values()];
    setFiles(picked.map((f) => f.name));
    setItems(unique);
  };

  return (
    <View style={styles.fill}>
      <Screen wide>
        <SegmentedButtons
          value={mode}
          onValueChange={(v) => {
            setMode(v as 'paste' | 'file');
            setItems(null);
          }}
          buttons={[
            { value: 'paste', label: '메시지 붙여넣기', icon: 'content-paste' },
            { value: 'file', label: '카톡 대화 파일', icon: 'file-document-multiple-outline' },
          ]}
        />

        {mode === 'paste' ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.gap}>
              <Text variant="bodyMedium">학원 카톡·문자 결제 안내를 길게 눌러 복사한 뒤 붙여넣으세요. 여러 개를 한꺼번에 붙여도 됩니다.</Text>
              <TextInput
                mode="outlined"
                multiline
                numberOfLines={8}
                placeholder={'예)\n《OO학원》 결제 안내\n◆ 학생명 : 홍길동\n◆ 청구 총액 : 360,000 원'}
                value={text}
                onChangeText={setText}
                style={styles.paste}
              />
              <View style={styles.row}>
                <Button onPress={() => { setText(''); setItems(null); }}>지우기</Button>
                <Button mode="contained" icon="text-search" disabled={!text.trim()} onPress={parsePaste}>
                  해석하기
                </Button>
              </View>
              {items && items.length === 0 && <HelperText type="error">결제 안내로 보이는 내용을 찾지 못했습니다.</HelperText>}
            </Card.Content>
          </Card>
        ) : (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.gap}>
              <Text variant="bodyMedium">
                카톡에서 학원 채널 대화방 → 메뉴(≡) → 설정 → <Text style={styles.bold}>대화 내용 내보내기(텍스트)</Text>로 저장한 .txt 파일을 고르세요. 여러 채널 파일을 한 번에 골라도 됩니다.
              </Text>
              <Text variant="bodySmall" style={styles.dim}>
                파일은 이 기기 안에서만 읽고, 원문은 저장하지 않습니다. 청구·납부 정보만 가족 데이터에 저장됩니다. PC 사용을 권장합니다.
              </Text>
              <Button mode="contained" icon="folder-open-outline" onPress={() => void loadFiles()} style={styles.start}>
                파일 선택
              </Button>
              {files.length > 0 && (
                <Text variant="bodySmall">
                  {files.length}개 파일 · 결제 안내 {items?.length ?? 0}건 찾음
                </Text>
              )}
            </Card.Content>
          </Card>
        )}

        {items && items.length > 0 && (
          <ImportPreview
            key={`${mode}-${items.length}-${items[0]?.fingerprint}`}
            items={items}
            onDone={(msg, undo) => {
              setSnack({ text: msg, undo });
              if (undo) setItems(null);
            }}
          />
        )}
        <View style={{ height: 40 }} />
      </Screen>
      <Snackbar
        visible={!!snack}
        onDismiss={() => setSnack(null)}
        duration={snack?.undo ? 8000 : 4000}
        action={snack?.undo ? { label: '되돌리기', onPress: () => snack.undo?.() } : undefined}>
        {snack?.text}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { marginVertical: 12 },
  gap: { gap: 8 },
  paste: { minHeight: 160 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.7 },
  start: { alignSelf: 'flex-start' },
});
