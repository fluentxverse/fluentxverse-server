import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { closePool, query } from '../src/db/postgres';
import { SessionService } from '../src/services/session.services/session.service';
import { ClassroomActivityService } from '../src/services/classroomActivity.services/classroomActivity.service';
import { ClassroomNotesService } from '../src/services/classroomNotes.services/classroomNotes.service';
import { ClassroomExerciseMarksService } from '../src/services/classroomExerciseMarks.services/classroomExerciseMarks.service';
import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';

// This is a service-layer sizing probe, not an authenticated browser or media test.
assert.equal(process.env.CAPACITY_ISOLATED, 'yes');
assert.equal(process.env.DATABASE_URL, 'postgres://capacity:capacity@capacity-postgres:5432/capacity');
assert.equal(process.env.MEMGRAPH_URI, 'bolt://capacity-memgraph:7687');
const rooms = Number(process.env.CAPACITY_ROOMS);
const durationMs = Number(process.env.CAPACITY_SECONDS || 30) * 1000;
assert([0, 10, 25, 50].includes(rooms));
await initDriver(process.env.MEMGRAPH_URI!, '', '', 30, 500);
const sessions = new SessionService(), activity = new ClassroomActivityService();
const notes = new ClassroomNotesService(), marks = new ClassroomExerciseMarksService();
await query(`CREATE TABLE IF NOT EXISTS session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id TEXT NOT NULL, user_id TEXT NOT NULL,
  user_type TEXT NOT NULL, socket_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), left_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ)`);
await sessions.ensurePresenceSchema();
await activity.ensureTable();
const graph = getDriver().session();
assert.equal((await graph.run('MATCH (n) RETURN count(n) AS n')).records[0]!.get('n').toNumber(), 0);
const clients: any[] = [];
const timings: Record<string, number[]> = {};
const failures: Record<string, number> = {};
const measure = async (name: string, work: () => Promise<any>) => {
  const start = performance.now();
  try { return await work(); }
  catch (error) { failures[name] = (failures[name] || 0) + 1; throw error; }
  finally { (timings[name] ||= []).push(performance.now() - start); }
};
const room = (i: number) => ({ sessionId: `capacity-room-${i}`, tutorId: `capacity-tutor-${i}`,
  studentId: `capacity-student-${i}`, lessonId: `capacity-material-${i}` });
const save = (r: ReturnType<typeof room>, n: number) => notes.saveNotes({ ...r,
  materialType: 'conversational-skills', materialId: r.lessonId,
  vocabularyItems: [], grammarItems: [], pronunciationItems: [], tutorMemo: `Synthetic note revision ${n}` });
const add = async (i: number, type: 'student' | 'tutor', iteration = 0) => {
  const r = room(i), userId = type === 'tutor' ? r.tutorId : r.studentId;
  const socketId = `capacity-socket-${i}-${type}-${iteration}`;
  await sessions.addParticipant({ sessionId: r.sessionId, userId, userType: type, socketId });
  await activity.log({ sessionId: r.sessionId, userId, userType: type, eventType: 'entered' });
  return { sessionId: r.sessionId, userId, userType: type, socketId };
};
for (let i = 0; i < rooms; i++) {
  const r = room(i);
  await graph.run(`CREATE (s:Student {id: $studentId}), (:LessonMaterial {id: $lessonId}),
    (:Booking {bookingId: $sessionId, tutorId: $tutorId, status: 'confirmed', attendanceStudent: 'present',
      slotDateTime: datetime($startsAt), durationMinutes: 25})-[:BOOKED_BY]->(s)`,
    { ...r, startsAt: new Date(Date.now() - 60_000).toISOString() });
  clients.push(await add(i, 'tutor'), await add(i, 'student'));
}
if (rooms) await save(room(0), 0);
console.log(JSON.stringify({ event: 'ready', rooms, participants: clients.length }));

const { proveWithArtifacts } = await import('/engine/scripts/screening-prove.ts');
const artifacts = { wasm: '/artifacts/tutor_screening_js/tutor_screening.wasm', zkey: '/artifacts/phase-two-0001.zkey' };
const vk = JSON.parse(readFileSync('/artifacts/verification-key.json', 'utf8'));
// A synthetic issuer cannot issue credentials accepted by production. Nothing is submitted onchain.
const signed = await signScreeningCredential(screeningFixture(), {
  chainId: 26514, agentId: '0', adapterAddress: '0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69',
}, Buffer.alloc(32, 7));
const started = performance.now(), until = started + durationMs;
const proofDurations: number[] = [];
const proofs = (async () => {
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const result = await proveWithArtifacts(signed.input, signed.publicSignals, artifacts, vk);
    assert.deepEqual(result.publicSignals, signed.publicSignals);
    proofDurations.push(performance.now() - start);
  }
})();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const periodic = async (interval: number, offset: number, fn: (n: number) => Promise<any>) => {
  await sleep(offset);
  for (let n = 0; performance.now() < until; n++) {
    const at = performance.now();
    await fn(n);
    await sleep(Math.min(Math.max(0, interval - (performance.now() - at)), Math.max(0, until - performance.now())));
  }
};
try {
  await Promise.all([proofs,
    periodic(5000, 0, () => measure('presence-batch', () => sessions.reconcilePresence(clients.map(c => c.socketId)))),
    ...Array.from({ length: rooms }, (_, i) => periodic(5000, (i % 10) * 100, async n => {
      const r = room(i);
      await measure('participant-read', () => sessions.getSessionParticipants(r.sessionId));
      await measure('note-read', () => notes.getNotes(r.sessionId, 'conversational-skills', r.lessonId));
      if (n % 2 === 0) {
        await measure('note-save', () => save(r, n));
        await measure('exercise-save', () => marks.saveMark({ ...r, step: 'A', itemIndex: n % 5,
          itemType: 'choose', prompt: 'Synthetic exercise', answerKey: 'went', isCorrect: true, studentResponse: 'went' }));
      }
      if (n === 2) {
        const index = 2 * i + 1, old = clients[index];
        await measure('reconnect', async () => {
          await sessions.removeParticipant(old.sessionId, old.userId, old.userType, old.socketId);
          clients[index] = await add(i, 'student', 1);
        });
      }
    })),
  ]);
  for (const client of clients) await measure('leave', async () => {
    await sessions.removeParticipant(client.sessionId, client.userId, client.userType, client.socketId);
    await activity.log({ ...client, eventType: 'left' });
  });
  const active = await query('SELECT count(*) AS n FROM session_participants WHERE is_active');
  assert.equal(Number(active.rows[0].n), 0);
  const summary = Object.fromEntries(Object.entries(timings).map(([name, samples]) => {
    const sorted = samples.toSorted((a, b) => a - b);
    return [name, { count: sorted.length, p50Ms: sorted[Math.floor((sorted.length - 1) * .5)],
      p95Ms: sorted[Math.ceil((sorted.length - 1) * .95)], maxMs: sorted.at(-1) }];
  }));
  const pg = await query('SELECT pg_database_size(current_database()) AS bytes');
  console.log(JSON.stringify({ event: 'result', rooms, participants: clients.length, elapsedMs: performance.now() - started,
    operations: summary, failures, proofs: { count: proofDurations.length, durationMs: proofDurations },
    postgresBytes: Number(pg.rows[0].bytes), activeParticipantsAfterClosure: 0,
    limitations: ['Service methods, not production HTTP/auth/Socket.IO paths', 'No media, recording, storage uploads, AI inference, RPC or paid proof submission',
      'Small synthetic database; no existing production-data volume', 'Sequential screening Groth16 proofs only; review tally prover not exercised'] }));
} finally {
  await graph.close(); await closeDriver(); await closePool();
}
process.exit(0);
