import { pool } from '../../db/postgres';

export interface LessonCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  children?: LessonCategory[];
}

export interface LessonTag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  usageCount: number;
  createdAt: Date;
}

class LessonCategoryService {
  /**
   * Get all categories as a flat list
   */
  async getAllCategories(): Promise<LessonCategory[]> {
    const result = await pool.query(`
      SELECT id, name, slug, description, parent_id, icon, color, sort_order, created_at, updated_at
      FROM lesson_categories
      ORDER BY sort_order, name
    `);
    return result.rows.map(this.mapCategoryRow);
  }

  /**
   * Get categories as a hierarchical tree
   */
  async getCategoryTree(): Promise<LessonCategory[]> {
    const categories = await this.getAllCategories();
    return this.buildTree(categories);
  }

  private buildTree(categories: LessonCategory[], parentId: string | null = null): LessonCategory[] {
    return categories
      .filter(cat => cat.parentId === parentId)
      .map(cat => ({
        ...cat,
        children: this.buildTree(categories, cat.id)
      }));
  }

  /**
   * Get a single category by ID or slug
   */
  async getCategory(idOrSlug: string): Promise<LessonCategory | null> {
    const result = await pool.query(`
      SELECT id, name, slug, description, parent_id, icon, color, sort_order, created_at, updated_at
      FROM lesson_categories
      WHERE id::text = $1 OR slug = $1
    `, [idOrSlug]);
    
    if (result.rows.length === 0) return null;
    return this.mapCategoryRow(result.rows[0]);
  }

  /**
   * Create a new category
   */
  async createCategory(data: {
    name: string;
    slug: string;
    description?: string;
    parentId?: string;
    icon?: string;
    color?: string;
    sortOrder?: number;
  }): Promise<{ success: boolean; category?: LessonCategory; error?: string }> {
    try {
      const result = await pool.query(`
        INSERT INTO lesson_categories (name, slug, description, parent_id, icon, color, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, slug, description, parent_id, icon, color, sort_order, created_at, updated_at
      `, [
        data.name,
        data.slug,
        data.description || null,
        data.parentId || null,
        data.icon || null,
        data.color || null,
        data.sortOrder || 0
      ]);

      return { success: true, category: this.mapCategoryRow(result.rows[0]) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Update a category
   */
  async updateCategory(id: string, data: Partial<{
    name: string;
    slug: string;
    description: string;
    parentId: string | null;
    icon: string;
    color: string;
    sortOrder: number;
  }>): Promise<{ success: boolean; category?: LessonCategory; error?: string }> {
    try {
      const setClauses: string[] = [];
      const values: (string | number | null)[] = [];
      let paramIndex = 1;

      if (data.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(data.name);
      }
      if (data.slug !== undefined) {
        setClauses.push(`slug = $${paramIndex++}`);
        values.push(data.slug);
      }
      if (data.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(data.description);
      }
      if (data.parentId !== undefined) {
        setClauses.push(`parent_id = $${paramIndex++}`);
        values.push(data.parentId);
      }
      if (data.icon !== undefined) {
        setClauses.push(`icon = $${paramIndex++}`);
        values.push(data.icon);
      }
      if (data.color !== undefined) {
        setClauses.push(`color = $${paramIndex++}`);
        values.push(data.color);
      }
      if (data.sortOrder !== undefined) {
        setClauses.push(`sort_order = $${paramIndex++}`);
        values.push(data.sortOrder);
      }

      if (setClauses.length === 0) {
        return { success: false, error: 'No fields to update' };
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(id);

      const result = await pool.query(`
        UPDATE lesson_categories
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, name, slug, description, parent_id, icon, color, sort_order, created_at, updated_at
      `, values);

      if (result.rows.length === 0) {
        return { success: false, error: 'Category not found' };
      }

      return { success: true, category: this.mapCategoryRow(result.rows[0]) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Delete a category
   */
  async deleteCategory(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await pool.query(`DELETE FROM lesson_categories WHERE id = $1`, [id]);
      if (result.rowCount === 0) {
        return { success: false, error: 'Category not found' };
      }
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private mapCategoryRow(row: Record<string, unknown>): LessonCategory {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: row.description as string | null,
      parentId: row.parent_id as string | null,
      icon: row.icon as string | null,
      color: row.color as string | null,
      sortOrder: row.sort_order as number,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string)
    };
  }
}

class LessonTagService {
  /**
   * Get all tags
   */
  async getAllTags(): Promise<LessonTag[]> {
    const result = await pool.query(`
      SELECT id, name, slug, color, usage_count, created_at
      FROM lesson_tags
      ORDER BY usage_count DESC, name
    `);
    return result.rows.map(this.mapTagRow);
  }

  /**
   * Get popular tags (most used)
   */
  async getPopularTags(limit = 20): Promise<LessonTag[]> {
    const result = await pool.query(`
      SELECT id, name, slug, color, usage_count, created_at
      FROM lesson_tags
      ORDER BY usage_count DESC
      LIMIT $1
    `, [limit]);
    return result.rows.map(this.mapTagRow);
  }

  /**
   * Search tags by name
   */
  async searchTags(query: string): Promise<LessonTag[]> {
    const result = await pool.query(`
      SELECT id, name, slug, color, usage_count, created_at
      FROM lesson_tags
      WHERE name ILIKE $1 OR slug ILIKE $1
      ORDER BY usage_count DESC
      LIMIT 20
    `, [`%${query}%`]);
    return result.rows.map(this.mapTagRow);
  }

  /**
   * Get tags for a lesson
   */
  async getTagsForLesson(lessonId: string): Promise<LessonTag[]> {
    const result = await pool.query(`
      SELECT t.id, t.name, t.slug, t.color, t.usage_count, t.created_at
      FROM lesson_tags t
      JOIN lesson_tag_assignments lta ON t.id = lta.tag_id
      WHERE lta.lesson_id = $1
      ORDER BY t.name
    `, [lessonId]);
    return result.rows.map(this.mapTagRow);
  }

  /**
   * Create a new tag
   */
  async createTag(data: {
    name: string;
    slug: string;
    color?: string;
  }): Promise<{ success: boolean; tag?: LessonTag; error?: string }> {
    try {
      const result = await pool.query(`
        INSERT INTO lesson_tags (name, slug, color)
        VALUES ($1, $2, $3)
        RETURNING id, name, slug, color, usage_count, created_at
      `, [data.name, data.slug, data.color || null]);

      return { success: true, tag: this.mapTagRow(result.rows[0]) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Assign tags to a lesson
   */
  async assignTagsToLesson(lessonId: string, tagIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      // Remove existing tags
      await pool.query(`DELETE FROM lesson_tag_assignments WHERE lesson_id = $1`, [lessonId]);

      // Add new tags
      for (const tagId of tagIds) {
        await pool.query(`
          INSERT INTO lesson_tag_assignments (lesson_id, tag_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [lessonId, tagId]);
      }

      // Update usage counts
      await pool.query(`
        UPDATE lesson_tags SET usage_count = (
          SELECT COUNT(*) FROM lesson_tag_assignments WHERE tag_id = lesson_tags.id
        )
      `);

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Delete a tag
   */
  async deleteTag(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await pool.query(`DELETE FROM lesson_tags WHERE id = $1`, [id]);
      if (result.rowCount === 0) {
        return { success: false, error: 'Tag not found' };
      }
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private mapTagRow(row: Record<string, unknown>): LessonTag {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      color: row.color as string | null,
      usageCount: row.usage_count as number,
      createdAt: new Date(row.created_at as string)
    };
  }
}

export const lessonCategoryService = new LessonCategoryService();
export const lessonTagService = new LessonTagService();
