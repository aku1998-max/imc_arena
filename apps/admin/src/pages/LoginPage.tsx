import { useState, type FormEvent } from 'react';
import { devAuthEnabled, useAuth } from '../auth';
import { ErrorBox } from '../components/Layout';

export function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    fn().catch((err: Error) => setError(err.message));
  };

  return (
    <main className="login" id="main">
      <h1>IMC Arena staff sign-in</h1>
      <ErrorBox message={error ?? auth.error} />
      {auth.supabaseAvailable ? (
        !sent ? (
          <form
            onSubmit={run(async () => {
              await auth.sendOtp(email);
              setSent(true);
            })}
          >
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit">Send sign-in code</button>
          </form>
        ) : (
          <form onSubmit={run(() => auth.verifyOtp(email, code))}>
            <label htmlFor="code">Code sent to {email}</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit">Verify</button>
          </form>
        )
      ) : (
        <p className="muted">Email sign-in is not configured for this environment.</p>
      )}
      {devAuthEnabled && (
        <form onSubmit={run(() => auth.useDevToken(devToken))} className="dev-auth">
          <h2>Development sign-in</h2>
          <p className="muted small">
            Paste a token from <code>pnpm --filter @imc/api dev:token editor</code>. Disabled in
            production builds.
          </p>
          <label htmlFor="devtoken">Development token</label>
          <textarea
            id="devtoken"
            rows={3}
            value={devToken}
            onChange={(e) => setDevToken(e.target.value)}
          />
          <button type="submit">Use development token</button>
        </form>
      )}
    </main>
  );
}
