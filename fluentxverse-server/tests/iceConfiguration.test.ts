import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createIceConfigurationProvider } from '../src/socket/iceConfiguration';
import { webrtcHandler } from '../src/socket/handlers/webrtc.handler';

const cloudflareEnv = {
  TURN_PROVIDER: 'cloudflare',
  CLOUDFLARE_TURN_KEY_ID: 'test-key-id',
  CLOUDFLARE_TURN_API_TOKEN: 'server-only-test-secret',
};
const fixture = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53?transport=udp'],
      username: 'temporary-user', credential: 'temporary-credential', apiToken: 'must-not-be-returned',
    },
  ],
};

test('STUN-only mode uses Cloudflare without making an API request', async () => {
  const get = createIceConfigurationProvider({ env: () => ({}), request: async () => { throw new Error('Unexpected request'); } });
  expect(await get('student')).toEqual({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
});

test('explicit none keeps invalid or pending Cloudflare keys disabled', async () => {
  const get = createIceConfigurationProvider({ env: () => ({ ...cloudflareEnv, TURN_PROVIDER: 'none' }), request: async () => { throw new Error('Unexpected request'); } });
  expect((await get('student')).iceServers).toHaveLength(1);
});

test('Cloudflare receives the server token and TTL but only temporary credentials reach clients', async () => {
  let url = '';
  let options: RequestInit | undefined;
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async (input, init) => {
    url = input; options = init;
    return Response.json(fixture, { status: 201 });
  } });
  const config = await get('student');
  expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/test-key-id/credentials/generate-ice-servers');
  expect(options?.method).toBe('POST');
  expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer server-only-test-secret');
  expect(JSON.parse(options?.body as string)).toEqual({ ttl: 7200 });
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  expect(config.iceServers[1]).toEqual({ urls: fixture.iceServers[1]!.urls!.slice(0, 3), username: 'temporary-user', credential: 'temporary-credential' });
  expect(JSON.stringify(config)).not.toContain('server-only-test-secret');
  expect(JSON.stringify(config)).not.toContain('must-not-be-returned');
});

test('parallel requests share one fetch; users do not share the credential cache', async () => {
  let calls = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => {
    calls++; await waiting; return Response.json(fixture);
  } });
  const first = get('student');
  const duplicate = get('student');
  expect(calls).toBe(1);
  release();
  expect(await first).toEqual(await duplicate);
  await get('student');
  expect(calls).toBe(1);
  await get('tutor');
  expect(calls).toBe(2);
});

test('cached settings expire after sixty seconds and key rotation invalidates them', async () => {
  let now = 0;
  let calls = 0;
  const settings = { ...cloudflareEnv };
  const get = createIceConfigurationProvider({ env: () => settings, now: () => now, request: async () => { calls++; return Response.json(fixture); } });
  await get('student');
  now = 59_999;
  await get('student');
  expect(calls).toBe(1);
  now = 60_000;
  await get('student');
  expect(calls).toBe(2);
  settings.CLOUDFLARE_TURN_API_TOKEN = 'rotated-server-token';
  await get('student');
  expect(calls).toBe(3);
});

test('upstream failures are sanitized, not cached, and can be retried', async () => {
  let calls = 0;
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => {
    if (++calls === 1) return Response.json({ error: 'server-only-test-secret' }, { status: 404 });
    return Response.json(fixture);
  } });
  await expect(get('student')).rejects.toThrow('Cloudflare TURN credential request failed (HTTP 404)');
  expect((await get('student')).iceServers).toHaveLength(2);
  expect(calls).toBe(2);
});

test('network errors cannot leak request secrets', async () => {
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => { throw new Error('server-only-test-secret'); } });
  await expect(get('student')).rejects.toThrow('Cloudflare TURN credential request timed out or could not connect');
});

test('invalid responses and STUN-only responses cannot report a working relay', async () => {
  for (const data of [null, {}, { iceServers: [] }, { iceServers: [{ urls: 'turn:turn.cloudflare.com:3478' }] }, { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }]) {
    const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => Response.json(data) });
    await expect(get('student')).rejects.toThrow();
  }
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => new Response('invalid json') });
  await expect(get('student')).rejects.toThrow('Cloudflare TURN returned invalid JSON');
});

test('missing credentials, invalid TTL, and unknown providers fail without a fetch', async () => {
  for (const env of [
    { TURN_PROVIDER: 'cloudflare' },
    { CLOUDFLARE_TURN_KEY_ID: 'id' },
    { ...cloudflareEnv, CLOUDFLARE_TURN_TTL_SECONDS: 'NaN' },
    { ...cloudflareEnv, CLOUDFLARE_TURN_TTL_SECONDS: '300' },
    { TURN_PROVIDER: 'unsupported' },
    { TURN_PROVIDER: 'coturn', TURN_URLS: 'turn:example.invalid' },
  ]) {
    const get = createIceConfigurationProvider({ env: () => env, request: async () => { throw new Error('Unexpected fetch'); } });
    await expect(get('student')).rejects.toThrow();
  }
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv });
  await expect(get('')).rejects.toThrow('An authenticated user is required');
});

test('configured TTL is passed upstream and Cloudflare takes precedence over coturn in auto mode', async () => {
  let ttl = 0;
  const get = createIceConfigurationProvider({
    env: () => ({ ...cloudflareEnv, TURN_PROVIDER: '', TURN_URLS: 'turn:legacy.invalid', TURN_SHARED_SECRET: 'legacy', CLOUDFLARE_TURN_TTL_SECONDS: '3600' }),
    request: async (_url, init) => { ttl = JSON.parse(init.body as string).ttl; return Response.json(fixture); },
  });
  expect((await get('student')).iceServers[1]!.username).toBe('temporary-user');
  expect(ttl).toBe(3600);
});

test('legacy coturn HMAC credentials are still supported', async () => {
  const get = createIceConfigurationProvider({ env: () => ({ TURN_URLS: 'turn:legacy.invalid:3478', TURN_SHARED_SECRET: 'legacy' }), now: () => 0 });
  const relay = (await get('student')).iceServers[1]!;
  expect(relay.username).toBe('3600:student');
  expect(relay.credential).toBe(createHmac('sha1', 'legacy').update('3600:student').digest('base64'));
});

test('the credential cache is bounded', async () => {
  let calls = 0;
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => { calls++; return Response.json(fixture); } });
  for (let i = 0; i <= 1000; i++) await get(`user-${i}`);
  await get('user-0');
  expect(calls).toBe(1002);
});

function register(getConfiguration: ReturnType<typeof createIceConfigurationProvider>, room?: string) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const socket: any = { data: { userId: 'student', sessionId: room }, rooms: new Set(room ? [room] : []), on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler) };
  webrtcHandler({} as any, socket, getConfiguration);
  return { socket, request: handlers.get('webrtc:ice-config')! };
}

test('relay credentials require actual authorized room membership', async () => {
  let calls = 0;
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => { calls++; return Response.json(fixture); } });
  const { socket, request } = register(get);
  let result: any;
  await request((data: any) => { result = data; });
  expect(result.error).toBeDefined();
  socket.data.sessionId = 'stale-room';
  await request((data: any) => { result = data; });
  expect(calls).toBe(0);
  socket.rooms.add('stale-room');
  await request((data: any) => { result = data; });
  expect(calls).toBe(1);
  expect(result.iceServers).toHaveLength(2);
  expect(result.error).toBeUndefined();
});

test('leaving the room during upstream fetch prevents credential delivery', async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const get = createIceConfigurationProvider({ env: () => cloudflareEnv, request: async () => { await waiting; return Response.json(fixture); } });
  const { socket, request } = register(get, 'lesson-room');
  let result: any;
  const pending = request((data: any) => { result = data; });
  socket.rooms.clear();
  release();
  await pending;
  expect(result).toEqual({ iceServers: [], error: 'Call setup was cancelled.' });
});
