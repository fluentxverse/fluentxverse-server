import { getDriver } from '../../db/memgraph';
import { cacheGetOrSet, invalidateCache } from '../../db/redis';
import neo4j from 'neo4j-driver';
import { tryIssueAndMaybeSubmitTutorCertificationProof } from '../proof.services/tutorCertificationWorkflow.service';
import type { 
  InterviewSlot, 
  InterviewWeekSchedule,
  PendingInterview 
} from './interview.interface';

// Generate unique ID for interview slots (cryptographically secure)
function generateSlotId(): string {
  const uuid = crypto.randomUUID();
  return `INT-${uuid.slice(0, 12)}`;
}

// Format date as YYYY-MM-DD
function formatDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class InterviewService {
  async getRoom(slotId: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slotId)) return null;
    const session = getDriver().session();
    try {
      const row = (await session.run(`MATCH (s:InterviewSlot {id: $slotId})
        OPTIONAL MATCH (u:User {id: s.tutorId}) RETURN s, u.firstName AS firstName, u.lastName AS lastName`, { slotId })).records[0];
      if (!row) return null;
      const slot = row.get('s').properties;
      return { id: slot.id as string, tutorId: slot.tutorId as string | undefined,
        tutorName: `${row.get('firstName') || ''} ${row.get('lastName') || ''}`.trim(),
        status: slot.status as string, date: slot.date as string, time: slot.time as string,
        result: slot.result || null, mediaClosed: Boolean(slot.mediaClosedAt), recordingUrl: slot.recordingUrl as string | undefined };
    } finally { await session.close(); }
  }
  /**
   * Create interview slots (Admin only)
   */
  async createSlots(slots: { date: string; time: string }[]): Promise<InterviewSlot[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const createdSlots: InterviewSlot[] = [];
      const now = new Date().toISOString();

      for (const slot of slots) {
        const slotId = generateSlotId();
        
        // Check if slot already exists for this date/time
        const existingResult = await session.run(`
          MATCH (s:InterviewSlot {date: $date, time: $time})
          RETURN s
        `, { date: slot.date, time: slot.time });

        if (existingResult.records.length > 0) {
          continue;
        }

        await session.run(`
          CREATE (s:InterviewSlot {
            id: $id,
            date: $date,
            time: $time,
            status: 'open',
            createdAt: $createdAt
          })
        `, {
          id: slotId,
          date: slot.date,
          time: slot.time,
          createdAt: now
        });

        createdSlots.push({
          id: slotId,
          date: slot.date,
          time: slot.time,
          status: 'open',
          createdAt: now
        });
      }

      return createdSlots;
    } finally {
      await session.close();
    }
  }

  /**
   * Get interview schedule for a week (Admin view)
   */
  async getWeekSchedule(weekOffset: number = 0): Promise<InterviewWeekSchedule> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Calculate week boundaries
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - today.getDay() + 1 + (weekOffset * 7));
      monday.setHours(0, 0, 0, 0);
      
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      const weekStart = formatDateISO(monday);
      const weekEnd = formatDateISO(sunday);

      // Get all interview slots for this week
      const result = await session.run(`
        MATCH (s:InterviewSlot)
        WHERE s.date >= $weekStart AND s.date <= $weekEnd
        OPTIONAL MATCH (u:User {id: s.tutorId})
        RETURN s, u
        ORDER BY s.date, s.time
      `, { weekStart, weekEnd });

      const slots: InterviewSlot[] = result.records.map(record => {
        const s = record.get('s').properties;
        const u = record.get('u')?.properties;

        return {
          id: s.id,
          date: s.date,
          time: s.time,
          status: s.status,
          tutorId: s.tutorId,
          tutorName: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : undefined,
          tutorEmail: u?.email,
          createdAt: s.createdAt,
          bookedAt: s.bookedAt,
          notes: s.notes
        };
      });

      return {
        weekStart,
        weekEnd,
        slots
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get available interview slots for tutors
   */
  async getAvailableSlots(weekOffset: number = 0): Promise<InterviewSlot[]> {
    const cacheKey = `interview:available:week:${weekOffset}`;
    const cacheTTL = 5 * 60; // 5 minutes
    
    return cacheGetOrSet(cacheKey, cacheTTL, async () => {
      const driver = getDriver();
      const session = driver.session();

      try {
        // Calculate week boundaries
        const today = new Date();
        const monday = new Date(today);
        monday.setDate(today.getDate() - today.getDay() + 1 + (weekOffset * 7));
        monday.setHours(0, 0, 0, 0);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        const weekStart = formatDateISO(monday);
        const weekEnd = formatDateISO(sunday);

        // Get only open interview slots for this week
        const result = await session.run(`
          MATCH (s:InterviewSlot {status: 'open'})
          WHERE s.date >= $weekStart AND s.date <= $weekEnd
          RETURN s
          ORDER BY s.date, s.time
        `, { weekStart, weekEnd });

        return result.records.map(record => {
          const s = record.get('s').properties;
          return {
            id: s.id,
            date: s.date,
            time: s.time,
            status: s.status as 'open',
            createdAt: s.createdAt
          };
        });
      } finally {
        await session.close();
      }
    });
  }

  /**
   * Book an interview slot (Tutor)
   */
  async bookSlot(slotId: string, tutorId: string): Promise<InterviewSlot> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const now = new Date().toISOString();

      // Check if tutor already has a pending interview
      const existingBooking = await session.run(`
        MATCH (s:InterviewSlot {tutorId: $tutorId, status: 'booked'})
        RETURN s
      `, { tutorId });

      if (existingBooking.records.length > 0) {
        throw new Error('You already have a pending interview. Please cancel it first to book a new one.');
      }

      // Book the slot
      const result = await session.run(`
        MATCH (s:InterviewSlot {id: $slotId, status: 'open'})
        SET s.status = 'booked',
            s.tutorId = $tutorId,
            s.bookedAt = $bookedAt
        RETURN s
      `, { slotId, tutorId, bookedAt: now });

      const record = result.records[0];
      if (!record) {
        throw new Error('Interview slot not available or already booked');
      }

      const s = record.get('s').properties;
      // Invalidate cache when booking/cancelling
      await invalidateCache('interview:available:week:*');

      return {
        id: s.id,
        date: s.date,
        time: s.time,
        status: s.status,
        tutorId: s.tutorId,
        createdAt: s.createdAt,
        bookedAt: s.bookedAt
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Cancel an interview slot booking (Tutor or Admin)
   */
  async cancelBooking(slotId: string, tutorId?: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // If tutorId is provided, verify it's the tutor's booking
      if (tutorId) {
        const result = await session.run(`
          MATCH (s:InterviewSlot {id: $slotId, tutorId: $tutorId, status: 'booked'})
          SET s.status = 'open',
              s.tutorId = null,
              s.bookedAt = null
          RETURN s
        `, { slotId, tutorId });

        if (result.records.length === 0) {
          throw new Error('Interview booking not found or you do not have permission to cancel');
        }
      } else {
        // Admin cancel - no tutorId check
        const result = await session.run(`
          MATCH (s:InterviewSlot {id: $slotId, status: 'booked'})
          SET s.status = 'open',
              s.tutorId = null,
              s.bookedAt = null
          RETURN s
        `, { slotId });

        if (result.records.length === 0) {
          throw new Error('Interview booking not found');
        }
      }

      // Invalidate cache when booking/cancelling
      await invalidateCache('interview:available:week:*');
    } finally {
      await session.close();
    }
  }

  /**
   * Delete interview slots (Admin only)
   */
  async deleteSlots(slotIds: string[]): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.run(`
        MATCH (s:InterviewSlot)
        WHERE s.id IN $slotIds AND s.status = 'open'
        DELETE s
      `, { slotIds });
    } finally {
      await session.close();
    }
  }

  /**
   * Get pending interviews (for admin dashboard)
   */
  async getPendingInterviews(limit: number = 10): Promise<PendingInterview[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:InterviewSlot {status: 'booked'})
        MATCH (u:User {id: s.tutorId})
        RETURN s, u
        ORDER BY s.date, s.time
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      return result.records.map(record => {
        const s = record.get('s').properties;
        const u = record.get('u').properties;
        return {
          id: s.id,
          date: s.date,
          time: s.time,
          tutorId: u.id,
          tutorName: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          tutorEmail: u.email,
          bookedAt: s.bookedAt
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Mark interview as completed (Admin)
   */
  async completeInterview(slotId: string, notes?: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const completedAt = new Date().toISOString();
      
      await session.run(`
        MATCH (s:InterviewSlot {id: $slotId, status: 'booked'})
        SET s.status = 'completed',
            s.completedAt = $completedAt,
            s.notes = $notes
        RETURN s
      `, { slotId, completedAt, notes: notes || null });
    } finally {
      await session.close();
    }
  }

  /**
   * Get tutor's current interview booking
   */
  async getTutorInterview(tutorId: string): Promise<InterviewSlot | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:InterviewSlot {tutorId: $tutorId})
        WHERE s.status IN ['booked', 'completed']
        RETURN s
        ORDER BY CASE s.status WHEN 'booked' THEN 0 ELSE 1 END, s.completedAt DESC, s.bookedAt DESC
        LIMIT 1
      `, { tutorId });

      const record = result.records[0];
      if (!record) {
        return null;
      }

      const s = record.get('s').properties;
      return {
        id: s.id,
        date: s.date,
        time: s.time,
        status: s.status,
        tutorId: s.tutorId,
        createdAt: s.createdAt,
        bookedAt: s.bookedAt,
        completedAt: s.completedAt,
        notes: s.notes,
        result: s.result
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Save interview result with rubric scores
   */
  async saveInterviewResult(data: {
    slotId: string;
    tutorId: string;
    result: 'pass' | 'fail';
    rubricScores: {
      grammar: number;
      fluency: number;
      pronunciation: number;
      vocabulary: number;
      professionalism: number;
    };
    notes: string;
    timestamps: { time: string; note: string }[];
    adminId: string;
  }): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const completedAt = new Date().toISOString();
      
      // Update the interview slot with result
      const changed = await session.executeWrite(async tx => {
      const existing = (await tx.run('MATCH (s:InterviewSlot {id: $slotId, tutorId: $tutorId}) RETURN s', {
        slotId: data.slotId, tutorId: data.tutorId,
      })).records[0]?.get('s')?.properties;
      if (existing?.result != null) {
        if (existing.result === data.result && existing.reviewedBy === data.adminId
          && existing.rubricScores === JSON.stringify(data.rubricScores)
          && existing.notes === data.notes && existing.timestamps === JSON.stringify(data.timestamps)) return false;
        throw new Error('Interview already has a finalized result');
      }
      const saved = await tx.run(`
        MATCH (s:InterviewSlot {id: $slotId, tutorId: $tutorId})
        WHERE s.status IN ['booked', 'completed'] AND s.result IS NULL
        SET s.status = 'completed',
            s.completedAt = $completedAt,
            s.result = $result,
            s.rubricScores = $rubricScores,
            s.notes = $notes,
            s.timestamps = $timestamps,
            s.reviewedBy = $adminId
        RETURN s
      `, { 
        slotId: data.slotId, 
        tutorId: data.tutorId,
        completedAt, 
        result: data.result,
        rubricScores: JSON.stringify(data.rubricScores),
        notes: data.notes,
        timestamps: JSON.stringify(data.timestamps),
        adminId: data.adminId
      });
      if (!saved.records.length) throw new Error('Interview is not owned by this tutor or already has a finalized result');

      // If passed, update tutor certification status
      if (data.result === 'pass') {
        await tx.run(`
          MATCH (u:User {id: $tutorId})
          SET u.interviewPassed = true,
              u.interviewPassedAt = $completedAt,
              u.interviewSlotId = $slotId,
              u.interviewRubricScores = $rubricScores,
              u.certificationStatus = CASE 
                WHEN u.writtenExamPassed = true AND u.speakingExamPassed = true AND u.profileStatus = 'approved' THEN 'certified'
                ELSE coalesce(u.certificationStatus, 'pending')
              END
          RETURN u
        `, {
          tutorId: data.tutorId,
          slotId: data.slotId,
          completedAt,
          rubricScores: JSON.stringify(data.rubricScores)
        });

        // Keep the legacy Tutor node in sync when it exists.
        await tx.run(`
          MATCH (t:Tutor {odIuser: $tutorId})
          SET t.interviewPassed = true,
              t.interviewPassedAt = $completedAt,
              t.certificationStatus = CASE 
                WHEN t.writtenExamPassed = true AND t.speakingExamPassed = true THEN 'certified'
                ELSE t.certificationStatus
              END
          RETURN t
        `, { tutorId: data.tutorId, completedAt });

      } else {
        // If failed, mark interview as failed
        await tx.run(`
          MATCH (u:User {id: $tutorId})
          SET u.interviewPassed = false,
              u.interviewFailedAt = $completedAt,
              u.interviewSlotId = $slotId,
              u.interviewRubricScores = $rubricScores,
              u.certificationStatus = coalesce(u.certificationStatus, 'pending')
          RETURN u
        `, {
          tutorId: data.tutorId,
          slotId: data.slotId,
          completedAt,
          rubricScores: JSON.stringify(data.rubricScores)
        });

        // Keep the legacy Tutor node in sync when it exists.
        await tx.run(`
          MATCH (t:Tutor {odIuser: $tutorId})
          SET t.interviewPassed = false,
              t.interviewFailedAt = $completedAt
          RETURN t
        `, { tutorId: data.tutorId, completedAt });
      }
      return true;
      });
      if (changed && data.result === 'pass') void tryIssueAndMaybeSubmitTutorCertificationProof(data.tutorId, 'interview_passed');
    } finally {
      await session.close();
    }
  }

  /**
   * Get interview result for a tutor
   */
  async getInterviewResult(tutorId: string): Promise<any | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:InterviewSlot {tutorId: $tutorId, status: 'completed'})
        RETURN s
        ORDER BY s.completedAt DESC
        LIMIT 1
      `, { tutorId });

      const record = result.records[0];
      if (!record) {
        return null;
      }

      const s = record.get('s').properties;
      return {
        id: s.id,
        date: s.date,
        time: s.time,
        status: s.status,
        result: s.result,
        rubricScores: s.rubricScores ? JSON.parse(s.rubricScores) : null,
        notes: s.notes,
        timestamps: s.timestamps ? JSON.parse(s.timestamps) : [],
        completedAt: s.completedAt,
        recordingUrl: s.recordingUrl || null
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Save recording URL for an interview
   */
  async saveRecordingUrl(slotId: string, tutorId: string, recordingUrl: string, recordingId: string = crypto.randomUUID(), adminId = '', size = 0): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:InterviewSlot {id: $slotId, tutorId: $tutorId})
        WHERE s.status IN ['booked', 'completed']
        SET s.recordingUrl = $recordingUrl
        MERGE (r:InterviewRecording {id: $recordingId})
        ON CREATE SET r.tutorId = $tutorId, r.slotId = $slotId, r.url = $recordingUrl,
          r.recordedBy = $adminId, r.size = $size, r.createdAt = $at
        MERGE (s)-[:HAS_RECORDING]->(r)
        RETURN s
      `, { slotId, tutorId, recordingUrl, recordingId: `${slotId}:${recordingId}`, adminId, size: neo4j.int(size), at: new Date().toISOString() });
      if (!result.records.length) throw new Error('Recording is not attached to an authorized interview');
    } finally {
      await session.close();
    }
  }

  /**
   * Get interview statistics for analytics
   */
  async getInterviewStats(): Promise<{
    total: number;
    passed: number;
    failed: number;
    pending: number;
    passRate: number;
    avgScores: {
      grammar: number;
      fluency: number;
      pronunciation: number;
      vocabulary: number;
      professionalism: number;
      overall: number;
    };
    weeklyData: { week: string; passed: number; failed: number }[];
    rubricDistribution: { category: string; scores: number[] }[];
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get counts
      const countResult = await session.run(`
        MATCH (s:InterviewSlot)
        RETURN 
          count(s) as total,
          sum(CASE WHEN s.status = 'completed' AND s.result = 'pass' THEN 1 ELSE 0 END) as passed,
          sum(CASE WHEN s.status = 'completed' AND s.result = 'fail' THEN 1 ELSE 0 END) as failed,
          sum(CASE WHEN s.status = 'booked' THEN 1 ELSE 0 END) as pending
      `);

      const countRecord = countResult.records[0];
      const total = countRecord ? this.toNumber(countRecord.get('total')) : 0;
      const passed = countRecord ? this.toNumber(countRecord.get('passed')) : 0;
      const failed = countRecord ? this.toNumber(countRecord.get('failed')) : 0;
      const pending = countRecord ? this.toNumber(countRecord.get('pending')) : 0;
      const completed = passed + failed;
      const passRate = completed > 0 ? Math.round((passed / completed) * 100) : 0;

      // Get average scores from completed interviews
      const scoresResult = await session.run(`
        MATCH (s:InterviewSlot {status: 'completed'})
        WHERE s.rubricScores IS NOT NULL
        RETURN s.rubricScores as scores
      `);

      let avgScores = {
        grammar: 0,
        fluency: 0,
        pronunciation: 0,
        vocabulary: 0,
        professionalism: 0,
        overall: 0
      };

      if (scoresResult.records.length > 0) {
        const allScores = scoresResult.records.map(r => {
          try {
            return JSON.parse(r.get('scores'));
          } catch {
            return null;
          }
        }).filter(Boolean);

        if (allScores.length > 0) {
          const sums = { grammar: 0, fluency: 0, pronunciation: 0, vocabulary: 0, professionalism: 0 };
          for (const s of allScores) {
            sums.grammar += s.grammar || 0;
            sums.fluency += s.fluency || 0;
            sums.pronunciation += s.pronunciation || 0;
            sums.vocabulary += s.vocabulary || 0;
            sums.professionalism += s.professionalism || 0;
          }
          const count = allScores.length;
          avgScores = {
            grammar: Math.round((sums.grammar / count) * 10) / 10,
            fluency: Math.round((sums.fluency / count) * 10) / 10,
            pronunciation: Math.round((sums.pronunciation / count) * 10) / 10,
            vocabulary: Math.round((sums.vocabulary / count) * 10) / 10,
            professionalism: Math.round((sums.professionalism / count) * 10) / 10,
            overall: 0
          };
          avgScores.overall = Math.round(
            ((avgScores.grammar + avgScores.fluency + avgScores.pronunciation + avgScores.vocabulary + avgScores.professionalism) / 5) * 10
          ) / 10;
        }
      }

      // Get weekly data for the last 8 weeks
      const weeklyResult = await session.run(`
        MATCH (s:InterviewSlot {status: 'completed'})
        WHERE s.completedAt IS NOT NULL
        RETURN s.date as date, s.result as result
        ORDER BY s.date DESC
      `);

      // Group by week
      const weeklyMap = new Map<string, { passed: number; failed: number }>();
      for (const record of weeklyResult.records) {
        const dateStr = record.get('date');
        const result = record.get('result');
        const date = new Date(dateStr);
        // Get week start (Monday)
        const dayOfWeek = date.getDay() || 7;
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - dayOfWeek + 1);
        const weekKey = formatDateISO(weekStart);
        
        if (!weeklyMap.has(weekKey)) {
          weeklyMap.set(weekKey, { passed: 0, failed: 0 });
        }
        const week = weeklyMap.get(weekKey)!;
        if (result === 'pass') week.passed++;
        else if (result === 'fail') week.failed++;
      }

      const weeklyData = Array.from(weeklyMap.entries())
        .map(([week, data]) => ({ week, ...data }))
        .sort((a, b) => a.week.localeCompare(b.week))
        .slice(-8);

      // Get rubric distribution
      const rubricDistribution = [
        { category: 'Grammar', scores: [0, 0, 0, 0, 0] },
        { category: 'Fluency', scores: [0, 0, 0, 0, 0] },
        { category: 'Pronunciation', scores: [0, 0, 0, 0, 0] },
        { category: 'Vocabulary', scores: [0, 0, 0, 0, 0] },
        { category: 'Professionalism', scores: [0, 0, 0, 0, 0] }
      ];

      for (const record of scoresResult.records) {
        try {
          const scores = JSON.parse(record.get('scores'));
          const categories = ['grammar', 'fluency', 'pronunciation', 'vocabulary', 'professionalism'];
          categories.forEach((cat, idx) => {
            const score = Math.min(5, Math.max(1, Math.round(scores[cat] || 1)));
            const dist = rubricDistribution[idx];
            if (dist && dist.scores && score >= 1 && score <= 5) {
              const currentVal = dist.scores[score - 1] ?? 0;
              dist.scores[score - 1] = currentVal + 1;
            }
          });
        } catch {}
      }

      return {
        total,
        passed,
        failed,
        pending,
        passRate,
        avgScores,
        weeklyData,
        rubricDistribution
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get today's interview queue
   */
  async getTodayQueue(): Promise<{
    id: string;
    time: string;
    tutorId: string;
    tutorName: string;
    tutorEmail: string;
    status: string;
  }[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const today = formatDateISO(new Date());
      
      const result = await session.run(`
        MATCH (s:InterviewSlot {date: $today})
        WHERE s.status IN ['booked', 'in_progress']
        OPTIONAL MATCH (u:User {id: s.tutorId})
        RETURN s, u
        ORDER BY s.time ASC
      `, { today });

      return result.records.map(record => {
        const s = record.get('s').properties;
        const u = record.get('u')?.properties;
        const tutorName = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
        return {
          id: s.id,
          time: s.time,
          tutorId: s.tutorId || '',
          tutorName: tutorName || 'Unknown Tutor',
          tutorEmail: u?.email || '',
          status: s.status
        };
      });
    } finally {
      await session.close();
    }
  }

  // Helper to convert neo4j integers
  private toNumber(value: any): number {
    if (neo4j.isInt(value)) {
      return value.toNumber();
    }
    return Number(value) || 0;
  }
}
