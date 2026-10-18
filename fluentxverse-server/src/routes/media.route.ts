import { Elysia } from 'elysia';
import { lessonMediaService } from '../services/lesson.services/media.service';
import { createAdminGuard } from '../middleware/auth.middleware';

export const mediaRoute = new Elysia({ prefix: '/lesson' })
  // Auth guard for write operations (POST, PATCH, DELETE)
  .onBeforeHandle(async ({ request, cookie, set }) => {
    const method = request.method;
    
    // Only POST, PATCH, DELETE require admin auth
    if (['POST', 'PATCH', 'DELETE'].includes(method)) {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return {
          success: false,
          error: 'Unauthorized - Admin authentication required'
        };
      }
    }
  })
  
  // Get all media for a lesson
  .get('/:lessonId/media', async ({ params }) => {
    try {
      const media = await lessonMediaService.getMediaForLesson(params.lessonId);
      return { success: true, media };
    } catch (error) {
      console.error('Error fetching media:', error);
      return { success: false, error: 'Failed to fetch media' };
    }
  })

  // Get media by type
  .get('/:lessonId/media/:type', async ({ params }) => {
    try {
      const type = params.type as 'audio' | 'video' | 'image' | 'document';
      if (!['audio', 'video', 'image', 'document'].includes(type)) {
        return { success: false, error: 'Invalid media type' };
      }
      const media = await lessonMediaService.getMediaByType(params.lessonId, type);
      return { success: true, media };
    } catch (error) {
      console.error('Error fetching media:', error);
      return { success: false, error: 'Failed to fetch media' };
    }
  })

  // Get vocabulary audio files
  .get('/:lessonId/vocabulary-audio', async ({ params }) => {
    try {
      const media = await lessonMediaService.getVocabularyAudio(params.lessonId);
      return { success: true, media };
    } catch (error) {
      console.error('Error fetching vocabulary audio:', error);
      return { success: false, error: 'Failed to fetch vocabulary audio' };
    }
  })

  // Upload media file
  .post('/:lessonId/media', async ({ params, body }) => {
    try {
      const formData = body as {
        file?: File;
        type?: string;
        title?: string;
        description?: string;
        duration?: string;
        vocabularyItemId?: string;
      };

      if (!formData.file) {
        return { success: false, error: 'File is required' };
      }

      const mediaType = formData.type as 'audio' | 'video' | 'image' | 'document';
      if (!mediaType || !['audio', 'video', 'image', 'document'].includes(mediaType)) {
        return { success: false, error: 'Valid media type is required (audio, video, image, document)' };
      }

      const buffer = Buffer.from(await formData.file.arrayBuffer());

      const result = await lessonMediaService.uploadMedia(
        params.lessonId,
        {
          buffer,
          filename: formData.file.name,
          mimeType: formData.file.type,
          size: formData.file.size
        },
        {
          type: mediaType,
          title: formData.title,
          description: formData.description,
          duration: formData.duration ? parseInt(formData.duration) : undefined,
          vocabularyItemId: formData.vocabularyItemId
        }
      );

      return result;
    } catch (error) {
      console.error('Error uploading media:', error);
      return { success: false, error: 'Failed to upload media' };
    }
  })

  // Update media metadata
  .patch('/media/:mediaId', async ({ params, body }) => {
    try {
      const { title, description, duration, vocabularyItemId } = body as {
        title?: string;
        description?: string;
        duration?: number;
        vocabularyItemId?: string;
      };

      const result = await lessonMediaService.updateMedia(params.mediaId, {
        title,
        description,
        duration,
        vocabularyItemId
      });

      return result;
    } catch (error) {
      console.error('Error updating media:', error);
      return { success: false, error: 'Failed to update media' };
    }
  })

  // Delete media
  .delete('/media/:mediaId', async ({ params }) => {
    try {
      const result = await lessonMediaService.deleteMedia(params.mediaId);
      return result;
    } catch (error) {
      console.error('Error deleting media:', error);
      return { success: false, error: 'Failed to delete media' };
    }
  });
