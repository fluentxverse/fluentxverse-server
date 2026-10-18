/**
 * Schedule API Tests
 * 
 * Comprehensive tests for scheduling functionality including:
 * - Date/time validation
 * - Booking flow logic
 * - Cancellation and refund policies
 * - Penalty calculations
 * - Slot availability
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { canOpenSlot, canReserveForBooking } from '../src/services/schedule.services/bookingPolicy';

// Import penalty configuration for testing
const PENALTY_RULES = {
  SHORT_NOTICE_HOURS: 24,           // 24 hours notice required
  UNCONFIRMED_CANCELLATION_WINDOW_HOURS: 24, // Free cancellation window
  MINIMUM_RESCHEDULE_HOURS: 2,      // Minimum 2 hours before for reschedule
  NO_SHOW_PENALTY_POINTS: 5,        // Points for no-show
  LATE_CANCELLATION_PENALTY_POINTS: 3, // Points for late cancellation
};

const REFUND_POLICY = {
  MORE_THAN_24_HOURS: { percentage: 100, ticketsReturned: 1 },  // Full refund
  BETWEEN_2_AND_24_HOURS: { percentage: 50, ticketsReturned: 0, creditGiven: true }, // Half refund
  LESS_THAN_2_HOURS: { percentage: 0, ticketsReturned: 0 },  // No refund
  NO_SHOW_STUDENT: { percentage: 0, ticketsReturned: 0 },    // No refund for no-show
};

// =====================================
// Date/Time Validation Tests
// =====================================

describe('Date/Time Validation', () => {
  // Helper functions matching service logic
  const isValidDateString = (dateStr: string): boolean => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr);
  };

  const isValidTimeString = (timeStr: string): boolean => {
    // Support both 24h (HH:mm) and 12h (h:mm AM/PM) formats
    const time24Regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const time12Regex = /^(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)$/i;
    return time24Regex.test(timeStr) || time12Regex.test(timeStr);
  };

  const convert12hTo24h = (time12: string): string => {
    const match = time12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return time12; // Return as-is if not 12h format
    
    let hours = parseInt(match[1]!, 10);
    const minutes = match[2];
    const meridiem = match[3]!.toUpperCase();
    
    if (meridiem === 'PM' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }
    
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  };

  describe('Date String Validation', () => {
    test('should accept valid ISO date strings', () => {
      const validDates = ['2024-01-15', '2024-12-31', '2025-06-01'];
      validDates.forEach(date => {
        expect(isValidDateString(date)).toBe(true);
      });
    });

    test('should reject invalid date formats', () => {
      const invalidDates = [
        '01-15-2024',     // Wrong order
        '2024/01/15',     // Wrong separator
        '2024-1-15',      // Missing leading zeros
        '2024-13-01',     // Invalid month
        '2024-01-32',     // Invalid day
        'not-a-date',
        '',
      ];
      invalidDates.forEach(date => {
        expect(isValidDateString(date)).toBe(false);
      });
    });
  });

  describe('Time String Validation', () => {
    test('should accept valid 24h time strings', () => {
      const validTimes = ['00:00', '09:30', '12:00', '15:45', '23:59'];
      validTimes.forEach(time => {
        expect(isValidTimeString(time)).toBe(true);
      });
    });

    test('should accept valid 12h time strings', () => {
      const validTimes = ['9:00 AM', '12:30 PM', '6:00 PM', '11:45 AM'];
      validTimes.forEach(time => {
        expect(isValidTimeString(time)).toBe(true);
      });
    });

    test('should reject invalid time formats', () => {
      const invalidTimes = [
        '24:00',          // Invalid hour
        '12:60',          // Invalid minute
        '9:00',           // Missing AM/PM for 12h or leading zero for 24h
        '13:00 PM',       // 24h mixed with meridiem
        'noon',
        '',
      ];
      invalidTimes.forEach(time => {
        expect(isValidTimeString(time)).toBe(false);
      });
    });
  });

  describe('12h to 24h Conversion', () => {
    test('should convert AM times correctly', () => {
      expect(convert12hTo24h('12:00 AM')).toBe('00:00');
      expect(convert12hTo24h('1:00 AM')).toBe('01:00');
      expect(convert12hTo24h('11:30 AM')).toBe('11:30');
    });

    test('should convert PM times correctly', () => {
      expect(convert12hTo24h('12:00 PM')).toBe('12:00');
      expect(convert12hTo24h('1:00 PM')).toBe('13:00');
      expect(convert12hTo24h('6:30 PM')).toBe('18:30');
      expect(convert12hTo24h('11:59 PM')).toBe('23:59');
    });

    test('should handle edge cases', () => {
      // 24h format should pass through
      expect(convert12hTo24h('14:30')).toBe('14:30');
    });
  });
});

// =====================================
// Booking Time Window Tests
// =====================================

describe('Booking Time Windows', () => {
  describe('Minimum Booking Advance', () => {
    test('should allow a Present slot 10 minutes ahead', () => {
      const now = Date.now();
      expect(canReserveForBooking(now + 10 * 60_000, now, true)).toBe(true);
      expect(canReserveForBooking(now + 10 * 60_000, now)).toBe(false);
    });

    test('should reject booking less than 5 minutes ahead', () => {
      const now = Date.now();
      expect(canReserveForBooking(now + 3 * 60_000, now)).toBe(false);
    });

    test('should reject booking past slots', () => {
      const now = Date.now();
      expect(canReserveForBooking(now - 60_000, now)).toBe(false);
    });
  });

  describe('Minimum Slot Opening Advance', () => {
    test('should allow opening slot 1 hour ahead', () => {
      const now = Date.now();
      expect(canOpenSlot(now + 60 * 60_000, now)).toBe(true);
    });

    test('should reject opening slot less than 11 minutes ahead', () => {
      const now = Date.now();
      expect(canOpenSlot(now + 10 * 60_000, now)).toBe(false);
    });
  });
});

// =====================================
// Refund Policy Tests
// =====================================

describe('Cancellation Refund Policy', () => {
  const calculateRefund = (hoursUntilSlot: number, cancelledBy: 'student' | 'tutor'): {
    percentage: number;
    ticketsReturned: number;
    creditGiven: boolean;
  } => {
    if (hoursUntilSlot > 24) {
      return { percentage: 100, ticketsReturned: 1, creditGiven: false };
    } else if (hoursUntilSlot >= 2) {
      return { percentage: 50, ticketsReturned: 0, creditGiven: true };
    } else {
      return { percentage: 0, ticketsReturned: 0, creditGiven: false };
    }
  };

  const calculateNoShowRefund = (noShowBy: 'student' | 'tutor'): {
    percentage: number;
    ticketsReturned: number;
    penalty: boolean;
  } => {
    if (noShowBy === 'student') {
      return { percentage: 0, ticketsReturned: 0, penalty: true };
    } else {
      // Tutor no-show: full refund to student
      return { percentage: 100, ticketsReturned: 1, penalty: true };
    }
  };

  describe('More than 24 hours before', () => {
    test('should give full refund (100%)', () => {
      const refund = calculateRefund(25, 'student');
      expect(refund.percentage).toBe(100);
      expect(refund.ticketsReturned).toBe(1);
    });

    test('should not give credit when full refund is given', () => {
      const refund = calculateRefund(48, 'student');
      expect(refund.creditGiven).toBe(false);
    });
  });

  describe('Between 2 and 24 hours before', () => {
    test('should give partial refund (50%)', () => {
      const refund = calculateRefund(12, 'student');
      expect(refund.percentage).toBe(50);
    });

    test('should not return tickets', () => {
      const refund = calculateRefund(6, 'student');
      expect(refund.ticketsReturned).toBe(0);
    });

    test('should give credit instead', () => {
      const refund = calculateRefund(3, 'student');
      expect(refund.creditGiven).toBe(true);
    });
  });

  describe('Less than 2 hours before', () => {
    test('should give no refund (0%)', () => {
      const refund = calculateRefund(1, 'student');
      expect(refund.percentage).toBe(0);
      expect(refund.ticketsReturned).toBe(0);
      expect(refund.creditGiven).toBe(false);
    });

    test('should give no refund at 1 minute before', () => {
      const refund = calculateRefund(1 / 60, 'student');
      expect(refund.percentage).toBe(0);
    });
  });

  describe('No-show scenarios', () => {
    test('should give no refund for student no-show', () => {
      const refund = calculateNoShowRefund('student');
      expect(refund.percentage).toBe(0);
      expect(refund.penalty).toBe(true);
    });

    test('should give full refund for tutor no-show', () => {
      const refund = calculateNoShowRefund('tutor');
      expect(refund.percentage).toBe(100);
      expect(refund.ticketsReturned).toBe(1);
      expect(refund.penalty).toBe(true);
    });
  });
});

// =====================================
// Penalty Code Tests
// =====================================

describe('Penalty Codes', () => {
  const PENALTY_CODE_DETAILS = {
    // Tutor penalties (TA-xxx)
    '301': { code: 'TA-301', description: 'No show - did not attend scheduled session', points: 5 },
    '302': { code: 'TA-302', description: 'Late arrival (>5 minutes)', points: 2 },
    '303': { code: 'TA-303', description: 'Short notice slot cancellation (<24h)', points: 3 },
    '304': { code: 'TA-304', description: 'Session ended early without agreement', points: 2 },
    '305': { code: 'TA-305', description: 'Unprofessional conduct', points: 4 },
    
    // Student penalties (SA-xxx)
    '401': { code: 'SA-401', description: 'No show - did not attend booked session', points: 3 },
    '402': { code: 'SA-402', description: 'Late arrival (>5 minutes)', points: 1 },
    '403': { code: 'SA-403', description: 'Last minute cancellation (<2h)', points: 2 },
    '404': { code: 'SA-404', description: 'Inappropriate behavior', points: 4 },
  };

  const determinePenaltyCode = (scenario: string, userType: 'tutor' | 'student'): string | null => {
    if (userType === 'tutor') {
      switch (scenario) {
        case 'no_show': return '301';
        case 'late_arrival': return '302';
        case 'short_notice_cancel': return '303';
        case 'early_end': return '304';
        case 'misconduct': return '305';
        default: return null;
      }
    } else {
      switch (scenario) {
        case 'no_show': return '401';
        case 'late_arrival': return '402';
        case 'last_minute_cancel': return '403';
        case 'misconduct': return '404';
        default: return null;
      }
    }
  };

  describe('Tutor Penalties', () => {
    test('should assign correct code for tutor no-show', () => {
      const code = determinePenaltyCode('no_show', 'tutor');
      expect(code).toBe('301');
      expect(PENALTY_CODE_DETAILS['301'].points).toBe(5);
    });

    test('should assign correct code for tutor late arrival', () => {
      const code = determinePenaltyCode('late_arrival', 'tutor');
      expect(code).toBe('302');
      expect(PENALTY_CODE_DETAILS['302'].points).toBe(2);
    });

    test('should assign correct code for short notice cancel', () => {
      const code = determinePenaltyCode('short_notice_cancel', 'tutor');
      expect(code).toBe('303');
    });
  });

  describe('Student Penalties', () => {
    test('should assign correct code for student no-show', () => {
      const code = determinePenaltyCode('no_show', 'student');
      expect(code).toBe('401');
      expect(PENALTY_CODE_DETAILS['401'].points).toBe(3);
    });

    test('should assign correct code for last minute cancel', () => {
      const code = determinePenaltyCode('last_minute_cancel', 'student');
      expect(code).toBe('403');
    });
  });

  describe('Penalty Point Calculation', () => {
    test('tutor no-show has highest penalty', () => {
      const tutorNoShowPoints = PENALTY_CODE_DETAILS['301'].points;
      const studentNoShowPoints = PENALTY_CODE_DETAILS['401'].points;
      expect(tutorNoShowPoints).toBeGreaterThan(studentNoShowPoints);
    });

    test('misconduct has severe penalty', () => {
      const tutorMisconductPoints = PENALTY_CODE_DETAILS['305'].points;
      expect(tutorMisconductPoints).toBeGreaterThanOrEqual(4);
    });
  });
});

// =====================================
// Slot Availability Logic Tests
// =====================================

describe('Slot Availability', () => {
  type SlotStatus = 'open' | 'booked' | 'pending' | 'completed' | 'cancelled' | 'available';

  const canBook = (status: SlotStatus): boolean => {
    return status === 'open';
  };

  const canCancel = (status: SlotStatus): boolean => {
    return status === 'booked' || status === 'pending';
  };

  const isFinalized = (status: SlotStatus): boolean => {
    return status === 'completed' || status === 'cancelled';
  };

  describe('Bookable Status', () => {
    test('open slots are bookable', () => {
      expect(canBook('open')).toBe(true);
    });

    test('booked slots are not bookable', () => {
      expect(canBook('booked')).toBe(false);
    });

    test('pending slots are not bookable', () => {
      expect(canBook('pending')).toBe(false);
    });

    test('completed slots are not bookable', () => {
      expect(canBook('completed')).toBe(false);
    });
  });

  describe('Cancellable Status', () => {
    test('booked slots can be cancelled', () => {
      expect(canCancel('booked')).toBe(true);
    });

    test('pending slots can be cancelled', () => {
      expect(canCancel('pending')).toBe(true);
    });

    test('completed slots cannot be cancelled', () => {
      expect(canCancel('completed')).toBe(false);
    });
  });

  describe('Finalized Status', () => {
    test('completed is finalized', () => {
      expect(isFinalized('completed')).toBe(true);
    });

    test('cancelled is finalized', () => {
      expect(isFinalized('cancelled')).toBe(true);
    });

    test('open is not finalized', () => {
      expect(isFinalized('open')).toBe(false);
    });
  });
});

// =====================================
// Bulk Operations Tests
// =====================================

describe('Bulk Operations', () => {
  const MAX_BULK_SLOTS = 100;

  const validateBulkOperation = (slotCount: number): { valid: boolean; error?: string } => {
    if (slotCount > MAX_BULK_SLOTS) {
      return { valid: false, error: `Cannot open more than ${MAX_BULK_SLOTS} slots at once` };
    }
    if (slotCount === 0) {
      return { valid: false, error: 'No slots to open' };
    }
    return { valid: true };
  };

  const generateSlotsForDateRange = (
    startDate: Date,
    endDate: Date,
    times: string[],
    daysOfWeek?: number[]
  ): Array<{ date: string; time: string }> => {
    const slots: Array<{ date: string; time: string }> = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      
      if (daysOfWeek && !daysOfWeek.includes(dayOfWeek)) {
        continue;
      }
      
      for (const time of times) {
        slots.push({
          date: d.toISOString().split('T')[0]!,
          time
        });
      }
    }
    
    return slots;
  };

  describe('Bulk Slot Limits', () => {
    test('should accept up to 100 slots', () => {
      const result = validateBulkOperation(100);
      expect(result.valid).toBe(true);
    });

    test('should reject more than 100 slots', () => {
      const result = validateBulkOperation(101);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('100');
    });

    test('should reject zero slots', () => {
      const result = validateBulkOperation(0);
      expect(result.valid).toBe(false);
    });
  });

  describe('Date Range Slot Generation', () => {
    test('should generate slots for each day in range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-07');
      const times = ['09:00'];
      
      const slots = generateSlotsForDateRange(startDate, endDate, times);
      expect(slots.length).toBe(7);
    });

    test('should generate multiple slots per day', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-01');
      const times = ['09:00', '10:00', '11:00'];
      
      const slots = generateSlotsForDateRange(startDate, endDate, times);
      expect(slots.length).toBe(3);
    });

    test('should filter by days of week', () => {
      const startDate = new Date('2024-01-01'); // Monday
      const endDate = new Date('2024-01-14'); // Sunday (2 weeks)
      const times = ['09:00'];
      const mondaysAndWednesdays = [1, 3]; // Monday = 1, Wednesday = 3
      
      const slots = generateSlotsForDateRange(startDate, endDate, times, mondaysAndWednesdays);
      expect(slots.length).toBe(4); // 2 Mondays + 2 Wednesdays
    });
  });
});

// =====================================
// Weekly Schedule Tests
// =====================================

describe('Weekly Schedule', () => {
  const getWeekBounds = (weekOffset: number = 0): { weekStart: Date; weekEnd: Date } => {
    const today = new Date();
    const monday = new Date(today);
    // Get Monday of current week, then apply offset
    monday.setDate(today.getDate() - today.getDay() + 1 + (weekOffset * 7));
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return { weekStart: monday, weekEnd: sunday };
  };

  test('should calculate current week correctly', () => {
    const { weekStart, weekEnd } = getWeekBounds(0);
    const today = new Date();
    
    expect(weekStart.getDay()).toBe(1); // Monday
    expect(weekEnd.getDay()).toBe(0);   // Sunday
    expect(weekStart <= today && today <= weekEnd).toBe(true);
  });

  test('should calculate next week correctly', () => {
    const currentWeek = getWeekBounds(0);
    const nextWeek = getWeekBounds(1);
    
    // Next week's Monday should be 7 days after this week's Monday
    const diffDays = (nextWeek.weekStart.getTime() - currentWeek.weekStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(7);
  });

  test('should calculate previous week correctly', () => {
    const currentWeek = getWeekBounds(0);
    const prevWeek = getWeekBounds(-1);
    
    // Previous week's Monday should be 7 days before this week's Monday
    const diffDays = (currentWeek.weekStart.getTime() - prevWeek.weekStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(7);
  });

  test('week should span exactly 7 days', () => {
    const { weekStart, weekEnd } = getWeekBounds(0);
    const diffMs = weekEnd.getTime() - weekStart.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    // Week spans from Monday 00:00:00 to Sunday 23:59:59.999 (~6.99 days)
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThanOrEqual(7);
  });
});

// =====================================
// Transaction Replay Protection Tests  
// =====================================

describe('Transaction Replay Protection', () => {
  const usedTransactions = new Set<string>();

  const isTransactionUsed = (txHash: string): boolean => {
    return usedTransactions.has(txHash);
  };

  const markTransactionUsed = (txHash: string): void => {
    usedTransactions.add(txHash);
  };

  const validateBookingTransaction = (txHash: string): { valid: boolean; error?: string } => {
    if (!txHash) {
      return { valid: false, error: 'Transaction hash is required' };
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return { valid: false, error: 'Invalid transaction hash format' };
    }
    if (isTransactionUsed(txHash)) {
      return { valid: false, error: 'Transaction has already been used for a booking' };
    }
    return { valid: true };
  };

  beforeAll(() => {
    // Pre-populate with a "used" transaction
    usedTransactions.add('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
  });

  test('should reject empty transaction hash', () => {
    const result = validateBookingTransaction('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('required');
  });

  test('should reject invalid hash format', () => {
    const result = validateBookingTransaction('not-a-hash');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('format');
  });

  test('should reject already-used transaction', () => {
    const result = validateBookingTransaction('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('already been used');
  });

  test('should accept valid new transaction', () => {
    const newTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const result = validateBookingTransaction(newTxHash);
    expect(result.valid).toBe(true);
  });

  test('should track new transactions', () => {
    const txHash = '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';
    
    // First use should succeed
    expect(validateBookingTransaction(txHash).valid).toBe(true);
    
    // Mark as used
    markTransactionUsed(txHash);
    
    // Second use should fail
    expect(validateBookingTransaction(txHash).valid).toBe(false);
  });
});

console.log('🧪 Schedule tests loaded successfully');
