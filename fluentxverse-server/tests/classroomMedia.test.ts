import { expect, test } from 'bun:test';
import { RealtimeKitClient, desiredMediaProvider, opaqueMediaId } from '../src/services/realtimekit.client';
import { ClassroomMediaService, type MediaRoom, type MediaRoomStore } from '../src/services/classroomMedia.service';
import { classroomMediaHandler } from '../src/socket/handlers/classroomMedia.handler';

const env = { CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_RTK_APP_ID: 'app', CLOUDFLARE_RTK_API_TOKEN: 'server-secret' };
const now = 1_800_000;
const schedule = { startsAt: now - 60_000, endsAt: now + 60_000 };

class Store implements MediaRoomStore {
  rooms = new Map<string, MediaRoom>();
  queue = Promise.resolve();
  async pin(id: string, provider: MediaRoom['provider'], endsAt: number, owner_id: string, owner_role: MediaRoom['owner_role']) {
    if (!this.rooms.has(id)) this.rooms.set(id, { booking_id: id, provider, ends_at: new Date(endsAt),
      owner_id, owner_role, meeting_id: null, closed: false, participant_ids: {} });
    return this.rooms.get(id)!.provider;
  }
  async locked<T>(id: string, work: (room: MediaRoom) => Promise<T>) {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const room = structuredClone(this.rooms.get(id)!);
      const result = await work(room);
      this.rooms.set(id, room);
      return result;
    } finally { release(); }
  }
  async openRooms() { return [...this.rooms.values()].filter(room => room.provider === 'realtimekit' && !room.closed); }
  async requestClose(id: string) { this.rooms.get(id)!.ends_at = new Date(0); }
}

function setup(options: { authorized?: () => boolean; clock?: () => number; fail?: () => boolean } = {}) {
  const store = new Store();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new RealtimeKitClient(() => env, async (url, init) => {
    calls.push({ url, init });
    if (options.fail?.()) return Response.json({ secret: 'server-secret' }, { status: 503 });
    if (init.method === 'GET') return Response.json({ success: true, data: [] });
    if (url.endsWith('/participants')) return Response.json({ success: true, data: { id: `p-${calls.length}`, token: 'participant-token' } });
    if (url.endsWith('/token')) return Response.json({ success: true, data: { token: 'refreshed-token' } });
    return Response.json({ success: true, data: { id: 'meeting-one' } });
  });
  const media = new ClassroomMediaService(store, client, async (_id, userId, role) =>
    options.authorized?.() === false || userId !== `${role}-one` ? null : schedule,
    options.clock || (() => now), () => 'realtimekit');
  return { store, calls, client, media };
}

test('migration defaults to WebRTC; pilots only match complete booking IDs', () => {
  expect(desiredMediaProvider('a', {})).toBe('webrtc');
  expect(desiredMediaProvider('a', { CLOUDFLARE_RTK_PILOT_BOOKING_IDS: ' aa, a , b ' })).toBe('realtimekit');
  expect(desiredMediaProvider('ab', { CLOUDFLARE_RTK_PILOT_BOOKING_IDS: 'a,b' })).toBe('webrtc');
  expect(desiredMediaProvider('a', { CLASSROOM_MEDIA_PROVIDER: 'realtimekit' })).toBe('realtimekit');
  expect(() => desiredMediaProvider('a', { CLASSROOM_MEDIA_PROVIDER: 'invalid' })).toThrow();
});

test('provider remains pinned when rollout settings change', async () => {
  const { store, media } = setup();
  await store.pin('booking', 'webrtc', schedule.endsAt, 'student-one', 'student');
  expect(await media.provider('booking', 'tutor-one', 'tutor', schedule.endsAt)).toBe('webrtc');
});

test('concurrent student and tutor requests share one meeting and reuse participant IDs', async () => {
  const { media, calls, store } = setup();
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  const results = await Promise.all([media.credentials('booking', 'student-one', 'student'), media.credentials('booking', 'tutor-one', 'tutor')]);
  expect(calls.filter(call => call.url.endsWith('/meetings'))).toHaveLength(1);
  expect(calls.filter(call => call.url.endsWith('/participants'))).toHaveLength(2);
  expect(results.every(result => result.token === 'participant-token')).toBe(true);
  const refreshed = await media.credentials('booking', 'student-one', 'student');
  expect(refreshed.token).toBe('refreshed-token');
  expect(calls.filter(call => call.url.endsWith('/participants'))).toHaveLength(2);
  expect(JSON.stringify(results)).not.toContain('server-secret');
  expect(JSON.stringify(store.rooms.get('booking'))).not.toContain('participant-token');
});

test('only opaque IDs and generic role names reach Cloudflare; recording is disabled', async () => {
  const { media, calls } = setup();
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  await media.credentials('booking', 'student-one', 'student');
  const create = JSON.parse(String(calls.find(call => call.url.endsWith('/meetings') && call.init.method === 'POST')!.init.body));
  expect(create.record_on_start).toBe(false);
  expect(create.persist_chat).toBe(false);
  expect(create.title).toBe(`fxv-${opaqueMediaId('booking')}`);
  const participant = JSON.parse(String(calls.find(call => call.url.endsWith('/participants') && call.init.method === 'POST')!.init.body));
  expect(participant.preset_name).toBe('group_call_participant');
  expect(participant.name).toBe('Student');
  expect(participant.custom_participant_id).not.toContain('student-one');
  expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer server-secret');
  expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
});

test('unassigned users are rejected before any upstream request', async () => {
  const { media, calls } = setup();
  await expect(media.credentials('booking', 'another-student', 'student')).rejects.toThrow('not available');
  expect(calls).toHaveLength(0);
});

test('waiting room and expired lessons cannot obtain media credentials', async () => {
  for (const clock of [schedule.startsAt - 1, schedule.endsAt + 180_000]) {
    const { media, calls } = setup({ clock: () => clock });
    await expect(media.credentials('booking', 'student-one', 'student')).rejects.toThrow('not available');
    expect(calls).toHaveLength(0);
  }
});

test('cancellation during upstream provisioning withholds the token and closes the stored meeting', async () => {
  let checks = 0;
  const { media, store, calls } = setup({ authorized: () => ++checks < 3 });
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  await expect(media.credentials('booking', 'student-one', 'student')).rejects.toThrow('not available');
  expect(store.rooms.get('booking')!.closed).toBe(true);
  expect(calls.some(call => call.init.method === 'PATCH' && JSON.parse(String(call.init.body)).status === 'INACTIVE')).toBe(true);
});

test('provider failures do not expose upstream secrets or silently fall back to WebRTC', async () => {
  const { media, store } = setup({ fail: () => true });
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  await expect(media.credentials('booking', 'student-one', 'student')).rejects.toThrow('HTTP 503');
  expect(store.rooms.get('booking')!.provider).toBe('realtimekit');
});

test('expiry reconciliation closes calls and rejects old booking tokens', async () => {
  let clock = now;
  const { media, store } = setup({ clock: () => clock });
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  await media.credentials('booking', 'student-one', 'student');
  clock = schedule.endsAt + 180_000;
  await media.reconcile();
  expect(store.rooms.get('booking')!.closed).toBe(true);
  await expect(media.credentials('booking', 'student-one', 'student')).rejects.toThrow();
});

test('failed tutor-end closure remains due for the reconciliation retry', async () => {
  let fail = false;
  const { media, store } = setup({ fail: () => fail });
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  await media.credentials('booking', 'student-one', 'student');
  fail = true;
  await expect(media.close('booking')).rejects.toThrow();
  expect(store.rooms.get('booking')!.closed).toBe(false);
  fail = false;
  await media.reconcile();
  expect(store.rooms.get('booking')!.closed).toBe(true);
});

test('network errors are sanitized even if their message contains credentials', async () => {
  const client = new RealtimeKitClient(() => env, async () => { throw new Error('server-secret'); });
  await expect(client.createMeeting('booking')).rejects.toThrow('RealtimeKit request failed or timed out');
});

test('provisioning recovers matching provider resources after an interrupted local write', async () => {
  const calls: string[] = [];
  const client = new RealtimeKitClient(() => env, async (url, init) => {
    calls.push(init.method!);
    const data = url.includes('/meetings?') ? [{ id: 'recovered-meeting', title: `fxv-${opaqueMediaId('booking')}`, status: 'ACTIVE' }]
      : url.includes('/participants?') ? [{ id: 'recovered-student', custom_participant_id: opaqueMediaId('recovered-meeting:student:student-one') }]
      : { token: 'new-participant-token' };
    return Response.json({ success: true, data });
  });
  expect(await client.ensureMeeting('booking')).toBe('recovered-meeting');
  expect(await client.ensureParticipant('recovered-meeting', 'student-one', 'student')).toEqual({ id: 'recovered-student', token: 'new-participant-token' });
  expect(calls).toEqual(['GET', 'GET', 'POST']);
});

test('inactive or ambiguous recovered meetings cannot be reopened', async () => {
  for (const meetings of [
    [{ id: 'old', title: `fxv-${opaqueMediaId('booking')}`, status: 'INACTIVE' }],
    [{ id: 'one', title: `fxv-${opaqueMediaId('booking')}`, status: 'ACTIVE' }, { id: 'two', title: `fxv-${opaqueMediaId('booking')}`, status: 'ACTIVE' }],
  ]) {
    const client = new RealtimeKitClient(() => env, async () => Response.json({ success: true, data: meetings }));
    await expect(client.ensureMeeting('booking')).rejects.toThrow();
  }
});

function socketFixture(joined = true, role = 'student') {
  const handlers: Record<string, Function> = {};
  const socket = { data: { sessionId: joined ? 'booking' : undefined, userId: 'student-one', userType: role },
    rooms: new Set(joined ? ['booking'] : []), connected: true,
    on: (event: string, handler: Function) => { handlers[event] = handler; } };
  return { socket, handlers };
}

test('socket endpoint rejects missing room membership and admins', async () => {
  for (const fixture of [socketFixture(false), socketFixture(true, 'admin')]) {
    const { media, calls } = setup();
    classroomMediaHandler({} as any, fixture.socket as any, media);
    let result: any;
    await fixture.handlers['classroom:media-token']!((value: any) => { result = value; });
    expect(result.error).toContain('authorized classroom');
    expect(calls).toHaveLength(0);
  }
});

test('leaving the room while credentials load prevents token delivery', async () => {
  const fixture = socketFixture();
  const { media } = setup();
  await media.provider('booking', 'student-one', 'student', schedule.endsAt);
  const credentials = media.credentials.bind(media);
  media.credentials = async (...args) => { const result = await credentials(...args); fixture.socket.rooms.clear(); return result; };
  classroomMediaHandler({} as any, fixture.socket as any, media);
  let result: any;
  await fixture.handlers['classroom:media-token']!((value: any) => { result = value; });
  expect(result).toEqual({ error: 'Call setup was cancelled.' });
});
