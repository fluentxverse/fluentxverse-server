/**
 * FluentXVerse Penalty Code System
 * Applied to tutor schedule slots for attendance and compliance tracking
 */

export enum PenaltyCode {
  // Tutor Absence Codes
  TA_BOOKED = '301',        // Tutor Absence - Booked Slot
  TA_UNBOOKED = '302',      // Tutor Absence - Unbooked Slot
  TA_SHORT_NOTICE = '303',  // Short Notice Cancellation (< 48 hours)
  
  // Slot Status Codes
  SUBSTITUTION = '401',     // Substitution/Temporary Closure
  SYSTEM_ISSUE = '501',     // System/Student Issue
  STUDENT_ABSENT = '502',   // Student No-Show
  
  // Warning States
  PENALTY_BLOCK = '601',    // Temporary block on future unbooked slots
}

export interface PenaltyCodeInfo {
  code: PenaltyCode;
  label: string;
  description: string;
  affectsCompensation: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  color: string;
}

export const PENALTY_CODE_DETAILS: Record<PenaltyCode, PenaltyCodeInfo> = {
  [PenaltyCode.TA_BOOKED]: {
    code: PenaltyCode.TA_BOOKED,
    label: 'TA-301',
    description: 'Tutor explicitly reports absence for a booked lesson, or never enters the classroom during its scheduled time. Automatic no-show penalties apply only after the lesson ends.',
    affectsCompensation: true,
    severity: 'critical',
    color: '#dc2626' // red-600
  },
  
  [PenaltyCode.TA_UNBOOKED]: {
    code: PenaltyCode.TA_UNBOOKED,
    label: 'TA-302',
    description: 'An open, unbooked slot without a Present confirmation becomes TA-302 after the 11-minute attendance deadline. It closes and cannot be reopened.',
    affectsCompensation: true,
    severity: 'high',
    color: '#ea580c' // orange-600
  },
  
  [PenaltyCode.TA_SHORT_NOTICE]: {
    code: PenaltyCode.TA_SHORT_NOTICE,
    label: 'TA-303',
    description: 'Unbooked slot cancelled less than 48 hours before start. A same-day cancellation may reopen once after 30 minutes; an earlier cancellation may reopen once on the lesson day. A second TA-303 permanently closes that slot.',
    affectsCompensation: false,
    severity: 'medium',
    color: '#f59e0b' // amber-500
  },
  
  [PenaltyCode.SUBSTITUTION]: {
    code: PenaltyCode.SUBSTITUTION,
    label: 'SUB-401',
    description: 'Slot temporarily closed for potential substitution. Becomes available again 30 minutes before lesson if no transfer occurs.',
    affectsCompensation: false,
    severity: 'low',
    color: '#6366f1' // indigo-500
  },
  
  [PenaltyCode.SYSTEM_ISSUE]: {
    code: PenaltyCode.SYSTEM_ISSUE,
    label: 'SYS-501',
    description: 'Lesson terminated or not conducted due to system or student-side issues. Tutor is compensated.',
    affectsCompensation: false,
    severity: 'low',
    color: '#8b5cf6' // violet-500
  },
  
  [PenaltyCode.STUDENT_ABSENT]: {
    code: PenaltyCode.STUDENT_ABSENT,
    label: 'STU-502',
    description: 'Student failed to attend the booked lesson. Tutor is compensated.',
    affectsCompensation: false,
    severity: 'low',
    color: '#06b6d4' // cyan-500
  },
  
  [PenaltyCode.PENALTY_BLOCK]: {
    code: PenaltyCode.PENALTY_BLOCK,
    label: 'BLK-601',
    description: 'Temporary block on future unbooked slots due to repeated absences (3+ TA-301 codes in 30 days).',
    affectsCompensation: true,
    severity: 'critical',
    color: '#991b1b' // red-800
  },
};

/**
 * Business rules for penalty code assignment
 */
export const PENALTY_RULES = {
  // Time threshold for short notice cancellation
  SHORT_NOTICE_HOURS: 48,
  
  // Number of TA-301 codes before triggering block
  TA_BOOKED_THRESHOLD: 3,
  
  // Period (days) to count TA-301 occurrences
  PENALTY_WINDOW_DAYS: 30,
  
  // Duration of penalty block (days)
  BLOCK_DURATION_DAYS: 7,
  
  // Minutes before slot when substitution closes
  SUBSTITUTION_CLOSE_MINUTES: 30,
};

/**
 * Helper function to determine penalty code based on slot circumstances
 */
export function determinePenaltyCode(params: {
  wasBooked: boolean;
  cancellationNoticeHours?: number;
  tutorPresent: boolean;
  studentPresent?: boolean;
  systemIssue?: boolean;
  isSubstitution?: boolean;
}): PenaltyCode | null {
  const { wasBooked, cancellationNoticeHours, tutorPresent, studentPresent, systemIssue, isSubstitution } = params;
  
  // Substitution takes priority
  if (isSubstitution) {
    return PenaltyCode.SUBSTITUTION;
  }
  
  // System or student issues
  if (systemIssue || (wasBooked && !studentPresent && tutorPresent)) {
    if (studentPresent === false) {
      return PenaltyCode.STUDENT_ABSENT;
    }
    return PenaltyCode.SYSTEM_ISSUE;
  }

  if (!wasBooked && cancellationNoticeHours !== undefined) {
    return cancellationNoticeHours < PENALTY_RULES.SHORT_NOTICE_HOURS
      ? PenaltyCode.TA_SHORT_NOTICE : null;
  }
  
  // Tutor absence cases
  if (!tutorPresent) {
    if (wasBooked) {
      return PenaltyCode.TA_BOOKED;
    } else {
      return PenaltyCode.TA_UNBOOKED;
    }
  }
  
  return null;
}
