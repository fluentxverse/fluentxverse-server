import { int } from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import { adminCapabilities, plainNode } from '../../utils/adminOperations';
import { usdRateCents, type TutorCompensation, type TutorCompensationDetail, type TutorRateChange, type TutorRateUpdate } from '../../shared/tutorCompensation';

export class TutorCompensationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function tutorCompensationFailure(error: unknown, code: unknown) {
  if (error instanceof TutorCompensationError) return { status: error.status, body: { success: false, error: error.message } };
  const kind = String(code);
  if (['VALIDATION', 'PARSE'].includes(kind)) return { status: 400, body: { success: false, error: 'Invalid compensation request.' } };
  if (kind === 'NOT_FOUND') return { status: 404, body: { success: false, error: 'Compensation endpoint not found.' } };
  return { status: 503, body: { success: false, error: 'Compensation is temporarily unavailable. Please retry.' } };
}

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
export function compensationTutorId(id: string) {
  if (!idPattern.test(id)) throw new TutorCompensationError(400, 'Invalid tutor ID.');
  return id;
}
const conflict = () => new TutorCompensationError(409, 'This rate was changed by another administrator. Reload it before saving.');
let schemaReady: Promise<void> | undefined;

export function ensureCompensationSchema(): Promise<void> {
  return schemaReady ||= (async () => {
    const session = getDriver().session();
    try {
      for (const [label, property] of [['TutorCompensation', 'tutorId'], ['TutorRateChange', 'id'], ['TutorRateChange', 'changeKey'], ['TutorEarning', 'bookingId'], ['TutorPayoutBatch', 'id']]) {
        const exists = async () => (await session.run('SHOW CONSTRAINT INFO')).records.some(record => record.get('constraint type') === 'unique'
          && record.get('label') === label && record.get('properties').length === 1 && record.get('properties')[0] === property);
        if (await exists()) continue;
        try { await session.run(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.${property} IS UNIQUE`); }
        catch { if (!await exists()) throw new Error('Compensation uniqueness constraints are required.'); }
      }
    } finally { await session.close(); }
  })().catch(error => { schemaReady = undefined; throw error; });
}

function summary(tutorId: string, raw?: Record<string, any>): TutorCompensation {
  const p = plainNode(raw || {});
  return { tutorId, currency: 'USD', baseRateCents: p.baseRateCents ?? null, version: p.version || 0,
    updatedAt: p.updatedAt || null, updatedBy: p.updatedBy || null, updatedByName: p.updatedByName || null };
}

function historyItem(raw: Record<string, any>): TutorRateChange {
  const p = plainNode(raw);
  return { id: p.id, tutorId: p.tutorId, currency: 'USD', version: p.version, previousVersion: p.previousVersion,
    previousRateCents: p.previousRateCents ?? null, baseRateCents: p.baseRateCents, changedAt: p.changedAt,
    changedBy: p.changedBy, changedByName: p.changedByName, reason: p.reason };
}

export function validateTutorRateUpdate(input: TutorRateUpdate) {
  if (input.currency !== 'USD') throw new TutorCompensationError(400, 'Compensation currency must be USD.');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw new TutorCompensationError(400, 'Invalid rate version.');
  }
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new TutorCompensationError(400, 'A valid save request ID is required.');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length > 1000) throw new TutorCompensationError(400, 'Change reason must be at most 1,000 characters.');
  let cents: number;
  try { cents = usdRateCents(input.amount); }
  catch (error) { throw new TutorCompensationError(400, (error as Error).message); }
  return { cents, reason: input.reason.trim() || (input.expectedVersion === 0 ? 'Initial base rate' : '') };
}

export const tutorCompensationService = {
  async summaries(ids: string[]): Promise<TutorCompensation[]> {
    if (!ids.length || ids.length > 50) throw new TutorCompensationError(400, 'Choose between 1 and 50 tutors.');
    ids.forEach(compensationTutorId);
    await ensureCompensationSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (t:User) WHERE t.id IN $ids
        OPTIONAL MATCH (r:TutorCompensation {tutorId: t.id}) RETURN t.id AS tutorId, r`, { ids: [...new Set(ids)] });
      return result.records.map(row => summary(row.get('tutorId'), row.get('r')?.properties));
    } finally { await session.close(); }
  },

  async detail(tutorId: string, beforeVersion?: number): Promise<TutorCompensationDetail> {
    compensationTutorId(tutorId);
    if (beforeVersion !== undefined && (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1)) throw new TutorCompensationError(400, 'Invalid history cursor.');
    await ensureCompensationSchema();
    const session = getDriver().session();
    try {
      return await session.executeRead(async tx => {
        const result = await tx.run('MATCH (t:User {id: $tutorId}) OPTIONAL MATCH (r:TutorCompensation {tutorId: $tutorId}) RETURN r', { tutorId });
        if (!result.records.length) throw new TutorCompensationError(404, 'Tutor not found.');
        const rows = (await tx.run(`MATCH (h:TutorRateChange {tutorId: $tutorId}) WHERE h.version < $before
          RETURN h ORDER BY h.version DESC LIMIT 26`, { tutorId, before: int(beforeVersion ?? Number.MAX_SAFE_INTEGER) })).records;
        const history = rows.slice(0, 25).map(row => historyItem(row.get('h').properties));
        return { compensation: summary(tutorId, result.records[0]!.get('r')?.properties), history,
          nextHistoryBeforeVersion: rows.length > 25 ? history.at(-1)!.version : null };
      });
    } finally { await session.close(); }
  },

  async save(tutorId: string, input: TutorRateUpdate, actorId: string) {
    compensationTutorId(tutorId);
    const { cents, reason } = validateTutorRateUpdate(input);
    await ensureCompensationSchema();
    const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        const actor = (await tx.run('MATCH (a:Admin {id: $actorId}) RETURN a', { actorId })).records[0]?.get('a')?.properties;
        if (!actor || !['admin', 'superadmin'].includes(actor.role || 'admin') || !adminCapabilities(actor).includes('finance')) {
          throw new TutorCompensationError(403, 'Finance permission required.');
        }
        if (!(await tx.run('MATCH (t:User {id: $tutorId}) RETURN t.id', { tutorId })).records.length) throw new TutorCompensationError(404, 'Tutor not found.');
        const replay = (await tx.run('MATCH (h:TutorRateChange {id: $id}) RETURN h', { id: input.requestId })).records[0];
        if (replay) {
          const item = historyItem(replay.get('h').properties);
          if (item.tutorId !== tutorId || item.changedBy !== actorId || item.baseRateCents !== cents || item.previousVersion !== input.expectedVersion || item.reason !== reason) {
            throw new TutorCompensationError(409, 'This save request was already used for another change.');
          }
          return { change: item, replayed: true };
        }
        // Write to the shared per-tutor node before comparing versions. Concurrent writers
        // must contend on that node; the rate and its audit entry commit or roll back together.
        const row = (await tx.run(`MATCH (t:User {id: $tutorId})
          MERGE (r:TutorCompensation {tutorId: $tutorId}) ON CREATE SET r.version = 0, r.currency = 'USD'
          SET r.writeRevision = coalesce(r.writeRevision, 0) + 1
          MERGE (t)-[:HAS_COMPENSATION]->(r) RETURN r`, { tutorId })).records[0];
        if (!row) throw new TutorCompensationError(404, 'Tutor not found.');
        const current = summary(tutorId, row.get('r').properties);
        if (current.version !== input.expectedVersion) throw conflict();
        if (current.baseRateCents === cents) throw new TutorCompensationError(400, 'The base rate is unchanged.');
        if (current.version > 0 && !reason) throw new TutorCompensationError(400, 'A reason is required when changing an existing rate.');
        const nextVersion = current.version + 1;
        const actorName = `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.username || actorId;
        const at = new Date().toISOString();
        const updated = await tx.run(`MATCH (r:TutorCompensation {tutorId: $tutorId}) WHERE r.version = $expected
          SET r.baseRateCents = $cents, r.version = $next, r.updatedAt = $at, r.updatedBy = $actorId, r.updatedByName = $actorName
          CREATE (h:TutorRateChange {id: $id, changeKey: $changeKey, tutorId: $tutorId, currency: 'USD', version: $next,
            previousVersion: $expected, previousRateCents: $previousCents, baseRateCents: $cents,
            changedAt: $at, changedBy: $actorId, changedByName: $actorName, reason: $reason})
          CREATE (r)-[:HAS_RATE_CHANGE]->(h) RETURN h`, { tutorId, expected: int(input.expectedVersion), cents: int(cents), next: int(nextVersion), at,
          actorId, actorName, id: input.requestId, changeKey: `${tutorId}:${nextVersion}`, previousCents: current.baseRateCents === null ? null : int(current.baseRateCents), reason });
        if (!updated.records.length) throw conflict();
        return { change: historyItem(updated.records[0]!.get('h').properties), replayed: false };
      });
    } catch (error: any) {
      if (error instanceof TutorCompensationError) throw error;
      if (/conflict|serialization|constraint.*violat|violat.*constraint/i.test(String(error?.code) + ' ' + String(error?.message))) throw conflict();
      throw error;
    } finally { await session.close(); }
  },
};
