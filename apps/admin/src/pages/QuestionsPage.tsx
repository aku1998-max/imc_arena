import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import { useAuth } from '../auth';
import { ErrorBox } from '../components/Layout';

interface VersionSummary {
  id: string;
  questionId: string;
  versionNumber: number;
  state: string;
  grade: number;
  topicSlug: string;
  difficulty: number;
  authorId: string;
  updatedAt: string;
  stemPreview: string;
}

export function QuestionsPage({ reviewQueue = false }: { reviewQueue?: boolean }) {
  const { hasRole } = useAuth();
  const [state, setState] = useState('');
  const [grade, setGrade] = useState('');
  const [items, setItems] = useState<VersionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (next?: string) => {
    const q = new URLSearchParams({ limit: '25' });
    if (reviewQueue) q.set('reviewable', 'true');
    else if (state) q.set('state', state);
    if (grade) q.set('grade', grade);
    if (next) q.set('cursor', next);
    api<{ items: VersionSummary[]; nextCursor: string | null }>('GET', `/v1/admin/questions?${q}`)
      .then((r) => {
        setItems((prev) => (next ? [...prev, ...r.items] : r.items));
        setCursor(r.nextCursor);
        setError(null);
      })
      .catch((e) => setError(describeError(e)));
  };
  useEffect(() => load(), [state, grade, reviewQueue]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <div className="row">
        <h1>{reviewQueue ? 'Review queue' : 'Questions'}</h1>
        {!reviewQueue && hasRole('editor', 'administrator') && (
          <Link className="button" to="/questions/new">
            New question
          </Link>
        )}
      </div>
      {reviewQueue && <p className="muted">Versions awaiting review that you did not author.</p>}
      <div className="filters">
        {!reviewQueue && (
          <label>
            State{' '}
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All</option>
              {['draft', 'in_review', 'approved', 'published', 'retired'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Grade{' '}
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">All</option>
            {[4, 5, 6].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col">State</th>
            <th scope="col">Grade</th>
            <th scope="col">Topic</th>
            <th scope="col">Difficulty</th>
            <th scope="col">Version</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => (
            <tr key={v.id}>
              <td>
                <Link to={`/versions/${v.id}`}>{v.stemPreview || '(no text)'}</Link>
              </td>
              <td>
                <span className={`state state-${v.state}`}>{v.state}</span>
              </td>
              <td>{v.grade}</td>
              <td>{v.topicSlug}</td>
              <td>{v.difficulty}</td>
              <td>v{v.versionNumber}</td>
              <td>{new Date(v.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Nothing here yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {cursor && (
        <button type="button" onClick={() => load(cursor)}>
          Load more
        </button>
      )}
    </section>
  );
}
