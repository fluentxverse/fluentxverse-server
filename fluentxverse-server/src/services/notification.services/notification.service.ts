import { v4 as uuidv4 } from 'uuid';
import { getDriver } from '../../db/memgraph';
import type { Notification, CreateNotificationParams, NotificationFilters } from './notification.interface';
import neo4j from 'neo4j-driver';

export class NotificationService {
  /**
   * Create a new notification
   */
  async createNotification(params: CreateNotificationParams): Promise<Notification> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const notification: Notification = {
        id: uuidv4(),
        userId: params.userId,
        userType: params.userType,
        type: params.type,
        title: params.title,
        message: params.message,
        timestamp: new Date().toISOString(),
        isRead: false,
        data: params.data || {}
      };

      await session.run(`
        CREATE (n:Notification {
          id: $id,
          userId: $userId,
          userType: $userType,
          type: $type,
          title: $title,
          message: $message,
          timestamp: $timestamp,
          isRead: $isRead,
          data: $data
        })
      `, {
        id: notification.id,
        userId: notification.userId,
        userType: notification.userType,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        timestamp: notification.timestamp,
        isRead: notification.isRead,
        data: JSON.stringify(notification.data)
      });

      return notification;
    } finally {
      await session.close();
    }
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(filters: NotificationFilters): Promise<Notification[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      let query = `
        MATCH (n:Notification)
        WHERE n.userId = $userId
      `;
      
      const params: Record<string, any> = {
        userId: filters.userId,
        limit: neo4j.int(filters.limit || 50),
        offset: neo4j.int(filters.offset || 0)
      };

      if (filters.isRead !== undefined) {
        query += ` AND n.isRead = $isRead`;
        params.isRead = filters.isRead;
      }

      if (filters.type) {
        query += ` AND n.type = $type`;
        params.type = filters.type;
      }

      query += `
        RETURN n
        ORDER BY n.timestamp DESC
        SKIP $offset
        LIMIT $limit
      `;

      const result = await session.run(query, params);
      
      return result.records.map(record => {
        const n = record.get('n').properties;
        return {
          id: n.id,
          userId: n.userId,
          userType: n.userType,
          type: n.type,
          title: n.title,
          message: n.message,
          timestamp: n.timestamp,
          isRead: n.isRead,
          data: n.data ? JSON.parse(n.data) : {}
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string): Promise<number> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(`
        MATCH (n:Notification)
        WHERE n.userId = $userId AND n.isRead = false
        RETURN count(n) as count
      `, { userId });

      const count = result.records[0]?.get('count');
      return count?.toNumber?.() ?? count ?? 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(`
        MATCH (n:Notification)
        WHERE n.id = $notificationId AND n.userId = $userId
        SET n.isRead = true
        RETURN n
      `, { notificationId, userId });

      return result.records.length > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(`
        MATCH (n:Notification)
        WHERE n.userId = $userId AND n.isRead = false
        SET n.isRead = true
        RETURN count(n) as updated
      `, { userId });

      const updated = result.records[0]?.get('updated');
      return updated?.toNumber?.() ?? updated ?? 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(`
        MATCH (n:Notification)
        WHERE n.id = $notificationId AND n.userId = $userId
        DELETE n
        RETURN count(*) as deleted
      `, { notificationId, userId });

      const deleted = result.records[0]?.get('deleted');
      return (deleted?.toNumber?.() ?? deleted ?? 0) > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Delete old notifications (cleanup job)
   */
  async deleteOldNotifications(daysOld: number = 30): Promise<number> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const result = await session.run(`
        MATCH (n:Notification)
        WHERE n.timestamp < $cutoffDate AND n.isRead = true
        DELETE n
        RETURN count(*) as deleted
      `, { cutoffDate: cutoffDate.toISOString() });

      const deleted = result.records[0]?.get('deleted');
      return deleted?.toNumber?.() ?? deleted ?? 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Create booking notification for tutor
   */
  async notifyNewBooking(
    tutorId: string,
    studentName: string,
    date: string,
    time: string,
    bookingId: string,
    studentId?: string,
    slotDate?: string,
    slotId?: string
  ): Promise<Notification> {
    return this.createNotification({
      userId: tutorId,
      userType: 'tutor',
      type: 'booking_new',
      title: 'New Session Booked',
      message: `${studentName} has booked a session on ${date} at ${time}`,
      data: {
        bookingId,
        slotId,
        studentId,
        studentName,
        date: slotDate || date,
        time,
        link: `/lesson/${encodeURIComponent(bookingId)}`
      }
    });
  }

  /**
   * Create booking cancellation notification
   */
  async notifyBookingCancelled(tutorId: string, studentName: string, date: string, time: string): Promise<Notification> {
    return this.createNotification({
      userId: tutorId,
      userType: 'tutor',
      type: 'booking_cancelled',
      title: 'Session Cancelled',
      message: `${studentName} has cancelled their session on ${date} at ${time}`,
      data: {
        studentName,
        date,
        time,
        link: '/schedule'
      }
    });
  }

  /**
   * Create session reminder notification
   */
  async notifySessionReminder(userId: string, userType: 'tutor' | 'student', partnerName: string, date: string, time: string, sessionId: string, minutesBefore: number = 15): Promise<Notification> {
    return this.createNotification({
      userId,
      userType,
      type: 'session_reminder',
      title: 'Session Starting Soon',
      message: `Your session with ${partnerName} starts in ${minutesBefore} minutes`,
      data: {
        sessionId,
        date,
        time,
        link: `/classroom/${sessionId}`
      }
    });
  }

  /**
   * Create review received notification
   */
  async notifyReviewReceived(tutorId: string, studentName: string, rating: number): Promise<Notification> {
    return this.createNotification({
      userId: tutorId,
      userType: 'tutor',
      type: 'review_received',
      title: 'New Review Received',
      message: `${studentName} left you a ${rating}-star review`,
      data: {
        studentName,
        rating,
        link: '/profile'
      }
    });
  }

  /**
   * Create payment received notification
   */
  async notifyPaymentReceived(tutorId: string, amount: number, studentName: string): Promise<Notification> {
    return this.createNotification({
      userId: tutorId,
      userType: 'tutor',
      type: 'payment_received',
      title: 'Payment Received',
      message: `You received ₱${amount.toFixed(2)} from ${studentName}`,
      data: {
        amount,
        studentName,
        link: '/earnings'
      }
    });
  }

  /**
   * Create interview reminder notification
   */
  async notifyInterviewReminder(userId: string, date: string, time: string, minutesBefore: number = 15): Promise<Notification> {
    return this.createNotification({
      userId,
      userType: 'tutor',
      type: 'interview_reminder',
      title: 'Interview Starting Soon',
      message: `Your interview starts in ${minutesBefore} minutes`,
      data: {
        date,
        time,
        link: '/interview'
      }
    });
  }

  /**
   * Create interview scheduled notification
   */
  async notifyInterviewScheduled(userId: string, date: string, time: string): Promise<Notification> {
    // Format the date nicely
    const dateObj = new Date(date + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    });

    return this.createNotification({
      userId,
      userType: 'tutor',
      type: 'interview_scheduled',
      title: 'Interview Scheduled',
      message: `Your interview has been scheduled for ${formattedDate} at ${time}`,
      data: {
        date,
        time,
        link: '/interview'
      }
    });
  }

  /**
   * Create interview cancelled notification
   */
  async notifyInterviewCancelled(userId: string, date: string, time: string): Promise<Notification> {
    const dateObj = new Date(date + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    });

    return this.createNotification({
      userId,
      userType: 'tutor',
      type: 'interview_scheduled', // Reusing type
      title: 'Interview Cancelled',
      message: `Your interview for ${formattedDate} at ${time} has been cancelled`,
      data: {
        date,
        time,
        link: '/interview'
      }
    });
  }
}
