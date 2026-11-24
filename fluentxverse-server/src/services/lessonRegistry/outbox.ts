import { createHash, randomBytes } from 'node:crypto';
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem';
import { int, type ManagedTransaction } from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import policy from '../../../../shared/disputeChainPolicy.json';
import production from '../../../../shared/lessonRegistryDeployment.json';

const word = /^0x[0-9a-f]{64}$/;
export const REGISTRY_POLICY = '0x' + createHash('sha256').update(JSON.stringify(policy)).digest('hex');
export function registryConfig() {
  if (process.env.LESSON_REGISTRY_CAPTURE !== 'true') return null;
  const chainId = Number(process.env.LESSON_REGISTRY_CHAIN_ID);
  const contract = (process.env.LESSON_REGISTRY_CONTRACT || '').toLowerCase();
  const mainnet = chainId === production.chainId && contract === production.contract
    && process.env.LESSON_REGISTRY_PRODUCTION === production.epoch && REGISTRY_POLICY === production.policyHash;
  if ((chainId !== 421614 && !mainnet) || !/^0x[0-9a-f]{40}$/.test(contract) || /^0x0+$/.test(contract))
    throw Error('Explicit Sepolia or pinned production registry binding required');
  return { chainId, contract, binding: `${chainId}:${contract}` };
}
const schemas = new Map<string, Promise<void>>();
export async function ensureRegistryOutbox() {
  const config = registryConfig();
  if (!config) return;
  if (!schemas.has(config.binding)) schemas.set(config.binding, (async () => {
    const db = getDriver().session();
    try {
      for (const query of [
        'CREATE CONSTRAINT ON (n:LessonRegistryCounter) ASSERT n.id IS UNIQUE',
        'CREATE CONSTRAINT ON (n:LessonRegistryEvent) ASSERT n.id IS UNIQUE',
        'CREATE CONSTRAINT ON (n:Booking) ASSERT n.registryKey IS UNIQUE',
        'CREATE INDEX ON :LessonRegistryEvent(binding)',
        'CREATE INDEX ON :LessonRegistryEvent(sequence)',
      ]) {
        try { await db.run(query); }
        catch (error) { if (!/already exists|already exist/i.test(String(error))) throw error; }
      }
      await db.run('MERGE(c:LessonRegistryCounter {id:$id}) ON CREATE SET c.sequence=0', { id: config.binding });
    } finally { await db.close(); }
  })().catch(error => { schemas.delete(config.binding); throw error; }));
  await schemas.get(config.binding);
}

function bindingFor(booking: any) {
  const config = registryConfig();
  if (!config || booking.registryBinding !== config.binding || !word.test(booking.registryKey || ''))
    throw Error('Enrolled booking registry binding changed');
  return config;
}
export function registryDisputeEnrollment(booking: any) {
  if (Number(booking.registryVersion) !== 1) return null;
  bindingFor(booking);
  return { chainVersion: 1, chainKey: booking.registryKey, chainSalt: randomBytes(32).toString('hex'),
    registryVersion: 1, registryBinding: booking.registryBinding, registryBookingRevision: Number(booking.registryRevision) };
}
function time(value: any) {
  const result = value?.toStandardDate?.()?.toISOString() ?? String(value);
  if (!Number.isFinite(Date.parse(result))) throw Error('Invalid private registry clock');
  return result;
}
function number(value: any) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw Error('Registry counter requires migration');
  return result;
}
export function registryCommitment(config: { chainId: number; contract: string }, key: string,
  revision: number, type: string, exactArtifact: string, salt: string) {
  if (!word.test(key) || !/^[0-9a-f]{64}$/.test(salt)) throw Error('Invalid private registry commitment binding');
  return keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,bytes32,uint64,bytes32,bytes32,bytes32'), [
    keccak256(stringToHex(type)), BigInt(config.chainId), config.contract as `0x${string}`,
    key as `0x${string}`, BigInt(revision), REGISTRY_POLICY as `0x${string}`,
    ('0x' + createHash('sha256').update(exactArtifact).digest('hex')) as `0x${string}`, ('0x' + salt) as `0x${string}`,
  ]));
}

async function emit(tx: ManagedTransaction, booking: any, kind: string, at: string,
  fields: Record<string, string | number | boolean>, artifact: string, salt: string, commitment: string,
  reasonArtifact = '', reasonSalt = '') {
  const config = bindingFor(booking);
  // The global counter and booking node serialize commits and all case/booking transitions.
  const row = await tx.run(`MATCH(c:LessonRegistryCounter {id:$binding}),(b:Booking {bookingId:$id})
    SET c.sequence=c.sequence+1,b.registrySequence=coalesce(b.registrySequence,0)+1
    RETURN c.sequence AS sequence,b.registrySequence AS subjectSequence`, { binding: config.binding, id: booking.bookingId });
  if (row.records.length !== 1) throw Error('Registry outbox not initialized');
  const sequence = number(row.records[0]!.get('sequence')), caseSequence = number(row.records[0]!.get('subjectSequence'));
  const payload = { ...fields, version: 2, sequence, caseSequence, id: `registry:${sequence}`, kind,
    caseKey: booking.registryKey, policyHash: REGISTRY_POLICY, at: Math.floor(Date.parse(at) / 1000), commitment };
  if (!Number.isSafeInteger(payload.at) || payload.at < 1) throw Error('Invalid registry event clock');
  await tx.run(`MATCH(b:Booking {bookingId:$bookingId}) CREATE(e:LessonRegistryEvent {
    id:$id,binding:$binding,sequence:$sequence,json:$json,artifact:$artifact,salt:$salt,
    reasonArtifact:$reasonArtifact,reasonSalt:$reasonSalt}) CREATE(b)-[:HAS_REGISTRY_EVENT]->(e)`, {
    bookingId: booking.bookingId, id: `${config.binding}:${sequence}`, binding: config.binding,
    sequence: int(sequence), json: JSON.stringify(payload), artifact, salt, reasonArtifact, reasonSalt,
  });
}

// Caller must use the SAME transaction as booking creation/reschedule/cancellation.
export async function captureBooking(tx: ManagedTransaction, bookingId: string,
  kind: 'booking' | 'booking_reschedule' | 'booking_cancel', reason: unknown = {}, at = new Date().toISOString()) {
  const enroll = !!registryConfig() && kind === 'booking';
  const row = await tx.run(`MATCH(b:Booking {bookingId:$bookingId})
    WHERE b.registryVersion=1 OR $enroll
    SET b.registryWrite=coalesce(b.registryWrite,0)+1 RETURN b`, { bookingId, enroll });
  let b = row.records[0]?.get('b').properties;
  if (!b) { if (enroll) throw Error('Booking not found for registry capture'); return; }
  if (Number(b.registryVersion) !== 1) {
    if (!registryConfig() || kind !== 'booking') return; // No retroactive enrollment of existing lessons.
    const config = registryConfig()!;
    b = { ...b, registryVersion: 1, registryBinding: config.binding,
      registryKey: '0x' + randomBytes(32).toString('hex'), registryRevision: 0 };
    await tx.run(`MATCH(b:Booking {bookingId:$id}) SET b.registryVersion=1,b.registryBinding=$binding,
      b.registryKey=$key,b.registryRevision=0`, { id: bookingId, binding: config.binding, key: b.registryKey });
  } else if (kind === 'booking') return; // Reservation retry must not publish twice.
  const config = bindingFor(b), previous = Number(b.registryRevision), revision = previous + 1;
  if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(revision) || previous < 0 || (kind !== 'booking' && previous < 1)) throw Error('Invalid booking revision');
  const cases = await tx.run('MATCH(t:LessonIssueThread {bookingId:$id,registryVersion:1}) RETURN t.id LIMIT 1', { id: bookingId });
  if (cases.records.length) throw Error('A disputed booking cannot be rescheduled or cancelled');
  if ((kind === 'booking_cancel') !== (b.status === 'cancelled')) throw Error('Booking transition and receipt disagree');
  const artifact = JSON.stringify(['FXV_PRIVATE_BOOKING_V1', bookingId, b.studentId, b.tutorId, b.slotId,
    time(b.slotDateTime), Number(b.durationMinutes), b.paymentMethod || '', b.reservationId || '',
    b.privatePassReservationId || b.ticketTransferTxHash || '', revision, b.status, at]);
  const salt = randomBytes(32).toString('hex'), reasonArtifact = JSON.stringify(['FXV_PRIVATE_BOOKING_REASON_V1', reason]);
  const reasonSalt = randomBytes(32).toString('hex');
  const reasonCommitment = registryCommitment(config, b.registryKey, revision, 'FXV_BOOKING_REASON_V1', reasonArtifact, reasonSalt);
  const commitment = kind === 'booking_cancel' ? reasonCommitment
    : registryCommitment(config, b.registryKey, revision, 'FXV_BOOKING_RECEIPT_V1', artifact, salt);
  await tx.run('MATCH(b:Booking {bookingId:$id}) SET b.registryRevision=$revision', { id: bookingId, revision: int(revision) });
  await emit(tx, b, kind, at, { bookingRevision: revision, ...(kind === 'booking_reschedule' ? { reasonCommitment } : {}) },
    kind === 'booking_cancel' ? reasonArtifact : artifact, kind === 'booking_cancel' ? reasonSalt : salt,
    commitment, kind === 'booking_reschedule' ? reasonArtifact : '', kind === 'booking_reschedule' ? reasonSalt : '');
}

export async function appendRegistryDispute(tx: ManagedTransaction, thread: any, kind: string, at: string,
  fields: Record<string, string | number | boolean>, evidence: unknown) {
  const row = await tx.run(`MATCH(b:Booking {bookingId:$id})
    SET b.registryWrite=coalesce(b.registryWrite,0)+1 RETURN b`, { id: thread.bookingId });
  const b = row.records[0]?.get('b').properties;
  if (!b || b.registryKey !== thread.chainKey || b.registryBinding !== thread.registryBinding
    || Number(b.registryRevision) !== Number(thread.registryBookingRevision)) throw Error('Dispute booking binding changed');
  const config = bindingFor(b), salt = randomBytes(32).toString('hex');
  const artifact = JSON.stringify(['FXV_PRIVATE_REGISTRY_DISPUTE_V1', thread.id, kind, at, fields, evidence]);
  await emit(tx, b, kind, at, fields, artifact, salt,
    registryCommitment(config, b.registryKey, Number(b.registryRevision), 'FXV_REGISTRY_DISPUTE_EVENT_V1', artifact, salt));
}

export async function registryEvents(after: number) {
  const config = registryConfig();
  if (!config) throw Error('Registry capture disabled');
  await ensureRegistryOutbox();
  const db = getDriver().session();
  try {
    const result = await db.run(`MATCH(e:LessonRegistryEvent {binding:$binding}) WHERE e.sequence>$after
      RETURN e.json AS json ORDER BY e.sequence LIMIT 100`, { binding: config.binding, after: int(after) });
    return result.records.map(row => JSON.parse(row.get('json')));
  } finally { await db.close(); }
}
