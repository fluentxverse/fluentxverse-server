import { createHash } from 'node:crypto';
import { getDriver } from '../../db/memgraph';
import { lessonOutcomeService } from './service';
import { LessonOutcomePolicyError } from './policy';

export function requireOutcomeRequest(assessment: { state: string }, hasReports: boolean, source: 'support' | 'automatic') {
  if (assessment.state !== 'eligible') throw new LessonOutcomePolicyError('This lesson is not eligible for a completion proof.');
  if (source === 'automatic' && hasReports) throw new LessonOutcomePolicyError('Reported lessons require a manual support request.');
}

export class LessonOutcomeRequests {
  private schema: Promise<void> | null = null;
  private cursor: { start: string; id: string } | null = null;
  async ensure() {
    if (!this.schema) this.schema = (async () => {
      const session = getDriver().session();
      try { await session.run('CREATE CONSTRAINT ON (r:LessonOutcomeProofRequest) ASSERT r.bookingId IS UNIQUE'); }
      finally { await session.close(); }
    })().catch(error => { this.schema = null; throw error; });
    await this.schema;
  }
  async request(bookingId: string, actorId: string, source: 'support' | 'automatic' = 'support') {
    await this.ensure();
    const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        const locked = await tx.run(`MATCH (b:Booking {bookingId:$bookingId})
          SET b.compensationWriteRevision=coalesce(b.compensationWriteRevision,0)+1,
            b.lessonOutcomeRequestVersion=coalesce(b.lessonOutcomeRequestVersion,0)+1 RETURN b.bookingId AS id,b.disputeHold AS held`, { bookingId });
        if (!locked.records.length) throw new Error('Lesson not found.');
        if (locked.records[0]!.get('held')) throw new LessonOutcomePolicyError('An unresolved dispute blocks completion proof requests.');
        const inspected = await lessonOutcomeService.inspect(bookingId);
        requireOutcomeRequest(inspected.assessment, inspected.hasReports, source);
        const id = createHash('sha256').update(`lesson-outcome-request:${bookingId}`).digest('hex');
        const existing = (await tx.run('MATCH (r:LessonOutcomeProofRequest {bookingId:$bookingId}) RETURN r', { bookingId })).records[0]?.get('r').properties;
        if (existing?.evidenceDigest === inspected.evidenceDigest) return { id: existing.id, phase: 'awaiting_prover' as const, requestedAt: existing.requestedAt };
        const requestedAt = new Date().toISOString();
        const event = { actorId, source, requestedAt, evidenceDigest: inspected.evidenceDigest, outcome: inspected.assessment.outcome };
        const history = [...JSON.parse(existing?.historyJson || '[]'), event];
        await tx.run(`MATCH (b:Booking {bookingId:$bookingId})
          MERGE (r:LessonOutcomeProofRequest {bookingId:$bookingId})
          SET r.id=$id,r.phase='awaiting_prover',r.evidenceDigest=$evidenceDigest,r.outcome=$outcome,
            r.policy=$policy,r.requestedAt=$requestedAt,r.requestedBy=$actorId,r.requestSource=$source,r.historyJson=$historyJson
          MERGE (b)-[:HAS_OUTCOME_PROOF_REQUEST]->(r)`, { bookingId, id, ...event,
          policy: inspected.assessment.policy, historyJson: JSON.stringify(history) });
        return { id, phase: 'awaiting_prover' as const, requestedAt };
      });
    } finally { await session.close(); }
  }
  async queueUnreported(from: string, before = new Date().toISOString()) {
    const session = getDriver().session();
    let ids: string[];
    try {
      const result = await session.run(`MATCH (b:Booking) WHERE b.status IN ['confirmed','completed']
        AND b.slotDateTime >= datetime($from) AND b.slotDateTime < datetime($before)
        AND ($cursorStart IS NULL OR b.slotDateTime > datetime($cursorStart)
          OR (b.slotDateTime = datetime($cursorStart) AND b.bookingId > $cursorId))
        AND NOT (b)-[:HAS_OUTCOME_PROOF_REQUEST]->(:LessonOutcomeProofRequest)
        RETURN b.bookingId AS id,b.slotDateTime AS startsAt ORDER BY startsAt,id LIMIT 50`,
      { from, before, cursorStart: this.cursor?.start || null, cursorId: this.cursor?.id || '' });
      ids = result.records.map(r => r.get('id'));
      const last = result.records.at(-1);
      this.cursor = result.records.length === 50 && last ? { start: last.get('startsAt').toStandardDate().toISOString(), id: last.get('id') } : null;
    } finally { await session.close(); }
    for (const id of ids) {
      const inspected = await lessonOutcomeService.inspect(id);
      if (inspected.assessment.state === 'eligible' && !inspected.hasReports) await this.request(id, 'lesson-outcome-job', 'automatic');
    }
  }
}
export const lessonOutcomeRequests = new LessonOutcomeRequests();
