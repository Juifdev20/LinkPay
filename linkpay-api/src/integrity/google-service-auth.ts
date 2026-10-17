import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * OAuth access tokens for a Google service account, without a Google client library: the signed
 * JWT-bearer assertion Google documents (RS256), cached until shortly before it expires.
 */
export class GoogleServiceAuth {
  private cached: { token: string; until: number } | null = null;

  constructor(
    private readonly clientEmail: string,
    private readonly privateKey: string,
    private readonly scope: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private b64url(input: Buffer | string) {
    return Buffer.from(input).toString('base64url');
  }

  assertion(now = Date.now()): string {
    const iat = Math.floor(now / 1000);
    const header = this.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = this.b64url(JSON.stringify({ iss: this.clientEmail, scope: this.scope, aud: TOKEN_URL, iat, exp: iat + 3600 }));
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.privateKey.replace(/\\n/g, '\n'));
    return `${header}.${claims}.${this.b64url(signature)}`;
  }

  async accessToken(now = Date.now()): Promise<string> {
    if (this.cached && now < this.cached.until) return this.cached.token;
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: this.assertion(now) }).toString(),
    });
    if (!res.ok) throw new Error(`Google token endpoint answered ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: body.access_token, until: now + Math.max(60, body.expires_in - 120) * 1000 };
    return body.access_token;
  }
}
