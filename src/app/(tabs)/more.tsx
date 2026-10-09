import { router } from 'expo-router';
import { List } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { BUILD_VERSION } from '@/lib/config';

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
        <List.Subheader>관리</List.Subheader>
        <List.Item
          title="학원 · 수강"
          description="학원 정보, 납부 방법, 아이별 요일·시간"
          left={(p) => <List.Icon {...p} icon="school-outline" />}
          onPress={() => router.push('/academies')}
        />
      </List.Section>
      <List.Section>
        <List.Subheader>곧 추가</List.Subheader>
        <List.Item title="장소 · 휴일/방학" left={(p) => <List.Icon {...p} icon="map-marker-outline" />} />
        <List.Item title="알림 설정" left={(p) => <List.Icon {...p} icon="bell-outline" />} />
        <List.Item title="엑셀 동기화 · 백업" left={(p) => <List.Icon {...p} icon="microsoft-excel" />} />
        <List.Item title="가족 구성원 · 가입 승인" left={(p) => <List.Icon {...p} icon="account-group-outline" />} />
      </List.Section>
      <List.Item title="앱 버전" description={BUILD_VERSION} left={(p) => <List.Icon {...p} icon="information-outline" />} />
    </Screen>
  );
}
