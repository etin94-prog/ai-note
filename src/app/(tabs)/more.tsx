import { router } from 'expo-router';
import { List } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { BUILD_VERSION } from '@/lib/config';
import { useRepository } from '@/state/RepositoryContext';

export default function MoreScreen() {
  const { isChild } = useRepository();
  return (
    <Screen>
      <List.Section>
        <List.Subheader>관리</List.Subheader>
        <List.Item
          title="학원 · 수강"
          description={isChild ? '내 학원 요일·시간' : '학원 정보, 납부 방법, 아이별 요일·시간'}
          left={(p) => <List.Icon {...p} icon="school-outline" />}
          onPress={() => router.push('/academies')}
        />
        <List.Item
          title="장소"
          description="집·학교 등 자주 가는 곳"
          left={(p) => <List.Icon {...p} icon="map-marker-outline" />}
          onPress={() => router.push('/places')}
        />
        <List.Item
          title="방학 · 휴일"
          description="아이별 기간 → 등하교·학원 일정 빼기"
          left={(p) => <List.Icon {...p} icon="beach" />}
          onPress={() => router.push('/holidays')}
        />
      </List.Section>
      <List.Section>
        <List.Subheader>설정</List.Subheader>
        <List.Item
          title="저장 모드 연결"
          description="GitHub 저장소 / Firebase / 체험, 이 기기 사용자"
          left={(p) => <List.Icon {...p} icon="database-cog-outline" />}
          onPress={() => router.push('/settings/storage')}
        />
      </List.Section>
      {!isChild && (
        <List.Section>
          <List.Subheader>데이터</List.Subheader>
          <List.Item
            title="처음 설정"
            description="집·학교 → 학원 → 수강을 한 흐름으로 입력"
            left={(p) => <List.Icon {...p} icon="rocket-launch-outline" />}
            onPress={() => router.push('/setup')}
          />
          <List.Item
            title="엑셀 동기화"
            description="내보내 PC에서 고치고 다시 가져오기, 빈 양식"
            left={(p) => <List.Icon {...p} icon="microsoft-excel" />}
            onPress={() => router.push('/excel')}
          />
          <List.Item
            title="관리자"
            description="전체 백업·복원, 데이터 초기화"
            left={(p) => <List.Icon {...p} icon="shield-account-outline" />}
            onPress={() => router.push('/admin')}
          />
        </List.Section>
      )}
      {!isChild && (
        <List.Section>
          <List.Subheader>곧 추가</List.Subheader>
          <List.Item title="알림 설정" left={(p) => <List.Icon {...p} icon="bell-outline" />} />
          <List.Item title="가족 구성원 · 가입 승인" left={(p) => <List.Icon {...p} icon="account-group-outline" />} />
        </List.Section>
      )}
      <List.Item title="앱 버전" description={BUILD_VERSION} left={(p) => <List.Icon {...p} icon="information-outline" />} />
    </Screen>
  );
}
