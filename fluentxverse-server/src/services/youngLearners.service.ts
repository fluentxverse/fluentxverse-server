/**
 * Young Learners Service - Memgraph Storage
 * Handles CRUD operations for Young Learners lesson materials
 */
import { getDriver } from '../db/memgraph';
import neo4j from 'neo4j-driver';

// ============================================================================
// TYPES
// ============================================================================

export type AgeGroup = '3-5' | '6-8' | '9-12';
export type ActivityType = 'coloring' | 'matching' | 'tracing' | 'counting' | 'sorting' | 'singing' | 'story';
export type LessonTheme = 'animals' | 'colors' | 'numbers' | 'shapes' | 'family' | 'food' | 'weather' | 'body' | 'clothes' | 'nature';
export type LessonStatus = 'draft' | 'published';

export interface VocabularyWord {
  id: string;
  word: string;
  translation: string;
  image: string;
  audio?: string;
}

export interface SongLyric {
  id: string;
  line: string;
  translation?: string;
  timing?: number;
}

export interface Song {
  title: string;
  audioUrl?: string;
  lyrics: SongLyric[];
}

export interface StoryPage {
  id: string;
  image: string;
  text: string;
  translation?: string;
  audio?: string;
}

export interface Story {
  title: string;
  pages: StoryPage[];
}

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  instruction: string;
  instructionJp?: string;
  data: any;
}

export interface YoungLearnersLesson {
  id: string;
  course: string;
  level: number;
  unit: number;
  lessonNumber: number;
  theme: LessonTheme;
  ageGroup: AgeGroup;
  unitLabel: string;
  lessonTitle: string;
  mascot: string;
  backgroundColor: string;
  greeting: string;
  greetingJp?: string;
  
  vocabularyWords: VocabularyWord[];
  song: Song | null;
  story: Story | null;
  activities: Activity[];
  
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  status: LessonStatus;
}

export interface CreateYoungLearnersInput {
  level: number;
  unit: number;
  lessonNumber: number;
  theme: LessonTheme;
  ageGroup: AgeGroup;
  unitName: string;
  lessonName: string;
  mascot: string;
  createdBy: string;
  createdByName?: string;
}

export interface UpdateYoungLearnersInput {
  unitLabel?: string;
  lessonTitle?: string;
  theme?: LessonTheme;
  ageGroup?: AgeGroup;
  mascot?: string;
  backgroundColor?: string;
  greeting?: string;
  greetingJp?: string;
  vocabularyWords?: VocabularyWord[];
  song?: Song | null;
  story?: Story | null;
  activities?: Activity[];
  status?: LessonStatus;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const COURSE_ID = 'young-learners';

const LEVEL_NAMES: Record<number, string> = {
  1: 'TINY TOTS',
  2: 'LITTLE STARS',
  3: 'RISING STARS',
  4: 'BRIGHT MINDS',
  5: 'SUPER KIDS',
};

const LEVEL_COLORS: Record<number, string> = {
  1: '#ec4899',
  2: '#f59e0b',
  3: '#10b981',
  4: '#3b82f6',
  5: '#8b5cf6',
};

const MASCOT_EMOJIS: Record<string, string> = {
  foxy: '🦊',
  buddy: '🐻',
  sunny: '🌞',
  luna: '🌙',
  pippa: '🐧',
  ozzy: '🦉',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateLessonId(): string {
  return `yl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function transformLesson(node: any): YoungLearnersLesson {
  const props = node.properties;
  
  // Parse JSON fields
  let vocabularyWords: VocabularyWord[] = [];
  let song: Song | null = null;
  let story: Story | null = null;
  let activities: Activity[] = [];
  
  try {
    if (props.vocabularyWords) {
      vocabularyWords = JSON.parse(props.vocabularyWords);
    }
    if (props.song) {
      song = JSON.parse(props.song);
    }
    if (props.story) {
      story = JSON.parse(props.story);
    }
    if (props.activities) {
      activities = JSON.parse(props.activities);
    }
  } catch (e) {
    console.error('Error parsing Young Learners lesson JSON fields:', e);
  }
  
  return {
    id: props.id,
    course: props.course || COURSE_ID,
    level: neo4j.isInt(props.level) ? props.level.toNumber() : props.level,
    unit: neo4j.isInt(props.unit) ? props.unit.toNumber() : props.unit,
    lessonNumber: neo4j.isInt(props.lessonNumber) ? props.lessonNumber.toNumber() : props.lessonNumber,
    theme: props.theme || 'animals',
    ageGroup: props.ageGroup || '3-5',
    unitLabel: props.unitLabel || '',
    lessonTitle: props.lessonTitle || '',
    mascot: props.mascot || '🦊',
    backgroundColor: props.backgroundColor || '#fef3c7',
    greeting: props.greeting || '',
    greetingJp: props.greetingJp || '',
    vocabularyWords,
    song,
    story,
    activities,
    createdBy: props.createdBy || '',
    createdByName: props.createdByName || '',
    createdAt: props.createdAt || new Date().toISOString(),
    updatedAt: props.updatedAt || new Date().toISOString(),
    status: props.status || 'draft',
  };
}

// ============================================================================
// SERVICE
// ============================================================================

export const youngLearnersService = {
  /**
   * Create a new Young Learners lesson
   */
  async create(input: CreateYoungLearnersInput): Promise<YoungLearnersLesson> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const id = generateLessonId();
      const now = new Date().toISOString();
      const mascotEmoji = MASCOT_EMOJIS[input.mascot] || '🦊';
      
      const lesson: YoungLearnersLesson = {
        id,
        course: COURSE_ID,
        level: input.level,
        unit: input.unit,
        lessonNumber: input.lessonNumber,
        theme: input.theme,
        ageGroup: input.ageGroup,
        unitLabel: `Unit ${input.unit}: ${input.unitName}`,
        lessonTitle: `Lesson ${input.lessonNumber}: ${input.lessonName}`,
        mascot: mascotEmoji,
        backgroundColor: '#fef3c7',
        greeting: `Hello friends! Let's learn about ${input.lessonName}!`,
        greetingJp: '',
        vocabularyWords: [],
        song: null,
        story: null,
        activities: [],
        createdBy: input.createdBy,
        createdByName: input.createdByName || '',
        createdAt: now,
        updatedAt: now,
        status: 'draft',
      };
      
      await session.run(
        `CREATE (l:YoungLearnersLesson {
          id: $id,
          course: $course,
          level: $level,
          unit: $unit,
          lessonNumber: $lessonNumber,
          theme: $theme,
          ageGroup: $ageGroup,
          unitLabel: $unitLabel,
          lessonTitle: $lessonTitle,
          mascot: $mascot,
          backgroundColor: $backgroundColor,
          greeting: $greeting,
          greetingJp: $greetingJp,
          vocabularyWords: $vocabularyWords,
          song: $song,
          story: $story,
          activities: $activities,
          createdBy: $createdBy,
          createdByName: $createdByName,
          createdAt: $createdAt,
          updatedAt: $updatedAt,
          status: $status
        })
        RETURN l`,
        {
          ...lesson,
          vocabularyWords: JSON.stringify(lesson.vocabularyWords),
          song: JSON.stringify(lesson.song),
          story: JSON.stringify(lesson.story),
          activities: JSON.stringify(lesson.activities),
        }
      );
      
      return lesson;
    } finally {
      await session.close();
    }
  },

  /**
   * Get a lesson by ID
   */
  async getById(id: string): Promise<YoungLearnersLesson | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {id: $id})
        RETURN l`,
        { id }
      );
      
      if (result.records.length === 0) {
        return null;
      }
      
      return transformLesson(result.records[0]!.get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * List all lessons
   */
  async listAll(): Promise<YoungLearnersLesson[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson)
        RETURN l
        ORDER BY l.level, l.unit, l.lessonNumber`
      );
      
      return result.records.map(r => transformLesson(r.get('l')));
    } finally {
      await session.close();
    }
  },

  /**
   * List published lessons only
   */
  async listPublished(): Promise<YoungLearnersLesson[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {status: 'published'})
        RETURN l
        ORDER BY l.level, l.unit, l.lessonNumber`
      );
      
      return result.records.map(r => transformLesson(r.get('l')));
    } finally {
      await session.close();
    }
  },

  /**
   * List lessons by level
   */
  async listByLevel(level: number): Promise<YoungLearnersLesson[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {level: $level})
        RETURN l
        ORDER BY l.unit, l.lessonNumber`,
        { level }
      );
      
      return result.records.map(r => transformLesson(r.get('l')));
    } finally {
      await session.close();
    }
  },

  /**
   * Update a lesson
   */
  async update(id: string, input: UpdateYoungLearnersInput): Promise<YoungLearnersLesson | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const updates: string[] = [];
      const params: Record<string, any> = { id };
      
      if (input.unitLabel !== undefined) {
        updates.push('l.unitLabel = $unitLabel');
        params.unitLabel = input.unitLabel;
      }
      if (input.lessonTitle !== undefined) {
        updates.push('l.lessonTitle = $lessonTitle');
        params.lessonTitle = input.lessonTitle;
      }
      if (input.theme !== undefined) {
        updates.push('l.theme = $theme');
        params.theme = input.theme;
      }
      if (input.ageGroup !== undefined) {
        updates.push('l.ageGroup = $ageGroup');
        params.ageGroup = input.ageGroup;
      }
      if (input.mascot !== undefined) {
        updates.push('l.mascot = $mascot');
        params.mascot = input.mascot;
      }
      if (input.backgroundColor !== undefined) {
        updates.push('l.backgroundColor = $backgroundColor');
        params.backgroundColor = input.backgroundColor;
      }
      if (input.greeting !== undefined) {
        updates.push('l.greeting = $greeting');
        params.greeting = input.greeting;
      }
      if (input.greetingJp !== undefined) {
        updates.push('l.greetingJp = $greetingJp');
        params.greetingJp = input.greetingJp;
      }
      if (input.vocabularyWords !== undefined) {
        updates.push('l.vocabularyWords = $vocabularyWords');
        params.vocabularyWords = JSON.stringify(input.vocabularyWords);
      }
      if (input.song !== undefined) {
        updates.push('l.song = $song');
        params.song = JSON.stringify(input.song);
      }
      if (input.story !== undefined) {
        updates.push('l.story = $story');
        params.story = JSON.stringify(input.story);
      }
      if (input.activities !== undefined) {
        updates.push('l.activities = $activities');
        params.activities = JSON.stringify(input.activities);
      }
      if (input.status !== undefined) {
        updates.push('l.status = $status');
        params.status = input.status;
      }
      
      updates.push('l.updatedAt = $updatedAt');
      params.updatedAt = new Date().toISOString();
      
      if (updates.length === 1) {
        // Only updatedAt, nothing to update
        return this.getById(id);
      }
      
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {id: $id})
        SET ${updates.join(', ')}
        RETURN l`,
        params
      );
      
      if (result.records.length === 0) {
        return null;
      }
      
      return transformLesson(result.records[0]!.get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * Delete a lesson
   */
  async delete(id: string): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {id: $id})
        DELETE l
        RETURN count(l) as deleted`,
        { id }
      );
      
      const deleted = result.records[0]?.get('deleted');
      return deleted && (neo4j.isInt(deleted) ? deleted.toNumber() : deleted) > 0;
    } finally {
      await session.close();
    }
  },

  /**
   * Duplicate a lesson
   */
  async duplicate(id: string, createdBy: string, createdByName: string): Promise<YoungLearnersLesson | null> {
    const original = await this.getById(id);
    if (!original) {
      return null;
    }
    
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const newId = generateLessonId();
      const now = new Date().toISOString();
      
      const duplicated: YoungLearnersLesson = {
        ...original,
        id: newId,
        lessonNumber: original.lessonNumber + 1,
        lessonTitle: original.lessonTitle.replace(/Lesson \d+/, `Lesson ${original.lessonNumber + 1}`),
        createdBy,
        createdByName,
        createdAt: now,
        updatedAt: now,
        status: 'draft',
      };
      
      await session.run(
        `CREATE (l:YoungLearnersLesson {
          id: $id,
          course: $course,
          level: $level,
          unit: $unit,
          lessonNumber: $lessonNumber,
          theme: $theme,
          ageGroup: $ageGroup,
          unitLabel: $unitLabel,
          lessonTitle: $lessonTitle,
          mascot: $mascot,
          backgroundColor: $backgroundColor,
          greeting: $greeting,
          greetingJp: $greetingJp,
          vocabularyWords: $vocabularyWords,
          song: $song,
          story: $story,
          activities: $activities,
          createdBy: $createdBy,
          createdByName: $createdByName,
          createdAt: $createdAt,
          updatedAt: $updatedAt,
          status: $status
        })
        RETURN l`,
        {
          ...duplicated,
          vocabularyWords: JSON.stringify(duplicated.vocabularyWords),
          song: JSON.stringify(duplicated.song),
          story: JSON.stringify(duplicated.story),
          activities: JSON.stringify(duplicated.activities),
        }
      );
      
      return duplicated;
    } finally {
      await session.close();
    }
  },

  /**
   * Check if a lesson already exists at the given position
   */
  async checkDuplicate(level: number, unit: number, lessonNumber: number): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {level: $level, unit: $unit, lessonNumber: $lessonNumber})
        RETURN count(l) as count`,
        { level, unit, lessonNumber }
      );
      
      const count = result.records[0]?.get('count');
      return count && (neo4j.isInt(count) ? count.toNumber() : count) > 0;
    } finally {
      await session.close();
    }
  },

  /**
   * Get existing unit name for a level/unit combo
   */
  async getExistingUnitName(level: number, unit: number): Promise<string | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:YoungLearnersLesson {level: $level, unit: $unit})
        RETURN l.unitLabel as unitLabel
        LIMIT 1`,
        { level, unit }
      );
      
      if (result.records.length === 0) {
        return null;
      }
      
      const unitLabel = result.records[0]!.get('unitLabel');
      if (unitLabel) {
        const match = unitLabel.match(/Unit \d+:\s*(.*)/);
        return match ? match[1] : null;
      }
      return null;
    } finally {
      await session.close();
    }
  },

  /**
   * Publish a lesson
   */
  async publish(id: string): Promise<YoungLearnersLesson | null> {
    return this.update(id, { status: 'published' });
  },

  /**
   * Unpublish a lesson
   */
  async unpublish(id: string): Promise<YoungLearnersLesson | null> {
    return this.update(id, { status: 'draft' });
  },
};
