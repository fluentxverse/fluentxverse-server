import { getDriver } from '../../db/memgraph';
import { AnonymousReviewError } from './policy';
import { REVIEW_MAX_MEMBERS } from '../../shared/anonymousReviews';

export interface ReviewCohort {
  id: string; tutorId: string; period: string; scope: string; chainId: number; contract: string;
  opensAt: string; closesAt: string; root?: string; membersJson?: string; summaryJson?: string;
  activationStatus?: string; activationTransactionId?: string;
}
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
  async enrollment(id: string): Promise<{ commitment: string } | null> {
    return props((await this.read('MATCH (e:AnonymousReviewEnrollment {id: $id}) RETURN e', { id })).records[0]?.get('e')) || null;
  }
  async enroll(cohort: ReviewCohort, enrollmentId: string, studentId: string, commitment: string) {
    await this.ready(); const db = getDriver().session();
    try {
      return await db.executeWrite(async tx => {
        const row = (await tx.run(`MERGE (g:AnonymousReviewCohort {id: $id}) ON CREATE SET g += $cohort
          SET g.writeVersion = coalesce(g.writeVersion, 0) + 1 RETURN g`, { id: cohort.id, cohort })).records[0]!;
        const g = props(row.get('g'));
        if (g.scope !== cohort.scope || g.contract !== cohort.contract || g.opensAt !== cohort.opensAt)
          throw new AnonymousReviewError('Review deployment changed', 409);
        const old = props((await tx.run('MATCH (e:AnonymousReviewEnrollment {id: $id}) RETURN e', { id: enrollmentId })).records[0]?.get('e'));
        if (old) {
          if (old.commitment !== commitment) throw new AnonymousReviewError('Restore your original review key; enrollment cannot be replaced', 409);
          return;
        }
        if (g.root || Date.now() >= Date.parse(g.opensAt)) throw new AnonymousReviewError('Enrollment has closed', 409);
        const members = (await tx.run('MATCH (e:AnonymousReviewEnrollment {groupId: $id}) RETURN e.commitment AS commitment', { id: cohort.id })).records;
        if (members.length >= REVIEW_MAX_MEMBERS) throw new AnonymousReviewError('Review cohort is full', 409);
        const identityId = `${cohort.id}:${commitment}`;
        const duplicate = (await tx.run('MATCH (n:AnonymousReviewCommitment {id: $id}) RETURN n', { id: identityId })).records;
        if (duplicate.length) throw new AnonymousReviewError('Review key already enrolled', 409);
        await tx.run(`CREATE (:AnonymousReviewCommitment {id: $identityId})
          CREATE (:AnonymousReviewEnrollment {id: $id, groupId: $groupId, studentId: $studentId, commitment: $commitment})`,
          { identityId, id: enrollmentId, groupId: cohort.id, studentId, commitment });
      });
    } finally { await db.close(); }
  }
  async memberships(studentId: string) {
    return (await this.read(`MATCH (e:AnonymousReviewEnrollment {studentId: $studentId}), (g:AnonymousReviewCohort {id: e.groupId})
      RETURN g, e.commitment AS commitment ORDER BY g.period DESC LIMIT 100`, { studentId })).records
      .map(r => ({ cohort: props(r.get('g')) as ReviewCohort, commitment: r.get('commitment') as string }));
  }
  async memberCount(groupId: string) {
    const value = (await this.read('MATCH (e:AnonymousReviewEnrollment {groupId: $groupId}) RETURN count(e) AS total', { groupId }))
      .records[0]!.get('total');
    return value?.toNumber ? value.toNumber() : Number(value);
  }
  async seal(id: string, build: (members: string[]) => { root: string; membersJson: string }) {
    await this.ready(); const db = getDriver().session();
    try {
      return await db.executeWrite(async tx => {
        const g = props((await tx.run(`MATCH (g:AnonymousReviewCohort {id: $id})
          SET g.writeVersion = coalesce(g.writeVersion, 0) + 1 RETURN g`, { id })).records[0]?.get('g')) as ReviewCohort;
        if (!g) throw new AnonymousReviewError('Review cohort not found', 404);
        if (g.root) return g;
        if (Date.now() < Date.parse(g.opensAt) || Date.now() >= Date.parse(g.closesAt)) throw new AnonymousReviewError('Cohort is outside its activation window', 409);
        const members = (await tx.run(`MATCH (e:AnonymousReviewEnrollment {groupId: $id})
          RETURN e.commitment AS commitment ORDER BY e.commitment`, { id })).records.map(r => String(r.get('commitment')));
        const sealed = build(members);
        await tx.run('MATCH (g:AnonymousReviewCohort {id: $id}) SET g += $sealed', { id, sealed });
        return { ...g, ...sealed };
      });
    } finally { await db.close(); }
  }
  async saveSubmission(item: ReviewSubmission) {
    await this.ready(); const db = getDriver().session();
    try {
      return await db.executeWrite(async tx => {
        const row = (await tx.run(`MERGE (r:AnonymousReviewSubmission {id: $id}) ON CREATE SET r += $item RETURN r`, { id: item.id, item })).records[0]!;
        const old = props(row.get('r')) as ReviewSubmission;
        if (JSON.parse(old.proofJson).message !== JSON.parse(item.proofJson).message)
          throw new AnonymousReviewError('This review entitlement has already been used', 409);
        return old;
      });
    } finally { await db.close(); }
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
    await this.ready(); const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
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
    } finally { await db.close(); }
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
    await this.ready(); const db = getDriver().session();
    try {
      return await db.executeWrite(async tx => {
        const row = (await tx.run(`MERGE (t:AnonymousReviewTally {id: $id}) ON CREATE SET t += $item
          SET t.writeVersion = coalesce(t.writeVersion, 0) + 1 RETURN t`, { id: item.id, item })).records[0]!;
        const old = props(row.get('t')) as ReviewTallyRecord;
        if (old.manifestJson !== item.manifestJson || old.journal !== item.journal) throw new AnonymousReviewError('Tally snapshot is immutable', 409);
        return old;
      });
    } finally { await db.close(); }
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
    await this.ready(); const db = getDriver().session();
    try {
      await db.executeWrite(async tx => {
        const row = (await tx.run(`MATCH (t:AnonymousReviewTally {id: $id})
          SET t.writeVersion = coalesce(t.writeVersion, 0) + 1 RETURN t`, { id })).records[0];
        const record = props(row?.get('t')) as ReviewTallyRecord | undefined;
        if (!record || !record.zkVerifyTx || !['awaiting_horizen', 'certified'].includes(record.status))
          throw new AnonymousReviewError('Tally is not awaiting certification', 409);
        if (record.receiptJson && record.receiptJson !== receiptJson) throw new AnonymousReviewError('Tally receipt is immutable', 409);
        await tx.run(`MATCH (t:AnonymousReviewTally {id: $id}) SET t.status = 'certified', t.receiptJson = $receiptJson`, { id, receiptJson });
      });
    } finally { await db.close(); }
  }
  async publishedGroups(tutorId: string) {
    return (await this.read(`MATCH (g:AnonymousReviewCohort {tutorId: $tutorId}) WHERE g.summaryJson IS NOT NULL
      RETURN g.id AS id ORDER BY g.period DESC LIMIT 12`, { tutorId })).records.map(row => String(row.get('id')));
  }
}
