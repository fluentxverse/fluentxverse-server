import { expect, test } from 'bun:test';
import { hasTutorSalaryTestQualification } from '../src/utils/tutorTestQualification';

test('salary test qualification requires an explicit, attributed waiver', () => {
  const waiver = { manualTestQualification: true, manualTestQualificationPurpose: 'salary_testing',
    manualTestQualificationAt: '2026-10-12T00:00:00.000Z', manualTestQualificationBy: 'operator:user-request' };
  expect(hasTutorSalaryTestQualification(waiver)).toBe(true);
  expect(hasTutorSalaryTestQualification({ ...waiver, manualTestQualification: false })).toBe(false);
  expect(hasTutorSalaryTestQualification({ manualTestQualification: true })).toBe(false);
  expect(hasTutorSalaryTestQualification({ ...waiver, manualTestQualificationPurpose: 'certification' })).toBe(false);
  expect(hasTutorSalaryTestQualification({ email: 'paulanthonyarriola@gmail.com' })).toBe(false);
});
