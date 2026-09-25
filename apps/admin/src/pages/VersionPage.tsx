import type { ContentBlock, QuestionOption } from '@imc/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../api';
import { useAuth } from '../auth';
import { MobilePreview } from '../components/Blocks';
import { ErrorBox } from '../components/Layout';

interface Topic {
  id: string;
  slug: string;
  displayKey: string;
  active: boolean;
}

interface VersionView {
  version: {
    id: string;
    questionId: string;
    versionNumber: number;
    state: string;
    grade: number;
    topicSlug: string;
    difficulty: number;
    authorId: string;
    approvedBy: string | null;
  };
  question: {
    id: string;
    sourceType: string;
    sourceReference: string | null;
    rightsStatus: string;
    rightsNotes: string | null;
  };
  localizations: Array<{
    locale: string;
    stemBlocks: ContentBlock[];
    options: QuestionOption[];
    explanationBlocks: ContentBlock[];
  }>;
  correctOptionId: string | null;
  contentHash: string;
  reviews: Array<{
    id: string;
    reviewerId: string;
    decision: string;
    comments: string | null;
    createdAt: string;
  }>;
  assets: Record<string, { url: string; expiresAt: string }>;
  publicationIssues: Array<{ code: string; message: string }>;
}

interface Draft {
  grade: number;
  topicSlug: string;
  difficulty: number;
  locale: string;
  stemBlocks: ContentBlock[];
  options: QuestionOption[];
  correctOptionId: string;
  explanationBlocks: ContentBlock[];
}

const emptyDraft = (): Draft => ({
  grade: 4,
  topicSlug: 'arithmetic',
  difficulty: 1,
  locale: 'en',
  stemBlocks: [{ type: 'text', text: '' }],
  options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: '' })),
  correctOptionId: 'a',
  explanationBlocks: [{ type: 'text', text: '' }],
});

async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function BlocksEditor({
  label,
  blocks,
  onChange,
  assets,
  onUpload,
}: {
  label: string;
  blocks: ContentBlock[];
  onChange: (b: ContentBlock[]) => void;
  assets: Record<string, { url: string }>;
  onUpload: (file: File, alt: string) => Promise<string>;
}) {
  const update = (i: number, b: ContentBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  return (
    <fieldset>
      <legend>{label}</legend>
      {blocks.map((b, i) => (
        <div key={i} className="block-row">
          <span className="muted small">{b.type}</span>
          {b.type === 'text' && (
            <textarea
              aria-label={`${label} text ${i + 1}`}
              rows={2}
              value={b.text}
              onChange={(e) => update(i, { ...b, text: e.target.value })}
            />
          )}
          {b.type === 'math' && (
            <>
              <input
                aria-label={`${label} LaTeX ${i + 1}`}
                placeholder="LaTeX, e.g. \frac{1}{2}"
                value={b.latex}
                onChange={(e) => update(i, { ...b, latex: e.target.value })}
              />
              <input
                aria-label={`${label} spoken alternative ${i + 1}`}
                placeholder="Spoken alternative (screen readers)"
                value={b.alt}
                onChange={(e) => update(i, { ...b, alt: e.target.value })}
              />
              <label className="small">
                <input
                  type="checkbox"
                  checked={b.display}
                  onChange={(e) => update(i, { ...b, display: e.target.checked })}
                />{' '}
                display
              </label>
            </>
          )}
          {b.type === 'image' && (
            <>
              <span className="small">
                {assets[b.assetId] ? 'verified image' : `image ${b.assetId.slice(0, 8)}`}
              </span>
              <input
                aria-label={`${label} image alt text ${i + 1}`}
                value={b.alt}
                onChange={(e) => update(i, { ...b, alt: e.target.value })}
              />
            </>
          )}
          <button
            type="button"
            className="link"
            onClick={() => onChange(blocks.filter((_, j) => j !== i))}
            disabled={blocks.length === 1}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="row small">
        <button type="button" onClick={() => onChange([...blocks, { type: 'text', text: '' }])}>
          + Text
        </button>
        <button
          type="button"
          onClick={() =>
            onChange([...blocks, { type: 'math', latex: '', alt: '', display: false }])
          }
        >
          + Math
        </button>
        <label className="upload">
          Image alt text{' '}
          <input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Describe without revealing the answer"
          />
        </label>
        <label className="button">
          {uploading ? 'Uploading…' : '+ Image'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={uploading || !alt.trim()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              setUploadError(null);
              onUpload(file, alt.trim())
                .then((assetId) =>
                  onChange([...blocks, { type: 'image', assetId, alt: alt.trim() }]),
                )
                .catch((err) => setUploadError(describeError(err)))
                .finally(() => setUploading(false));
            }}
          />
        </label>
      </div>
      <ErrorBox message={uploadError} />
    </fieldset>
  );
}

export function VersionPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [view, setView] = useState<VersionView | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [rights, setRights] = useState({
    sourceType: 'original',
    rightsStatus: 'cleared',
    rightsNotes: '',
    sourceReference: '',
  });
  const [comments, setComments] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [flagResults, setFlagResults] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newAssets, setNewAssets] = useState<Record<string, { url: string }>>({});
  const [audit, setAudit] = useState<
    Array<{ id: string; actor: string; action: string; occurredAt: string; reason: string | null }>
  >([]);

  const load = useCallback(async () => {
    if (!id) return;
    const v = await api<VersionView>('GET', `/v1/admin/versions/${id}`);
    setView(v);
    const loc = v.localizations.find((l) => l.locale === 'en') ?? v.localizations[0];
    if (loc) {
      setDraft({
        grade: v.version.grade,
        topicSlug: v.version.topicSlug,
        difficulty: v.version.difficulty,
        locale: loc.locale,
        stemBlocks: loc.stemBlocks,
        options: loc.options,
        correctOptionId: v.correctOptionId ?? 'a',
        explanationBlocks: loc.explanationBlocks,
      });
    }
    if (hasRole('administrator', 'support')) {
      api<{ items: typeof audit }>(
        'GET',
        `/v1/admin/audit?targetType=question_version&targetId=${id}`,
      )
        .then((r) => setAudit(r.items))
        .catch(() => setAudit([]));
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<{ topics: Topic[] }>('GET', '/v1/admin/topics')
      .then((r) => setTopics(r.topics.filter((t) => t.active)))
      .catch((e) => setError(describeError(e)));
    load().catch((e) => setError(describeError(e)));
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const upload = async (file: File, altText: string) => {
    const buf = await file.arrayBuffer();
    const intent = await api<{ assetId: string; uploadUrl: string }>(
      'POST',
      '/v1/admin/assets/upload-intent',
      {
        mime: file.type,
        byteSize: buf.byteLength,
        checksum: await sha256Hex(buf),
        altText,
      },
    );
    const put = await fetch(intent.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: buf,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    await api('POST', `/v1/admin/assets/${intent.assetId}/complete`);
    setNewAssets((a) => ({ ...a, [intent.assetId]: { url: URL.createObjectURL(file) } }));
    return intent.assetId;
  };

  const state = view?.version.state ?? 'draft';
  const editable = isNew || ['draft', 'in_review', 'approved'].includes(state);
  const canEdit = hasRole('editor', 'administrator') && editable;
  const isAuthor = view?.version.authorId === user?.accountId;
  const assets = { ...(view?.assets ?? {}), ...newAssets };

  const save = () =>
    act(async () => {
      if (isNew) {
        const created = await api<{ versionId: string }>('POST', '/v1/admin/questions', {
          sourceType: rights.sourceType,
          rightsStatus: rights.rightsStatus,
          ...(rights.rightsNotes ? { rightsNotes: rights.rightsNotes } : {}),
          ...(rights.sourceReference ? { sourceReference: rights.sourceReference } : {}),
          version: draft,
        });
        navigate(`/versions/${created.versionId}`);
      } else {
        await api('PATCH', `/v1/admin/versions/${id}`, draft);
      }
    }, 'Saved.');

  return (
    <section>
      <p>
        <Link to="/questions">← Questions</Link>
      </p>
      <div className="row">
        <h1>{isNew ? 'New question' : `Question v${view?.version.versionNumber ?? ''}`}</h1>
        {!isNew && <span className={`state state-${state}`}>{state}</span>}
      </div>
      <ErrorBox message={error} />
      {message && (
        <div role="status" className="ok">
          {message}
        </div>
      )}
      <div className="editor-grid">
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {isNew && (
            <fieldset>
              <legend>Source and rights</legend>
              <label>
                Source type{' '}
                <select
                  value={rights.sourceType}
                  onChange={(e) => setRights({ ...rights, sourceType: e.target.value })}
                >
                  <option value="original">original</option>
                  <option value="licensed">licensed</option>
                  <option value="imc_archive">imc_archive</option>
                </select>
              </label>
              <label>
                Source reference{' '}
                <input
                  value={rights.sourceReference}
                  onChange={(e) => setRights({ ...rights, sourceReference: e.target.value })}
                />
              </label>
              <label>
                Rights status{' '}
                <select
                  value={rights.rightsStatus}
                  onChange={(e) => setRights({ ...rights, rightsStatus: e.target.value })}
                >
                  <option value="cleared">cleared</option>
                  <option value="unknown">unknown</option>
                  <option value="restricted">restricted</option>
                </select>
              </label>
              <label>
                Rights notes{' '}
                <input
                  value={rights.rightsNotes}
                  onChange={(e) => setRights({ ...rights, rightsNotes: e.target.value })}
                />
              </label>
            </fieldset>
          )}
          {!isNew && view && (
            <p className="small muted">
              Source: {view.question.sourceType} {view.question.sourceReference ?? ''} · Rights:{' '}
              <strong>{view.question.rightsStatus}</strong>
            </p>
          )}
          <fieldset disabled={!canEdit}>
            <legend>Classification</legend>
            <label>
              Grade{' '}
              <select
                value={draft.grade}
                onChange={(e) => setDraft({ ...draft, grade: Number(e.target.value) })}
              >
                {[4, 5, 6].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Topic{' '}
              <select
                value={draft.topicSlug}
                onChange={(e) => setDraft({ ...draft, topicSlug: e.target.value })}
              >
                {topics.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.slug}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Difficulty{' '}
              <select
                value={draft.difficulty}
                onChange={(e) => setDraft({ ...draft, difficulty: Number(e.target.value) })}
              >
                <option value={1}>1 easy</option>
                <option value={2}>2 medium</option>
                <option value={3}>3 harder</option>
              </select>
            </label>
          </fieldset>
          <fieldset disabled={!canEdit} className="plain">
            <BlocksEditor
              label="Question"
              blocks={draft.stemBlocks}
              onChange={(stemBlocks) => setDraft({ ...draft, stemBlocks })}
              assets={assets}
              onUpload={upload}
            />
            <fieldset>
              <legend>Choices (select the correct one)</legend>
              {draft.options.map((o, i) => (
                <div key={o.id} className="block-row">
                  <input
                    type="radio"
                    name="correct"
                    aria-label={`Choice ${o.id.toUpperCase()} is correct`}
                    checked={draft.correctOptionId === o.id}
                    onChange={() => setDraft({ ...draft, correctOptionId: o.id })}
                  />
                  <label htmlFor={`opt-${o.id}`}>{o.id.toUpperCase()}</label>
                  <input
                    id={`opt-${o.id}`}
                    value={o.text ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        options: draft.options.map((x, j) =>
                          j === i ? { ...x, text: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
            <BlocksEditor
              label="Explanation"
              blocks={draft.explanationBlocks}
              onChange={(explanationBlocks) => setDraft({ ...draft, explanationBlocks })}
              assets={assets}
              onUpload={upload}
            />
          </fieldset>
          {canEdit && (
            <div className="row">
              <button type="submit">{isNew ? 'Create draft' : 'Save draft'}</button>
              {!isNew && state !== 'draft' && (
                <span className="small muted">
                  Saving returns this version to draft and clears its approval.
                </span>
              )}
            </div>
          )}
        </form>
        <aside>
          <h2>Mobile preview</h2>
          <MobilePreview {...draft} assets={assets} />
        </aside>
      </div>

      {view && (
        <div className="panels">
          {view.publicationIssues.length > 0 && (
            <section className="panel">
              <h2>Publication checks</h2>
              <ul>
                {view.publicationIssues.map((i, n) => (
                  <li key={n}>
                    <code>{i.code}</code> {i.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel">
            <h2>Workflow</h2>
            {state === 'draft' && hasRole('editor', 'administrator') && (
              <button
                type="button"
                onClick={() =>
                  void act(
                    () => api('POST', `/v1/admin/versions/${id}/submit-review`),
                    'Submitted for review.',
                  )
                }
              >
                Submit for review
              </button>
            )}
            {state === 'in_review' &&
              hasRole('reviewer', 'administrator') &&
              (isAuthor ? (
                <p className="muted">You authored this version; another reviewer must review it.</p>
              ) : (
                <div className="review">
                  <label htmlFor="comments">Review comments</label>
                  <textarea
                    id="comments"
                    rows={3}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                  />
                  <div className="row">
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          () =>
                            api('POST', `/v1/admin/versions/${id}/review`, {
                              decision: 'approve',
                              ...(comments ? { comments } : {}),
                            }),
                          'Approved.',
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void act(
                          () =>
                            api('POST', `/v1/admin/versions/${id}/review`, {
                              decision: 'request_changes',
                              comments,
                            }),
                          'Changes requested.',
                        )
                      }
                    >
                      Request changes
                    </button>
                  </div>
                </div>
              ))}
            {state === 'approved' && hasRole('administrator') && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      'Publish this version to students? Published versions cannot be edited.',
                    )
                  ) {
                    void act(() => api('POST', `/v1/admin/versions/${id}/publish`), 'Published.');
                  }
                }}
              >
                Publish
              </button>
            )}
            {state === 'published' && hasRole('editor', 'administrator') && (
              <button
                type="button"
                onClick={() =>
                  void act(async () => {
                    const r = await api<{ versionId: string }>(
                      'POST',
                      `/v1/admin/questions/${view.version.questionId}/versions`,
                    );
                    navigate(`/versions/${r.versionId}`);
                  }, 'Correction draft created.')
                }
              >
                Create correction draft
              </button>
            )}
            {state === 'published' && hasRole('administrator') && (
              <div className="retire">
                <label htmlFor="retire-reason">Retire reason</label>
                <input
                  id="retire-reason"
                  value={retireReason}
                  onChange={(e) => setRetireReason(e.target.value)}
                />
                <label className="small">
                  <input
                    type="checkbox"
                    checked={flagResults}
                    onChange={(e) => setFlagResults(e.target.checked)}
                  />{' '}
                  Answer key is wrong: halt active sessions and flag affected results
                </label>
                <button
                  type="button"
                  className="danger"
                  disabled={retireReason.trim().length < 3}
                  onClick={() =>
                    void act(
                      () =>
                        api('POST', `/v1/admin/versions/${id}/retire`, {
                          reason: retireReason,
                          flagAffectedResults: flagResults,
                        }),
                      'Retired from new selection.',
                    )
                  }
                >
                  Retire
                </button>
              </div>
            )}
          </section>
          <section className="panel">
            <h2>Reviews</h2>
            {view.reviews.length === 0 ? (
              <p className="muted">No reviews yet.</p>
            ) : (
              <ul>
                {view.reviews.map((r) => (
                  <li key={r.id}>
                    <strong>{r.decision}</strong> by {r.reviewerId.slice(0, 8)} on{' '}
                    {new Date(r.createdAt).toLocaleString()}
                    {r.comments && <> — {r.comments}</>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {audit.length > 0 && (
            <section className="panel">
              <h2>Audit history</h2>
              <ul className="small">
                {audit.map((a) => (
                  <li key={a.id}>
                    {new Date(a.occurredAt).toLocaleString()} · {a.action} · {a.actor}
                    {a.reason && <> · {a.reason}</>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
