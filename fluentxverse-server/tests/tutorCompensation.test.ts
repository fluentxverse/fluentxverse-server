import { expect, test } from 'bun:test';
import { usdRateCents, usdRateInput } from '../src/shared/tutorCompensation';
import { compensationTutorId, validateTutorRateUpdate, tutorCompensationFailure, TutorCompensationError } from '../src/services/admin.services/tutorCompensation.service';

const input = { amount: '12.34', currency: 'USD' as const, expectedVersion: 0, requestId: 'fdd65bd7-cd90-4c6d-b988-d208bd7e2db7', reason: '' };
test('USD rates use exact integer cents and canonical display input', () => {
  for (const [amount, cents] of [['0.01', 1], ['1', 100], ['1.2', 120], ['12.34', 1234], ['1000000.00', 100000000]] as const) {
    expect(usdRateCents(amount)).toBe(cents);
    expect(usdRateCents(usdRateInput(cents))).toBe(cents);
  }
});
test('invalid amounts cannot silently become zero or be rounded', () => {
  for (const value of ['', '0', '0.00', '-1', '1e2', '1.001', '.5', '01.00', ' 1 ', '1,000', 'NaN', 'Infinity', '1000000.01', '9999999', null, 1]) {
    expect(() => usdRateCents(value as any)).toThrow();
  }
});
test('save requests are versioned, USD-only and uniquely identified', () => {
  expect(validateTutorRateUpdate(input)).toEqual({ cents: 1234, reason: 'Initial base rate' });
  expect(validateTutorRateUpdate({ ...input, expectedVersion: 1, reason: '  Agreed adjustment  ' }).reason).toBe('Agreed adjustment');
  for (const change of [{ currency: 'PHP' }, { expectedVersion: -1 }, { expectedVersion: 0.5 }, { expectedVersion: Number.MAX_SAFE_INTEGER },
    { requestId: 'random' }, { reason: null }, { reason: 'x'.repeat(1001) }]) expect(() => validateTutorRateUpdate({ ...input, ...change } as any)).toThrow();
});
test('tutor IDs are bounded and cannot inject query syntax', () => {
  expect(compensationTutorId('tutor-example')).toBe('tutor-example');
  for (const id of ['', 'a'.repeat(129), "x'}) MATCH (n)", '../student', 'x,y']) expect(() => compensationTutorId(id)).toThrow();
});
test('financial errors preserve conflict status and do not expose provider details', () => {
  const response = tutorCompensationFailure(new TutorCompensationError(409, 'Reload before saving.'), 'UNKNOWN');
  expect(response.status).toBe(409);
  expect(response.body.error).toBe('Reload before saving.');
  expect(JSON.stringify(tutorCompensationFailure(new Error('PRIVATE_RATE database query parameters'), 'UNKNOWN'))).not.toContain('PRIVATE_RATE');
  expect(tutorCompensationFailure(new Error('PRIVATE_RATE'), 'VALIDATION').status).toBe(400);
});
