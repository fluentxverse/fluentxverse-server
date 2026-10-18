/**
 * Lesson Material Service - Memgraph Storage
 * Handles CRUD operations for lesson materials (Conversational Skills)
 */
import { getDriver } from '../db/memgraph';
import neo4j from 'neo4j-driver';
import { conversationalLessonErrors } from '../utils/conversationalLessonValidation';

// ============================================================================
// TYPES
// ============================================================================

export type Skill = 'speaking' | 'listening' | 'reading' | 'writing' | 'review';

export type LevelBadge = 'STARTER' | 'BEGINNER' | 'ELEMENTARY' | 'INTERMEDIATE' | 'ADVANCED' | 'HIGH BEGINNER' | 'HIGH INTERMEDIATE';

// Introduction Section Types
export interface IntroText {
  language: string;
  text: string;
}

export interface LessonIssue {
  title: string;
  points: string[];
}

export interface LessonGoalStep {
  instruction: string;
  script?: string | null;
  question?: string | null;
}

export interface IntroductionData {
  introTexts: IntroText[];
  introImage: string | null;
  lessonIssue: LessonIssue | null;
  lessonGoalDuration: string;
  lessonGoalSteps: LessonGoalStep[];
}

// Learn Section Types (Section 2 - Vocabulary/Expressions)
export type StepAType = 'vocabulary' | 'expressions';

export interface VocabularyItem {
  image: string;
  englishText: string;
  highlightedWord?: string;
  translation: string;
}

export interface ExpressionItem {
  image: string;
  definitionLine: string;
  exampleSentence: string;
}

export interface DiscussionImage {
  image: string;
  label?: string;
  translation?: string;
}

export interface DiscussionPart {
  instruction: string;
  instructionTranslation?: string;
  images: DiscussionImage[];
  tutorSteps?: TutorStep[];
}

export interface PronunciationWord {
  word: string;
  translation: string;
  isHighlighted?: boolean;
}

export interface PronunciationColumn {
  soundSymbol: string;
  images: string[];
  words: PronunciationWord[];
}

export interface PronunciationPart {
  instruction: string;
  instructionTranslation: string;
  leftColumn: PronunciationColumn;
  rightColumn: PronunciationColumn;
  tutorSteps?: TutorStep[];
}

export interface TutorStep {
  instruction: string;
  script?: string | null;
  tip?: string | null;
}

export interface LearnStepData {
  stepType: StepAType;
  stepName: string;
  duration: string;
  partLabel: string;
  partTranslation: string;
  vocabularyItems?: VocabularyItem[];
  expressionItems?: ExpressionItem[];
  discussionPart?: DiscussionPart;
  pronunciationPart?: PronunciationPart;
  tutorSteps: TutorStep[];
}

export interface LearnSectionData {
  sectionTitle: string;
  steps: LearnStepData[];
}

// Step B Section Types (Speak Your Mind / Grammar Tip / Pronunciation)
export type StepBType = 'speak-your-mind' | 'grammar-tip' | 'pronunciation';

export interface ConversationSpeaker {
  image: string;
  speechBubble: string; // Rich text HTML
}

export interface SpeakYourMindData {
  stepName: string;
  duration: string;
  explanation: string;
  speaker1: ConversationSpeaker;
  speaker2: ConversationSpeaker;
  question: string;
  tutorSteps: TutorStep[];
}

// Grammar Tip types
export interface GrammarExample {
  sentence: string; // HTML with <strong> for highlighted word
  translation: string;
}

export interface GrammarExplanation {
  ruleText: string; // HTML - can have <em> for italics, <strong> for bold
  ruleTranslation: string;
  examplesTitle?: string; // e.g., "EXAMPLES" or "EXAMPLE"
  examples?: GrammarExample[];
}

export interface GrammarTipData {
  stepName: string;
  duration: string;
  explanations: GrammarExplanation[];
  tutorSteps: TutorStep[];
}

// Pronunciation types
export interface PronunciationPhrase {
  phrase: string;
  pronunciationGuide: string; // e.g., "/ cos-ta fortune /"
  exampleSentence: string; // HTML with <strong> for pronunciation highlight
}

export interface StepBPronunciationData {
  stepName: string;
  duration: string;
  tip: string; // HTML - can have bold for emphasis
  phrases: PronunciationPhrase[];
  tutorSteps: TutorStep[];
}

export interface StepBData {
  stepType: StepBType;
  speakYourMind?: SpeakYourMindData;
  grammarTip?: GrammarTipData;
  pronunciation?: StepBPronunciationData;
}

// ============================================================================
// APPLY SECTION TYPES (Section 3 - Speaking/Understanding)
// ============================================================================

export interface DialogueLine {
  speaker: string;
  text: string;
  isAction?: boolean;
}

export interface TutorScriptBullet {
  text: string;
}

export interface TutorTipItem {
  text: string;
}

export interface TutorQuestion {
  question: string;
  answer?: string;
}

export type ApplyActivityType = 'speaking' | 'listening' | 'reading';

export interface ApplyTutorStep {
  instruction: string;
  scripts?: TutorScriptBullet[];
  tips?: TutorTipItem[];
  questions?: TutorQuestion[];
  listeningScript?: string; // Rich text HTML for listening script
}

export interface TriviaTutorStep {
  instruction: string;
  scripts?: TutorScriptBullet[];
  questions?: TutorQuestion[];
}

export interface ApplySectionData {
  sectionNumber: number;
  sectionTitle: string;
  activityType: ApplyActivityType;
  activityTitle: string;
  activityDuration: string;
  situationText: string;
  situationImage: string;
  dialogueLines: DialogueLine[];
  readingText?: string; // Rich text HTML for reading passage
  readingImage?: string; // Optional image inside reading card
  readingImageLabel?: string; // Rich text label under reading image
  tutorSteps: ApplyTutorStep[];
  // Trivia Time (optional)
  triviaEnabled?: boolean;
  triviaText?: string;
  triviaImage?: string;
  triviaDuration?: string;
  triviaTutorSteps?: TriviaTutorStep[];
}

// Exercise Section Types (Section 4)
export interface ExerciseItem {
  image: string;
  sentence: string;
}

export interface ExerciseAnswer {
  text: string;
}

export interface ExerciseTutorStep {
  instruction: string;
  scripts?: TutorScriptBullet[];
  tips?: TutorTipItem[];
}

export interface ExerciseSectionData {
  sectionNumber: number;
  sectionTitle: string;
  duration: string;
  instructions: string;
  expressions: string[];
  exampleSentence: string;
  exampleAnswer: string;
  exerciseItems: ExerciseItem[];
  answers: ExerciseAnswer[];
  tutorSteps: ExerciseTutorStep[];
}

export interface CreateLessonInput {
  course: string;             // e.g., "conversational-skills"
  level: number;              // 1-10
  chapter: number;            // 1-5
  lessonNumber: number;       // 1-10 generally; Business English uses 1-5
  skill: Skill;
  chapterName?: string;       // Optional — auto-resolved from CourseMetadata
  lessonName: string;         // "Greetings"
  goalTextEn: string;         // "I can say basic greetings."
  goalTextJp: string;         // "基本的な挨拶ができるようになる。"
  createdBy: string;          // Admin ID
  createdByName?: string;     // Admin name
}

export type LessonStatus = 'draft' | 'published';

export interface LessonMaterial {
  id: string;
  course: string;
  level: number;
  chapter: number;
  lessonNumber: number;
  skill: Skill;
  chapterName: string;
  lessonName: string;
  goalTextEn: string;
  goalTextJp: string;
  backgroundImage: string;
  overlayColor: string;
  status: LessonStatus;
  introductionData?: IntroductionData;
  learnData?: LearnSectionData;
  stepBData?: StepBData;
  applyData?: ApplySectionData;
  exerciseData?: ExerciseSectionData;
  storyData?: StoryData;
  missionData?: any;
  missionData2?: any;
  missionData3?: any;
  feedbackData?: any;
  discussionQuestionsData?: any;
  beData?: any;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  // Computed fields
  levelBadge: LevelBadge;
  chapterLabel: string;
  lessonTitle: string;
}

// Story data types for K-Drama style learning
export interface StoryCharacter {
  id: string;
  name: string;
  koreanName?: string;
  role: 'main' | 'supporting' | 'minor';
  description: string;
  personality?: string;
  image?: string;
}

export interface StoryData {
  enabled: boolean;
  storyTitle: string;
  characters: StoryCharacter[];
  setting: string;
  previousSummary: string;
  currentPlotPoints: string[];
  currentEpisodeSummary: string;
  nextEpisodeHook: string;
  storyNotes: string;
}

export interface UpdateHeaderInput {
  backgroundImage?: string;
  overlayColor?: string;
  chapterName?: string;
  lessonName?: string;
  goalTextEn?: string;
  goalTextJp?: string;
  introductionData?: IntroductionData;
  learnData?: LearnSectionData;
  stepBData?: StepBData;
  applyData?: ApplySectionData;
  exerciseData?: ExerciseSectionData;
  storyData?: StoryData;
  missionData?: any;
  missionData2?: any;
  missionData3?: any;
  feedbackData?: any;
  discussionQuestionsData?: any;
  beData?: any;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map level number to badge
 */
export function getLevelBadge(level: number): LevelBadge {
  if (level <= 2) return 'STARTER';
  if (level <= 4) return 'BEGINNER';
  if (level <= 6) return 'ELEMENTARY';
  if (level <= 8) return 'INTERMEDIATE';
  return 'ADVANCED';
}

/**
 * Generate chapter label from chapter number and name
 */
export function getChapterLabel(chapter: number, chapterName: string): string {
  return `Chapter ${chapter}: ${chapterName}`;
}

/**
 * Generate lesson title from lesson number and name
 */
export function getLessonTitle(lessonNumber: number, lessonName: string): string {
  return `Lesson ${lessonNumber}: ${lessonName}`;
}

const BUSINESS_ENGLISH_SKILL_CYCLE: Skill[] = ['listening', 'reading', 'speaking', 'speaking', 'review'];

function getExpectedSkillForCourse(course: string, lessonNumber: number): Skill | null {
  if (course !== 'business-english') return null;
  if (lessonNumber < 1 || lessonNumber > BUSINESS_ENGLISH_SKILL_CYCLE.length) return null;
  return BUSINESS_ENGLISH_SKILL_CYCLE[lessonNumber - 1] || null;
}

function validateLessonSlot(course: string, lessonNumber: number, skill: Skill): void {
  if (course !== 'business-english') return;

  const expectedSkill = getExpectedSkillForCourse(course, lessonNumber);
  if (!expectedSkill) {
    throw new Error('Business English chapters only allow Lessons 1 to 5.');
  }

  if (skill !== expectedSkill) {
    throw new Error(
      `Business English Lesson ${lessonNumber} must use skill "${expectedSkill}", not "${skill}".`
    );
  }
}

/**
 * Transform raw Memgraph record to LessonMaterial
 */
function transformLesson(record: any): LessonMaterial {
  const props = record.properties || record;
  
  // Parse introductionData from JSON string if present
  let introductionData: IntroductionData | undefined;
  if (props.introductionData) {
    try {
      introductionData = typeof props.introductionData === 'string' 
        ? JSON.parse(props.introductionData) 
        : props.introductionData;
    } catch (e) {
      console.error('Failed to parse introductionData:', e);
    }
  }

  // Parse learnData from JSON string if present
  let learnData: LearnSectionData | undefined;
  if (props.learnData) {
    try {
      learnData = typeof props.learnData === 'string' 
        ? JSON.parse(props.learnData) 
        : props.learnData;
    } catch (e) {
      console.error('Failed to parse learnData:', e);
    }
  }

  // Parse stepBData from JSON string if present
  let stepBData: StepBData | undefined;
  if (props.stepBData) {
    try {
      stepBData = typeof props.stepBData === 'string' 
        ? JSON.parse(props.stepBData) 
        : props.stepBData;
    } catch (e) {
      console.error('Failed to parse stepBData:', e);
    }
  }

  // Parse applyData from JSON string if present
  let applyData: ApplySectionData | undefined;
  if (props.applyData) {
    try {
      applyData = typeof props.applyData === 'string' 
        ? JSON.parse(props.applyData) 
        : props.applyData;
    } catch (e) {
      console.error('Failed to parse applyData:', e);
    }
  }

  // Parse exerciseData from JSON string if present
  let exerciseData: ExerciseSectionData | undefined;
  if (props.exerciseData) {
    try {
      exerciseData = typeof props.exerciseData === 'string' 
        ? JSON.parse(props.exerciseData) 
        : props.exerciseData;
    } catch (e) {
      console.error('Failed to parse exerciseData:', e);
    }
  }

  // Parse storyData from JSON string if present
  let storyData: StoryData | undefined;
  if (props.storyData) {
    try {
      storyData = typeof props.storyData === 'string' 
        ? JSON.parse(props.storyData) 
        : props.storyData;
    } catch (e) {
      console.error('Failed to parse storyData:', e);
    }
  }

  // Parse missionData from JSON string if present
  let missionData: any | undefined;
  if (props.missionData) {
    try {
      missionData = typeof props.missionData === 'string' 
        ? JSON.parse(props.missionData) 
        : props.missionData;
    } catch (e) {
      console.error('Failed to parse missionData:', e);
    }
  }

  // Parse missionData2 from JSON string if present
  let missionData2: any | undefined;
  if (props.missionData2) {
    try {
      missionData2 = typeof props.missionData2 === 'string' 
        ? JSON.parse(props.missionData2) 
        : props.missionData2;
    } catch (e) {
      console.error('Failed to parse missionData2:', e);
    }
  }

  let missionData3: any | undefined;
  if (props.missionData3) {
    try {
      missionData3 = typeof props.missionData3 === 'string' ? JSON.parse(props.missionData3) : props.missionData3;
    } catch (e) {
      console.error('Failed to parse missionData3:', e);
    }
  }

  // Parse feedbackData from JSON string if present
  let feedbackData: any | undefined;
  if (props.feedbackData) {
    try {
      feedbackData = typeof props.feedbackData === 'string' 
        ? JSON.parse(props.feedbackData) 
        : props.feedbackData;
    } catch (e) {
      console.error('Failed to parse feedbackData:', e);
    }
  }

  // Parse discussionQuestionsData from JSON string if present
  let discussionQuestionsData: any | undefined;
  if (props.discussionQuestionsData) {
    try {
      discussionQuestionsData = typeof props.discussionQuestionsData === 'string' 
        ? JSON.parse(props.discussionQuestionsData) 
        : props.discussionQuestionsData;
    } catch (e) {
      console.error('Failed to parse discussionQuestionsData:', e);
    }
  }

  // Parse beData (Business English lesson sections) from JSON string if present
  let beData: any | undefined;
  if (props.beData) {
    try {
      beData = typeof props.beData === 'string' 
        ? JSON.parse(props.beData) 
        : props.beData;
    } catch (e) {
      console.error('Failed to parse beData:', e);
    }
  }
  
  return {
    id: props.id,
    course: props.course,
    level: neo4j.isInt(props.level) ? props.level.toNumber() : props.level,
    chapter: neo4j.isInt(props.chapter) ? props.chapter.toNumber() : props.chapter,
    lessonNumber: neo4j.isInt(props.lessonNumber) ? props.lessonNumber.toNumber() : props.lessonNumber,
    skill: props.skill,
    chapterName: props.chapterName,
    lessonName: props.lessonName,
    goalTextEn: props.goalTextEn,
    goalTextJp: props.goalTextJp,
    backgroundImage: props.backgroundImage || '',
    overlayColor: props.overlayColor || '#0369a1cc',
    status: props.status || 'draft',
    introductionData,
    learnData,
    stepBData,
    applyData,
    exerciseData,
    storyData,
    missionData,
    missionData2,
    missionData3,
    feedbackData,
    discussionQuestionsData,
    beData,
    createdBy: props.createdBy,
    createdByName: props.createdByName || '',
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    // Computed
    levelBadge: getLevelBadge(neo4j.isInt(props.level) ? props.level.toNumber() : props.level),
    chapterLabel: getChapterLabel(
      neo4j.isInt(props.chapter) ? props.chapter.toNumber() : props.chapter,
      props.chapterName
    ),
    lessonTitle: getLessonTitle(
      neo4j.isInt(props.lessonNumber) ? props.lessonNumber.toNumber() : props.lessonNumber,
      props.lessonName
    ),
  };
}

// ============================================================================
// SERVICE
// ============================================================================

export const lessonMaterialService = {
  /**
   * Check if a lesson with same level+chapter+lesson+skill already exists
   */
  async checkDuplicate(
    course: string,
    level: number,
    chapter: number,
    lessonNumber: number,
    skill: Skill
  ): Promise<boolean> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {
          course: $course,
          level: $level,
          chapter: $chapter,
          lessonNumber: $lessonNumber,
          skill: $skill
        })
        RETURN l`,
        { course, level: neo4j.int(level), chapter: neo4j.int(chapter), lessonNumber: neo4j.int(lessonNumber), skill }
      );
      
      return result.records.length > 0;
    } finally {
      await session.close();
    }
  },

  /**
   * Get existing chapter name if any lesson in that chapter exists
   */
  async getExistingChapterName(
    course: string,
    level: number,
    chapter: number
  ): Promise<string | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {
          course: $course,
          level: $level,
          chapter: $chapter
        })
        RETURN l.chapterName as chapterName
        LIMIT 1`,
        { course, level: neo4j.int(level), chapter: neo4j.int(chapter) }
      );
      
      if (result.records.length > 0 && result.records[0]) {
        return result.records[0].get('chapterName');
      }
      return null;
    } finally {
      await session.close();
    }
  },

  /**
   * Create a new lesson material
   */
  async create(input: CreateLessonInput): Promise<LessonMaterial> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // Enforce rule: For Conversational Skills Level 1, only chapter 1 is allowed.
      if (input.course === 'conversational-skills' && input.level === 1) {
        if (input.chapter !== 1) {
          console.warn('Overriding chapter to 1 for conversational-skills Level 1');
        }
        // Force chapter to 1 to ensure Level 1 has only 1 chapter
        input.chapter = 1;
      }

      validateLessonSlot(input.course, input.lessonNumber, input.skill);

      // Auto-resolve chapterName from CourseMetadata if not provided
      if (!input.chapterName) {
        try {
          const metaData = await this.getCourseMetadata(input.course);
          const metaKey = `${input.level}-${input.chapter}`;
          input.chapterName = metaData.chapters[metaKey]?.name || '';
        } catch {
          input.chapterName = '';
        }
      }

      // Check for duplicate
      const exists = await this.checkDuplicate(
        input.course,
        input.level,
        input.chapter,
        input.lessonNumber,
        input.skill
      );
      
      if (exists) {
        throw new Error(
          `Lesson already exists: Level ${input.level}, Chapter ${input.chapter}, Lesson ${input.lessonNumber}, Skill: ${input.skill}`
        );
      }
      
      const id = `${input.course}-L${input.level}-C${input.chapter}-${input.lessonNumber}-${input.skill}-${Date.now()}`;
      const now = new Date().toISOString();
      
      const result = await session.run(
        `CREATE (l:LessonMaterial {
          id: $id,
          course: $course,
          level: $level,
          chapter: $chapter,
          lessonNumber: $lessonNumber,
          skill: $skill,
          chapterName: $chapterName,
          lessonName: $lessonName,
          goalTextEn: $goalTextEn,
          goalTextJp: $goalTextJp,
          backgroundImage: $backgroundImage,
          overlayColor: $overlayColor,
          status: $status,
          createdBy: $createdBy,
          createdByName: $createdByName,
          createdAt: $createdAt,
          updatedAt: $updatedAt
        })
        RETURN l`,
        {
          id,
          course: input.course,
          level: neo4j.int(input.level),
          chapter: neo4j.int(input.chapter),
          lessonNumber: neo4j.int(input.lessonNumber),
          skill: input.skill,
          chapterName: input.chapterName || '',
          lessonName: input.lessonName,
          goalTextEn: input.goalTextEn,
          goalTextJp: input.goalTextJp,
          backgroundImage: '',
          overlayColor: '#0369a1cc',
          status: 'draft',
          createdBy: input.createdBy,
          createdByName: input.createdByName || '',
          createdAt: now,
          updatedAt: now,
        }
      );
      
      const record = result.records[0];
      if (!record) {
        throw new Error('Failed to create lesson - no record returned');
      }
      return transformLesson(record.get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * Get a lesson by ID
   */
  async getById(id: string): Promise<LessonMaterial | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {id: $id}) RETURN l`,
        { id }
      );
      
      if (result.records.length === 0 || !result.records[0]) return null;
      return transformLesson(result.records[0].get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * List all lessons for a course
   */
  async listByCourse(course: string): Promise<LessonMaterial[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {course: $course})
        RETURN l
        ORDER BY l.level, l.chapter, l.lessonNumber, l.skill`,
        { course }
      );
      
      return result.records.map(r => transformLesson(r.get('l')));
    } finally {
      await session.close();
    }
  },

  /**
   * Update header styling (background image, overlay color)
   */
  async updateHeader(id: string, input: UpdateHeaderInput): Promise<LessonMaterial> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const setClauses: string[] = ['l.updatedAt = $updatedAt'];
      const params: Record<string, any> = { id, updatedAt: new Date().toISOString() };
      
      if (input.backgroundImage !== undefined) {
        setClauses.push('l.backgroundImage = $backgroundImage');
        params.backgroundImage = input.backgroundImage;
      }
      
      if (input.overlayColor !== undefined) {
        setClauses.push('l.overlayColor = $overlayColor');
        params.overlayColor = input.overlayColor;
      }

      if (input.chapterName !== undefined) {
        setClauses.push('l.chapterName = $chapterName');
        params.chapterName = input.chapterName;
      }

      if (input.lessonName !== undefined) {
        setClauses.push('l.lessonName = $lessonName');
        params.lessonName = input.lessonName;
      }

      if (input.goalTextEn !== undefined) {
        setClauses.push('l.goalTextEn = $goalTextEn');
        params.goalTextEn = input.goalTextEn;
      }

      if (input.goalTextJp !== undefined) {
        setClauses.push('l.goalTextJp = $goalTextJp');
        params.goalTextJp = input.goalTextJp;
      }

      if (input.introductionData !== undefined) {
        setClauses.push('l.introductionData = $introductionData');
        // Store as JSON string
        params.introductionData = JSON.stringify(input.introductionData);
      }

      if (input.learnData !== undefined) {
        setClauses.push('l.learnData = $learnData');
        // Store as JSON string
        params.learnData = JSON.stringify(input.learnData);
      }

      if (input.stepBData !== undefined) {
        setClauses.push('l.stepBData = $stepBData');
        // Store as JSON string
        params.stepBData = JSON.stringify(input.stepBData);
      }

      if (input.applyData !== undefined) {
        setClauses.push('l.applyData = $applyData');
        // Store as JSON string
        params.applyData = JSON.stringify(input.applyData);
      }

      if (input.exerciseData !== undefined) {
        setClauses.push('l.exerciseData = $exerciseData');
        // Store as JSON string
        params.exerciseData = JSON.stringify(input.exerciseData);
      }

      if (input.storyData !== undefined) {
        setClauses.push('l.storyData = $storyData');
        // Store as JSON string
        params.storyData = JSON.stringify(input.storyData);
      }

      if (input.missionData !== undefined) {
        setClauses.push('l.missionData = $missionData');
        params.missionData = JSON.stringify(input.missionData);
      }

      if (input.missionData2 !== undefined) {
        setClauses.push('l.missionData2 = $missionData2');
        params.missionData2 = JSON.stringify(input.missionData2);
      }

      if (input.missionData3 !== undefined) {
        setClauses.push('l.missionData3 = $missionData3');
        params.missionData3 = JSON.stringify(input.missionData3);
      }

      if (input.feedbackData !== undefined) {
        setClauses.push('l.feedbackData = $feedbackData');
        params.feedbackData = JSON.stringify(input.feedbackData);
      }

      if (input.discussionQuestionsData !== undefined) {
        setClauses.push('l.discussionQuestionsData = $discussionQuestionsData');
        params.discussionQuestionsData = JSON.stringify(input.discussionQuestionsData);
      }

      if (input.beData !== undefined) {
        setClauses.push('l.beData = $beData');
        params.beData = JSON.stringify(input.beData);
      }
      
      const result = await session.run(
        `MATCH (l:LessonMaterial {id: $id})
        SET ${setClauses.join(', ')}
        RETURN l`,
        params
      );
      
      const record = result.records[0];
      if (!record) {
        throw new Error('Lesson not found');
      }
      
      return transformLesson(record.get('l'));
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
        `MATCH (l:LessonMaterial {id: $id}) 
        DELETE l
        RETURN count(l) as deleted`,
        { id }
      );
      const deletedCount = result.records[0]?.get('deleted')?.toNumber?.() ?? 0;
      return deletedCount > 0;
    } finally {
      await session.close();
    }
  },

  /**
   * Duplicate a lesson - creates a copy with a new ID and incremented lesson number
   */
  async duplicate(
    id: string, 
    createdBy: string, 
    createdByName: string
  ): Promise<LessonMaterial | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // First, get the original lesson
      const original = await this.getById(id);
      if (!original) {
        return null;
      }

      // Find the next available lesson number in the same level/chapter
      const existingResult = await session.run(
        `MATCH (l:LessonMaterial {
          course: $course, 
          level: $level, 
          chapter: $chapter
        })
        RETURN max(l.lessonNumber) as maxLesson`,
        { 
          course: original.course, 
          level: neo4j.int(original.level), 
          chapter: neo4j.int(original.chapter) 
        }
      );
      
      const maxLesson = existingResult.records[0]?.get('maxLesson');
      let nextLessonNumber = (neo4j.isInt(maxLesson) ? maxLesson.toNumber() : (maxLesson || 0)) + 1;
      
      const nextSkill = getExpectedSkillForCourse(original.course, nextLessonNumber) || original.skill;

      // Business English has a fixed 5-lesson chapter structure.
      // Other courses keep the older 10-lesson cap.
      if (original.course === 'business-english' && nextLessonNumber > 5) {
        throw new Error('Business English chapters only allow 5 lessons. Please use a different chapter.');
      }

      if (original.course !== 'business-english' && nextLessonNumber > 10) {
        throw new Error('Maximum lessons (10) reached for this chapter. Please use a different chapter.');
      }

      const newId = crypto.randomUUID();
      const now = new Date().toISOString();
      
      // Create duplicate with new ID, lesson number, and timestamps
      const result = await session.run(
        `CREATE (l:LessonMaterial {
          id: $id,
          course: $course,
          level: $level,
          chapter: $chapter,
          lessonNumber: $lessonNumber,
          skill: $skill,
          chapterName: $chapterName,
          lessonName: $lessonName,
          goalTextEn: $goalTextEn,
          goalTextJp: $goalTextJp,
          backgroundImage: $backgroundImage,
          overlayColor: $overlayColor,
          introductionData: $introductionData,
          learnData: $learnData,
          stepBData: $stepBData,
          applyData: $applyData,
          exerciseData: $exerciseData,
          createdAt: $createdAt,
          updatedAt: $updatedAt,
          createdBy: $createdBy,
          createdByName: $createdByName
        })
        RETURN l`,
        {
          id: newId,
          course: original.course,
          level: neo4j.int(original.level),
          chapter: neo4j.int(original.chapter),
          lessonNumber: neo4j.int(nextLessonNumber),
          skill: nextSkill,
          chapterName: original.chapterName || '',
          lessonName: `${original.lessonName || ''} (Copy)`,
          goalTextEn: original.goalTextEn,
          goalTextJp: original.goalTextJp,
          backgroundImage: original.backgroundImage || '',
          overlayColor: original.overlayColor || '#0369a1cc',
          introductionData: original.introductionData ? JSON.stringify(original.introductionData) : '',
          learnData: original.learnData ? JSON.stringify(original.learnData) : '',
          stepBData: original.stepBData ? JSON.stringify(original.stepBData) : '',
          applyData: original.applyData ? JSON.stringify(original.applyData) : '',
          exerciseData: original.exerciseData ? JSON.stringify(original.exerciseData) : '',
          createdAt: now,
          updatedAt: now,
          createdBy,
          createdByName,
        }
      );

      const record = result.records[0];
      if (!record) return null;

      return transformLesson(record.get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * Get all unique chapters for a course/level (for dropdown auto-fill)
   */
  async getChapters(course: string, level: number): Promise<{ chapter: number; chapterName: string }[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      // For conversational-skills Level 1 enforce only chapter 1 is returned
      if (course === 'conversational-skills' && level === 1) {
        const result = await session.run(
          `MATCH (l:LessonMaterial {course: $course, level: $level, chapter: $chapter})
          RETURN DISTINCT l.chapter as chapter, l.chapterName as chapterName
          ORDER BY l.chapter`,
          { course, level: neo4j.int(level), chapter: neo4j.int(1) }
        );

        return result.records.map(r => ({
          chapter: neo4j.isInt(r.get('chapter')) ? r.get('chapter').toNumber() : r.get('chapter'),
          chapterName: r.get('chapterName'),
        }));
      }

      const result = await session.run(
        `MATCH (l:LessonMaterial {course: $course, level: $level})
        RETURN DISTINCT l.chapter as chapter, l.chapterName as chapterName
        ORDER BY l.chapter`,
        { course, level: neo4j.int(level) }
      );

      return result.records.map(r => ({
        chapter: neo4j.isInt(r.get('chapter')) ? r.get('chapter').toNumber() : r.get('chapter'),
        chapterName: r.get('chapterName'),
      }));
    } finally {
      await session.close();
    }
  },

  /**
   * Publish a lesson (change status from 'draft' to 'published')
   */
  async publish(id: string): Promise<LessonMaterial | null> {
    const lesson = await this.getById(id);
    if (!lesson) return null;
    const errors = conversationalLessonErrors(lesson);
    if (errors.length) throw new Error(`Complete the lesson before publishing: ${errors.join(' ')}`);
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {id: $id})
        WHERE l.updatedAt = $previousUpdatedAt
        SET l.status = 'published', l.updatedAt = $updatedAt
        RETURN l`,
        { id, previousUpdatedAt: lesson.updatedAt, updatedAt: new Date().toISOString() }
      );
      
      if (result.records.length === 0 || !result.records[0]) throw new Error('Lesson changed during validation. Reload and publish again.');
      return transformLesson(result.records[0].get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * Unpublish a lesson (change status from 'published' to 'draft')
   */
  async unpublish(id: string): Promise<LessonMaterial | null> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {id: $id})
        SET l.status = 'draft', l.updatedAt = $updatedAt
        RETURN l`,
        { id, updatedAt: new Date().toISOString() }
      );
      
      if (result.records.length === 0 || !result.records[0]) return null;
      return transformLesson(result.records[0].get('l'));
    } finally {
      await session.close();
    }
  },

  /**
   * List all published lessons for a course (for student/tutor apps)
   */
  async listPublishedByCourse(course: string): Promise<LessonMaterial[]> {
    const driver = getDriver();
    const session = driver.session();
    
    try {
      const result = await session.run(
        `MATCH (l:LessonMaterial {course: $course, status: 'published'})
        RETURN l
        ORDER BY l.level, l.chapter, l.lessonNumber`,
        { course }
      );
      
      return result.records.map(r => transformLesson(r.get('l')));
    } finally {
      await session.close();
    }
  },

  // ==========================================================================
  // COURSE METADATA  (Level topics, Chapter themes & names)
  // ==========================================================================

  /**
   * Get all metadata for a course (level topics + chapter themes/names)
   */
  async getCourseMetadata(
    course: string
  ): Promise<{ levels: Record<number, { mainTopic: string }>; chapters: Record<string, { theme: string; name: string }> }> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `MATCH (m:CourseMetadata {course: $course}) RETURN m`,
        { course }
      );

      const levels: Record<number, { mainTopic: string }> = {};
      const chapters: Record<string, { theme: string; name: string }> = {};

      for (const record of result.records) {
        const props = record.get('m').properties;
        const type = props.type as string; // 'level' | 'chapter'

        if (type === 'level') {
          const lvl = neo4j.isInt(props.level) ? props.level.toNumber() : Number(props.level);
          levels[lvl] = { mainTopic: props.mainTopic || '' };
        } else if (type === 'chapter') {
          const lvl = neo4j.isInt(props.level) ? props.level.toNumber() : Number(props.level);
          const ch = neo4j.isInt(props.chapter) ? props.chapter.toNumber() : Number(props.chapter);
          chapters[`${lvl}-${ch}`] = { theme: props.theme || '', name: props.name || '' };
        }
      }

      return { levels, chapters };
    } finally {
      await session.close();
    }
  },

  /**
   * Save level main-topic
   */
  async saveLevelTopic(course: string, level: number, mainTopic: string): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.run(
        `MERGE (m:CourseMetadata {course: $course, type: 'level', level: $level})
         SET m.mainTopic = $mainTopic, m.updatedAt = $now`,
        { course, level: neo4j.int(level), mainTopic, now: new Date().toISOString() }
      );
    } finally {
      await session.close();
    }
  },

  /**
   * Save chapter theme + name (and propagate name to all lessons in that chapter)
   */
  async saveChapterMeta(
    course: string,
    level: number,
    chapter: number,
    data: { theme?: string; name?: string }
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const setClauses = ['m.updatedAt = $now'];
      const params: Record<string, any> = {
        course,
        level: neo4j.int(level),
        chapter: neo4j.int(chapter),
        now: new Date().toISOString(),
      };

      if (data.theme !== undefined) {
        setClauses.push('m.theme = $theme');
        params.theme = data.theme;
      }
      if (data.name !== undefined) {
        setClauses.push('m.name = $name');
        params.name = data.name;
      }

      await session.run(
        `MERGE (m:CourseMetadata {course: $course, type: 'chapter', level: $level, chapter: $chapter})
         SET ${setClauses.join(', ')}`,
        params
      );

      // Also propagate chapter name to all existing lessons in that chapter
      if (data.name !== undefined) {
        await session.run(
          `MATCH (l:LessonMaterial {course: $course, level: $level, chapter: $chapter})
           SET l.chapterName = $name, l.updatedAt = $now`,
          { course, level: neo4j.int(level), chapter: neo4j.int(chapter), name: data.name, now: new Date().toISOString() }
        );
      }
    } finally {
      await session.close();
    }
  },

  // ==========================================================================
  // LEVEL ADMIN ASSIGNMENT
  // ==========================================================================

  /**
   * Assign an admin to a level (stores on the level metadata node)
   */
  async assignLevelAdmin(
    course: string,
    level: number,
    adminId: string,
    adminName: string
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.run(
        `MERGE (m:CourseMetadata {course: $course, type: 'level', level: $level})
         SET m.assignedAdminId = $adminId, m.assignedAdminName = $adminName, m.updatedAt = $now`,
        {
          course,
          level: neo4j.int(level),
          adminId,
          adminName,
          now: new Date().toISOString(),
        }
      );
    } finally {
      await session.close();
    }
  },

  /**
   * Unassign admin from a level
   */
  async unassignLevelAdmin(course: string, level: number): Promise<void> {
    const driver = getDriver();
    const session = driver.session();

    try {
      await session.run(
        `MATCH (m:CourseMetadata {course: $course, type: 'level', level: $level})
         REMOVE m.assignedAdminId, m.assignedAdminName
         SET m.updatedAt = $now`,
        { course, level: neo4j.int(level), now: new Date().toISOString() }
      );
    } finally {
      await session.close();
    }
  },

  /**
   * Get level assignments for a course
   */
  async getLevelAssignments(course: string): Promise<Record<number, { adminId: string; adminName: string }>> {
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.run(
        `MATCH (m:CourseMetadata {course: $course, type: 'level'})
         WHERE m.assignedAdminId IS NOT NULL
         RETURN m.level AS level, m.assignedAdminId AS adminId, m.assignedAdminName AS adminName`,
        { course }
      );

      const assignments: Record<number, { adminId: string; adminName: string }> = {};
      for (const record of result.records) {
        const lvl = neo4j.isInt(record.get('level')) ? record.get('level').toNumber() : Number(record.get('level'));
        assignments[lvl] = {
          adminId: record.get('adminId'),
          adminName: record.get('adminName'),
        };
      }
      return assignments;
    } finally {
      await session.close();
    }
  },

  /**
   * Batch-save course structure generated by AI (level topic + chapter themes/names)
   */
  async saveCourseStructure(
    course: string,
    level: number,
    data: {
      mainTopic: string;
      chapters: Array<{ chapter: number; theme: string; name: string }>;
    }
  ): Promise<void> {
    const driver = getDriver();
    const session = driver.session();
    const now = new Date().toISOString();

    try {
      // Save level topic
      await session.run(
        `MERGE (m:CourseMetadata {course: $course, type: 'level', level: $level})
         SET m.mainTopic = $mainTopic, m.updatedAt = $now`,
        { course, level: neo4j.int(level), mainTopic: data.mainTopic, now }
      );

      // Save all chapter themes/names
      for (const ch of data.chapters) {
        await session.run(
          `MERGE (m:CourseMetadata {course: $course, type: 'chapter', level: $level, chapter: $chapter})
           SET m.theme = $theme, m.name = $name, m.updatedAt = $now`,
          {
            course,
            level: neo4j.int(level),
            chapter: neo4j.int(ch.chapter),
            theme: ch.theme,
            name: ch.name,
            now,
          }
        );

        // Propagate name to existing lessons
        await session.run(
          `MATCH (l:LessonMaterial {course: $course, level: $level, chapter: $chapter})
           SET l.chapterName = $name, l.updatedAt = $now`,
          { course, level: neo4j.int(level), chapter: neo4j.int(ch.chapter), name: ch.name, now }
        );
      }
    } finally {
      await session.close();
    }
  },
};
