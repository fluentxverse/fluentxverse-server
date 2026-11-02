import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptedTutorIds, isAdult, nextManilaMidnight, identityCanBook, ID_BOOKING_WINDOW_MS, type TutorIdentityRecord } from '../../shared/tutorIdentity';
import { IdentityStorage } from '../src/services/tutorIdentity/storage';

test('all sixteen IDs remain accepted', () => { expect(acceptedTutorIds.length).toBe(16); expect(new Set(acceptedTutorIds.map(i => i[0])).size).toBe(16); });
test('adult boundary uses the Manila date and rejects invalid dates', () => {
  const now = Date.parse('2026-11-01T16:00:00Z');
  expect(isAdult('2008-11-02', now)).toBe(true);
  expect(isAdult('2008-11-03', now)).toBe(false);
  for (const invalid of ['2008-02-30', 'bad', '2028-01-01', '0001-01-01']) expect(isAdult(invalid, now)).toBe(false);
});
test('retention uses the next Manila midnight, including the exact boundary', () => {
  expect(nextManilaMidnight(Date.parse('2026-11-02T15:59:59Z'))).toBe('2026-11-02T16:00:00.000Z');
  expect(nextManilaMidnight(Date.parse('2026-11-02T16:00:00Z'))).toBe('2026-11-03T16:00:00.000Z');
});
test('84-hour booking boundary is exclusive and cannot reuse booked/deleted records', () => {
  const now = Date.now(), end = now + ID_BOOKING_WINDOW_MS;
  const record = { status: 'accepted', bookingDeadline: new Date(end).toISOString() } as TutorIdentityRecord;
  expect(identityCanBook(record, end - 1)).toBe(true); expect(identityCanBook(record, end)).toBe(false);
  expect(identityCanBook({ ...record, status: 'booked' }, now)).toBe(false);
  expect(identityCanBook({ ...record, deletedAt: new Date(now).toISOString() }, now)).toBe(false);
});
test('per-image keys, authenticated context, tamper rejection, deletion and repeated deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'identity-storage-test-'));
  const objects = new Map<string, Buffer>(); let failDelete = false;
  const request = (async (url: string, init: RequestInit = {}) => {
    const id = url.split('/').at(-1)!;
    if (init.method === 'PUT') { objects.set(id, Buffer.from(init.body as Uint8Array)); return new Response('ok'); }
    if (init.method === 'DELETE') { if (failDelete) return new Response('', { status: 503 }); objects.delete(id); return new Response('ok'); }
    return new Response(init.method === 'HEAD' ? null : objects.get(id), { status: objects.has(id) ? 200 : 404 });
  }) as typeof fetch;
  const storage = new IdentityStorage(() => dir, request, () => 'http://private-filer');
  const id = crypto.randomUUID(), other = crypto.randomUUID(), plain = Buffer.from('synthetic ID test, not a real document');
  try {
    await storage.put(id, plain); await storage.put(other, plain);
    expect((await storage.get(id)).equals(plain)).toBe(true);
    expect((await readFile(join(dir, id, 'key'))).equals(await readFile(join(dir, other, 'key')))).toBe(false);
    expect(await storage.has(id)).toBe(true);
    // A new storage instance can read the same persistent keys and Seaweed objects after restart.
    expect((await new IdentityStorage(() => dir, request, () => 'http://private-filer').get(id)).equals(plain)).toBe(true);
    await expect(readFile(join(dir, id, 'image'))).rejects.toThrow();
    const cipher = objects.get(id + '.bin')!;
    expect(cipher.includes(plain)).toBe(false);
    objects.set(other + '.bin', cipher);
    await expect(storage.get(other)).rejects.toThrow();
    cipher[30] = cipher[30]! ^ 1;
    objects.set(id + '.bin', cipher);
    await expect(storage.get(id)).rejects.toThrow();
    failDelete = true;
    await expect(storage.remove(id)).rejects.toThrow('deletion pending');
    await expect(readFile(join(dir, id, 'key'))).rejects.toThrow();
    failDelete = false;
    await storage.remove(id); await storage.remove(id);
    expect(objects.has(id + '.bin')).toBe(false);
    await expect(storage.get(id)).rejects.toThrow();
    await expect(storage.get('../../etc/passwd')).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
