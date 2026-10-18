export const tutorStudentIssues = {
  asked_to_cancel: 'Student asked to cancel',
  late: 'Student is late',
} as const;
export type TutorStudentIssue = keyof typeof tutorStudentIssues;
export const tutorStudentIssueLabel = (issue: string | null | undefined) =>
  issue && Object.hasOwn(tutorStudentIssues, issue) ? tutorStudentIssues[issue as TutorStudentIssue] : null;

export class TutorIssueReportValidationError extends Error {}
export function validateTutorStudentIssue(reason: string, issue?: string | null) {
  if (reason === 'student' && !tutorStudentIssueLabel(issue)) {
    throw new TutorIssueReportValidationError('Choose what happened with the student.');
  }
  if (reason !== 'student' && issue != null) {
    throw new TutorIssueReportValidationError('A student issue can only be selected for a student-related report.');
  }
}
