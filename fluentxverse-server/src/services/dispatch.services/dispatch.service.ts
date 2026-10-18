/**
 * Daily Dispatch Service
 * Memgraph operations for :DispatchArticle nodes
 */
import { getDriver } from '../../db/memgraph';
import { v4 as uuidv4 } from 'uuid';
import neo4j from 'neo4j-driver';

// ============================================================================
// TYPES
// ============================================================================

export interface VocabularyWord {
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  exampleSentence: string;
  additionalInfo: string | null;
}

export interface ArticleQuestion {
  question: string;
  answer: string;
}

export interface Paragraph {
  id: string;
  text: string;
  question: ArticleQuestion | null;
}

export interface ArticleContent {
  paragraphs: Paragraph[];
  source: string;
}

export interface Discussion {
  topic: string;
  questions: string[];
}

export interface StoredLesson {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  postedDate: string;
  category: string;
  topic: string;
  warmUpQuestions: string[];
  vocabulary: VocabularyWord[];
  articleContent: ArticleContent;
  summaryQuestion: string;
  discussionA: Discussion;
  discussionB: Discussion;
  status?: 'draft' | 'published';
  createdBy?: string;
}

export interface DispatchArticleListItem {
  id: string;
  title: string;
  topic: string;
  category: string;
  postedDate: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  excerpt?: string;
}

export interface DispatchFilters {
  category?: string;
  topic?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateDispatchInput {
  title: string;
  postedDate: string;
  category: string;
  topic: string;
  warmUpQuestions: string[];
  vocabulary: VocabularyWord[];
  articleContent: ArticleContent;
  summaryQuestion: string;
  discussionA: Discussion;
  discussionB: Discussion;
  createdBy?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

class DispatchService {
  async classroomLibrary(): Promise<DispatchArticleListItem[]> {
    const session = getDriver().session();
    try {
      // Legacy Dispatch articles were live before publication status was introduced.
      const result = await session.run(`MATCH (a:DispatchArticle)
        WHERE a.status = 'published' OR a.status IS NULL
        RETURN a.id AS id, a.title AS title, a.topic AS topic, a.category AS category,
               a.postedDate AS postedDate, a.createdAt AS createdAt, a.updatedAt AS updatedAt`);
      return result.records.map(record => ({
        id: record.get('id'), title: record.get('title'), topic: record.get('topic'),
        category: record.get('category'), postedDate: record.get('postedDate'),
        createdAt: record.get('createdAt'), updatedAt: record.get('updatedAt'), status: 'published',
      }));
    } finally { await session.close(); }
  }

  /**
   * List all dispatch articles
   */
  async list(filters: DispatchFilters = {}): Promise<DispatchArticleListItem[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      let query = `
        MATCH (a:DispatchArticle)
        WHERE 1=1
      `;
      const params: Record<string, any> = {};

      if (filters.category) {
        query += ` AND a.category = $category`;
        params.category = filters.category;
      }

      if (filters.topic) {
        query += ` AND a.topic CONTAINS $topic`;
        params.topic = filters.topic;
      }

      if (filters.search) {
        query += ` AND (toLower(a.title) CONTAINS toLower($search) OR toLower(a.topic) CONTAINS toLower($search))`;
        params.search = filters.search;
      }

      query += `
        RETURN a
        ORDER BY a.createdAt DESC
        SKIP $offset
        LIMIT $limit
      `;
      params.offset = neo4j.int(filters.offset || 0);
      params.limit = neo4j.int(filters.limit || 50);

      const result = await session.run(query, params);
      
      return result.records.map(record => {
        const node = record.get('a').properties;
        return {
          id: node.id,
          title: node.title,
          topic: node.topic,
          category: node.category,
          postedDate: node.postedDate,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          status: node.status || 'draft',
        };
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Get a single article by ID
   */
  async getById(id: string): Promise<StoredLesson | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (a:DispatchArticle {id: $id})
        RETURN a
        `,
        { id }
      );

      if (result.records.length === 0 || !result.records[0]) {
        return null;
      }

      const node = result.records[0].get('a').properties;
      return this.mapNodeToStoredLesson(node);
    } finally {
      await session.close();
    }
  }

  /**
   * Create a new dispatch article
   */
  async create(input: CreateDispatchInput): Promise<StoredLesson> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const id = uuidv4();
      const now = new Date().toISOString();

      const result = await session.run(
        `
        CREATE (a:DispatchArticle {
          id: $id,
          createdAt: $createdAt,
          updatedAt: $updatedAt,
          title: $title,
          postedDate: $postedDate,
          category: $category,
          topic: $topic,
          warmUpQuestions: $warmUpQuestions,
          vocabulary: $vocabulary,
          articleContent: $articleContent,
          summaryQuestion: $summaryQuestion,
          discussionA: $discussionA,
          discussionB: $discussionB,
          status: 'draft',
          createdBy: $createdBy
        })
        RETURN a
        `,
        {
          id,
          createdAt: now,
          updatedAt: now,
          title: input.title,
          postedDate: input.postedDate,
          category: input.category,
          topic: input.topic,
          warmUpQuestions: JSON.stringify(input.warmUpQuestions),
          vocabulary: JSON.stringify(input.vocabulary),
          articleContent: JSON.stringify(input.articleContent),
          summaryQuestion: input.summaryQuestion,
          discussionA: JSON.stringify(input.discussionA),
          discussionB: JSON.stringify(input.discussionB),
          createdBy: input.createdBy || null,
        }
      );

      if (result.records.length === 0 || !result.records[0]) {
        throw new Error('Failed to create article');
      }
      const node = result.records[0].get('a').properties;
      return this.mapNodeToStoredLesson(node);
    } finally {
      await session.close();
    }
  }

  /**
   * Update an existing dispatch article
   */
  async update(id: string, input: Partial<CreateDispatchInput>): Promise<StoredLesson | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Build dynamic SET clause
      const setClause: string[] = ['a.updatedAt = $updatedAt'];
      const params: Record<string, any> = {
        id,
        updatedAt: new Date().toISOString(),
      };

      if (input.title !== undefined) {
        setClause.push('a.title = $title');
        params.title = input.title;
      }
      if (input.postedDate !== undefined) {
        setClause.push('a.postedDate = $postedDate');
        params.postedDate = input.postedDate;
      }
      if (input.category !== undefined) {
        setClause.push('a.category = $category');
        params.category = input.category;
      }
      if (input.topic !== undefined) {
        setClause.push('a.topic = $topic');
        params.topic = input.topic;
      }
      if (input.warmUpQuestions !== undefined) {
        setClause.push('a.warmUpQuestions = $warmUpQuestions');
        params.warmUpQuestions = JSON.stringify(input.warmUpQuestions);
      }
      if (input.vocabulary !== undefined) {
        setClause.push('a.vocabulary = $vocabulary');
        params.vocabulary = JSON.stringify(input.vocabulary);
      }
      if (input.articleContent !== undefined) {
        setClause.push('a.articleContent = $articleContent');
        params.articleContent = JSON.stringify(input.articleContent);
      }
      if (input.summaryQuestion !== undefined) {
        setClause.push('a.summaryQuestion = $summaryQuestion');
        params.summaryQuestion = input.summaryQuestion;
      }
      if (input.discussionA !== undefined) {
        setClause.push('a.discussionA = $discussionA');
        params.discussionA = JSON.stringify(input.discussionA);
      }
      if (input.discussionB !== undefined) {
        setClause.push('a.discussionB = $discussionB');
        params.discussionB = JSON.stringify(input.discussionB);
      }

      const result = await session.run(
        `
        MATCH (a:DispatchArticle {id: $id})
        SET ${setClause.join(', ')}
        RETURN a
        `,
        params
      );

      if (result.records.length === 0 || !result.records[0]) {
        return null;
      }

      const node = result.records[0].get('a').properties;
      return this.mapNodeToStoredLesson(node);
    } finally {
      await session.close();
    }
  }

  /**
   * Delete a dispatch article
   */
  async delete(id: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (a:DispatchArticle {id: $id})
        DELETE a
        RETURN count(a) as deleted
        `,
        { id }
      );

      if (result.records.length === 0 || !result.records[0]) {
        return false;
      }

      const deleted = result.records[0].get('deleted').toNumber();
      return deleted > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Publish an article
   */
  async publish(id: string): Promise<StoredLesson | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (a:DispatchArticle {id: $id})
        SET a.status = 'published', a.updatedAt = $updatedAt
        RETURN a
        `,
        { id, updatedAt: new Date().toISOString() }
      );

      if (result.records.length === 0 || !result.records[0]) {
        return null;
      }

      const node = result.records[0].get('a').properties;
      return this.mapNodeToStoredLesson(node);
    } finally {
      await session.close();
    }
  }

  /**
   * Unpublish an article
   */
  async unpublish(id: string): Promise<StoredLesson | null> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (a:DispatchArticle {id: $id})
        SET a.status = 'draft', a.updatedAt = $updatedAt
        RETURN a
        `,
        { id, updatedAt: new Date().toISOString() }
      );

      if (result.records.length === 0 || !result.records[0]) {
        return null;
      }

      const node = result.records[0].get('a').properties;
      return this.mapNodeToStoredLesson(node);
    } finally {
      await session.close();
    }
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (a:DispatchArticle)
        RETURN DISTINCT a.category as category
        ORDER BY category
        `
      );

      return result.records.map(r => r.get('category'));
    } finally {
      await session.close();
    }
  }

  /**
   * Get all unique topics
   */
  async getTopics(category?: string): Promise<string[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      let query = `MATCH (a:DispatchArticle)`;
      const params: Record<string, any> = {};

      if (category) {
        query += ` WHERE a.category = $category`;
        params.category = category;
      }

      query += `
        RETURN DISTINCT a.topic as topic
        ORDER BY topic
      `;

      const result = await session.run(query, params);
      return result.records.map(r => r.get('topic'));
    } finally {
      await session.close();
    }
  }

  /**
   * Get article counts grouped by month for archives
   */
  async getArchives(): Promise<{ month: string; count: number }[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get all articles and group by month based on createdAt
      const result = await session.run(`
        MATCH (a:DispatchArticle)
        RETURN a.createdAt AS createdAt
        ORDER BY a.createdAt DESC
      `);

      // Group by month
      const monthCounts: Record<string, number> = {};
      
      for (const record of result.records) {
        const createdAt = record.get('createdAt');
        if (createdAt) {
          // Parse the date and get month/year
          const date = new Date(createdAt);
          if (!isNaN(date.getTime())) {
            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
          }
        }
      }

      // Convert to array and sort by date descending
      const archives = Object.entries(monthCounts).map(([month, count]) => ({
        month,
        count,
      }));

      // Sort by parsing the month string back to date
      archives.sort((a, b) => {
        const dateA = new Date(a.month);
        const dateB = new Date(b.month);
        return dateB.getTime() - dateA.getTime();
      });

      return archives;
    } finally {
      await session.close();
    }
  }

  /**
   * Get articles for a specific month (for archive view)
   */
  async getByMonth(month: string): Promise<DispatchArticleListItem[]> {
    const driver = getDriver();
    const session = driver.session();

    try {
      // Get all articles and filter by month using createdAt
      const result = await session.run(`
        MATCH (a:DispatchArticle)
        RETURN a
        ORDER BY a.createdAt DESC
      `);

      const articles: DispatchArticleListItem[] = [];

      for (const record of result.records) {
        const node = record.get('a').properties;
        const createdAt = node.createdAt;
        
        if (createdAt) {
          const date = new Date(createdAt);
          if (!isNaN(date.getTime())) {
            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (monthKey === month) {
              // Parse articleContent to get excerpt
              let excerpt = '';
              try {
                const content = typeof node.articleContent === 'string' 
                  ? JSON.parse(node.articleContent) 
                  : node.articleContent;
                if (content?.paragraphs?.[0]?.text) {
                  excerpt = content.paragraphs[0].text.slice(0, 200) + '...';
                }
              } catch (e) {
                // Ignore parse errors
              }

              articles.push({
                id: node.id,
                title: node.title,
                topic: node.topic,
                category: node.category,
                postedDate: node.postedDate,
                createdAt: node.createdAt,
                updatedAt: node.updatedAt,
                status: node.status || 'draft',
                excerpt,
              });
            }
          }
        }
      }

      return articles;
    } finally {
      await session.close();
    }
  }

  /**
   * Map Memgraph node to StoredLesson
   */
  private mapNodeToStoredLesson(node: Record<string, any>): StoredLesson {
    return {
      id: node.id,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      title: node.title,
      postedDate: node.postedDate,
      category: node.category,
      topic: node.topic,
      warmUpQuestions: this.parseJSON(node.warmUpQuestions, []),
      vocabulary: this.parseJSON(node.vocabulary, []),
      articleContent: this.parseJSON(node.articleContent, { paragraphs: [], source: '' }),
      summaryQuestion: node.summaryQuestion,
      discussionA: this.parseJSON(node.discussionA, { topic: '', questions: [] }),
      discussionB: this.parseJSON(node.discussionB, { topic: '', questions: [] }),
      status: node.status || 'draft',
      createdBy: node.createdBy,
    };
  }

  /**
   * Safely parse JSON with fallback
   */
  private parseJSON<T>(value: any, fallback: T): T {
    if (!value) return fallback;
    if (typeof value === 'object') return value as T;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
}

export const dispatchService = new DispatchService();
