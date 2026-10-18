import { getDriver } from '../../db/memgraph';
import { nanoid } from 'nanoid';
import type {
  TimeSlot,
  Booking,
  WeeklyTemplate,
  PenaltyHistory,
  OpenSlotsInput,
  CloseSlotsInput,
  BulkOpenSlotsInput,
  MarkAttendanceInput,
  WeekScheduleParams,
  WeekSchedule,
  AvailableSlot,
  BookSlotInput,
  CancelBookingInput,
  SaveTemplateInput,
  ApplyTemplateInput,
  PenaltySummary
} from './schedule.interface';
import { determinePenaltyCode, PENALTY_RULES, PENALTY_CODE_DETAILS } from '../../config/penaltyCodes';
import { NotificationService } from '../notification.services/notification.service';
import { getIO } from '../../socket/socket.server';
import { revokeLessonRoom } from '../../socket/revokeLessonRoom';
import { emitSlotBooked, emitSlotCancelled } from '../../socket/handlers/schedule.handler';
import { ticketService } from '../ticket.services/ticket.service';
import { assertTrialAllowance, trialCanBeRestored, trialLaunchMode } from './trialPolicy';
import { lessonPassService } from '../lessonPasses/service';
import { privatePassMode, PassError } from '../lessonPasses/policy';
import { REFUND_POLICY } from '../../config/constant';
import { invalidateCache } from '../../db/redis';
import { ClassroomActivityService } from '../classroomActivity.services/classroomActivity.service';
import { attendanceDeadlineMs, attendanceStartMs, validateAttendanceWindow, validateAttendanceWithPresentNeighbors, NORMAL_DEADLINE_MINUTES, type AttendanceSlotTime } from './attendanceWindow';
import { ClassroomNotesService } from '../classroomNotes.services/classroomNotes.service';
import { ABSENCE_REASONS, isShortNoticeCancellation, validateAbsenceTime, validateReopenPolicy, canStudentCancelLesson, STUDENT_CANCELLATION_CUTOFF_MS, type AbsenceReason } from './cancellationPolicy';
import type { ManagedTransaction } from 'neo4j-driver';
import { assertStudentScheduleAvailable, assertTutorCanSchedule } from './schedulingGuards';
import { reconcileTutorPenaltyBlock } from './tutorPenaltyBlock';
import { BOOKING_CUTOFF_MESSAGE, BOOKING_CUTOFF_MINUTES, SLOT_OPEN_LEAD_MINUTES, bookingCutoffMs, canOpenSlot, canReserveForBooking, CHECKOUT_HOLD_MINUTES } from './bookingPolicy';

const notificationService = new NotificationService();
const classroomActivityService = new ClassroomActivityService();

export class ScheduleService {
  
  /**
   * Helper to convert 12h time to 24h format for Date parsing
   */
  private convert12hTo24h(time12: string): string {
    const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return time12; // Return as-is if already 24h format
    let hour = parseInt(match[1] || '', 10);
    const minute = match[2];
    const isPM = match[3] && match[3].toUpperCase() === 'PM';
    
    if (hour === 12) {
      hour = isPM ? 12 : 0;
    } else if (isPM) {
      hour += 12;
    }
    
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  /**
   * Open time slots for tutoring
   */
  async openSlots(input: OpenSlotsInput): Promise<Array<{ date: string; time: string; slotId: string; status: string }>> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const openedSlots: Array<{ date: string; time: string; slotId: string; status: string }> = [];
      
      
      // First verify the tutor exists
      const tutorCheck = await session.run(
        `MATCH (t:User {id: $tutorId}) RETURN t`,
        { tutorId: input.tutorId }
      );
      
      if (tutorCheck.records.length === 0) {
        throw new Error(`Tutor with id ${input.tutorId} not found`);
      }
      
      for (const slot of input.slots) {
        // Convert 12h time to 24h for proper Date parsing
        const time24h = this.convert12hTo24h(slot.time);
        // Use PHT timezone (+08:00) since slot times are stored in Philippine time
        const slotDateTime = new Date(`${slot.date}T${time24h}:00+08:00`);
        
        
        if (!canOpenSlot(slotDateTime.getTime(), Date.now())) {
          throw new Error(`Cannot open slot at ${slot.date} ${slot.time} - must be at least 11 minutes in the future`);
        }
        
        const opened = await session.executeWrite(async tx => {
          await assertTutorCanSchedule(tx, input.tutorId);
          const result = await tx.run(
            `MATCH (t:User {id: $tutorId})
             WHERE datetime() <= datetime($openUntil)
             MERGE (t)-[:OPENS_SLOT]->(s:TimeSlot {
               tutorId: $tutorId, slotDate: $slotDate, slotTime: $slotTime
             })
             ON CREATE SET s.slotId = $slotId, s.durationMinutes = 25,
                           s.status = 'open', s.isRecurring = false, s.attendanceAutoEnforce = true,
                           s.createdAt = datetime(), s.updatedAt = datetime()
             RETURN s`,
            {
              tutorId: input.tutorId, slotId: nanoid(16), slotDate: slot.date, slotTime: slot.time,
              openUntil: new Date(slotDateTime.getTime() - SLOT_OPEN_LEAD_MINUTES * 60_000).toISOString()
            }
          );
          const saved = result.records[0]?.get('s')?.properties;
          if (!saved?.slotId) throw new Error('Could not open the slot');
          if (saved.status === 'booked') throw new Error('A booked slot cannot be reopened');
          if (saved.status === 'pending') {
            const expiresAt = saved.pendingUntil?.toStandardDate?.().getTime() ??
              (saved.pendingAt?.toStandardDate?.().getTime() ?? 0) + CHECKOUT_HOLD_MINUTES * 60_000;
            if (expiresAt > Date.now()) throw new Error('This slot is reserved for checkout');
            await tx.run(
              `MATCH (s:TimeSlot {slotId: $slotId, status: 'pending'})
               SET s.status = 'open', s.updatedAt = datetime()
               REMOVE s.pendingBy, s.pendingAt, s.pendingUntil, s.reservationId`,
              { slotId: saved.slotId }
            );
          }
          if (saved.status === 'available') {
            if (saved.penaltyCode === '302') throw new Error('A TA-302 slot cannot be reopened');
            const penalties = await tx.run(
              `MATCH (p:Penalty {tutorId: $tutorId, slotId: $slotId, penaltyCode: '303'})
               RETURN p.createdAt AS createdAt ORDER BY p.createdAt DESC`,
              { tutorId: input.tutorId, slotId: saved.slotId }
            );
            validateReopenPolicy({
              slotDate: slot.date,
              nowMs: Date.now(),
              penaltyCount: penalties.records.length,
              reopenCount: saved.ta303ReopenCount?.toNumber?.() ?? Number(saved.ta303ReopenCount ?? 0),
              lastPenaltyMs: penalties.records[0]?.get('createdAt')?.toStandardDate?.().getTime()
            });
            await tx.run(
              `MATCH (s:TimeSlot {slotId: $slotId, tutorId: $tutorId})
               SET s.status = 'open', s.ta303ReopenCount = $reopenCount,
                   s.updatedAt = datetime()
               REMOVE s.penaltyCode, s.penaltyReason`,
              {
                slotId: saved.slotId, tutorId: input.tutorId,
                reopenCount: (saved.ta303ReopenCount?.toNumber?.() ?? Number(saved.ta303ReopenCount ?? 0)) + (penalties.records.length ? 1 : 0)
              }
            );
          }
          await tx.run(
            `MATCH (s:TimeSlot {slotId: $slotId, tutorId: $tutorId})
             SET s.attendanceAutoEnforce = true`,
            { slotId: saved.slotId, tutorId: input.tutorId }
          );
          return { date: slot.date, time: slot.time, slotId: saved.slotId, status: 'open' };
        });
        openedSlots.push(opened);
      }
      return openedSlots;
    } finally {
      await session.close();
    }
  }

  /**
   * Close open time slots
   */
  async closeSlots(input: CloseSlotsInput): Promise<void> {
    this.validateAbsenceDetails(input.reason, input.additionalInfo);
    const session = getDriver().session();
    try {
      await session.executeWrite(async tx => {
        for (const slotId of input.slotIds) {
          await this.cancelOpenSlot(tx, input.tutorId, slotId, input.reason, input.additionalInfo);
        }
      });
    } finally {
      await session.close();
    }
  }

  private validateAbsenceDetails(reason?: AbsenceReason, additionalInfo?: string): void {
    if (!reason || !ABSENCE_REASONS.includes(reason)) throw new Error('Select an absence reason');
    if (additionalInfo && additionalInfo.length > 1000) throw new Error('Additional information must be 1000 characters or fewer');
  }

  private async cancelOpenSlot(
    tx: ManagedTransaction, tutorId: string, slotId: string,
    reason: AbsenceReason, additionalInfo?: string
  ): Promise<void> {
    await tx.run(
      `MATCH (s:TimeSlot {slotId: $slotId, tutorId: $tutorId, status: 'pending'})
       WHERE s.pendingUntil <= datetime() OR
         (s.pendingUntil IS NULL AND (s.pendingAt IS NULL OR s.pendingAt <= datetime($expiredBefore)))
       SET s.status = 'open', s.updatedAt = datetime()
       REMOVE s.pendingBy, s.pendingAt, s.pendingUntil, s.reservationId`,
      { slotId, tutorId, expiredBefore: new Date(Date.now() - CHECKOUT_HOLD_MINUTES * 60_000).toISOString() }
    );
    const result = await tx.run(
      `MATCH (s:TimeSlot {slotId: $slotId, tutorId: $tutorId, status: 'open'})
       RETURN s.slotDate AS date, s.slotTime AS time`,
      { slotId, tutorId }
    );
    const record = result.records[0];
    if (!record) throw new Error('Open slot not found for this tutor');
    const startMs = Date.parse(`${record.get('date')}T${this.convert12hTo24h(record.get('time'))}:00+08:00`);
    const nowMs = Date.now();
    validateAbsenceTime(startMs, nowMs);
    const penalized = isShortNoticeCancellation(startMs, nowMs);
    const penaltyReason = `${reason}${additionalInfo?.trim() ? `: ${additionalInfo.trim()}` : ''}`;
    await tx.run(
      `MATCH (s:TimeSlot {slotId: $slotId, tutorId: $tutorId, status: 'open'})
       SET s.status = 'available', s.attendanceMarked = null,
           s.absenceReason = $reason, s.absenceAdditionalInfo = $additionalInfo,
           s.updatedAt = datetime(), s.penaltyCode = $penaltyCode,
           s.penaltyReason = $penaltyReason,
           s.ta303Count = coalesce(s.ta303Count, 0) + $penaltyIncrement,
           s.lastTa303At = CASE WHEN $penalized THEN datetime() ELSE s.lastTa303At END
       CREATE (c:SlotCancellation {
         cancellationId: $cancellationId, tutorId: $tutorId, slotId: $slotId,
         reason: $reason, additionalInfo: $additionalInfo,
         penaltyCode: $penaltyCode, createdAt: datetime()
       })
       CREATE (s)-[:HAS_CANCELLATION]->(c)`,
      {
        slotId, tutorId, reason, additionalInfo: additionalInfo?.trim() || null,
        penaltyCode: penalized ? '303' : null,
        penaltyReason: penalized ? penaltyReason : null,
        penalized, penaltyIncrement: penalized ? 1 : 0,
        cancellationId: nanoid(16)
      }
    );
    if (penalized) {
      const penalty = PENALTY_CODE_DETAILS['303'];
      await tx.run(
        `MATCH (t:User {id: $tutorId})
         CREATE (p:Penalty {
           penaltyId: $penaltyId, tutorId: $tutorId, slotId: $slotId,
           penaltyCode: '303', penaltyReason: $penaltyReason,
           absenceReason: $reason, additionalInfo: $additionalInfo,
           severity: $severity, affectsCompensation: false, createdAt: datetime()
         })
         CREATE (t)-[:HAS_PENALTY]->(p)`,
        {
          tutorId, slotId, penaltyId: nanoid(16), penaltyReason,
          reason, additionalInfo: additionalInfo?.trim() || null,
          severity: penalty.severity
        }
      );
    }
  }

  /**
   * Bulk open slots for a date range
   */
  async bulkOpenSlots(input: BulkOpenSlotsInput): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      const now = new Date();
      
      const slots: Array<{ date: string; time: string }> = [];
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        
        // Skip if specific days are requested and this day isn't included
        if (input.daysOfWeek && !input.daysOfWeek.includes(dayOfWeek)) {
          continue;
        }
        
        for (const time of input.times) {
          // Use PHT timezone (+08:00) since slot times are stored in Philippine time
          const slotDateTime = new Date(`${d.toISOString().split('T')[0]}T${time}:00+08:00`);
          
          if (canOpenSlot(slotDateTime.getTime(), now.getTime())) {
            slots.push({
              date: d.toISOString().split('T')[0] || '',
              time
            });
          }
        }
      }
      
      if (slots.length > 100) {
        throw new Error('Cannot open more than 100 slots at once');
      }
      
      await this.openSlots({ tutorId: input.tutorId, slots });
    } finally {
      await session.close();
    }
  }

  /**
   * Get tutor's schedule for a specific week
   */
  async getTutorSchedule(params: WeekScheduleParams): Promise<WeekSchedule> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // Schedule dates are stored and displayed in PHT. Build the week from the
      // PHT calendar date so Sundays and the UTC/PHT day boundary stay aligned
      // with the tutor's grid.
      const phtParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const getPart = (type: Intl.DateTimeFormatPartTypes) =>
        Number(phtParts.find(part => part.type === type)?.value);
      const today = new Date(Date.UTC(
        getPart('year'),
        getPart('month') - 1,
        getPart('day')
      ));
      const daysSinceMonday = today.getUTCDay() === 0 ? 6 : today.getUTCDay() - 1;
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() - daysSinceMonday + (params.weekOffset * 7));
      
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      
      const startDate = monday.toISOString().split('T')[0];
      const endDate = sunday.toISOString().split('T')[0];
      
      
      // Get all slots for the week
      const result = await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:OPENS_SLOT]->(s:TimeSlot)
        WHERE s.slotDate >= $startDate AND s.slotDate <= $endDate
        OPTIONAL MATCH (s)<-[:BOOKS]-(b:Booking)
        WHERE b.status IN ['confirmed', 'completed']
        OPTIONAL MATCH (b)-[:BOOKED_BY]->(student:Student)
        RETURN s, b, student
        ORDER BY s.slotDate, s.slotTime
        `,
        { tutorId: params.tutorId, startDate, endDate }
      );

      const slotIds = [...new Set(result.records.map(record => record.get('s')?.properties?.slotId).filter(Boolean))];
      const penaltyHistory = slotIds.length ? await session.run(
        `MATCH (p:Penalty {tutorId: $tutorId, penaltyCode: '303'})
         WHERE p.slotId IN $slotIds
         RETURN p.slotId AS slotId, p.createdAt AS createdAt, p.penaltyReason AS reason
         ORDER BY p.createdAt DESC`,
        { tutorId: params.tutorId, slotIds }
      ) : null;
      const ta303History = new Map<string, { count: number; lastAt?: string; reason?: string }>();
      for (const record of penaltyHistory?.records || []) {
        const slotId = record.get('slotId') as string;
        const existing = ta303History.get(slotId);
        ta303History.set(slotId, {
          count: (existing?.count || 0) + 1,
          lastAt: existing?.lastAt || record.get('createdAt')?.toStandardDate?.().toISOString(),
          reason: existing?.reason || record.get('reason')
        });
      }
      
      
      const slots = result.records.map(record => {
        const slot = record.get('s')?.properties;
        const booking = record.get('b')?.properties;
        const student = record.get('student')?.properties;
        const history = ta303History.get(slot.slotId);
        
        
        return {
          date: slot.slotDate,
          time: slot.slotTime,
          status: slot.status === 'pending' &&
            (slot.pendingUntil?.toStandardDate?.().getTime() ??
              (slot.pendingAt?.toStandardDate?.().getTime() ?? 0) + CHECKOUT_HOLD_MINUTES * 60_000) <= Date.now()
            ? 'open' : slot.status,
          reservationExpiresAt: slot.pendingUntil?.toStandardDate?.().toISOString(),
          slotId: slot.slotId,
          bookingId: booking?.bookingId,
          bookedAt: booking?.bookedAt?.toStandardDate?.().toISOString(),
          attendanceWindowOpenedAt: booking?.attendancePolicyActivatedAt?.toStandardDate?.().toISOString()
            || booking?.bookedAt?.toStandardDate?.().toISOString(),
          tutorRoomEnteredAt: booking?.tutorRoomEnteredAt?.toStandardDate?.().toISOString(),
          roomEntryPolicyActivatedAt: booking?.roomEntryPolicyActivatedAt?.toStandardDate?.().toISOString(),
          roomEntryCheckCompletedAt: booking?.roomEntryCheckCompletedAt?.toStandardDate?.().toISOString(),
          attendanceSource: booking?.attendanceSource || slot.attendanceSource,
          studentId: student?.id,
          studentName: student ? `${student.givenName} ${student.familyName}` : undefined,
          penaltyCode: slot.status === 'available' ? (slot.penaltyCode || (history ? '303' : undefined)) : booking?.penaltyCode,
          penaltyReason: slot.status === 'available' ? (slot.penaltyReason || history?.reason) : booking?.penaltyReason,
          ta303Count: history?.count ?? (slot.ta303Count?.toNumber?.() ?? Number(slot.ta303Count ?? 0)),
          ta303ReopenCount: slot.ta303ReopenCount?.toNumber?.() ?? Number(slot.ta303ReopenCount ?? 0),
          lastTa303At: history?.lastAt || slot.lastTa303At?.toStandardDate?.().toISOString(),
          attendanceTutor: booking?.attendanceTutor,
          attendanceStudent: booking?.attendanceStudent,
          attendanceMarked: slot.attendanceMarked
        };
      });
      
      
      return {
        weekStart: monday,
        weekEnd: sunday,
        slots,
        schedulingBlock: await this.getSchedulingBlock(params.tutorId)
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get available slots for student booking
   */
  async getSchedulingBlock(tutorId: string) {
    const session = getDriver().session();
    try {
      const row = (await session.run('MATCH (t:User {id: $tutorId}) RETURN t.isBlocked AS blocked, t.blockExpiresAt AS expires', { tutorId })).records[0];
      const expiresAt = row?.get('expires')?.toStandardDate?.().toISOString() || null;
      return { active: Boolean(row?.get('blocked') && (!expiresAt || Date.parse(expiresAt) > Date.now())), expiresAt };
    } finally { await session.close(); }
  }

  async getAvailableSlots(tutorId: string, startDate: string, endDate: string): Promise<AvailableSlot[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const now = new Date();
      
      const result = await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:OPENS_SLOT]->(s:TimeSlot)
        WHERE s.slotDate >= $startDate 
          AND s.slotDate <= $endDate
          AND s.status IN ['open', 'pending']
          AND (coalesce(t.isBlocked, false) = false OR t.blockExpiresAt <= datetime())
        RETURN s
        ORDER BY s.slotDate, s.slotTime
        `,
        { tutorId, startDate, endDate }
      );
      
      return result.records
        .map(record => {
          const slot = record.get('s').properties;
          
          // Convert 12h time to 24h for proper Date parsing
          const time24h = this.convert12hTo24h(slot.slotTime);
          // Slot times are stored in PHT (UTC+8), parse as PHT
          const slotDateTime = new Date(`${slot.slotDate}T${time24h}:00+08:00`);
          
          const holdExpired = slot.status === 'pending' &&
            (slot.pendingUntil?.toStandardDate?.().getTime() ??
              (slot.pendingAt?.toStandardDate?.().getTime() ?? 0) + CHECKOUT_HOLD_MINUTES * 60_000) <= now.getTime();
          if (slot.status === 'pending' && !holdExpired) return null;
          if (!canReserveForBooking(slotDateTime.getTime(), now.getTime(), slot.attendanceMarked === 'present')) {
            return null;
          }
          
          return {
            slotId: slot.slotId,
            tutorId: slot.tutorId,
            date: slot.slotDate,
            time: slot.slotTime,
            durationMinutes: slot.durationMinutes
          };
        })
        .filter(Boolean) as AvailableSlot[];
    } finally {
      await session.close();
    }
  }

  async reserveSlotForCheckout(studentId: string, slotId: string): Promise<{ reservationId: string; expiresAt: string; bookBy: string }> {
    const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        const nowMs = Date.now();
        const result = await tx.run(
          `MATCH (s:TimeSlot {slotId: $slotId}) RETURN s`, { slotId }
        );
        const slot = result.records[0]?.get('s')?.properties;
        if (!slot) throw new Error('Slot not found');
        await assertStudentScheduleAvailable(tx, studentId, slot);
        await assertTutorCanSchedule(tx, slot.tutorId);
        const startMs = attendanceStartMs({ date: slot.slotDate, time: slot.slotTime });
        const existingExpiry = slot.pendingUntil?.toStandardDate?.().getTime() ??
          (slot.pendingAt?.toStandardDate?.().getTime() ?? 0) + CHECKOUT_HOLD_MINUTES * 60_000;
        if (!canReserveForBooking(startMs, nowMs, slot.attendanceMarked === 'present')) {
          throw new Error(BOOKING_CUTOFF_MESSAGE);
        }
        const bookBy = (expiryMs: number, present: boolean) => new Date(Math.min(
          expiryMs, bookingCutoffMs(startMs, present)
        )).toISOString();
        if (slot.status === 'pending' && existingExpiry > nowMs && slot.pendingBy === studentId && slot.reservationId) {
          return { reservationId: slot.reservationId, expiresAt: new Date(existingExpiry).toISOString(), bookBy: bookBy(existingExpiry, slot.attendanceMarked === 'present') };
        }
        if (slot.status !== 'open' && !(slot.status === 'pending' && existingExpiry <= nowMs)) {
          throw new Error('This slot is no longer available');
        }
        const reservationId = nanoid(24);
        const expiresAt = new Date(Math.min(nowMs + CHECKOUT_HOLD_MINUTES * 60_000, startMs)).toISOString();
        const reserved = await tx.run(
          `MATCH (s:TimeSlot {slotId: $slotId})
           WHERE ((s.attendanceMarked = 'present' AND datetime() <= datetime($cutoffAt))
              OR (coalesce(s.attendanceMarked, '') <> 'present' AND datetime() < datetime($unconfirmedCutoffAt)))
             AND (s.status = 'open' OR
               (s.status = 'pending' AND (s.pendingUntil <= datetime($now) OR
                 (s.pendingUntil IS NULL AND (s.pendingAt IS NULL OR s.pendingAt <= datetime($expiredBefore))))))
           SET s.status = 'pending', s.pendingBy = $studentId,
               s.pendingAt = datetime($now), s.pendingUntil = datetime($expiresAt),
               s.reservationId = $reservationId, s.updatedAt = datetime()
           RETURN s.slotId AS slotId, s.attendanceMarked AS attendanceMarked`,
          {
            slotId, studentId, reservationId, expiresAt,
            cutoffAt: new Date(startMs - BOOKING_CUTOFF_MINUTES * 60_000).toISOString(),
            unconfirmedCutoffAt: new Date(startMs - SLOT_OPEN_LEAD_MINUTES * 60_000).toISOString(),
            now: new Date(nowMs).toISOString(),
            expiredBefore: new Date(nowMs - CHECKOUT_HOLD_MINUTES * 60_000).toISOString()
          }
        );
        if (!reserved.records.length) throw new Error('This slot was just reserved by someone else');
        return { reservationId, expiresAt, bookBy: bookBy(Date.parse(expiresAt), reserved.records[0]!.get('attendanceMarked') === 'present') };
      });
    } finally {
      await session.close();
    }
  }

  async releaseSlotReservation(studentId: string, slotId: string, reservationId: string): Promise<void> {
    const session = getDriver().session();
    try {
      await session.run(
        `MATCH (s:TimeSlot {slotId: $slotId, status: 'pending', pendingBy: $studentId,
                            reservationId: $reservationId})
         SET s.status = 'open', s.updatedAt = datetime()
         REMOVE s.pendingBy, s.pendingAt, s.pendingUntil, s.reservationId`,
        { studentId, slotId, reservationId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Book a time slot (student action)
   * Uses atomic update to prevent duplicate bookings
   */
  async bookSlot(input: BookSlotInput): Promise<Booking> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      
      const existingBooking = await session.run(
        `MATCH (b:Booking {reservationId: $reservationId, studentId: $studentId})
         RETURN b`,
        { reservationId: input.reservationId, studentId: input.studentId }
      );
      if (existingBooking.records.length) {
        const booking = existingBooking.records[0]!.get('b').properties;
        return {
          ...booking,
          slotDateTime: booking.slotDateTime?.toStandardDate?.() ?? booking.slotDateTime,
          bookedAt: booking.bookedAt?.toStandardDate?.() ?? booking.bookedAt
        } as Booking;
      }

      const usesTrial = trialLaunchMode();
      if (usesTrial && (input.ticketTransferTxHash || input.privatePassReservationId))
        throw new Error('Trial bookings do not accept ticket transfers or lesson passes');
      const usesPass = !usesTrial && privatePassMode();
      if (usesPass) {
        if (!input.privatePassReservationId || input.ticketTransferTxHash) throw new PassError('A private pass reservation is required', 409);
        await lessonPassService.readyForBooking(input.studentId, input.privatePassReservationId);
      } else if (input.privatePassReservationId) throw new PassError('Private passes are not enabled', 503);

      const slotResult = await session.run(
        `
        MATCH (s:TimeSlot {slotId: $slotId, status: 'pending', pendingBy: $studentId,
                            reservationId: $reservationId})
        WHERE s.pendingUntil > datetime()
          AND NOT EXISTS { MATCH (:TicketRecovery {txHash: $ticketTransferTxHash}) }
        RETURN s
        `,
        { slotId: input.slotId, studentId: input.studentId, reservationId: input.reservationId,
          ticketTransferTxHash: input.ticketTransferTxHash || null }
      );
      
      
      if (slotResult.records.length === 0) {
        throw new Error('Checkout reservation expired or is no longer available');
      }
      
      const slot = slotResult.records[0]?.get('s').properties;
      const startMs = attendanceStartMs({ date: slot.slotDate, time: slot.slotTime });
      if (!canReserveForBooking(startMs, Date.now(), slot.attendanceMarked === 'present')) {
        throw new Error(BOOKING_CUTOFF_MESSAGE);
      }
      
      // Check if tutor is certified (passed both exams AND profile approved)
      // OR is a test account (bypass for development)
      const TEST_TUTOR_EMAILS = ['paulanthonyarriola@gmail.com'];
      const certificationResult = await session.run(
        `MATCH (u:User {id: $tutorId})
         RETURN u.writtenExamPassed as writtenPassed, u.speakingExamPassed as speakingPassed, u.profileStatus as profileStatus, u.email as email`,
        { tutorId: slot.tutorId }
      );
      
      if (certificationResult.records.length > 0) {
        const writtenPassed = certificationResult.records[0]?.get('writtenPassed');
        const speakingPassed = certificationResult.records[0]?.get('speakingPassed');
        const profileStatus = certificationResult.records[0]?.get('profileStatus');
        const tutorEmail = certificationResult.records[0]?.get('email');
        
        // Bypass certification check for test accounts
        const isTestAccount = TEST_TUTOR_EMAILS.includes(tutorEmail);
        
        // Full certification requires: passed both exams AND profile approved
        const isFullyCertified = writtenPassed === true && speakingPassed === true && profileStatus === 'approved';
        
        if (!isTestAccount && !isFullyCertified) {
          throw new Error('This tutor is not yet certified to teach. Please choose a certified tutor.');
        }
      } else {
        throw new Error('Tutor not found');
      }
      
      // Parse slotTime - it's already in 12-hour format like "6:00 PM"
      // Convert to 24-hour format for Date constructor
      const slotTime = slot.slotTime; // e.g., "6:00 PM" or "18:00"
      let slotDateTime: Date;
      
      try {
        let hours: number;
        let minutes: number;
        
        // Try 12-hour format first (e.g., "6:00 PM", "11:30 PM")
        const time12Match = slotTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (time12Match) {
          hours = parseInt(time12Match[1] || '', 10);
          minutes = parseInt(time12Match[2] || '', 10);
          const meridiem = time12Match[3].toUpperCase();
          
          
          // Convert to 24-hour format
          if (meridiem === 'PM' && hours !== 12) {
            hours += 12;
          } else if (meridiem === 'AM' && hours === 12) {
            hours = 0;
          }
        } else {
          // Try 24-hour format (e.g., "18:00", "23:30")
          const time24Match = slotTime.match(/^(\d{1,2}):(\d{2})$/);
          if (time24Match) {
            hours = parseInt(time24Match[1] || '', 10);
            minutes = parseInt(time24Match[2] || '', 10);
          } else {
            throw new Error(`Invalid time format: ${slotTime}`);
          }
        }
        
        
        // Create date with proper format - use PHT timezone (+08:00) since slot times are stored in Philippine time
        slotDateTime = new Date(`${slot.slotDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`);
        
        
        if (isNaN(slotDateTime.getTime())) {
          throw new Error(`Invalid date/time combination: ${slot.slotDate} ${slotTime}`);
        }
      } catch (error: any) {
        console.error('Error parsing slot time:', error);
        throw new Error(`Failed to parse slot time: ${error.message}`);
      }
      
      const now = new Date();
      if (slotDateTime <= now) {
        throw new Error('The lesson has already started');
      }
      
      const bookingId = nanoid(16);
      
      // Check if student exists and get wallet address
      const studentCheck = await session.run(
        `MATCH (student:Student {id: $studentId}) 
         RETURN student, student.externalWalletAddress as walletAddress, student.smartWalletAddress as smartWallet`,
        { studentId: input.studentId }
      );
      
      if (studentCheck.records.length === 0) {
        throw new Error('Student account not found. Please make sure you are logged in as a student.');
      }
      
      // Get student's wallet address for ticket tracking
      const studentWallet = studentCheck.records[0]?.get('walletAddress') || studentCheck.records[0]?.get('smartWallet');
      
      let verificationResult: { valid: boolean; tier?: 'basic' | 'premium' | 'trial'; error?: string } = { valid: true, tier: 'basic' };
      if (!usesPass && !usesTrial) {
      if (!studentWallet) {
        throw new Error('You need a connected wallet to book lessons. Please connect your wallet first.');
      }
      
      
      // Verify ticket transfer was done from frontend (tx hash is required)
      if (!input.ticketTransferTxHash) {
        throw new Error('Ticket transfer is required to book a lesson. Please try again.');
      }
      
      
      // === TRANSACTION REPLAY PROTECTION ===
      // Check if this transaction hash has already been used for a booking
      const existingTxResult = await session.run(
        `
        MATCH (t:TicketTransaction {transferTxId: $txHash})
        RETURN t.id as id, t.bookingId as bookingId
        `,
        { txHash: input.ticketTransferTxHash }
      );
      
      if (existingTxResult.records.length > 0) {
        throw new Error('This transaction has already been used for a booking. Please make a new ticket transfer.');
      }
      const existingTransferBooking = await session.run(
        `MATCH (b:Booking {ticketTransferTxHash: $txHash}) RETURN b.bookingId AS bookingId`,
        { txHash: input.ticketTransferTxHash }
      );
      if (existingTransferBooking.records.length) {
        throw new Error('This ticket transfer has already been used for a booking');
      }
      const claimedRecovery = await session.run(
        `MATCH (r:TicketRecovery {txHash: $txHash}) RETURN r.txHash AS txHash`,
        { txHash: input.ticketTransferTxHash }
      );
      if (claimedRecovery.records.length) throw new Error('This ticket transfer is already being recovered');
      // === END TRANSACTION REPLAY PROTECTION ===
      
      // === SERVER-SIDE TICKET VERIFICATION ===
      // Verify the transaction on the blockchain before accepting the booking
      verificationResult = await ticketService.verifyTicketTransfer(
        input.ticketTransferTxHash,
        studentWallet
      );
      
      if (!verificationResult.valid) {
        throw new Error(`Ticket verification failed: ${verificationResult.error}`);
      }
      }
      
      // === END SERVER-SIDE TICKET VERIFICATION ===
      
      // Create booking and update slot
      const bookingResult = await session.executeWrite(async tx => {
        await tx.run(`MATCH (student:Student {id: $studentId})
          SET student.bookingWriteVersion = coalesce(student.bookingWriteVersion, 0) + 1`, { studentId: input.studentId });
        const existing = await tx.run(`MATCH (b:Booking {reservationId: $reservationId, studentId: $studentId}) RETURN b, null AS s`,
          { reservationId: input.reservationId, studentId: input.studentId });
        if (existing.records.length) return existing;
        if (usesTrial) await assertTrialAllowance(tx, input.studentId);
        if (usesPass) await lessonPassService.repository.claimForBooking(tx, input.studentId, input.privatePassReservationId!, bookingId);
        await assertStudentScheduleAvailable(tx, input.studentId, slot);
        await assertTutorCanSchedule(tx, slot.tutorId);
        const result = await tx.run(
        `
        MATCH (s:TimeSlot {slotId: $slotId, status: 'pending', pendingBy: $studentId,
                            reservationId: $reservationId})
        WHERE s.pendingUntil > datetime()
          AND datetime() <= datetime($cutoffAt)
          AND (s.attendanceMarked = 'present' OR datetime() < datetime($unconfirmedCutoffAt))
          AND NOT EXISTS { MATCH (:TicketRecovery {txHash: $ticketTransferTxHash}) }
          AND NOT EXISTS { MATCH (:Booking {ticketTransferTxHash: $ticketTransferTxHash}) }
        MATCH (student:Student {id: $studentId})
        WITH s, student, s.attendanceMarked AS preconfirmed
        SET s.status = 'booked', s.studentId = $studentId, s.updatedAt = datetime()
        REMOVE s.pendingBy, s.pendingAt, s.pendingUntil, s.reservationId
        CREATE (b:Booking {
          bookingId: $bookingId,
          slotId: $slotId,
          reservationId: $reservationId,
          tutorId: $tutorId,
          studentId: $studentId,
          ticketTransferTxHash: $ticketTransferTxHash,
          privatePassReservationId: $privatePassReservationId,
          paymentMethod: $paymentMethod,
          slotDateTime: datetime($slotDateTime),
          durationMinutes: $durationMinutes,
          status: 'confirmed',
          attendanceAutoEnforce: true,
          attendanceTutor: CASE WHEN preconfirmed = 'present' THEN 'present' ELSE null END,
          attendanceSource: CASE WHEN preconfirmed = 'present' THEN 'open_slot_confirmation'
            ELSE s.attendanceSource END,
          roomEntryPolicyActivatedAt: CASE WHEN preconfirmed = 'present' THEN datetime() ELSE null END,
          bookedAt: datetime()
        })
        CREATE (b)-[:BOOKS]->(s)
        CREATE (b)-[:BOOKED_BY]->(student)
        RETURN b, s
        `,
        {
          slotId: input.slotId,
          reservationId: input.reservationId,
          ticketTransferTxHash: input.ticketTransferTxHash || null,
          privatePassReservationId: input.privatePassReservationId || null,
          paymentMethod: usesTrial ? 'trial' : usesPass ? 'private_pass' : 'erc1155',
          bookingId,
          studentId: input.studentId,
          tutorId: slot.tutorId,
          slotDateTime: slotDateTime.toISOString(),
          cutoffAt: new Date(startMs - BOOKING_CUTOFF_MINUTES * 60_000).toISOString(),
          unconfirmedCutoffAt: new Date(startMs - SLOT_OPEN_LEAD_MINUTES * 60_000).toISOString(),
          durationMinutes: slot.durationMinutes
        }
        );
        if (!result.records.length) throw new Error('Checkout reservation expired before booking could finish');
        return result;
      });
      if (!bookingResult.records.length) throw new Error('Checkout reservation expired before booking could finish');
      const savedBooking = bookingResult.records[0]!.get('b').properties;
      if (savedBooking.bookingId !== bookingId) return {
        ...savedBooking,
        slotDateTime: savedBooking.slotDateTime?.toStandardDate?.() ?? savedBooking.slotDateTime,
        bookedAt: savedBooking.bookedAt?.toStandardDate?.() ?? savedBooking.bookedAt,
      } as Booking;

      if (!usesPass && !usesTrial) try {
        await ticketService.recordTicketDeduction({
          studentId: input.studentId,
          studentWallet,
          tutorId: slot.tutorId,
          bookingId,
          slotId: input.slotId,
          tier: verificationResult.tier || 'basic',
          transferTxHash: input.ticketTransferTxHash,
        });
      } catch (ticketError: any) {
        console.error('WARNING: Booking confirmed but ticket transaction recording failed:', ticketError.message);
      }
      
      // Send notification to tutor about new booking
      try {
        // Get student name for notification
        const studentNameResult = await session.run(
          `MATCH (s:Student {id: $studentId}) RETURN s.firstName as firstName, s.lastName as lastName`,
          { studentId: input.studentId }
        );
        
        const studentFirstName = studentNameResult.records[0]?.get('firstName') || '';
        const studentLastName = studentNameResult.records[0]?.get('lastName') || '';
        const studentName = `${studentFirstName} ${studentLastName}`.trim() || 'A student';
        
        // Format date for notification
        const formattedDate = new Date(slot.slotDate).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        });
        
        await notificationService.notifyNewBooking(
          slot.tutorId,
          studentName,
          formattedDate,
          slot.slotTime,
          bookingId,
          input.studentId,
          slot.slotDate,
          input.slotId
        ).then(notification => {
          // Emit real-time notification via Socket.IO
          const io = getIO();
          if (io) {
            io.to(`notifications:${slot.tutorId}`).emit('notification:new', notification);
            
            // Emit real-time schedule update
            emitSlotBooked(io, slot.tutorId, {
              slotKey: input.slotId,
              bookingId,
              studentId: input.studentId,
              studentName: studentName,
              date: slot.slotDate,
              time: slot.slotTime
            });
          }
        });
        
      } catch (notifError) {
        console.error('Failed to send booking notification:', notifError);
        // Don't fail the booking if notification fails
      }
      
      // Invalidate ticket balance cache for the student
      if (!usesTrial && studentWallet) {
        const cacheKey = `ticket:balance:${studentWallet.toLowerCase()}`;
        await invalidateCache(cacheKey);
      }
      
      // Invalidate student stats and bookings cache
      await Promise.all([
        invalidateCache(`student:stats:${input.studentId}`),
        invalidateCache(`student:bookings:${input.studentId}`),
        invalidateCache(`student:activity:${input.studentId}:10`),
        invalidateCache(`student:activity:${input.studentId}:50`)
      ]);
      
      
      return {
        bookingId,
        slotId: input.slotId,
        tutorId: slot.tutorId,
        studentId: input.studentId,
        slotDateTime,
        durationMinutes: slot.durationMinutes,
        status: 'confirmed',
        bookedAt: now
      };
    } catch (error: any) {
      throw error;
    } finally {
      await session.close();
    }
  }

  async reservationStatus(studentId: string, reservationId: string) {
    const session = getDriver().session();
    try {
      const booked = await session.run(`MATCH (b:Booking {studentId: $studentId, reservationId: $reservationId})
        RETURN b.bookingId AS bookingId`, { studentId, reservationId });
      if (booked.records.length) return { state: 'booked', bookingId: booked.records[0]!.get('bookingId') };
      const held = await session.run(`MATCH (s:TimeSlot {pendingBy: $studentId, reservationId: $reservationId, status: 'pending'})
        WHERE s.pendingUntil > datetime() RETURN s.slotId AS slotId`, { studentId, reservationId });
      return { state: held.records.length ? 'held' : 'expired' };
    } finally { await session.close(); }
  }

  /**
   * Cancel a booking (student action)
   * Refunds the ticket if cancellation is more than 1 hour before scheduled time
   */
  async cancelBooking(input: CancelBookingInput): Promise<{
    success: boolean;
    refunded: boolean;
    message: string;
  }> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      
      // Get booking details
      const bookingResult = await session.run(
        `
        MATCH (b:Booking {bookingId: $bookingId})-[:BOOKS]->(s:TimeSlot)
        RETURN b, s
        `,
        { bookingId: input.bookingId }
      );
      
      if (bookingResult.records.length === 0) {
        throw new Error('Booking not found');
      }
      
      const booking = bookingResult.records[0]?.get('b').properties;
      const slot = bookingResult.records[0]?.get('s').properties;
      
      // Check if booking is already cancelled
      if (booking.status === 'cancelled') {
        throw new Error('Booking is already cancelled');
      }
      
      // Check if booking is completed
      if (booking.status === 'completed') {
        throw new Error('Cannot cancel a completed booking');
      }
      
      // Verify the user cancelling is the student who made the booking
      if (booking.studentId !== input.cancelledBy) {
        throw new Error('You can only cancel your own bookings');
      }

      const scheduledTime = booking.slotDateTime?.toStandardDate?.() ?? new Date(booking.slotDateTime);
      if (!Number.isFinite(scheduledTime.getTime())) {
        throw new Error('Booking does not have a valid scheduled time');
      }
      if (!canStudentCancelLesson(booking.status, scheduledTime.getTime())) {
        throw new Error('Cannot cancel a lesson within five minutes of its scheduled start or after it has started');
      }
      if (booking.status !== 'confirmed') {
        throw new Error('Only confirmed bookings can be cancelled');
      }
      
      // Get the student's wallet address for refund
      const studentResult = await session.run(
        `MATCH (s:Student {id: $studentId})
         RETURN s.externalWalletAddress as walletAddress, s.smartWalletAddress as smartWallet`,
        { studentId: booking.studentId }
      );
      
      const studentWallet = studentResult.records[0]?.get('walletAddress') || studentResult.records[0]?.get('smartWallet');
      
      // Get the original ticket transaction for this booking
      const ticketTransaction = booking.privatePassReservationId || booking.paymentMethod === 'trial' ? null : await ticketService.getBookingTransaction(input.bookingId);

      // Claim cancellation atomically before any refund, rechecking the clock and status.
      const cancelled = await session.run(`
        MATCH (b:Booking {bookingId: $bookingId, studentId: $cancelledBy, status: 'confirmed'})-[:BOOKS]->(s:TimeSlot)
        WHERE b.slotDateTime = datetime($scheduledAt) AND datetime() < datetime($cancelUntil)
        SET b.status = 'cancelled', b.cancelledAt = datetime(), b.cancelledBy = $cancelledBy,
            b.cancellationReason = $reason, b.refunded = false, b.updatedAt = datetime(),
            b.refundStatus = CASE WHEN b.paymentMethod = 'trial' THEN 'not_required'
              WHEN b.privatePassReservationId IS NOT NULL THEN 'pass_pending' ELSE 'pending' END, b.cancellationRefundVersion = 1,
            s.status = 'open', s.studentId = null, s.updatedAt = datetime()
        RETURN b`, {
        bookingId: input.bookingId, cancelledBy: input.cancelledBy,
        cancelUntil: new Date(scheduledTime.getTime() - STUDENT_CANCELLATION_CUTOFF_MS).toISOString(),
        scheduledAt: scheduledTime.toISOString(),
        reason: input.reason || 'Student cancelled',
      });
      if (!cancelled.records.length) {
        throw new Error('This lesson can no longer be cancelled. The five-minute cancellation deadline has passed or its booking status has changed.');
      }
      revokeLessonRoom(getIO(), input.bookingId);
      
      let refunded = false;
      let refundMessage = '';
      
      // Process refund if student has a wallet and there was a ticket transaction
      if (booking.paymentMethod === 'trial') {
        refundMessage = trialCanBeRestored(cancelled.records[0]!.get('b').properties)
          ? 'Your trial lesson is available to book again.' : 'Your trial allowance remains used for this late cancellation.';
      } else if (booking.privatePassReservationId) {
        refundMessage = scheduledTime.getTime() - Date.now() >= REFUND_POLICY.NO_REFUND_HOURS * 3600000
          ? 'Your replacement pass is pending finalization.' : 'No pass refund for cancellations less than one hour before the lesson.';
      } else if (studentWallet && ticketTransaction) {
        try {
          const refundResult = await ticketService.refundTicketForCancellation({
            studentId: booking.studentId,
            studentWallet,
            bookingId: input.bookingId,
            transactionId: ticketTransaction.id,
            scheduledTime,
            reason: input.reason || 'Student cancelled booking',
          });
          
          if (refundResult?.status === 'completed') {
            refunded = true;
            refundMessage = 'Your ticket has been refunded.';
          } else if (refundResult?.refundPhase === 'review') {
            refundMessage = 'Your refund needs verification. Support has been notified; you do not need to cancel again.';
          } else if (refundResult) {
            refundMessage = 'Your refund is being processed. You will be notified when your ticket is returned.';
          } else {
            refundMessage = `No refund - cancellation was less than ${REFUND_POLICY.NO_REFUND_HOURS} hour before scheduled lesson.`;
          }
        } catch (refundError: any) {
          console.error('Failed to process refund:', refundError.message);
          refundMessage = 'Your refund is saved for processing. You do not need to cancel again.';
        }
      } else if (!ticketTransaction) {
        refundMessage = 'No ticket transaction found for this booking.';
        await session.run("MATCH (b:Booking {bookingId: $bookingId}) SET b.refundStatus = 'not_required'", { bookingId: input.bookingId });
      } else {
        refundMessage = 'Your refund is saved for processing. You will be notified when your ticket is returned.';
      }
      
      // Send notification to tutor about cancellation
      try {
        const studentNameResult = await session.run(
          `MATCH (s:Student {id: $studentId}) RETURN s.firstName as firstName, s.lastName as lastName`,
          { studentId: booking.studentId }
        );
        
        const studentFirstName = studentNameResult.records[0]?.get('firstName') || '';
        const studentLastName = studentNameResult.records[0]?.get('lastName') || '';
        const studentName = `${studentFirstName} ${studentLastName}`.trim() || 'A student';
        
        const notification = await notificationService.createNotification({
          userId: booking.tutorId,
          userType: 'tutor',
          type: 'booking_cancelled',
          title: 'Booking Cancelled',
          message: `${studentName} has cancelled their lesson scheduled for ${scheduledTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${scheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
          data: {
            bookingId: input.bookingId,
            slotId: booking.slotId,
            studentId: booking.studentId,
            studentName,
            date: slot.slotDate,
            time: slot.slotTime,
            link: '/schedule',
            reason: input.reason,
          },
        });
        
        // Emit real-time notification
        const io = getIO();
        if (io) {
          io.to(`notifications:${booking.tutorId}`).emit('notification:new', notification);
          emitSlotCancelled(io, booking.tutorId, {
            slotKey: booking.slotId,
            date: slot.slotDate,
            time: slot.slotTime,
          });
        }
        
      } catch (notifError) {
        console.error('Failed to send cancellation notification:', notifError);
      }
      
      // Invalidate student caches after cancellation
      await Promise.all([
        invalidateCache(`student:stats:${booking.studentId}`),
        invalidateCache(`student:bookings:${booking.studentId}`),
        invalidateCache(`student:activity:${booking.studentId}:10`),
        invalidateCache(`student:activity:${booking.studentId}:50`)
      ]);
      
      
      return {
        success: true,
        refunded,
        message: refunded 
          ? `Booking cancelled successfully. ${refundMessage}`
          : `Booking cancelled. ${refundMessage}`,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Mark attendance for a session
   */
  async enableAutoAttendanceForUpcomingBookings(): Promise<void> {
    const session = getDriver().session();
    try {
      const now = new Date();
      await session.run(
        `MATCH (b:Booking {status: 'confirmed'})-[:BOOKS]->(s:TimeSlot {status: 'booked'})
         WHERE b.attendanceAutoEnforce IS NULL AND b.attendanceTutor IS NULL
           AND b.slotDateTime >= datetime($eligibleAfter)
         SET b.attendanceAutoEnforce = true,
             b.attendancePolicyActivatedAt = datetime($activatedAt)`,
        {
          eligibleAfter: new Date(now.getTime() + NORMAL_DEADLINE_MINUTES * 60_000).toISOString(),
          activatedAt: now.toISOString()
        }
      );
    } finally {
      await session.close();
    }
  }

  async enableRoomEntryPolicyForUpcomingBookings(now = new Date()): Promise<void> {
    const session = getDriver().session();
    try {
      await session.run(`MATCH (a:LessonAttendanceAudit {actorRole: 'admin', subject: 'tutor'})
        MATCH (b:Booking) WHERE b.bookingId = a.bookingId SET b.attendanceSource = 'admin'`);
      await session.run(
        `MATCH (b:Booking {status: 'confirmed', attendanceTutor: 'present'})-[:BOOKS]->(:TimeSlot {status: 'booked'})
         WHERE b.roomEntryPolicyActivatedAt IS NULL
           AND b.slotDateTime >= datetime($eligibleAfter)
         SET b.roomEntryPolicyActivatedAt = datetime($activatedAt)`,
        {
          eligibleAfter: new Date(now.getTime() + NORMAL_DEADLINE_MINUTES * 60_000).toISOString(),
          activatedAt: now.toISOString()
        }
      );
    } finally {
      await session.close();
    }
  }

  async markTutorRoomEntry(bookingId: string, tutorId: string, now = new Date()): Promise<boolean> {
    const session = getDriver().session();
    try {
      const entered = await session.executeWrite(async tx => {
        const match = await tx.run(
          `MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})-[:BOOKS]->(:TimeSlot {status: 'booked'})
           WHERE b.status IN ['confirmed', 'completed']
           RETURN b.slotDateTime AS startsAt, b.durationMinutes AS duration, b.tutorRoomEnteredAt AS enteredAt, b.attendanceSource AS source`,
          { bookingId, tutorId }
        );
        const record = match.records[0];
        if (!record) return false;
        const startsAt = record.get('startsAt')?.toStandardDate?.().getTime();
        if (!Number.isFinite(startsAt)) return false;
        const joinedAt = now.getTime();
        const enteredAt = record.get('enteredAt')?.toStandardDate?.().getTime() ?? joinedAt;
        await tx.run(
          `MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
           SET b.tutorRoomEnteredAt = coalesce(b.tutorRoomEnteredAt, datetime($enteredAt)),
               b.tutorRoomAttendedAt = CASE WHEN $onTime THEN coalesce(b.tutorRoomAttendedAt, datetime($joinedAt)) ELSE b.tutorRoomAttendedAt END`,
          {
            bookingId, tutorId, enteredAt: new Date(enteredAt).toISOString(),
            joinedAt: now.toISOString(),
            onTime: joinedAt >= startsAt && joinedAt < startsAt + (Number(record.get('duration')) || 25) * 60_000
          }
        );
        if (joinedAt >= startsAt && joinedAt < startsAt + (Number(record.get('duration')) || 25) * 60_000 && record.get('source') !== 'admin') {
          await this.confirmTutorRoomPresence(tx, bookingId, tutorId, now);
        }
        return true;
      });
      if (entered) await this.checkAndApplyAutoBlock(tutorId, true);
      return entered;
    } finally {
      await session.close();
    }
  }

  private async confirmTutorRoomPresence(tx: ManagedTransaction, bookingId: string, tutorId: string, now: Date) {
    await tx.run(`MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
      WHERE b.status <> 'cancelled' AND coalesce(b.attendanceSource, '') <> 'admin'
      WITH b, b.penaltyCode AS previousPenalty
      SET b.attendanceTutor = 'present', b.attendanceSource = 'classroom', b.tutorAttendancePolicyVersion = 2,
        b.roomEntryCheckCompletedAt = datetime($now), b.lessonOutcome = 'attended', b.attendanceStatus = 'present', b.updatedAt = datetime($now),
        b.penaltyCode = CASE WHEN previousPenalty = '301' THEN null ELSE b.penaltyCode END,
        b.penaltyReason = CASE WHEN previousPenalty = '301' THEN null ELSE b.penaltyReason END,
        b.penaltyTimestamp = CASE WHEN previousPenalty = '301' THEN null ELSE b.penaltyTimestamp END
      WITH b OPTIONAL MATCH (p:Penalty {tutorId: $tutorId, bookingId: $bookingId, penaltyCode: '301'})
      SET p.status = 'voided', p.revokedAt = $now, p.revocationReason = 'Verified classroom presence during scheduled lesson'`,
      { bookingId, tutorId, now: now.toISOString() });
  }

  async canStudentJoinRoom(bookingId: string, studentId: string): Promise<boolean> {
    const session = getDriver().session();
    try {
      const result = await session.run(
        `MATCH (b:Booking {bookingId: $bookingId, studentId: $studentId})
         -[:BOOKS]->(:TimeSlot {status: 'booked'})
         WHERE b.status IN ['confirmed', 'completed']
         RETURN b.bookingId AS bookingId LIMIT 1`,
        { bookingId, studentId }
      );
      return result.records.length > 0;
    } finally {
      await session.close();
    }
  }

  async getClassroomSchedule(bookingId: string, userId: string, role: 'student' | 'tutor') {
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (b:Booking {bookingId: $bookingId})
        -[:BOOKS]->(:TimeSlot {status: 'booked'})
        WHERE b.status IN ['confirmed', 'completed'] AND
          (($role = 'tutor' AND b.tutorId = $userId) OR ($role = 'student' AND b.studentId = $userId))
        RETURN b.slotDateTime AS startsAt, b.durationMinutes AS duration`, { bookingId, userId, role });
      const record = result.records[0];
      if (!record) return null;
      const startsAt = record.get('startsAt')?.toStandardDate?.().getTime();
      if (!Number.isFinite(startsAt)) return null;
      return { startsAt, endsAt: startsAt + (Number(record.get('duration')) || 25) * 60_000 };
    } finally { await session.close(); }
  }

  async reconcileMissedTutorRoomEntry(
    now = new Date(),
    hasEnteredForLesson = (bookingId: string, tutorId: string, start: Date, deadline: Date) =>
      classroomActivityService.hasTutorEnteredForLesson(bookingId, tutorId, start, deadline),
    tutorScope?: string
  ): Promise<number> {
    // A simulated future clock must never sweep unrelated real bookings.
    if (now.getTime() > Date.now() + 1000 && !tutorScope) {
      throw new Error('Future attendance reconciliation requires an explicit tutor scope');
    }
    const session = getDriver().session();
    let missed = 0;
    try {
      const candidates = await session.run(
        `MATCH (b:Booking)-[:BOOKS]->(:TimeSlot {status: 'booked'})
         WHERE b.status IN ['confirmed', 'completed']
           AND ($tutorScope IS NULL OR b.tutorId = $tutorScope)
           AND coalesce(b.attendanceSource, '') <> 'admin'
           AND coalesce(b.tutorAttendancePolicyVersion, 0) <> 2
           AND (b.roomEntryPolicyActivatedAt IS NOT NULL OR b.attendanceAutoEnforce = true
             OR b.tutorRoomEnteredAt IS NOT NULL OR b.tutorRoomAttendedAt IS NOT NULL)
           AND b.slotDateTime <= datetime($through)
         RETURN b.bookingId AS bookingId, b.tutorId AS tutorId, b.slotDateTime AS startsAt,
           b.durationMinutes AS duration, b.tutorRoomAttendedAt AS attendedAt, b.tutorRoomEnteredAt AS enteredAt
         ORDER BY b.slotDateTime ASC`,
        { through: now.toISOString(), tutorScope: tutorScope || null }
      );
      for (const record of candidates.records) {
        const bookingId = record.get('bookingId') as string;
        const tutorId = record.get('tutorId') as string;
        const startMs = record.get('startsAt')?.toStandardDate?.().getTime();
        if (!Number.isFinite(startMs)) continue;
        const endMs = startMs + (Number(record.get('duration')) || 25) * 60_000;
        const proofMs = record.get('attendedAt')?.toStandardDate?.().getTime() ?? record.get('enteredAt')?.toStandardDate?.().getTime();
        const deadline = new Date(Math.min(endMs - 1, now.getTime()));
        if ((proofMs >= startMs && proofMs < endMs) || await hasEnteredForLesson(bookingId, tutorId, new Date(startMs), deadline)) {
          await session.executeWrite(tx => this.confirmTutorRoomPresence(tx, bookingId, tutorId, now));
          await this.checkAndApplyAutoBlock(tutorId, true);
          continue;
        }
        if (now.getTime() < endMs) continue;

        const applied = await session.executeWrite(async tx => {
          const first = await tx.run(
            `MATCH (t:User {id: $tutorId})
             MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})-[:BOOKS]->(:TimeSlot {status: 'booked'})
             WHERE b.status IN ['confirmed', 'completed'] AND coalesce(b.attendanceSource, '') <> 'admin'
               AND b.slotDateTime = datetime($startsAt)
               AND coalesce(b.durationMinutes, 25) = $duration
               AND coalesce(b.tutorAttendancePolicyVersion, 0) <> 2
               AND b.tutorRoomAttendedAt IS NULL
             SET b.attendanceTutor = 'absent', b.attendanceSource = 'automatic_room_no_show',
                 b.tutorAttendancePolicyVersion = 2, b.lessonOutcome = 'tutor_absent', b.attendanceStatus = 'absent',
                 b.penaltyCode = '301', b.penaltyReason = $reason,
                 b.penaltyTimestamp = datetime($now), b.roomEntryCheckCompletedAt = datetime($now),
                 b.updatedAt = datetime($now)
             MERGE (p:Penalty {tutorId: $tutorId, bookingId: $bookingId, penaltyCode: '301'})
             ON CREATE SET p.penaltyId = $penaltyId, p.penaltyReason = $reason,
                           p.severity = 'critical', p.affectsCompensation = true,
                           p.createdAt = datetime($now)
             MERGE (t)-[:HAS_PENALTY]->(p)
             RETURN b.bookingId AS bookingId`,
            {
              bookingId, tutorId, now: now.toISOString(), startsAt: new Date(startMs).toISOString(),
              duration: Number(record.get('duration')) || 25,
              penaltyId: nanoid(16),
              reason: 'Tutor did not enter the classroom during the scheduled lesson'
            }
          );
          if (!first.records.length) return false;

          return true;
        });
        if (applied) {
          missed++;
          await this.checkAndApplyAutoBlock(tutorId);
        }
      }
      return missed;
    } finally {
      await session.close();
    }
  }

  async repairPrematureTutorRoomAbsence(tutorScope?: string): Promise<number> {
    const now = new Date().toISOString();
    const session = getDriver().session();
    let repaired = 0;
    try {
      const candidates = await session.run(`MATCH (b:Booking)-[:BOOKS]->(:TimeSlot {status: 'booked'})
        WHERE b.status = 'confirmed' AND b.slotDateTime > datetime($now)
          AND b.attendanceSource = 'automatic_room_no_show' AND b.penaltyCode = '301'
          AND ($tutorScope IS NULL OR b.tutorId = $tutorScope)
        RETURN b.bookingId AS bookingId, b.tutorId AS tutorId`, { now, tutorScope: tutorScope || null });
      for (const record of candidates.records) {
        const bookingId = record.get('bookingId') as string;
        const tutorId = record.get('tutorId') as string;
        const changed = await session.executeWrite(async tx => {
          const audits = await tx.run(`MATCH (a:LessonAttendanceAudit {bookingId: $bookingId, subject: 'tutor'})
            WHERE a.actorRole IN ['tutor', 'admin'] AND a.createdAt <= $now
            RETURN a.actorRole AS role, a.status AS status ORDER BY a.createdAt DESC LIMIT 1`, { bookingId, now });
          const audit = audits.records[0];
          if (audit?.get('role') === 'admin' || audit?.get('status') === 'absent') return false;
          const previous = audit?.get('status') === 'present' ? 'present' : null;
          const result = await tx.run(`MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
            WHERE b.status = 'confirmed' AND b.slotDateTime > datetime($now)
              AND b.attendanceSource = 'automatic_room_no_show' AND b.penaltyCode = '301'
            SET b.attendanceTutor = $previous, b.attendanceSource = $source, b.updatedAt = datetime($now)
            REMOVE b.tutorAttendancePolicyVersion, b.roomEntryCheckCompletedAt,
              b.lessonOutcome, b.attendanceStatus, b.penaltyCode, b.penaltyReason, b.penaltyTimestamp
            WITH b
            OPTIONAL MATCH (p:Penalty {bookingId: $bookingId, tutorId: $tutorId, penaltyCode: '301'})
            SET p.status = 'voided', p.revokedAt = $now,
              p.revocationReason = 'Automatic no-show assigned before the scheduled lesson'
            RETURN b.bookingId AS bookingId`, { bookingId, tutorId, now, previous, source: previous ? 'manual' : null });
          if (!result.records.length) return false;
          await tx.run(`CREATE (:LessonAttendanceAudit {id: $id, bookingId: $bookingId,
            actorRole: 'system', subject: 'tutor', previousStatus: 'absent', status: $status,
            reason: 'Reversed premature automatic no-show; scheduled lesson has not started', createdAt: $now})`,
            { id: nanoid(16), bookingId, status: previous || 'unset', now });
          return true;
        });
        if (changed) { repaired++; await this.checkAndApplyAutoBlock(tutorId, true); }
      }
      return repaired;
    } finally { await session.close(); }
  }

  async reconcileMissedTutorAttendance(now = new Date(), tutorScope?: string): Promise<number> {
    return this.reconcileMissedTutorRoomEntry(now, undefined, tutorScope);
  }

  async enableAutoAttendanceForUpcomingOpenSlots(now = new Date()): Promise<void> {
    const session = getDriver().session();
    try {
      const phtToday = new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
      const candidates = await session.run(
        `MATCH (s:TimeSlot)
         WHERE s.status IN ['open', 'pending'] AND s.attendanceAutoEnforce IS NULL
           AND s.slotDate >= $today
         RETURN s.slotId AS slotId, s.slotDate AS date, s.slotTime AS time`,
        { today: phtToday }
      );
      const eligibleIds = candidates.records.flatMap(record => {
        try {
          const startMs = attendanceStartMs({ date: record.get('date'), time: record.get('time') });
          return startMs - now.getTime() >= NORMAL_DEADLINE_MINUTES * 60_000
            ? [record.get('slotId') as string] : [];
        } catch {
          return [];
        }
      });
      if (eligibleIds.length) {
        await session.run(
          `UNWIND $slotIds AS slotId
           MATCH (s:TimeSlot {slotId: slotId})
           WHERE s.status IN ['open', 'pending'] AND s.attendanceAutoEnforce IS NULL
           SET s.attendanceAutoEnforce = true`,
          { slotIds: eligibleIds }
        );
      }
    } finally {
      await session.close();
    }
  }

  async reconcileMissedOpenSlotAttendance(now = new Date()): Promise<number> {
    const session = getDriver().session();
    let marked = 0;
    try {
      const candidates = await session.run(
        `MATCH (t:User)-[:OPENS_SLOT]->(s:TimeSlot)
         WHERE s.status IN ['open', 'pending'] AND s.attendanceAutoEnforce = true
           AND coalesce(s.attendanceMarked, '') <> 'present'
           AND s.slotDate <= $throughDate
         RETURN t.id AS tutorId, s.slotId AS slotId, s.slotDate AS date, s.slotTime AS time
         ORDER BY s.slotDate, s.slotTime`,
        { throughDate: new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10) }
      );

      for (const record of candidates.records) {
        const startMs = attendanceStartMs({ date: record.get('date'), time: record.get('time') });
        if (now.getTime() <= attendanceDeadlineMs(startMs)) continue;
        const tutorId = record.get('tutorId') as string;
        const slotId = record.get('slotId') as string;
        const applied = await session.executeWrite(async tx => {
          const result = await tx.run(
            `MATCH (t:User {id: $tutorId})-[:OPENS_SLOT]->(s:TimeSlot {slotId: $slotId})
             WHERE s.status IN ['open', 'pending'] AND s.attendanceAutoEnforce = true
               AND coalesce(s.attendanceMarked, '') <> 'present'
               AND datetime($now) > datetime($deadlineAt)
             SET s.status = 'available', s.penaltyCode = '302', s.penaltyReason = $reason,
                 s.attendanceMarked = 'absent', s.updatedAt = datetime()
             REMOVE s.pendingBy, s.pendingAt, s.pendingUntil, s.reservationId
             MERGE (p:Penalty {tutorId: $tutorId, slotId: $slotId, penaltyCode: '302'})
             ON CREATE SET p.penaltyId = $penaltyId, p.penaltyReason = $reason,
                           p.severity = 'high', p.affectsCompensation = true, p.createdAt = datetime()
             MERGE (t)-[:HAS_PENALTY]->(p)
             RETURN s.slotId AS slotId`,
            {
              tutorId, slotId, now: now.toISOString(),
              deadlineAt: new Date(attendanceDeadlineMs(startMs)).toISOString(),
              reason: 'Tutor did not confirm attendance for an open, unbooked slot before the 11-minute deadline',
              penaltyId: nanoid(16)
            }
          );
          return result.records.length > 0;
        });
        if (applied) marked++;
      }
      if (marked) await invalidateCache('tutor:search:*');
      return marked;
    } finally {
      await session.close();
    }
  }

  async markTutorAttendance(input: {
    tutorId: string;
    bookingIds: string[];
    slotIds: string[];
    status: 'present' | 'absent';
    reason?: AbsenceReason;
    additionalInfo?: string;
  }): Promise<void> {
    const { bookingIds, slotIds, tutorId, status, reason, additionalInfo } = input;
    if (status === 'absent') this.validateAbsenceDetails(reason, additionalInfo);
    const ids = [...bookingIds, ...slotIds];
    if (new Set(ids).size !== ids.length || ids.length < 1 || ids.length > 12) {
      throw new Error('Select 1 to 12 distinct attendance slots');
    }

    const session = getDriver().session();
    try {
      const changedBookedAttendance = await session.executeWrite(async tx => {
        let changedBooked = false;
        const slots: AttendanceSlotTime[] = [];
        const bookedAttendanceSlots: AttendanceSlotTime[] = [];
        const openAttendanceSlots: AttendanceSlotTime[] = [];
        const updates: Array<{ id: string; type: 'booking' | 'slot'; previous?: string }> = [];
        for (const bookingId of bookingIds) {
          const result = await tx.run(
            `MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})-[:BOOKS]->(s:TimeSlot)
             WHERE b.status IN ['confirmed', 'completed'] AND s.status = 'booked'
             RETURN s.slotDate AS date, s.slotTime AS time,
                    b.attendanceTutor AS previous, b.bookedAt AS bookedAt,
                    b.attendancePolicyActivatedAt AS activatedAt`,
            { bookingId, tutorId }
          );
          if (result.records.length !== 1) throw new Error('Booked lesson not found for this tutor');
          const record = result.records[0]!;
          const attendanceSlot = {
            date: record.get('date'), time: record.get('time'),
            bookedAtMs: Math.max(
              record.get('bookedAt')?.toStandardDate?.().getTime() ?? 0,
              record.get('activatedAt')?.toStandardDate?.().getTime() ?? 0
            ) || undefined
          };
          slots.push(attendanceSlot);
          bookedAttendanceSlots.push(attendanceSlot);
          updates.push({ id: bookingId, type: 'booking', previous: record.get('previous') });
        }
        for (const slotId of slotIds) {
          const result = await tx.run(
            `MATCH (s:TimeSlot {slotId: $slotId, tutorId: $tutorId})
             WHERE s.status IN ['open', 'pending']
             RETURN s.slotDate AS date, s.slotTime AS time, s.attendanceMarked AS previous,
                    s.status AS slotStatus, s.pendingUntil AS pendingUntil, s.pendingAt AS pendingAt`,
            { slotId, tutorId }
          );
          if (result.records.length !== 1) throw new Error('Open slot not found for this tutor');
          const record = result.records[0]!;
          if (status === 'absent' && record.get('slotStatus') === 'pending') {
            const expiry = record.get('pendingUntil')?.toStandardDate?.().getTime() ??
              (record.get('pendingAt')?.toStandardDate?.().getTime() ?? 0) + CHECKOUT_HOLD_MINUTES * 60_000;
            if (expiry > Date.now()) {
              throw new Error('A checkout is in progress; wait for it to finish before marking this slot absent');
            }
          }
          const attendanceSlot = { date: record.get('date'), time: record.get('time') };
          slots.push(attendanceSlot);
          openAttendanceSlots.push(attendanceSlot);
          updates.push({ id: slotId, type: 'slot', previous: record.get('previous') });
        }
        const presentSlots: AttendanceSlotTime[] = [];
        if (status === 'present') {
          const dates = [...new Set(slots.map(slot => slot.date))];
          for (const date of dates) {
            const result = await tx.run(
              `MATCH (s:TimeSlot {tutorId: $tutorId, slotDate: $date})
               OPTIONAL MATCH (b:Booking)-[:BOOKS]->(s)
               WHERE (s.status IN ['open', 'pending'] AND s.attendanceMarked = 'present')
                  OR (s.status = 'booked' AND b.tutorId = $tutorId
                      AND b.status IN ['confirmed', 'completed'] AND b.attendanceTutor = 'present')
               RETURN s.slotTime AS time, s.status AS slotStatus,
                      s.attendanceMarked AS slotAttendance, b.attendanceTutor AS bookingAttendance,
                      b.bookedAt AS bookedAt, b.attendancePolicyActivatedAt AS activatedAt`,
              { tutorId, date }
            );
            for (const record of result.records) {
              const marked = record.get('slotStatus') !== 'booked'
                ? record.get('slotAttendance') : record.get('bookingAttendance');
              if (marked !== 'present') continue;
              presentSlots.push({
                date, time: record.get('time'),
                bookedAtMs: record.get('slotStatus') === 'booked' ? Math.max(
                  record.get('bookedAt')?.toStandardDate?.().getTime() ?? 0,
                  record.get('activatedAt')?.toStandardDate?.().getTime() ?? 0
                ) || undefined : undefined
              });
            }
          }
        }
        if (status === 'present') {
          validateAttendanceWithPresentNeighbors(slots, presentSlots, status);
        } else {
          if (bookedAttendanceSlots.length) validateAttendanceWindow(bookedAttendanceSlots);
          openAttendanceSlots.forEach(slot => validateAbsenceTime(attendanceStartMs(slot), Date.now()));
        }

        for (const update of updates) {
          if (update.type === 'booking') {
            await tx.run(
              `MATCH (b:Booking {bookingId: $id, tutorId: $tutorId})
               SET b.attendanceTutor = $status, b.attendanceSource = 'manual',
                   b.roomEntryPolicyActivatedAt = CASE WHEN $status = 'present'
                     THEN coalesce(b.roomEntryPolicyActivatedAt, datetime())
                     ELSE b.roomEntryPolicyActivatedAt END,
                   b.absenceReason = $reason, b.absenceAdditionalInfo = $additionalInfo,
                   b.updatedAt = datetime()`,
              {
                id: update.id, tutorId, status,
                reason: status === 'absent' ? reason : null,
                additionalInfo: status === 'absent' ? additionalInfo?.trim() || null : null
              }
            );
            if (status !== update.previous) await tx.run(`CREATE (:LessonAttendanceAudit {id: $id, bookingId: $bookingId,
              actorId: $tutorId, actorRole: 'tutor', subject: 'tutor', previousStatus: $previous, status: $status,
              reason: $reason, createdAt: $now})`, { id: nanoid(16), bookingId: update.id, tutorId, previous: update.previous || 'unset',
                status, reason: status === 'absent' ? `${reason}${additionalInfo ? `: ${additionalInfo}` : ''}` : 'Tutor schedule attendance confirmation', now: new Date().toISOString() });
            if (status === 'absent' && update.previous !== 'absent') {
              const result = await tx.run(
                `MATCH (t:User {id: $tutorId})
                 MATCH (b:Booking {bookingId: $id, tutorId: $tutorId})
                 SET b.penaltyCode = '301', b.penaltyReason = $penaltyReason, b.penaltyTimestamp = datetime()
                 MERGE (p:Penalty {tutorId: $tutorId, bookingId: $id, penaltyCode: '301'})
                 ON CREATE SET p.penaltyId = $penaltyId, p.penaltyReason = $penaltyReason,
                               p.severity = 'critical', p.affectsCompensation = true, p.createdAt = datetime()
                 SET p.absenceReason = $reason, p.additionalInfo = $additionalInfo
                 MERGE (t)-[:HAS_PENALTY]->(p)
                 RETURN p.penaltyId AS penaltyId`,
                {
                  id: update.id, tutorId, penaltyId: nanoid(16),
                  penaltyReason: `Tutor marked absent for booked session: ${reason}`,
                  reason, additionalInfo: additionalInfo?.trim() || null
                }
              );
              if (!result.records.length) throw new Error('Could not record TA-301 penalty');
              changedBooked = true;
            } else if (status === 'present' && update.previous === 'absent') {
              await tx.run(
                `MATCH (p:Penalty {tutorId: $tutorId, bookingId: $id, penaltyCode: '301'}) DETACH DELETE p`,
                { id: update.id, tutorId }
              );
              await tx.run(
                `MATCH (b:Booking {bookingId: $id, tutorId: $tutorId})
                 WHERE b.penaltyCode = '301'
                 REMOVE b.penaltyCode, b.penaltyReason, b.penaltyTimestamp`,
                { id: update.id, tutorId }
              );
              changedBooked = true;
            }
          } else if (status === 'absent') {
            await this.cancelOpenSlot(tx, tutorId, update.id, reason!, additionalInfo);
          } else {
            await tx.run(
              `MATCH (s:TimeSlot {slotId: $id, tutorId: $tutorId})
               SET s.attendanceMarked = $status, s.attendanceSource = 'manual',
                   s.updatedAt = datetime()`,
              { id: update.id, tutorId, status }
            );
            if (update.previous === 'absent') {
              await tx.run(
                `MATCH (p:Penalty {tutorId: $tutorId, slotId: $id, penaltyCode: '302'}) DETACH DELETE p`,
                { id: update.id, tutorId }
              );
            }
          }
        }
        return changedBooked;
      });
      if (changedBookedAttendance) await this.checkAndApplyAutoBlock(tutorId, true);
    } finally {
      await session.close();
    }
  }

  async markAttendance(input: MarkAttendanceInput): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      if (input.bookingId) {
        if (input.role === 'student') {
          await new ClassroomNotesService().setStudentAttendance(input.bookingId, input.tutorId, input.status, 'Tutor schedule attendance correction');
        }
        // Mark attendance for booked session
        const attendanceResult = await session.run(
          input.role === 'student' ? 'MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId}) RETURN b' : `
          MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
          WITH b, b.${input.role === 'tutor' ? 'attendanceTutor' : 'attendanceStudent'} AS previous
          SET b.${input.role === 'tutor' ? 'attendanceTutor' : 'attendanceStudent'} = $status,
              b.updatedAt = datetime()
          FOREACH (ignored IN CASE WHEN $role = 'tutor' AND coalesce(previous, '') <> $status THEN [1] ELSE [] END |
            CREATE (:LessonAttendanceAudit {id: $auditId, bookingId: $bookingId, actorId: $tutorId, actorRole: 'tutor',
              subject: 'tutor', previousStatus: coalesce(previous, 'unset'), status: $status, reason: 'Tutor schedule attendance confirmation', createdAt: $now}))
          RETURN b
          `,
          { bookingId: input.bookingId, tutorId: input.tutorId, status: input.status, role: input.role, auditId: nanoid(16), now: new Date().toISOString() }
        );
        if (!attendanceResult.records.length) throw new Error('Booking not found for tutor');
        
        // Check if both attendances marked and auto-assign penalties if needed
        const result = await session.run(
          `
          MATCH (b:Booking {bookingId: $bookingId})
          RETURN b
          `,
          { bookingId: input.bookingId }
        );
        
        const booking = result.records[0]?.get('b').properties;
        
        // If tutor marked absent and it's a booked slot -> TA-301
        if (booking.attendanceTutor === 'absent') {
          await this.assignPenalty({
            tutorId: booking.tutorId,
            bookingId: input.bookingId,
            penaltyCode: '301',
            reason: 'Tutor marked absent for booked session'
          });
        }
        
        // If student marked absent -> STU-502
        if (booking.attendanceStudent === 'absent') {
          await this.assignPenalty({
            tutorId: booking.tutorId,
            bookingId: input.bookingId,
            penaltyCode: '502',
            reason: 'Student did not attend booked session'
          });
        }
      } else if (input.slotId) {
        // Mark attendance for open (unbooked) slot
        await session.run(
          `
          MATCH (s:TimeSlot {slotId: $slotId})
          SET s.attendanceMarked = $status,
              s.updatedAt = datetime()
          `,
          { slotId: input.slotId, status: input.status }
        );
        
        // If tutor marked absent for open slot -> TA-302
        if (input.status === 'absent') {
          await this.assignPenalty({
            tutorId: input.tutorId,
            slotId: input.slotId,
            penaltyCode: '302',
            reason: 'Tutor marked absent for open (unbooked) slot'
          });
        }
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Assign penalty code to tutor
   */
  async assignPenalty(params: {
    tutorId: string;
    bookingId?: string;
    slotId?: string;
    penaltyCode: string;
    reason: string;
  }): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const penaltyId = nanoid(16);
      const penaltyInfo = PENALTY_CODE_DETAILS[params.penaltyCode as keyof typeof PENALTY_CODE_DETAILS];
      
      // Create penalty node
      await session.run(
        `
        MATCH (t:User {id: $tutorId})
        CREATE (p:Penalty {
          penaltyId: $penaltyId,
          tutorId: $tutorId,
          bookingId: $bookingId,
          slotId: $slotId,
          penaltyCode: $penaltyCode,
          penaltyReason: $reason,
          severity: $severity,
          affectsCompensation: $affectsCompensation,
          createdAt: datetime()
        })
        CREATE (t)-[:HAS_PENALTY]->(p)
        `,
        {
          tutorId: params.tutorId,
          penaltyId,
          bookingId: params.bookingId || null,
          slotId: params.slotId || null,
          penaltyCode: params.penaltyCode,
          reason: params.reason,
          severity: penaltyInfo?.severity || 'medium',
          affectsCompensation: penaltyInfo?.affectsCompensation || false
        }
      );
      
      // If booking penalty, update booking record
      if (params.bookingId) {
        await session.run(
          `
          MATCH (b:Booking {bookingId: $bookingId})
          SET b.penaltyCode = $penaltyCode,
              b.penaltyReason = $reason,
              b.penaltyTimestamp = datetime()
          `,
          {
            bookingId: params.bookingId,
            penaltyCode: params.penaltyCode,
            reason: params.reason
          }
        );
      }
      
      // Check if tutor should be auto-blocked (3+ TA-301 in 30 days)
      if (params.penaltyCode === '301') {
        await this.checkAndApplyAutoBlock(params.tutorId);
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Check if tutor should be auto-blocked based on penalty count
   */
  private async checkAndApplyAutoBlock(tutorId: string, clearInvalidBlock = false): Promise<void> {
    const session = getDriver().session();
    try {
      await session.executeWrite(tx => reconcileTutorPenaltyBlock(tx, tutorId, clearInvalidBlock));
    } finally {
      await session.close();
    }
  }

  /**
   * Get penalty summary for tutor
   */
  async getPenaltySummary(tutorId: string): Promise<PenaltySummary> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Get penalty counts
      const result = await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:HAS_PENALTY]->(p:Penalty)
        WHERE p.createdAt >= datetime($since)
          AND p.revokedAt IS NULL AND coalesce(p.status, '') <> 'voided'
        RETURN p.penaltyCode as code, count(*) as count
        `,
        { tutorId, since: firstOfMonth.toISOString() }
      );
      
      const thisMonth = { ta301: 0, ta302: 0, ta303: 0, total: 0 };
      
      for (const record of result.records) {
        const code = record.get('code');
        const count = record.get('count').toNumber();
        thisMonth.total += count;
        if (code === '301') thisMonth.ta301 = count;
        if (code === '302') thisMonth.ta302 = count;
        if (code === '303') thisMonth.ta303 = count;
      }
      
      // Get last 30 days
      const result30 = await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:HAS_PENALTY]->(p:Penalty)
        WHERE p.createdAt >= datetime($since)
          AND p.revokedAt IS NULL AND coalesce(p.status, '') <> 'voided'
        RETURN p.penaltyCode as code, count(*) as count
        `,
        { tutorId, since: thirtyDaysAgo.toISOString() }
      );
      
      const last30Days = { ta301: 0, ta302: 0, ta303: 0, total: 0 };
      
      for (const record of result30.records) {
        const code = record.get('code');
        const count = record.get('count').toNumber();
        last30Days.total += count;
        if (code === '301') last30Days.ta301 = count;
        if (code === '302') last30Days.ta302 = count;
        if (code === '303') last30Days.ta303 = count;
      }
      
      const schedulingBlock = await this.getSchedulingBlock(tutorId);
      
      // Get recent penalties
      const recentResult = await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:HAS_PENALTY]->(p:Penalty)
        RETURN p
        ORDER BY p.createdAt DESC
        LIMIT 10
        `,
        { tutorId }
      );
      
      const recentPenalties = recentResult.records.map(r => r.get('p').properties);
      
      return {
        tutorId,
        thisMonth,
        last30Days,
        activeBlock: schedulingBlock.active,
        blockExpiresAt: schedulingBlock.expiresAt ? new Date(schedulingBlock.expiresAt) : undefined,
        recentPenalties
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Save weekly template for recurring schedule
   */
  async saveWeeklyTemplate(input: SaveTemplateInput): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // Delete existing templates
      await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:HAS_TEMPLATE]->(template:ScheduleTemplate)
        DETACH DELETE template
        `,
        { tutorId: input.tutorId }
      );
      
      // Create new templates
      for (const slot of input.schedule) {
        await session.run(
          `
          MATCH (t:User {id: $tutorId})
          CREATE (template:ScheduleTemplate {
            templateId: $templateId,
            tutorId: $tutorId,
            dayOfWeek: $dayOfWeek,
            slotTime: $slotTime,
            isActive: true,
            createdAt: datetime()
          })
          CREATE (t)-[:HAS_TEMPLATE]->(template)
          `,
          {
            tutorId: input.tutorId,
            templateId: nanoid(16),
            dayOfWeek: slot.dayOfWeek,
            slotTime: slot.time
          }
        );
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Apply weekly template to date range
   */
  async applyTemplate(input: ApplyTemplateInput): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // Get template
      const result = await session.run(
        `
        MATCH (t:User {id: $tutorId})-[:HAS_TEMPLATE]->(template:ScheduleTemplate)
        WHERE template.isActive = true
        RETURN template
        `,
        { tutorId: input.tutorId }
      );
      
      const templates = result.records.map(r => r.get('template').properties);
      
      if (templates.length === 0) {
        throw new Error('No active template found for tutor');
      }
      
      // Generate slots from template
      const startDate = new Date(input.startDate);
      const endDate = new Date(input.endDate);
      const slots: Array<{ date: string; time: string }> = [];
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        
        for (const template of templates) {
          if (template.dayOfWeek === dayOfWeek) {
            slots.push({
              date: d.toISOString().split('T')[0] || '',
              time: template.slotTime
            });
          }
        }
      }
      
      if (slots.length > 0) {
        await this.openSlots({ tutorId: input.tutorId, slots });
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Get student's bookings
   */
  async getStudentBookings(studentId: string): Promise<Array<{
    bookingId: string;
    tutorId: string;
    tutorName: string;
    tutorAvatar?: string;
    slotDate: string;
    slotTime: string;
    durationMinutes: number;
    status: string;
    attendanceTutor?: string;
    attendanceStudent?: string;
    bookedAt: Date;
  }>> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(s:Student {id: $studentId})
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        MATCH (slot)-[:OPENS_SLOT]-(tutor:User)
        WHERE b.status IN ['confirmed', 'completed']
        RETURN b, slot, tutor
        ORDER BY slot.slotDate DESC, slot.slotTime DESC
        `,
        { studentId }
      );
      
      return result.records.map(record => {
        const booking = record.get('b').properties;
        const slot = record.get('slot').properties;
        const tutor = record.get('tutor').properties;
        const tutorFirstName = tutor.firstName || tutor.givenName || '';
        const tutorLastName = tutor.lastName || tutor.familyName || '';
        const tutorName = `${tutorFirstName} ${tutorLastName}`.trim() || 'Tutor';
        
        return {
          bookingId: booking.bookingId,
          tutorId: tutor.userId || tutor.id,
          tutorName,
          tutorAvatar: tutor.profilePicture,
          slotDate: slot.slotDate,
          slotTime: slot.slotTime,
          durationMinutes: parseInt(slot.durationMinutes) || 30,
          status: booking.status,
          paymentMethod: booking.paymentMethod || 'erc1155',
          attendanceTutor: booking.attendanceTutor,
          attendanceStudent: booking.attendanceStudent,
          bookedAt: new Date(booking.bookedAt)
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Get student statistics for dashboard
   */
  async getStudentStats(studentId: string): Promise<{
    lessonsCompleted: number;
    upcomingLessons: number;
    totalHours: number;
    nextLesson?: {
      tutorName: string;
      tutorAvatar?: string;
      slotDate: string;
      slotTime: string;
      bookingId: string;
    };
  }> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const now = new Date();
      
      // Get completed lessons count
      const completedResult = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(s:Student {id: $studentId})
        WHERE b.status = 'completed' AND COALESCE(b.lessonOutcome, 'attended') = 'attended'
          AND coalesce(b.attendanceStudent, '') <> 'absent'
        RETURN count(b) as completedCount
        `,
        { studentId }
      );
      
      // Get upcoming lessons - filter by date in application code since slotTime is in 12-hour format
      const upcomingResult = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(s:Student {id: $studentId})
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        MATCH (slot)-[:OPENS_SLOT]-(tutor:User)
        WHERE b.status = 'confirmed'
        RETURN b.bookingId as bookingId,
               tutor.firstName as tutorFirstName,
               tutor.lastName as tutorLastName,
               tutor.givenName as tutorGivenName,
               tutor.familyName as tutorFamilyName,
               tutor.profilePicture as tutorAvatar,
               slot.slotDate as slotDate,
               slot.slotTime as slotTime
        ORDER BY slot.slotDate ASC, slot.slotTime ASC
        `,
        { studentId }
      );
      
      // Get total hours from completed lessons
      const hoursResult = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(s:Student {id: $studentId})
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        WHERE b.status = 'completed' AND COALESCE(b.lessonOutcome, 'attended') = 'attended'
          AND coalesce(b.attendanceStudent, '') <> 'absent'
        RETURN sum(slot.durationMinutes) as totalMinutes
        `,
        { studentId }
      );
      
      const completedCount = completedResult.records[0]?.get('completedCount')?.toNumber() || 0;
      
      // Filter future lessons in application code and get count + next lesson
      const futureBookings = upcomingResult.records
        .map(record => {
          const slotDate = record.get('slotDate');
          const slotTime = record.get('slotTime');
          
          let hours: number;
          let minutes: number;
          
          // Try 12-hour format first (e.g., "6:00 PM")
          const time12Match = slotTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
          if (time12Match) {
            hours = parseInt(time12Match[1]);
            minutes = parseInt(time12Match[2]);
            const meridiem = time12Match[3].toUpperCase();
            
            // Convert to 24-hour format
            if (meridiem === 'PM' && hours !== 12) {
              hours += 12;
            } else if (meridiem === 'AM' && hours === 12) {
              hours = 0;
            }
          } else {
            // Try 24-hour format (e.g., "23:30")
            const time24Match = slotTime.match(/^(\d{1,2}):(\d{2})$/);
            if (time24Match) {
              hours = parseInt(time24Match[1]);
              minutes = parseInt(time24Match[2]);
            } else {
              return null;
            }
          }
          
          // Parse as PHT (UTC+8) since slot times are stored in Philippine time
          const slotDateTime = new Date(`${slotDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`);
          
          // Include lessons that haven't ended yet (start time + 25 min duration)
          const LESSON_DURATION_MS = 25 * 60 * 1000;
          const lessonEndTime = new Date(slotDateTime.getTime() + LESSON_DURATION_MS);
          
          if (isNaN(slotDateTime.getTime()) || now >= lessonEndTime) {
            return null;
          }
          
          return {
            bookingId: record.get('bookingId'),
            tutorFirstName: record.get('tutorFirstName'),
            tutorLastName: record.get('tutorLastName'),
            tutorGivenName: record.get('tutorGivenName'),
            tutorFamilyName: record.get('tutorFamilyName'),
            tutorAvatar: record.get('tutorAvatar'),
            slotDate,
            slotTime,
            slotDateTime
          };
        })
        .filter(Boolean) as Array<{
          bookingId: string;
          tutorFirstName: string;
          tutorLastName: string;
          tutorGivenName: string;
          tutorFamilyName: string;
          tutorAvatar?: string;
          slotDate: string;
          slotTime: string;
          slotDateTime: Date;
        }>;
      
      const upcomingCount = futureBookings.length;
      const totalMinutes = hoursResult.records[0]?.get('totalMinutes')?.toNumber() || 0;
      const totalHours = Math.round((totalMinutes / 60) * 10) / 10; // Round to 1 decimal
      
      let nextLesson = undefined;
      if (futureBookings.length > 0) {
        // Sort by datetime and get the earliest
        futureBookings.sort((a, b) => a.slotDateTime.getTime() - b.slotDateTime.getTime());
        const next = futureBookings[0];
        
        if (next) {
          // Try firstName/lastName first (tutors), fall back to givenName/familyName (students)
          const firstName = next.tutorFirstName || next.tutorGivenName || '';
          const lastName = next.tutorLastName || next.tutorFamilyName || '';
          

          
          nextLesson = {
            tutorName: `${firstName} ${lastName}`.trim() || 'Tutor',
            tutorAvatar: next.tutorAvatar,
            slotDate: next.slotDate,
            slotTime: next.slotTime,
            bookingId: next.bookingId
          };
        }
      }
      
      const stats = {
        lessonsCompleted: completedCount,
        upcomingLessons: upcomingCount,
        totalHours,
        nextLesson
      };
      

      
      return stats;
    } finally {
      await session.close();
    }
  }

  /**
   * Get recent activity for student dashboard
   * Includes lesson bookings, completions, and ticket purchases
   */
  async getStudentRecentActivity(studentId: string, limit: number = 10): Promise<Array<{
    type: 'lesson_completed' | 'lesson_booked' | 'ticket_purchased';
    tutorName?: string;
    tutorAvatar?: string;
    date: string;
    action: string;
    bookingId?: string;
    slotDate?: string;
    purchaseId?: string;
    quantity?: number;
    ticketTier?: 'basic' | 'premium' | 'trial';
    timestamp: Date;
  }>> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // Ensure limit is an integer
      const limitInt = Math.floor(Number(limit)) || 10;
      
      
      // Get completed lessons and bookings
      const bookingsResult = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(s:Student {id: $studentId})
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        MATCH (slot)-[:OPENS_SLOT]-(tutor:User)
        WHERE b.status IN ['completed', 'confirmed']
        WITH b, slot, tutor,
             CASE 
               WHEN b.status = 'completed' THEN slot.slotDate + 'T' + slot.slotTime
               ELSE b.bookedAt
             END as sortTime
        RETURN b, slot, tutor, sortTime
        ORDER BY sortTime DESC
        LIMIT ${limitInt}
        `,
        { studentId }
      );
      
      // Get ticket purchases - try multiple ways to find purchases for this student:
      // 1. By userId property directly on the purchase
      // 2. By PURCHASED relationship from User node
      // 3. By PURCHASED relationship from Student node
      // 4. By buyerWallet matching student's wallet
      const purchasesResult = await session.run(
        `
        MATCH (p:TicketPurchase)
        WHERE p.status = 'completed' AND p.userId = $studentId
        RETURN p
        UNION
        MATCH (u:User {id: $studentId})-[:PURCHASED]->(p:TicketPurchase)
        WHERE p.status = 'completed'
        RETURN p
        UNION
        MATCH (s:Student {id: $studentId})-[:PURCHASED]->(p:TicketPurchase)
        WHERE p.status = 'completed'
        RETURN p
        UNION
        MATCH (s:Student {id: $studentId})
        MATCH (p:TicketPurchase)
        WHERE p.status = 'completed' AND toLower(p.buyerWallet) = toLower(s.walletAddress)
        RETURN p
        `,
        { studentId }
      );
      
      // Deduplicate and sort purchases (UNION may return duplicates in some cases)
      const purchaseMap = new Map();
      purchasesResult.records.forEach(record => {
        const p = record.get('p').properties;
        if (!purchaseMap.has(p.id)) {
          purchaseMap.set(p.id, p);
        }
      });
      const uniquePurchases = Array.from(purchaseMap.values())
        .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime())
        .slice(0, limitInt);
      
      
      // Map bookings to activities
      const bookingActivities = bookingsResult.records.map(record => {
        const booking = record.get('b').properties;
        const slot = record.get('slot').properties;
        const tutor = record.get('tutor').properties;
        
        // Try firstName/lastName first (tutors), fall back to givenName/familyName
        const tutorName = `${tutor.firstName || tutor.givenName || ''} ${tutor.lastName || tutor.familyName || ''}`.trim();
        const isCompleted = booking.status === 'completed';
        
        // For completed lessons, use slot date; for bookings, use bookedAt timestamp
        let activityDate: Date;
        if (isCompleted) {
          // Parse slotDate as a date (e.g., "2025-12-03")
          activityDate = new Date(slot.slotDate + 'T00:00:00');
        } else {
          // bookedAt is a Neo4j DateTime object, convert to JavaScript Date
          const bookedAtDateTime = booking.bookedAt;
          if (bookedAtDateTime && bookedAtDateTime.__isDateTime__) {
            activityDate = new Date(
              bookedAtDateTime.year.toInt(),
              bookedAtDateTime.month.toInt() - 1,
              bookedAtDateTime.day.toInt(),
              bookedAtDateTime.hour.toInt(),
              bookedAtDateTime.minute.toInt(),
              bookedAtDateTime.second.toInt()
            );
          } else {
            // Fallback if it's already a date string
            activityDate = new Date(booking.bookedAt);
          }
        }
        
        // Validate date
        if (isNaN(activityDate.getTime())) {
          console.error('Invalid date for activity:', { slotDate: slot.slotDate, bookedAt: booking.bookedAt });
          activityDate = new Date(); // fallback to now
        }
        
        return {
          type: (isCompleted ? 'lesson_completed' : 'lesson_booked') as 'lesson_completed' | 'lesson_booked' | 'ticket_purchased',
          tutorName,
          tutorAvatar: tutor.profilePicture,
          date: this.formatActivityDate(activityDate),
          action: isCompleted 
            ? 'Completed lesson' 
            : `Booked lesson for ${this.formatBookingDate(slot.slotDate)}`,
          bookingId: booking.bookingId,
          slotDate: slot.slotDate,
          timestamp: activityDate
        };
      });
      
      // Map purchases to activities
      const purchaseActivities = uniquePurchases.map(purchase => {
        // Parse purchase date
        let purchaseDate: Date;
        if (purchase.purchaseDate) {
          purchaseDate = new Date(purchase.purchaseDate);
        } else {
          purchaseDate = new Date();
        }
        
        // Validate date
        if (isNaN(purchaseDate.getTime())) {
          console.error('Invalid date for purchase:', { purchaseDate: purchase.purchaseDate });
          purchaseDate = new Date();
        }
        
        const quantity = typeof purchase.quantity === 'object' && purchase.quantity.toInt 
          ? purchase.quantity.toInt() 
          : (parseInt(purchase.quantity) || 1);
        
        const tier = purchase.tier as 'basic' | 'premium' | 'trial' || 'basic';
        const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
        
        return {
          type: 'ticket_purchased' as 'lesson_completed' | 'lesson_booked' | 'ticket_purchased',
          date: this.formatActivityDate(purchaseDate),
          action: `Purchased ${quantity} ${tierLabel} ticket${quantity > 1 ? 's' : ''}`,
          purchaseId: purchase.id,
          quantity,
          ticketTier: tier,
          timestamp: purchaseDate
        };
      });
      
      // Combine and sort all activities by timestamp (most recent first)
      const allActivities = [...bookingActivities, ...purchaseActivities]
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limitInt);
      
      return allActivities;
    } finally {
      await session.close();
    }
  }

  /**
   * Format date for activity display (e.g., "Nov 28", "Yesterday", "Today")
   */
  private formatActivityDate(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const activityDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (activityDate.getTime() === today.getTime()) {
      return 'Today';
    } else if (activityDate.getTime() === yesterday.getTime()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  /**
   * Format date for booking display (e.g., "Dec 3", "Tomorrow")
   */
  private formatBookingDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (slotDate.getTime() === today.getTime()) {
      return 'Today';
    } else if (slotDate.getTime() === tomorrow.getTime()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  /**
   * Get detailed lesson information by booking ID
   */
  async getLessonDetails(bookingId: string, studentId: string) {
    const session = getDriver().session();
    try {
      
      // Match Booking -> TimeSlot and derive tutor via OFFERS relationship
      // Use slotDateTime stored on Booking for date/time extraction
      const query = `
        MATCH (booking:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(student:Student {id: $studentId})
        OPTIONAL MATCH (booking)-[:BOOKS]->(slot:TimeSlot)
        OPTIONAL MATCH (slot)<-[:OFFERS]-(tutorRel)
        OPTIONAL MATCH (tutorDirect)
        WHERE tutorDirect.userId = booking.tutorId OR tutorDirect.id = booking.tutorId
        WITH booking, student,
             coalesce(tutorRel, tutorDirect) AS tutor
        RETURN 
          booking.bookingId AS bookingId,
          booking.status AS status,
          booking.paymentMethod AS paymentMethod,
          booking.bookedAt AS bookedAt,
          booking.slotDateTime AS slotDateTime,
          booking.durationMinutes AS durationMinutes,
          booking.surveyReadyAt AS surveyReadyAt,
          tutor.userId AS tutorUserId,
          tutor.id AS tutorId,
          COALESCE(tutor.firstName, tutor.givenName, '') AS tFirst,
          COALESCE(tutor.lastName, tutor.familyName, '') AS tLast,
          tutor.profilePicture AS tutorAvatar,
          tutor.bio AS tutorBio,
          tutor.hourlyRate AS hourlyRate
      `;

      const result = await session.run(query, { bookingId, studentId });

      if (result.records.length === 0) {
        // Fallback attempt: match tutor by booking.tutorId using WHERE
        const fallbackQuery = `
          MATCH (booking:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(student:Student {id: $studentId})
          MATCH (tutor:User)
          WHERE tutor.userId = booking.tutorId
          RETURN 
            booking.bookingId AS bookingId,
            booking.status AS status,
            booking.paymentMethod AS paymentMethod,
            booking.bookedAt AS bookedAt,
            booking.slotDateTime AS slotDateTime,
            booking.durationMinutes AS durationMinutes,
            booking.surveyReadyAt AS surveyReadyAt,
            tutor.userId AS tutorId,
            COALESCE(tutor.firstName, tutor.givenName, 'Tutor') + ' ' + 
            COALESCE(tutor.lastName, tutor.familyName, '') AS tutorName,
            tutor.profilePicture AS tutorAvatar,
            tutor.bio AS tutorBio,
            tutor.hourlyRate AS hourlyRate
        `;
        const fallbackResult = await session.run(fallbackQuery, { bookingId, studentId });
        if (fallbackResult.records.length > 0) {
          const fr = fallbackResult.records[0];

          // Extract slotDateTime
          const slotDateTime = fr?.get('slotDateTime');
          const year = slotDateTime.year.toInt();
          const month = String(slotDateTime.month.toInt()).padStart(2, '0');
          const day = String(slotDateTime.day.toInt()).padStart(2, '0');
          const hour = slotDateTime.hour.toInt();
          const minute = String(slotDateTime.minute.toInt()).padStart(2, '0');
          const period = hour >= 12 ? 'PM' : 'AM';
          const hour12 = hour % 12 || 12;
          const slotDate = `${year}-${month}-${day}`;
          const slotTime = `${hour12}:${minute} ${period}`;

          const lessonDetails = {
            bookingId: fr?.get('bookingId'),
            tutorId: fr?.get('tutorId'),
            tutorName: fr?.get('tutorName')?.trim?.() || fr?.get('tutorName'),
            tutorAvatar: fr?.get('tutorAvatar'),
            tutorBio: fr?.get('tutorBio'),
            hourlyRate: fr?.get('hourlyRate')?.toNumber?.() || fr?.get('hourlyRate'),
            slotDate,
            slotTime,
            durationMinutes: fr?.get('durationMinutes')?.toNumber?.() || fr?.get('durationMinutes'),
            status: fr?.get('status'),
            bookedAt: fr?.get('bookedAt'),
            surveyReadyAt: fr?.get('surveyReadyAt')?.toStandardDate?.().toISOString() || null,
            sessionId: bookingId
          };
          return lessonDetails;
        }
        
        // As a last resort, return booking-only details (tutor may be missing)
        const bookingOnly = {
          bookingId,
          tutorId: null,
          tutorName: null,
          tutorAvatar: null,
          tutorBio: null,
          hourlyRate: null,
          // Extract date/time from debug bookingProps above if present
          slotDate: undefined,
          slotTime: undefined,
          durationMinutes: undefined,
          status: undefined,
          bookedAt: undefined,
          surveyReadyAt: null,
          sessionId: bookingId
        };
        return bookingOnly;
      }

      const record = result.records[0]!;
      
      // Extract slotDateTime and convert to date and time strings
      const slotDateTime = record.get('slotDateTime');
      const year = slotDateTime.year.toInt();
      const month = String(slotDateTime.month.toInt()).padStart(2, '0');
      const day = String(slotDateTime.day.toInt()).padStart(2, '0');
      
      // The slotDateTime is stored in UTC, convert to Philippine time (UTC+8)
      let hour = slotDateTime.hour.toInt() + 8;
      if (hour >= 24) hour -= 24;
      
      const minute = String(slotDateTime.minute.toInt()).padStart(2, '0');
      
      // Format as date string (YYYY-MM-DD)
      const slotDate = `${year}-${month}-${day}`;
      
      // Format as 12-hour time string (H:MM AM/PM) in Philippine time
      const period = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      const slotTime = `${hour12}:${minute} ${period}`;
      
      const first = record.get('tFirst');
      const last = record.get('tLast');
      const derivedTutorName = `${(first || '').trim()} ${(last || '').trim()}`.trim() || 'Tutor';

      // Convert bookedAt DateTime to ISO string
      const bookedAtDateTime = record.get('bookedAt');
      let bookedAtISO = new Date().toISOString();
      if (bookedAtDateTime) {
        try {
          const bookedAtDate = new Date(
            bookedAtDateTime.year.toInt(),
            bookedAtDateTime.month.toInt() - 1,
            bookedAtDateTime.day.toInt(),
            bookedAtDateTime.hour.toInt(),
            bookedAtDateTime.minute.toInt(),
            bookedAtDateTime.second.toInt()
          );
          bookedAtISO = bookedAtDate.toISOString();
        } catch (e) {
          console.error('Error converting bookedAt:', e);
        }
      }

      const lessonDetails = {
        bookingId: record.get('bookingId'),
        tutorId: record.get('tutorUserId') || record.get('tutorId') || null,
        tutorName: derivedTutorName,
        startsAt: slotDateTime.toStandardDate().toISOString(),
        tutorAvatar: record.get('tutorAvatar'),
        tutorBio: record.get('tutorBio'),
        paymentMethod: record.get('paymentMethod') || 'erc1155',
        hourlyRate: record.get('hourlyRate')?.toNumber?.() || record.get('hourlyRate'),
        slotDate,
        slotTime,
        durationMinutes: record.get('durationMinutes')?.toNumber?.() || record.get('durationMinutes'),
        status: record.get('status'),
        bookedAt: bookedAtISO,
        surveyReadyAt: record.get('surveyReadyAt')?.toStandardDate?.().toISOString() || null,
        sessionId: bookingId // Use bookingId as sessionId for classroom
      };

      return lessonDetails;
    } catch (error) {
      console.error('Error getting lesson details:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get detailed lesson information by booking ID (Tutor perspective)
   */
  async getTutorLessonDetails(bookingId: string, tutorId: string) {
    const session = getDriver().session();
    try {
      // Query to get booking details with student information
      const query = `
        MATCH (booking:Booking {bookingId: $bookingId})
        WHERE booking.tutorId = $tutorId
        MATCH (booking)-[:BOOKED_BY]->(student)
        RETURN 
          booking.bookingId AS bookingId,
          booking.status AS status,
          booking.bookedAt AS bookedAt,
          booking.slotDateTime AS slotDateTime,
          booking.durationMinutes AS durationMinutes,
          student.id AS studentId,
          COALESCE(student.firstName, student.givenName, '') AS sFirst,
          COALESCE(student.lastName, student.familyName, '') AS sLast,
          student.profilePicture AS studentAvatar
      `;

      const result = await session.run(query, { bookingId, tutorId });

      if (result.records.length === 0) {
        throw new Error('Booking not found or you do not have access to this lesson');
      }

      const record = result.records[0]!;
      
      // Extract slotDateTime (stored as Neo4j DateTime)
      const slotDateTime = record.get('slotDateTime');
      if (!slotDateTime) {
        throw new Error('Booking missing schedule information');
      }

      // Neo4j stores DateTime in UTC, but we stored it with +08:00 (PHT) offset
      // So we need to add 8 hours to get back to PHT time
      let hour = slotDateTime.hour.toInt() + 8; // Convert UTC to PHT
      let day = slotDateTime.day.toInt();
      let month = slotDateTime.month.toInt();
      let year = slotDateTime.year.toInt();
      
      // Handle day/month/year rollover
      if (hour >= 24) {
        hour -= 24;
        // Create a date and add 1 day
        const tempDate = new Date(year, month - 1, day + 1);
        year = tempDate.getFullYear();
        month = tempDate.getMonth() + 1;
        day = tempDate.getDate();
      }
      
      const minute = String(slotDateTime.minute.toInt()).padStart(2, '0');
      const slotDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      // Format as 12-hour time string (H:MM AM/PM) in Philippine time
      const period = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      const slotTime = `${hour12}:${minute} ${period}`;
      
      const first = record.get('sFirst');
      const last = record.get('sLast');
      const studentName = `${(first || '').trim()} ${(last || '').trim()}`.trim() || 'Student';

      // Convert bookedAt DateTime to ISO string
      const bookedAtDateTime = record.get('bookedAt');
      let bookedAtISO = new Date().toISOString();
      if (bookedAtDateTime) {
        try {
          const bookedAtDate = new Date(
            bookedAtDateTime.year.toInt(),
            bookedAtDateTime.month.toInt() - 1,
            bookedAtDateTime.day.toInt(),
            bookedAtDateTime.hour.toInt(),
            bookedAtDateTime.minute.toInt(),
            bookedAtDateTime.second.toInt()
          );
          bookedAtISO = bookedAtDate.toISOString();
        } catch (e) {
          console.error('Error converting bookedAt:', e);
        }
      }

      const lessonDetails = {
        bookingId: record.get('bookingId'),
        studentId: record.get('studentId'),
        studentName,
        studentAvatar: record.get('studentAvatar'),
        slotDate,
        slotTime,
        durationMinutes: record.get('durationMinutes')?.toNumber?.() || record.get('durationMinutes'),
        status: record.get('status'),
        bookedAt: bookedAtISO,
        sessionId: bookingId // Use bookingId as sessionId for classroom
      };

      return lessonDetails;
    } catch (error) {
      console.error('Error getting tutor lesson details:', error);
      throw error;
    } finally {
      await session.close();
    }
  }
}
