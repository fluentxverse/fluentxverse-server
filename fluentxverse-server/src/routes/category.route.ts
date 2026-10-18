import { Elysia, t } from 'elysia';
import { lessonCategoryService, lessonTagService } from '../services/lesson.services/category.service';
import { createAdminGuard } from '../middleware/auth.middleware';

// Define which routes are public (read-only) vs admin-only (write)
const adminOnlyRoutes = [
  { method: 'POST', path: '/lesson/categories' },
  { method: 'PATCH', path: '/lesson/category' },
  { method: 'DELETE', path: '/lesson/category' },
  { method: 'POST', path: '/lesson/tags' },
  { method: 'POST', path: '/lesson/tags/lesson' },
  { method: 'DELETE', path: '/lesson/tag' },
];

export const categoryRoute = new Elysia({ prefix: '/lesson' })
  // Auth guard for admin-only routes (POST, PATCH, DELETE)
  .onBeforeHandle(async ({ request, path, cookie, set }) => {
    const method = request.method;
    
    // Check if this is an admin-only route
    const requiresAdmin = adminOnlyRoutes.some(route => 
      route.method === method && path.startsWith(route.path)
    );
    
    if (requiresAdmin) {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return {
          success: false,
          error: 'Unauthorized - Admin authentication required'
        };
      }
    }
  })
  // ============= CATEGORIES =============
  
  // Get all categories (tree structure)
  .get('/categories', async () => {
    try {
      const categories = await lessonCategoryService.getCategoryTree();
      return { success: true, categories };
    } catch (error) {
      console.error('Error fetching categories:', error);
      return { success: false, error: 'Failed to fetch categories' };
    }
  })

  // Get all categories (flat list)
  .get('/categories/flat', async () => {
    try {
      const categories = await lessonCategoryService.getAllCategories();
      return { success: true, categories };
    } catch (error) {
      console.error('Error fetching categories:', error);
      return { success: false, error: 'Failed to fetch categories' };
    }
  })

  // Get single category
  .get('/category/:idOrSlug', async ({ params }) => {
    try {
      const category = await lessonCategoryService.getCategory(params.idOrSlug);
      if (!category) {
        return { success: false, error: 'Category not found' };
      }
      return { success: true, category };
    } catch (error) {
      console.error('Error fetching category:', error);
      return { success: false, error: 'Failed to fetch category' };
    }
  })

  // Create category (admin only)
  .post('/categories', async ({ body }) => {
    try {
      const { name, slug, description, parentId, icon, color, sortOrder } = body as {
        name: string;
        slug: string;
        description?: string;
        parentId?: string;
        icon?: string;
        color?: string;
        sortOrder?: number;
      };

      const result = await lessonCategoryService.createCategory({
        name,
        slug,
        description,
        parentId,
        icon,
        color,
        sortOrder
      });

      return result;
    } catch (error) {
      console.error('Error creating category:', error);
      return { success: false, error: 'Failed to create category' };
    }
  })

  // Update category
  .patch('/category/:id', async ({ params, body }) => {
    try {
      const result = await lessonCategoryService.updateCategory(params.id, body as Record<string, unknown>);
      return result;
    } catch (error) {
      console.error('Error updating category:', error);
      return { success: false, error: 'Failed to update category' };
    }
  })

  // Delete category
  .delete('/category/:id', async ({ params }) => {
    try {
      const result = await lessonCategoryService.deleteCategory(params.id);
      return result;
    } catch (error) {
      console.error('Error deleting category:', error);
      return { success: false, error: 'Failed to delete category' };
    }
  })

  // ============= TAGS =============

  // Get all tags
  .get('/tags', async () => {
    try {
      const tags = await lessonTagService.getAllTags();
      return { success: true, tags };
    } catch (error) {
      console.error('Error fetching tags:', error);
      return { success: false, error: 'Failed to fetch tags' };
    }
  })

  // Get popular tags
  .get('/tags/popular', async ({ query }) => {
    try {
      const limit = query.limit ? parseInt(query.limit as string) : 20;
      const tags = await lessonTagService.getPopularTags(limit);
      return { success: true, tags };
    } catch (error) {
      console.error('Error fetching popular tags:', error);
      return { success: false, error: 'Failed to fetch popular tags' };
    }
  })

  // Search tags
  .get('/tags/search', async ({ query }) => {
    try {
      const q = query.q as string;
      if (!q) {
        return { success: false, error: 'Search query required' };
      }
      const tags = await lessonTagService.searchTags(q);
      return { success: true, tags };
    } catch (error) {
      console.error('Error searching tags:', error);
      return { success: false, error: 'Failed to search tags' };
    }
  })

  // Get tags for a lesson
  .get('/tags/lesson/:lessonId', async ({ params }) => {
    try {
      const tags = await lessonTagService.getTagsForLesson(params.lessonId);
      return { success: true, tags };
    } catch (error) {
      console.error('Error fetching lesson tags:', error);
      return { success: false, error: 'Failed to fetch lesson tags' };
    }
  })

  // Create tag
  .post('/tags', async ({ body }) => {
    try {
      const { name, slug, color } = body as { name: string; slug: string; color?: string };
      const result = await lessonTagService.createTag({ name, slug, color });
      return result;
    } catch (error) {
      console.error('Error creating tag:', error);
      return { success: false, error: 'Failed to create tag' };
    }
  })

  // Assign tags to a lesson
  .post('/tags/lesson/:lessonId', async ({ params, body }) => {
    try {
      const { tagIds } = body as { tagIds: string[] };
      const result = await lessonTagService.assignTagsToLesson(params.lessonId, tagIds);
      return result;
    } catch (error) {
      console.error('Error assigning tags:', error);
      return { success: false, error: 'Failed to assign tags' };
    }
  })

  // Delete tag
  .delete('/tag/:id', async ({ params }) => {
    try {
      const result = await lessonTagService.deleteTag(params.id);
      return result;
    } catch (error) {
      console.error('Error deleting tag:', error);
      return { success: false, error: 'Failed to delete tag' };
    }
  });
