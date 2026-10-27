export const evidenceFields = ['attendance', 'overlap', 'cancellation'] as const;
export type EvidenceField = typeof evidenceFields[number];
export type LessonPrivacyRole = 'student' | 'tutor';

export interface AttendanceClaims {
  attendance?: { student: 'threshold_met' | 'not_established'; tutor: 'threshold_met' | 'not_established' };
  overlap?: 'threshold_met' | 'not_established';
  cancellation?: 'not_cancelled' | 'at_least_one_hour_before' | 'less_than_one_hour_before' | 'timing_unknown';
}
export interface SignedLessonEvidence {
  payload: {
    schema: 'fluentxverse.lesson-evidence.v1';
    id: string;
    bookingCommitment: string;
    issuedAt: string;
    thresholdMinutes: number;
    source: 'platform_room_presence_records';
    claims: AttendanceClaims;
  };
  signature: string;
  keyId: string;
  publicKey: string;
  algorithm: 'Ed25519';
}
export interface LessonEvidenceRecord {
  id: string;
  fields: EvidenceField[];
  createdAt: string;
  expiresAt: string;
  sharedWithSupport: boolean;
  envelope: SignedLessonEvidence;
}
export interface LessonEvidenceOptions {
  enabled: boolean;
  canCreate: boolean;
  canShare: boolean;
  records: LessonEvidenceRecord[];
}

export function describeAttendanceClaim(value: string): string {
  return ({ threshold_met: 'Recorded presence meets the threshold', not_established: 'Not established by available records',
    not_cancelled: 'Not cancelled at snapshot time', at_least_one_hour_before: 'Cancelled at least one hour before the lesson',
    less_than_one_hour_before: 'Cancelled less than one hour before the lesson', timing_unknown: 'Cancellation timing is not established' } as Record<string, string>)[value] || 'Not established';
}
