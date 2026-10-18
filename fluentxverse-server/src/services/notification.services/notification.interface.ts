// Notification service interfaces

export type NotificationType = 
  | 'booking_new'
  | 'booking_cancelled'
  | 'session_reminder'
  | 'session_started'
  | 'interview_scheduled'
  | 'interview_reminder'
  | 'payment_received'
  | 'review_received'
  | 'profile_submitted'
  | 'profile_approved'
  | 'profile_rejected'
  | 'system'
  | 'message'
  | 'minting_started'
  | 'minting_success'
  | 'minting_failed'
  | 'profile_change_submitted'
  | 'profile_change_approved'
  | 'profile_change_rejected';

export interface Notification {
  id: string;
  userId: string;
  userType: 'tutor' | 'student' | 'admin';
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  data?: {
    bookingId?: string;
    slotId?: string;
    sessionId?: string;
    studentId?: string;
    studentName?: string;
    tutorId?: string;
    tutorName?: string;
    date?: string;
    time?: string;
    amount?: number;
    rating?: number;
    link?: string;
    // Minting-related data
    transactionId?: string;
    tokenId?: string;
    tier?: string;
    supply?: number;
    mintType?: 'create' | 'additional';
    errorMessage?: string;
    // Profile change data
    itemKey?: string;
    rejectionReason?: string;
    reason?: string;
  };
}

export interface CreateNotificationParams {
  userId: string;
  userType: 'tutor' | 'student' | 'admin';
  type: NotificationType;
  title: string;
  message: string;
  data?: Notification['data'];
}

export interface NotificationFilters {
  userId: string;
  isRead?: boolean;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}
