import { completionDecisions, lessonOutcomeCodes, type CompletionDecision, type LessonOutcomeAssessment, type LessonOutcomeCode } from '../../../../shared/lessonOutcome';
import { mergedPresence, type PresenceInterval } from '../lessonPrivacy/policy';
import { lessonReportingWindow } from '../../utils/lessonReportingWindow';

export const LESSON_OUTCOME_POLICY = 'fluentxverse.lesson-outcome.v2.draft2';
export const TUTOR_ARRIVAL_CUTOFF_MS = 5 * 60_000;
export const EARLY_END_THRESHOLD_MS = 601_000;
export class LessonOutcomePolicyError extends Error {}
export interface OutcomeReport {
  source: 'student' | 'tutor'; status: string;
  completionDecision?: string | null; completionOutcome?: string | null;
}
export interface OutcomeInput {
  startsAt: string; durationMinutes: number; status: string;
  attendanceTutor?: string | null; attendanceStudent?: string | null;
  tutorAbsencePenalty?: 'active' | 'booking_marker' | 'none';
  presence: PresenceInterval[]; reports: OutcomeReport[];
}

export function validateCompletionDecision(status: string, decision: unknown = 'not_assessed', outcome: unknown = null) {
  if (!completionDecisions.includes(decision as CompletionDecision)) throw new LessonOutcomePolicyError('Invalid completion decision.');
  const approved = decision === 'completion_approved' || decision === 'alternative_approved';
  if (approved || decision === 'completion_rejected') {
    if (status !== 'resolved') throw new LessonOutcomePolicyError('Resolve the report before approving or rejecting completion.');
  }
  if (approved) {
    if (!lessonOutcomeCodes.includes(outcome as LessonOutcomeCode)) throw new LessonOutcomePolicyError('Select the approved lesson outcome.');
    if ((decision === 'completion_approved') !== (outcome === 'both_attended')) throw new LessonOutcomePolicyError('Use alternative approval for a no-show or early-ended outcome.');
  } else if (outcome != null) throw new LessonOutcomePolicyError('Only an approval can specify a lesson outcome.');
  return { decision: decision as CompletionDecision, outcome: approved ? outcome as LessonOutcomeCode : null };
}

export function assessLessonOutcome(input: OutcomeInput, now = Date.now()): LessonOutcomeAssessment {
  const base = { policy: LESSON_OUTCOME_POLICY, assessedAt: new Date(now).toISOString(),
    proofStatus: 'not_generated' as const, generationAvailable: false as const, zkVerified: false as const };
  let window: ReturnType<typeof lessonReportingWindow>;
  try { window = lessonReportingWindow(input.startsAt, input.durationMinutes, input.status, now); }
  catch { return { ...base, state: 'review_required', reason: 'invalid_lesson_timing', outcome: null, reportingClosesAt: null }; }
  const start = Date.parse(window.startsAt), end = Date.parse(window.endsAt);
  const result = (state: LessonOutcomeAssessment['state'], reason: string, outcome: LessonOutcomeCode | null = null): LessonOutcomeAssessment =>
    ({ ...base, state, reason, outcome, reportingClosesAt: window.closesAt });
  if (input.status === 'cancelled') return result('ineligible', 'cancelled');
  if (input.status === 'past') return result('ineligible', 'administratively_removed');
  if (!['confirmed', 'completed'].includes(input.status)) return result('review_required', 'unsupported_booking_status');
  // A presence flag or report approval cannot override an uncleared TA-301.
  if (input.tutorAbsencePenalty === 'active' || input.tutorAbsencePenalty === 'booking_marker') {
    return input.attendanceTutor === 'present'
      ? result('review_required', 'ta301_attendance_conflict')
      : result('ineligible', 'active_ta301');
  }
  if (now < end) return result('waiting_for_lesson_end', 'lesson_not_ended');
  if (input.reports.some(r => r.completionDecision === 'completion_rejected' && r.status === 'resolved')) return result('ineligible', 'completion_rejected');
  // A report is never cleared by a category, elapsed time or a free-text resolution.
  if (input.reports.some(r => r.status !== 'resolved' || !['completion_approved', 'alternative_approved'].includes(r.completionDecision || ''))) {
    return result('review_required', 'reports_require_explicit_approval');
  }
  if (now < Date.parse(window.closesAt)) return result('waiting_for_reports', 'student_reporting_open');
  if (input.attendanceTutor === 'absent') return result('ineligible', 'tutor_marked_absent');
  if (input.attendanceTutor !== 'present') return result('review_required', 'tutor_attendance_unconfirmed');
  const tutor = mergedPresence(input.presence, 'tutor', start, end);
  const student = mergedPresence(input.presence, 'student', start, end);
  if (!tutor.length) return result('review_required', 'insufficient_tutor_presence');
  // A connected interval must cover the waiting threshold; a brief visit/rejoin is insufficient.
  const qualifyingTutor = tutor.find(([from, to]) => from <= start + TUTOR_ARRIVAL_CUTOFF_MS && to >= start + EARLY_END_THRESHOLD_MS);
  if (!qualifyingTutor) return result('review_required', 'arrival_or_waiting_requirement_not_met');
  let overlap = 0;
  for (const [a, b] of tutor) for (const [c, d] of student) overlap += Math.max(0, Math.min(b, d) - Math.max(a, c));
  // Reuse the dispute-evidence threshold for the draft both-attended outcome only.
  const overlapThreshold = Math.min(15 * 60_000, end - start);
  const lastTutor = tutor.at(-1)![1], lastStudent = student.at(-1)?.[1];
  let outcome: LessonOutcomeCode;
  if (input.attendanceStudent === 'absent' && !student.length) outcome = 'student_no_show';
  else if (input.attendanceStudent === 'absent' && student.length) return result('review_required', 'student_attendance_conflicts_with_presence');
  else if (lastStudent !== undefined && lastStudent < end && lastTutor >= end) outcome = 'student_left_early';
  else if (lastTutor < end) outcome = 'early_ended';
  else if (input.attendanceStudent === 'present' && overlap >= overlapThreshold) outcome = 'both_attended';
  else return result('review_required', 'insufficient_student_outcome_evidence');
  // An absent student cannot be turned into a learner-completion credential by an approval.
  if (input.reports.some(r => r.completionOutcome !== outcome ||
    (r.completionDecision === 'completion_approved') !== (outcome === 'both_attended'))) {
    return result('review_required', 'review_outcome_conflicts_with_evidence', outcome);
  }
  return result('eligible', input.reports.length ? 'review_approved' : 'reporting_closed_without_issues', outcome);
}
