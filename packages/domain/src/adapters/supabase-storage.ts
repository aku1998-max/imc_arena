import { createHash } from 'node:crypto';
import type { StoragePort } from '../ports.js';

/**
 * Supabase Storage (private bucket) over its REST API using the server credential.
 * Verify the endpoints against the Storage API version of the target project on staging before
 * relying on this adapter (see docs/decisions.md, D-012).
 */
export class SupabaseStorage implements StoragePort {
  readonly driver = 'supabase';

  constructor(
    private readonly supabaseUrl: string,
    private readonly serverCredential: string,
    private readonly bucket: string,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${this.serverCredential}`,
      apikey: this.serverCredential,
      ...extra,
    };
  }

  private objectPath(objectKey: string) {
    return `${encodeURIComponent(this.bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  }

  async signedDownloadUrl(objectKey: string, ttlSeconds: number) {
    const res = await fetch(
      `${this.supabaseUrl}/storage/v1/object/sign/${this.objectPath(objectKey)}`,
      {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      },
    );
    if (!res.ok) throw new Error(`storage sign failed: ${res.status}`);
    const body = (await res.json()) as { signedURL: string };
    return {
      url: `${this.supabaseUrl}/storage/v1${body.signedURL}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async signedUploadUrl(
    objectKey: string,
    opts: { mime: string; byteSize: number; ttlSeconds: number },
  ) {
    const res = await fetch(
      `${this.supabaseUrl}/storage/v1/object/upload/sign/${this.objectPath(objectKey)}`,
      { method: 'POST', headers: this.headers() },
    );
    if (!res.ok) throw new Error(`storage upload sign failed: ${res.status}`);
    const body = (await res.json()) as { url: string };
    return {
      url: `${this.supabaseUrl}/storage/v1${body.url}`,
      // Supabase signed upload URLs have a fixed lifetime; the asset stays pending until verified.
      expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000),
    };
  }

  async inspect(objectKey: string) {
    const res = await fetch(
      `${this.supabaseUrl}/storage/v1/object/authenticated/${this.objectPath(objectKey)}`,
      { headers: this.headers() },
    );
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`storage read failed: ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    return {
      byteSize: body.length,
      mime: res.headers.get('content-type') ?? 'application/octet-stream',
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  }

  async put(objectKey: string, body: Buffer, mime: string) {
    const res = await fetch(`${this.supabaseUrl}/storage/v1/object/${this.objectPath(objectKey)}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': mime, 'x-upsert': 'true' }),
      body,
    });
    if (!res.ok) throw new Error(`storage put failed: ${res.status}`);
  }

  async remove(objectKeys: string[]) {
    if (objectKeys.length === 0) return;
    const res = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}`,
      {
        method: 'DELETE',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ prefixes: objectKeys }),
      },
    );
    if (!res.ok) throw new Error(`storage delete failed: ${res.status}`);
  }
}
