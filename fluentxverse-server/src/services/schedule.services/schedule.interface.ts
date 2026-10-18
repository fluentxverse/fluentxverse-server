/**
 * Schedule Service - Interfaces and Types
 * Manages tutor availability, bookings, and penalty tracking using Memgraph
 */

export interface TimeSlot {
  slotId: string;
  tutorId: string;
  slotDate: string; // YYYY-MM-DD
  slotTime: string; // HH:MM format (24-hour)
  durationMinutes: number; // default 30
  status: 'available' | 'open' | 'booked' | 'completed' | 'cancelled';
  isRecurring: boolean;
  recurringPattern?: 'weekly' | 'biweekly';
  createdAt: Date;
  updatedAt: Date;
}

export interface Booking {
  bookingId: string;
  slotId: string;
  tutorId: string;
  studentId: string;
  slotDateTime: Date;
  durationMinutes: number;
  status: 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  attendanceTutor?: 'present' | 'absent';
  attendanceStudent?: 'present' | 'absent';
  penaltyCode?: string;
  penaltyReason?: string;
  penaltyTimestamp?: Date;
  bookedAt: Date;
  cancelledAt?: Date;
  completedAt?: Date;
}

export interface WeeklyTemplate {
  templateId: string;
  tutorId: string;
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  slotTime: string; // HH:MM
  isActive: boolean;
  createdAt: Date;
}

export interface PenaltyHistory {
  penaltyId: string;
  tutorId: string;
  bookingId?: string;
  slotId?: string;
  penaltyCode: string;
  penaltyReason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectsCompensation: boolean;
  createdAt: Date;
  resolvedAt?: Date;
  appealStatus?: 'pending' | 'approved' | 'denied';
}

export interface OpenSlotsInput {
  tutorId: string;
  slots: Array<{
    date: string; // YYYY-MM-DD
    time: string; // HH:MM
  }>;
}

export interface CloseSlotsInput {
  tutorId: string;
  slotIds: string[];
  reason: 'Internet Outage' | 'Electric Outage' | 'Emergency' | 'Disaster' | 'Health' | 'Others';
  additionalInfo?: string;
}

export interface BulkOpenSlotsInput {
  tutorId: string;
  startDate: string;
  endDate: string;
  times: string[]; // Array of HH:MM times
  daysOfWeek?: number[]; // Optional: specific days, default all
}

export interface MarkAttendanceInput {
  bookingId?: string;
  slotId?: string;
  tutorId: string;
  role: 'tutor' | 'student';
  status: 'present' | 'absent';
}

export interface WeekScheduleParams {
  tutorId: string;
  weekOffset: number; // 0 = current week, 1 = next week, -1 = last week
}

export interface WeekSchedule {
  schedulingBlock?: { active: boolean; expiresAt: string | null };
  weekStart: Date;
  weekEnd: Date;
  slots: Array<{
    date: string;
    time: string;
    status: string;
    reservationExpiresAt?: string;
    slotId?: string;
    bookingId?: string;
    bookedAt?: string;
    attendanceWindowOpenedAt?: string;
    tutorRoomEnteredAt?: string;
    roomEntryPolicyActivatedAt?: string;
    roomEntryCheckCompletedAt?: string;
    attendanceSource?: string;
    studentId?: string;
    studentName?: string;
    penaltyCode?: string;
    penaltyReason?: string;
    ta303Count?: number;
    ta303ReopenCount?: number;
    lastTa303At?: string;
    attendanceTutor?: string;
    attendanceStudent?: string;
    attendanceMarked?: string;
  }>;
}

export interface AvailableSlot {
  slotId: string;
  tutorId: string;
  date: string;
  time: string;
  durationMinutes: number;
}

export interface BookSlotInput {
  privatePassReservationId?: string;
  studentId: string;
  slotId: string;
  reservationId: string;
  ticketTransferTxHash?: string; // Transaction hash from frontend ticket transfer
}

export interface CancelBookingInput {
  bookingId: string;
  cancelledBy: string; // userId
  reason?: string;
}

export interface SaveTemplateInput {
  tutorId: string;
  schedule: Array<{
    dayOfWeek: number;
    time: string;
  }>;
}

export interface ApplyTemplateInput {
  tutorId: string;
  startDate: string;
  endDate: string;
}

export interface PenaltySummary {
  tutorId: string;
  thisMonth: {
    ta301: number;
    ta302: number;
    ta303: number;
    total: number;
  };
  last30Days: {
    ta301: number;
    ta302: number;
    ta303: number;
    total: number;
  };
  activeBlock: boolean;
  blockExpiresAt?: Date;
  recentPenalties: PenaltyHistory[];
}
