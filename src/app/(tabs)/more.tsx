import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { List } from 'react-native-paper';

import { Screen } from '@/components/Screen';
import { BUILD_VERSION } from '@/lib/config';
import { PALETTE } from '@/lib/theme';
import { useRepository } from '@/state/RepositoryContext';

export default function MoreScreen() {
  const { isChild, settings } = useRepository();
  return (
    <Screen>
      <List.Section style={styles.group}>
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
      <List.Section style={styles.group}>
        <List.Subheader>설정</List.Subheader>
        <List.Item
          title="알림 설정"
          description={isChild ? '이 기기 알림 켜기·끄기' : '가족별 알림 시점, 학원비 알림, 휴대폰 알림'}
          left={(p) => <List.Icon {...p} icon="bell-cog-outline" />}
          onPress={() => router.push('/reminders')}
        />
        {!isChild && settings.mode === 'firebase' && (
          <List.Item
            title="가족 구성원"
            description="가족 코드, 가입 요청 승인, 연결된 계정"
            left={(p) => <List.Icon {...p} icon="account-group-outline" />}
            onPress={() => router.push('/family')}
          />
        )}
        <List.Item
          title="저장 모드 연결"
          description="저장 위치(GitHub·Firebase·체험)와 이 기기 사용자"
          left={(p) => <List.Icon {...p} icon="database-cog-outline" />}
          onPress={() => router.push('/settings/storage')}
        />
      </List.Section>
      {!isChild && (
        <List.Section style={styles.group}>
          <List.Subheader>데이터</List.Subheader>
          <List.Item
            title="처음 설정"
            description="집·학교 → 학원 → 수강을 한 흐름으로 입력"
            left={(p) => <List.Icon {...p} icon="clipboard-check-outline" />}
            onPress={() => router.push('/setup')}
          />
          <List.Item
            title="엑셀 동기화"
            description="내보내 PC에서 고치고 다시 가져오기, 빈 양식"
            left={(p) => <List.Icon {...p} icon="microsoft-excel" />}
            onPress={() => router.push('/excel')}
          />
          <List.Item
            title="통계"
            description="월별 추이, 올해 누적, 자녀별·학원별 합계"
            left={(p) => <List.Icon {...p} icon="chart-bar" />}
            onPress={() => router.push('/stats')}
          />
          <List.Item
            title="휴지통"
            description="지운 일정·지출을 30일 안에 되살리기"
            left={(p) => <List.Icon {...p} icon="delete-restore" />}
            onPress={() => router.push('/trash')}
          />
          <List.Item
            title="관리자"
            description="전체 백업·복원, 데이터 초기화"
            left={(p) => <List.Icon {...p} icon="shield-account-outline" />}
            onPress={() => router.push('/admin')}
          />
        </List.Section>
      )}
      <List.Item title="앱 버전" description={BUILD_VERSION} left={(p) => <List.Icon {...p} icon="information-outline" />} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 메뉴 묶음을 흰 카드로 (디자인 점검: 회색 바탕에 목록만 있어 구분이 약했음)
  group: { backgroundColor: PALETTE.card, borderRadius: 16, borderWidth: 1, borderColor: PALETTE.line, marginBottom: 12, overflow: 'hidden' },
});
