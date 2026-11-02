import { getDriver } from '../../db/memgraph';
import { AnonymousReviewError } from './policy';
import { REVIEW_MAX_MEMBERS, REVIEW_MIN_BATCH, reviewPeriod, reviewWindow } from '../../shared/anonymousReviews';
import type { ManagedTransaction } from 'neo4j-driver';

export interface ReviewCohort {
  id: string; tutorId: string; period: string; scope: string; chainId: number; contract: string;
  opensAt: string; closesAt: string; root?: string; membersJson?: string; summaryJson?: string;
  activationStatus?: string; activationTransactionId?: string;
  enrollmentPolicy?: 'per_lesson';
}
export interface ReviewEnrollmentRecord { id: string; groupId: string; commitment: string; bookingId?: string; lessonStartsAt?: string }
export interface ReviewSubmission {
  id: string; groupId: string; nullifier: string; proofJson: string; encryptedContent: string;
  status: string; zkVerifyTx?: string; engineSubmissionId?: string; transactionId?: string; receiptJson?: string; acceptedAt?: string;
}
export interface ReviewTallyRecord {
  id: string; status: string; manifestJson: string; totalsJson: string; journal: string; encryptedWitness: string;
  proofJson?: string; imageId?: string; engineSubmissionId?: string; zkVerifyTx?: string; receiptJson?: string;
}
function props(node: any) { return node?.properties; }
export class AnonymousReviewRepository {
  private schema?: Promise<void>;
  async ready() {
    this.schema ??= this.ensureSchema().catch(error => { this.schema = undefined; throw error; });
    return this.schema;
  }
  private async ensureSchema() {
    const db = getDriver().session();
    try {
      for (const label of ['AnonymousReviewCohort', 'AnonymousReviewEnrollment', 'AnonymousReviewCommitment', 'AnonymousReviewSubmission', 'AnonymousReviewTally'])
        await db.run(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.id IS UNIQUE`);
    } finally { await db.close(); }
  }
  async read(query: string, parameters: Record<string, any> = {}) {
    await this.ready(); const db = getDriver().session();
    try { return await db.run(query, parameters); } finally { await db.close(); }
  }
  private async write<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    await this.ready();
    for (let attempt = 0; ; attempt++) {
      const db = getDriver().session();
      try { return await db.executeWrite(work); }
      catch (error) {
        // Memgraph reports concurrent MERGE creation as a non-retryable constraint error.
        const message = error instanceof Error ? error.message : '';
        if (attempt >= 11 || !/unique constraint violation on :AnonymousReview(?:Cohort|Enrollment|Commitment|Submission|Tally)\(id\)/.test(message)) throw error;
      } finally { await db.close(); }
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 20));
    }
  }
  async ownedBooking(bookingId: string, studentId: string) {
    const result = await this.read(`MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId})
      OPTIONAL MATCH (s:LessonSurvey {bookingId: $bookingId}) RETURN b, s`, { bookingId, studentId });
    const row = result.records[0];
    if (!row) throw new AnonymousReviewError('Lesson not found', 403);
    return { booking: props(row.get('b')), legacyReviewed: Boolean(row.get('s')) };
  }
  async cohort(id: string): Promise<ReviewCohort | null> {
    return props((await this.read('MATCH (g:AnonymousReviewCohort {id: $id}) RETURN g', { id })).records[0]?.get('g')) || null;
  }
  async enrollment(id: string): Promise<ReviewEnrollmentRecord | null> {
    return props((await this.read('MATCH (e:AnonymousReviewEnrollment {id: $id}) RETURN e', { id })).records[0]?.get('e')) || null;
  }
  async enrollmentForLesson(bookingId: string, studentId: string) {
    const result = await this.read(`MATCH (e:AnonymousReviewEnrollment {studentId:$studentId,bookingId:$bookingId}),
      (g:AnonymousReviewCohort {id:e.groupId}) RETURN e,g`, { bookingId, studentId });
    if (result.records.length > 1) throw new AnonymousReviewError('Lesson review enrollment requires reconciliation', 409);
    const row = result.records[0];
    return row ? { enrollment: props(row.get('e')) as ReviewEnrollmentRecord, cohort: props(row.get('g')) as ReviewCohort } : null;
  }
  async legacyEnrollmentForPeriod(tutorId: string, period: string, studentId: string) {
    const result = await this.read(`MATCH (e:AnonymousReviewEnrollment {studentId:$studentId}),
      (g:AnonymousReviewCohort {id:e.groupId,tutorId:$tutorId,period:$period})
      WHERE g.enrollmentPolicy IS NULL RETURN e,g`, { tutorId, period, studentId });
    if (result.records.length > 1) throw new AnonymousReviewError('Historical review enrollment requires reconciliation', 409);
    const row = result.records[0];
    return row ? { enrollment: props(row.get('e')) as ReviewEnrollmentRecord, cohort: props(row.get('g')) as ReviewCohort } : null;
  }
  async enrollmentForPeriod(tutorId: string, period: string, studentId: string) {
    const result = await this.read(`MATCH (e:AnonymousReviewEnrollment {studentId:$studentId}),
      (g:AnonymousReviewCohort {id:e.groupId,tutorId:$tutorId,period:$period}) RETURN e,g`, { tutorId, period, studentId });
    if (result.records.length > 1) throw new AnonymousReviewError('Review enrollment requires reconciliation', 409);
    const row = result.records[0];
    return row ? { id: props(row.get('e')).id as string, cohort: props(row.get('g')) as ReviewCohort } : null;
  }
  async enroll(cohort: ReviewCohort, enrollmentId: string, studentId: string, commitment: string, bookingId?: string) {
    return this.write(async tx => {
        if (cohort.enrollmentPolicy === 'per_lesson') {
          const student = await tx.run(`MATCH(s:Student {id:$studentId})
            SET s.reviewEnrollmentRevision=coalesce(s.reviewEnrollmentRevision,0)+1 RETURN s.id`, { studentId });
          if (!student.records.length || !bookingId) throw new AnonymousReviewError('Owned lesson required', 403);
          const prior = await tx.run(`MATCH(e:AnonymousReviewEnrollment {studentId:$studentId,bookingId:$bookingId}) RETURN e`, { studentId, bookingId });
          if (prior.records.some(r => props(r.get('e')).id !== enrollmentId || props(r.get('e')).groupId !== cohort.id))
            throw new AnonymousReviewError('This lesson retains its original review enrollment and destination', 409);
          const historical = await tx.run(`MATCH(e:AnonymousReviewEnrollment {studentId:$studentId}),
            (g:AnonymousReviewCohort {id:e.groupId,tutorId:$tutorId,period:$period}) WHERE g.enrollmentPolicy IS NULL RETURN e LIMIT 1`,
            { studentId, tutorId: cohort.tutorId, period: cohort.period });
          if (historical.records.length) throw new AnonymousReviewError('Finish the existing monthly review; per-lesson enrollment starts with a new period', 409);
        } else if (process.env.PROOF_DESTINATION_MODE === 'project') {
          // Serialize across destination-specific cohorts, not just within one cohort.
          const student = await tx.run(`MATCH (s:Student {id:$studentId})
            SET s.reviewEnrollmentRevision=coalesce(s.reviewEnrollmentRevision,0)+1 RETURN s.id`, { studentId });
          if (!student.records.length) throw new AnonymousReviewError('Student not found', 403);
          const prior = await tx.run(`MATCH (e:AnonymousReviewEnrollment {studentId:$studentId}),
            (g:AnonymousReviewCohort {id:e.groupId,tutorId:$tutorId,period:$period}) RETURN e.groupId AS groupId`,
            { studentId, tutorId: cohort.tutorId, period: cohort.period });
          if (prior.records.some(r => r.get('groupId') !== cohort.id))
            throw new AnonymousReviewError('This month already has a review enrollment on its original destination', 409);
        }
        const row = (await tx.run(`MERGE (g:AnonymousReviewCohort {id: $id}) ON CREATE SET g += $cohort
          SET g.writeVersion = coalesce(g.writeVersion, 0) + 1 RETURN g`, { id: cohort.id, cohort })).records[0]!;
        const g = props(row.get('g'));
        if (g.scope !== cohort.scope || g.contract !== cohort.contract || g.opensAt !== cohort.opensAt || g.enrollmentPolicy !== cohort.enrollmentPolicy)
          throw new AnonymousReviewError('Review deployment changed', 409);
        const old = props((await tx.run('MATCH (e:AnonymousReviewEnrollment {id: $id}) RETURN e', { id: enrollmentId })).records[0]?.get('e'));
        if (old) {
          if (old.commitment !== commitment || old.groupId !== cohort.id || old.studentId !== studentId ||
            (cohort.enrollmentPolicy === 'per_lesson' && old.bookingId !== bookingId)) throw new AnonymousReviewError('Restore your original review key; enrollment cannot be replaced', 409);
          return;
        }
        let lessonStartsAt: string | undefined;
        if (cohort.enrollmentPolicy === 'per_lesson') {
          const owned = await tx.run(`MATCH(b:Booking {bookingId:$bookingId,tutorId:$tutorId})-[:BOOKED_BY]->(:Student {id:$studentId})
            SET b.reviewEntitlementVersion=coalesce(b.reviewEntitlementVersion,0)+1 WITH b
            OPTIONAL MATCH(s:LessonSurvey {bookingId:$bookingId}) RETURN b,s`, { bookingId, tutorId: cohort.tutorId, studentId });
          const row = owned.records[0], b = props(row?.get('b'));
          lessonStartsAt = b?.slotDateTime?.toStandardDate?.().toISOString() || String(b?.slotDateTime || '');
          if (!b || row?.get('s') || b.status !== 'completed' || b.attendanceStudent !== 'present' || b.attendanceTutor !== 'present'
            || !Number.isFinite(Date.parse(lessonStartsAt!)) || Date.parse(lessonStartsAt!) + (Number(b.durationMinutes) || 25) * 60_000 > Date.now()
            || reviewPeriod(lessonStartsAt!) !== cohort.period || reviewWindow(cohort.period).opensAt !== cohort.opensAt)
            throw new AnonymousReviewError('Enrollment requires a completed lesson with both participants marked present, before month end', 403);
        }
        if (g.root || Date.now() >= Date.parse(g.opensAt)) throw new AnonymousReviewError('Enrollment has closed', 409);
        const members = (await tx.run('MATCH (e:AnonymousReviewEnrollment {groupId: $id}) RETURN e.commitment AS commitment', { id: cohort.id })).records;
        if (members.length >= REVIEW_MAX_MEMBERS) throw new AnonymousReviewError('Review cohort is full', 409);
        const identityId = `${cohort.id}:${commitment}`;
        const duplicate = (await tx.run('MATCH (n:AnonymousReviewCommitment {id: $id}) RETURN n', { id: identityId })).records;
        if (duplicate.length) throw new AnonymousReviewError('Review key already enrolled', 409);
        await tx.run(`CREATE (:AnonymousReviewCommitment {id: $identityId})
          CREATE (:AnonymousReviewEnrollment {id: $id, groupId: $groupId, studentId: $studentId, commitment: $commitment,
            bookingId:$bookingId,lessonStartsAt:$lessonStartsAt})`,
          { identityId, id: enrollmentId, groupId: cohort.id, studentId, commitment, bookingId: bookingId || null, lessonStartsAt: lessonStartsAt || null });
    });
  }
  async memberships(studentId: string) {
    return (await this.read(`MATCH (e:AnonymousReviewEnrollment {studentId: $studentId}), (g:AnonymousReviewCohort {id: e.groupId})
      RETURN g,e ORDER BY g.period DESC,e.lessonStartsAt DESC,e.id LIMIT 256`, { studentId })).records
      .map(r => ({ cohort: props(r.get('g')) as ReviewCohort, ...props(r.get('e')) }));
  }
  async memberCount(groupId: string) {
    const value = (await this.read('MATCH (e:AnonymousReviewEnrollment {groupId: $groupId}) RETURN count(e) AS total', { groupId }))
      .records[0]!.get('total');
    return value?.toNumber ? value.toNumber() : Number(value);
  }
  async distinctStudentCount(groupId: string) {
    const total = (await this.read('MATCH(e:AnonymousReviewEnrollment {groupId:$groupId}) RETURN count(DISTINCT e.studentId) AS total', { groupId })).records[0]!.get('total');
    return total?.toNumber ? total.toNumber() : Number(total);
  }
  async seal(id: string, build: (members: string[]) => { root: string; membersJson: string }) {
    return this.write(async tx => {
        const g = props((await tx.run(`MATCH (g:AnonymousReviewCohort {id: $id})
          SET g.writeVersion = coalesce(g.writeVersion, 0) + 1 RETURN g`, { id })).records[0]?.get('g')) as ReviewCohort;
        if (!g) throw new AnonymousReviewError('Review cohort not found', 404);
        if (g.root) return g;
        if (Date.now() < Date.parse(g.opensAt) || Date.now() >= Date.parse(g.closesAt)) throw new AnonymousReviewError('Cohort is outside its activation window', 409);
        const members = (await tx.run(`MATCH (e:AnonymousReviewEnrollment {groupId: $id})
          RETURN e.commitment AS commitment,e.studentId AS studentId ORDER BY e.commitment`, { id })).records;
        if (g.enrollmentPolicy === 'per_lesson' && new Set(members.map(r => r.get('studentId'))).size < REVIEW_MIN_BATCH)
          throw new AnonymousReviewError('At least five distinct eligible students must enroll', 409);
        const commitments = members.map(r => String(r.get('commitment')));
        const sealed = build(commitments);
        await tx.run('MATCH (g:AnonymousReviewCohort {id: $id}) SET g += $sealed', { id, sealed });
        return { ...g, ...sealed };
    });
  }
  async saveSubmission(item: ReviewSubmission) {
    return this.write(async tx => {
        const row = (await tx.run(`MERGE (r:AnonymousReviewSubmission {id: $id}) ON CREATE SET r += $item RETURN r`, { id: item.id, item })).records[0]!;
        const old = props(row.get('r')) as ReviewSubmission;
        if (JSON.parse(old.proofJson).message !== JSON.parse(item.proofJson).message)
          throw new AnonymousReviewError('This review entitlement has already been used', 409);
        return old;
    });
  }
  async submission(id: string): Promise<ReviewSubmission | null> {
    return props((await this.read('MATCH (r:AnonymousReviewSubmission {id: $id}) RETURN r', { id })).records[0]?.get('r')) || null;
  }
  async patch(id: string, values: Record<string, string>) {
    await this.read('MATCH (r:AnonymousReviewSubmission {id: $id}) SET r += $values', { id, values });
  }
  async claimSubmission(id: string) {
    const result = await this.read(`MATCH (r:AnonymousReviewSubmission {id: $id, status: 'queued'})
      SET r.status = 'submitting_zkverify' RETURN r`, { id });
    return props(result.records[0]?.get('r')) as ReviewSubmission | undefined;
  }
  async claimActivation(id: string) {
    return (await this.read(`MATCH (g:AnonymousReviewCohort {id: $id}) WHERE g.activationStatus IS NULL
      SET g.activationStatus = 'queuing' RETURN g`, { id })).records.length > 0;
  }
  async recordActivation(id: string, transactionId: string) {
    await this.read(`MATCH (g:AnonymousReviewCohort {id: $id}) SET g.activationStatus = 'queued', g.activationTransactionId = $transactionId`, { id, transactionId });
  }
  async activateBridge(id: string) {
    await this.read(`MATCH (g:AnonymousReviewCohort {id: $id}) WHERE g.root IS NOT NULL
      SET g.activationStatus = 'active_bridge'`, { id });
  }
  async acceptBridge(id: string, receiptJson: string) {
    await this.write(async tx => {
        const row = (await tx.run(`MATCH (r:AnonymousReviewSubmission {id: $id})
          SET r.writeVersion = coalesce(r.writeVersion, 0) + 1 RETURN r`, { id })).records[0];
        const item = props(row?.get('r')) as ReviewSubmission | undefined;
        if (!item?.zkVerifyTx || !['awaiting_horizen', 'verified'].includes(item.status)) throw new AnonymousReviewError('Review is not awaiting a bridge receipt', 409);
        if (item.receiptJson && item.receiptJson !== receiptJson) throw new AnonymousReviewError('Review acceptance receipt is immutable', 409);
        const result = await tx.run(`MATCH (r:AnonymousReviewSubmission {id: $id}), (g:AnonymousReviewCohort {id: r.groupId})
          WHERE g.activationStatus = 'active_bridge' AND datetime(g.opensAt) <= datetime() AND datetime() < datetime(g.closesAt)
            AND datetime(g.opensAt) <= datetime($acceptedAt) AND datetime($acceptedAt) < datetime(g.closesAt)
          SET r.status = 'verified', r.receiptJson = $receiptJson, r.acceptedAt = coalesce(r.acceptedAt, $acceptedAt) RETURN r`,
          { id, receiptJson, acceptedAt: new Date().toISOString() });
        if (!result.records.length) throw new AnonymousReviewError('Review acceptance window is closed or inactive', 409);
    });
  }
  async claimCertification(id: string) {
    return (await this.read(`MATCH (r:AnonymousReviewSubmission {id: $id, status: 'awaiting_horizen'})
      SET r.status = 'certifying' RETURN r`, { id })).records.length > 0;
  }
  async submissions(groupId: string) {
    return (await this.read('MATCH (r:AnonymousReviewSubmission {groupId: $groupId}) RETURN r', { groupId }))
      .records.map(r => props(r.get('r')) as ReviewSubmission);
  }
  async saveSummary(id: string, summaryJson: string) {
    await this.read(`MATCH (g:AnonymousReviewCohort {id: $id}) WHERE g.summaryJson IS NULL SET g.summaryJson = $summaryJson`, { id, summaryJson });
    return (await this.cohort(id))!;
  }
  async tally(id: string): Promise<ReviewTallyRecord | null> {
    return props((await this.read('MATCH (t:AnonymousReviewTally {id: $id}) RETURN t', { id })).records[0]?.get('t')) || null;
  }
  async saveTally(item: ReviewTallyRecord) {
    return this.write(async tx => {
        const row = (await tx.run(`MERGE (t:AnonymousReviewTally {id: $id}) ON CREATE SET t += $item
          SET t.writeVersion = coalesce(t.writeVersion, 0) + 1 RETURN t`, { id: item.id, item })).records[0]!;
        const old = props(row.get('t')) as ReviewTallyRecord;
        if (old.manifestJson !== item.manifestJson || old.journal !== item.journal) throw new AnonymousReviewError('Tally snapshot is immutable', 409);
        return old;
    });
  }
  async claimTally(id: string, from: string[], status: string) {
    const result = await this.read(`MATCH (t:AnonymousReviewTally {id: $id}) WHERE t.status IN $from
      SET t.status = $status RETURN t`, { id, from, status });
    return props(result.records[0]?.get('t')) as ReviewTallyRecord | undefined;
  }
  async patchTally(id: string, values: Record<string, string>) {
    await this.read('MATCH (t:AnonymousReviewTally {id: $id}) SET t += $values', { id, values });
  }
  async certifyTally(id: string, receiptJson: string) {
    await this.write(async tx => {
        const row = (await tx.run(`MATCH (t:AnonymousReviewTally {id: $id})
          SET t.writeVersion = coalesce(t.writeVersion, 0) + 1 RETURN t`, { id })).records[0];
        const record = props(row?.get('t')) as ReviewTallyRecord | undefined;
        if (!record || !record.zkVerifyTx || !['awaiting_horizen', 'certified'].includes(record.status))
          throw new AnonymousReviewError('Tally is not awaiting certification', 409);
        if (record.receiptJson && record.receiptJson !== receiptJson) throw new AnonymousReviewError('Tally receipt is immutable', 409);
        await tx.run(`MATCH (t:AnonymousReviewTally {id: $id}) SET t.status = 'certified', t.receiptJson = $receiptJson`, { id, receiptJson });
    });
  }
  async publishedGroups(tutorId: string) {
    return (await this.read(`MATCH (g:AnonymousReviewCohort {tutorId: $tutorId}) WHERE g.summaryJson IS NOT NULL
      RETURN g.id AS id ORDER BY g.period DESC LIMIT 12`, { tutorId })).records.map(row => String(row.get('id')));
  }
}
