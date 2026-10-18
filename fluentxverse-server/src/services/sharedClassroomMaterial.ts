import { dispatchService } from './dispatch.services/dispatch.service';
import { lessonMaterialService } from './lessonMaterial.service';
import type { SharedClassroomMaterial } from '../socket/types/socket.types';

export async function resolveSharedClassroomMaterial(courseId: string, id: string): Promise<SharedClassroomMaterial | null> {
  if (courseId === 'daily-dispatch') {
    const article = (await dispatchService.classroomLibrary()).find(item => item.id === id);
    if (!article) return null;
    return { id: article.id, courseId, title: article.title, category: article.category,
      postedDate: article.postedDate, createdAt: article.createdAt };
  }
  if (courseId !== 'conversational-skills' && courseId !== 'business-english') return null;
  const lesson = await lessonMaterialService.getById(id);
  if (!lesson || lesson.course !== courseId || lesson.status !== 'published') return null;
  return { id: lesson.id, courseId, title: lesson.lessonTitle || `Lesson ${lesson.lessonNumber}: ${lesson.lessonName}`,
    level: lesson.level, chapter: lesson.chapter, lessonNumber: lesson.lessonNumber };
}
