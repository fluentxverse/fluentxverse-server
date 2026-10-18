import { getDriver } from '../../db/memgraph';
import { NotificationService } from '../notification.services/notification.service';

const notificationService = new NotificationService();

/**
 * Session Reminder Service
 * Handles scheduled reminders for upcoming sessions
 */
export class SessionReminderService {
  
  /**
   * Check for upcoming sessions and send reminders
   * Should be called every minute by a cron job or interval
   */
  async checkAndSendReminders(): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const now = new Date();
      
      // Check for sessions starting in 15 minutes
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
      const sixteenMinutesFromNow = new Date(now.getTime() + 16 * 60 * 1000);
      
      // Format dates for comparison
      const todayDate = now.toISOString().split('T')[0];
      
      // Find bookings starting in 15-16 minutes that haven't been reminded
      const result = await session.run(`
        MATCH (b:Booking {status: 'confirmed'})
        WHERE b.bookingDate = $todayDate
          AND b.reminderSent IS NULL
          OR b.reminderSent = false
        MATCH (t:User {id: b.tutorId})
        OPTIONAL MATCH (s:User {id: b.studentId})
        RETURN b, t.firstName as tutorFirstName, t.lastName as tutorLastName,
               s.firstName as studentFirstName, s.lastName as studentLastName
      `, { todayDate });
      
      for (const record of result.records) {
        const booking = record.get('b').properties;
        const tutorName = `${record.get('tutorFirstName') || ''} ${record.get('tutorLastName') || ''}`.trim() || 'Your tutor';
        const studentName = `${record.get('studentFirstName') || ''} ${record.get('studentLastName') || ''}`.trim() || 'Your student';
        
        // Parse booking time
        const [time, period] = booking.bookingTime.split(' ');
        let [hours, minutes] = time.split(':').map(Number);
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        const bookingDateTime = new Date(booking.bookingDate);
        bookingDateTime.setHours(hours, minutes, 0, 0);
        
        // Check if booking is within the 15-16 minute window
        if (bookingDateTime >= fifteenMinutesFromNow && bookingDateTime < sixteenMinutesFromNow) {
          // Send reminder to tutor
          await notificationService.notifySessionReminder(
            booking.tutorId,
            'tutor',
            studentName,
            booking.bookingDate,
            booking.bookingTime,
            booking.bookingId,
            15
          );
          
          // Send reminder to student
          if (booking.studentId) {
            await notificationService.notifySessionReminder(
              booking.studentId,
              'student',
              tutorName,
              booking.bookingDate,
              booking.bookingTime,
              booking.bookingId,
              15
            );
          }
          
          // Mark reminder as sent
          await session.run(`
            MATCH (b:Booking {bookingId: $bookingId})
            SET b.reminderSent = true
          `, { bookingId: booking.bookingId });
          
        }
      }
      
      // Also check for 5-minute reminders
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      const sixMinutesFromNow = new Date(now.getTime() + 6 * 60 * 1000);
      
      const fiveMinResult = await session.run(`
        MATCH (b:Booking {status: 'confirmed'})
        WHERE b.bookingDate = $todayDate
          AND b.reminderSent = true
          AND (b.fiveMinReminderSent IS NULL OR b.fiveMinReminderSent = false)
        MATCH (t:User {id: b.tutorId})
        OPTIONAL MATCH (s:User {id: b.studentId})
        RETURN b, t.firstName as tutorFirstName, t.lastName as tutorLastName,
               s.firstName as studentFirstName, s.lastName as studentLastName
      `, { todayDate });
      
      for (const record of fiveMinResult.records) {
        const booking = record.get('b').properties;
        const tutorName = `${record.get('tutorFirstName') || ''} ${record.get('tutorLastName') || ''}`.trim() || 'Your tutor';
        const studentName = `${record.get('studentFirstName') || ''} ${record.get('studentLastName') || ''}`.trim() || 'Your student';
        
        // Parse booking time
        const [time, period] = booking.bookingTime.split(' ');
        let [hours, minutes] = time.split(':').map(Number);
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        const bookingDateTime = new Date(booking.bookingDate);
        bookingDateTime.setHours(hours, minutes, 0, 0);
        
        // Check if booking is within the 5-6 minute window
        if (bookingDateTime >= fiveMinutesFromNow && bookingDateTime < sixMinutesFromNow) {
          // Send 5-minute reminder to tutor
          await notificationService.notifySessionReminder(
            booking.tutorId,
            'tutor',
            studentName,
            booking.bookingDate,
            booking.bookingTime,
            booking.bookingId,
            5
          );
          
          // Send 5-minute reminder to student
          if (booking.studentId) {
            await notificationService.notifySessionReminder(
              booking.studentId,
              'student',
              tutorName,
              booking.bookingDate,
              booking.bookingTime,
              booking.bookingId,
              5
            );
          }
          
          // Mark 5-minute reminder as sent
          await session.run(`
            MATCH (b:Booking {bookingId: $bookingId})
            SET b.fiveMinReminderSent = true
          `, { bookingId: booking.bookingId });
          
        }
      }
      
    } catch (error) {
      console.error('Error checking session reminders:', error);
    } finally {
      await session.close();
    }
  }

  /**
   * Check for upcoming interviews and send reminders
   */
  async checkInterviewReminders(): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const now = new Date();
      const todayDate = now.toISOString().split('T')[0];
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
      const sixteenMinutesFromNow = new Date(now.getTime() + 16 * 60 * 1000);
      
      // Find interviews starting in 15-16 minutes
      const result = await session.run(`
        MATCH (i:InterviewSlot {status: 'booked'})
        WHERE i.date = $todayDate
          AND (i.reminderSent IS NULL OR i.reminderSent = false)
        RETURN i
      `, { todayDate });
      
      for (const record of result.records) {
        const interview = record.get('i').properties;
        
        // Parse interview time
        const [time, period] = interview.time.split(' ');
        let [hours, minutes] = time.split(':').map(Number);
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        const interviewDateTime = new Date(interview.date);
        interviewDateTime.setHours(hours, minutes, 0, 0);
        
        if (interviewDateTime >= fifteenMinutesFromNow && interviewDateTime < sixteenMinutesFromNow) {
          // Send reminder to applicant
          if (interview.applicantId) {
            await notificationService.notifyInterviewReminder(
              interview.applicantId,
              interview.date,
              interview.time,
              15
            );
          }
          
          // Mark reminder as sent
          await session.run(`
            MATCH (i:InterviewSlot {id: $id})
            SET i.reminderSent = true
          `, { id: interview.id });
          
        }
      }
      
    } catch (error) {
      console.error('Error checking interview reminders:', error);
    } finally {
      await session.close();
    }
  }
}

// Create singleton instance
const sessionReminderService = new SessionReminderService();

/**
 * Start the reminder check interval
 * Call this function when the server starts
 */
export const startReminderService = () => {
  
  // Check every minute
  setInterval(async () => {
    await sessionReminderService.checkAndSendReminders();
    await sessionReminderService.checkInterviewReminders();
  }, 60 * 1000);
  
  // Also run immediately on startup
  sessionReminderService.checkAndSendReminders();
  sessionReminderService.checkInterviewReminders();
};

export { sessionReminderService };
