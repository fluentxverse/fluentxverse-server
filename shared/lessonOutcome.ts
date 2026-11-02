export const lessonOutcomeCodes = ['both_attended', 'student_no_show', 'student_left_early', 'early_ended'] as const;
export type LessonOutcomeCode = typeof lessonOutcomeCodes[number];
export const completionDecisions = ['not_assessed', 'completion_approved', 'alternative_approved', 'completion_rejected', 'more_evidence_required'] as const;
export type CompletionDecision = typeof completionDecisions[number];
export const lessonOutcomeLabels: Record<LessonOutcomeCode, string> = {
  both_attended: 'Both participants attended',
  student_no_show: 'Tutor fulfilled student no-show waiting policy',
  student_left_early: 'Tutor remained available after student departure',
  early_ended: 'Early-ended lesson qualified under policy',
};
export const completionDecisionLabels: Record<CompletionDecision, string> = {
  not_assessed: 'Not assessed', completion_approved: 'Completion approved',
  alternative_approved: 'Alternative outcome approved', completion_rejected: 'Completion rejected',
  more_evidence_required: 'More evidence required',
};
export interface LessonOutcomeAssessment {
  policy: string;
  state: 'waiting_for_lesson_end' | 'waiting_for_reports' | 'review_required' | 'ineligible' | 'eligible';
  reason: string;
  outcome: LessonOutcomeCode | null;
  reportingClosesAt: string | null;
  assessedAt: string;
  proofStatus: 'not_generated';
  generationAvailable: false;
  zkVerified: false;
  proofRequest?: { id: string; phase: 'awaiting_prover' | 'needs_reassessment'; requestedAt: string } | null;
}
