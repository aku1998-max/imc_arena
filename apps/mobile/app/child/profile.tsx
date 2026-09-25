import { router } from 'expo-router';
import { Linking } from 'react-native';
import { ChildNav } from '../../src/child/ChildNav';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '../../src/components/ui';
import { SUPPORT_URL } from '../../src/config';
import { useQuery } from '../../src/hooks';
import { useSession } from '../../src/session';

export default function Profile() {
  const { leaveChildMode } = useSession();
  const { data, error, loading } = useQuery<{
    student: { nickname: string; avatarKey: string; grade: number; locale: string };
  }>('/v1/me');
  return (
    <Screen>
      <Title>Profile</Title>
      <ErrorText message={error} />
      {loading && <Loading />}
      {data && (
        <Card>
          <Body>Nickname: {data.student.nickname}</Body>
          <Body>Avatar: {data.student.avatarKey}</Body>
          <Body>Grade: {data.student.grade}</Body>
          <Body>Language: {data.student.locale === 'en' ? 'English' : data.student.locale}</Body>
          <Body muted>A parent can change these in parent mode.</Body>
        </Card>
      )}
      <Button label="Help" kind="secondary" onPress={() => void Linking.openURL(SUPPORT_URL)} />
      <Card>
        <Body>Parent mode needs the parent's email sign-in. This device leaves child mode.</Body>
        <Button
          label="Switch to parent mode"
          kind="secondary"
          onPress={() => void leaveChildMode().then(() => router.replace('/parent/sign-in'))}
        />
      </Card>
      <ChildNav />
    </Screen>
  );
}
