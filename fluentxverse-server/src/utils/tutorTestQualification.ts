// An operator waiver is not assessment evidence or cryptographic certification.
export function hasTutorSalaryTestQualification(tutor: Record<string, unknown>): boolean {
  return tutor.manualTestQualification === true
    && tutor.manualTestQualificationPurpose === 'salary_testing'
    && typeof tutor.manualTestQualificationAt === 'string'
    && typeof tutor.manualTestQualificationBy === 'string';
}
