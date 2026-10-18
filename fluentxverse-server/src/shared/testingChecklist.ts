export const TESTING_RUN = 'mvp-pilot-20261014-v1';

export interface TestingCheck {
  id: string;
  category: string;
  title: string;
  steps: string;
  expected: string;
  gate?: string;
}

export const testingChecklist: TestingCheck[] = [
  { id: 'student-social', category: 'Authentication', title: 'Student social sign-in', steps: 'Use a test student account on student.fluentxverse.com. Try each enabled provider: Google, Apple, and X. Sign out and sign in again.', expected: 'The correct student account opens, with no login loop or stale authenticated state.' },
  { id: 'student-booking-auth', category: 'Authentication', title: 'Book immediately after student sign-in', steps: 'Sign in from a fresh browser session and open a tutor booking modal without refreshing.', expected: 'The booking modal recognizes the signed-in student immediately.' },
  { id: 'tutor-login-logout', category: 'Authentication', title: 'Tutor sign-in and persistent logout', steps: 'Sign in on tutor.fluentxverse.com, sign out, refresh, and open another tab.', expected: 'The tutor remains signed out until explicitly signing in again.' },
  { id: 'classroom-new-tab', category: 'Authentication', title: 'Booked lesson opens in a new tab', steps: 'While signed in, open a booked lesson from the student and tutor schedules.', expected: 'Both classroom tabs retain the correct account and lesson, without a false session-expired prompt.' },
  { id: 'admin-access', category: 'Authentication', title: 'Dashboard permissions and sign-out', steps: 'Use operations, support, QA, and finance test admins. Try restricted views and API requests; then log out.', expected: 'Unauthorized actions are refused by the server. Logout removes dashboard access.' },
  { id: 'booking-happy-path', category: 'Bookings', title: 'Book an available lesson', steps: 'Use a designated test tutor and student. Book an available slot and inspect both schedules and notifications.', expected: 'Exactly one booking appears for both accounts, with matching time and lesson details.' },
  { id: 'booking-concurrency', category: 'Bookings', title: 'Two students compete for one slot', steps: 'With two test students, attempt to book the same available slot at the same time.', expected: 'Only one booking succeeds. The other student is not charged or left with a phantom booking.' },
  { id: 'booking-cancellation', category: 'Bookings', title: 'Cancellation and refund handling', steps: 'Cancel a test booking under the applicable cancellation policy. Inspect schedules, credits, and finance records.', expected: 'The cancellation and eligible refund happen once. Cancelled or refunded lessons cannot earn tutor compensation.' },
  { id: 'schedule-timezones', category: 'Bookings', title: 'Schedule time zones and mobile layout', steps: 'Compare one test booking on desktop and mobile using two different device time zones.', expected: 'Both devices refer to the same actual lesson time; controls remain readable and usable.' },
  { id: 'call-separate-networks', category: 'Live Lessons', title: 'Student and tutor join from separate networks', steps: 'Run a designated test lesson with the tutor on Wi-Fi and student on mobile data. Confirm the configured call provider.', expected: 'Both sides see and hear each other. The intended RealtimeKit session is used, not an accidental legacy fallback.' },
  { id: 'call-device-controls', category: 'Live Lessons', title: 'Microphone, camera, and device controls', steps: 'Mute/unmute, disable/enable video, and switch available input devices on both sides.', expected: 'Controls match actual media state, device changes work, and the remote participant updates correctly.' },
  { id: 'call-permissions', category: 'Live Lessons', title: 'Denied media permission and recovery', steps: 'Deny microphone/camera permission in a test browser, then grant permission and retry.', expected: 'A clear recoverable error appears. Granting permission allows joining without duplicate sessions.' },
  { id: 'call-refresh', category: 'Live Lessons', title: 'Refresh during a live lesson', steps: 'Refresh the student classroom, then the tutor classroom while the other participant stays connected.', expected: 'Each participant rejoins the same lesson without duplicate attendance or a stranded call.' },
  { id: 'call-reconnect', category: 'Live Lessons', title: 'Network interruption and reconnect', steps: 'Briefly disable the student network, restore it, then repeat for the tutor. Also try switching Wi-Fi to mobile data.', expected: 'Connection loss is visible and media recovers without creating another booking or room.' },
  { id: 'call-session-refresh', category: 'Live Lessons', title: 'Automatic authentication renewal in class', steps: 'Keep a test lesson open across a configured authentication renewal boundary; coordinate a shortened test lifetime if needed.', expected: 'The session renews automatically without a refresh-session modal or interrupted lesson.' },
  { id: 'lesson-materials', category: 'Live Lessons', title: 'Lesson materials, notes, and navigation', steps: 'Open lesson materials, move between sections, enter tutor notes, and reload during the test lesson.', expected: 'The correct materials remain accessible and saved notes are restored without exposing another lesson.' },
  { id: 'lesson-close', category: 'Live Lessons', title: 'Lesson closure and attendance', steps: 'Finish a fully attended test lesson and inspect both apps and the dashboard lesson record.', expected: 'The lesson closes once, attendance and finalization agree, and participants cannot continue an ended session.' },
  { id: 'interview-call', category: 'Interviews & Recordings', title: 'Dashboard tutor interview', steps: 'Schedule and run a test interview with an applicant on a separate network. Check media controls, reconnect, and closure.', expected: 'Only the assigned interview participants enter; the interview remains operational and ends cleanly.' },
  { id: 'recording-notice', category: 'Interviews & Recordings', title: 'Recording notice and verified status', steps: 'Join a recording-enabled test lesson or interview and compare on-screen status with the server/provider state.', expected: 'Participants receive the recording notice. Recording status reflects verified server state, not a cosmetic client toggle.' },
  { id: 'recording-storage', category: 'Interviews & Recordings', title: 'Recording archived to private Seaweed storage', steps: 'Complete a recorded test session and wait for provider processing. Check the archive and QA listing.', expected: 'The recording is stored privately in Seaweed, associated with the correct session, and plays successfully.' },
  { id: 'recording-access', category: 'Interviews & Recordings', title: 'Recording authorization and access logs', steps: 'Play a test recording as an authorized QA admin. Attempt access as a student, tutor, and admin without QA permission.', expected: 'Only authorized administrators can play it. Access is logged and public or unauthorized requests are refused.' },
  { id: 'recording-retention', category: 'Interviews & Recordings', title: 'Recording retention and deletion', steps: 'Use an expired synthetic recording fixture to exercise the configured retention job; do not delete real class evidence.', expected: 'Expired recordings are removed according to the configured policy and unexpired recordings remain available.' },
  { id: 'salary-rate', category: 'USD Earnings', title: 'Set and update a tutor base rate', steps: 'As a finance admin, set a USD per-lesson rate on a test tutor, change it, then inspect history and restricted access.', expected: 'Exact USD cents and rate history are retained in Memgraph. Non-finance admins cannot change compensation.' },
  { id: 'salary-post', category: 'USD Earnings', title: 'Approve an eligible completed lesson', steps: 'Using the finance API, approve a finalized, attended test lesson and repeat the same approval. Compare its completion time against rate history.', expected: 'One immutable earning is created using the rate effective at finalization; repeated approval never doubles earnings.' },
  { id: 'salary-ineligible', category: 'USD Earnings', title: 'Reject non-payable lessons', steps: 'Attempt finance approval for synthetic cancelled, refunded, held, incomplete, and absent-participant lessons.', expected: 'All ineligible lessons are rejected and no earnings are created.' },
  { id: 'salary-reservation', category: 'USD Earnings', title: 'Payout reservation and duplicate protection', steps: 'Using the finance API, reserve synthetic earnings, retry the request, and submit overlapping reservations concurrently.', expected: 'Retries are idempotent; overlapping claims are rejected. Reservation does not send money or imply ZK verification.' },
  { id: 'proof-receipt', category: 'Proofs & Release Gates', title: 'Existing synthetic proof receipt reconciliation', steps: 'In GMR Engine, inspect existing QA proof submissions and their native and Horizen finalized receipts. Do not resubmit or spend funds.', expected: 'Native verification and finalized Horizen acceptance are distinct; pending finality never displays as finalized success.' },
  { id: 'screening-live', category: 'Proofs & Release Gates', title: 'Live privately verifiable tutor certification', steps: 'After release approval, screen a real test applicant and verify issuer, policy, expiry, revocation, and the public credential statement.', expected: 'Only reviewed and approved credentials can activate certification.', gate: 'Requires independently reviewed proving artifacts, trusted setup records, and approved production deployment.' },
  { id: 'payout-live', category: 'Proofs & Release Gates', title: 'Live payout claim and settlement', steps: 'After release approval, test an authorized claim, duplicate rejection, expiry/revocation, and settlement reconciliation with an approved small amount.', expected: 'Only authorized, unclaimed earnings settle; the ledger matches actual transfers.', gate: 'Real claims and transfers remain disabled pending reviewed artifacts, custody, consumer deployment, and settlement integration. Shielded settlement is not live.' },
  { id: 'ops-monitoring', category: 'Operations', title: 'Error monitoring and support escalation', steps: 'Create a safe test failure in a non-customer session and follow it through logs, alerts, and support.', expected: 'The team can identify the affected session and investigate without logging passwords, access tokens, or private recording URLs.' },
  { id: 'ops-restore', category: 'Operations', title: 'Backup and recovery drill', steps: 'Restore designated backups into an isolated environment, including Memgraph finance records and private recording metadata.', expected: 'Restored records reconcile correctly without modifying production or duplicating payouts.' },
];

export interface TestingState {
  id: string;
  completed: boolean;
  notes: string;
  revision: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export function validateTestingUpdate(id: string, input: { completed: boolean; notes: string; revision: number }) {
  const item = testingChecklist.find(check => check.id === id);
  if (!item) throw new Error('Unknown test item.');
  if (typeof input.completed !== 'boolean' || typeof input.notes !== 'string' || input.notes.length > 2000 || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('Invalid checklist update.');
  if (item.gate && input.completed) throw new Error('This test is gated and cannot be marked passed yet.');
  return { ...input, notes: input.notes.trim() };
}
