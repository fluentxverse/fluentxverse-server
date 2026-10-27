import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { isAllowedOrigin, isAllowedStudentOrigin } from '../config/cors';
import { verifyAuthToken, type JwtAuthPayload } from './jwt';
import { requestLimiter, type FixedWindowLimiter } from './atomicRateLimit';
import { edgeProtected, requestPolicy, type WorkClass } from '../../../shared/requestDefense';

const MAX_BUFFERED_BYTES = 128 * 1024 * 1024;
const CLASS_CONCURRENCY: Partial<Record<WorkClass, number>> = { upload: 1, proof: 1, ai: 2, assessment: 2, publicProof: 2 };
class Rejection extends Error { constructor(readonly status: number, message: string, readonly retryAfter?: number) { super(message); } }

export function trustedClientIP(request: Request, trustCloudflare: boolean) {
  const value = trustCloudflare ? request.headers.get('cf-connecting-ip') : null;
  if (value && (!isIP(value) || value.length > 64)) throw new Rejection(400, 'Invalid client address.');
  // X-Forwarded-For and X-Real-IP are never trusted as rate-limit identities.
  return value || 'origin-internal';
}

export function defenseResponse(request: Request, status: number, message: string, retryAfter?: number) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  if (retryAfter) headers.set('Retry-After', String(retryAfter));
  const origin = request.headers.get('origin'), path = new URL(request.url).pathname;
  if (origin && (path.startsWith('/student/') ? isAllowedStudentOrigin(origin) : isAllowedOrigin(origin))) {
    headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
  }
  return new Response(JSON.stringify({ success: false, error: message }), { status, headers });
}

export class RequestDefense {
  private active = 0;
  private bufferedBytes = 0;
  private classes = new Map<WorkClass, number>();
  private requests = new WeakMap<Request, { category: WorkClass; bytes: number; released: boolean; classAcquired: boolean }>();
  constructor(private dependencies: {
    limiter?: () => FixedWindowLimiter;
    verify?: (token: string) => Promise<JwtAuthPayload | null>;
    trustCloudflare?: boolean;
    bodyTimeoutMs?: number;
    maxActive?: number;
    maxBufferedBytes?: number;
  } = {}) {}

  release(request: Request) {
    const entry = this.requests.get(request);
    if (!entry || entry.released) return;
    entry.released = true;
    this.active--; this.bufferedBytes -= entry.bytes;
    if (entry.classAcquired) this.classes.set(entry.category, Math.max(0, (this.classes.get(entry.category) || 0) - 1));
    this.requests.delete(request);
  }
  private async actor(request: Request, roles?: readonly string[]) {
    const cookies = request.headers.get('cookie') || '';
    const verify = this.dependencies.verify || verifyAuthToken;
    let fallback: JwtAuthPayload | null = null;
    for (const name of ['adminAuth', 'tutorAuth', 'studentAuth']) {
      const value = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.slice(name.length + 1);
      if (!value) continue;
      let decoded: string; try { decoded = decodeURIComponent(value); } catch { continue; }
      const actor = await verify(decoded);
      const cookieRoles = name === 'adminAuth' ? ['admin', 'superadmin'] : name === 'tutorAuth' ? ['tutor'] : ['student'];
      if (!actor?.userId || !cookieRoles.includes(actor.role || '')) continue;
      if (!roles || roles.includes(actor.role || '')) return actor;
      fallback ??= actor;
    }
    return fallback;
  }

  async before(context: { request: Request }): Promise<Response | void> {
    const original = context.request;
    const path = new URL(original.url).pathname;
    const internalHealth = !original.headers.has('cf-connecting-ip') && original.method === 'GET' && ['/health', '/health/detailed'].includes(path);
    if (original.method === 'OPTIONS' || internalHealth) return;
    const policy = requestPolicy(path, original.method, original.headers.get('content-type') || '');
    const entry = { category: policy.category, bytes: 0, released: false, classAcquired: false };
    let admitted = false;
    try {
      if (this.active >= (this.dependencies.maxActive ?? 48)) throw new Rejection(503, 'Server is busy. Please retry shortly.', 3);
      this.active++; admitted = true; this.requests.set(original, entry);
      if (process.env.REQUIRE_EDGE_GUARD === 'true' && original.headers.has('cf-connecting-ip') && edgeProtected(path, original.method)) {
        const expected = Buffer.from(process.env.EDGE_SHARED_SECRET || ''), received = Buffer.from(original.headers.get('x-fxv-edge-token') || '');
        if (expected.length < 32 || received.length !== expected.length || !timingSafeEqual(expected, received)) throw new Rejection(403, 'Protected operations must pass through the application edge.');
      }
      const ip = trustedClientIP(original, this.dependencies.trustCloudflare ?? process.env.TRUST_CLOUDFLARE_TUNNEL === 'true');
      const headers = new Headers(original.headers);
      headers.set('x-forwarded-for', ip); headers.set('x-real-ip', ip);
      const normalized = new Request(original, { headers });
      this.requests.delete(original); this.requests.set(normalized, entry); context.request = normalized;
      const limiter = (this.dependencies.limiter || requestLimiter)();
      const consume = async (id: string, bucket: string, maximum: number) => {
        const result = await limiter.consume(id, bucket, { windowMs: 60000, maxRequests: maximum });
        if (!result.allowed) throw new Rejection(429, 'Request limit reached. Please retry shortly.', result.retryAfter || 1);
      };
      await consume('all', 'origin:global', 6000);
      await consume(ip, 'origin:network', 3000);
      const actor = await this.actor(normalized, policy.roles);
      if (policy.roles && (!actor || !policy.roles.includes(actor.role || ''))) throw new Rejection(actor ? 403 : 401, actor ? 'This account cannot perform this operation.' : 'Authentication required.');
      if (policy.category !== 'general') {
        await consume('all', 'origin:global:' + policy.category, policy.globalLimit);
        await consume(actor ? actor.role + ':' + actor.userId : ip, 'origin:actor:' + policy.category, policy.accountLimit);
      }
      const current = this.classes.get(policy.category) || 0, maximum = CLASS_CONCURRENCY[policy.category];
      // Only increment class counts after all shared admission checks passed.
      if (maximum && current >= maximum) throw new Rejection(503, 'This operation is busy. Please retry shortly.', 5);
      this.classes.set(policy.category, current + 1);
      entry.classAcquired = true;
      const lengthHeader = normalized.headers.get('content-length');
      if (lengthHeader !== null && !/^(0|[1-9][0-9]*)$/.test(lengthHeader)) throw new Rejection(400, 'Invalid request length.');
      const declared = lengthHeader === null ? null : Number(lengthHeader);
      if (declared !== null && (!Number.isSafeInteger(declared) || declared > policy.maxBytes)) throw new Rejection(413, 'Request body exceeds this endpoint limit.');
      if (!normalized.body) return;
      const reader = normalized.body.getReader(), chunks: Uint8Array[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const largeUpload = policy.category === 'upload' || (policy.category === 'assessment' && policy.maxBytes > 1024 * 1024);
      const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Rejection(408, 'Request body upload timed out.')); reader.cancel().catch(() => {}); }, this.dependencies.bodyTimeoutMs ?? (largeUpload ? 180000 : 20000)); });
      try {
        while (true) {
          const part = await Promise.race([reader.read(), expired]);
          if (part.done) break;
          entry.bytes += part.value.byteLength; this.bufferedBytes += part.value.byteLength;
          if (entry.bytes > policy.maxBytes) throw new Rejection(413, 'Request body exceeds this endpoint limit.');
          if (this.bufferedBytes > (this.dependencies.maxBufferedBytes ?? MAX_BUFFERED_BYTES)) throw new Rejection(503, 'Upload capacity is busy. Please retry shortly.', 3);
          chunks.push(part.value);
        }
        if (declared !== null && declared !== entry.bytes) throw new Rejection(400, 'Request length did not match its body.');
        const body = Buffer.concat(chunks, entry.bytes);
        const bounded = new Request(normalized.url, { method: normalized.method, headers: normalized.headers, body, signal: normalized.signal, redirect: normalized.redirect });
        this.requests.delete(normalized); this.requests.set(bounded, entry); context.request = bounded;
      } catch (error) { reader.cancel().catch(() => {}); throw error; }
      finally { clearTimeout(timer); reader.releaseLock(); }
    } catch (error) {
      if (admitted) this.release(context.request);
      context.request.body?.cancel().catch(() => {});
      // Refusal happens before route parsing, including when Content-Length is absent.
      return error instanceof Rejection ? defenseResponse(original, error.status, error.message, error.retryAfter)
        : defenseResponse(original, 503, 'Request protection is temporarily unavailable. Please retry shortly.', 5);
    }
  }
}

export const requestDefense = new RequestDefense();
