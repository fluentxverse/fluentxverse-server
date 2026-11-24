import neo4j from 'neo4j-driver';
import { query } from '../../db/postgres';
import { adminActivityTimestamp, newestActivityFirst } from '../../utils/adminActivityTimestamp';
import type { RecentActivity } from './admin.interface';

export function activityLimit(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 250) : 25;
}
export function mergeActivities(rows: RecentActivity[], limit: number) {
  return [...new Map(rows.map(row => [row.id, row])).values()]
    .sort((a,b) => newestActivityFirst(a,b) || a.id.localeCompare(b.id)).slice(0, activityLimit(limit));
}

// Only identifiers, state and event times are selected. Never load recordings,
// assessment answers, ID images, private witnesses or issue descriptions into the bell.
const sources = [
  ['TutorIdentity','id','createdAt','tutorId',"'ID submitted for review'",'/identity-reviews','identity_submitted'],
  ['User','id','profileReviewedAt','id',"'Tutor profile reviewed: ' + n.profileStatus",'/applications','profile_reviewed'],
  ['TutorIdentityReview','id','at','submissionId',"'ID review: ' + n.action",'/identity-reviews','identity_reviewed'],
  ['TutorIdentityResetAudit','id','at','tutorId',"'ID and interview reset'",'/identity-reviews','identity_reset'],
  ['TutorIdentityCredential','id','createdAt','tutorId',"'ID credential issuance requested'",'/identity-reviews','identity_credential_requested'],
  ['TutorIdentityCredential','id','revokedAt','tutorId',"'ID credential invalidated'",'/identity-reviews','identity_credential_revoked'],
  ['InterviewSlot','id','bookedAt','tutorId',"'Interview booked'",'/interviews','interview_booked'],
  ['InterviewResultRevision','id','reviewedAt','tutorId',"'Interview result: ' + n.result",'/interviews','interview_reviewed'],
  ['Exam','id','completedAt','id',"'Assessment completed'",'/applications','exam_completed'],
  ['Booking','bookingId','bookedAt','bookingId',"'Lesson booked'",'/lesson-operations/','lesson_booked'],
  ['Booking','bookingId','cancelledAt','bookingId',"'Lesson cancelled'",'/lesson-operations/','lesson_cancelled'],
  ['Booking','bookingId','notesSubmittedAt','bookingId',"'Lesson notes submitted'",'/lesson-operations/','lesson_notes_submitted'],
  ['LessonOutcomeProofRequest','id','requestedAt','bookingId',"'Lesson completion proof requested'",'/lesson-operations/','lesson_proof_requested'],
  ['Penalty','penaltyId','createdAt','tutorId',"'Tutor penalty issued'",'/tutors','penalty_issued'],
  ['Penalty','penaltyId','revokedAt','tutorId',"'Tutor penalty revoked'",'/tutors','penalty_revoked'],
  ['AdminOperationsAudit','id','createdAt','subjectId',"'Admin action: ' + n.action",'/lesson-operations','admin_action'],
  ['LessonAttendanceAudit','id','createdAt','bookingId',"'Lesson attendance reviewed'",'/lesson-operations/','attendance_reviewed'],
  ['LessonIssueThread','id','createdAt','bookingId',"'Lesson issue opened'",'/lesson-operations/','issue_opened'],
  ['LessonIssueReply','id','createdAt','id',"'Lesson issue reply received'",'/lesson-operations','issue_reply'],
  ['LessonIssueDecision','id','createdAt','bookingId',"'Lesson issue decision: ' + n.decision",'/lesson-operations/','issue_decision'],
  ['TicketTransaction','id','createdAt','studentId',"'Payment / credit transaction: ' + n.type",'/payments','payment'],
  ['LessonMaterial','id','createdAt','id',"'Lesson material created'",'/lesson-material-maker','material_created'],
  ['LessonMaterial','id','updatedAt','id',"'Lesson material updated'",'/lesson-material-maker','material_updated'],
  ['SuspensionLog','id','createdAt','id',"'Account status: ' + n.action",'/tutors','account_status'],
] as const;

export async function additionalActivities(session: any, limit: number, read: typeof query = query): Promise<RecentActivity[]> {
  const rows: RecentActivity[] = [];
  for (const [label,id,at,subject,title,href,type] of sources) {
    const result = await session.run(`MATCH(n:${label}) WHERE n.${at} IS NOT NULL${type === 'material_updated' ? ' AND toString(n.updatedAt) <> toString(n.createdAt)' : ''}
      OPTIONAL MATCH(u:User {id:n.${subject}})
      RETURN n.${id} AS id,n.${at} AS timestamp,n.${subject} AS subject,${title} AS title,
        u.firstName AS firstName,u.lastName AS lastName
      ORDER BY toString(timestamp) DESC LIMIT $limit`, {limit:neo4j.int(activityLimit(limit))});
    for (const record of result.records) {
      const eventId = record.get('id'), subjectId = record.get('subject'), timestamp = adminActivityTimestamp(record.get('timestamp'));
      if (!eventId || !timestamp) continue;
      const name = [record.get('firstName'),record.get('lastName')].filter(Boolean).join(' ');
      rows.push({id:`${type}:${eventId}`,type,message:`${record.get('title') || type.replaceAll('_',' ')}${subjectId ? ` · ${name || subjectId}` : ''}`,
        timestamp,href:href.endsWith('/') ? subjectId ? href+encodeURIComponent(subjectId) : href.slice(0,-1) : href});
    }
  }
  // Issuance JSON contains secrets, so inspect only a public metadata projection.
  const minted = await session.run(`MATCH(m:TutorIdentityPublicMetadata {chainId:42161,mock:false})
    MATCH(j:TutorIdentityCredential {id:m.submissionId})
    RETURN j.id AS id,j.issuedAt AS timestamp,j.tutorId AS tutorId
    ORDER BY timestamp DESC LIMIT $limit`,{limit:neo4j.int(activityLimit(limit))});
  for(const record of minted.records) {
    rows.push({id:`identity_nft:${record.get('id')}`,type:'identity_nft',message:`Tutor ID NFT issued · ${record.get('tutorId')}`,
      timestamp:adminActivityTimestamp(record.get('timestamp')),href:'/tutors'});
  }
  const reports = await read(`SELECT * FROM (SELECT id::text, booking_id, 'tutor' AS source, created_at, reviewed_at, review_status FROM lesson_trouble_reports
    UNION ALL SELECT id::text, booking_id, 'student' AS source, created_at, reviewed_at, review_status FROM student_lesson_issue_reports
    ) AS reports ORDER BY GREATEST(created_at, reviewed_at) DESC LIMIT $1`,[activityLimit(limit)]);
  for(const report of reports.rows) {
    rows.push({id:`report:${report.source}:${report.id}`,type:'lesson_report',message:`${report.source === 'tutor' ? 'Tutor' : 'Student'} submitted a lesson report · ${report.booking_id}`,
      timestamp:adminActivityTimestamp(report.created_at),href:`/lesson-operations/${encodeURIComponent(report.booking_id)}`});
    if(report.reviewed_at) rows.push({id:`report_review:${report.source}:${report.id}`,type:'report_review',message:`Lesson report ${report.review_status.replaceAll('_',' ')} · ${report.booking_id}`,
      timestamp:adminActivityTimestamp(report.reviewed_at),href:`/lesson-operations/${encodeURIComponent(report.booking_id)}`});
  }
  const tasks = await read('SELECT id,title,kind,status,created_at,updated_at FROM admin_tasks ORDER BY updated_at DESC LIMIT $1',[activityLimit(limit)]);
  for(const task of tasks.rows) {
    rows.push({id:`task:${task.id}`,type:'task_created',message:`${task.kind === 'suggestion' ? 'Suggestion' : 'Task'} created: ${task.title}`,
      timestamp:adminActivityTimestamp(task.created_at),href:'/tasks'});
    if(new Date(task.updated_at).getTime() > new Date(task.created_at).getTime()) rows.push({id:`task_update:${task.id}`,type:'task_updated',message:`Task updated (${task.status.replaceAll('_',' ')}): ${task.title}`,
      timestamp:adminActivityTimestamp(task.updated_at),href:'/tasks'});
  }
  const messages = await read('SELECT id,title,created_at FROM system_messages ORDER BY created_at DESC LIMIT $1',[activityLimit(limit)]);
  for(const message of messages.rows) rows.push({id:`message:${message.id}`,type:'message_created',message:`Inbox message published: ${message.title}`,
    timestamp:adminActivityTimestamp(message.created_at),href:'/inbox'});
  return rows;
}
