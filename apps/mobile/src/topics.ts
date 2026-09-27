import { topicColors } from './theme';

export interface TopicStyle {
  name: string;
  symbol: string;
  ink: string;
  soft: string;
}

const TOPICS: Record<string, { name: string; symbol: string }> = {
  arithmetic: { name: 'Arithmetic', symbol: '+−' },
  fractions: { name: 'Fractions', symbol: '½' },
  geometry: { name: 'Geometry', symbol: '△' },
  patterns: { name: 'Patterns', symbol: '⋯' },
  measurement: { name: 'Measurement', symbol: 'cm' },
  logic: { name: 'Logic', symbol: '?' },
};

/** Display name, symbol and colours for a topic slug; unknown slugs get a readable fallback. */
export function topicStyle(slug: string | null | undefined): TopicStyle {
  const key = (slug ?? '') as keyof typeof topicColors;
  const meta = TOPICS[key];
  const tone = topicColors[key] ?? { ink: '#52625A', soft: '#EEF2EF' };
  const fallback = (slug ?? 'Practice').replace(/-/g, ' ');
  return {
    name: meta?.name ?? fallback.charAt(0).toUpperCase() + fallback.slice(1),
    symbol: meta?.symbol ?? '#',
    ...tone,
  };
}
