import { t } from 'elysia';

export const completionReviewFields = {
  completionDecision: t.Optional(t.Union([
    t.Literal('not_assessed'), t.Literal('completion_approved'), t.Literal('alternative_approved'),
    t.Literal('completion_rejected'), t.Literal('more_evidence_required'),
  ])),
  completionOutcome: t.Optional(t.Union([
    t.Literal('both_attended'), t.Literal('student_no_show'), t.Literal('student_left_early'), t.Literal('early_ended'), t.Null(),
  ])),
};
