import { getDriver } from '../../db/memgraph';
import crypto from 'crypto';

/**
 * Suspension Job Service
 * Handles automatic unsuspension of users when their suspension period expires
 */
export class SuspensionJobService {
  
  /**
   * Check for expired suspensions and automatically unsuspend users
   * Should be called periodically (e.g., every hour)
   */
  async processExpiredSuspensions(): Promise<{ tutors: number; students: number }> {
    const driver = getDriver();
    const session = driver.session();
    
    let tutorsUnsuspended = 0;
    let studentsUnsuspended = 0;
    
    try {
      const now = new Date().toISOString();
      
      // Find and unsuspend tutors with expired suspensions
      const tutorResult = await session.run(`
        MATCH (u:User)
        WHERE u.suspendedUntil IS NOT NULL
          AND u.suspendedUntil < $now
        WITH u
        CREATE (log:SuspensionLog {
          id: $logId,
          action: 'auto-unsuspended',
          reason: 'Suspension period expired',
          previousSuspendedUntil: u.suspendedUntil,
          previousReason: u.suspendedReason,
          createdAt: datetime(),
          targetType: 'tutor'
        })
        CREATE (u)-[:HAS_SUSPENSION]->(log)
        WITH u
        REMOVE u.suspendedUntil, u.suspendedReason, u.suspendedAt
        RETURN count(u) as count
      `, { now, logId: crypto.randomUUID() });
      
      tutorsUnsuspended = tutorResult.records[0]?.get('count')?.toNumber?.() || 
                          tutorResult.records[0]?.get('count') || 0;
      
      // Find and unsuspend students with expired suspensions
      const studentResult = await session.run(`
        MATCH (s:Student)
        WHERE s.suspendedUntil IS NOT NULL
          AND s.suspendedUntil < $now
        WITH s
        CREATE (log:SuspensionLog {
          id: $logId,
          action: 'auto-unsuspended',
          reason: 'Suspension period expired',
          previousSuspendedUntil: s.suspendedUntil,
          previousReason: s.suspendedReason,
          createdAt: datetime(),
          targetType: 'student'
        })
        CREATE (s)-[:HAS_SUSPENSION]->(log)
        WITH s
        REMOVE s.suspendedUntil, s.suspendedReason, s.suspendedAt
        RETURN count(s) as count
      `, { now, logId: crypto.randomUUID() });
      
      studentsUnsuspended = studentResult.records[0]?.get('count')?.toNumber?.() || 
                            studentResult.records[0]?.get('count') || 0;
      
      return { tutors: tutorsUnsuspended, students: studentsUnsuspended };
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get count of currently suspended users
   */
  async getSuspendedCounts(): Promise<{ tutors: number; students: number }> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const now = new Date().toISOString();
      
      const result = await session.run(`
        OPTIONAL MATCH (u:User)
        WHERE u.suspendedUntil IS NOT NULL AND u.suspendedUntil > $now
        WITH count(u) as tutorCount
        OPTIONAL MATCH (s:Student)
        WHERE s.suspendedUntil IS NOT NULL AND s.suspendedUntil > $now
        RETURN tutorCount, count(s) as studentCount
      `, { now });
      
      const tutors = result.records[0]?.get('tutorCount')?.toNumber?.() || 
                     result.records[0]?.get('tutorCount') || 0;
      const students = result.records[0]?.get('studentCount')?.toNumber?.() || 
                       result.records[0]?.get('studentCount') || 0;
      
      return { tutors, students };
    } finally {
      await session.close();
    }
  }
  
  /**
   * Get suspension history for a specific user
   */
  async getSuspensionHistory(userId: string, userType: 'tutor' | 'student'): Promise<SuspensionHistoryItem[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const nodeLabel = userType === 'tutor' ? 'User' : 'Student';
      
      const result = await session.run(`
        MATCH (u:${nodeLabel} {id: $userId})-[:HAS_SUSPENSION]->(log:SuspensionLog)
        OPTIONAL MATCH (log)-[:SUSPENDED_BY]->(admin:Admin)
        OPTIONAL MATCH (log)-[:UNSUSPENDED_BY]->(unsuspendAdmin:Admin)
        RETURN log, admin.username as suspendedBy, unsuspendAdmin.username as unsuspendedBy
        ORDER BY log.createdAt DESC
      `, { userId });
      
      return result.records.map(record => {
        const log = record.get('log').properties;
        return {
          id: log.id,
          action: log.action,
          reason: log.reason,
          until: log.until,
          previousSuspendedUntil: log.previousSuspendedUntil,
          previousReason: log.previousReason,
          createdAt: log.createdAt,
          targetType: log.targetType,
          suspendedBy: record.get('suspendedBy'),
          unsuspendedBy: record.get('unsuspendedBy')
        };
      });
    } finally {
      await session.close();
    }
  }
}

export interface SuspensionHistoryItem {
  id: string;
  action: 'suspended' | 'unsuspended' | 'auto-unsuspended';
  reason: string;
  until?: string;
  previousSuspendedUntil?: string;
  previousReason?: string;
  createdAt: string;
  targetType: 'tutor' | 'student';
  suspendedBy?: string;
  unsuspendedBy?: string;
}

// Singleton instance
const suspensionJobService = new SuspensionJobService();

/**
 * Start the auto-unsuspend background job
 * Runs every hour to check for expired suspensions
 */
export function startSuspensionJob(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  
  
  // Skip initial run on startup - just schedule the hourly interval
  // This avoids race conditions with database initialization
  
  // Run periodically (first run will be after 1 hour)
  setInterval(async () => {
    try {
      const result = await suspensionJobService.processExpiredSuspensions();
      if (result.tutors > 0 || result.students > 0) {
      }
    } catch (err: any) {
      // Just log the error message, not the full stack trace
      console.warn('⚠️ Suspension job skipped:', err?.message || 'Database unavailable');
    }
  }, INTERVAL_MS);
}

export { suspensionJobService };
