export const studentTutorIssues = {
  no_show: 'Tutor did not join the classroom',
  late_join: 'Tutor joined late',
  left_early: 'Tutor left early or ended the lesson early',
  unresponsive: 'Tutor was unavailable or unresponsive during the lesson',
  audio_video: "Tutor's audio or video was not working",
  lesson_preferences: 'Tutor did not follow my lesson preferences or material request',
  unclear_explanations: "Tutor's explanations or corrections were unclear",
  inappropriate_behavior: 'Tutor behaved inappropriately or disrespectfully',
  other: 'Other tutor-related issue',
} as const;
export type StudentTutorIssue = keyof typeof studentTutorIssues;
export const studentTutorIssueLabel = (issue: string | null | undefined) =>
  issue && Object.hasOwn(studentTutorIssues, issue) ? studentTutorIssues[issue as StudentTutorIssue] : null;

export class StudentIssueReportValidationError extends Error {}
export function validateStudentTutorIssue(reason: string, issue: string | null | undefined, details: string, duringLesson = false, duringLessonTutorIssue = 'no_show') {
  if (reason === 'tutor') {
    if (!studentTutorIssueLabel(issue)) throw new StudentIssueReportValidationError('Choose what happened with the tutor.');
    if (duringLesson && issue !== duringLessonTutorIssue) throw new StudentIssueReportValidationError('During the lesson, the only tutor-related report available is the current tutor absence. You can report other tutor issues after the lesson ends.');
  } else if (issue != null) {
    throw new StudentIssueReportValidationError('A tutor issue can only be selected for a tutor-related report.');
  }
  if ((reason === 'other' || (reason === 'tutor' && issue === 'other')) && !details.trim()) {
    throw new StudentIssueReportValidationError('Please briefly explain the issue when choosing Other.');
  }
}
