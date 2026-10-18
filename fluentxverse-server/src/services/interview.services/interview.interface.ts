/**
 * Interview Scheduling Interfaces
 */

export interface InterviewSlot {
  id: string;
  date: string;           // ISO date string (YYYY-MM-DD)
  time: string;           // Time string (HH:MM AM/PM)
  status: 'open' | 'booked' | 'completed' | 'cancelled';
  tutorId?: string;       // Tutor who booked (if booked)
  tutorName?: string;
  tutorEmail?: string;
  createdAt: string;
  bookedAt?: string;
  completedAt?: string;
  notes?: string;
  result?: 'pass' | 'fail';
}

export interface CreateInterviewSlotsRequest {
  slots: {
    date: string;
    time: string;
  }[];
}

export interface BookInterviewRequest {
  slotId: string;
  tutorId: string;
}

export interface CancelInterviewRequest {
  slotId: string;
  reason?: string;
}

export interface InterviewWeekSchedule {
  weekStart: string;
  weekEnd: string;
  slots: InterviewSlot[];
}

export interface PendingInterview {
  id: string;
  date: string;
  time: string;
  tutorId: string;
  tutorName: string;
  tutorEmail: string;
  bookedAt: string;
}
