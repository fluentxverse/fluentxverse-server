export const STUDENT_FEEDBACK_MIN_LENGTH = 100;
export const TUTOR_HANDOFF_MAX_LENGTH = 150;

export interface LessonFeedbackIssue {
  field: 'studentFeedback' | 'tutorHandoff' | 'stoppingPoint';
  materialType?: string;
  materialId?: string;
}
export class LessonFeedbackInvalid extends Error {
  constructor(message: string, public readonly validation?: LessonFeedbackIssue) { super(message); }
}

export function assertLessonFeedback(studentComment: string, tutorMemo: string) {
  if (studentComment.trim().length < STUDENT_FEEDBACK_MIN_LENGTH) {
    throw new LessonFeedbackInvalid('Student feedback must contain at least 100 characters.', { field: 'studentFeedback' });
  }
  if (tutorMemo.length > TUTOR_HANDOFF_MAX_LENGTH) {
    throw new LessonFeedbackInvalid('Tutor handoff must not exceed 150 characters.', { field: 'tutorHandoff' });
  }
}
