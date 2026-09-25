import type { StudentProfile } from '@imc/contracts';
import * as Localization from 'expo-localization';
import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '../../src/components/ui';
import { CONSENT_POLICY_VERSION } from '../../src/config';
import { friendlyMessage } from '../../src/lib/api-client';
import { useSession } from '../../src/session';

const AVATARS = ['fox', 'owl', 'cat', 'panda', 'robot', 'rocket'];

export default function NewChild() {
  const { api, newIdempotencyKey } = useSession();
  const [consent, setConsent] = useState(false);
  const [nickname, setNickname] = useState('');
  const [grade, setGrade] = useState(4);
  const [avatar, setAvatar] = useState('fox');
  const [timezone, setTimezone] = useState(Localization.getCalendars()[0]?.timeZone ?? 'UTC');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const student = await api.request<StudentProfile>('POST', '/v1/students', {
        body: { nickname: nickname.trim(), avatarKey: avatar, grade, timezone, locale: 'en' },
        idempotencyKey: newIdempotencyKey(),
      });
      await api.request('POST', '/v1/consents', {
        body: {
          studentId: student.id,
          purpose: 'core_service',
          policyVersion: CONSENT_POLICY_VERSION,
          granted: true,
        },
      });
      router.replace(`/parent/child/${student.id}`);
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Add a child</Title>
      <Card>
        <Body>
          Consent ({CONSENT_POLICY_VERSION}): IMC Arena stores your child's nickname, grade,
          timezone and practice answers to run the service and show you progress. We do not collect
          a legal name, birthdate, school, location or contacts, and show no ads. You can export or
          delete this data at any time.
        </Body>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Switch
            value={consent}
            onValueChange={setConsent}
            accessibilityLabel="I agree as the child's parent or guardian"
          />
          <Body>I agree as the child's parent or guardian</Body>
        </View>
      </Card>
      <Card>
        <Field
          label="Nickname (no real names needed)"
          value={nickname}
          onChangeText={setNickname}
          maxLength={24}
        />
        <Body>Grade</Body>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[4, 5, 6].map((g) => (
            <View key={g} style={{ flex: 1 }}>
              <Button
                label={`Grade ${g}${grade === g ? ' ✓' : ''}`}
                kind={grade === g ? 'primary' : 'secondary'}
                onPress={() => setGrade(g)}
              />
            </View>
          ))}
        </View>
        <Body>Avatar</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {AVATARS.map((a) => (
            <Button
              key={a}
              label={`${a}${avatar === a ? ' ✓' : ''}`}
              kind={avatar === a ? 'primary' : 'secondary'}
              onPress={() => setAvatar(a)}
            />
          ))}
        </View>
        <Field label="Timezone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" />
      </Card>
      <ErrorText message={error} />
      <Button
        label="Create profile"
        disabled={busy || !consent || !nickname.trim()}
        onPress={() => void create()}
      />
    </Screen>
  );
}
