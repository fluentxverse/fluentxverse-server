import { getDriver } from '../../db/memgraph';
import { randomUUID } from 'node:crypto';
import { metricOutcome } from '../../utils/tutorPerformance';
import { plainNode } from '../../utils/adminOperations';
import { hasTutorSalaryTestQualification } from '../../utils/tutorTestQualification';
import { adminTutorVisibility } from '../../utils/adminTutorVisibility';
import { invalidateUserTokens } from '../../db/redis';
import neo4j from 'neo4j-driver';
import { adminActivityTimestamp, newestActivityFirst } from '../../utils/adminActivityTimestamp';
import { hash, compare } from 'bcrypt-ts';
import type { 
  DashboardStats, 
  ExamStats, 
  PendingTutor,
  PendingProfileReview,
  TutorListItem,
  StudentListItem,
  RecentActivity,
  AdminUser,
  AdminLoginParams,
  ProfileItemStatuses
} from './admin.interface';
import type { SuspensionHistoryItem } from './suspension.job';
import { NotificationService } from '../notification.services/notification.service';
import { getIO } from '../../socket/socket.server';
import { tryIssueAndMaybeSubmitTutorCertificationProof } from '../proof.services/tutorCertificationWorkflow.service';

// Helper to safely convert Neo4j Integer to JavaScript number
function toNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (neo4j.isInt(value)) return value.toNumber();
  if (typeof value === 'object' && 'low' in value && 'high' in value) {
    // Manual conversion for Neo4j Integer-like objects
    return neo4j.int(value.low, value.high).toNumber();
  }
  if (typeof value?.toNumber === 'function') return value.toNumber();
  return Number(value) || 0;
}

// Helper to parse exam result and check if passed
function examPassed(resultJson: string | null): boolean {
  if (!resultJson) return false;
  try {
    const result = JSON.parse(resultJson);
    return result.passed === true;
  } catch {
    return false;
  }
}

// Helper to convert Neo4j DateTime to ISO string
function convertNeo4jDateTimeToISO(dateTime: any): string | null {
  if (!dateTime) return null;
  
  // If it's already a string, return it
  if (typeof dateTime === 'string') return dateTime;
  
  // If it's a Neo4j DateTime object
  if (dateTime.year && dateTime.month && dateTime.day) {
    try {
      const year = dateTime.year.toInt ? dateTime.year.toInt() : dateTime.year;
      const month = (dateTime.month.toInt ? dateTime.month.toInt() : dateTime.month) - 1;
      const day = dateTime.day.toInt ? dateTime.day.toInt() : dateTime.day;
      const hour = dateTime.hour?.toInt ? dateTime.hour.toInt() : (dateTime.hour || 0);
      const minute = dateTime.minute?.toInt ? dateTime.minute.toInt() : (dateTime.minute || 0);
      const second = dateTime.second?.toInt ? dateTime.second.toInt() : (dateTime.second || 0);
      
      // Neo4j datetime() stores in UTC, so use Date.UTC to preserve the UTC time
      const date = new Date(Date.UTC(year, month, day, hour, minute, second));
      return date.toISOString();
    } catch (e) {
      console.error('Error converting Neo4j DateTime:', e);
      return null;
    }
  }
  
  // If it's a timestamp number
  if (typeof dateTime === 'number') {
    return new Date(dateTime).toISOString();
  }
  
  return null;
}

export class AdminService {
  /**
   * Get dashboard overview statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get all tutors with their exam results and profile status
      const tutorResult = await session.run(`
        MATCH (u:User)
        OPTIONAL MATCH (u)-[:TAKES]->(we:Exam {type: 'written', status: 'completed'})
        OPTIONAL MATCH (u)-[:TAKES]->(se:Exam {type: 'speaking', status: 'completed'})
        OPTIONAL MATCH (islot:InterviewSlot {tutorId: u.id, status: 'completed', result: 'pass'})
        RETURN u.id as tutorId,
               u.profileStatus as profileStatus,
               u.interviewPassed as userInterviewPassed,
               collect(DISTINCT we.result) as writtenResults,
               collect(DISTINCT se.result) as speakingResults,
               count(DISTINCT islot) as passedInterviewCount
      `);

      let totalTutors = 0;
      let certifiedTutors = 0;
      let pendingTutors = 0;

      for (const record of tutorResult.records) {
        totalTutors++;
        const writtenResults = record.get('writtenResults') || [];
        const speakingResults = record.get('speakingResults') || [];
        const profileStatus = record.get('profileStatus');
        const interviewPassed = record.get('userInterviewPassed') === true || toNumber(record.get('passedInterviewCount')) > 0;
        
        // Check if any written exam passed
        const writtenPassed = writtenResults.some((r: string) => examPassed(r));
        // Check if any speaking exam passed
        const speakingPassed = speakingResults.some((r: string) => examPassed(r));
        // Check if profile is approved
        const profileApproved = profileStatus === 'approved';
        
        // Certified = passed both exams, profile approved, and interview passed
        if (writtenPassed && speakingPassed && profileApproved && interviewPassed) {
          certifiedTutors++;
        } else {
          pendingTutors++;
        }
      }

      // Get student count - Students have their own label
      const studentResult = await session.run(`
        MATCH (s:Student)
        RETURN count(s) as totalStudents
      `);
      const totalStudents = studentResult.records[0]?.get('totalStudents')?.toNumber?.() ?? 
                           studentResult.records[0]?.get('totalStudents') ?? 0;

      // Get session count
      const sessionResult = await session.run(`
        MATCH (s:Booking)
        RETURN count(s) as totalSessions
      `);
      const totalSessions = sessionResult.records[0]?.get('totalSessions')?.toNumber?.() ?? 
                           sessionResult.records[0]?.get('totalSessions') ?? 0;

      // TODO: Get actual revenue from wallet/payment data
      const totalRevenue = 0;

      return {
        totalTutors,
        certifiedTutors,
        pendingTutors,
        totalStudents,
        totalSessions,
        totalRevenue
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get exam statistics
   */
  async getExamStats(): Promise<ExamStats> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get written exam stats from Exam nodes
      const writtenResult = await session.run(`
        MATCH (u:User)-[:TAKES]->(e:Exam {type: 'written', status: 'completed'})
        RETURN e.result as result
      `);

      let writtenTotal = 0;
      let writtenPassed = 0;
      let writtenFailed = 0;
      for (const record of writtenResult.records) {
        writtenTotal++;
        if (examPassed(record.get('result'))) {
          writtenPassed++;
        } else {
          writtenFailed++;
        }
      }

      // Get speaking exam stats from Exam nodes
      const speakingResult = await session.run(`
        MATCH (u:User)-[:TAKES]->(e:Exam {type: 'speaking', status: 'completed'})
        RETURN e.result as result
      `);

      let speakingTotal = 0;
      let speakingPassed = 0;
      let speakingFailed = 0;
      for (const record of speakingResult.records) {
        speakingTotal++;
        if (examPassed(record.get('result'))) {
          speakingPassed++;
        } else {
          speakingFailed++;
        }
      }

      // Get processing count (speaking exams currently being graded)
      const processingResult = await session.run(`
        MATCH (u:User)-[:TAKES]->(e:Exam {type: 'speaking', status: 'processing'})
        RETURN count(e) as processing
      `);
      const processing = processingResult.records[0]?.get('processing')?.toNumber?.() ?? 
                        processingResult.records[0]?.get('processing') ?? 0;

      return {
        writtenExams: {
          total: writtenTotal,
          passed: writtenPassed,
          failed: writtenFailed
        },
        speakingExams: {
          total: speakingTotal,
          passed: speakingPassed,
          failed: speakingFailed,
          processing
        }
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get pending tutors (not fully certified)
   */
  async getPendingTutors(limit: number = 10): Promise<PendingTutor[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get all tutors with their exam results and interview status to determine certification status
      const result = await session.run(`
        MATCH (u:User)
        OPTIONAL MATCH (u)-[:TAKES]->(we:Exam {type: 'written', status: 'completed'})
        OPTIONAL MATCH (u)-[:TAKES]->(se:Exam {type: 'speaking', status: 'completed'})
        OPTIONAL MATCH (u)-[:TAKES]->(sp:Exam {type: 'speaking', status: 'processing'})
        OPTIONAL MATCH (slot:InterviewSlot {tutorId: u.id, status: 'completed'})
        RETURN u,
               collect(DISTINCT we.result) as writtenResults,
               collect(DISTINCT se.result) as speakingResults,
               count(DISTINCT sp) as processingCount,
               slot.result as interviewResult,
               slot.completedAt as interviewDate
        ORDER BY u.createdAt DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit * 2) }); // Get more to filter

      const pendingTutors: PendingTutor[] = [];
      
      for (const record of result.records) {
        const u = record.get('u').properties;
        const writtenResults = record.get('writtenResults') || [];
        const speakingResults = record.get('speakingResults') || [];
        const processingCount = record.get('processingCount')?.toNumber?.() ?? record.get('processingCount') ?? 0;
        const interviewResult = record.get('interviewResult') as 'pass' | 'fail' | null;
        const interviewDate = record.get('interviewDate') as string | null;
        
        const writtenPassed = writtenResults.some((r: string) => examPassed(r));
        const speakingPassed = speakingResults.some((r: string) => examPassed(r));
        const isProcessing = processingCount > 0;
        
        // Only include non-certified tutors
        if (hasTutorSalaryTestQualification(u)) continue;
        if (writtenPassed && speakingPassed) continue;
        
        let status: 'pending_written' | 'pending_speaking' | 'processing';
        if (!writtenPassed) {
          status = 'pending_written';
        } else if (isProcessing) {
          status = 'processing';
        } else {
          status = 'pending_speaking';
        }

        pendingTutors.push({
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          email: u.email,
          registeredAt: u.createdAt || new Date().toISOString(),
          status,
          writtenExamPassed: writtenPassed,
          speakingExamPassed: speakingPassed,
          interviewResult: interviewResult || null,
          interviewDate: interviewDate || null
        });
        
        if (pendingTutors.length >= limit) break;
      }

      return pendingTutors;
    } finally {
      await session.close();
    }
  }

  /**
   * Get pending profile reviews (tutors who submitted their profile for admin review)
   */
  async getPendingProfileReviews(limit: number = 20): Promise<PendingProfileReview[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (u:User)
        WHERE u.profileStatus = 'pending_review'
        RETURN u
        ORDER BY u.profileSubmittedAt DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      return result.records.map(record => {
        const u = record.get('u').properties;
        
        // Convert Neo4j DateTime to ISO string
        let submittedAt = new Date().toISOString();
        if (u.profileSubmittedAt) {
          if (typeof u.profileSubmittedAt === 'string') {
            submittedAt = u.profileSubmittedAt;
          } else if (u.profileSubmittedAt.toStandardDate) {
            submittedAt = u.profileSubmittedAt.toStandardDate().toISOString();
          } else if (u.profileSubmittedAt.year) {
            // Manual conversion from Neo4j DateTime object
            const dt = u.profileSubmittedAt;
            const year = dt.year.low || dt.year;
            const month = (dt.month.low || dt.month) - 1;
            const day = dt.day.low || dt.day;
            const hour = dt.hour?.low || dt.hour || 0;
            const minute = dt.minute?.low || dt.minute || 0;
            const second = dt.second?.low || dt.second || 0;
            submittedAt = new Date(Date.UTC(year, month, day, hour, minute, second)).toISOString();
          }
        } else if (u.createdAt) {
          submittedAt = typeof u.createdAt === 'string' ? u.createdAt : new Date().toISOString();
        }

        // Parse profile item statuses from stored JSON or create default
        let profileItemStatuses;
        if (u.profileItemStatuses) {
          try {
            profileItemStatuses = typeof u.profileItemStatuses === 'string' 
              ? JSON.parse(u.profileItemStatuses) 
              : u.profileItemStatuses;
          } catch {
            profileItemStatuses = this.getDefaultItemStatuses();
          }
        } else {
          profileItemStatuses = this.getDefaultItemStatuses();
        }
        
        return {
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          email: u.email,
          profilePicture: u.profilePicture || undefined,
          bio: u.bio || undefined,
          videoIntroUrl: u.videoIntroUrl || undefined,
          schoolAttended: u.schoolAttended || undefined,
          major: u.major || undefined,
          interests: u.interests ? JSON.parse(u.interests) : [],
          submittedAt,
          profileStatus: 'pending_review' as const,
          profileItemStatuses
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Get default item statuses for a new profile submission
   */
  private getDefaultItemStatuses() {
    return {
      profilePicture: { status: 'pending' as const },
      videoIntro: { status: 'pending' as const },
      bio: { status: 'pending' as const },
      education: { status: 'pending' as const },
      interests: { status: 'pending' as const }
    };
  }

  /**
   * Review a specific profile item (approve/reject)
   */
  async reviewProfileItem(
    tutorId: string, 
    itemKey: 'profilePicture' | 'videoIntro' | 'bio' | 'education' | 'interests',
    action: 'approve' | 'reject',
    reason?: string,
    reviewerId?: string
  ): Promise<{ profileItemStatuses: any; allApproved: boolean }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // First get current item statuses
      const getResult = await session.run(`
        MATCH (u:User { id: $tutorId })
        RETURN u.profileItemStatuses as itemStatuses
      `, { tutorId });

      if (getResult.records.length === 0) {
        throw new Error('Tutor not found');
      }

      let currentStatuses: Record<string, { status: string; rejectionReason?: string; reviewedAt?: string; reviewedBy?: string }> = this.getDefaultItemStatuses();
      const record = getResult.records[0];
      const storedStatuses = record ? record.get('itemStatuses') : null;
      if (storedStatuses) {
        try {
          currentStatuses = typeof storedStatuses === 'string' 
            ? JSON.parse(storedStatuses) 
            : storedStatuses;
        } catch {}
      }

      // Update the specific item
      currentStatuses[itemKey] = {
        status: action === 'approve' ? 'approved' : 'rejected',
        rejectionReason: action === 'reject' ? reason : undefined,
        reviewedAt: new Date().toISOString(),
        reviewedBy: reviewerId
      };

      // Check if all items are approved
      const allApproved = Object.values(currentStatuses).every(
        (item: any) => item.status === 'approved'
      );

      // Check if any item is rejected
      const hasRejected = Object.values(currentStatuses).some(
        (item: any) => item.status === 'rejected'
      );

      // Determine overall profile status
      let overallStatus = 'pending_review';
      if (allApproved) {
        overallStatus = 'approved';
      } else if (hasRejected) {
        overallStatus = 'rejected';
      }

      // Update the database
      await session.run(`
        MATCH (u:User { id: $tutorId })
        SET u.profileItemStatuses = $itemStatuses,
            u.profileStatus = $overallStatus,
            u.profileScreeningDecisionId = $decisionId,
            u.profileReviewedBy = $reviewerId,
            u.profileReviewedAt = datetime()
        CREATE (:ProfileScreeningDecision {id: $decisionId, tutorId: $tutorId, reviewerId: $reviewerId,
          status: $overallStatus, reviewedAt: u.profileReviewedAt, itemStatuses: $itemStatuses,
          firstName: u.firstName, lastName: u.lastName, bio: u.bio, education: u.education,
          profilePicture: u.profilePicture, videoIntroUrl: u.videoIntroUrl})
        RETURN u
      `, { 
        tutorId, 
        itemStatuses: JSON.stringify(currentStatuses),
        overallStatus,
        decisionId: randomUUID(),
        reviewerId: reviewerId || null
      });

      // If overall status changed to approved or rejected, notify the tutor
      if (allApproved || hasRejected) {
        if (allApproved) {
          void tryIssueAndMaybeSubmitTutorCertificationProof(tutorId, 'profile_approved');
        }

        const notificationService = new NotificationService();
        const io = getIO();
        
        const notification = await notificationService.createNotification({
          userId: tutorId,
          userType: 'tutor',
          type: allApproved ? 'profile_approved' : 'profile_rejected',
          title: allApproved ? 'Profile Approved! 🎉' : 'Profile Needs Revision',
          message: allApproved 
            ? 'Congratulations! Your profile has been fully approved. Students can now find and book sessions with you.'
            : 'Some items in your profile were not approved. Please review the feedback and make the necessary changes.',
          data: {
            link: '/profile'
          }
        });
        
        if (io) {
          io.to(`notifications:${tutorId}`).emit('notification:new', notification);
        }
      }

      return { profileItemStatuses: currentStatuses, allApproved };
    } finally {
      await session.close();
    }
  }

  /**
   * Review a pending profile change for an already-approved profile
   * Approving applies the change to the live profile
   * Rejecting discards the change with feedback
   */
  async reviewPendingChange(
    tutorId: string,
    changeIndex: number,
    action: 'approve' | 'reject',
    reason?: string
  ): Promise<{ success: boolean; remainingChanges: number }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get current pending changes
      const result = await session.run(`
        MATCH (u:User { id: $tutorId })
        RETURN u.pendingProfileChanges as pendingChanges,
               u.firstName as firstName,
               u.lastName as lastName
      `, { tutorId });

      if (result.records.length === 0) {
        throw new Error('Tutor not found');
      }

      const record = result.records[0]!;
      const pendingChangesStr = record.get('pendingChanges');
      const tutorName = `${record.get('firstName') || ''} ${record.get('lastName') || ''}`.trim();
      
      if (!pendingChangesStr) {
        throw new Error('No pending changes found');
      }

      let pendingChanges: any[];
      try {
        pendingChanges = JSON.parse(pendingChangesStr);
      } catch {
        throw new Error('Invalid pending changes data');
      }

      if (changeIndex < 0 || changeIndex >= pendingChanges.length) {
        throw new Error('Invalid change index');
      }

      const change = pendingChanges[changeIndex];
      const fieldKey = change.fieldKey || change.itemKey;

      if (action === 'approve') {
        // Apply the change to the live profile
        await session.run(`
          MATCH (u:User { id: $tutorId })
          SET u.${fieldKey} = $newValue
        `, { tutorId, newValue: change.newValue });
      }

      // Remove this change from the pending list
      pendingChanges.splice(changeIndex, 1);

      // Update pending changes list
      const hasPendingChanges = pendingChanges.length > 0;
      await session.run(`
        MATCH (u:User { id: $tutorId })
        SET u.pendingProfileChanges = $pendingChanges,
            u.hasPendingChanges = $hasPendingChanges
      `, { 
        tutorId, 
        pendingChanges: pendingChanges.length > 0 ? JSON.stringify(pendingChanges) : null,
        hasPendingChanges
      });

      // Notify the tutor
      const notificationService = new NotificationService();
      const io = getIO();
      
      const itemLabels: Record<string, string> = {
        'bio': 'Bio',
        'profilePicture': 'Profile Photo',
        'videoIntro': 'Introduction Video',
        'videoIntroUrl': 'Introduction Video',
        'education': 'Education',
        'schoolAttended': 'Education',
        'major': 'Education',
        'interests': 'Interests'
      };
      
      const itemLabel = itemLabels[change.itemKey] || change.itemKey;
      
      const notification = await notificationService.createNotification({
        userId: tutorId,
        userType: 'tutor',
        type: action === 'approve' ? 'profile_change_approved' : 'profile_change_rejected',
        title: action === 'approve' ? 'Profile Update Approved' : 'Profile Update Rejected',
        message: action === 'approve' 
          ? `Your ${itemLabel} update has been approved and is now live on your profile.`
          : `Your ${itemLabel} update was not approved. ${reason || 'Please make adjustments and try again.'}`,
        data: {
          link: '/profile',
          itemKey: change.itemKey,
          rejectionReason: action === 'reject' ? reason : undefined
        }
      });
      
      if (io) {
        io.to(`notifications:${tutorId}`).emit('notification:new', notification);
      }

      return { success: true, remainingChanges: pendingChanges.length };
    } finally {
      await session.close();
    }
  }

  /**
   * Get tutors with pending profile changes (for admin dashboard)
   */
  async getTutorsWithPendingChanges(limit: number = 20): Promise<any[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (u:User)
        WHERE u.hasPendingChanges = true AND u.profileStatus = 'approved'
        RETURN u
        ORDER BY u.pendingProfileChanges DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      return result.records.map(record => {
        const u = record.get('u').properties;
        let pendingChanges: any[] = [];
        
        if (u.pendingProfileChanges) {
          try {
            pendingChanges = JSON.parse(u.pendingProfileChanges);
          } catch {}
        }
        
        return {
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          email: u.email,
          profilePicture: u.profilePicture,
          pendingChanges,
          profileStatus: u.profileStatus
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Approve or reject a tutor profile
   */
  async reviewTutorProfile(tutorId: string, action: 'approve' | 'reject', reason?: string, reviewerId?: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const result = await session.run(`
        MATCH (u:User { id: $tutorId })
        SET u.profileStatus = $newStatus,
            u.profileScreeningDecisionId = $decisionId,
            u.profileReviewedBy = $reviewerId,
            u.profileReviewedAt = datetime(),
            u.profileRejectionReason = $reason
        CREATE (:ProfileScreeningDecision {id: $decisionId, tutorId: $tutorId, reviewerId: $reviewerId,
          status: $newStatus, reviewedAt: u.profileReviewedAt,
          firstName: u.firstName, lastName: u.lastName, bio: u.bio, education: u.education,
          profilePicture: u.profilePicture, videoIntroUrl: u.videoIntroUrl})
        RETURN u.firstName as firstName, u.lastName as lastName
      `, { 
        tutorId, 
        newStatus,
        decisionId: randomUUID(),
        reviewerId: reviewerId || null,
        reason: action === 'reject' ? reason : null 
      });
      
      // Send notification to the tutor
      const notificationService = new NotificationService();
      const io = getIO();
      
      const record = result.records[0];
      const tutorName = record ? `${record.get('firstName') || ''} ${record.get('lastName') || ''}`.trim() : 'Your';
      
      const notification = await notificationService.createNotification({
        userId: tutorId,
        userType: 'tutor',
        type: action === 'approve' ? 'profile_approved' : 'profile_rejected',
        title: action === 'approve' ? 'Profile Approved! 🎉' : 'Profile Needs Revision',
        message: action === 'approve' 
          ? 'Congratulations! Your profile has been approved. Students can now find and book sessions with you.'
          : `Your profile was not approved. ${reason || 'Please review and update your information, then submit again.'}`,
        data: {
          link: '/profile'
        }
      });
      
      // Emit real-time notification via socket
      if (io) {
        io.to(`notifications:${tutorId}`).emit('notification:new', notification);
      }

      if (action === 'approve') {
        void tryIssueAndMaybeSubmitTutorCertificationProof(tutorId, 'profile_approved');
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Get all tutors with filters
   */
  async getTutors(params: {
    page?: number;
    limit?: number;
    status?: 'all' | 'certified' | 'pending' | 'processing' | 'failed' | 'suspended' | 'pending_profile';
    search?: string;
  }): Promise<{ tutors: TutorListItem[]; total: number }> {
    const driver = getDriver();
    const session = driver.session();
    const { page = 1, limit = 20, status = 'all', search = '' } = params;
    const skip = (page - 1) * limit;

    try {
      // Build search conditions
      const conditions: string[] = [];
      
      if (search) {
        conditions.push(`(toLower(u.firstName) CONTAINS toLower($search) OR toLower(u.lastName) CONTAINS toLower($search) OR toLower(u.email) CONTAINS toLower($search))`);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      // Get all tutors with exam results
      const result = await session.run(`
        MATCH (u:User)
        ${whereClause}
        OPTIONAL MATCH (u)-[:TAKES]->(we:Exam {type: 'written', status: 'completed'})
        OPTIONAL MATCH (u)-[:TAKES]->(se:Exam {type: 'speaking', status: 'completed'})
        OPTIONAL MATCH (u)-[:TAKES]->(sp:Exam {type: 'speaking', status: 'processing'})
        OPTIONAL MATCH (islot:InterviewSlot {tutorId: u.id, status: 'completed', result: 'pass'})
        OPTIONAL MATCH (u)-[:HAS_CERTIFICATION_CREDENTIAL]->(cred:TutorCertificationCredential)
        RETURN u,
               cred,
               collect(DISTINCT we.result) as writtenResults,
               collect(DISTINCT se.result) as speakingResults,
               count(DISTINCT sp) as processingCount,
               count(DISTINCT islot) as passedInterviewCount
        ORDER BY u.createdAt DESC
      `, { search });

      // Process all tutors and filter by status in JS
      const allTutors: TutorListItem[] = [];
      
      for (const record of result.records) {
        const u = record.get('u').properties;
        const credential = record.get('cred')?.properties;
        const writtenResults = record.get('writtenResults') || [];
        const speakingResults = record.get('speakingResults') || [];
        const processingCount = record.get('processingCount')?.toNumber?.() ?? record.get('processingCount') ?? 0;
        
        const writtenPassed = writtenResults.some((r: string) => examPassed(r));
        const speakingPassed = speakingResults.some((r: string) => examPassed(r));
        const interviewPassed = u.interviewPassed === true || toNumber(record.get('passedInterviewCount')) > 0;
        const isProcessing = processingCount > 0;
        const profileStatus = u.profileStatus || 'incomplete';

        // Determine tutor status - now includes profile review requirement
        let tutorStatus: TutorListItem['status'];
        if (writtenPassed && speakingPassed && profileStatus === 'approved' && interviewPassed) {
          tutorStatus = 'certified';
        } else if (hasTutorSalaryTestQualification(u)) {
          tutorStatus = 'test_qualified';
        } else if (writtenPassed && speakingPassed && profileStatus !== 'approved') {
          // Passed exams but profile not approved yet
          tutorStatus = 'pending_profile';
        } else if (isProcessing) {
          tutorStatus = 'processing';
        } else {
          tutorStatus = 'pending';
        }

        // Filter by status if specified
        if (status !== 'all' && status !== 'suspended' && tutorStatus !== status
          && !(status === 'certified' && tutorStatus === 'test_qualified')) continue;
        
        // Check suspension status
        const suspendedUntil = u.suspendedUntil ? new Date(u.suspendedUntil) : null;
        const isSuspended = suspendedUntil ? suspendedUntil > new Date() : false;
        
        // Filter by suspended if specified
        if (status === 'suspended' && !isSuspended) continue;

        allTutors.push({
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
          email: u.email,
          ...adminTutorVisibility(u),
          registeredAt: u.createdAt || new Date().toISOString(),
          writtenExamPassed: writtenPassed,
          speakingExamPassed: speakingPassed,
          interviewPassed,
          writtenExamScore: u.writtenExamScore,
          speakingExamScore: u.speakingExamScore,
          status: tutorStatus,
          profileStatus: profileStatus as 'incomplete' | 'pending_review' | 'approved' | 'rejected',
          zkCertificationStatus: credential?.status || u.tutorCertificationProofStatus || undefined,
          zkCredentialCommitment: credential?.credentialCommitment || undefined,
          zkVerifyTxHash: credential?.zkVerifyTxHash || undefined,
          zkVerifyAggregationId: credential?.zkVerifyAggregationId != null ? toNumber(credential.zkVerifyAggregationId) : undefined,
          zkVerifyDomainId: credential?.zkVerifyDomainId != null ? String(credential.zkVerifyDomainId) : undefined,
          zkVerifyLastError: credential?.zkVerifyLastError || undefined,
          zkVerifyUpdatedAt: credential?.updatedAt || undefined,
          languages: u.languages || ['English'],
          totalSessions: u.totalSessions || 0,
          rating: u.rating || 0,
          isSuspended,
          suspendedUntil: u.suspendedUntil || undefined,
          suspendedReason: u.suspendedReason || undefined,
          suspendedAt: u.suspendedAt || undefined
        });
      }

      const total = allTutors.length;
      const tutors = allTutors.slice(skip, skip + limit);

      return { tutors, total };
    } finally {
      await session.close();
    }
  }

  /**
   * Get all students with filters
   */
  async getStudents(params: {
    page?: number;
    limit?: number;
    status?: 'all' | 'active' | 'inactive' | 'suspended';
    search?: string;
  }): Promise<{ students: StudentListItem[]; total: number }> {
    const driver = getDriver();
    const session = driver.session();
    const { page = 1, limit = 20, status = 'all', search = '' } = params;
    const skip = (page - 1) * limit;

    try {
      // Students have their own Student label
      const conditions: string[] = [];
      
      if (search) {
        conditions.push(`(toLower(s.givenName) CONTAINS toLower($search) OR toLower(s.familyName) CONTAINS toLower($search) OR toLower(s.email) CONTAINS toLower($search))`);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      // Get students (no pagination first to filter)
      const result = await session.run(`
        MATCH (s:Student)
        ${whereClause}
        RETURN s
        ORDER BY s.createdAt DESC
      `, { search });

      const allStudents: StudentListItem[] = [];
      
      for (const record of result.records) {
        const s = record.get('s').properties;
        
        // Calculate if active (active in last 7 days)
        const lastActive = s.lastActive ? new Date(s.lastActive) : new Date(s.createdAt);
        const daysSinceActive = Math.floor((Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
        const isActive = daysSinceActive <= 7;
        
        // Check suspension status
        const suspendedUntil = s.suspendedUntil ? new Date(s.suspendedUntil) : null;
        const isSuspended = suspendedUntil ? suspendedUntil > new Date() : false;
        
        // Filter by status
        if (status === 'suspended' && !isSuspended) continue;
        if (status === 'active' && (!isActive || isSuspended)) continue;
        if (status === 'inactive' && (isActive || isSuspended)) continue;

        allStudents.push({
          id: s.id,
          name: `${s.givenName || ''} ${s.familyName || ''}`.trim(),
          email: s.email,
          joinedAt: s.createdAt || new Date().toISOString(),
          totalSessions: s.totalSessions || 0,
          totalSpent: s.totalSpent || 0,
          status: isActive ? 'active' : 'inactive',
          lastActive: s.lastActive || s.createdAt || new Date().toISOString(),
          isSuspended,
          suspendedUntil: s.suspendedUntil || undefined,
          suspendedReason: s.suspendedReason || undefined,
          suspendedAt: s.suspendedAt || undefined
        });
      }

      const total = allStudents.length;
      const students = allStudents.slice(skip, skip + limit);

      return { students, total };
    } finally {
      await session.close();
    }
  }

  /**
   * Get recent activity feed
   */
  async getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get recent tutor registrations - User nodes are tutors
      // Memgraph timestamp() stores microseconds; Date.now() fields use milliseconds.
      const tutorResult = await session.run(`
        MATCH (u:User)
        WHERE u.registeredAt IS NOT NULL
        RETURN u.id as id, u.firstName as firstName, u.lastName as lastName, u.registeredAt as timestamp, 'tutor_registered' as type
        ORDER BY u.registeredAt DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      // Get recent student registrations - Students have their own label
      // signUpdate is a credential-change timestamp, not a registration date.
      const studentResult = await session.run(`
        MATCH (s:Student)
        RETURN s.id as id, s.givenName as firstName, s.familyName as lastName,
          coalesce(s.registeredAt, s.createdAt) as timestamp, 'student_joined' as type
        ORDER BY CASE WHEN timestamp IS NULL THEN 1 ELSE 0 END ASC, timestamp DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      const activities: RecentActivity[] = [];

      // Process tutor registrations
      tutorResult.records.forEach(record => {
        const firstName = record.get('firstName') || '';
        const lastName = record.get('lastName') || '';
        const rawTimestamp = record.get('timestamp');
        
        const timestamp = adminActivityTimestamp(rawTimestamp);
        
        activities.push({
          id: record.get('id'),
          type: 'tutor_registered',
          message: `New tutor registered: ${firstName} ${lastName}`.trim(),
          timestamp,
          userId: record.get('id')
        });
      });

      // Process student registrations
      studentResult.records.forEach(record => {
        const firstName = record.get('firstName') || '';
        const lastName = record.get('lastName') || '';
        const rawTimestamp = record.get('timestamp');
        
        const timestamp = adminActivityTimestamp(rawTimestamp);
        
        activities.push({
          id: record.get('id'),
          type: 'student_joined',
          message: `New student: ${firstName} ${lastName}`.trim(),
          timestamp,
          userId: record.get('id')
        });
      });

      // Get profile submissions for review
      const profileResult = await session.run(`
        MATCH (u:User)
        WHERE u.profileStatus = 'pending_review' AND u.profileSubmittedAt IS NOT NULL
        RETURN u.id as id, u.firstName as firstName, u.lastName as lastName, u.profileSubmittedAt as timestamp, 'profile_submitted' as type
        ORDER BY u.profileSubmittedAt DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      // Process profile submissions
      profileResult.records.forEach(record => {
        const firstName = record.get('firstName') || '';
        const lastName = record.get('lastName') || '';
        const rawTimestamp = record.get('timestamp');
        
        const timestamp = adminActivityTimestamp(rawTimestamp);
        
        activities.push({
          id: `profile_${record.get('id')}`,
          type: 'profile_submitted',
          message: `Profile submitted for review: ${firstName} ${lastName}`.trim(),
          timestamp,
          userId: record.get('id')
        });
      });

      // Include admin-targeted persisted notifications (e.g., pending profile changes, minting)
      const adminNotifResult = await session.run(`
        MATCH (n:Notification)
        WHERE n.userType = 'admin' AND n.type IN ['profile_change_submitted', 'minting_started', 'minting_success', 'minting_failed']
        RETURN n
        ORDER BY n.timestamp DESC
        LIMIT $limit
      `, { limit: neo4j.int(limit) });

      adminNotifResult.records.forEach(record => {
        const n = record.get('n').properties;
        let data: any = {};
        try {
          data = n.data ? JSON.parse(n.data) : {};
        } catch {
          data = {};
        }

        activities.push({
          id: n.id,
          type: n.type,
          message: n.message,
          timestamp: adminActivityTimestamp(n.timestamp),
          userId: data.tutorId || data.userId || n.userId
        });
      });

      // Sort by timestamp and limit
      activities.sort(newestActivityFirst);
      return activities.slice(0, limit);
    } finally {
      await session.close();
    }
  }

  /**
   * Login admin user
   */
  async login(params: AdminLoginParams): Promise<AdminUser> {
    const { username, password } = params;
    const driver = getDriver();
    const session = driver.session();

    try {
      // Find admin user by username
      const result = await session.run(`
        MATCH (a:Admin {username: $username})
        RETURN a
      `, { username: username.toLowerCase() });

      if (result.records.length === 0) {
        throw new Error('Invalid username or password');
      }

      const record = result.records[0];
      if (!record) {
        throw new Error('Invalid username or password');
      }

      const admin = record.get('a').properties;

      // Verify password
      const isValidPassword = await compare(password, admin.password);
      if (!isValidPassword) {
        throw new Error('Invalid username or password');
      }

      return {
        id: admin.id,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role || 'admin',
        createdAt: admin.createdAt,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get admin by ID
   */
  async getById(adminId: string): Promise<AdminUser | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (a:Admin {id: $adminId})
        RETURN a
      `, { adminId });

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      if (!record) {
        return null;
      }

      const admin = record.get('a').properties;

      return {
        id: admin.id,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role || 'admin',
        createdAt: admin.createdAt,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Create an admin user (for initial setup)
   */
  async createAdmin(
    username: string, 
    password: string, 
    firstName?: string, 
    lastName?: string, 
    role: 'admin' | 'superadmin' = 'admin'
  ): Promise<AdminUser> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Check if admin already exists
      const existing = await session.run(`
        MATCH (a:Admin {username: $username})
        RETURN a
      `, { username: username.toLowerCase() });

      if (existing.records.length > 0) {
        throw new Error('Admin with this username already exists');
      }

      // Hash password
      const hashedPassword = await hash(password, 12);
      const adminId = `ADMIN-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      // Create admin
      const result = await session.run(`
        CREATE (a:Admin {
          id: $id,
          username: $username,
          password: $password,
          firstName: $firstName,
          lastName: $lastName,
          role: $role,
          createdAt: $createdAt
        })
        RETURN a
      `, {
        id: adminId,
        username: username.toLowerCase(),
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        role,
        createdAt: now,
      });

      const record = result.records[0];
      if (!record) {
        throw new Error('Failed to create admin');
      }

      const admin = record.get('a').properties;

      return {
        id: admin.id,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        createdAt: admin.createdAt,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * List all admin users
   */
  async listAdmins(): Promise<AdminUser[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (a:Admin)
        RETURN a
        ORDER BY a.createdAt DESC
      `);

      return result.records.map(record => {
        const admin = record.get('a').properties;
        return {
          id: admin.id,
          username: admin.username,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role || 'admin',
          createdAt: admin.createdAt,
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Delete an admin by ID
   */
  async deleteAdmin(adminId: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (a:Admin {id: $adminId})
        DELETE a
        RETURN count(a) as deleted
      `, { adminId });

      const deleted = result.records[0]?.get('deleted');
      return deleted?.toNumber?.() > 0 || deleted > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Update admin profile
   */
  async updateAdmin(
    adminId: string,
    updates: { firstName?: string; lastName?: string; role?: 'admin' | 'superadmin' }
  ): Promise<AdminUser | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { adminId };

      if (updates.firstName !== undefined) {
        setClauses.push('a.firstName = $firstName');
        params.firstName = updates.firstName;
      }
      if (updates.lastName !== undefined) {
        setClauses.push('a.lastName = $lastName');
        params.lastName = updates.lastName;
      }
      if (updates.role !== undefined) {
        setClauses.push('a.role = $role');
        params.role = updates.role;
      }

      if (setClauses.length === 0) {
        return this.getById(adminId);
      }

      const result = await session.run(`
        MATCH (a:Admin {id: $adminId})
        SET ${setClauses.join(', ')}
        RETURN a
      `, params);

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      if (!record) {
        return null;
      }

      const admin = record.get('a').properties;
      return {
        id: admin.id,
        username: admin.username,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role || 'admin',
        createdAt: admin.createdAt,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Change admin password
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get current admin with password
      const result = await session.run(`
        MATCH (a:Admin {id: $adminId})
        RETURN a
      `, { adminId });

      if (result.records.length === 0) {
        return { success: false, error: 'Admin not found' };
      }

      const record = result.records[0];
      if (!record) {
        return { success: false, error: 'Admin not found' };
      }

      const admin = record.get('a').properties;
      
      // Verify current password
      const isValid = await compare(currentPassword, admin.password);
      if (!isValid) {
        return { success: false, error: 'Current password is incorrect' };
      }

      // Hash new password
      const hashedPassword = await hash(newPassword, 12);

      // Update password with signUpdate timestamp
      const signUpdate = Date.now();
      await session.run(`
        MATCH (a:Admin {id: $adminId})
        SET a.password = $password, a.signUpdate = $signUpdate
      `, { adminId, password: hashedPassword, signUpdate });

      // Invalidate all existing tokens for this admin
      await invalidateUserTokens(adminId, signUpdate);

      return { success: true };
    } finally {
      await session.close();
    }
  }

  /**
   * Suspend a tutor
   */
  async suspendTutor(tutorId: string, reason: string, until: Date): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Update user suspension status and create history record
      await session.run(`
        MATCH (u:User {id: $tutorId})
        SET u.suspendedUntil = $until,
            u.suspendedReason = $reason,
            u.suspendedAt = datetime()
        CREATE (sh:SuspensionHistory {
          id: randomUUID(),
          action: 'suspended',
          reason: $reason,
          until: $until,
          createdAt: datetime(),
          targetType: 'tutor'
        })
        CREATE (u)-[:HAS_SUSPENSION_HISTORY]->(sh)
      `, {
        tutorId,
        until: until.toISOString(),
        reason
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Unsuspend a tutor
   */
  async unsuspendTutor(tutorId: string, adminId?: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Remove suspension and create history record
      const logId = crypto.randomUUID();
      await session.run(`
        MATCH (u:User {id: $tutorId})
        CREATE (log:SuspensionLog {
          id: $logId,
          action: 'unsuspended',
          reason: 'Manually unsuspended by admin',
          previousSuspendedUntil: u.suspendedUntil,
          previousReason: u.suspendedReason,
          createdAt: datetime(),
          targetType: 'tutor'
        })
        CREATE (u)-[:HAS_SUSPENSION]->(log)
        ${adminId ? 'WITH u, log MATCH (a:Admin {id: $adminId}) CREATE (log)-[:UNSUSPENDED_BY]->(a)' : ''}
        WITH u
        REMOVE u.suspendedUntil, u.suspendedReason, u.suspendedAt
      `, { tutorId, logId, adminId });
    } finally {
      await session.close();
    }
  }

  /**
   * Suspend a student
   */
  async suspendStudent(studentId: string, reason: string, until: Date, adminId?: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Update student suspension status and create history record
      const logId = crypto.randomUUID();
      await session.run(`
        MATCH (s:Student {id: $studentId})
        SET s.suspendedUntil = $until,
            s.suspendedReason = $reason,
            s.suspendedAt = datetime()
        CREATE (log:SuspensionLog {
          id: $logId,
          action: 'suspended',
          reason: $reason,
          until: $until,
          createdAt: datetime(),
          targetType: 'student'
        })
        CREATE (s)-[:HAS_SUSPENSION]->(log)
        ${adminId ? 'WITH log MATCH (a:Admin {id: $adminId}) CREATE (log)-[:SUSPENDED_BY]->(a)' : ''}
      `, {
        studentId,
        until: until.toISOString(),
        reason,
        logId,
        adminId
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Unsuspend a student
   */
  async unsuspendStudent(studentId: string, adminId?: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Remove suspension and create history record
      const logId = crypto.randomUUID();
      await session.run(`
        MATCH (s:Student {id: $studentId})
        CREATE (log:SuspensionLog {
          id: $logId,
          action: 'unsuspended',
          reason: 'Manually unsuspended by admin',
          previousSuspendedUntil: s.suspendedUntil,
          previousReason: s.suspendedReason,
          createdAt: datetime(),
          targetType: 'student'
        })
        CREATE (s)-[:HAS_SUSPENSION]->(log)
        ${adminId ? 'WITH s, log MATCH (a:Admin {id: $adminId}) CREATE (log)-[:UNSUSPENDED_BY]->(a)' : ''}
        WITH s
        REMOVE s.suspendedUntil, s.suspendedReason, s.suspendedAt
      `, { studentId, logId, adminId });
    } finally {
      await session.close();
    }
  }

  /**
   * Get suspension history for a user
   */
  async getSuspensionHistory(userId: string, userType: 'tutor' | 'student'): Promise<SuspensionHistoryItem[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const label = userType === 'tutor' ? 'User' : 'Student';
      const result = await session.run(`
        MATCH (u:${label} {id: $userId})-[:HAS_SUSPENSION_HISTORY]->(sh:SuspensionHistory)
        RETURN sh
        ORDER BY sh.createdAt DESC
      `, { userId });

      return result.records.map(record => {
        const sh = record.get('sh').properties;
        return {
          id: sh.id,
          action: sh.action,
          reason: sh.reason,
          until: sh.until,
          previousReason: sh.previousReason,
          previousSuspendedUntil: sh.previousSuspendedUntil,
          createdAt: sh.createdAt,
          targetType: userType,
          suspendedBy: sh.suspendedBy,
          unsuspendedBy: sh.unsuspendedBy
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Get comprehensive analytics data
   */
  async getAnalytics(period: string = 'week'): Promise<AnalyticsData> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Calculate date range based on period
      const now = new Date();
      const startDate = new Date();
      
      switch (period) {
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
        case 'quarter':
          startDate.setMonth(now.getMonth() - 3);
          break;
        case 'year':
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      // Get tutor registration trend
      const tutorTrendResult = await session.run(`
        MATCH (u:User)
        WHERE u.createdAt >= $startDate
        RETURN date(u.createdAt) as day, count(u) as count
        ORDER BY day
      `, { startDate: startDate.toISOString() });

      const tutorTrend = tutorTrendResult.records.map(r => ({
        date: r.get('day')?.toString() || '',
        count: toNumber(r.get('count'))
      }));

      // Get student registration trend
      const studentTrendResult = await session.run(`
        MATCH (s:Student)
        WHERE s.createdAt >= $startDate
        RETURN date(s.createdAt) as day, count(s) as count
        ORDER BY day
      `, { startDate: startDate.toISOString() });

      const studentTrend = studentTrendResult.records.map(r => ({
        date: r.get('day')?.toString() || '',
        count: toNumber(r.get('count'))
      }));

      // Get exam pass rates
      const examResult = await session.run(`
        MATCH (e:Exam)
        WHERE e.createdAt >= $startDate AND e.status = 'completed'
        RETURN e.type as examType,
               count(e) as total,
               sum(CASE WHEN e.result CONTAINS '"passed":true' THEN 1 ELSE 0 END) as passed
      `, { startDate: startDate.toISOString() });

      const examStats = examResult.records.map(r => ({
        type: r.get('examType') || 'unknown',
        total: toNumber(r.get('total')),
        passed: toNumber(r.get('passed'))
      }));

      // Get suspension counts
      const suspensionResult = await session.run(`
        MATCH (log:SuspensionLog)
        WHERE log.createdAt >= datetime($startDate)
        RETURN log.action as action, log.targetType as targetType, count(log) as count
      `, { startDate: startDate.toISOString() });

      const suspensionStats = suspensionResult.records.map(r => ({
        action: r.get('action') || '',
        targetType: r.get('targetType') || '',
        count: toNumber(r.get('count'))
      }));

      // Get current counts
      const countsResult = await session.run(`
        OPTIONAL MATCH (u:User)
        WITH count(u) as tutorCount
        OPTIONAL MATCH (s:Student)
        WITH tutorCount, count(s) as studentCount
        OPTIONAL MATCH (u2:User) WHERE u2.suspendedUntil IS NOT NULL AND u2.suspendedUntil > datetime()
        WITH tutorCount, studentCount, count(u2) as suspendedTutors
        OPTIONAL MATCH (s2:Student) WHERE s2.suspendedUntil IS NOT NULL AND s2.suspendedUntil > datetime()
        RETURN tutorCount, studentCount, suspendedTutors, count(s2) as suspendedStudents
      `);

      const counts = countsResult.records[0];
      const totalTutors = counts ? toNumber(counts.get('tutorCount')) : 0;
      const totalStudents = counts ? toNumber(counts.get('studentCount')) : 0;
      const suspendedTutors = counts ? toNumber(counts.get('suspendedTutors')) : 0;
      const suspendedStudents = counts ? toNumber(counts.get('suspendedStudents')) : 0;

      return {
        period,
        tutorTrend,
        studentTrend,
        examStats,
        suspensionStats,
        summary: {
          totalTutors,
          totalStudents,
          suspendedTutors,
          suspendedStudents,
          newTutors: tutorTrend.reduce((sum, t) => sum + t.count, 0),
          newStudents: studentTrend.reduce((sum, s) => sum + s.count, 0)
        }
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get suspension analytics
   */
  async getSuspensionAnalytics(): Promise<SuspensionAnalytics> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get all suspension logs with details
      const result = await session.run(`
        MATCH (log:SuspensionLog)
        OPTIONAL MATCH (log)-[:SUSPENDED_BY]->(admin:Admin)
        RETURN log, admin.username as adminName
        ORDER BY log.createdAt DESC
        LIMIT 100
      `);

      const logs = result.records.map(r => {
        const log = r.get('log').properties;
        return {
          id: log.id,
          action: log.action,
          reason: log.reason,
          targetType: log.targetType,
          createdAt: log.createdAt?.toString() || '',
          adminName: r.get('adminName') || null
        };
      });

      // Get reason distribution
      const reasonResult = await session.run(`
        MATCH (log:SuspensionLog)
        WHERE log.action = 'suspended'
        RETURN log.reason as reason, count(log) as count
        ORDER BY count DESC
        LIMIT 10
      `);

      const reasonDistribution = reasonResult.records.map(r => ({
        reason: r.get('reason') || 'Unknown',
        count: toNumber(r.get('count'))
      }));

      // Get monthly trend
      const monthlyResult = await session.run(`
        MATCH (log:SuspensionLog)
        WHERE log.createdAt >= datetime() - duration('P6M')
        RETURN date(log.createdAt).month as month, date(log.createdAt).year as year,
               log.action as action, count(log) as count
        ORDER BY year, month
      `);

      const monthlyTrend = monthlyResult.records.map(r => ({
        month: toNumber(r.get('month')),
        year: toNumber(r.get('year')),
        action: r.get('action') || '',
        count: toNumber(r.get('count'))
      }));

      return {
        recentLogs: logs,
        reasonDistribution,
        monthlyTrend
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get all sessions/bookings with filters for admin dashboard
   */
  async getAllSessions(params: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    sessions: SessionListItem[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const driver = getDriver();
    const session = driver.session();
    const { page, limit, status, search, startDate, endDate } = params;
    const skip = (page - 1) * limit;

    try {
      // Build WHERE conditions
      let whereConditions: string[] = [];
      let queryParams: any = { skip: neo4j.int(skip), limit: neo4j.int(limit) };

      if (status && status !== 'all') {
        whereConditions.push('b.status = $status');
        queryParams.status = status;
      }

      if (startDate) {
        whereConditions.push('slot.slotDate >= $startDate');
        queryParams.startDate = startDate;
      }

      if (endDate) {
        whereConditions.push('slot.slotDate <= $endDate');
        queryParams.endDate = endDate;
      }

      if (search) {
        whereConditions.push('(toLower(tutor.givenName + " " + tutor.familyName) CONTAINS toLower($search) OR toLower(student.givenName + " " + student.familyName) CONTAINS toLower($search) OR toLower(tutor.email) CONTAINS toLower($search) OR toLower(student.email) CONTAINS toLower($search))');
        queryParams.search = search;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Get sessions with pagination
      const result = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(student:Student)
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        MATCH (tutor:User {id: b.tutorId})
        ${whereClause}
        RETURN b, slot, tutor, student
        ORDER BY slot.slotDate DESC, slot.slotTime DESC
        SKIP $skip
        LIMIT $limit
        `,
        queryParams
      );

      // Get total count
      const countResult = await session.run(
        `
        MATCH (b:Booking)-[:BOOKED_BY]->(student:Student)
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        MATCH (slot)-[:OPENS_SLOT]-(tutor:User)
        ${whereClause}
        RETURN count(b) as total
        `,
        queryParams
      );

      const total = toNumber(countResult.records[0]?.get('total')) || 0;

      const sessions: SessionListItem[] = result.records.map(record => {
        const booking = record.get('b').properties;
        const slot = record.get('slot').properties;
        const tutor = record.get('tutor').properties;
        const student = record.get('student').properties;

        return {
          id: booking.bookingId,
          tutorId: tutor.id,
          tutorName: `${tutor.givenName || ''} ${tutor.familyName || ''}`.trim() || tutor.email,
          tutorEmail: tutor.email,
          tutorAvatar: tutor.profilePicture,
          studentId: student.id,
          studentName: `${student.givenName || ''} ${student.familyName || ''}`.trim() || student.email,
          studentEmail: student.email,
          studentAvatar: student.profilePicture,
          slotDate: slot.slotDate,
          slotTime: slot.slotTime,
          durationMinutes: parseInt(slot.durationMinutes) || 25,
          status: booking.status,
          attendanceTutor: booking.attendanceTutor || null,
          attendanceStudent: booking.attendanceStudent || null,
          bookedAt: booking.bookedAt,
          completedAt: booking.completedAt || null,
          cancelledAt: booking.cancelledAt || null,
          cancelReason: booking.cancelReason || null
        };
      });

      return {
        sessions,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get session statistics for dashboard
   */
  async getSessionStats(): Promise<SessionStats> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const now = Date.now(), pht = new Date(now + 8 * 3600000);
      const today = pht.toISOString().slice(0, 10), month = today.slice(0, 7);
      const weekStart = new Date(now + 8 * 3600000 - (pht.getUTCDay() + 6) % 7 * 86400000).toISOString().slice(0, 10);
      const rows = (await session.run('MATCH (b:Booking) RETURN b')).records.map(r => plainNode(r.get('b').properties));
      const attended = rows.filter(b => metricOutcome(b, now) === 'attended');
      const ended = rows.filter(b => b.status !== 'cancelled' && Date.parse(b.slotDateTime) + (Number(b.durationMinutes) || 25) * 60000 <= now);
      const date = (b: any) => Number.isFinite(Date.parse(b.slotDateTime)) ? new Date(Date.parse(b.slotDateTime) + 8 * 3600000).toISOString().slice(0, 10) : '';
      return {
        totalBookings: rows.length, completedSessions: attended.length,
        cancelledSessions: rows.filter(b => b.status === 'cancelled').length,
        upcomingSessions: rows.filter(b => b.status === 'confirmed' && Date.parse(b.slotDateTime) > now).length,
        todaySessions: rows.filter(b => date(b) === today).length,
        thisWeekSessions: rows.filter(b => date(b) >= weekStart && date(b) <= today).length,
        thisMonthSessions: rows.filter(b => date(b).startsWith(month)).length,
        noShowSessions: ended.filter(b => b.attendanceTutor === 'absent').length,
        completionRate: ended.length ? Math.round(attended.length / ended.length * 100) : 0,
        totalHours: Math.round(attended.reduce((sum, b) => sum + (Number(b.durationMinutes) || 25), 0) / 60 * 100) / 100,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get detailed session information by ID
   */
  async getSessionDetails(sessionId: string): Promise<SessionDetails | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (b:Booking {bookingId: $sessionId})-[:BOOKED_BY]->(student:Student)
        MATCH (b)-[:BOOKS]->(slot:TimeSlot)
        MATCH (slot)-[:OPENS_SLOT]-(tutor:User)
        RETURN b, slot, tutor, student
        `,
        { sessionId }
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0]!;
      const booking = record.get('b').properties;
      const slot = record.get('slot').properties;
      const tutor = record.get('tutor').properties;
      const student = record.get('student').properties;

      return {
        id: booking.bookingId,
        tutor: {
          id: tutor.id,
          name: `${tutor.givenName || ''} ${tutor.familyName || ''}`.trim() || tutor.email,
          email: tutor.email,
          avatar: tutor.profilePicture
        },
        student: {
          id: student.id,
          name: `${student.givenName || ''} ${student.familyName || ''}`.trim() || student.email,
          email: student.email,
          avatar: student.profilePicture
        },
        schedule: {
          date: slot.slotDate,
          time: slot.slotTime,
          durationMinutes: parseInt(slot.durationMinutes) || 25,
          timezone: 'PHT'
        },
        status: booking.status,
        attendance: {
          tutor: booking.attendanceTutor || null,
          student: booking.attendanceStudent || null
        },
        timestamps: {
          bookedAt: convertNeo4jDateTimeToISO(booking.bookedAt) || '',
          completedAt: booking.completedAt ? convertNeo4jDateTimeToISO(booking.completedAt) : null,
          cancelledAt: booking.cancelledAt ? convertNeo4jDateTimeToISO(booking.cancelledAt) : null
        },
        cancelReason: booking.cancelReason || null,
        ticketUsed: booking.ticketId || null
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get ticket statistics
   */
  async getTicketStats(): Promise<{
    totalPurchases: number;
    totalUsed: number;
    totalRefunded: number;
    revenueBasic: number;
    revenuePremium: number;
    revenueTrial: number;
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (t:TicketTransaction)
        RETURN 
          count(CASE WHEN t.type = 'purchase' THEN 1 END) as totalPurchases,
          count(CASE WHEN t.type = 'booking' THEN 1 END) as totalUsed,
          count(CASE WHEN t.type = 'refund' THEN 1 END) as totalRefunded,
          sum(CASE WHEN t.type = 'purchase' AND t.tier = 'basic' THEN toInteger(t.quantity) ELSE 0 END) as basicPurchased,
          sum(CASE WHEN t.type = 'purchase' AND t.tier = 'premium' THEN toInteger(t.quantity) ELSE 0 END) as premiumPurchased,
          sum(CASE WHEN t.type = 'purchase' AND t.tier = 'trial' THEN toInteger(t.quantity) ELSE 0 END) as trialPurchased
      `);

      const record = result.records[0];
      return {
        totalPurchases: toNumber(record?.get('totalPurchases')),
        totalUsed: toNumber(record?.get('totalUsed')),
        totalRefunded: toNumber(record?.get('totalRefunded')),
        revenueBasic: toNumber(record?.get('basicPurchased')),
        revenuePremium: toNumber(record?.get('premiumPurchased')),
        revenueTrial: toNumber(record?.get('trialPurchased'))
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get ticket transactions with pagination
   */
  async getTicketTransactions(params: {
    page: number;
    limit: number;
    type?: string;
    studentId?: string;
  }): Promise<{
    transactions: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const offset = (params.page - 1) * params.limit;
      
      // Build where clause
      let whereClause = '';
      const queryParams: any = { offset, limit: params.limit };
      
      if (params.type) {
        whereClause = 'WHERE t.type = $type';
        queryParams.type = params.type;
      }
      if (params.studentId) {
        whereClause = whereClause ? `${whereClause} AND t.studentId = $studentId` : 'WHERE t.studentId = $studentId';
        queryParams.studentId = params.studentId;
      }

      // Get total count
      const countResult = await session.run(`
        MATCH (t:TicketTransaction)
        ${whereClause}
        RETURN count(t) as total
      `, queryParams);
      const total = toNumber(countResult.records[0]?.get('total'));

      // Get transactions
      const result = await session.run(`
        MATCH (t:TicketTransaction)
        ${whereClause}
        RETURN t
        ORDER BY t.createdAt DESC
        SKIP toInteger($offset)
        LIMIT toInteger($limit)
      `, queryParams);

      const transactions = result.records.map((r: any) => {
        const tx = r.get('t').properties;
        return {
          id: tx.id,
          type: tx.type,
          studentId: tx.studentId,
          tutorId: tx.tutorId,
          bookingId: tx.bookingId,
          tier: tx.tier,
          quantity: toNumber(tx.quantity) || 1,
          txHash: tx.transferTxHash,
          createdAt: convertNeo4jDateTimeToISO(tx.createdAt)
        };
      });

      return {
        transactions,
        total,
        page: params.page,
        totalPages: Math.ceil(total / params.limit)
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get fraud alerts - suspicious booking patterns
   */
  async getFraudAlerts(params: {
    page: number;
    limit: number;
    severity?: string;
  }): Promise<{
    alerts: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const alerts: any[] = [];
      
      // Check for rapid booking attempts (more than 10 in 5 minutes)
      const rapidBookingResult = await session.run(`
        MATCH (b:Booking)
        WHERE b.bookedAt > datetime() - duration('PT5M')
        WITH b.studentId as studentId, count(b) as bookingCount
        WHERE bookingCount > 10
        RETURN studentId, bookingCount, 'rapid_booking' as alertType
      `);
      
      for (const record of rapidBookingResult.records) {
        alerts.push({
          id: `rapid_${record.get('studentId')}`,
          type: 'rapid_booking',
          severity: 'high',
          studentId: record.get('studentId'),
          details: `${toNumber(record.get('bookingCount'))} bookings in 5 minutes`,
          detectedAt: new Date().toISOString()
        });
      }

      // Check for repeated cancellations (more than 5 cancellations today)
      const cancelResult = await session.run(`
        MATCH (b:Booking)
        WHERE b.status = 'cancelled' 
        AND b.cancelledAt > datetime() - duration('P1D')
        WITH b.studentId as studentId, count(b) as cancelCount
        WHERE cancelCount > 5
        RETURN studentId, cancelCount, 'excessive_cancellation' as alertType
      `);
      
      for (const record of cancelResult.records) {
        alerts.push({
          id: `cancel_${record.get('studentId')}`,
          type: 'excessive_cancellation',
          severity: 'medium',
          studentId: record.get('studentId'),
          details: `${toNumber(record.get('cancelCount'))} cancellations in 24 hours`,
          detectedAt: new Date().toISOString()
        });
      }

      // Check for reused transaction hashes
      const txReuseResult = await session.run(`
        MATCH (t:TicketTransaction)
        WITH t.transferTxHash as txHash, count(t) as useCount
        WHERE useCount > 1 AND txHash IS NOT NULL
        RETURN txHash, useCount
      `);
      
      for (const record of txReuseResult.records) {
        alerts.push({
          id: `txreuse_${record.get('txHash')}`,
          type: 'transaction_reuse_attempt',
          severity: 'high',
          details: `TX hash used ${toNumber(record.get('useCount'))} times: ${record.get('txHash')}`,
          detectedAt: new Date().toISOString()
        });
      }

      // Filter by severity if provided
      let filteredAlerts = alerts;
      if (params.severity) {
        filteredAlerts = alerts.filter(a => a.severity === params.severity);
      }

      // Sort by severity (high first) then by date
      filteredAlerts.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return (severityOrder[a.severity as keyof typeof severityOrder] || 2) - 
               (severityOrder[b.severity as keyof typeof severityOrder] || 2);
      });

      // Paginate
      const total = filteredAlerts.length;
      const offset = (params.page - 1) * params.limit;
      const paginatedAlerts = filteredAlerts.slice(offset, offset + params.limit);

      return {
        alerts: paginatedAlerts,
        total,
        page: params.page,
        totalPages: Math.ceil(total / params.limit)
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get real-time monitoring data
   */
  async getRealtimeMonitoring(): Promise<{
    activeUsers: number;
    bookingsToday: number;
    bookingsThisHour: number;
    cancellationsToday: number;
    ticketsPurchasedToday: number;
    ticketsUsedToday: number;
    pendingSlots: number;
    systemHealth: 'healthy' | 'degraded' | 'critical';
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Active sessions (students with recent activity)
      const activeResult = await session.run(`
        MATCH (s:Student)
        WHERE s.lastActivityAt > datetime() - duration('PT15M')
        RETURN count(s) as activeUsers
      `);
      const activeUsers = toNumber(activeResult.records[0]?.get('activeUsers'));

      // Today's bookings
      const todayBookingsResult = await session.run(`
        MATCH (b:Booking)
        WHERE b.bookedAt > datetime() - duration('P1D')
        RETURN count(b) as count
      `);
      const bookingsToday = toNumber(todayBookingsResult.records[0]?.get('count'));

      // This hour's bookings
      const hourBookingsResult = await session.run(`
        MATCH (b:Booking)
        WHERE b.bookedAt > datetime() - duration('PT1H')
        RETURN count(b) as count
      `);
      const bookingsThisHour = toNumber(hourBookingsResult.records[0]?.get('count'));

      // Today's cancellations
      const cancelResult = await session.run(`
        MATCH (b:Booking)
        WHERE b.status = 'cancelled' AND b.cancelledAt > datetime() - duration('P1D')
        RETURN count(b) as count
      `);
      const cancellationsToday = toNumber(cancelResult.records[0]?.get('count'));

      // Tickets purchased today
      const purchaseResult = await session.run(`
        MATCH (t:TicketTransaction)
        WHERE t.type = 'purchase' AND t.createdAt > datetime() - duration('P1D')
        RETURN count(t) as count
      `);
      const ticketsPurchasedToday = toNumber(purchaseResult.records[0]?.get('count'));

      // Tickets used today
      const usedResult = await session.run(`
        MATCH (t:TicketTransaction)
        WHERE t.type = 'booking' AND t.createdAt > datetime() - duration('P1D')
        RETURN count(t) as count
      `);
      const ticketsUsedToday = toNumber(usedResult.records[0]?.get('count'));

      // Pending slots (locked but not confirmed)
      const pendingResult = await session.run(`
        MATCH (s:TimeSlot)
        WHERE s.status = 'pending'
        RETURN count(s) as count
      `);
      const pendingSlots = toNumber(pendingResult.records[0]?.get('count'));

      // Determine system health based on metrics
      let systemHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (pendingSlots > 50 || cancellationsToday > bookingsToday * 0.5) {
        systemHealth = 'degraded';
      }
      if (pendingSlots > 100) {
        systemHealth = 'critical';
      }

      return {
        activeUsers,
        bookingsToday,
        bookingsThisHour,
        cancellationsToday,
        ticketsPurchasedToday,
        ticketsUsedToday,
        pendingSlots,
        systemHealth
      };
    } finally {
      await session.close();
    }
  }
}

// Session types
interface SessionListItem {
  id: string;
  tutorId: string;
  tutorName: string;
  tutorEmail: string;
  tutorAvatar?: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentAvatar?: string;
  slotDate: string;
  slotTime: string;
  durationMinutes: number;
  status: string;
  attendanceTutor: string | null;
  attendanceStudent: string | null;
  bookedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

interface SessionStats {
  totalBookings: number;
  completedSessions: number;
  cancelledSessions: number;
  upcomingSessions: number;
  todaySessions: number;
  thisWeekSessions: number;
  thisMonthSessions: number;
  noShowSessions: number;
  completionRate: number;
  totalHours: number;
}

interface SessionDetails {
  id: string;
  tutor: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
  student: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
  schedule: {
    date: string;
    time: string;
    durationMinutes: number;
    timezone: string;
  };
  status: string;
  attendance: {
    tutor: string | null;
    student: string | null;
  };
  timestamps: {
    bookedAt: string;
    completedAt: string | null;
    cancelledAt: string | null;
  };
  cancelReason: string | null;
  ticketUsed: string | null;
}

interface AnalyticsData {
  period: string;
  tutorTrend: { date: string; count: number }[];
  studentTrend: { date: string; count: number }[];
  examStats: { type: string; total: number; passed: number }[];
  suspensionStats: { action: string; targetType: string; count: number }[];
  summary: {
    totalTutors: number;
    totalStudents: number;
    suspendedTutors: number;
    suspendedStudents: number;
    newTutors: number;
    newStudents: number;
  };
}

interface SuspensionAnalytics {
  recentLogs: {
    id: string;
    action: string;
    reason: string;
    targetType: string;
    createdAt: string;
    adminName: string | null;
  }[];
  reasonDistribution: { reason: string; count: number }[];
  monthlyTrend: { month: number; year: number; action: string; count: number }[];
}
