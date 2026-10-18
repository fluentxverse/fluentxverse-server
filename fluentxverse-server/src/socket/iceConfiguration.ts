import { createHmac } from 'node:crypto';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfiguration {
  iceServers: IceServer[];
}

const STUN_URL = 'stun:stun.cloudflare.com:3478';
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 1000;

interface ProviderOptions {
  env?: () => Record<string, string | undefined>;
  now?: () => number;
  request?: (url: string, options: RequestInit) => Promise<Response>;
}

function readCloudflareConfiguration(data: unknown): IceConfiguration {
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).iceServers)) {
    throw new Error('Cloudflare TURN returned an invalid ICE configuration');
  }
  const iceServers: IceServer[] = [{ urls: STUN_URL }];
  for (const server of (data as any).iceServers) {
    if (!server || typeof server !== 'object') continue;
    const rawUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
    // Only copy relay fields, and exclude port 53 which browsers block.
    const urls = rawUrls.filter((url: unknown): url is string => typeof url === 'string'
      && /^turns?:[^\s]+$/i.test(url) && !/:53(?:\?|$)/.test(url));
    if (!urls.length || typeof server.username !== 'string' || !server.username
      || typeof server.credential !== 'string' || !server.credential) continue;
    iceServers.push({ urls, username: server.username, credential: server.credential });
  }
  if (iceServers.length === 1) throw new Error('Cloudflare TURN returned no usable relay credentials');
  return { iceServers };
}

export function createIceConfigurationProvider({
  env = () => process.env,
  now = () => Date.now(),
  request = (url, options) => fetch(url, options),
}: ProviderOptions = {}) {
  const cache = new Map<string, { expiresAt: number; promise: Promise<IceConfiguration> }>();
  let cacheSettings = '';

  return async (userId: string): Promise<IceConfiguration> => {
    const settings = env();
    const keyId = settings.CLOUDFLARE_TURN_KEY_ID?.trim();
    const apiToken = settings.CLOUDFLARE_TURN_API_TOKEN?.trim();
    const provider = settings.TURN_PROVIDER?.trim()
      || (keyId || apiToken ? 'cloudflare' : settings.TURN_URLS ? 'coturn' : 'none');

    if (provider === 'cloudflare') {
      if (!keyId || !apiToken) throw new Error('Cloudflare TURN key ID and API token are required');
      if (!userId) throw new Error('An authenticated user is required for TURN credentials');
      const ttl = Number(settings.CLOUDFLARE_TURN_TTL_SECONDS || 7200);
      if (!Number.isInteger(ttl) || ttl < 3600 || ttl > 86400) {
        throw new Error('Cloudflare TURN credential TTL must be between 3600 and 86400 seconds');
      }
      const signature = JSON.stringify([keyId, apiToken, ttl]);
      if (signature !== cacheSettings) { cache.clear(); cacheSettings = signature; }
      const cached = cache.get(userId);
      if (cached && cached.expiresAt > now()) return cached.promise;
      cache.delete(userId);
      for (const [id, entry] of cache) if (entry.expiresAt <= now()) cache.delete(id);
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);

      const pending = (async () => {
        let response: Response;
        try {
          response = await request(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ ttl }),
              signal: AbortSignal.timeout(5000),
            },
          );
        } catch {
          throw new Error('Cloudflare TURN credential request timed out or could not connect');
        }
        // Upstream bodies and request headers may contain secrets; do not log them.
        if (!response.ok) throw new Error(`Cloudflare TURN credential request failed (HTTP ${response.status})`);
        let data: unknown;
        try { data = await response.json(); }
        catch { throw new Error('Cloudflare TURN returned invalid JSON'); }
        return readCloudflareConfiguration(data);
      })();
      const entry = { expiresAt: Infinity, promise: pending };
      cache.set(userId, entry);
      void pending.then(
        () => { entry.expiresAt = now() + CACHE_MS; },
        () => { if (cache.get(userId) === entry) cache.delete(userId); },
      );
      return pending;
    }

    const iceServers: IceServer[] = [{ urls: STUN_URL }];
    if (provider === 'coturn') {
      const urls = settings.TURN_URLS?.split(',').map(url => url.trim()).filter(Boolean);
      const secret = settings.TURN_SHARED_SECRET;
      if (!urls?.length || !secret) throw new Error('TURN URLs and shared secret are required for coturn');
      const username = `${Math.floor(now() / 1000) + 3600}:${userId}`;
      iceServers.push({ urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') });
    } else if (provider !== 'none') {
      throw new Error('Unknown TURN provider');
    }
    return { iceServers };
  };
}

export const getIceConfiguration = createIceConfigurationProvider();
