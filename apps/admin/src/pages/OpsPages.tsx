import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import { useAuth } from '../auth';
import { ErrorBox } from '../components/Layout';

export function ImportPage() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<null | {
    importId: string;
    status: string;
    totalItems: number;
    createdCount: number;
    duplicateCount: number;
    errors: Array<{ index: number; code: string; message: string }>;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = (importId: string, tries = 0) => {
    api<NonNullable<typeof status>>('GET', `/v1/admin/imports/${importId}`)
      .then((s) => {
        setStatus(s);
        if ((s.status === 'pending' || s.status === 'processing') && tries < 60) {
          setTimeout(() => poll(importId, tries + 1), 1000);
        }
      })
      .catch((e) => setError(describeError(e)));
  };

  const submit = async () => {
    setError(null);
    setStatus(null);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      setError('The file is not valid JSON.');
      return;
    }
    try {
      const r = await api<{ importId: string }>('POST', '/v1/admin/imports', body);
      poll(r.importId);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <section>
      <h1>Import questions</h1>
      <p className="muted">
        Upload the documented JSON import format (docs/content-import.md). Items become drafts;
        nothing is published directly. Duplicates are detected by source reference and content hash.
      </p>
      <label htmlFor="import-file">JSON file</label>
      <input
        id="import-file"
        type="file"
        accept="application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(setText);
        }}
      />
      <label htmlFor="import-json">…or paste JSON</label>
      <textarea id="import-json" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={() => void submit()} disabled={!text.trim()}>
        Validate and import
      </button>
      <ErrorBox message={error} />
      {status && (
        <div className="panel" role="status">
          <p>
            <strong>{status.status}</strong> — {status.createdCount} drafts created,{' '}
            {status.duplicateCount} duplicates, {status.errors.length} issues of {status.totalItems}{' '}
            items.
          </p>
          {status.errors.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Code</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {status.errors.map((e) => (
                  <tr key={`${e.index}-${e.code}`}>
                    <td>#{e.index + 1}</td>
                    <td>
                      <code>{e.code}</code>
                    </td>
                    <td className="pre">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

interface Report {
  id: string;
  category: string;
  versionId: string | null;
  message: string | null;
  status: string;
  assignedTo: string | null;
  resolution: string | null;
  createdAt: string;
}

export function ReportsPage() {
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    status: string;
    resolution: string;
    reason: string;
  } | null>(null);

  const load = () =>
    api<{ items: Report[] }>(
      'GET',
      `/v1/admin/reports?limit=50${status ? `&status=${status}` : ''}`,
    )
      .then((r) => setItems(r.items))
      .catch((e) => setError(describeError(e)));
  useEffect(() => void load(), [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing) return;
    try {
      await api('PATCH', `/v1/admin/reports/${editing.id}`, {
        status: editing.status,
        assignToSelf: true,
        ...(editing.resolution ? { resolution: editing.resolution } : {}),
        reason: editing.reason,
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <section>
      <h1>Support reports</h1>
      <label>
        Status{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['open', 'in_progress', 'resolved', 'dismissed'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            <th scope="col">Received</th>
            <th scope="col">Category</th>
            <th scope="col">Question version</th>
            <th scope="col">Message</th>
            <th scope="col">Status</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
              <td>{r.category}</td>
              <td>
                {r.versionId ? (
                  <Link to={`/versions/${r.versionId}`}>{r.versionId.slice(0, 8)}</Link>
                ) : (
                  '—'
                )}
              </td>
              <td className="pre">{r.message ?? ''}</td>
              <td>{r.status}</td>
              <td>
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: r.id,
                      status: r.status === 'open' ? 'in_progress' : r.status,
                      resolution: r.resolution ?? '',
                      reason: '',
                    })
                  }
                >
                  Triage
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <div className="panel" role="dialog" aria-label="Triage report">
          <label>
            New status{' '}
            <select
              value={editing.status}
              onChange={(e) => setEditing({ ...editing, status: e.target.value })}
            >
              {['open', 'in_progress', 'resolved', 'dismissed'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label htmlFor="resolution">Resolution record</label>
          <textarea
            id="resolution"
            value={editing.resolution}
            onChange={(e) => setEditing({ ...editing, resolution: e.target.value })}
          />
          <label htmlFor="reason">Audit reason (required)</label>
          <input
            id="reason"
            value={editing.reason}
            onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
          />
          <div className="row">
            <button
              type="button"
              disabled={editing.reason.trim().length < 3}
              onClick={() => void save()}
            >
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function MetricsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(
    new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(today);
  const [m, setM] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Record<string, unknown>>('GET', `/v1/admin/metrics?from=${from}&to=${to}`)
      .then(setM)
      .catch((e) => setError(describeError(e)));
  }, [from, to]);
  const inv =
    (m?.contentInventory as Array<{ grade: number; published: number; status: string }>) ?? [];
  const jobs = m?.jobs as { pending: number; dead: number } | undefined;
  return (
    <section>
      <h1>Operational metrics</h1>
      <div className="filters">
        <label>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ErrorBox message={error} />
      {m && (
        <>
          <dl className="stats">
            <div>
              <dt>Children created</dt>
              <dd>{String(m.childrenCreated)}</dd>
            </div>
            <div>
              <dt>Activated (first session ≤ 7 days)</dt>
              <dd>
                {String(m.activated)} / {String(m.childrenCreated)}
              </dd>
            </div>
            <div>
              <dt>Sessions completed</dt>
              <dd>{String(m.sessionsCompleted)}</dd>
            </div>
            <div>
              <dt>Answers recorded</dt>
              <dd>{String(m.answersRecorded)}</dd>
            </div>
            <div>
              <dt>Open reports</dt>
              <dd>{String(m.openReports)}</dd>
            </div>
            <div>
              <dt>Jobs pending / dead</dt>
              <dd>
                {jobs?.pending} / {jobs?.dead}
              </dd>
            </div>
          </dl>
          <h2>Published inventory</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Grade</th>
                <th scope="col">Published</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {inv.map((i) => (
                <tr key={i.grade}>
                  <td>{i.grade}</td>
                  <td>{i.published}</td>
                  <td>{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="small muted">
            {(m.notes as string[]).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function AuditPage() {
  const [items, setItems] = useState<
    Array<{
      id: string;
      actor: string;
      action: string;
      targetType: string;
      targetId: string | null;
      reason: string | null;
      occurredAt: string;
    }>
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (next?: string) =>
    api<{ items: typeof items; nextCursor: string | null }>(
      'GET',
      `/v1/admin/audit?limit=50${next ? `&cursor=${next}` : ''}`,
    )
      .then((r) => {
        setItems((prev) => (next ? [...prev, ...r.items] : r.items));
        setCursor(r.nextCursor);
      })
      .catch((e) => setError(describeError(e)));
  useEffect(() => void load(), []);
  return (
    <section>
      <h1>Audit log</h1>
      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.occurredAt).toLocaleString()}</td>
              <td>{a.actor}</td>
              <td>{a.action}</td>
              <td>
                {a.targetType} {a.targetId?.slice(0, 8)}
              </td>
              <td>{a.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor && (
        <button type="button" onClick={() => void load(cursor)}>
          Load more
        </button>
      )}
    </section>
  );
}

export function StaffPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<Array<{ accountId: string; role: string; active: boolean }>>(
    [],
  );
  const [form, setForm] = useState({ accountId: '', role: 'editor', active: true, reason: '' });
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<{ staff: typeof staff }>('GET', '/v1/admin/staff')
      .then((r) => setStaff(r.staff))
      .catch((e) => setError(describeError(e)));
  useEffect(() => void load(), []);
  return (
    <section>
      <h1>Staff roles</h1>
      <p className="muted">
        Roles are server-controlled and audited. A person must sign in once before a role can be
        granted. Content roles never grant access to student records.
      </p>
      <ErrorBox message={error} />
      <table>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Role</th>
            <th scope="col">Active</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={`${s.accountId}-${s.role}`}>
              <td>
                <code>{s.accountId}</code>
                {s.accountId === user?.accountId && ' (you)'}
              </td>
              <td>{s.role}</td>
              <td>{s.active ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          api('POST', '/v1/admin/staff', form)
            .then(() => load())
            .catch((err) => setError(describeError(err)));
        }}
      >
        <h2>Grant or deactivate a role</h2>
        <label>
          Account id{' '}
          <input
            required
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
          />
        </label>
        <label>
          Role{' '}
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {['editor', 'reviewer', 'administrator', 'support'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />{' '}
          Active
        </label>
        <label>
          Reason{' '}
          <input
            required
            minLength={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </label>
        <button type="submit">Save role</button>
      </form>
    </section>
  );
}
