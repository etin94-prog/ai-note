import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Text, TextInput, useTheme } from 'react-native-paper';
import { ulid } from 'ulid';

import { appendLog, clearLog, loadLog, type LogLine } from '@/chat/history';
import {
  absorb,
  answer,
  type BillCand,
  buildOps,
  type ChatCtx,
  type ChatKind,
  type ChatState,
  initialState,
  KIND_LABELS,
  nextStep,
  reopen,
  SKIP_VALUE,
  type Step,
} from '@/chat/guided';
import { CardImport } from '@/components/CardImport';
import { ImportPreview } from '@/components/ImportPreview';
import { type CardTxn, parseCardSms } from '@/domain/card';
import { today } from '@/domain/dates';
import { parsePasted, type ParsedItem } from '@/domain/kakao';
import type { Alias } from '@/domain/kakaoImport';
import type { PayMethod } from '@/domain/money';
import { type Academy, memberById, type MemberId, type Place } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { useCollection } from '@/state/useCollection';
import { useMoney } from '@/state/useMoney';

const KINDS: { kind: ChatKind; icon: string }[] = [
  { kind: 'event', icon: 'calendar-plus' },
  { kind: 'enrollment', icon: 'school-outline' },
  { kind: 'payment', icon: 'cash-check' },
  { kind: 'refund', icon: 'cash-refund' },
  { kind: 'expense', icon: 'receipt-text-outline' },
];

const HELLO =
  '무엇을 입력할까요? 아래에서 고르거나 한 문장으로 써 주세요.\n예) 딸 반 모임 토요일 3시 / 아들 코딩학원 화목 5시~7시 25만 / 딸 영어 10월분 냈어 / 교재비 15000원';

function lastMethod(): PayMethod {
  try {
    return (JSON.parse(globalThis.localStorage?.getItem('ai-note.last-pay-method.v1') ?? '{}').method as PayMethod) ?? 'card';
  } catch {
    return 'card';
  }
}

interface Msg {
  id: string;
  role: 'bot' | 'me';
  text: string;
  old?: boolean;
  undo?: () => void;
}

/** 안내형 채팅 (I-21~I-24). 저장 전 반드시 확인 카드 (I-23). */
export function GuidedChat() {
  const theme = useTheme();
  const { repo, writeContext, settings } = useRepository();
  const academies = useCollection<Academy>('academies');
  const aliases = useCollection<Alias>('aliases');
  const places = useCollection<Place>('places');
  const money = useMoney();

  const ctx: ChatCtx = useMemo(() => {
    const acName = (id: string) => academies.docs.find((a) => a.id === id)?.name;
    const bills: BillCand[] = money.rows
      .filter((r) => !r.bill.cancelled)
      .map((r) => ({
        id: r.id,
        label: `${r.bill.childId === 'common' ? '공통' : (memberById(r.bill.childId)?.name ?? '')} ${acName(r.bill.academyId) ?? r.bill.title} ${Number(r.bill.period.slice(5))}월분${r.state.remaining > 0 ? ` · 남은 ${r.state.remaining.toLocaleString('ko-KR')}원` : ' · 납부완료'}`,
        childId: r.bill.childId,
        academyId: r.bill.academyId,
        period: r.bill.period,
        remaining: r.state.remaining,
        due: r.state.due,
        paid: r.state.paid,
      }));
    return {
      today: today(),
      me: (settings.memberId || 'mom') as MemberId,
      academies: academies.docs.filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name, subject: a.subject })),
      aliases: aliases.docs,
      places: places.docs.map((p) => p.name),
      categories: [...new Set(money.expenses.map((e) => e.category))],
      bills,
      lastMethod: lastMethod(),
    };
  }, [academies.docs, aliases.docs, places.docs, money.rows, money.expenses, settings.memberId]);

  const [msgs, setMsgs] = useState<Msg[]>(() => [
    ...loadLog()
      .slice(-20)
      .map((l, i) => ({
        id: `old${i}`,
        role: l.role,
        text: l.text,
        old: true,
      })),
    { id: 'hello', role: 'bot' as const, text: HELLO },
  ]);
  const [state, setState] = useState<ChatState>(initialState());
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [paste, setPaste] = useState<ParsedItem[] | null>(null);
  const [cardTx, setCardTx] = useState<CardTxn[] | null>(null);
  const [saving, setSaving] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const { step } = nextStep(state, ctx);

  const say = (role: Msg['role'], t: string, extra: Partial<Msg> = {}) => {
    const line: LogLine = { at: new Date().toISOString(), role, text: t };
    appendLog(line);
    setMsgs((m) => [...m, { id: ulid(), role, text: t, ...extra }]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };
  /** 다음 질문을 말한다 */
  const advance = (s: ChatState) => {
    const r = nextStep(s, ctx);
    setState(r.state);
    if (r.step.type === 'ask') say('bot', r.step.question);
    else if (r.step.type === 'confirm') say('bot', '이렇게 저장할까요? 고칠 항목은 눌러 주세요.');
  };

  const pickKind = (kind: ChatKind) => {
    setError('');
    setPaste(null);
    setCardTx(null);
    say('me', KIND_LABELS[kind]);
    advance(absorb({ ...initialState(), kind }, '', ctx));
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setError('');
    say('me', t);
    // 알림톡·문자 붙여넣기 (I-04)
    if (!state.kind) {
      const items = parsePasted(t, today());
      if (items.length) {
        setPaste(items);
        say('bot', `결제 안내 ${items.length}건을 찾았어요. 아래에서 확인하고 가져오세요.`);
        return;
      }
      const txns = parseCardSms(t, today());
      if (txns.length) {
        setCardTx(txns);
        say('bot', `카드 승인 문자 ${txns.length}건을 찾았어요. 아래에서 청구와 짝지어 납부로 기록하세요.`);
        return;
      }
      advance(absorb(initialState(), t, ctx, { firstMessage: true }));
      return;
    }
    if (step.type === 'ask') {
      const r = answer(state, step.key, { text: t }, ctx);
      if (r.error) {
        setError(r.error);
        say('bot', r.error);
        return;
      }
      advance(r.state);
      return;
    }
    // 확인 단계에서 더 쓴 말 → 빈 칸만 채우고 메모로
    advance(absorb(state, t, ctx));
  };

  const choose = (label: string, value: unknown) => {
    if (step.type !== 'ask') return;
    setError('');
    say('me', label);
    const r = answer(state, step.key, { value }, ctx);
    advance(r.state);
  };

  const restart = (msg = '처음부터 다시 할게요.') => {
    setState(initialState());
    setPaste(null);
    setCardTx(null);
    setError('');
    say('bot', msg);
  };

  const save = async () => {
    if (!repo || saving) return;
    setSaving(true);
    try {
      const { ops, label } = buildOps(state, ctx, ulid, new Date().toISOString());
      const r = await repo.applyBatch(ops, writeContext(label));
      if (!r.ok) throw new Error('다른 기기에서 먼저 바꿨어요. 다시 시도해 주세요.');
      if (state.kind === 'payment') {
        globalThis.localStorage?.setItem('ai-note.last-pay-method.v1', JSON.stringify({ method: state.values.method, card: '' }));
      }
      setState(initialState());
      say('bot', `저장했어요 — ${label.replace(/^.*?\(채팅\): /, '')}\n또 입력할 것이 있으면 골라 주세요.`, {
        undo: () =>
          void repo.revertBatch(r.batchId, writeContext('채팅 입력 되돌리기')).then(() => say('bot', '방금 저장한 것을 되돌렸어요.')),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const bubble = (m: Msg) => (
    <View key={m.id} style={[styles.row, m.role === 'me' && styles.rowMe]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: m.role === 'me' ? theme.colors.primaryContainer : theme.colors.surfaceVariant,
          },
          m.old && styles.old,
        ]}>
        <Text>{m.text}</Text>
        {m.undo && (
          <Button compact icon="undo" onPress={m.undo} style={styles.start}>
            되돌리기
          </Button>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.kinds}>
        {KINDS.map((k) => (
          <Chip key={k.kind} icon={k.icon} compact selected={state.kind === k.kind} showSelectedOverlay onPress={() => pickKind(k.kind)}>
            {KIND_LABELS[k.kind]}
          </Chip>
        ))}
        {(state.kind || paste || cardTx) && (
          <Chip compact icon="restart" onPress={() => restart()}>
            처음부터
          </Chip>
        )}
      </View>

      <ScrollView ref={scroll} style={styles.log} contentContainerStyle={styles.logInner}>
        {msgs.some((m) => m.old) && (
          <View style={styles.oldBar}>
            <Text variant="labelSmall" style={styles.dim}>
              지난 대화 (이 기기에만, 30일 보관)
            </Text>
            <Button
              compact
              onPress={() => {
                clearLog();
                setMsgs((m) => m.filter((x) => !x.old));
              }}>
              지우기
            </Button>
          </View>
        )}
        {msgs.map(bubble)}
        {step.type === 'confirm' && (
          <ConfirmCard
            step={step}
            saving={saving}
            onSave={() => void save()}
            onCancel={() => restart('취소했어요. 저장하지 않았습니다.')}
            onEdit={(k) => advance(reopen(state, k))}
          />
        )}
        {paste && <ImportPreview items={paste} onDone={(msg) => restart(msg)} />}
        {cardTx && <CardImport txns={cardTx} onDone={(msg) => restart(msg)} />}
      </ScrollView>

      {step.type === 'ask' && (step.choices.length > 0 || step.optional || step.allowNew) && (
        <View style={styles.kinds}>
          {step.choices.map((c) => (
            <Chip key={c.label} compact onPress={() => choose(c.label, c.value)}>
              {c.label}
            </Chip>
          ))}
          {step.optional && (
            <Chip compact icon="skip-next" onPress={() => choose('건너뛰기', SKIP_VALUE)}>
              건너뛰기
            </Chip>
          )}
          {step.allowNew && <Text style={styles.hint}>목록에 없으면 학원 이름을 쓰세요</Text>}
        </View>
      )}
      {error ? <Text style={[styles.hint, { color: theme.colors.error }]}>{error}</Text> : null}
      <View style={styles.inputRow}>
        <TextInput
          mode="outlined"
          dense
          multiline
          style={styles.input}
          placeholder={step.type === 'ask' ? '답 입력 (짧게)' : '한 문장으로 쓰거나 결제 안내 문자를 붙여넣기'}
          value={text}
          onChangeText={setText}
          onKeyPress={(e) => {
            const ne = e.nativeEvent as {
              key: string;
              shiftKey?: boolean;
              isComposing?: boolean;
            };
            if (ne.key === 'Enter' && !ne.shiftKey && !ne.isComposing) {
              (e as unknown as { preventDefault?: () => void }).preventDefault?.();
              send();
            }
          }}
        />
        <IconButton icon="send" mode="contained" disabled={!text.trim()} onPress={send} accessibilityLabel="보내기" />
      </View>
    </View>
  );
}

function ConfirmCard({
  step,
  saving,
  onSave,
  onCancel,
  onEdit,
}: {
  step: Extract<Step, { type: 'confirm' }>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onEdit: (k: Extract<Step, { type: 'ask' }>['key']) => void;
}) {
  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Title title={step.title} titleVariant="titleMedium" />
      <Card.Content>
        {step.lines.map((l) => (
          <View key={`${l.key}-${l.label}`} style={styles.line}>
            <Text style={styles.lineLabel}>{l.label}</Text>
            <Text style={styles.lineValue}>{l.value}</Text>
            {l.key !== 'memo' && (
              <Button compact onPress={() => onEdit(l.key)}>
                고치기
              </Button>
            )}
          </View>
        ))}
      </Card.Content>
      <Card.Actions style={styles.actions}>
        <Button onPress={onCancel}>취소</Button>
        <Button mode="contained" icon="check" loading={saving} disabled={saving} onPress={onSave}>
          저장
        </Button>
      </Card.Actions>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 6 },
  kinds: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  log: { flex: 1, minHeight: 280 },
  logInner: { gap: 8, paddingVertical: 8 },
  row: { flexDirection: 'row' },
  rowMe: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '88%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  old: { opacity: 0.5 },
  oldBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dim: { opacity: 0.6 },
  start: { alignSelf: 'flex-start' },
  card: { marginVertical: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineLabel: { width: 72, opacity: 0.7 },
  lineValue: { flex: 1, fontWeight: '600' },
  actions: { flexWrap: 'wrap' },
  hint: { opacity: 0.7, fontSize: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  input: { flex: 1, maxHeight: 120 },
});
