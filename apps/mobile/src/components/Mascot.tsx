import { Image, type ImageStyle, type StyleProp } from 'react-native';

const SOURCES = {
  cheer: require('../../assets/mascot/cheer.png'),
  think: require('../../assets/mascot/think.png'),
} as const;

const LABELS = {
  cheer: 'Math Challenge elephant cheering',
  think: 'Math Challenge elephant thinking',
} as const;

/** The IMC Math Challenge elephant. Pose images are about 11:12 (width:height). */
export function Mascot({
  pose,
  height,
  style,
  decorative = false,
}: {
  pose: keyof typeof SOURCES;
  height: number;
  style?: StyleProp<ImageStyle>;
  decorative?: boolean;
}) {
  return (
    <Image
      source={SOURCES[pose]}
      style={[{ height, width: Math.round(height * 0.92) }, style]}
      resizeMode="contain"
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : LABELS[pose]}
      accessibilityIgnoresInvertColors
    />
  );
}
