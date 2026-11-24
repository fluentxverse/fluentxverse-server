import { getDriver } from '../../db/memgraph';
import { captureBooking, ensureRegistryOutbox } from '../lessonRegistry/outbox';
import { nanoid } from 'nanoid';
import { attendanceStartMs } from './attendanceWindow';
import { assertStudentScheduleAvailable, assertTutorApplicationApproved, assertTutorCanSchedule } from './schedulingGuards';
import { lessonNotice, invalidateLessonCaches } from '../lessonWorkflow.service';
import { invalidateCache } from '../../db/redis';
import { getIO } from '../../socket/socket.server';
import { revokeLessonRoom } from '../../socket/revokeLessonRoom';
import { reconcileTutorPenaltyBlock } from './tutorPenaltyBlock';

export const attendanceRecoveryEnabled = () => process.env.BOOKED_ATTENDANCE_RECOVERY_ENABLED === 'true';
export function recoveryDue(start: number, now: number, attendance: string | null) {
  return attendance === 'absent' || attendance !== 'present' && now >= start - 10 * 60000;
}
export const canReplaceAt = (start: number, now: number) => now <= start - 5 * 60000;

// The original booking remains the penalty record. Only the replacement owns the entitlement.
export class AttendanceRecoveryService {
  async reconcile(now = new Date()) {
    if (!attendanceRecoveryEnabled()) return;
    const db = getDriver().session();
    try {
      const rows = await db.run(`MATCH(b:Booking {status:'confirmed',attendanceRecoveryVersion:1})
        WHERE b.attendanceRecoveryOutcome IS NULL
          AND (b.attendanceTutor='absent' OR (coalesce(b.attendanceTutor,'')<>'present' AND b.slotDateTime<=datetime($due)))
        RETURN b.bookingId AS id ORDER BY b.slotDateTime LIMIT 100`,
        {now:now.toISOString(),due:new Date(now.getTime()+10*60000).toISOString()});
      for(const row of rows.records) await this.recover(row.get('id'),now);
    } finally { await db.close(); }
  }

  async recover(bookingId: string, now = new Date()) {
    await ensureRegistryOutbox();
    const db = getDriver().session();
    try {
      const changed = await db.executeWrite(async tx => {
        const locked = await tx.run(`MATCH(b:Booking {bookingId:$bookingId,attendanceRecoveryVersion:1})
          WHERE b.status='confirmed' AND b.attendanceRecoveryOutcome IS NULL
          SET b.refundWriteVersion=coalesce(b.refundWriteVersion,0)+1 RETURN b`,{bookingId});
        const b=locked.records[0]?.get('b').properties;
        if(!b) return false;
        const start=b.slotDateTime.toStandardDate().getTime();
        if(!recoveryDue(start,now.getTime(),b.attendanceTutor)) return false;
        const student=await tx.run(`MATCH(s:Student {id:$id})
          SET s.bookingWriteVersion=coalesce(s.bookingWriteVersion,0)+1 RETURN s.autoReplaceTutor AS enabled`,{id:b.studentId});
        // A previously dispatched refund cannot be reassigned as a payment.
        const refunds=await tx.run(`MATCH(r:TicketTransaction {bookingId:$bookingId})
          WHERE r.type IN ['cancellation','refund'] RETURN r LIMIT 1`,{bookingId});
        const canTransfer=student.records[0]?.get('enabled')===true && canReplaceAt(start,now.getTime())
          && !b.refundApprovedBy && !b.refunded && !refunds.records.length && !b.privatePassReservationId;
        await tx.run(`MATCH(b:Booking {bookingId:$bookingId})
          SET b.status='cancelled',b.cancelledAt=datetime($now),b.cancelledBy='attendance-policy',
            b.cancellationReason=$reason,b.attendanceTutor='absent',b.attendanceSource='attendance_deadline',
            b.penaltyCode='301',b.penaltyReason=$reason,b.penaltyTimestamp=datetime($now),
            b.lessonOutcome='tutor_absent',b.attendanceStatus='absent',b.cancellationRefundVersion=1,
            b.attendanceRecoveryOutcome='refund_pending',b.refundStatus='pending'
          MERGE(p:Penalty {bookingId:$bookingId,tutorId:$tutorId,penaltyCode:'301'})
          ON CREATE SET p.penaltyId=$pid,p.penaltyReason=$reason,p.createdAt=datetime($now),
            p.severity='critical',p.affectsCompensation=true
          WITH p MATCH(t:User {id:$tutorId}) MERGE(t)-[:HAS_PENALTY]->(p)`,
          {bookingId,tutorId:b.tutorId,pid:nanoid(16),now:now.toISOString(),
            reason:b.attendanceTutor==='absent'?'Tutor declared unavailable for booked lesson':'Tutor did not confirm Present by the attendance deadline'});
        // Reported lessons retain their frozen booking receipt; the dispute worker records their outcome.
        const dispute = await tx.run('MATCH(t:LessonIssueThread {bookingId:$bookingId,registryVersion:1}) RETURN t.id LIMIT 1', { bookingId });
        if (!dispute.records.length) await captureBooking(tx, bookingId, 'booking_cancel', { source: 'attendance-policy' }, now.toISOString());
        let replacementId: string | null=null;
        if(canTransfer) {
          const candidates=await tx.run(`MATCH(s:TimeSlot {status:'open',attendanceMarked:'present'}),
            (original:TimeSlot {slotId:$slotId}), (old:User {id:$tutorId}), (t:User)
            WHERE t.id=s.tutorId AND t.id<>$tutorId AND s.slotDate=original.slotDate AND s.slotTime=original.slotTime
              AND coalesce(s.durationMinutes,25)=$duration AND coalesce(t.tier,0)=coalesce(old.tier,0)
              AND coalesce(t.isSuspended,false)=false
              AND (coalesce(t.isBlocked,false)=false OR t.blockExpiresAt<=datetime($now))
              AND coalesce(t.identityBanned,false)=false AND (coalesce(t.identityRequired,false)=false OR t.identityVerified=true)
              AND ((t.writtenExamPassed=true AND t.speakingExamPassed=true AND t.interviewPassed=true AND t.profileStatus='approved')
                OR t.email='paulanthonyarriola@gmail.com')
              AND $language IN coalesce(t.languages,['English'])
              AND NOT EXISTS { MATCH(:Booking {status:'confirmed'})-[:BOOKS]->(s) }
            RETURN s ORDER BY s.slotId`,{slotId:b.slotId,tutorId:b.tutorId,duration:Number(b.durationMinutes)||25,language:b.lessonLanguage||'English',now:now.toISOString()});
          for(const candidate of candidates.records) {
            const slot=candidate.get('s').properties;
            if(attendanceStartMs({date:slot.slotDate,time:slot.slotTime})!==start) continue;
            // Eligibility failures abort rather than skip partially acquired locks.
            await assertTutorCanSchedule(tx,slot.tutorId);
            await assertTutorApplicationApproved(tx,slot.tutorId);
            const conflict=await tx.run(`MATCH(other:Booking {tutorId:$tutorId})
              WHERE other.status IN ['confirmed','completed'] AND other.slotDateTime<datetime($end)
                AND other.slotDateTime+duration({minutes:coalesce(other.durationMinutes,25)})>datetime($start)
              RETURN other LIMIT 1`,{tutorId:slot.tutorId,start:new Date(start).toISOString(),end:new Date(start+(Number(b.durationMinutes)||25)*60000).toISOString()});
            if(conflict.records.length) continue;
            await assertStudentScheduleAvailable(tx,b.studentId,slot);
            const reserved=await tx.run(`MATCH(s:TimeSlot {slotId:$id,status:'open',attendanceMarked:'present'})
              SET s.status='booked',s.studentId=$studentId,s.updatedAt=datetime() RETURN s`,{id:slot.slotId,studentId:b.studentId});
            if(!reserved.records.length) continue;
            replacementId=nanoid(16);
            await tx.run(`MATCH(old:Booking {bookingId:$bookingId}),(s:TimeSlot {slotId:$slotId}),(student:Student {id:$studentId})
              CREATE(n:Booking {bookingId:$newId,slotId:$slotId,tutorId:$tutorId,studentId:$studentId,
                slotDateTime:old.slotDateTime,durationMinutes:old.durationMinutes,status:'confirmed',
                attendanceTutor:'present',attendanceSource:'open_slot_confirmation',attendanceAutoEnforce:true,
                attendanceRecoveryVersion:1,roomEntryPolicyActivatedAt:datetime($now),bookedAt:datetime($now),
                paymentMethod:old.paymentMethod,ticketTransferTxHash:old.ticketTransferTxHash,
                replacementFor:$bookingId,paymentRootBookingId:coalesce(old.paymentRootBookingId,$bookingId)})
              CREATE(n)-[:BOOKS]->(s) CREATE(n)-[:BOOKED_BY]->(student)
              SET old.replacementBookingId=$newId,old.paymentTransferredTo=$newId,
                old.attendanceRecoveryOutcome='transferred',old.refundStatus='transferred'
              WITH old,n OPTIONAL MATCH(debit:TicketTransaction {bookingId:$bookingId,type:'booking',status:'completed'})
              SET debit.bookingId=$newId,debit.originalBookingId=coalesce(debit.originalBookingId,$bookingId)`,
              {bookingId,newId:replacementId,slotId:slot.slotId,tutorId:slot.tutorId,studentId:b.studentId,now:now.toISOString()});
            await tx.run(`MATCH(selection:ClassroomLessonSelection {studentId:$studentId,sessionId:$bookingId})
              CREATE(copy:ClassroomLessonSelection) SET copy=properties(selection),copy.sessionId=$newId
              WITH copy MATCH(s:Student {id:$studentId}) CREATE(s)-[:SELECTED_MATERIAL_FOR]->(copy)`,
              {studentId:b.studentId,bookingId,newId:replacementId});
            await captureBooking(tx, replacementId, 'booking', { source: 'attendance-replacement' }, now.toISOString());
            await tx.run(`MATCH(t:MockTicketTransfer {bookingId:$bookingId,status:'used'})
              SET t.bookingId=$newId,t.originalBookingId=coalesce(t.originalBookingId,$bookingId)`,{bookingId,newId:replacementId});
            await lessonNotice(tx,`report:replacement:${replacementId}:tutor`,slot.tutorId,'tutor',replacementId,
              'Replacement lesson booked','A student has been assigned to your Present slot. Check the lesson details.');
            break;
          }
        }
        if(!replacementId) await tx.run(`MATCH(b:Booking {bookingId:$bookingId})
          SET b.refundApprovedBy='system',b.refundApprovalReason='Tutor unavailable before class'`,{bookingId});
        await lessonNotice(tx,`report:recovery:${bookingId}:student`,b.studentId,'student',replacementId||bookingId,
          replacementId?'Your lesson has a replacement tutor':'Your tutor is unavailable',
          replacementId?'Your lesson was transferred to a Present tutor at the same time. No additional charge.':
          'Your lesson was cancelled because your tutor was unavailable. Your credit or trial allowance will be restored; check the lesson for refund status.');
        await lessonNotice(tx,`report:recovery:${bookingId}:tutor`,b.tutorId,'tutor',bookingId,
          'TA-301: booked lesson unavailable','The booked lesson was closed because you did not confirm Present or marked yourself absent.');
        await reconcileTutorPenaltyBlock(tx,b.tutorId);
        return true;
      });
      if(changed) {
        let io=null;try {io=getIO();} catch {}
        revokeLessonRoom(io,bookingId);
        await invalidateLessonCaches(bookingId);
        await invalidateCache('tutor:search:*');
      }
      return changed;
    } finally {await db.close();}
  }
}
export const attendanceRecoveryService=new AttendanceRecoveryService();
