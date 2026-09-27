import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { PRIVACY_URL } from '../config';
import { colors, fonts, minTouchTarget } from '../theme';

const TERMS_URL =
  Platform.OS === 'ios'
    ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
    : 'https://play.google.com/about/play-terms/';

/** Privacy policy and terms links; the stores require them wherever a subscription is offered. */
export function PolicyLinks() {
  return (
    <View style={s.row}>
      <Text
        accessibilityRole="link"
        style={s.link}
        onPress={() => void Linking.openURL(PRIVACY_URL)}
      >
        Privacy policy
      </Text>
      <Text style={s.sep}>·</Text>
      <Text accessibilityRole="link" style={s.link} onPress={() => void Linking.openURL(TERMS_URL)}>
        Terms of use
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  link: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.brand,
    textDecorationLine: 'underline',
    paddingVertical: (minTouchTarget - 20) / 2,
  },
  sep: { color: colors.inkFaint },
});
