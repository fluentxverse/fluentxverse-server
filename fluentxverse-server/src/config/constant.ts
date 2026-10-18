export const MAX_PROFILE_PIC_BYTES = 5 * 1024 * 1024; // 5MB limit

// Ticket Usage Configuration
export const TICKETS_PER_LESSON = 1; // Number of tickets required per lesson

// Refund Policy
export const REFUND_POLICY = {
  // Minimum hours before lesson to allow full refund
  // If student cancels within this time window, NO refund is given
  NO_REFUND_HOURS: 1,
} as const;

// Transaction Types for Ticket Usage
export const TICKET_TRANSACTION_TYPES = {
  BOOKING: 'booking',           // Ticket used to book a lesson
  CANCELLATION: 'cancellation', // Ticket refunded due to cancellation
  REFUND: 'refund',             // Manual refund by admin
  PURCHASE: 'purchase',         // Initial purchase of tickets
  ADMIN_ADJUSTMENT: 'admin_adjustment', // Admin adjustment
} as const;
