import { describe, expect, test } from 'bun:test';
import { assessLessonOutcome, validateCompletionDecision, EARLY_END_THRESHOLD_MS, type OutcomeInput, type OutcomeReport } from '../src/services/lessonOutcome/policy';
import { requireOutcomeRequest } from '../src/services/lessonOutcome/requests';
import { lessonReportingWindow, STUDENT_REPORTING_WINDOW_MS } from '../src/utils/lessonReportingWindow';

const start = Date.parse('2026-10-01T01:00:00Z'), end = start + 25 * 60_000, deadline = end + STUDENT_REPORTING_WINDOW_MS;
const iso = (ms: number) => new Date(ms).toISOString();
const presence = (role: 'tutor' | 'student', from = start, to = end) => ({ role, joinedAt: iso(from), lastSeenAt: iso(to), leftAt: iso(to) });
const lesson = (change: Partial<OutcomeInput> = {}): OutcomeInput => ({ startsAt: iso(start), durationMinutes: 25,
  status: 'completed', attendanceTutor: 'present', attendanceStudent: 'present',
  presence: [presence('tutor'), presence('student')], reports: [], ...change });
const report = (change: Partial<OutcomeReport> = {}): OutcomeReport => ({ source: 'student', status: 'submitted', ...change });

describe('lesson outcome reporting and timing', () => {
  test('opens eligibility exactly 48 hours after scheduled end, never at lesson start plus 48 hours', () => {
    expect(assessLessonOutcome(lesson(), end - 1).state).toBe('waiting_for_lesson_end');
    expect(assessLessonOutcome(lesson(), end).state).toBe('waiting_for_reports');
    expect(assessLessonOutcome(lesson(), start + STUDENT_REPORTING_WINDOW_MS).state).toBe('waiting_for_reports');
    expect(assessLessonOutcome(lesson(), deadline - 1).state).toBe('waiting_for_reports');
    expect(assessLessonOutcome(lesson(), deadline).state).toBe('eligible');
    expect(lessonReportingWindow(iso(start), 25, 'completed', deadline).reason).toBe('expired');
  });
  test('reopening notes cannot reopen or extend student reporting', () => {
    const reportWindow = lessonReportingWindow(iso(start), 25, 'completed', deadline);
    expect(reportWindow.closesAt).toBe(iso(deadline));
    expect(reportWindow.reason).toBe('expired');
  });
  test('cancelled, unsupported, invalid-duration and malformed lessons never qualify', () => {
    expect(assessLessonOutcome(lesson({ status: 'cancelled' }), deadline).state).toBe('ineligible');
    for (const input of [lesson({ startsAt: 'bad' }), lesson({ durationMinutes: 0 }), lesson({ durationMinutes: 181 }), lesson({ status: 'unknown' })]) {
      expect(assessLessonOutcome(input, deadline).state).toBe('review_required');
    }
  });
});

describe('the four supported lesson scenarios', () => {
  test('1: both participants observed through lesson end with qualifying overlap', () => {
    expect(assessLessonOutcome(lesson(), deadline)).toMatchObject({ state: 'eligible', outcome: 'both_attended', proofStatus: 'not_generated', generationAvailable: false, zkVerified: false });
    expect(assessLessonOutcome(lesson({ presence: [presence('tutor')]}), deadline).state).toBe('review_required');
  });
  test('2: an explicitly absent student and a tutor fulfilling the no-show waiting interval', () => {
    const input = lesson({ attendanceStudent: 'absent', presence: [presence('tutor', start, start + EARLY_END_THRESHOLD_MS)] });
    expect(assessLessonOutcome(input, deadline)).toMatchObject({ state: 'eligible', outcome: 'student_no_show' });
    expect(assessLessonOutcome({ ...input, presence: [presence('tutor', start, start + EARLY_END_THRESHOLD_MS - 1)] }, deadline).state).toBe('review_required');
    expect(assessLessonOutcome({ ...input, presence: [...input.presence, presence('student')] }, deadline).state).toBe('review_required');
  });
  test('3: student leaves early while tutor remains through scheduled end', () => {
    for (const minutes of [4, 20]) {
      const input = lesson({ presence: [presence('tutor'), presence('student', start, start + minutes * 60_000)] });
      expect(assessLessonOutcome(input, deadline)).toMatchObject({ state: 'eligible', outcome: 'student_left_early' });
    }
  });
  test('4: arrival by +5:00 and observed departure at +10:01 qualifies without student interaction or approval', () => {
    const input = lesson({ presence: [presence('tutor', start + 300_000, start + 601_000), presence('student')] });
    expect(assessLessonOutcome(input, deadline)).toMatchObject({ state: 'eligible', outcome: 'early_ended' });
    expect(assessLessonOutcome(input, deadline - 1).state).toBe('waiting_for_reports');
    expect(assessLessonOutcome({ ...input, presence: [presence('tutor', start + 300_001, start + 601_000)] }, deadline).state).toBe('review_required');
    expect(assessLessonOutcome({ ...input, presence: [presence('tutor', start, start + 600_999)] }, deadline).state).toBe('review_required');
  });
  test('early entry counts from scheduled start, not from an earlier classroom visit', () => {
    const input = lesson({ presence: [presence('tutor', start - 300_000, start + 601_000)] });
    expect(assessLessonOutcome(input, deadline).outcome).toBe('early_ended');
    expect(assessLessonOutcome({ ...input, presence: [presence('tutor', start - 300_000, start + 300_000)] }, deadline).state).toBe('review_required');
  });
  test('missing observations and disjoint brief visits cannot manufacture time in the room', () => {
    const observed = presence('tutor');
    expect(assessLessonOutcome(lesson({ presence: [{ ...observed, lastSeenAt: null }] }), deadline).state).toBe('review_required');
    expect(assessLessonOutcome(lesson({ presence: [presence('tutor', start, start + 60_000), presence('tutor', start + 600_000, start + 700_000)] }), deadline).state).toBe('review_required');
    expect(assessLessonOutcome(lesson({ attendanceTutor: 'absent' }), deadline).state).toBe('ineligible');
    expect(assessLessonOutcome(lesson({ attendanceTutor: null }), deadline).state).toBe('review_required');
  });
});

describe('report decisions gate eligibility, not categories or free text', () => {
  test('unresolved student and tutor reports continue blocking after the deadline', () => {
    for (const source of ['student', 'tutor'] as const) for (const status of ['submitted', 'under_review', 'unknown']) {
      expect(assessLessonOutcome(lesson({ reports: [report({ source, status })] }), deadline + 30 * 86400000).state).toBe('review_required');
    }
  });
  test('old resolved reports do not implicitly approve completion', () => {
    for (const completionDecision of [undefined, 'not_assessed', 'more_evidence_required', 'garbage']) {
      expect(assessLessonOutcome(lesson({ reports: [report({ status: 'resolved', completionDecision })] }), deadline).state).toBe('review_required');
    }
  });
  test('all reports must agree on an evidence-supported outcome', () => {
    const approved = report({ status: 'resolved', completionDecision: 'completion_approved', completionOutcome: 'both_attended' });
    expect(assessLessonOutcome(lesson({ reports: [approved] }), deadline).state).toBe('eligible');
    expect(assessLessonOutcome(lesson({ reports: [approved, report({ source: 'tutor' })] }), deadline).state).toBe('review_required');
    expect(assessLessonOutcome(lesson({ reports: [approved, { ...approved, source: 'tutor', completionOutcome: 'early_ended' }] }), deadline).state).toBe('review_required');
    expect(assessLessonOutcome(lesson({ reports: [report({ status: 'resolved', completionDecision: 'completion_rejected' })] }), deadline).state).toBe('ineligible');
  });
  test('scenario 4 with a student report requires explicit matching support approval', () => {
    const input = lesson({ presence: [presence('tutor', start, start + 601_000)], reports: [report()] });
    expect(assessLessonOutcome(input, deadline).state).toBe('review_required');
    const approved = report({ status: 'resolved', completionDecision: 'alternative_approved', completionOutcome: 'early_ended' });
    expect(assessLessonOutcome({ ...input, reports: [approved] }, deadline)).toMatchObject({ state: 'eligible', outcome: 'early_ended' });
    expect(assessLessonOutcome({ ...input, reports: [{ ...approved, completionOutcome: 'both_attended' }] }, deadline).state).toBe('review_required');
  });
  test('reopening or correcting evidence removes prior eligibility', () => {
    const approved = report({ status: 'resolved', completionDecision: 'completion_approved', completionOutcome: 'both_attended' });
    expect(assessLessonOutcome(lesson({ reports: [approved] }), deadline).state).toBe('eligible');
    expect(assessLessonOutcome(lesson({ reports: [{ ...approved, status: 'under_review' }] }), deadline).state).toBe('review_required');
    expect(assessLessonOutcome(lesson({ reports: [approved], presence: [presence('tutor', start, start + 601_000)] }), deadline).state).toBe('review_required');
  });
});

describe('support decisions and request authorization', () => {
  test('TA-301 blocks all four scenarios, even with a present flag and support approval', () => {
    const approved = report({ status: 'resolved', completionDecision: 'completion_approved', completionOutcome: 'both_attended' });
    for (const tutorAbsencePenalty of ['active', 'booking_marker'] as const) {
      expect(assessLessonOutcome(lesson({ tutorAbsencePenalty }), deadline)).toMatchObject({ state: 'review_required', reason: 'ta301_attendance_conflict' });
      expect(assessLessonOutcome(lesson({ tutorAbsencePenalty, reports: [approved] }), deadline).state).toBe('review_required');
      expect(assessLessonOutcome(lesson({ tutorAbsencePenalty, attendanceTutor: 'absent' }), deadline)).toMatchObject({ state: 'ineligible', reason: 'active_ta301' });
      expect(assessLessonOutcome(lesson({ tutorAbsencePenalty, attendanceTutor: null }), deadline).state).toBe('ineligible');
      for (const input of [
        lesson({ tutorAbsencePenalty, attendanceStudent: 'absent', presence: [presence('tutor', start, start + 601_000)] }),
        lesson({ tutorAbsencePenalty, presence: [presence('tutor'), presence('student', start, start + 240_000)] }),
        lesson({ tutorAbsencePenalty, presence: [presence('tutor', start, start + 601_000)] }),
      ]) expect(assessLessonOutcome(input, deadline).state).not.toBe('eligible');
    }
  });
  test('clearing TA-301 does not bypass reporting or attendance requirements', () => {
    expect(assessLessonOutcome(lesson({ tutorAbsencePenalty: 'none' }), deadline).state).toBe('eligible');
    expect(assessLessonOutcome(lesson({ tutorAbsencePenalty: 'none' }), deadline - 1).state).toBe('waiting_for_reports');
    expect(assessLessonOutcome(lesson({ tutorAbsencePenalty: 'none', attendanceTutor: 'absent' }), deadline).state).toBe('ineligible');
    expect(assessLessonOutcome(lesson({ tutorAbsencePenalty: 'none', reports: [report()] }), deadline).state).toBe('review_required');
  });
  test('validates decision, resolution status and outcome semantics', () => {
    expect(validateCompletionDecision('resolved')).toEqual({ decision: 'not_assessed', outcome: null });
    expect(validateCompletionDecision('resolved', 'completion_approved', 'both_attended').outcome).toBe('both_attended');
    expect(validateCompletionDecision('resolved', 'alternative_approved', 'early_ended').outcome).toBe('early_ended');
    expect(() => validateCompletionDecision('submitted', 'completion_approved', 'both_attended')).toThrow();
    expect(() => validateCompletionDecision('resolved', 'completion_approved', 'early_ended')).toThrow();
    expect(() => validateCompletionDecision('resolved', 'alternative_approved', 'both_attended')).toThrow();
    expect(() => validateCompletionDecision('resolved', 'not_assessed', 'both_attended')).toThrow();
    expect(() => validateCompletionDecision('resolved', 'alternative_approved')).toThrow();
    expect(() => validateCompletionDecision('resolved', 'invalid')).toThrow();
  });
  test('reported lessons always require manual support dispatch, even after approval', () => {
    expect(() => requireOutcomeRequest({ state: 'eligible' }, false, 'automatic')).not.toThrow();
    expect(() => requireOutcomeRequest({ state: 'eligible' }, true, 'automatic')).toThrow('manual support');
    expect(() => requireOutcomeRequest({ state: 'eligible' }, true, 'support')).not.toThrow();
    expect(() => requireOutcomeRequest({ state: 'review_required' }, true, 'support')).toThrow('not eligible');
    expect(() => requireOutcomeRequest({ state: 'waiting_for_reports' }, false, 'automatic')).toThrow('not eligible');
  });
});
