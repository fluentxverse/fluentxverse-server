import { getDriver } from '../../db/memgraph';
import { LegacyProofRetiredError, LEGACY_PROOF_RETIREMENT_REASON } from './legacyProofRetirement';

const credentialType = 'fluentxverse.student.lesson-attendance.v1';
export type LessonProofStatus = 'ready' | 'local_proof_generated' | 'submitted' | 'verified' | 'failed' | 'retired';
export interface LessonProof {
  bookingId: string;
  status: LessonProofStatus;
  eligible?: boolean;
  submissionAvailable?: boolean;
  commitment?: string;
  txHash?: string;
  aggregationId?: number;
  error?: string;
  retirementReason?: string;
  verificationAvailable?: boolean;
}

function lessonEnd(booking: Record<string, any>, slot: Record<string, any>): number {
  const stored = booking.slotDateTime;
  let start = stored?.toStandardDate?.().getTime() ?? Date.parse(String(stored || ''));
  if (!Number.isFinite(start)) {
    const match = String(slot.slotTime || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return NaN;
    let hour = Number(match[1]) % 12;
    if (match[3]?.toUpperCase() === 'PM') hour += 12;
    if (!match[3]) hour = Number(match[1]);
    start = Date.parse(`${slot.slotDate}T${String(hour).padStart(2, '0')}:${match[2]}:00+08:00`);
  }
  const minutes = Number(booking.durationMinutes?.toNumber?.() ?? booking.durationMinutes ?? slot.durationMinutes?.toNumber?.() ?? slot.durationMinutes ?? 25);
  return start + minutes * 60_000;
}

function eligible(booking: Record<string, any>, slot: Record<string, any>): boolean {
  return ['confirmed', 'completed'].includes(booking.status) && booking.attendanceStudent === 'present' &&
    Number.isFinite(lessonEnd(booking, slot)) && Date.now() >= lessonEnd(booking, slot);
}

export async function listStudentLessonProofs(studentId: string): Promise<LessonProof[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (b:Booking)-[:BOOKED_BY]->(:Student {id: $studentId})
       MATCH (b)-[:BOOKS]->(slot:TimeSlot)
       OPTIONAL MATCH (b)-[:HAS_LESSON_PROOF]->(p:StudentLessonProof)
       RETURN b, slot, p ORDER BY slot.slotDate DESC LIMIT 100`, { studentId });
    return result.records.map(record => {
      const booking = record.get('b').properties;
      const proof = record.get('p')?.properties;
      return {
        bookingId: String(booking.bookingId),
        status: 'retired' as const,
        verificationAvailable: false,
        retirementReason: LEGACY_PROOF_RETIREMENT_REASON,
        ...(proof?.commitment ? { commitment: String(proof.commitment) } : {}),
        ...(proof?.txHash ? { txHash: String(proof.txHash) } : {}),
        ...(proof?.aggregationId != null ? { aggregationId: Number(proof.aggregationId?.toNumber?.() ?? proof.aggregationId) } : {}),
        ...(proof?.status === 'failed' && proof?.lastError ? { error: String(proof.lastError) } : {}),
        eligible: eligible(booking, record.get('slot').properties),
        submissionAvailable: false,
      };
    });
  } finally { await session.close(); }
}

export async function getPublicStudentLessonProof(commitment: string) {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (p:StudentLessonProof {commitment: $commitment}) RETURN p LIMIT 1`, { commitment });
    const p = result.records[0]?.get('p')?.properties;
    if (!p) return null;
    return { commitment: p.commitment, status: 'retired', verificationAvailable: false, retirementReason: LEGACY_PROOF_RETIREMENT_REASON, proofSystem: 'groth16',
      credentialType, issuerAx: p.issuerAx, issuerAy: p.issuerAy,
      localProofVerified: false,
      txHash: p.txHash || null, aggregationId: p.aggregationId ?? null,
      statement: p.statement || null, domainId: p.domainId ?? null };
  } finally { await session.close(); }
}

export async function claimStudentLessonProof(_studentId: string, _bookingId: string): Promise<LessonProof> {
  throw new LegacyProofRetiredError();
}
