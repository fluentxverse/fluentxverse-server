export const MAX_TUTOR_RATE_CENTS = 100_000_000;

export function usdRateCents(value: string): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) {
    throw new Error('Enter a USD amount with at most two decimal places.');
  }
  const [dollars, fraction = ''] = value.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > MAX_TUTOR_RATE_CENTS) throw new Error('Base rate must be between $0.01 and $1,000,000.00.');
  return cents;
}

export function usdRateInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export interface TutorRateChange {
  id: string;
  tutorId: string;
  currency: 'USD';
  version: number;
  previousVersion: number;
  previousRateCents: number | null;
  baseRateCents: number;
  changedAt: string;
  changedBy: string;
  changedByName: string;
  reason: string;
}

export interface TutorCompensation {
  tutorId: string;
  currency: 'USD';
  baseRateCents: number | null;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
}

export interface TutorCompensationDetail {
  compensation: TutorCompensation;
  history: TutorRateChange[];
  nextHistoryBeforeVersion: number | null;
}

export interface TutorRateUpdate {
  amount: string;
  currency: 'USD';
  expectedVersion: number;
  requestId: string;
  reason: string;
}
