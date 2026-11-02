export interface LessonIssueThread {
  id: string; bookingId: string; tutorId: string; body: string; createdAt: string;
  startsAt: string; deadline: string; state: string;
  decisionRevision?: number; decisionReason?: string; decidedAt?: string;
  replies: { id: string; role: string; body: string; createdAt: string; attachments?: { id: string }[] }[];
}
export const issueThreadStatus: Record<string, string> = {
  awaiting_tutor: 'Awaiting tutor explanation', awaiting_admin: 'Awaiting administrator review',
  ta301: 'TA-301 applied', cancelled: 'Lesson cancelled',
  no_penalty: 'No penalty', past: 'Slot deleted (PAST)',
};
