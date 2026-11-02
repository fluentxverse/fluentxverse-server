// Explicitly run against the disposable interview QA graph, never application data.
import { expect, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { InterviewService } from '../src/services/interview.services/interview.service';
import { getTutorCertificationProofStatus } from '../src/services/proof.services/tutorCertificationProof.service';
import { AdminService } from '../src/services/admin.services/admin.service';

test('interview decisions are independent, revisable, audited and safely reflected in application approval', async () => {
  if (process.env.INTERVIEW_TEST_URI !== 'bolt://127.0.0.1:17698') throw Error('Use the disposable interview QA graph');
  await initDriver(process.env.INTERVIEW_TEST_URI, '', '', 1);
  const session = getDriver().session();
  const service = new InterviewService();
  let ownsFixture = false;
  try {
    expect((await session.run('MATCH(n) RETURN count(n) AS total')).records[0]!.get('total').toNumber()).toBe(0);
    ownsFixture = true;
    await session.run(`CREATE (:User {id:'review-applicant',firstName:'Review',email:'review@example.invalid',role:'tutor',
      writtenExamPassed:true,speakingExamPassed:true,profileStatus:'incomplete',createdAt:'2026-10-28'}),
      (:Tutor {odIuser:'review-applicant'}),
      (:InterviewSlot {id:'review-slot',tutorId:'review-applicant',status:'booked',date:'2026-10-28',
        time:'2:00 PM',bookedAt:'2026-10-28T01:00:00Z'})`);
    const data = { slotId: 'review-slot', tutorId: 'review-applicant', result: 'pass' as const,
      rubricScores: { grammar: 4, fluency: 4, pronunciation: 4, vocabulary: 4, professionalism: 4 },
      notes: 'Human review', timestamps: [], adminId: 'review-admin', expectedReviewedAt: null };
    expect(await service.saveInterviewResult(data)).toBe(true);
    let room = await service.getRoom(data.slotId);
    expect(room?.status).toBe('booked');
    expect(room?.mediaClosed).toBe(false);
    expect(room?.result).toBe('pass');
    await expect(service.cancelBooking(data.slotId, data.tutorId)).rejects.toThrow();
    expect((await getTutorCertificationProofStatus(data.tutorId)).snapshot.missingRequirements).toEqual(['profile_approval']);
    expect(await service.saveInterviewResult(data)).toBe(false); // Lost-response retry is idempotent.
    await expect(service.saveInterviewResult({ ...data, result: 'fail' })).rejects.toThrow('changed');
    await service.completeInterview(data.slotId);
    expect((await service.getRoom(data.slotId))?.result).toBe('pass');
    expect(await service.saveInterviewResult({ ...data, result: 'fail', expectedReviewedAt: room!.reviewedAt as string })).toBe(true);
    room = await service.getRoom(data.slotId);
    expect(room?.status).toBe('completed');
    expect(room?.result).toBe('fail');
    const failed = (await getTutorCertificationProofStatus(data.tutorId)).snapshot;
    expect(failed.interviewPassed).toBe(false);
    expect(failed.missingRequirements).toContain('interview_pass');
    const user = (await session.run("MATCH(u:User {id:'review-applicant'}) RETURN u")).records[0]!.get('u').properties;
    expect(user.interviewPassed).toBe(false);
    expect(user.certificationStatus).toBe('pending');
    expect((await service.getTutorInterview(data.tutorId))?.result).toBe('fail');
    expect((await new AdminService().getPendingTutors(10)).find(user => user.id === data.tutorId)?.interviewResult).toBe('fail');
    await session.run("MATCH(u:User {id:'review-applicant'}) SET u.profileStatus='approved'");
    expect(await service.saveInterviewResult({ ...data, expectedReviewedAt: room!.reviewedAt as string })).toBe(true);
    expect((await getTutorCertificationProofStatus(data.tutorId)).snapshot.missingRequirements).toEqual([]);
    expect((await service.getInterviewResult(data.tutorId))?.result).toBe('pass');
    const revisions = (await session.run("MATCH(r:InterviewResultRevision {slotId:'review-slot'}) RETURN count(r) AS total")).records[0]!.get('total').toNumber();
    expect(revisions).toBe(3);
    await session.run(`CREATE (:InterviewSlot {id:'newer-review', tutorId:'review-applicant',status:'booked',bookedAt:'2026-10-29T01:00:00Z'})`);
    await expect(service.saveInterviewResult({ ...data, result: 'fail', expectedReviewedAt: (await service.getRoom(data.slotId))!.reviewedAt as string })).rejects.toThrow('latest interview');
    await expect(service.saveInterviewResult({ ...data, slotId: 'newer-review', tutorId: 'not-owner' })).rejects.toThrow();
  } finally {
    if (ownsFixture) {
      await session.run("MATCH(n) WHERE n.id IN ['review-applicant','review-slot','newer-review'] OR n.tutorId='review-applicant' OR n.odIuser='review-applicant' DETACH DELETE n");
      await session.run("MATCH(c:InterviewCalendar {id:'main'}) DELETE c");
    }
    await session.close();
    await closeDriver();
  }
});
