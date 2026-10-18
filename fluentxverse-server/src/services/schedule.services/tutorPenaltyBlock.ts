import type { ManagedTransaction } from 'neo4j-driver';
import { nanoid } from 'nanoid';
import { PENALTY_RULES } from '../../config/penaltyCodes';

export async function reconcileTutorPenaltyBlock(tx: ManagedTransaction, tutorId: string, clearInvalidBlock = false) {
  await tx.run(`MATCH (t:User {id: $tutorId})
    SET t.scheduleWriteVersion = coalesce(t.scheduleWriteVersion, 0) + 1`, { tutorId });
  const result = await tx.run(`MATCH (t:User {id: $tutorId})-[:HAS_PENALTY]->(p:Penalty)
    WHERE p.penaltyCode = '301' AND p.revokedAt IS NULL AND coalesce(p.status, '') <> 'voided'
      AND p.createdAt >= datetime($since) RETURN count(p) AS count`,
    { tutorId, since: new Date(Date.now() - PENALTY_RULES.PENALTY_WINDOW_DAYS * 86400_000).toISOString() });
  const count = Number(result.records[0]?.get('count')) || 0;
  if (count >= PENALTY_RULES.TA_BOOKED_THRESHOLD) {
    await tx.run(`MATCH (t:User {id: $tutorId})
      WHERE (coalesce(t.isBlocked, false) = false OR t.blockExpiresAt <= datetime())
        AND (t.penaltyBlockOverrideUntil IS NULL OR t.penaltyBlockOverrideUntil <= datetime())
      CREATE (p:Penalty {penaltyId: $id, tutorId: $tutorId, penaltyCode: '601',
        penaltyReason: $reason, severity: 'critical', affectsCompensation: true,
        blockUntil: datetime($until), createdAt: datetime()})
      CREATE (t)-[:HAS_PENALTY]->(p)
      SET t.isBlocked = true, t.blockExpiresAt = datetime($until)`, {
      tutorId, id: nanoid(16), reason: `Automatic block: ${count} TA-301 penalties in ${PENALTY_RULES.PENALTY_WINDOW_DAYS} days`,
      until: new Date(Date.now() + PENALTY_RULES.BLOCK_DURATION_DAYS * 86400_000).toISOString(),
    });
  } else if (clearInvalidBlock) {
    const revoked = await tx.run(`MATCH (t:User {id: $tutorId})-[:HAS_PENALTY]->(p:Penalty {penaltyCode: '601'})
      WHERE p.penaltyReason STARTS WITH 'Automatic block:' AND p.revokedAt IS NULL
      SET p.status = 'voided', p.revokedAt = $now, p.revocationReason = 'Attendance penalties corrected'
      RETURN p.penaltyId AS id`, { tutorId, now: new Date().toISOString() });
    if (!revoked.records.length) return;
    // Preserve independent administrator blocks when revoking an automatic block.
    await tx.run(`MATCH (t:User {id: $tutorId})
      OPTIONAL MATCH (t)-[:HAS_PENALTY]->(p:Penalty {penaltyCode: '601'})
      WHERE p.revokedAt IS NULL AND coalesce(p.status, '') <> 'voided'
        AND (p.blockUntil IS NULL OR p.blockUntil > datetime())
      WITH t, count(p) AS active, max(p.blockUntil) AS until,
        sum(CASE WHEN p IS NOT NULL AND p.blockUntil IS NULL THEN 1 ELSE 0 END) AS indefinite
      SET t.isBlocked = active > 0, t.blockExpiresAt = CASE WHEN indefinite > 0 THEN null ELSE until END`, { tutorId });
  }
}
