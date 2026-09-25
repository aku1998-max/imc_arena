import type { ImportQuestion } from '@imc/contracts';

/**
 * ORIGINAL SYNTHETIC QUESTIONS for development, tests and staging. They are generated from simple
 * templates written for this project; none is copied from IMC or any exam paper.
 */
export const SEED_TOPICS = [
  { slug: 'arithmetic', displayKey: 'topic.arithmetic' },
  { slug: 'fractions', displayKey: 'topic.fractions' },
  { slug: 'geometry', displayKey: 'topic.geometry' },
  { slug: 'patterns', displayKey: 'topic.patterns' },
  { slug: 'measurement', displayKey: 'topic.measurement' },
  { slug: 'logic', displayKey: 'topic.logic' },
] as const;

type Draft = Omit<ImportQuestion, 'schemaVersion' | 'locale'>;

function mc(
  ref: string,
  grade: number,
  topicSlug: string,
  difficulty: number,
  stem: string,
  correct: number | string,
  distractors: Array<number | string>,
  explanation: string,
): Draft {
  const values = [String(correct), ...distractors.map(String)];
  const unique = [...new Set(values)];
  let bump = 1;
  while (unique.length < 4) {
    const candidate = String(Number(correct) + bump * 7);
    if (!unique.includes(candidate)) unique.push(candidate);
    bump++;
  }
  // Deterministic placement of the correct answer: rotate by a hash of the reference.
  const four = unique.slice(0, 4);
  const shift = [...ref].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4;
  const rotated = [...four.slice(shift), ...four.slice(0, shift)];
  const ids = ['a', 'b', 'c', 'd'];
  const options = rotated.map((text, i) => ({ id: ids[i]!, text }));
  const correctOptionId = options.find((o) => o.text === String(correct))!.id;
  return {
    sourceReference: ref,
    stemBlocks: [{ type: 'text', text: stem }],
    options,
    correctOptionId,
    explanationBlocks: [{ type: 'text', text: explanation }],
    grade,
    topicSlug,
    difficulty,
  };
}

function templates(grade: number, i: number): Draft[] {
  const g = grade;
  const k = i + 1;
  const ref = (t: string) => `synthetic-g${g}-${t}-${k}`;
  const d = (i % 3) + 1;
  const a = 3 + ((i * 7 + g) % 9);
  const b = 4 + ((i * 5 + g * 2) % 8);
  const out: Draft[] = [];

  // Arithmetic
  if (d === 1) {
    out.push(
      mc(
        ref('arith'),
        g,
        'arithmetic',
        d,
        `What is ${a} × ${b}?`,
        a * b,
        [a * b + a, a * b - b, a + b],
        `${a} groups of ${b} make ${a * b}.`,
      ),
    );
  } else if (d === 2) {
    const c = 2 + (i % 5);
    out.push(
      mc(
        ref('arith'),
        g,
        'arithmetic',
        d,
        `What is ${a} × ${b} + ${c * g}?`,
        a * b + c * g,
        [a * (b + c * g), a * b, a * b + c * g + 10],
        `Multiply first: ${a} × ${b} = ${a * b}, then add ${c * g} to get ${a * b + c * g}.`,
      ),
    );
  } else {
    const n = 10 * g + i;
    out.push(
      mc(
        ref('arith'),
        g,
        'arithmetic',
        d,
        `A number is doubled and then 6 is added. The result is ${2 * n + 6}. What was the number?`,
        n,
        [n + 3, 2 * n, n - 3],
        `Undo the steps: ${2 * n + 6} − 6 = ${2 * n}, and half of ${2 * n} is ${n}.`,
      ),
    );
  }

  // Fractions
  const den = [4, 5, 6, 8, 10, 12][i % 6]!;
  const x = 1 + (i % (den - 2));
  const y = 1;
  if (d === 3) {
    const whole = den * (2 + (i % 4));
    out.push(
      mc(
        ref('frac'),
        g,
        'fractions',
        d,
        `What is ${x}/${den} of ${whole}?`,
        (whole / den) * x,
        [whole / den, (whole / den) * (x + 1), whole - x],
        `One ${den}th of ${whole} is ${whole / den}, so ${x}/${den} is ${x} × ${whole / den} = ${(whole / den) * x}.`,
      ),
    );
  } else {
    out.push(
      mc(
        ref('frac'),
        g,
        'fractions',
        d,
        `What is ${x}/${den} + ${y}/${den}?`,
        `${x + y}/${den}`,
        [`${x + y}/${den * 2}`, `${x * y}/${den}`, `${x + y + 1}/${den}`],
        `The denominators match, so add the numerators: ${x} + ${y} = ${x + y}.`,
      ),
    );
  }

  // Geometry
  const w = 2 + (i % 7);
  const h = 3 + ((i + g) % 6);
  if (d === 1) {
    out.push(
      mc(
        ref('geom'),
        g,
        'geometry',
        d,
        `A rectangle is ${w} cm wide and ${h} cm long. What is its perimeter in cm?`,
        2 * (w + h),
        [w * h, w + h, 2 * w + h],
        `Perimeter = 2 × (${w} + ${h}) = ${2 * (w + h)} cm.`,
      ),
    );
  } else if (d === 2) {
    out.push(
      mc(
        ref('geom'),
        g,
        'geometry',
        d,
        `A rectangle is ${w} cm by ${h} cm. What is its area in square cm?`,
        w * h,
        [2 * (w + h), w * h + w, w + h],
        `Area = ${w} × ${h} = ${w * h} square cm.`,
      ),
    );
  } else {
    const s = 3 + (i % 5);
    out.push(
      mc(
        ref('geom'),
        g,
        'geometry',
        d,
        `A square has a perimeter of ${4 * s * g} cm. What is its area in square cm?`,
        (s * g) ** 2,
        [4 * s * g, s * g, (s * g) ** 2 + s],
        `Each side is ${4 * s * g} ÷ 4 = ${s * g} cm, so the area is ${s * g} × ${s * g} = ${(s * g) ** 2}.`,
      ),
    );
  }

  // Patterns
  const start = 2 + (i % 5);
  const step = 3 + ((i + g) % 4);
  if (d === 3) {
    const seq = [start, start * 2, start * 4, start * 8];
    out.push(
      mc(
        ref('patt'),
        g,
        'patterns',
        d,
        `What comes next: ${seq.join(', ')}, ...?`,
        start * 16,
        [start * 12, start * 8 + start, start * 10],
        `Each term doubles, so the next is ${start * 8} × 2 = ${start * 16}.`,
      ),
    );
  } else {
    const seq = [0, 1, 2, 3].map((n) => start + n * step);
    out.push(
      mc(
        ref('patt'),
        g,
        'patterns',
        d,
        `What comes next: ${seq.join(', ')}, ...?`,
        start + 4 * step,
        [start + 5 * step, start + 4 * step + 1, start + 3 * step + 2],
        `The pattern adds ${step} each time: ${seq[3]} + ${step} = ${start + 4 * step}.`,
      ),
    );
  }

  // Measurement
  if (d === 1) {
    const m = 2 + (i % 8);
    out.push(
      mc(
        ref('meas'),
        g,
        'measurement',
        d,
        `How many centimetres are in ${m} metres?`,
        m * 100,
        [m * 10, m * 1000, m + 100],
        `1 metre is 100 cm, so ${m} metres is ${m * 100} cm.`,
      ),
    );
  } else if (d === 2) {
    const hrs = 1 + (i % 3);
    const mins = 5 * (1 + (i % 11));
    out.push(
      mc(
        ref('meas'),
        g,
        'measurement',
        d,
        `How many minutes are in ${hrs} hours and ${mins} minutes?`,
        hrs * 60 + mins,
        [hrs * 100 + mins, hrs * 60, hrs + mins],
        `${hrs} hours is ${hrs * 60} minutes; add ${mins} to get ${hrs * 60 + mins}.`,
      ),
    );
  } else {
    const kg = 2 + (i % 4);
    const g2 = 250 * (1 + (i % 3));
    out.push(
      mc(
        ref('meas'),
        g,
        'measurement',
        d,
        `A bag holds ${kg} kg. You remove ${g2} g. How many grams remain?`,
        kg * 1000 - g2,
        [kg * 1000 + g2, kg * 100 - g2, kg * 1000],
        `${kg} kg is ${kg * 1000} g, and ${kg * 1000} − ${g2} = ${kg * 1000 - g2} g.`,
      ),
    );
  }

  // Logic
  const p = 5 + ((i + g) % 7);
  if (d === 1) {
    out.push(
      mc(
        ref('logic'),
        g,
        'logic',
        d,
        `Sam has ${p} marbles. Ana has 3 more than Sam. How many marbles does Ana have?`,
        p + 3,
        [p - 3, p * 3, p + 4],
        `"3 more than ${p}" means ${p} + 3 = ${p + 3}.`,
      ),
    );
  } else if (d === 2) {
    out.push(
      mc(
        ref('logic'),
        g,
        'logic',
        d,
        `There are ${p * 2} legs in a group of chickens. How many chickens are there?`,
        p,
        [p * 2, p + 2, p * 4],
        `Each chicken has 2 legs, so ${p * 2} ÷ 2 = ${p} chickens.`,
      ),
    );
  } else {
    const total = 20 + i + g;
    out.push(
      mc(
        ref('logic'),
        g,
        'logic',
        d,
        `Two numbers add to ${total} and differ by 4. What is the larger number?`,
        (total + 4) / 2,
        [(total - 4) / 2, total - 4, (total + 4) / 2 + 1],
        `Larger = (${total} + 4) ÷ 2 = ${(total + 4) / 2}.`,
      ),
    );
  }
  return out.filter(
    (q) =>
      Number.isInteger(Number(q.options.find((o) => o.id === q.correctOptionId)!.text)) ||
      q.topicSlug === 'fractions',
  );
}

/** perTopicPerGrade × 6 topics × 3 grades original questions. */
export function syntheticQuestions(perTopicPerGrade = 9): ImportQuestion[] {
  const out: ImportQuestion[] = [];
  for (const grade of [4, 5, 6]) {
    for (let i = 0; i < perTopicPerGrade; i++) {
      for (const q of templates(grade, i)) out.push({ schemaVersion: 1, locale: 'en', ...q });
    }
  }
  return out;
}
