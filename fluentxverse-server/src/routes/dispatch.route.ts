/**
 * Daily Dispatch Routes
 * API endpoints for managing Daily Dispatch articles (Memgraph :DispatchArticle)
 */
import { Elysia, t } from 'elysia';
import { dispatchService, type CreateDispatchInput } from '../services/dispatch.services/dispatch.service';
import { createAdminGuard, createAnyAuthGuard } from '../middleware/auth.middleware';

export const dispatchRoutes = new Elysia({ prefix: '/dispatch' })
  .get('/classroom-library', async ({ cookie, set }) => {
    const authPayload = await createAnyAuthGuard(cookie, set);
    if (!authPayload) {
      set.status = 401;
      return { success: false, error: 'Unauthorized' };
    }
    try {
      return { success: true, articles: await dispatchService.classroomLibrary() };
    } catch (error) {
      console.error('Error loading classroom article library:', error);
      set.status = 500;
      return { success: false, error: 'Could not load articles' };
    }
  })
  
  // ============================================================================
  // LIST ARTICLES
  // ============================================================================
  .get(
    '/',
    async ({ query, cookie, set }) => {
      const authPayload = await createAnyAuthGuard(cookie, set);
      if (!authPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const articles = await dispatchService.list({
          category: query.category,
          topic: query.topic,
          search: query.search,
          limit: query.limit ? parseInt(query.limit) : 50,
          offset: query.offset ? parseInt(query.offset) : 0,
        });
        
        return articles;
      } catch (error) {
        console.error('Error listing dispatch articles:', error);
        set.status = 500;
        return { success: false, error: 'Failed to list articles' };
      }
    },
    {
      query: t.Object({
        category: t.Optional(t.String()),
        topic: t.Optional(t.String()),
        search: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'List all dispatch articles',
      },
    }
  )

  // ============================================================================
  // GET ARCHIVES (article counts by month)
  // ============================================================================
  .get(
    '/archives',
    async ({ cookie, set }) => {
      const authPayload = await createAnyAuthGuard(cookie, set);
      if (!authPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const archives = await dispatchService.getArchives();
        return { success: true, archives };
      } catch (error) {
        console.error('Error getting dispatch archives:', error);
        set.status = 500;
        return { success: false, error: 'Failed to get archives' };
      }
    },
    {
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Get article counts grouped by month',
      },
    }
  )

  // ============================================================================
  // GET ARTICLES BY MONTH (for archive view)
  // ============================================================================
  .get(
    '/archives/:month',
    async ({ params, cookie, set }) => {
      const authPayload = await createAnyAuthGuard(cookie, set);
      if (!authPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        // Decode the month parameter (e.g., "January%202026" -> "January 2026")
        const month = decodeURIComponent(params.month);
        const articles = await dispatchService.getByMonth(month);
        return { success: true, month, articles };
      } catch (error) {
        console.error('Error getting articles by month:', error);
        set.status = 500;
        return { success: false, error: 'Failed to get articles' };
      }
    },
    {
      params: t.Object({
        month: t.String(),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Get articles for a specific month',
      },
    }
  )

  // ============================================================================
  // GET SINGLE ARTICLE
  // ============================================================================
  .get(
    '/:id',
    async ({ params, cookie, set }) => {
      const authPayload = await createAnyAuthGuard(cookie, set);
      if (!authPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const article = await dispatchService.getById(params.id);
        if (!article) {
          set.status = 404;
          return { success: false, error: 'Article not found' };
        }
        
        return article;
      } catch (error) {
        console.error('Error getting dispatch article:', error);
        set.status = 500;
        return { success: false, error: 'Failed to get article' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Get a single dispatch article by ID',
      },
    }
  )

  // ============================================================================
  // CREATE ARTICLE
  // ============================================================================
  .post(
    '/',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const article = await dispatchService.create({
          ...body,
          createdBy: adminPayload.userId,
        });
        
        return article;
      } catch (error) {
        console.error('Error creating dispatch article:', error);
        set.status = 500;
        return { success: false, error: 'Failed to create article' };
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        postedDate: t.String(),
        category: t.String(),
        topic: t.String(),
        warmUpQuestions: t.Array(t.String()),
        vocabulary: t.Array(t.Object({
          word: t.String(),
          pronunciation: t.String(),
          partOfSpeech: t.String(),
          definition: t.String(),
          exampleSentence: t.String(),
          additionalInfo: t.Union([t.String(), t.Null()]),
        })),
        articleContent: t.Object({
          paragraphs: t.Array(t.Object({
            id: t.String(),
            text: t.String(),
            question: t.Union([
              t.Object({
                question: t.String(),
                answer: t.String(),
              }),
              t.Null(),
            ]),
          })),
          source: t.String(),
        }),
        summaryQuestion: t.String(),
        discussionA: t.Object({
          topic: t.String(),
          questions: t.Array(t.String()),
        }),
        discussionB: t.Object({
          topic: t.String(),
          questions: t.Array(t.String()),
        }),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Create a new dispatch article',
      },
    }
  )

  // ============================================================================
  // UPDATE ARTICLE
  // ============================================================================
  .put(
    '/:id',
    async ({ params, body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const article = await dispatchService.update(params.id, body as Partial<CreateDispatchInput>);
        if (!article) {
          set.status = 404;
          return { success: false, error: 'Article not found' };
        }
        
        return article;
      } catch (error) {
        console.error('Error updating dispatch article:', error);
        set.status = 500;
        return { success: false, error: 'Failed to update article' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Update a dispatch article',
      },
    }
  )

  // ============================================================================
  // DELETE ARTICLE
  // ============================================================================
  .delete(
    '/:id',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        await dispatchService.delete(params.id);
        return { success: true };
      } catch (error) {
        console.error('Error deleting dispatch article:', error);
        set.status = 500;
        return { success: false, error: 'Failed to delete article' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Delete a dispatch article',
      },
    }
  )

  // ============================================================================
  // PUBLISH ARTICLE
  // ============================================================================
  .post(
    '/:id/publish',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const article = await dispatchService.publish(params.id);
        if (!article) {
          set.status = 404;
          return { success: false, error: 'Article not found' };
        }
        
        return article;
      } catch (error) {
        console.error('Error publishing dispatch article:', error);
        set.status = 500;
        return { success: false, error: 'Failed to publish article' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Publish a dispatch article',
      },
    }
  )

  // ============================================================================
  // UNPUBLISH ARTICLE
  // ============================================================================
  .post(
    '/:id/unpublish',
    async ({ params, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const article = await dispatchService.unpublish(params.id);
        if (!article) {
          set.status = 404;
          return { success: false, error: 'Article not found' };
        }
        
        return article;
      } catch (error) {
        console.error('Error unpublishing dispatch article:', error);
        set.status = 500;
        return { success: false, error: 'Failed to unpublish article' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Unpublish a dispatch article',
      },
    }
  )

  // ============================================================================
  // GET CATEGORIES
  // ============================================================================
  .get(
    '/categories',
    async ({ cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const categories = await dispatchService.getCategories();
        return categories;
      } catch (error) {
        console.error('Error getting categories:', error);
        set.status = 500;
        return { success: false, error: 'Failed to get categories' };
      }
    },
    {
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Get all unique categories',
      },
    }
  )

  // ============================================================================
  // GET TOPICS
  // ============================================================================
  .get(
    '/topics',
    async ({ query, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      
      try {
        const topics = await dispatchService.getTopics(query.category);
        return topics;
      } catch (error) {
        console.error('Error getting topics:', error);
        set.status = 500;
        return { success: false, error: 'Failed to get topics' };
      }
    },
    {
      query: t.Object({
        category: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Daily Dispatch'],
        summary: 'Get all unique topics',
      },
    }
  );
