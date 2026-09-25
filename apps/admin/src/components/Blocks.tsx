import type { ContentBlock, QuestionOption } from '@imc/contracts';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function Math({ latex, display, alt }: { latex: string; display: boolean; alt: string }) {
  // KaTeX builds markup from LaTeX itself (trust: false blocks \href/\url etc.); no raw HTML input.
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    output: 'htmlAndMathml',
  });
  return (
    <span
      role="math"
      aria-label={alt}
      className={display ? 'math-display' : 'math-inline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
    <div className="blocks">
      {blocks.map((b, i) => {
        if (b.type === 'text') return <p key={i}>{b.text}</p>;
        if (b.type === 'math')
          return <Math key={i} latex={b.latex} display={b.display} alt={b.alt} />;
        const a = assets[b.assetId];
        return a ? (
          <img key={i} src={a.url} alt={b.alt} className="diagram" />
        ) : (
          <p key={i} className="muted">
            [image {b.assetId.slice(0, 8)} not yet verified: {b.alt}]
          </p>
        );
      })}
    </div>
  );
}

export function OptionLabel({ option }: { option: QuestionOption }) {
  if (option.math)
    return <Math latex={option.math} display={false} alt={option.alt ?? option.math} />;
  return <>{option.text}</>;
}

/** Approximates the student question player at phone width. */
export function MobilePreview(props: {
  stemBlocks: ContentBlock[];
  options: QuestionOption[];
  correctOptionId: string | null;
  explanationBlocks: ContentBlock[];
  assets: Record<string, { url: string }>;
}) {
  return (
    <div className="phone" aria-label="Mobile preview">
      <div className="phone-screen">
        <div className="muted small">Question 1 of 5</div>
        <Blocks blocks={props.stemBlocks} assets={props.assets} />
        <ol className="phone-options">
          {props.options.map((o) => (
            <li
              key={o.id}
              className={o.id === props.correctOptionId ? 'phone-option correct' : 'phone-option'}
            >
              <span className="option-id">{o.id.toUpperCase()}</span> <OptionLabel option={o} />
              {o.id === props.correctOptionId && <span className="badge-correct"> ✓ correct</span>}
            </li>
          ))}
        </ol>
        <div className="phone-explanation">
          <strong>Explanation</strong>
          <Blocks blocks={props.explanationBlocks} assets={props.assets} />
        </div>
      </div>
    </div>
  );
}
