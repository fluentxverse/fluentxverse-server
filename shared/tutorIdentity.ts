export const ID_BOOKING_WINDOW_MS = 84 * 60 * 60 * 1000;
export const INTERVIEW_HORIZON_MS = 3 * 24 * 60 * 60 * 1000;
export const acceptedTutorIds = [
  ['national', 'Philippine National ID (PhilID / ePhilID)', 'https://everify.gov.ph/check'],
  ['passport', 'Philippine Passport', 'https://consular.dfa.gov.ph/'],
  ['umid', 'SSS Unified Multi-Purpose ID (UMID)', 'https://www.sss.gov.ph/'],
  ['driver', "LTO Driver’s License", 'https://www.lto.gov.ph/'],
  ['prc', 'Professional Regulation Commission (PRC) ID', 'https://verification.prc.gov.ph/'],
  ['postal', 'Postal ID (PVC)', 'https://phlpost.gov.ph/'],
  ['pwd', 'PWD ID (Persons with Disabilities ID)', 'https://pwd.doh.gov.ph/home.php'],
  ['voter', "Voter’s ID or COMELEC Voter’s Certification", 'https://comelec.gov.ph/'],
  ['ibp', 'Integrated Bar of the Philippines (IBP) ID', 'https://helpdesk.ibp.ph/'],
  ['gsis', 'GSIS e-Card', 'https://www.gsis.gov.ph/contact-gsis/'],
  ['tin', 'Tax Identification Number (TIN ID)', 'https://orus.bir.gov.ph/'],
  ['philhealth', 'PhilHealth ID', 'https://www.philhealth.gov.ph/'],
  ['pagibig', 'Pag-IBIG Loyalty Card', 'https://www.pagibigfund.gov.ph/'],
  ['nbi', 'NBI Clearance', 'https://clearance.nbi.gov.ph/'],
  ['police', 'Police Clearance', 'https://www.pnpclearance.ph/'],
  ['school', 'School ID (for students)', ''],
] as const;
export type TutorIdType = typeof acceptedTutorIds[number][0];
export type IdentityStatus = 'pending_review' | 'accepted' | 'booked' | 'verified' | 'resubmit' | 'expired' | 'fraud';
export interface TutorIdentityRecord {
  id: string; tutorId: string; idType: TutorIdType; status: IdentityStatus;
  createdAt: string; acceptedAt?: string; bookingDeadline?: string; interviewId?: string;
  reason?: string; deleteAt?: string; deletedAt?: string; verifiedAt?: string;
  credentialStatus?: string; name?: string;
}
export function nextManilaMidnight(now: number) {
  const offset = 8 * 3600_000;
  return new Date((Math.floor((now + offset) / 86400_000) + 1) * 86400_000 - offset).toISOString();
}
export function isAdult(birthDate: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const birth = new Date(birthDate + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== birthDate) return false;
  const today = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4)) - 18;
  return birthDate <= `${year}${today.slice(4)}` && Number(birthDate.slice(0, 4)) >= 1900;
}
export function identityCanBook(record: TutorIdentityRecord | null, now = Date.now()) {
  return record?.status === 'accepted' && !record.deletedAt && Date.parse(record.bookingDeadline || '') > now;
}
