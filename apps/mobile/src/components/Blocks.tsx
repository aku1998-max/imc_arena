import type { ContentBlock, QuestionOption } from '@imc/contracts';
import katex from 'katex';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, minTouchTarget, spacing, typography } from '../theme';
import { Button } from './ui';

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.min.css';

function mathHtml(latex: string, display: boolean) {
  // KaTeX generates the markup from LaTeX; trust:false blocks links/includes. No raw HTML input.
  const body = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    output: 'html',
  });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${KATEX_CSS}"><style>body{margin:0;font-size:20px;color:${colors.text};background:transparent}</style></head><body>${body}</body></html>`;
}

/** Math via KaTeX in a sandboxed WebView; screen readers get the reviewed spoken alternative. */
export function MathView({
  latex,
  display,
  alt,
}: {
  latex: string;
  display: boolean;
  alt: string;
}) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={alt}
      style={{ height: display ? 64 : 40 }}
    >
      <WebView
        originWhitelist={['about:blank', 'https://cdn.jsdelivr.net']}
        source={{ html: mathHtml(latex, display) }}
        javaScriptEnabled={false}
        scrollEnabled={false}
        importantForAccessibility="no-hide-descendants"
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}

function ZoomableImage({ url, alt }: { url: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${alt}. Double tap to zoom.`}
        onPress={() => setOpen(true)}
      >
        <Image source={{ uri: url }} style={s.image} resizeMode="contain" />
        <Text style={s.hint}>Tap to zoom</Text>
      </Pressable>
      {/* Zoom opens over the question; closing returns to the unchanged answer controls. */}
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.zoom}>
          <WebView
            originWhitelist={['*']}
            source={{
              html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff"><img src="${encodeURI(url)}" alt="" style="max-width:100%"></body></html>`,
            }}
            javaScriptEnabled={false}
            accessibilityLabel={alt}
          />
          <View style={s.zoomClose}>
            <Button label="Close zoom" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

export function Blocks({
  blocks,
  assets,
}: {
  blocks: ContentBlock[];
  assets: Record<string, { url: string }>;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      {blocks.map((b, i) => {
        if (b.type === 'text')
          return (
            <Text key={i} style={s.text}>
              {b.text}
            </Text>
          );
        if (b.type === 'math')
          return <MathView key={i} latex={b.latex} display={b.display} alt={b.alt} />;
        const a = assets[b.assetId];
        return a ? (
          <ZoomableImage key={i} url={a.url} alt={b.alt} />
        ) : (
          <Text key={i} style={s.text}>
            {b.alt}
          </Text>
        );
      })}
    </View>
  );
}

export function optionAccessibleText(o: QuestionOption): string {
  return o.text ?? o.alt ?? o.math ?? '';
}

export function OptionContent({ option }: { option: QuestionOption }) {
  if (option.math && !option.text)
    return <MathView latex={option.math} display={false} alt={option.alt ?? option.math} />;
  return <Text style={s.option}>{option.text}</Text>;
}

const s = StyleSheet.create({
  text: {
    fontSize: typography.fontSizeBody + 1,
    lineHeight: typography.lineHeightBody + 2,
    color: colors.text,
  },
  option: { fontSize: typography.fontSizeBody, color: colors.text, flexShrink: 1 },
  image: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surface },
  hint: { fontSize: typography.fontSizeSmall, color: colors.textMuted, textAlign: 'center' },
  zoom: { flex: 1, backgroundColor: colors.surface },
  zoomClose: { padding: spacing.md, minHeight: minTouchTarget + spacing.md * 2 },
});
