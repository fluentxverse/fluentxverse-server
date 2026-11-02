import { ScheduleService } from './schedule.service';
import { lessonWorkflowService, dispatchLessonNotices } from '../lessonWorkflow.service';
import { StudentLessonIssueReportService } from '../studentLessonIssueReport.service';
import { LessonTroubleReportService } from '../lessonTroubleReport.service';
import { lessonIssueFollowupService } from '../lessonIssueFollowup.service';
import { studentDisputeService } from '../studentDispute.service';
import { dispatchDisputeReminders, reconcilePunctuality } from '../studentDispute.reminders';

const scheduleService = new ScheduleService();
const studentReports = new StudentLessonIssueReportService();
let running = false;
let seeded = false;
let workflowCheckedAt = 0;

export function startAttendanceJob(): void {
  let followupRunning = false;
  const followups = async () => {
    if (followupRunning) return;
    followupRunning = true;
    try {
      // Existing deadlines must still run if the PostgreSQL report outbox is unavailable.
      try { await scheduleService.reconcileMissedTutorRoomEntry(); }
      catch(error) { console.error('Attendance evidence unavailable; existing dispute deadlines will still run:',error); }
      await studentDisputeService.reconcile();
      await lessonIssueFollowupService.enforceDeadlines();
    } catch (error) { console.error('Lesson issue deadline enforcement failed:', error); }
    try { await dispatchDisputeReminders(); await reconcilePunctuality(); }
    catch(error) { console.error('Lesson reminder / punctuality reconciliation failed:',error); }
    try {
      await new LessonTroubleReportService().ensureSchema();
      await lessonIssueFollowupService.dispatch();
    } catch (error) { console.error('Lesson issue reply deadline reconciliation failed:', error); }
    finally { followupRunning = false; }
  };
  void followups();
  setInterval(() => void followups(), 60_000);
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (!seeded) {
        const repaired = await scheduleService.repairPrematureTutorRoomAbsence();
        if (repaired) console.info(`Reversed ${repaired} premature automatic tutor no-show(s)`);
        await scheduleService.enableAutoAttendanceForUpcomingBookings();
        await scheduleService.enableAutoAttendanceForUpcomingOpenSlots();
        await scheduleService.enableRoomEntryPolicyForUpcomingBookings();
        seeded = true;
      }
      const unbooked = await scheduleService.reconcileMissedOpenSlotAttendance();
      if (unbooked) console.info(`Marked ${unbooked} unconfirmed open slot(s) absent with TA-302`);
      const roomMissed = await scheduleService.reconcileMissedTutorRoomEntry();
      if (roomMissed) console.info(`Marked ${roomMissed} booked lesson(s) absent after no entry during the scheduled lesson`);
      if (Date.now() - workflowCheckedAt >= 60_000) {
        await lessonWorkflowService.reconcile();
        workflowCheckedAt = Date.now();
      }
      await dispatchLessonNotices();
      await studentReports.dispatchTutorNotifications();
    } catch (error) {
      console.error('Automatic tutor attendance reconciliation failed:', error);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => void run(), 5_000);
}
