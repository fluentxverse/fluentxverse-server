export type ApplicationStage = 'pending_written' | 'pending_speaking' | 'processing' | 'pending_interview'
  | 'interview_scheduled' | 'interview_review' | 'interview_passed' | 'interview_failed' | 'pending_profile' | 'certified';
export type ApplicationFilter = 'all' | ApplicationStage;

export interface TutorApplication {
  id: string;
  name: string;
  email: string;
  registeredAt: string | null;
  status: ApplicationStage;
  writtenExamPassed: boolean;
  speakingExamPassed: boolean;
  interviewResult: 'pass' | 'fail' | null;
  interviewSlotId: string | null;
  interviewDate: string | null;
  profileStatus: string;
  identityStatus?: string;
}

export interface ApplicationCounts {
  total: number;
  pendingWritten: number;
  pendingSpeaking: number;
  processing: number;
  interviewPassed: number;
  interviewFailed: number;
  pendingProfile: number;
  certified: number;
}

export interface ApplicationPage {
  items: TutorApplication[];
  counts: ApplicationCounts;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export const applicationFilters: readonly ApplicationFilter[] = ['all', 'pending_written', 'pending_speaking', 'processing',
  'pending_interview', 'interview_scheduled', 'interview_review', 'interview_passed', 'interview_failed', 'pending_profile', 'certified'];

export function applicationPage(items: TutorApplication[], filter: ApplicationFilter, requestedPage: number, pageSize: number): ApplicationPage {
  const counts: ApplicationCounts = { total: items.length, pendingWritten: 0, pendingSpeaking: 0, processing: 0,
    interviewPassed: 0, interviewFailed: 0, pendingProfile: 0, certified: 0 };
  for (const item of items) {
    if (item.status === 'pending_written') counts.pendingWritten++;
    if (item.status === 'pending_speaking') counts.pendingSpeaking++;
    if (item.status === 'processing') counts.processing++;
    if (item.interviewResult === 'pass') counts.interviewPassed++;
    if (item.interviewResult === 'fail') counts.interviewFailed++;
    if (item.profileStatus === 'pending_review') counts.pendingProfile++;
    if (item.status === 'certified') counts.certified++;
  }
  const filtered = items.filter(item => filter === 'all' || (filter === 'interview_passed' ? item.interviewResult === 'pass'
    : filter === 'interview_failed' ? item.interviewResult === 'fail'
    : filter === 'pending_profile' ? item.profileStatus === 'pending_review' : item.status === filter));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), counts, total: filtered.length, page, pageSize, pageCount };
}
