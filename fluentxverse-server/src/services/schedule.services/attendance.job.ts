import { ScheduleService } from './schedule.service';
import { lessonWorkflowService, dispatchLessonNotices } from '../lessonWorkflow.service';
import { StudentLessonIssueReportService } from '../studentLessonIssueReport.service';

const scheduleService = new ScheduleService();
const studentReports = new StudentLessonIssueReportService();
let running = false;
let seeded = false;
let workflowCheckedAt = 0;

export function startAttendanceJob(): void {
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
