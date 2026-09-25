import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { constantTimeEqual, hmacHex, sha256Hex } from '../crypto.js';
import type { StoragePort } from '../ports.js';

/**
 * DEVELOPMENT/TEST MOCK of private object storage. Objects live on local disk; URLs are
 * HMAC-signed and expire, and are served by the API's /v1/media/local routes, which exist only
 * when STORAGE_DRIVER=local and ENVIRONMENT is not production.
 */
export class LocalStorage implements StoragePort {
  readonly driver = 'local';
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly secret: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(rootDir);
  }

  private pathFor(objectKey: string): string {
    if (!/^[a-zA-Z0-9/_.-]{1,300}$/.test(objectKey) || objectKey.includes('..')) {
      throw new Error('invalid object key');
    }
    const p = resolve(this.root, objectKey);
    if (!p.startsWith(this.root + sep)) throw new Error('invalid object key');
    return p;
  }

  sign(purpose: 'get' | 'put', objectKey: string, exp: number, extra = ''): string {
    return hmacHex(this.secret, `${purpose}\n${objectKey}\n${exp}\n${extra}`);
  }

  verify(purpose: 'get' | 'put', objectKey: string, exp: number, sig: string, extra = ''): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
    return constantTimeEqual(this.sign(purpose, objectKey, exp, extra), sig);
  }

  async signedDownloadUrl(objectKey: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign('get', objectKey, exp);
    return {
      url: `${this.publicBaseUrl}/v1/media/local/${encodeURIComponent(objectKey)}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  async signedUploadUrl(
    objectKey: string,
    opts: { mime: string; byteSize: number; ttlSeconds: number },
  ) {
    const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds;
    const extra = `${opts.mime}\n${opts.byteSize}`;
    const sig = this.sign('put', objectKey, exp, extra);
    const q = new URLSearchParams({
      exp: String(exp),
      sig,
      mime: opts.mime,
      size: String(opts.byteSize),
    });
    return {
      url: `${this.publicBaseUrl}/v1/media/local-upload/${encodeURIComponent(objectKey)}?${q}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  async inspect(objectKey: string) {
    const p = this.pathFor(objectKey);
    try {
      const [s, body, meta] = await Promise.all([
        stat(p),
        readFile(p),
        readFile(`${p}.meta.json`, 'utf8'),
      ]);
      return {
        byteSize: s.size,
        mime: (JSON.parse(meta) as { mime: string }).mime,
        sha256: sha256Hex(body),
      };
    } catch {
      return null;
    }
  }

  async read(objectKey: string): Promise<{ body: Buffer; mime: string } | null> {
    const p = this.pathFor(objectKey);
    try {
      const [body, meta] = await Promise.all([readFile(p), readFile(`${p}.meta.json`, 'utf8')]);
      return { body, mime: (JSON.parse(meta) as { mime: string }).mime };
    } catch {
      return null;
    }
  }

  async put(objectKey: string, body: Buffer, mime: string) {
    const p = this.pathFor(objectKey);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    await writeFile(`${p}.meta.json`, JSON.stringify({ mime }));
  }

  async remove(objectKeys: string[]) {
    for (const key of objectKeys) {
      const p = this.pathFor(key);
      await rm(p, { force: true });
      await rm(`${p}.meta.json`, { force: true });
    }
  }
}

export function localStorageRoot(dir: string, cwd = process.cwd()): string {
  return resolve(cwd, dir);
}
