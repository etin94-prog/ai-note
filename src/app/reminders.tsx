import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, HelperText, List, Switch, Text } from 'react-native-paper';

import { MinutesEditor } from '@/components/MinutesEditor';
import { osNotifySupported, requestOsNotify } from '@/components/ReminderPump';
import { Screen } from '@/components/Screen';
import { COST_POLICY_ID, type CostPolicy, defaultPolicy, type KindKey, normalizeMinutes, type ReminderPolicy } from '@/domain/reminders';
import { EVENT_KIND_LABELS, type EventKind, MEMBERS, type MemberId } from '@/domain/types';
import { useRepository } from '@/state/RepositoryContext';
import { setDevicePrefs, useDevicePrefs, usePolicies } from '@/state/useReminders';

const DUE_DAYS = [7, 3, 1, 0];
const KINDS = Object.keys(EVENT_KIND_LABELS) as EventKind[];

/** 알림 설정 (6.2, D-05): 부모 = 구성원별·일정 종류별 시점, 비용 알림 / 모두 = 이 기기 끄기·휴대폰 알림 */
export default function RemindersScreen() {
  const { repo, isChild, readOnly, writeContext } = useRepository();
  const policies = usePolicies();
  const prefs = useDevicePrefs();
  const [open, setOpen] = useState<MemberId | null>(null);
  const [error, setError] = useState('');
  const canEdit = !!repo && !isChild && !readOnly;

  const savePolicy = async (m: MemberId, patch: Partial<ReminderPolicy>) => {
    if (!repo) return;
    const cur = policies.docs.find((d) => d.id === m);
    const next = { ...(cur ? { enabled: cur.enabled !== false, byKind: cur.byKind ?? {} } : defaultPolicy(m)), ...patch, memberId: m };
    const ctx = writeContext(`알림 설정: ${MEMBERS.find((x) => x.id === m)?.name}`);
    const r = cur ? await repo.update('reminderPolicies', m, next, cur.version, ctx) : await repo.create('reminderPolicies', m, next, ctx);
    setError(r === 'conflict' ? '다른 기기에서 먼저 바꿨습니다. 다시 시도해 주세요.' : '');
  };
  const saveCost = async (patch: Partial<CostPolicy>) => {
    if (!repo) return;
    const cur = policies.docs.find((d) => d.id === COST_POLICY_ID);
    const next = { ...policies.cost, ...patch };
    const ctx = writeContext('알림 설정: 학원비');
    const r = cur ? await repo.update('reminderPolicies', COST_POLICY_ID, next, cur.version, ctx) : await repo.create('reminderPolicies', COST_POLICY_ID, next, ctx);
    setError(r === 'conflict' ? '다른 기기에서 먼저 바꿨습니다. 다시 시도해 주세요.' : '');
  };

  const enableOs = async () => {
    const ok = await requestOsNotify();
    setDevicePrefs({ os: ok });
    if (!ok) setError('브라우저에서 알림을 허용하지 않았습니다. 앱 안 알림함은 그대로 쓸 수 있습니다.');
  };

  return (
    <Screen>
      <Card mode="outlined" style={styles.card}>
        <Card.Title title="이 기기" subtitle="이 폰·PC 에서만 적용됩니다" titleVariant="titleMedium" />
        <List.Item
          title="일정 알림 받기"
          description={isChild ? '끄면 이 기기에서 내 일정 알림이 오지 않아요' : '끄면 이 기기 알림함에 일정 알림이 나오지 않습니다'}
          right={() => <Switch value={!prefs.muted} onValueChange={(v) => setDevicePrefs({ muted: !v })} />}
        />
        <List.Item
          title="휴대폰 알림"
          description={
            !osNotifySupported()
              ? '이 브라우저는 알림을 지원하지 않습니다 (iPhone 은 홈 화면에 추가한 앱에서 가능)'
              : prefs.os
                ? '켜짐 — 앱이 열려 있을 때 알림 시각이 되면 휴대폰 알림을 띄웁니다'
                : '앱이 열려 있을 때만 동작합니다. 꺼져 있어도 알림함은 그대로입니다'
          }
          descriptionNumberOfLines={3}
          right={() =>
            prefs.os ? (
              <Switch value onValueChange={() => setDevicePrefs({ os: false })} />
            ) : (
              <View style={styles.rightCenter}>
                <Button compact mode="contained-tonal" style={styles.onBtn} disabled={!osNotifySupported()} onPress={() => void enableOs()}>
                  켜기
                </Button>
              </View>
            )
          }
        />
      </Card>

      {!canEdit ? (
        <Text style={styles.dim}>알림 시점은 부모가 정합니다. (자녀는 이 기기에서 켜기·끄기만)</Text>
      ) : (
        <>
          <Text variant="titleSmall" style={styles.section}>
            가족별 일정 알림
          </Text>
          {MEMBERS.map((m) => {
            const p = policies.members[m.id] ?? defaultPolicy(m.id);
            const kinds = Object.keys(p.byKind).filter((k) => k !== 'default') as EventKind[];
            const isOpen = open === m.id;
            return (
              <Card key={m.id} mode="outlined" style={styles.card}>
                <List.Item
                  title={m.name}
                  description={p.enabled ? `기본 ${normalizeMinutes(p.byKind.default ?? []).length}개${kinds.length ? ` · 종류별 ${kinds.length}` : ''}` : '꺼짐'}
                  onPress={() => setOpen(isOpen ? null : m.id)}
                  left={(pp) => <List.Icon {...pp} icon="account" color={m.color} />}
                  right={() => (
                    <View style={styles.row}>
                      <Switch value={p.enabled} onValueChange={(v) => void savePolicy(m.id, { enabled: v })} />
                      <List.Icon icon={isOpen ? 'chevron-up' : 'chevron-down'} />
                    </View>
                  )}
                />
                {isOpen && p.enabled && (
                  <Card.Content style={styles.gap}>
                    <Text variant="labelLarge">기본 (모든 일정)</Text>
                    <MinutesEditor value={normalizeMinutes(p.byKind.default ?? [])} onChange={(v) => void savePolicy(m.id, { byKind: { ...p.byKind, default: v } })} />
                    {kinds.map((k) => (
                      <View key={k} style={styles.gap}>
                        <View style={styles.between}>
                          <Text variant="labelLarge">{EVENT_KIND_LABELS[k]}</Text>
                          <Button
                            compact
                            onPress={() => {
                              const next = { ...p.byKind };
                              delete next[k];
                              void savePolicy(m.id, { byKind: next });
                            }}>
                            기본 따르기
                          </Button>
                        </View>
                        <MinutesEditor value={normalizeMinutes(p.byKind[k] ?? [])} onChange={(v) => void savePolicy(m.id, { byKind: { ...p.byKind, [k]: v } })} />
                      </View>
                    ))}
                    <Text variant="bodySmall" style={styles.dim}>
                      종류마다 다르게:
                    </Text>
                    <View style={styles.chips}>
                      {KINDS.filter((k) => !(k in p.byKind)).map((k) => (
                        <Chip key={k} compact icon="plus" onPress={() => void savePolicy(m.id, { byKind: { ...p.byKind, [k as KindKey]: normalizeMinutes(p.byKind.default ?? [30]) } })}>
                          {EVENT_KIND_LABELS[k]}
                        </Chip>
                      ))}
                    </View>
                  </Card.Content>
                )}
              </Card>
            );
          })}

          <Text variant="titleSmall" style={styles.section}>
            학원비 알림
          </Text>
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.gap}>
              <Text variant="labelLarge">납부 기한 알림 (미납일 때)</Text>
              <View style={styles.chips}>
                {DUE_DAYS.map((d) => {
                  const on = policies.cost.dueDays.includes(d);
                  return (
                    <Chip
                      key={d}
                      compact
                      selected={on}
                      showSelectedOverlay
                      onPress={() => void saveCost({ dueDays: on ? policies.cost.dueDays.filter((x) => x !== d) : [...policies.cost.dueDays, d].sort((a, b) => b - a) })}>
                      {d === 0 ? '당일' : `D-${d}`}
                    </Chip>
                  );
                })}
              </View>
              <Text variant="bodySmall" style={styles.dim}>
                연체·환불 미종결(7일)은 항상 부모 모두에게 알립니다.
              </Text>
            </Card.Content>
            <List.Item
              title="납부 담당이 아닌 부모에게도"
              right={() => <Switch value={policies.cost.notifyOtherParent} onValueChange={(v) => void saveCost({ notifyOtherParent: v })} />}
            />
          </Card>
          <Text variant="bodySmall" style={styles.dim}>
            일정 하나만 다르게 하려면 그 일정 수정 화면의 “이 일정만 알림 따로”에서 정하세요.
          </Text>
        </>
      )}
      {error ? <HelperText type="error">{error}</HelperText> : null}
      <View style={{ height: 40 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginVertical: 6 },
  rightCenter: { justifyContent: 'center' },
  onBtn: { minWidth: 72 },
  section: { marginTop: 16, marginBottom: 4 },
  gap: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dim: { opacity: 0.65 },
});
