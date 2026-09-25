import type { AuthAdminPort, Logger } from '../ports.js';

/** Development adapter: records the deletion instead of calling Supabase Auth. */
export class MockAuthAdmin implements AuthAdminPort {
  readonly driver = 'mock';
  readonly deleted: string[] = [];
  constructor(private readonly log: Logger) {}
  async deleteUser(accountId: string) {
    this.deleted.push(accountId);
    this.log.info({ accountId }, 'auth identity deletion (mock driver)');
  }
  readonly emails = new Map<string, string>();
  async getUserEmail(accountId: string) {
    return this.emails.get(accountId) ?? null;
  }
}

/** Supabase Auth admin API. Requires a server credential with admin rights. */
export class SupabaseAuthAdmin implements AuthAdminPort {
  readonly driver = 'supabase';
  constructor(
    private readonly supabaseUrl: string,
    private readonly serverCredential: string,
  ) {}
  async deleteUser(accountId: string) {
    const res = await fetch(
      `${this.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(accountId)}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${this.serverCredential}`,
          apikey: this.serverCredential,
        },
      },
    );
    if (!res.ok && res.status !== 404) throw new Error(`auth admin delete failed: ${res.status}`);
  }
  async getUserEmail(accountId: string) {
    const res = await fetch(
      `${this.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(accountId)}`,
      {
        headers: {
          authorization: `Bearer ${this.serverCredential}`,
          apikey: this.serverCredential,
        },
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`auth admin lookup failed: ${res.status}`);
    const body = (await res.json()) as { email?: string; email_confirmed_at?: string | null };
    return body.email && body.email_confirmed_at ? body.email : null;
  }
}
