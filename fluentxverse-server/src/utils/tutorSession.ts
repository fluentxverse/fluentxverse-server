import { serializeCookie, type Context } from 'elysia';
import { parseCookie } from 'elysia/cookies';
import { getCookieConfig, verifyAuthToken, type JwtAuthPayload } from './jwt';

// Browsers can send both the former domain cookie and the API-host cookie.
export async function resolveTutorSession(request: Request): Promise<JwtAuthPayload | null> {
  const candidates = (request.headers.get('cookie') || '')
    .split(';')
    .filter(part => part.trimStart().startsWith('tutorAuth='));
  let session: JwtAuthPayload | null = null;
  for (const candidate of candidates) {
    const jar = await parseCookie({ headers: {}, status: 200 }, candidate.trim());
    const raw = jar.tutorAuth?.value;
    if (typeof raw !== 'string') continue;
    const payload = await verifyAuthToken(raw);
    if (payload?.role !== 'tutor') continue;
    if (!session || (payload.iat ?? 0) > (session.iat ?? 0)) session = payload;
  }
  return session;
}

export function setTutorSessionCookie(set: Context['set'], token: string): void {
  const config = getCookieConfig(process.env.NODE_ENV === 'production');
  const headers = new Headers(set.headers as Record<string, string>);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  const active = serializeCookie({ tutorAuth: { value: token, ...config } });
  if (typeof active === 'string') headers.append('Set-Cookie', active);
  for (const domain of config.secure ? ['.fluentxverse.xyz', '.fluentxverse.com'] : []) {
    if (config.domain?.replace(/^\./, '') === domain.slice(1)) continue;
    const legacy = serializeCookie({ tutorAuth: {
      ...config, value: '', domain, maxAge: 0, expires: new Date(0),
    } });
    if (typeof legacy === 'string') headers.append('Set-Cookie', legacy);
  }
  set.headers = headers as unknown as Context['set']['headers'];
}

export function clearTutorSessionCookies(set: Context['set']): void {
  const config = getCookieConfig(process.env.NODE_ENV === 'production');
  const headers = new Headers(set.headers as Record<string, string>);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  const domains = new Set([undefined, config.domain]);
  if (config.secure) { domains.add('.fluentxverse.xyz'); domains.add('.fluentxverse.com'); }
  for (const domain of domains) {
    const expired = serializeCookie({ tutorAuth: {
      ...config, domain, value: '', maxAge: 0, expires: new Date(0),
    } });
    if (typeof expired === 'string') headers.append('Set-Cookie', expired);
  }
  set.headers = headers as unknown as Context['set']['headers'];
}
