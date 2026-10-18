import { getDriver } from '../../db/memgraph';
import { v4 as uuidv4 } from 'uuid';

export interface FavoriteTutor {
  id: string;
  tutorId: string;
  tutorName: string;
  tutorAvatar: string | null;
  addedAt: string;
}

export class FavoritesService {
  /**
   * Add a tutor to student's favorites
   * Creates a FAVORITES relationship between Student and User (tutor) nodes
   */
  async addFavorite(studentId: string, tutorId: string): Promise<{ success: boolean; message: string }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Check if already favorited
      const existingResult = await session.run(`
        MATCH (s:Student {id: $studentId})-[f:FAVORITES]->(t:User {id: $tutorId})
        RETURN f
      `, { studentId, tutorId });

      if (existingResult.records.length > 0) {
        return { success: true, message: 'Tutor is already in favorites' };
      }

      // Create FAVORITES relationship
      const favoriteId = uuidv4();
      await session.run(`
        MATCH (s:Student {id: $studentId})
        MATCH (t:User {id: $tutorId})
        CREATE (s)-[f:FAVORITES {
          id: $favoriteId,
          createdAt: datetime()
        }]->(t)
        RETURN f
      `, { studentId, tutorId, favoriteId });

      return { success: true, message: 'Tutor added to favorites' };
    } catch (error) {
      console.error('Error adding favorite:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Remove a tutor from student's favorites
   */
  async removeFavorite(studentId: string, tutorId: string): Promise<{ success: boolean; message: string }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.run(`
        MATCH (s:Student {id: $studentId})-[f:FAVORITES]->(t:User {id: $tutorId})
        DELETE f
      `, { studentId, tutorId });

      return { success: true, message: 'Tutor removed from favorites' };
    } catch (error) {
      console.error('Error removing favorite:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Check if a tutor is in student's favorites
   */
  async isFavorite(studentId: string, tutorId: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:Student {id: $studentId})-[f:FAVORITES]->(t:User {id: $tutorId})
        RETURN f
      `, { studentId, tutorId });

      return result.records.length > 0;
    } catch (error) {
      console.error('Error checking favorite:', error);
      return false;
    } finally {
      await session.close();
    }
  }

  /**
   * Get favorite tutors for a student with pagination
   * @param studentId - The student's ID
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page
   */
  async getFavorites(studentId: string, page: number = 1, limit: number = 10): Promise<{
    favorites: FavoriteTutor[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get total count first
      const countResult = await session.run(`
        MATCH (s:Student {id: $studentId})-[f:FAVORITES]->(t:User)
        RETURN count(f) AS total
      `, { studentId });
      
      const total = countResult.records[0]?.get('total')?.toNumber?.() || 
                    countResult.records[0]?.get('total') || 0;
      
      // Calculate offset - use neo4j.int for Memgraph compatibility
      const offset = (page - 1) * limit;
      
      // Get paginated results
      // Use toInteger() in Cypher to ensure proper integer type for Memgraph
      const result = await session.run(`
        MATCH (s:Student {id: $studentId})-[f:FAVORITES]->(t:User)
        RETURN 
          f.id AS id,
          t.id AS tutorId,
          t.firstName AS firstName,
          t.lastName AS lastName,
          t.profilePicture AS profilePicture,
          f.createdAt AS addedAt
        ORDER BY f.createdAt DESC
        SKIP toInteger($offset)
        LIMIT toInteger($limit)
      `, { studentId, offset, limit });

      const favorites = result.records.map((record: any) => {
        const firstName = record.get('firstName') || '';
        const lastName = record.get('lastName') || '';
        
        return {
          id: record.get('id') || uuidv4(),
          tutorId: record.get('tutorId'),
          tutorName: `${firstName} ${lastName}`.trim() || 'Unknown Tutor',
          tutorAvatar: record.get('profilePicture') || null,
          addedAt: record.get('addedAt')?.toString() || new Date().toISOString()
        };
      });
      
      return {
        favorites,
        total: Number(total),
        page,
        limit,
        totalPages: Math.ceil(Number(total) / limit)
      };
    } catch (error) {
      console.error('Error getting favorites:', error);
      return { favorites: [], total: 0, page, limit, totalPages: 0 };
    } finally {
      await session.close();
    }
  }

  /**
   * Get favorite tutor IDs for a student (for quick lookup)
   */
  async getFavoriteIds(studentId: string): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(`
        MATCH (s:Student {id: $studentId})-[:FAVORITES]->(t:User)
        RETURN t.id AS tutorId
      `, { studentId });

      return result.records.map((record: any) => record.get('tutorId'));
    } catch (error) {
      console.error('Error getting favorite IDs:', error);
      return [];
    } finally {
      await session.close();
    }
  }
}

export const favoritesService = new FavoritesService();
