import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const MOBILE_ISSUER = 'fluentxverse-mobile';
export const MOBILE_AUDIENCE = 'fluentxverse-student-mobile';
export const MOBILE_ACCESS_SECONDS = 15 * 60;
export const MOBILE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface MobileStudent {
  userId: string;
  role: 'student';
  email: string | null;
  givenName: string | null;
  familyName: string | null;
}

export interface MobileAccount extends MobileStudent {
  suspendedUntil?: string | null;
  signUpdate?: number;
}

export interface MobileSession {
  id: string;
  userId: string;
  createdAt: number;
  credentialVersion: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface MobileSessionStore {
  create(session: MobileSession, tokenHash: string): Promise<void>;
  find(id: string): Promise<MobileSession | null>;
  rotate(hash: string, nextHash: string, now: number): Promise<MobileSession | null>;
  revoke(id: string, now: number): Promise<void>;
  revokeByRefresh(hash: string, now: number): Promise<void>;
}

export class MobileAuthError extends Error {
  constructor(public readonly status: 401 | 403 | 503, message: string) { super(message); }
}

export const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');
const publicStudent = ({ userId, email, givenName, familyName }: MobileStudent): MobileStudent =>
  ({ userId, role: 'student', email, givenName, familyName });

export class MobileAuthService {
  private readonly key: Uint8Array;

  constructor(
    private readonly store: MobileSessionStore,
    private readonly findStudent: (id: string) => Promise<MobileAccount | null>,
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (Buffer.byteLength(secret) < 32) throw new MobileAuthError(503, 'Mobile authentication is not configured.');
    this.key = new TextEncoder().encode(secret);
  }

  async login(account: MobileAccount) {
    const now = this.now();
    const session: MobileSession = {
      id: randomUUID(), userId: account.userId, createdAt: now, credentialVersion: account.signUpdate ?? 0,
      expiresAt: now + MOBILE_SESSION_MS, revokedAt: null,
    };
    this.assertAccount(account, session);
    const refreshToken = randomBytes(32).toString('hex');
    await this.store.create(session, hashRefreshToken(refreshToken));
    return this.tokens(session, account, refreshToken);
  }

  async refresh(refreshToken: string) {
    if (!/^[a-f0-9]{64}$/.test(refreshToken)) throw new MobileAuthError(401, 'Invalid mobile session.');
    const nextToken = randomBytes(32).toString('hex');
    const session = await this.store.rotate(hashRefreshToken(refreshToken), hashRefreshToken(nextToken), this.now());
    if (!session) throw new MobileAuthError(401, 'Invalid or expired mobile session.');
    const account = await this.findStudent(session.userId);
    try { this.assertAccount(account, session); } catch (error) {
      await this.store.revoke(session.id, this.now());
      throw error;
    }
    return this.tokens(session, account!, nextToken);
  }

  async authenticate(authorization: string | null): Promise<MobileStudent> {
    if (!authorization?.startsWith('Bearer ')) throw new MobileAuthError(401, 'Mobile bearer token required.');
    let payload;
    try {
      ({ payload } = await jwtVerify(authorization.slice(7), this.key, {
        algorithms: ['HS256'], issuer: MOBILE_ISSUER, audience: MOBILE_AUDIENCE,
        typ: 'at+jwt', currentDate: new Date(this.now()),
        requiredClaims: ['sub', 'sid', 'iat', 'exp', 'role', 'purpose'],
      }));
    } catch { throw new MobileAuthError(401, 'Invalid or expired mobile access token.'); }
    if (payload.role !== 'student' || payload.purpose !== 'mobile_access' ||
        typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new MobileAuthError(401, 'Invalid mobile access token.');
    }
    const session = await this.store.find(payload.sid);
    if (!session || session.userId !== payload.sub || session.revokedAt !== null || session.expiresAt <= this.now()) {
      throw new MobileAuthError(401, 'Mobile session has expired.');
    }
    const account = await this.findStudent(session.userId);
    try { this.assertAccount(account, session); } catch (error) {
      await this.store.revoke(session.id, this.now());
      throw error;
    }
    return publicStudent(account!);
  }

  async logout(refreshToken: string) {
    if (/^[a-f0-9]{64}$/.test(refreshToken)) {
      await this.store.revokeByRefresh(hashRefreshToken(refreshToken), this.now());
    }
  }

  private assertAccount(account: MobileAccount | null, session: MobileSession): void {
    if (!account || account.role !== 'student' || account.userId !== session.userId ||
        (account.signUpdate ?? 0) !== session.credentialVersion) {
      throw new MobileAuthError(401, 'Please sign in again.');
    }
    if (account.suspendedUntil && new Date(account.suspendedUntil).getTime() > this.now()) {
      throw new MobileAuthError(403, 'Your student account is suspended.');
    }
  }

  private async tokens(session: MobileSession, account: MobileAccount, refreshToken: string) {
    const now = Math.floor(this.now() / 1000);
    const accessToken = await new SignJWT({ sid: session.id, role: 'student', purpose: 'mobile_access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setIssuer(MOBILE_ISSUER).setAudience(MOBILE_AUDIENCE).setSubject(account.userId)
      .setIssuedAt(now).setExpirationTime(now + MOBILE_ACCESS_SECONDS).sign(this.key);
    return {
      success: true as const, tokenType: 'Bearer' as const, accessToken, refreshToken,
      expiresIn: MOBILE_ACCESS_SECONDS, refreshExpiresAt: session.expiresAt,
      user: publicStudent(account),
    };
  }
}
