export function conversationalChapterCount(level: number): number {
  return level === 1 ? 1 : 5;
}

export function conversationalChapters(level: number): number[] {
  return Array.from({ length: conversationalChapterCount(level) }, (_, index) => index + 1);
}

export function isLessonChapterAllowed(course: string, level: number, chapter: number): boolean {
  const limit = course === 'conversational-skills' ? conversationalChapterCount(level) : 5;
  return Number.isInteger(chapter) && chapter >= 1 && chapter <= limit;
}
