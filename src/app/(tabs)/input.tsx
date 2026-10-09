import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, SegmentedButtons, Snackbar, Text, TextInput } from 'react-native-paper';

import { CardImport } from '@/components/CardImport';
import { GuidedChat } from '@/components/GuidedChat';
import { ImportPreview } from '@/components/ImportPreview';
import { Screen } from '@/components/Screen';
import { type CardTxn, decodeText, parseCardSms, parseCardTable, parseCsv } from '@/domain/card';
import { today } from '@/domain/dates';
import { parseKakaoExport, parseMessage, parsePasted, type ParsedItem } from '@/domain/kakao';
import { readWorkbook } from '@/io/excel/workbook';
import { pickFiles, XLSX_MIME } from '@/lib/files';
import { useRepository } from '@/state/RepositoryContext';

type Mode = 'chat' | 'paste' | 'file' | 'card';

async function pickTextFiles() {
  const files = await pickFiles({ accept: '.txt,text/plain', multiple: true });
  return Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
}

/** 카드사 이용내역 파일 (.xlsx / .csv) → 거래 (C-01) */
async function readCardFiles(files: File[]): Promise<{ txns: CardTxn[]; notes: string[] }> {
  const txns: CardTxn[] = [];
  const notes: string[] = [];
  for (const f of files) {
    const t = today();
    if (/\.xls$/i.test(f.name)) {
      notes.push(`${f.name}: 옛 엑셀 형식(.xls)은 읽을 수 없습니다. 엑셀에서 .xlsx 또는 CSV로 다시 저장해 주세요.`);
      continue;
    }
    let found = 0;
    if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
      const p = parseCardTable(parseCsv(decodeText(await f.arrayBuffer())), t);
      if (p) {
        txns.push(...p.txns);
        found = p.txns.length;
      }
    } else {
      const { tables } = await readWorkbook(await f.arrayBuffer());
      for (const tb of tables) {
        const p = parseCardTable([tb.headers, ...tb.rows], t, '');
        if (p) {
          txns.push(...p.txns);
          found += p.txns.length;
        }
      }
    }
    notes.push(found ? `${f.name}: 거래 ${found}건` : `${f.name}: 이용일·가맹점·금액 열을 찾지 못했습니다`);
  }
  return { txns: [...new Map(txns.map((x) => [x.fingerprint, x])).values()], notes };
}

/**
 * 입력 (X-01): 안내형 채팅 (I-21) / 알림톡·문자·카드 승인 문자 붙여넣기 (I-04, C-02) /
 * 학원 카톡 대화 파일 (X-20) / 카드 이용내역 파일 (C-01). 엑셀 동기화는 더보기.
 * 안드로이드 공유하기로 들어오면(X-30) 붙여넣기에 내용을 채워 바로 해석한다.
 */
export default function InputScreen() {
  const { repo, isChild } = useRepository();
  const shared = useLocalSearchParams<{ title?: string; text?: string; url?: string }>();
  const sharedText = [shared.title, shared.text, shared.url].filter((x) => typeof x === 'string' && x.trim()).join('\n');
  const [mode, setMode] = useState<Mode>(sharedText ? 'paste' : 'chat');
  const [text, setText] = useState(sharedText);
  const [items, setItems] = useState<ParsedItem[] | null>(() => (sharedText ? parsePasted(sharedText, today()) : null));
  const [card, setCard] = useState<CardTxn[] | null>(() => (sharedText ? parseCardSms(sharedText, today()) : null));
  const [files, setFiles] = useState<string[]>([]);
  const [snack, setSnack] = useState<{ text: string; undo?: () => void } | null>(null);

  if (isChild)
    return (
      <Screen>
        <Text>부모만 사용할 수 있습니다.</Text>
      </Screen>
    );
  if (!repo)
    return (
      <Screen>
        <Text>더보기 → 저장 모드 연결 후 사용할 수 있습니다.</Text>
      </Screen>
    );

  const parsePaste = () => {
    setItems(parsePasted(text, today()));
    setCard(parseCardSms(text, today()));
  };
  const loadFiles = async () => {
    const picked = await pickTextFiles();
    if (picked.length === 0) return;
    const all = picked.flatMap((f) => parseKakaoExport(f.text).map((m) => parseMessage(m)).filter((x): x is ParsedItem => !!x));
    // 같은 파일을 두 번 고른 경우 등 — 지문으로 중복 제거
    const unique = [...new Map(all.map((i) => [i.fingerprint, i])).values()];
    setFiles(picked.map((f) => f.name));
    setItems(unique);
  };
  const loadCardFiles = async () => {
    const picked = await pickFiles({ accept: `.xlsx,.xls,.csv,text/csv,${XLSX_MIME}`, multiple: true });
    if (picked.length === 0) return;
    const r = await readCardFiles(picked);
    setFiles(r.notes);
    setCard(r.txns);
  };
  const done = (msg: string, undo?: () => void) => {
    setSnack({ text: msg, undo });
    if (undo) {
      setItems(null);
      setCard(null);
    }
  };

  const tabs = (
    <SegmentedButtons
      value={mode}
      onValueChange={(v) => {
        setMode(v as Mode);
        setItems(null);
        setCard(null);
        setFiles([]);
      }}
      buttons={[
        { value: 'chat', label: '채팅' },
        { value: 'paste', label: '붙여넣기' },
        { value: 'file', label: '카톡' },
        { value: 'card', label: '카드' },
      ]}
    />
  );

  if (mode === 'chat')
    return (
      <View style={styles.chat}>
        {tabs}
        <GuidedChat />
      </View>
    );

  const nothing = mode === 'paste' && items?.length === 0 && card?.length === 0;

  return (
    <View style={styles.fill}>
      <Screen wide>
        {tabs}

        {mode === 'paste' && (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.gap}>
              <Text variant="bodyMedium">
                학원 카톡·문자 결제 안내나 카드 승인 문자를 길게 눌러 복사한 뒤 붙여넣으세요. 여러 개를 한꺼번에 붙여도 됩니다. 안드로이드는 메시지 [공유] → 학원노트로 보내도 됩니다.
              </Text>
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
                <Button
                  onPress={() => {
                    setText('');
                    setItems(null);
                    setCard(null);
                  }}>
                  지우기
                </Button>
                <Button mode="contained" icon="text-search" disabled={!text.trim()} onPress={parsePaste}>
                  해석하기
                </Button>
              </View>
              {nothing && <HelperText type="error">결제 안내나 카드 승인 문자로 보이는 내용을 찾지 못했습니다.</HelperText>}
            </Card.Content>
          </Card>
        )}

        {mode === 'file' && (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.gap}>
              <Text variant="bodyMedium">
                카톡에서 학원 채널 대화방 → 메뉴(≡) → 설정 → <Text style={styles.bold}>대화 내용 내보내기(텍스트)</Text>로 저장한 .txt 파일을 고르세요. 여러 채널 파일을
                한 번에 골라도 됩니다.
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

        {mode === 'card' && (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.gap}>
              <Text variant="bodyMedium">
                카드사 홈페이지·앱에서 <Text style={styles.bold}>이용내역</Text>을 엑셀(.xlsx) 또는 CSV로 내려받아 고르세요. 학원 결제만 골라 청구와 짝지어 납부로 기록합니다.
              </Text>
              <Text variant="bodySmall" style={styles.dim}>
                파일은 이 기기 안에서만 읽습니다. 학원이 아닌 거래는 저장하지 않습니다. 카드 비밀번호·로그인 정보는 필요 없습니다.
              </Text>
              <Button mode="contained" icon="credit-card-search-outline" onPress={() => void loadCardFiles()} style={styles.start}>
                이용내역 파일 선택
              </Button>
              {files.map((n) => (
                <Text key={n} variant="bodySmall">
                  {n}
                </Text>
              ))}
            </Card.Content>
          </Card>
        )}

        {items && items.length > 0 && <ImportPreview key={`${mode}-${items.length}-${items[0]?.fingerprint}`} items={items} onDone={done} />}
        {card && card.length > 0 && <CardImport key={`card-${card.length}-${card[0]?.fingerprint}`} txns={card} onDone={done} />}
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
  chat: { flex: 1, padding: 16, gap: 8, width: '100%', maxWidth: 820, alignSelf: 'center' },
  card: { marginVertical: 12 },
  gap: { gap: 8 },
  paste: { minHeight: 160 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  bold: { fontWeight: '700' },
  dim: { opacity: 0.7 },
  start: { alignSelf: 'flex-start' },
});
