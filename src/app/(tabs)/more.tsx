import { router } from 'expo-router';
import { List } from 'react-native-paper';

import { Screen } from '@/components/Screen';

export default function MoreScreen() {
  return (
    <Screen>
      <List.Section>
        <List.Subheader>설정</List.Subheader>
        <List.Item
          title="저장 모드 연결"
          description="GitHub 저장소 / Firebase, 이 기기 사용자"
          left={(p) => <List.Icon {...p} icon="database-cog-outline" />}
          onPress={() => router.push('/settings/storage')}
        />
      </List.Section>
      <List.Section>
        <List.Subheader>곧 추가</List.Subheader>
        <List.Item title="학원 · 장소 · 휴일/방학" left={(p) => <List.Icon {...p} icon="school-outline" />} />
        <List.Item title="알림 설정" left={(p) => <List.Icon {...p} icon="bell-outline" />} />
        <List.Item title="엑셀 동기화 · 백업" left={(p) => <List.Icon {...p} icon="microsoft-excel" />} />
        <List.Item title="가족 구성원 · 가입 승인" left={(p) => <List.Icon {...p} icon="account-group-outline" />} />
      </List.Section>
    </Screen>
  );
}
