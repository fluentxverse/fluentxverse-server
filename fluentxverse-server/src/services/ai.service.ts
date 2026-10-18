/**
 * AI Service - Grammar Checking and Language Assistance
 * Uses Mastra Agent with OpenAI for grammar correction and explanations
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createAgent } from "./agentFactory";
import { lessonMaterialService } from "./lessonMaterial.service";

// ============================================================================
// HELPERS
// ============================================================================

type AIServiceAgent = ReturnType<typeof createAgent>;

/** Strip em dashes (—) and en dashes (–) from AI output, replacing with regular dashes */
function sanitizeAIText(text: string): string {
  return text.replace(/—/g, '-').replace(/–/g, '-');
}

type BELessonSkill = 'listening' | 'reading' | 'speaking' | 'review';

interface BEReferenceLesson {
  level?: number;
  chapter?: number;
  lessonNumber: number;
  lessonName: string;
  chapterName: string;
  goalTextEn: string;
  goalTextKr: string;
  lessonType: string;
  beData: any;
  source: 'db' | 'file';
}

const BE_HOUSE_STANDARD_LEVEL = 3;
const BE_HOUSE_STANDARD_CHAPTER = 1;
const BE_HOUSE_STANDARD_LESSON_NUMBERS = [1, 2, 3] as const;

const stripHtml = (text: string = '') =>
  (text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const truncateText = (text: string = '', maxLength = 220) => {
  const normalized = stripHtml(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
};

const getBusinessEnglishLessonSkill = (lessonNumber: number): BELessonSkill => {
  if (lessonNumber === 1) return 'listening';
  if (lessonNumber === 2) return 'reading';
  if (lessonNumber === 5) return 'review';
  return 'speaking';
};

const getBusinessEnglishSkillGuidance = (skill: BELessonSkill, level: number): string => {
  const levelNote = level <= 3
    ? 'Use very short sentences and highly controlled language.'
    : 'Keep the language appropriate for the target TOEIC range.';

  if (skill === 'listening') {
    return `This lesson slot is LISTENING. Build the lesson around listening comprehension first, then guided production. ${levelNote} The tutor should model or read key language first. Practice should move from hearing and repeating to short guided responses.`;
  }

  if (skill === 'reading') {
    return `This lesson slot is READING. Build the lesson around understanding written workplace text before speaking. ${levelNote} Use readable materials such as profile cards, team directory entries, emails, schedules, or short notices. Practice and simulation should start from what the student reads.`;
  }

  if (skill === 'review') {
    return `This lesson slot is REVIEW. Combine patterns and vocabulary from earlier lessons in the chapter without copying any earlier lesson exactly. ${levelNote} The review should recycle and connect earlier content, not feel like a brand-new topic.`;
  }

  return `This lesson slot is SPEAKING. Prioritize student production, natural roleplay, and follow-up questions. ${levelNote} Practice should build from controlled speaking to freer speaking.`;
};

const getBusinessEnglishDocsLessonPath = (level: number, chapter: number, lessonNumber: number) => {
  const docsRoot = path.resolve(import.meta.dir, '../../..', 'docs', 'lesson-materials', 'business-conversation');
  const levelDir = `level-${String(level).padStart(2, '0')}`;
  const lessonPrefix = `ch${String(chapter).padStart(2, '0')}-L${lessonNumber}-`;
  return { docsRoot, levelDir, lessonPrefix };
};

const buildReferenceLessonFromRaw = (raw: any, lessonNumber: number, source: 'db' | 'file'): BEReferenceLesson => ({
  level: raw.level,
  chapter: raw.chapter,
  lessonNumber,
  lessonName: raw.lessonName || '',
  chapterName: raw.chapterName || '',
  goalTextEn: raw.goalTextEn || '',
  goalTextKr: raw.goalTextKr || raw.goalTextJp || '',
  lessonType: raw.beData?.lessonType || '',
  beData: raw.beData || {},
  source,
});

const summarizeReferencePatterns = (lesson: BEReferenceLesson, limit = 5) =>
  (lesson.beData?.present?.patterns || [])
    .slice(0, limit)
    .map((pattern: any) => stripHtml(pattern?.en || ''))
    .filter(Boolean)
    .map((pattern: string) => `"${pattern}"`)
    .join(', ');

const summarizeReferenceVocabulary = (lesson: BEReferenceLesson, limit = 6) =>
  (lesson.beData?.present?.vocabulary || [])
    .slice(0, limit)
    .map((item: any) => {
      const word = stripHtml(item?.word || '');
      if (!word) return '';
      const pos = stripHtml(item?.pos || '');
      const translation = stripHtml(item?.translation || '');
      const definition = stripHtml(item?.definition || '');
      return `${word}${pos ? ` (${pos})` : ''}${translation ? ` = ${translation}` : ''}${definition ? `; ${definition}` : ''}`;
    })
    .filter(Boolean)
    .join(' | ');

const summarizeTutorNotes = (notes: any[] = [], limit = 8) =>
  (Array.isArray(notes) ? notes : [])
    .slice(0, limit)
    .map((note: any) => {
      const type = stripHtml(note?.type || 'instruction');
      const text = truncateText(note?.text || '', 130);
      return text ? `${type}: ${text}` : '';
    })
    .filter(Boolean)
    .join(' | ');

const summarizeReferenceQuestions = (lesson: BEReferenceLesson, limit = 6) =>
  (lesson.beData?.challenge?.tutorNotes || [])
    .filter((note: any) => note?.type === 'question')
    .slice(0, limit)
    .map((note: any) => stripHtml(note?.text || ''))
    .filter(Boolean)
    .map((question: string) => `"${question}"`)
    .join(', ');

const summarizeDiscussionFlow = (lesson: BEReferenceLesson) =>
  (lesson.beData?.discussion?.tutorNotes || [])
    .map((note: any) => `${note?.type || 'instruction'}: ${stripHtml(note?.text || '')}`)
    .slice(0, 4)
    .join(' | ');

const summarizePracticeTitles = (lesson: BEReferenceLesson, limit = 4) =>
  (lesson.beData?.practice?.steps || [])
    .slice(0, limit)
    .map((step: any) => stripHtml(step?.title || ''))
    .filter(Boolean)
    .join(' | ');

const summarizePracticeSteps = (lesson: BEReferenceLesson) =>
  (lesson.beData?.practice?.steps || [])
    .slice(0, 4)
    .map((step: any) => {
      const title = stripHtml(step?.title || '');
      const instruction = truncateText(step?.instructionEn || '', 130);
      const dialoguePreview = Array.isArray(step?.dialogue) && step.dialogue.length > 0
        ? ` Dialogue: ${step.dialogue.slice(0, 2).map((line: any) => `${line?.role || 'role'}: ${truncateText(line?.en || '', 70)}`).join(' / ')}`
        : '';
      return [title, instruction, dialoguePreview].filter(Boolean).join(' - ');
    })
    .filter(Boolean)
    .join(' | ');

const summarizePatternDrills = (lesson: BEReferenceLesson) =>
  (lesson.beData?.understand?.patternDrills || [])
    .slice(0, 3)
    .map((drill: any) => {
      const label = stripHtml(drill?.label || '');
      const template = stripHtml(drill?.template || '');
      return [label, template].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .join(' | ');

const summarizeFillRows = (lesson: BEReferenceLesson) =>
  (lesson.beData?.understand?.fillRows || [])
    .slice(0, 4)
    .map((row: any) => {
      const sentence = (row?.parts || [])
        .map((part: any) => part?.isBlank ? '___' : stripHtml(part?.text || ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      return sentence;
    })
    .filter(Boolean)
    .join(' | ');

const summarizeActivityBlocks = (blocks: any[] = []) =>
  (Array.isArray(blocks) ? blocks : [])
    .slice(0, 2)
    .map((block: any) => {
      const title = stripHtml(block?.title || block?.id || block?.type || '');
      const passage = truncateText(block?.passage || block?.content || '', 160);
      return [block?.type || 'activity', title, passage].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .join(' | ');

const summarizeDiscussionCategories = (lesson: BEReferenceLesson) =>
  (lesson.beData?.discussion?.categories || [])
    .slice(0, 3)
    .map((category: any) => {
      const title = stripHtml(category?.title || '');
      const questions = (category?.questions || [])
        .slice(0, 3)
        .map((question: string) => stripHtml(question || ''))
        .filter(Boolean)
        .join(' / ');
      return [title, questions].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .join(' | ');

const getReferenceLessonSkill = (lesson: BEReferenceLesson): BELessonSkill => {
  const lessonType = (lesson.lessonType || '').toLowerCase();
  if (lessonType.includes('listen')) return 'listening';
  if (lessonType.includes('read')) return 'reading';
  if (lessonType.includes('review')) return 'review';
  if (lessonType.includes('speak')) return 'speaking';
  return getBusinessEnglishLessonSkill(lesson.lessonNumber);
};

const getSkillMatchedStandardLessons = (lessons: BEReferenceLesson[], skill: BELessonSkill) => {
  if (skill === 'review') return lessons;
  const matching = lessons.filter((lesson) => getReferenceLessonSkill(lesson) === skill);
  return matching.length > 0 ? matching : lessons;
};

const getReferenceLessonSummary = (lesson: BEReferenceLesson) => {
  const patterns = summarizeReferencePatterns(lesson);
  const vocabulary = summarizeReferenceVocabulary(lesson, 4);
  const questions = summarizeReferenceQuestions(lesson);
  const discussionFlow = summarizeDiscussionFlow(lesson);
  const practiceTitles = summarizePracticeTitles(lesson);
  const skill = getReferenceLessonSkill(lesson).toUpperCase();

  return [
    `Lesson ${lesson.lessonNumber} (${lesson.lessonType || skill}): ${lesson.lessonName}`,
    lesson.goalTextEn ? `Goal: ${lesson.goalTextEn}` : '',
    patterns ? `Patterns: ${patterns}` : '',
    vocabulary ? `Vocabulary: ${vocabulary}` : '',
    practiceTitles ? `Practice shape: ${practiceTitles}` : '',
    questions ? `Simulation prompt style: ${questions}` : '',
    discussionFlow ? `Open Talk notes: ${discussionFlow}` : '',
  ].filter(Boolean).join('\n');
};

const getHouseStandardLessonSummary = (lesson: BEReferenceLesson) => {
  const introduce = lesson.beData?.introduce || {};
  const present = lesson.beData?.present || {};
  const understand = lesson.beData?.understand || {};
  const challenge = lesson.beData?.challenge || {};
  const discussion = lesson.beData?.discussion || {};
  const skill = getReferenceLessonSkill(lesson).toUpperCase();
  const activityBlocks = summarizeActivityBlocks(challenge.activityBlocks || []);

  return [
    `STANDARD L${lesson.level || BE_HOUSE_STANDARD_LEVEL} Ch${lesson.chapter || BE_HOUSE_STANDARD_CHAPTER} Lesson ${lesson.lessonNumber} (${lesson.lessonType || skill}): ${lesson.lessonName}`,
    lesson.goalTextEn ? `Goal: ${lesson.goalTextEn}` : '',
    introduce.situationEn ? `Warm-up situation: ${truncateText(introduce.situationEn, 180)}` : '',
    introduce.taskEn ? `Warm-up task: ${truncateText(introduce.taskEn, 160)}` : '',
    introduce.tutorNotes?.length ? `Warm-up note style: ${summarizeTutorNotes(introduce.tutorNotes, 8)}` : '',
    summarizeReferencePatterns(lesson, 6) ? `Key expressions: ${summarizeReferencePatterns(lesson, 6)}` : '',
    summarizeReferenceVocabulary(lesson, 6) ? `Vocabulary bank: ${summarizeReferenceVocabulary(lesson, 6)}` : '',
    present.pronunciation?.instruction ? `Pronunciation focus: ${stripHtml(present.pronunciation.instruction)} (${stripHtml(present.pronunciation?.left?.symbol || '')} vs ${stripHtml(present.pronunciation?.right?.symbol || '')})` : '',
    understand.instruction ? `Comprehension instruction: ${truncateText(understand.instruction, 160)}` : '',
    summarizePatternDrills(lesson) ? `Pattern drills: ${summarizePatternDrills(lesson)}` : '',
    summarizeFillRows(lesson) ? `Fill-row shape: ${summarizeFillRows(lesson)}` : '',
    summarizePracticeSteps(lesson) ? `Practice progression: ${summarizePracticeSteps(lesson)}` : '',
    challenge.scenarioEn ? `Simulation scenario: ${truncateText(challenge.scenarioEn, 220)}` : '',
    challenge.roleplayTable ? `Roleplay setup: you=${truncateText(challenge.roleplayTable.you || '', 80)}; coworkers=${(challenge.roleplayTable.coworkers || []).join(', ')}` : '',
    activityBlocks ? `Simulation support block: ${activityBlocks}` : '',
    summarizeReferenceQuestions(lesson, 6) ? `Simulation questions: ${summarizeReferenceQuestions(lesson, 6)}` : '',
    discussion.instructionEn ? `Discussion instruction: ${truncateText(discussion.instructionEn, 120)}` : '',
    summarizeDiscussionCategories(lesson) ? `Discussion categories: ${summarizeDiscussionCategories(lesson)}` : '',
    discussion.tutorNotes?.length ? `Discussion note style: ${summarizeTutorNotes(discussion.tutorNotes, 5)}` : '',
  ].filter(Boolean).join('\n');
};

const getFileReferenceLesson = async (level: number, chapter: number, lessonNumber: number): Promise<BEReferenceLesson | null> => {
  try {
    const { docsRoot, levelDir, lessonPrefix } = getBusinessEnglishDocsLessonPath(level, chapter, lessonNumber);
    const lessonDir = path.join(docsRoot, levelDir, 'lesson-data');
    const fileNames = await readdir(lessonDir);
    const fileName = fileNames.find((name) => name.startsWith(lessonPrefix) && name.endsWith('.json'));
    if (!fileName) return null;
    const raw = JSON.parse(await readFile(path.join(lessonDir, fileName), 'utf8'));
    return buildReferenceLessonFromRaw({ ...raw, level, chapter }, lessonNumber, 'file');
  } catch {
    return null;
  }
};

const getFileReferenceLessonsForLevel = async (level: number): Promise<BEReferenceLesson[]> => {
  try {
    const { docsRoot, levelDir } = getBusinessEnglishDocsLessonPath(level, 1, 1);
    const lessonDir = path.join(docsRoot, levelDir, 'lesson-data');
    const fileNames = await readdir(lessonDir);
    const lessons = await Promise.all(
      fileNames
        .filter((name) => /^ch\d+-L\d+-.*\.json$/.test(name))
        .map(async (fileName) => {
          const match = fileName.match(/^ch(\d+)-L(\d+)-.*\.json$/);
          if (!match) return null;
          const fileChapter = Number(match[1]);
          const fileLessonNumber = Number(match[2]);
          try {
            const raw = JSON.parse(await readFile(path.join(lessonDir, fileName), 'utf8'));
            return buildReferenceLessonFromRaw(
              { ...raw, level, chapter: fileChapter },
              fileLessonNumber,
              'file',
            );
          } catch {
            return null;
          }
        }),
    );
    return lessons.filter((lesson): lesson is BEReferenceLesson => !!lesson);
  } catch {
    return [];
  }
};

const getExistingLessonSignature = (lesson: BEReferenceLesson) => {
  const patterns = summarizeReferencePatterns(lesson, 3);
  const scenario = truncateText(
    lesson.beData?.challenge?.scenarioEn
      || lesson.beData?.introduce?.situationEn
      || '',
    180,
  );
  const lessonType = lesson.lessonType || getReferenceLessonSkill(lesson).toUpperCase();

  return [
    `L${lesson.level || '?'} Ch${lesson.chapter || '?'} Lesson ${lesson.lessonNumber} (${lessonType}): ${lesson.lessonName}`,
    lesson.goalTextEn ? `Goal: ${truncateText(lesson.goalTextEn, 130)}` : '',
    patterns ? `Patterns: ${patterns}` : '',
    scenario ? `Scenario: ${scenario}` : '',
  ].filter(Boolean).join(' | ');
};

const getReferenceLessons = async (
  level: number,
  chapter: number,
  lessonNumber: number,
): Promise<{
  standardLessons: BEReferenceLesson[];
  previousLessons: BEReferenceLesson[];
  existingLevelLessons: BEReferenceLesson[];
}> => {
  const standardMap = new Map<number, BEReferenceLesson>();
  const previousMap = new Map<number, BEReferenceLesson>();
  const existingLevelMap = new Map<string, BEReferenceLesson>();

  try {
    const lessons = await lessonMaterialService.listByCourse('business-english');
    lessons.forEach((lesson: any) => {
      const ref = buildReferenceLessonFromRaw({
        level: lesson.level,
        chapter: lesson.chapter,
        lessonName: lesson.lessonName,
        chapterName: lesson.chapterName,
        goalTextEn: lesson.goalTextEn,
        goalTextJp: lesson.goalTextJp,
        beData: lesson.beData,
      }, lesson.lessonNumber, 'db');

      if (lesson.level === BE_HOUSE_STANDARD_LEVEL && lesson.chapter === BE_HOUSE_STANDARD_CHAPTER) {
        if (BE_HOUSE_STANDARD_LESSON_NUMBERS.includes(lesson.lessonNumber as typeof BE_HOUSE_STANDARD_LESSON_NUMBERS[number])) {
          standardMap.set(lesson.lessonNumber, ref);
        }
      }

      if (lesson.level === level) {
        const key = `${lesson.chapter}-${lesson.lessonNumber}`;
        const isCurrentLesson = lesson.chapter === chapter && lesson.lessonNumber === lessonNumber;
        if (!isCurrentLesson) existingLevelMap.set(key, ref);
      }

      if (lesson.level === level && lesson.chapter === chapter) {
        if (lesson.lessonNumber < lessonNumber) {
          previousMap.set(lesson.lessonNumber, ref);
        }
      }
    });
  } catch {
    // fall back to files below
  }

  for (const standardNumber of BE_HOUSE_STANDARD_LESSON_NUMBERS) {
    if (!standardMap.has(standardNumber)) {
      const fileLesson = await getFileReferenceLesson(
        BE_HOUSE_STANDARD_LEVEL,
        BE_HOUSE_STANDARD_CHAPTER,
        standardNumber,
      );
      if (fileLesson) standardMap.set(standardNumber, fileLesson);
    }
  }

  for (let previousNumber = 1; previousNumber < lessonNumber; previousNumber += 1) {
    if (!previousMap.has(previousNumber)) {
      const fileLesson = await getFileReferenceLesson(level, chapter, previousNumber);
      if (fileLesson) previousMap.set(previousNumber, fileLesson);
    }
  }

  if (existingLevelMap.size === 0) {
    const fileLessons = await getFileReferenceLessonsForLevel(level);
    fileLessons.forEach((lesson) => {
      const isCurrentLesson = lesson.chapter === chapter && lesson.lessonNumber === lessonNumber;
      if (!isCurrentLesson) existingLevelMap.set(`${lesson.chapter}-${lesson.lessonNumber}`, lesson);
    });
  }

  return {
    standardLessons: Array.from(standardMap.values()).sort((a, b) => a.lessonNumber - b.lessonNumber),
    previousLessons: Array.from(previousMap.values()).sort((a, b) => a.lessonNumber - b.lessonNumber),
    existingLevelLessons: Array.from(existingLevelMap.values())
      .sort((a, b) => (a.chapter || 0) - (b.chapter || 0) || a.lessonNumber - b.lessonNumber),
  };
};

const buildBusinessEnglishReferenceContext = async (
  level: number,
  chapter: number,
  lessonNumber: number,
): Promise<string> => {
  const skill = getBusinessEnglishLessonSkill(lessonNumber);
  const { standardLessons, previousLessons, existingLevelLessons } = await getReferenceLessons(level, chapter, lessonNumber);
  const skillMatchedStandardLessons = getSkillMatchedStandardLessons(standardLessons, skill);
  const standardSummary = standardLessons.map(getHouseStandardLessonSummary).join('\n\n');
  const skillStandardSummary = skillMatchedStandardLessons.map(getReferenceLessonSummary).join('\n\n');
  const previousSummary = previousLessons
    .map((lesson) => {
      const patterns = summarizeReferencePatterns(lesson, 4);
      const scenario = truncateText(lesson.beData?.challenge?.scenarioEn || lesson.beData?.introduce?.situationEn || '', 180);
      return [
        `Lesson ${lesson.lessonNumber} (${lesson.lessonType || getReferenceLessonSkill(lesson).toUpperCase()}): ${lesson.lessonName}`,
        lesson.goalTextEn ? `Goal: ${lesson.goalTextEn}` : '',
        patterns ? `Patterns already used: ${patterns}` : '',
        scenario ? `Scenario already used: ${scenario}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
  const existingLevelSummary = existingLevelLessons
    .filter((lesson) => !(lesson.chapter === chapter && lesson.lessonNumber < lessonNumber))
    .slice(0, 30)
    .map(getExistingLessonSignature)
    .join('\n');

  return [
    `\n\n=== LESSON SLOT TYPE ===`,
    `Skill slot: ${skill.toUpperCase()}`,
    getBusinessEnglishSkillGuidance(skill, level),
    `\n=== HOUSE STANDARD FROM LEVEL 3 CHAPTER 1 LESSONS 1-3 ===`,
    `These three human-authored lessons are the quality standard for the Business English AI widget.`,
    `Use them for section density, PCPP flow, bilingual field completeness, concise tutor-note style, and skill-specific lesson shape.`,
    `Lesson 1 is the LISTENING model, Lesson 2 is the READING model, and Lesson 3 is the SPEAKING model.`,
    `Adapt the standard to the target Level ${level}, Chapter ${chapter}, Lesson ${lessonNumber}. Do not copy the Level 3 Chapter 1 topic, names, scenario, exact expressions, reading passage, or questions unless the target lesson itself is that same lesson.`,
    standardSummary || 'No house-standard lessons found. Keep the section concise, controlled, and tutor-friendly.',
    `\n=== PRIMARY STANDARD FOR THIS ${skill.toUpperCase()} SLOT ===`,
    skillStandardSummary || 'No skill-matched standard lesson found. Use the full house standard above.',
    `\n=== UNIQUENESS AGAINST EXISTING LESSONS ===`,
    previousSummary
      ? `Earlier lessons in this target chapter:\n${previousSummary}`
      : 'There are no earlier lessons in this chapter before this one.',
    existingLevelSummary
      ? `\nOther existing lessons in Level ${level}:\n${existingLevelSummary}`
      : '',
    `\nDo NOT repeat the same lesson name, goal, scenario, key expressions, vocabulary focus, reading passage, prompt questions, roleplay setup, discussion categories, or practice titles too closely. Keep continuity inside the chapter, but make the new lesson clearly different from existing lessons.`,
    `\n=== HOUSE STYLE RULES ===`,
    '- Match the concise teaching-note style used in the standardized lessons.',
    '- Tutor speaks English only.',
    '- Use English names only.',
    '- No em dashes. Use normal punctuation only.',
    '- For Level 3, keep notes and sentences short and predictable.',
    '- For higher levels, increase complexity gradually while preserving the same section structure and tutor usability.',
  ].join('\n');
};

const getPracticeBlueprint = (skill: BELessonSkill, lessonNumber: number, goalTextEn: string) => {
  if (skill === 'listening') {
    return {
      titles: [
        'Step 1 - Repeat After Your Tutor',
        'Step 2 - Fill in the Blanks',
        'Step 3 - Read the Dialogue',
        'Step 4 - Complete the Dialogue',
      ],
      guidance: `Follow the Lesson 1 listening standard. Start with tutor modeling, then controlled blanks, then a short guided dialogue, then a partially completed dialogue.`,
    };
  }

  if (skill === 'reading') {
    return {
      titles: [
        'Step 1 - Read & Repeat',
        'Step 2 - Complete the Sentences',
        'Step 3 - Read a Second Entry',
        'Step 4 - Complete Your Own Profile',
      ],
      guidance: `Follow the Lesson 2 reading standard. Use a readable workplace text first, then sentence completion, then a second short reading entry with dialogue support, then a personalized writing/speaking profile task.`,
    };
  }

  if (skill === 'review') {
    return {
      titles: [
        'Step 1 - Quick Recall',
        'Step 2 - Controlled Review',
        'Step 3 - Full Review Dialogue',
        'Step 4 - Final Speaking Task',
      ],
      guidance: `This is a review lesson. Combine material from earlier lessons in the chapter and move from recall to fuller speaking.`,
    };
  }

  const goal = (goalTextEn || '').toLowerCase();
  if (goal.includes('ask')) {
    return {
      titles: [
        'Step 1 - Repeat After Me',
        'Step 2 - Complete the Questions',
        'Step 3 - Dialogue Practice',
        'Step 4 - Ask About the Team',
      ],
      guidance: `This is a speaking lesson focused on asking questions. Move from repeating target questions to completing them, then to dialogue, then to freer question-based production.`,
    };
  }

  return {
    titles: [
      'Step 1 - Repeat After Me',
      'Step 2 - Fill in Your Introduction',
      'Step 3 - Dialogue Practice',
      'Step 4 - Free Introduction',
    ],
    guidance: `This is a speaking lesson focused on personal production. Move from repeating patterns to controlled completion, then dialogue, then freer speaking.`,
  };
};

const getIntroduceStandardNotes = (
  skill: BELessonSkill,
  goalLine: string,
  situationLine: string,
) => {
  const safeGoal = stripHtml(goalLine || '').replace(/[.]+$/, '').trim();
  const safeSituation = stripHtml(situationLine || '').trim();

  if (skill === 'listening') {
    return [
      { type: 'script', text: `"Today's goal: ${safeGoal || 'listen carefully and respond clearly'}."` },
      { type: 'instruction', text: 'Read the lesson goal aloud.' },
      { type: 'instruction', text: 'Ask the student to repeat the goal.' },
      { type: 'script', text: '"Is it clear?"' },
      { type: 'instruction', text: 'Read the situation clearly.' },
      { type: 'script', text: '"Is it clear? Let\'s go to the next part."' },
      { type: 'tip', text: 'For Listening lessons, focus on understanding first. Speak slowly and repeat key lines if needed.' },
    ];
  }

  if (skill === 'reading') {
    return [
      { type: 'script', text: `"Today's goal: ${safeGoal || 'read the workplace text and understand the key information'}."` },
      { type: 'instruction', text: 'Read the lesson goal aloud. Ask the student to repeat.' },
      { type: 'script', text: '"Is it clear?"' },
      { type: 'instruction', text: 'Read the situation. Check the student understands.' },
      { type: 'script', text: '"Let\'s go to the next part."' },
    ];
  }

  return [
    { type: 'script', text: `"Today's goal: ${safeGoal || 'speak clearly in this workplace situation'}."` },
    { type: 'instruction', text: 'Read the lesson goal aloud. Ask the student to repeat.' },
    { type: 'script', text: '"Is it clear?"' },
    { type: 'instruction', text: safeSituation ? 'Read the situation clearly.' : 'Read the situation.' },
    { type: 'script', text: '"Let\'s go to the next part."' },
  ];
};

// ============================================================================
// TYPES
// ============================================================================

export interface GrammarCheckResult {
  corrected: string;
  simpleExplanation: string;
  technicalExplanation: string;
  hasErrors: boolean;
}

export interface VocabularyDefinitionResult {
  definitions: {
    meaning: string;
    partOfSpeech: string;
    japaneseNative: string;
    japaneseRomanized: string;
  }[];
}

export interface PronunciationResult {
  word: string;
  phonetic: string;
}

// ============================================================================
// AI AGENT FOR GRAMMAR CHECKING
// ============================================================================

const grammarCheckAgent = createAgent({
  name: "Grammar Checker",
  instructions: `You are a concise English grammar assistant for language tutors teaching students. When given a sentence:
1. If there are grammar errors, provide the corrected version and TWO explanations.
2. If the sentence is correct, say so.

Respond ONLY in this JSON format:
{
  "corrected": "the corrected sentence",
  "simpleExplanation": "a simple, student-friendly explanation without grammar terms",
  "technicalExplanation": "brief technical grammar explanation",
  "hasErrors": true/false
}

Keep both explanations concise (max 15 words each).

Examples:
Input: "I eat yesterday"
{
  "corrected": "I ate yesterday.",
  "simpleExplanation": "'Ate' should be used because it already happened yesterday.",
  "technicalExplanation": "Wrong tense: use past simple for completed actions.",
  "hasErrors": true
}

Input: "She go to school every day"
{
  "corrected": "She goes to school every day.",
  "simpleExplanation": "When talking about 'she', we add an 's' to the action word.",
  "technicalExplanation": "Subject-verb agreement: third person singular needs 's'.",
  "hasErrors": true
}`,
  model: "openai/gpt-5.2",
});

// ============================================================================
// GRAMMAR CHECK
// ============================================================================

/**
 * Check grammar and provide correction with explanation
 * @param text - The text to check for grammar errors
 * @returns Corrected text and concise explanation
 */
export const checkGrammar = async (text: string): Promise<GrammarCheckResult> => {
  if (!text.trim()) {
    return {
      corrected: text,
      simpleExplanation: 'No text provided.',
      technicalExplanation: 'No text provided.',
      hasErrors: false,
    };
  }

  try {
    const response = await grammarCheckAgent.generate(text);
    const content = response.text;


    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON response
    try {
      // Clean up the response - remove markdown code blocks if present
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      
      const result = JSON.parse(cleanContent);
      
      
      // Handle various possible field names the AI might use
      const simpleExp = result.simpleExplanation || result.simple_explanation || result.simpleexplanation || '';
      const techExp = result.technicalExplanation || result.technical_explanation || result.technicalexplanation || '';
      
      return {
        corrected: result.corrected || text,
        simpleExplanation: simpleExp || 'No issues found.',
        technicalExplanation: techExp || 'No issues found.',
        hasErrors: result.hasErrors ?? result.has_errors ?? (result.corrected !== text),
      };
    } catch (parseError) {
      // If JSON parsing fails, try to extract information from plain text
      console.error('Failed to parse AI response:', content);
      return {
        corrected: text,
        simpleExplanation: 'Unable to process. Please check manually.',
        technicalExplanation: 'Unable to process. Please check manually.',
        hasErrors: false,
      };
    }
  } catch (error) {
    console.error('Grammar check error:', error);
    throw error;
  }
};

// ============================================================================
// AI AGENT FOR VOCABULARY DEFINITIONS
// ============================================================================

const vocabularyAgent = createAgent({
  name: "Vocabulary Helper",
  instructions: `You are a concise vocabulary assistant for English language tutors. When given a word or phrase:
1. Provide up to 3 different meanings/definitions (if the word has multiple meanings)
2. Include the part of speech for each meaning
3. Translate EACH meaning into Japanese only. Do not generate Korean or Vietnamese translations.
4. For Japanese, use natural kanji/kana in japaneseNative and the pronunciation of that exact translation in japaneseRomanized. Use plain Hepburn romaji with ASCII letters (write long vowels as ou/uu/oo), not English definitions, kana, or IPA. Include both Japanese fields for every meaning.

Use concise English definitions (max 12 words). Respond ONLY with JSON using these four fields per meaning:
{"definitions":[{"meaning":"To move quickly on foot","partOfSpeech":"verb","japaneseNative":"走る","japaneseRomanized":"hashiru"}]}`,
  model: "openai/gpt-5.2",
});

// ============================================================================
// VOCABULARY DEFINITION
// ============================================================================

/**
 * Get vocabulary definition and translations
 * @param word - The word or phrase to define
 * @returns Definition and translations
 */
export const getVocabularyDefinition = async (word: string): Promise<VocabularyDefinitionResult> => {
  if (!word.trim()) {
    return {
      definitions: [{
        meaning: 'No word provided.',
        partOfSpeech: '',
        japaneseNative: '',
        japaneseRomanized: '',
      }],
    };
  }

  try {
    const response = await vocabularyAgent.generate(word);
    const content = response.text;


    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON response
    try {
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      const result = JSON.parse(cleanContent);
      
      // Handle the definitions array
      const definitions = result.definitions || [];
      
      return {
        definitions: definitions.length > 0 ? definitions.map((def: any) => ({
          meaning: def.meaning || 'Definition not available.',
          partOfSpeech: def.partOfSpeech || '',
          japaneseNative: def.japaneseNative || '',
          japaneseRomanized: def.japaneseRomanized || '',
        })) : [{
          meaning: 'Definition not available.',
          partOfSpeech: '',
          japaneseNative: '',
          japaneseRomanized: '',
        }],
      };
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return {
        definitions: [{
          meaning: 'Unable to process. Please check manually.',
          partOfSpeech: '',
          japaneseNative: '',
          japaneseRomanized: '',
        }],
      };
    }
  } catch (error) {
    console.error('Vocabulary definition error:', error);
    throw error;
  }
};

// ============================================================================
// AI AGENT FOR PRONUNCIATION
// ============================================================================

const pronunciationAgent = createAgent({
  name: "Pronunciation Helper",
  instructions: `You are a pronunciation assistant for English language tutors. When given a word or phrase:
1. Provide the phonetic spelling using simple syllables
2. CAPITALIZE the stressed syllable
3. Use hyphens to separate syllables
4. Use simple phonetic representations that are easy to read

Respond ONLY in this JSON format:
{
  "word": "the original word",
  "phonetic": "phonetic spelling with STRESSED syllable capitalized"
}

Examples:
Input: "destroy"
{
  "word": "destroy",
  "phonetic": "dih-STROI"
}

Input: "beautiful"
{
  "word": "beautiful",
  "phonetic": "BYOO-tih-ful"
}

Input: "pronunciation"
{
  "word": "pronunciation",
  "phonetic": "pruh-nun-see-AY-shun"
}

Input: "comfortable"
{
  "word": "comfortable",
  "phonetic": "KUMF-ter-bul"
}

Input: "determine"
{
  "word": "determine",
  "phonetic": "dih-TUR-min"
}`,
  model: "openai/gpt-5.2",
});

// ============================================================================
// PRONUNCIATION
// ============================================================================

/**
 * Get pronunciation/phonetic spelling for a word
 * @param word - The word to get pronunciation for
 * @returns Phonetic spelling with stress marked
 */
export const getPronunciation = async (word: string): Promise<PronunciationResult> => {
  if (!word.trim()) {
    return {
      word: word,
      phonetic: '',
    };
  }

  try {
    const response = await pronunciationAgent.generate(word);
    const content = response.text;


    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON response
    try {
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      const result = JSON.parse(cleanContent);
      
      return {
        word: result.word || word,
        phonetic: result.phonetic || '',
      };
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return {
        word: word,
        phonetic: 'Unable to process.',
      };
    }
  } catch (error) {
    console.error('Pronunciation error:', error);
    throw error;
  }
};

// ============================================================================
// AI AGENT FOR GENERATING INTRODUCTION CONTENT
// ============================================================================

export interface GenerateIntroductionResult {
  introTexts: {
    language: string;
    text: string;
  }[];
  lessonIssue: {
    title: string;
    points: string[];
  };
  lessonGoalDuration: string;
  lessonGoalSteps: {
    instruction: string;
    script?: string | null;
    question?: string | null;
  }[];
  // Optional payload for Learn section (vocabulary / expressions)
  learnVocabulary?: {
    word: string;
    partOfSpeech?: string;
    meaning?: string;
  }[];
  // Expressions for Learn -> Step A Expressions
  learnExpressions?: {
    expression: string;
    definitionLine: string; // e.g., "To <strong>cost an arm and a leg</strong> means to be very expensive."
    exampleSentence: string;
  }[];
  // Step B content
  stepB?: {
    stepType: 'speak-your-mind' | 'grammar-tip' | 'pronunciation';
    speakYourMind?: {
      explanation: string;
      speaker1SpeechBubble: string;
      speaker2SpeechBubble: string;
      question: string;
    };
    grammarTip?: {
      explanations: {
        ruleText: string;
        ruleTranslation: string;
        examples: { sentence: string; translation: string }[];
      }[];
    };
    pronunciation?: {
      tip: string;
      phrases: { phrase: string; pronunciationGuide: string; exampleSentence: string }[];
    };
  };
  // Apply section content (Section 3)
  applyData?: {
    activityType: 'speaking' | 'listening' | 'reading';
    activityDuration: string;
    situationText: string;
    situationTranslation?: string;
    dialogueLines: { speaker: string; text: string; isAction?: boolean }[];
    readingText?: string;
    tutorSteps: {
      instruction: string;
      scripts?: { text: string }[];
      tips?: { text: string }[];
      questions?: { question: string; answer?: string }[];
      listeningScript?: string;
    }[];
    triviaEnabled?: boolean;
    triviaText?: string;
    triviaTranslation?: string;
    triviaDuration?: string;
    triviaTutorSteps?: any[];
  };
  // Standalone Trivia content (separate from Apply)
  triviaData?: {
    triviaText: string;
    triviaTranslation?: string;
    triviaDuration?: string;
    triviaTutorSteps?: {
      instruction: string;
      scripts?: { text: string }[];
      questions?: { question: string; answer?: string }[];
    }[];
  };
  // Exercise section content (Section 4)
  exerciseData?: {
    exerciseStep: 'stepA' | 'stepB';
    exerciseType: string;
    // Step A common
    instructions?: string;
    instructionsTranslation?: string;
    // Step A - Rephrase
    showExpressions?: boolean;
    expressions?: string[];
    showExample?: boolean;
    exampleSentence?: string;
    exampleAnswer?: string;
    exerciseItems?: { sentence: string }[];
    // Step A - Choose
    chooseItems?: { sentence: string }[];
    // Step A - Change
    changeItems?: { sentence: string }[];
    // Answer key
    answers?: { text: string }[];
    tutorSteps?: any[];
    // Step B common
    stepBInstruction?: string;
    stepBInstructionTranslation?: string;
    // Step B - Conversation
    conversations?: { speechBubble: string; position: string }[];
    // Step B - Multiple Choice
    multipleChoiceItems?: { boldSentence: string; optionA: string; optionB: string }[];
    // Step B - Speech
    speechContent?: string;
    // Step B - Compare
    compareWordBox?: string[];
    compareImages?: { label: string }[];
    compareExample?: string;
    compareItems?: { sentence: string }[];
    stepBTutorSteps?: any[];
  };
  // Mission section content (Section 5)
  missionData?: {
    missionType: 'speaking' | 'discussion' | 'reading' | 'listening';
    sectionNumber: number;
    sectionTitle: string;
    challengeNumber: number;
    challengeName: string;
    duration: string;
    situation: string;
    situationTranslation?: string;
    instruction: string;
    instructionTranslation?: string;
    showGrammarTip: boolean;
    grammarTipTitle: string;
    grammarTipItems: string[];
    image?: string;
    tutorSteps: {
      instruction: string;
      scripts?: { text: string }[];
      tips?: { text: string }[];
      listeningScript?: string;
    }[];
    questionsIntro?: string;
    questions: { question: string; hints: string[] }[];
    // Discussion type specific
    isOptional?: boolean;
    topics?: { title: string; questions: string[] }[];
    // Reading type specific
    readingPassage?: {
      title: string;
      author?: string;
      blocks: { type: 'paragraph' | 'images'; text?: string; image?: string }[];
      closingQuestion?: string;
    };
    // Listening type specific
    listeningScript?: string;
  };
}

const introductionGeneratorAgent = createAgent({
  name: "Introduction Question Generator",
  model: "openai/gpt-5.2",
  instructions: `You are an expert ESL lesson designer creating engaging opening questions for language lessons.
  
Your task is to generate ONLY a single, SHORT question for Step 4 ("Ask the question below") in the Tutor Guide of an Introduction section.

CRITICAL REQUIREMENTS:
- Keep the question VERY SHORT (1 simple sentence, max 10-15 words)
- Use SIMPLE vocabulary appropriate for the level
- NEVER use emoji or special symbols
- NO complex sentence structures
- Focus on ENGLISH LEARNING and the lesson topic
- DO NOT ask students about their native language
- DO NOT ask for translations or comparisons with other languages
- Make it directly relevant to what they're learning in English
- Make it a direct, easy-to-answer question

For BEGINNER levels (1-4):
- Ask simple, concrete questions about English (e.g., "Do you like saying hello?", "Can you say your name in English?")
- Use only basic present tense
- Focus on simple English tasks or preferences

For INTERMEDIATE levels (5-7):
- Ask slightly more complex questions (e.g., "When do you speak English?", "Why is greeting important?")
- Include basic opinions or reasons
- Use present tense with some variety

For ADVANCED levels (8-10):
- Ask more thought-provoking questions (e.g., "How do English greetings differ from formal speech?")
- Allow for more detailed responses
- Include compound or complex sentences

Respond ONLY in this JSON format:
{
  "question": "A SHORT, SIMPLE question (1 sentence, max 15 words) about English and the lesson topic"
}`,
});

// Full Introduction Content Generator Agent (for "Generate New" mode)
const fullIntroductionGeneratorAgent = createAgent({
  name: "Full Introduction Content Generator",
  model: "openai/gpt-5.2",
  instructions: `You are an expert ESL lesson designer creating complete introduction sections for language lessons.
  
Generate introduction content including:
1. Introduction text - engaging, substantive opening about the lesson topic (in English and target language if specified)
   - FOCUS ON WHY IT MATTERS: practical context, real-world applications, broader concepts
   - AVOID narrow/repetitive hooks like "your first word is hello" or "everyone knows how to say hello"
   - For Level 1: MAXIMUM 2 sentences, very simple vocabulary, direct and practical
     * Example: "Today, you will learn how to greet someone when you meet them for the first time. In this lesson, you will practice simple, real-life phrases to greet people and sound friendly and confident."
   - For Levels 2-4: Maximum 3 sentences, simple vocabulary appropriate for level, substantive context
   - For Levels 5+: Up to 3-4 sentences, standard vocabulary for intermediate+, practical relevance
2. Lesson issue (OPTIONAL) - a common problem or interesting fact related to the topic (ENGLISH ONLY - do not translate)
3. Lesson goal steps - 5 sequential tutor instructions; steps 1 and 2 use the required opening scripts, and step 4 needs a generated question

CRITICAL REQUIREMENTS FOR LESSON GOAL STEPS:
- Step 1 (Read goal): introduce the goal before any situation or topic context. Use script = "Our goal for today is: [lesson goal]. Is it clear?"
- Step 2 (Read Introduce): introduce the context next. Use script = "Here's our situation. [short situation]"
- Never introduce the situation before the goal.
- Never combine translations, HTML tags, or comprehension questions into a situation field.
- Step 4 (Ask question): ONLY this step has a generated SHORT, practical question (max 15 words) that asks about real-world application of the skill, NOT about "learning English"
  * DO NOT mention "English" in the question
  * Focus on the skill/topic itself (e.g., "When would you greet someone new?" not "Can you say hello in English?")
  * Make it engaging and relevant to student life
- Step 5 (Transition): instruction only, script = "Thank you, let's go to the next part."

CRITICAL REQUIREMENTS FOR LESSON ISSUE (if included):
- MUST BE IN ENGLISH ONLY - do not translate to other languages
- Enforce brevity by level:
  - Level 1-2 (Beginner): Title MAX 4 words (very short phrase); each bullet point MAX 6 words (short phrase, not a full sentence)
  - Level 3-4 (Low-Intermediate): Title MAX 5 words; bullet points 1 short sentence each
  - Level 5+ (Intermediate+): Title MAX 7 words; bullet points may be 1 short sentence each
- Must have exactly 3 bullet points
- Do NOT use the full lesson description as the title
- Example (level 1): "Say Hello" with points like "Say 'Hi'", "Smile", "Ask name" (each point short and actionable)

CRITICAL REQUIREMENTS OVERALL:
- For introduction text: respect the user's language preferences for translations
- Question in Step 4 should be SHORT (max 15 words) and about English learning
- Use vocabulary appropriate for the skill level
- NEVER use emoji or special symbols
- Make content relevant and practical
- If user specifies a translation language (like Korean), use that instead of default

Respond ONLY in this JSON format:
{
  "introTexts": [
    {
      "language": "en",
      "text": "Engaging introduction text explaining the topic (2-3 sentences)"
    },
    {
      "language": "target_language",
      "text": "Translation in the user's specified language"
    }
  ],
  "lessonIssue": {
    "title": "SHORT title (see level-specific brevity rules above)",
    "points": ["Point 1 (short phrase)", "Point 2 (short phrase)", "Point 3 (short phrase)"]
  },
  "lessonGoalDuration": "1 minute",
  "lessonGoalSteps": [
    {
      "instruction": "Introduce today's goal and check understanding.",
      "script": "Our goal for today is: [lesson goal]. Is it clear?",
      "question": null
    },
    {
      "instruction": "Introduce the situation.",
      "script": "Here's our situation. [short situation]",
      "question": null
    },
    {
      "instruction": "Read the Introduce explanation.",
      "script": null,
      "question": null
    },
    {
      "instruction": "Ask the question below.",
      "script": "SHORT question (max 15 words) about English and the lesson topic",
      "question": null
    },
    {
      "instruction": "Transition to next section.",
      "script": "Thank you, let's go to the next part.",
      "question": null
    }
  ]
}`,
});

// ============================================================================
// AI AGENT FOR VOCABULARY LISTS (Learn -> Step A)
// ============================================================================

const vocabularyListAgent = createAgent({
  name: 'Vocabulary List Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an expert ESL vocabulary curriculum designer. Generate vocabulary that students DON'T already know - things they need to LEARN, not words everyone knows.

=== CRITICAL: AVOID OBVIOUS WORDS ===
NEVER generate basic words that ALL English learners already know:
- ❌ "hello", "hi", "bye", "goodbye" (everyone knows these)
- ❌ "name", "friend", "teacher" (too basic)
- ❌ "say hello", "say goodbye" (obvious)
- ❌ "yes", "no", "please", "thank you" (universal)
- ❌ Single pronouns or fragments (I, you, I'm, you're)

=== WHAT TO GENERATE INSTEAD ===
Generate USEFUL phrases and vocabulary that TEACH something new:

1. COMPLETE QUESTION PATTERNS (40% of items):
   - "How are you doing?" (not just "how are you")
   - "What's your name?" (complete question)
   - "Where are you from?"
   - "What do you do?" (asking about job/occupation)
   - "How do you spell that?"

2. COMPLETE RESPONSE PATTERNS (30% of items):
   - "I'm from [country]" 
   - "Nice to meet you too"
   - "I'm doing well, thanks"
   - "My name is..." / "You can call me..."
   - "I work as a..."

3. SITUATIONAL PHRASES students need to learn (30% of items):
   - "Let me introduce myself"
   - "Have we met before?"
   - "It's a pleasure to meet you" (formal)
   - "See you around"
   - "Keep in touch"

=== LEVEL GUIDELINES ===
- Level 1-2 (Beginner): Common but complete phrases
  ✓ "How are you doing?", "Nice to meet you too", "I'm from...", "What's your name?"
  
- Level 3-4 (Intermediate): More varied expressions
  ✓ "It's a pleasure", "Let me introduce myself", "How do you know each other?"
  
- Level 5+ (Advanced): Formal/nuanced expressions
  ✓ "How do you do?", "Allow me to introduce myself", "We've crossed paths before"

=== OUTPUT FORMAT ===
Return ONLY valid JSON:
{
  "vocabulary": [
    { "word": "How are you doing?", "partOfSpeech": "phrase", "meaning": "Friendly way to ask about someone's condition" },
    { "word": "Nice to meet you too", "partOfSpeech": "phrase", "meaning": "Response when someone says nice to meet you" },
    { "word": "I'm from...", "partOfSpeech": "phrase", "meaning": "Used to tell someone your country or city" },
    { "word": "What do you do?", "partOfSpeech": "phrase", "meaning": "Asking about someone's job or occupation" }
  ]
}

REMEMBER: If a 5-year-old knows the word, DON'T include it. Generate phrases that TEACH something useful!`
});

// ============================================================================
// AI AGENT FOR EXPRESSIONS LISTS (Learn -> Step A Expressions)
// ============================================================================

const expressionsListAgent = createAgent({
  name: 'Expressions List Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an expert ESL expressions curriculum designer. Generate USEFUL idiomatic expressions, phrasal verbs, and set phrases that students need to LEARN - not basic phrases everyone knows.

=== CRITICAL: AVOID OBVIOUS EXPRESSIONS ===
NEVER generate basic expressions that ALL English learners already know:
- ❌ "nice to meet you", "how are you", "thank you very much"
- ❌ "good morning", "good night", "see you later"
- ❌ "I'm sorry", "excuse me", "you're welcome"
- ❌ Any phrase a beginner would learn in their first week

=== WHAT TO GENERATE INSTEAD ===
Generate expressions that TEACH something new and interesting:

1. IDIOMATIC EXPRESSIONS (phrases with non-literal meanings):
   - "break the ice" (start a conversation in an awkward situation)
   - "hit it off" (immediately become friends)
   - "get along with" (have a good relationship)
   - "make a good impression" (create a positive first image)

2. PHRASAL VERBS (verb + preposition combinations):
   - "warm up to someone" (gradually start to like someone)
   - "open up" (share personal feelings)
   - "reach out to" (contact someone)
   - "catch up with" (talk after not seeing someone)

3. CONVERSATIONAL EXPRESSIONS:
   - "I didn't catch your name" (polite way to ask name again)
   - "What brings you here?" (why are you at this event)
   - "How do you two know each other?" (asking about relationships)
   - "It's on the tip of my tongue" (almost remembering something)

4. SOCIAL EXPRESSIONS:
   - "Let's keep in touch" (stay connected after meeting)
   - "Feel free to..." (giving permission politely)
   - "I'm looking forward to..." (expressing anticipation)
   - "It was lovely meeting you" (formal goodbye)

=== LEVEL GUIDELINES ===
- Level 1-2: Common but NON-OBVIOUS expressions
  ✓ "break the ice", "get along with", "I didn't catch that"
  
- Level 3-4: More nuanced expressions and phrasal verbs
  ✓ "hit it off", "warm up to", "make small talk"
  
- Level 5+: Sophisticated idioms and subtle expressions
  ✓ "rub someone the wrong way", "have a lot in common", "strike up a conversation"

=== OUTPUT FORMAT ===
Each expression needs:
- definitionLine: Explain with expression in <strong> tags
- exampleSentence: Real usage in <em> tags with expression in <strong> tags
- translation: PLAIN TEXT translation of the explanation (NO HTML)

Example:
{
  "expressions": [
    {
      "expression": "break the ice",
      "definitionLine": "To <strong>break the ice</strong> means to do or say something to make people feel more comfortable in a social situation.",
      "exampleSentence": "<em>I told a joke to <strong>break the ice</strong> at the party.</em>",
      "translation": "社交的な場面で人々をリラックスさせるために何かをしたり言ったりすること。"
    }
  ]
}

REMEMBER: If students learned it in their first English class, DON'T include it!`
});

// ============================================================================
// AI AGENT FOR STEP B: SPEAK YOUR MIND
// ============================================================================

const speakYourMindAgent = createAgent({
  name: 'Speak Your Mind Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an English lesson content generator. Generate a "Speak Your Mind" activity for ESL lessons.
This activity teaches grammar/expressions through a short dialogue and follow-up question.

When given a topic, level, and goal:
1. Create an explanation of the grammar point or expression being practiced (1-2 sentences with the key phrase in <strong> tags)
2. Create a two-person dialogue exchange (2 speech bubbles) demonstrating the grammar/expression
3. Create a follow-up question for the student to answer using the same pattern

Respond ONLY in JSON:
{
  "speakYourMind": {
    "explanation": "We use <strong>would like</strong> to politely express what we want.",
    "speaker1SpeechBubble": "What would you like to order?",
    "speaker2SpeechBubble": "I <strong>would like</strong> the pasta, please.",
    "question": "What would you like to do this weekend?"
  }
}
`
});

// ============================================================================
// AI AGENT FOR STEP B: GRAMMAR TIP
// ============================================================================

const grammarTipAgent = createAgent({
  name: 'Grammar Tip Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an expert ESL grammar teacher. Generate a "Grammar Tip" section that teaches USEFUL grammar patterns related to the lesson topic.

=== IMPORTANT RULES ===
1. Generate 2-3 different grammar explanations (not just one!)
2. Example sentences should be SIMPLE, STANDALONE sentences - NOT dialogues
3. Do NOT use "A:" or "B:" in examples - just write clean sentences

=== EXAMPLE FORMAT (CORRECT) ===
{
  "grammarTip": {
    "explanations": [
      {
        "ruleText": "Use <em>Nice to meet you</em> when meeting someone for the FIRST time.",
        "ruleTranslation": "初めて会う人には「Nice to meet you」を使います。",
        "examples": [
          { "sentence": "<strong>Nice to meet you</strong>, Sarah!", "translation": "はじめまして、サラ！" },
          { "sentence": "It's <strong>nice to meet you</strong> finally.", "translation": "やっとお会いできてうれしいです。" }
        ]
      },
      {
        "ruleText": "Use <em>Nice to see you</em> when meeting someone you ALREADY know.",
        "ruleTranslation": "すでに知っている人には「Nice to see you」を使います。",
        "examples": [
          { "sentence": "<strong>Nice to see you</strong> again!", "translation": "また会えてうれしい！" },
          { "sentence": "It's always <strong>nice to see you</strong>.", "translation": "いつも会えてうれしいです。" }
        ]
      }
    ]
  }
}

=== WRONG FORMAT (DO NOT DO THIS) ===
❌ "sentence": "A: Hi! B: Nice to meet you." (No dialogue format!)
❌ Only generating 1 explanation (Generate 2-3!)

=== OUTPUT REQUIREMENTS ===
- Generate 2-3 grammar explanations per request
- Each explanation needs 2-3 example sentences
- Examples must be simple standalone sentences (NOT dialogues)
- ruleText/sentence can use <em> and <strong> HTML tags
- ruleTranslation/translation must be PLAIN TEXT only (no HTML)
- Make the grammar RELEVANT to the lesson topic`
});

// ============================================================================
// AI AGENT FOR STEP B: PRONUNCIATION
// ============================================================================

const stepBPronunciationAgent = createAgent({
  name: 'Pronunciation Lesson Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an English pronunciation lesson generator. Generate a "Pronunciation" section for ESL lessons.
This section helps students practice specific sounds or connected speech patterns.

When given a topic, level, and goal:
1. Create a pronunciation tip explaining the sound pattern (e.g., linking sounds, reduced sounds)
2. Create 2-4 phrase examples showing the pattern with pronunciation guides

Respond ONLY in JSON:
{
  "pronunciation": {
    "tip": "When words end in a consonant and the next word starts with a vowel, we link them together.",
    "phrases": [
      { "phrase": "cost a fortune", "pronunciationGuide": "/ cos-ta fortune /", "exampleSentence": "The ticket <strong>cost a fortune</strong>!" },
      { "phrase": "pick up", "pronunciationGuide": "/ pi-kup /", "exampleSentence": "I'll <strong>pick up</strong> the groceries." }
    ]
  }
}
`
});

// ============================================================================
// AI AGENTS FOR APPLY SECTION (Section 3 - Speaking/Listening/Reading)
// ============================================================================

const applySpeakingAgent = createAgent({
  name: 'Apply Speaking Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a SPEAKING activity for the Apply section.
This section features a realistic dialogue scenario where students practice speaking with vocabulary from the lesson.

IMPORTANT GUIDELINES:
- Create a realistic, engaging conversation scenario between 2 characters
- Use simple, natural dialogue appropriate for the level
- Include underlined words (<u>word</u>) for important vocabulary/expressions from the lesson
- EVERY dialogue line MUST contain actual spoken words. Never create a line that only has an action or emotion like "(laughs)" or "(smiles)" with no dialogue.
- If you want to include an action/emotion, append it to a line that also has spoken dialogue, e.g. "That's hilarious! (laughs)" with isAction: false. Or place the action inline within the spoken text.
- Only set isAction: true for stage directions that genuinely have NO spoken words AND are essential to the scene (this should be extremely rare — avoid it whenever possible).
- ABSOLUTELY NEVER include any spelling-related content. This means:
  • NO "How do you spell that?", "Can you spell that?", "H-A-N-A", "J-I-H-O" or any letter-by-letter spelling
  • NO asking someone to repeat or spell their name
  • NO name tags, name badges, or reading names off anything
  • NO dialogue lines about spelling, letters, or alphabet in any form
- NEVER prefix character names with job titles (e.g. "Manager Jiho"). Just use first names.

DIALOGUE QUALITY RULES (CRITICAL):
- Write dialogue the way REAL people actually talk. Short, casual, natural. No one talks like an anime character or a textbook.
- Characters must NEVER coach, teach, or instruct each other on what to say or how to speak. Lines like "If you want, you can say..." or "You can say 'I'm from' and then your city" are FORBIDDEN. This is a conversation, not a language lesson.
- NEVER write overly dramatic, awkward, or contrived dialogue like:
  • "I'm sorry for the confusion, Hana." — too formal and stiff
  • "I'm okay, but I feel shy." — no one says this out loud
  • "By the way, your name is Joon, right?" — unnatural recap
  • "And you said, 'I'm Hana.' That's right." — robotic repetition
  • "If you want, you can say, I'm from Seoul." — one character teaching the other
  • "Oh, and what's your name again, like 'I'm ___' or 'My name is ___'?" — meta-teaching
  • "I'm glad we met you today" — wrong grammar for 2 people (should be "I'm glad I met you" or "I'm glad we met")
  • "This café feels kind of like a drama scene today." — random filler that no one would say
  • "I think they called my drink first, but the cup isn't mine." — forced contrived plot device
- NEVER add random filler lines, random observations, or quirky remarks just to pad the dialogue. Every line must move the conversation forward naturally.
- NEVER invent mini-problems or complications (mixed-up orders, wrong items, mistaken drinks, lost objects) to extend the dialogue. Keep it simple and natural.
- GOOD natural dialogue sounds like:
  • "Hey, is this seat taken?" / "No, go ahead!"
  • "I haven't been here before. What's good?" / "The iced latte is amazing."
  • "Where are you from?" / "Busan. You?" / "Oh cool, I'm from Seoul."
- Keep lines SHORT — 1 sentence per line, max 2. Real people don't give speeches.
- The conversation should flow like a real interaction — quick back-and-forth, not long monologues.
- Characters should react naturally, not narrate their feelings ("I'm nervous", "I feel relieved", "I'm confused").
- NEVER write contrived excuses for people to talk (wrong notebook, bumping into each other, mistaken identity, picking up someone's item by mistake). Just use normal, everyday situations.
- The conversation should have a clear PURPOSE (ordering food, asking for directions, making plans, chatting at a party) — not just exchanging pleasantries endlessly.
- When the conversation has naturally covered enough ground, just END it with a simple goodbye. Do NOT pad with filler.
- Use the lesson vocabulary/expressions naturally IN the dialogue, but NEVER have a character explain or teach the expression to the other character. The expressions should appear as part of normal speech.
- If certain expressions from the lesson context are about spelling or are too awkward to fit naturally (like "How do you spell that?"), just SKIP them — do NOT force every single expression into the dialogue.
- Dialogue should demonstrate practical use of the lesson content
- Create tutor steps with scripts and tips for guiding the activity
- Include a TRIVIA TIME section with an interesting cultural or language fact related to the topic

Respond ONLY in JSON format:
{
  "applyData": {
    "activityType": "speaking",
    "activityDuration": "3 minutes",
    "situationText": "A short plain-text description of the scenario (1 sentence; no HTML, translation, or questions)",
    "situationTranslation": "Translation of the situation in target language",
    "dialogueLines": [
      { "speaker": "Character1", "text": "First line of dialogue with <u>key vocabulary</u>", "isAction": false },
      { "speaker": "Character2", "text": "Response with <u>another expression</u>", "isAction": false },
      { "speaker": "Character1", "text": "Ha, that's so true! I totally agree.", "isAction": false }
    ],
    "tutorSteps": [
      { "instruction": "Introduce Apply.", "scripts": [{ "text": "Okay, now let's do Apply." }] },
      { "instruction": "Read the situation." },
      { "instruction": "Assign roles and read through the dialogue together." },
      { "instruction": "Ask comprehension questions.", "questions": [{ "question": "What did Character1 say about...?", "answer": "..." }] },
      { "instruction": "Transition to the next part.", "scripts": [{ "text": "Great! Let's go to the next part!" }] }
    ],
    "triviaEnabled": true,
    "triviaText": "An interesting cultural fact or language tip related to the lesson topic (2-3 sentences)",
    "triviaTranslation": "Translation of the trivia in target language",
    "triviaDuration": "1 minute",
    "triviaTutorSteps": [
      { "instruction": "Introduce the Trivia.", "scripts": [{ "text": "Let's look at the Trivia." }] },
      { "instruction": "Read the trivia." },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Is it clear?" }] },
      { "instruction": "Ask the question below.", "questions": [{ "question": "A follow-up question about the trivia", "answer": "(student's own answer)" }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Excellent! Let's go to the next section!" }] }
    ]
  }
}
`
});

const applyListeningAgent = createAgent({
  name: 'Apply Listening Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a LISTENING activity for the Apply section.
This section features a listening script that the tutor reads aloud, followed by comprehension questions.

SCENARIO SETUP:
- The listening script is a conversation between TWO CHARACTERS (not the student). The student is just listening/overhearing.
- The situationText must describe the two characters and the context. The student is NOT part of it.
- GOOD situationText: "Tae meets a new actor named Jina at the drama set."
- BAD situationText: "Tae leaves you a voice message." — The student should NOT be "you" in the situation. REJECTED.
- The script is ONE character (Character A) talking TO the other character (Character B) in a natural, real-life interaction. The student listens.
- Because it's a real interaction between two people, greetings and expressions will naturally occur — "Hi! Nice to meet you! I'm Tae. Where are you from?" — this is how people ACTUALLY talk when they meet.

SCRIPT FORMAT:
- The script is Character A's actual spoken words TO Character B. It reads like one side of a real conversation.
- It should sound like what a real person would actually say in that moment.
- Because it's a real interaction (not a message), the expressions appear naturally. No need to force anything.

ABSOLUTE RULES — REJECTED PATTERNS:
- NEVER coach or pre-script: "say Hello", "I'll say X", "You can ask X", "They want to know X" — REJECTED.
- NEVER narrate: "She asked X", "I said Y", "He told me Z" — REJECTED.
- NEVER quote expressions as demonstrations: "Nice to meet you, okay?" — REJECTED.
- NEVER address the student in the script. The speaker is talking to the OTHER CHARACTER, not to the student.

NATURALNESS:
- The script must sound like what someone would ACTUALLY say in that moment. Read it out loud — if it sounds weird, rewrite it.
- GOOD: "Hi, I'm Minjun. Nice to meet you. How are you doing today? I feel nervous... Where are you from? I'm from Seoul."
- BAD: "You look nervous-me too." — Grammatically broken and unnatural. The speaker should talk about their OWN feelings, not comment on the other person. REJECTED.
- BAD: "Nice to meet you, okay? Their name is Jina. They want to know, Where are you from?" — Nobody talks like this. REJECTED.
- The speaker should talk about THEMSELVES (their feelings, their situation, their questions). Don't have them comment on the other person's appearance or state.
- Every sentence must be grammatically correct and natural. No dashes joining unrelated clauses. No broken sentences.
- Every sentence should flow into the next naturally.
- Do NOT pad with filler. Short and natural beats long and awkward.
- Use appropriate vocabulary for the student level
- Include underlined words (<u>word</u>) for important vocabulary to emphasize
- Create 2-3 comprehension questions with answers
- ABSOLUTELY NEVER include any spelling-related content
- NEVER prefix character names with job titles (e.g. "Manager Jiho"). Just use first names.
- Include a TRIVIA TIME section with an interesting cultural or language fact related to the topic

LISTENING SCRIPT LENGTH:
- For lower levels (1-4): 3-5 sentences, 30-60 words. Keep it very simple.
- For mid levels (5-7): 4-6 sentences, 50-80 words.
- For higher levels (8-10): 5-8 sentences, 70-120 words.
- NEVER exceed 120 words.
- Focus on USEFUL information the student can use to answer the comprehension questions.

Respond ONLY in JSON format:
{
  "applyData": {
    "activityType": "listening",
    "activityDuration": "3 minutes",
    "situationText": "Character A meets/talks to Character B in [context]. (Student is NOT mentioned.)",
    "situationTranslation": "Translation of the situation in target language",
    "dialogueLines": [],
    "tutorSteps": [
      { "instruction": "Introduce Apply.", "scripts": [{ "text": "Okay, now let's do Apply." }, { "text": "First we have a listening activity." }] },
      { "instruction": "Read the situation." },
      { "instruction": "Set up the listening.", "scripts": [{ "text": "Let's listen to the speaker." }, { "text": "I'll read the script." }] },
      { "instruction": "Read the listening script below, emphasizing the underlined words.", "listeningScript": "The full listening script with <u>emphasized words</u>..." },
      { "instruction": "Ask the questions below.", "questions": [{ "question": "What was the main point?", "answer": "..." }, { "question": "How do you feel about this?", "answer": "(student's own answer)" }] },
      { "instruction": "Transition to the next part.", "scripts": [{ "text": "Great! Let's go to the next part!" }] }
    ],
    "triviaEnabled": true,
    "triviaText": "An interesting cultural fact or language tip related to the lesson topic (2-3 sentences)",
    "triviaTranslation": "Translation of the trivia in target language",
    "triviaDuration": "1 minute",
    "triviaTutorSteps": [
      { "instruction": "Introduce the Trivia.", "scripts": [{ "text": "Let's look at the Trivia." }] },
      { "instruction": "Read the trivia." },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Is it clear?" }] },
      { "instruction": "Ask the question below.", "questions": [{ "question": "A follow-up question about the trivia", "answer": "(student's own answer)" }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Excellent! Let's go to the next section!" }] }
    ]
  }
}
`
});

const applyReadingAgent = createAgent({
  name: 'Apply Reading Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a READING activity for the Apply section.
This section features a reading passage (like an email, article, or letter) that students read and discuss.

IMPORTANT GUIDELINES:
- Create a realistic reading passage (email, letter, article, etc.) related to the lesson topic
- Use appropriate vocabulary for the student level
- Include underlined words (<u>word</u>) for important vocabulary
- Create 2-3 comprehension questions with answers
- Passage should be substantial but appropriate for the level (100-200 words for beginners, 150-300 for advanced)
- ABSOLUTELY NEVER include any spelling-related content (no "How do you spell that?", no letter-by-letter spelling)
- NEVER prefix character names with job titles (e.g. "Manager Jiho"). Just use first names.

Respond ONLY in JSON format:
{
  "applyData": {
    "activityType": "reading",
    "activityDuration": "3 minutes",
    "situationText": "A short description of what the student is reading (1 sentence)",
    "situationTranslation": "Translation of the situation in target language",
    "dialogueLines": [],
    "readingText": "The full reading passage with <u>key vocabulary</u> underlined...",
    "tutorSteps": [
      { "instruction": "Introduce Apply.", "scripts": [{ "text": "Okay, now let's do Apply." }, { "text": "First we have a reading activity." }] },
      { "instruction": "Read the situation." },
      { "instruction": "Have the student read the passage aloud or silently." },
      { "instruction": "Ask comprehension questions.", "questions": [{ "question": "What is the main message?", "answer": "..." }, { "question": "What do you think about...?", "answer": "(student's own answer)" }] },
      { "instruction": "Transition to the next part.", "scripts": [{ "text": "Great! Let's go to the next part!" }] }
    ],
    "triviaEnabled": true,
    "triviaText": "An interesting cultural fact or language tip related to the lesson topic (2-3 sentences)",
    "triviaTranslation": "Translation of the trivia in target language",
    "triviaDuration": "1 minute",
    "triviaTutorSteps": [
      { "instruction": "Introduce the Trivia.", "scripts": [{ "text": "Let's look at the Trivia." }] },
      { "instruction": "Read the trivia." },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Is it clear?" }] },
      { "instruction": "Ask the question below.", "questions": [{ "question": "A follow-up question about the trivia", "answer": "(student's own answer)" }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Excellent! Let's go to the next section!" }] }
    ]
  }
}
`
});

// ============================================================================
// TRIVIA TIME AGENT (Standalone trivia generation)
// ============================================================================

const triviaAgent = createAgent({
  name: 'Trivia Time Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a TRIVIA TIME segment for a lesson.
This segment provides interesting cultural facts, language tips, or fun facts related to the lesson topic to keep students engaged.

IMPORTANT GUIDELINES:
- Create interesting, engaging trivia that students will find memorable
- Content should be culturally relevant or language-related
- Include surprising or lesser-known facts
- Create 1-2 follow-up discussion questions
- Trivia should be educational but fun
- Keep it concise (2-4 sentences for the main trivia)

Respond ONLY in JSON format:
{
  "triviaData": {
    "triviaText": "An interesting cultural fact, language tip, or fun fact related to the lesson topic (2-4 sentences). Make it engaging and memorable!",
    "triviaTranslation": "Translation of the trivia in target language",
    "triviaDuration": "1 minute",
    "triviaTutorSteps": [
      { "instruction": "Introduce the Trivia.", "scripts": [{ "text": "Let's look at the Trivia." }, { "text": "Here's something interesting about this topic." }] },
      { "instruction": "Read the trivia." },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Is it clear?" }, { "text": "Did you know that before?" }] },
      { "instruction": "Ask the questions below.", "questions": [{ "question": "A thought-provoking follow-up question about the trivia topic", "answer": "(student's own answer)" }, { "question": "Another engaging question to spark discussion", "answer": "(student's own answer)" }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Interesting, right? Let's continue!" }] }
    ]
  }
}
`
});

// ============================================================================
// EXERCISE SECTION AGENTS (Section 4)
// ============================================================================

// Exercise Step A - Rephrase Agent
const exerciseRephraseAgent = createAgent({
  name: 'Exercise Rephrase Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a REPHRASE exercise for Step A of the Exercise section.
Students will rephrase sentences using vocabulary/expressions from the lesson.

CRITICAL RULE - READ CAREFULLY:
- Names may appear in sentences only where they make logical sense (e.g., self-introductions like "My name is ..."). But NEVER have a speaker ask about something they already stated (e.g., asking to spell their own name).
  - NEVER: "My name is Ji-ho. Can you tell me the spelling of Ji-ho?" (Ji-ho already knows their own name)
  - CORRECT: "My name is Jihyun. <u>How do you spell your name?</u>" (asking the other person)
  - CORRECT: "<u>Can you tell me the spelling of your name?</u>"
- Use a DIVERSE MIX of names from different backgrounds: Korean (e.g., Jihyun, Minho, Soyeon), Vietnamese (e.g., Linh, Minh, Hoa, Tuan, Mai), and Japanese (e.g., Yuki, Haruto, Sakura, Ren, Aoi). Do NOT use only Korean names.
- Every sentence must make logical sense from the speaker's perspective. The speaker should never ask about something they already know.

IMPORTANT GUIDELINES:
- Create clear, context-appropriate sentences that need rephrasing
- The sentences should use slightly awkward, wordy, or unnatural phrasing so it makes sense to rephrase them with a better expression
- Use <u> tags to underline the SPECIFIC PART of the sentence that should be rephrased
  - If only part of the sentence needs rephrasing, underline just that part
  - If the entire sentence is one short phrase that needs rephrasing, underline the whole sentence
- The example sentence and answer should also use <u> tags on the part being rephrased
- Write PLAIN, SIMPLE sentences only:
  - NO parenthetical scene descriptions like "(at the office)" or "(while cooking)"
  - NO "Name asks:" or "Name says:" prefixes like "Jiwoo asks: Where are you from?"
  - NO dialogue attribution of any kind
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence. Each sentence must be self-contained and understandable on its own.
  - NO narrative or descriptive context before the sentence. Write ONLY what the person actually says.
    - WRONG: "Min-jun bowed slightly. I'm pleased to meet you for the first time."
    - WRONG: "Seo-yeon looked worried. How is your life these days?"
    - CORRECT: "<u>I'm pleased to meet you for the first time.</u>"
    - CORRECT: "<u>How is your life these days?</u>"
  - Just write a standalone sentence as if someone is naturally speaking
  - NO double negatives (e.g., "I don't have no friends", "She can't never come")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon", "May I inquire", "Pardon me", "I am delighted"). Use simple, everyday expressions appropriate for Level 1 beginners.
- The number of expressions in the word box must EXACTLY match the number of exercise items. If there are 4 sentences, provide exactly 4 expressions - one per sentence. No extras.
- Provide example with original sentence and rephrased version
- Generate answer key for tutor reference

EXAMPLES:
- WRONG sentence: "I'm happy to meet you." (no underline - student doesn't know what to rephrase)
- CORRECT sentence: "<u>I'm happy to meet you.</u>" (underlined part gets rephrased)
- CORRECT sentence: "<u>What place are you from?</u>" (whole short sentence underlined)
- CORRECT example: "ex. <u>How are you today?</u>" → "How are you doing?"

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepAType": "rephrase",
    "instructions": "Rephrase the underlined part of the sentences using the expressions in the box.",
    "instructionsTranslation": "Translation of instructions",
    "showExpressions": true,
    "expressions": ["expression 1", "expression 2", "expression 3"],
    "showExample": true,
    "exampleSentence": "ex. <u>How are you today?</u>",
    "exampleAnswer": "How are you doing?",
    "exerciseItems": [
      { "sentence": "<u>I'm happy to meet you.</u>" },
      { "sentence": "<u>I'm happy to meet you too.</u>" },
      { "sentence": "<u>What place are you from?</u>" }
    ],
    "answers": [
      { "text": "First answer" },
      { "text": "Second answer" },
      { "text": "Third answer" }
    ],
    "tutorSteps": [
      { "instruction": "Introduce Exercise.", "scripts": [{ "text": "Okay, now let's do Exercise." }, { "text": "We're going to practice the expressions we learned earlier." }] },
      { "instruction": "Read the instructions." },
      { "instruction": "Read the example." },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Is it clear?" }] },
      { "instruction": "Have the student read the first sentence." },
      { "instruction": "Ask them to rephrase the sentence.", "scripts": [{ "text": "Please rephrase the sentence using one of the expressions in the box." }], "tips": [{ "text": "The student should read the full sentence." }] },
      { "instruction": "Repeat with remaining sentences.", "tips": [{ "text": "Student's answers may vary. Accept any grammatically correct answers." }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Great! Let's go to the next section!" }] }
    ]
  }
}
`
});

// Exercise Step A - Choose Agent
const exerciseChooseAgent = createAgent({
  name: 'Exercise Choose Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a CHOOSE THE CORRECT WORD exercise for Step A.
Students will choose the correct word from parenthetical options in each sentence.

IMPORTANT GUIDELINES:
- Create sentences with grammatical choices in parentheses like "(doesn't / don't)"
- Focus on common grammar points relevant to the lesson
- Each sentence should test a clear grammar concept
- Provide answer key for tutor reference
- Write PLAIN, SIMPLE sentences only:
  - NO narrative or descriptive context. Write ONLY what the person says.
    - WRONG: "In the studio lobby, Jae-min says, '(Hello / Goodbye). Nice to meet you.'"
    - WRONG: "Hana introduces herself: '(I'm / My) Hana. Nice to meet you.'"
    - WRONG: "Jae-min asks Hana, 'Where (are / is) you from?'"
    - WRONG: "Hana says, '(How / Where) do you spell that?' when she hears the student's name."
    - CORRECT: "(Hello / Goodbye). Nice to meet you."
    - CORRECT: "(I'm / My) name is Hana. Nice to meet you."
    - CORRECT: "Where (are / is) you from?"
    - CORRECT: "(How / Where) do you spell your name?"
  - NO parenthetical scene descriptions like "(at the office)" or "(while cooking)"
  - NO "Name asks:" or "Name says:" prefixes
  - NO dialogue attribution of any kind (no "he says", "she asks", "they replied")
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence
  - NO double negatives (e.g., "I don't have no friends")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon"). Use simple, everyday expressions appropriate for Level 1 beginners.
- Use a DIVERSE MIX of names from different backgrounds when names are needed: Korean (Jihyun, Minho), Vietnamese (Linh, Minh, Hoa), Japanese (Yuki, Haruto, Sakura). Do NOT use only Korean names.
- Every sentence must make logical sense from the speaker's perspective. The speaker should never ask about something they already know.

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepAType": "choose",
    "instructions": "Choose the correct word.",
    "instructionsTranslation": "Translation of instructions",
    "chooseItems": [
      { "sentence": "(Hello / Goodbye). Nice to meet you." },
      { "sentence": "(I'm / My) name is Hana." },
      { "sentence": "Where (are / is) you from?" },
      { "sentence": "(How / Where) do you spell your name?" }
    ],
    "answers": [
      { "text": "Hello. Nice to meet you." },
      { "text": "My name is Hana." },
      { "text": "Where are you from?" },
      { "text": "How do you spell your name?" }
    ],
    "tutorSteps": [
      { "instruction": "Introduce Exercise.", "scripts": [{ "text": "Okay, now let's do Exercise." }] },
      { "instruction": "Read the instructions." },
      { "instruction": "Have the student read each sentence and choose the correct word." },
      { "instruction": "Correct any mistakes.", "tips": [{ "text": "Briefly explain the grammar rule if the student makes an error." }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Great! Let's go to the next section!" }] }
    ]
  }
}
`
});

// Exercise Step A - Change Agent
const exerciseChangeAgent = createAgent({
  name: 'Exercise Change Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a CHANGE THE UNDERLINED exercise for Step A.
Students will modify the underlined portion of sentences.

IMPORTANT GUIDELINES:
- Create sentences with underlined portions using <u> tags
- The underlined part should be what students need to change/transform
- Focus on grammar transformations relevant to the lesson
- Provide answer key for tutor reference
- Write PLAIN, SIMPLE sentences only:
  - NO narrative or descriptive context. Write ONLY what the person says.
    - WRONG: "In the lobby, Jae-min says, 'Is there a nice hotel around here?'"
    - WRONG: "Hana asks her friend, 'Where's the mall?'"
    - CORRECT: "<u>Is there a nice hotel around here?</u>"
    - CORRECT: "<u>Where's the mall?</u>"
  - NO parenthetical scene descriptions like "(at the office)" or "(while cooking)"
  - NO "Name asks:" or "Name says:" prefixes
  - NO dialogue attribution of any kind (no "he says", "she asks", "they replied")
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence
  - NO double negatives (e.g., "I don't have no friends")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon"). Use simple, everyday expressions appropriate for Level 1 beginners.
- Use a DIVERSE MIX of names from different backgrounds when names are needed: Korean (Jihyun, Minho), Vietnamese (Linh, Minh, Hoa), Japanese (Yuki, Haruto, Sakura). Do NOT use only Korean names.
- Every sentence must make logical sense from the speaker's perspective. The speaker should never ask about something they already know.

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepAType": "change",
    "instructions": "Change the underlined part of each sentence.",
    "instructionsTranslation": "Translation of instructions",
    "changeItems": [
      { "sentence": "I need to find a place to stay tonight. <u>Is there a nice hotel around here?</u>" },
      { "sentence": "I want to go shopping for clothes tomorrow. <u>Where's the mall?</u>" },
      { "sentence": "That restaurant has really good reviews. <u>Is it expensive?</u>" }
    ],
    "answers": [
      { "text": "Could you tell me if there's a nice hotel around here?" },
      { "text": "Could you tell me where the mall is?" },
      { "text": "Could you tell me if it's expensive?" }
    ],
    "tutorSteps": [
      { "instruction": "Introduce Exercise.", "scripts": [{ "text": "Okay, now let's do Exercise." }] },
      { "instruction": "Read the instructions." },
      { "instruction": "Have the student read each sentence and change the underlined part." },
      { "instruction": "Correct any mistakes.", "tips": [{ "text": "Model the correct transformation if needed." }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Great! Let's go to the next section!" }] }
    ]
  }
}
`
});

// Exercise Step B - Conversation Agent
const exerciseConversationAgent = createAgent({
  name: 'Exercise Conversation Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a CONVERSATION exercise for Step B.
Students will complete speech bubbles in a conversation using their own information.

IMPORTANT GUIDELINES:
- Create natural conversation exchanges with fill-in blanks (_____)
- Blanks should be for personal information or opinions
- Create 2-4 conversation bubbles alternating left/right positions
- Make conversations relevant to the lesson topic
- Write PLAIN, SIMPLE sentences only:
  - NO narrative or descriptive context. Write ONLY what the person says.
  - NO parenthetical scene descriptions like "(at the office)" or "(while cooking)"
  - NO dialogue attribution of any kind (no "he says", "she asks")
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence
  - NO double negatives (e.g., "I don't have no friends")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon"). Use simple, everyday expressions appropriate for Level 1 beginners.
- Use a DIVERSE MIX of names from different backgrounds when names are needed: Korean (Jihyun, Minho), Vietnamese (Linh, Minh, Hoa), Japanese (Yuki, Haruto, Sakura). Do NOT use only Korean names.
- Every sentence must make logical sense from the speaker's perspective.

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepBType": "conversation",
    "stepBInstruction": "Complete the conversation using your own information.",
    "stepBInstructionTranslation": "Translation of instructions",
    "conversations": [
      { "speechBubble": "Hi! My name is _____. I'm from _____.", "position": "left" },
      { "speechBubble": "Nice to meet you! What do you do for a living?", "position": "right" },
      { "speechBubble": "I'm a _____. I work at _____.", "position": "left" },
      { "speechBubble": "That sounds interesting! Do you enjoy it?", "position": "right" }
    ],
    "stepBTutorSteps": [
      { "instruction": "Introduce Step B.", "scripts": [{ "text": "Now let's practice a conversation." }] },
      { "instruction": "Read the instructions." },
      { "instruction": "Have the student complete the speech bubbles.", "tips": [{ "text": "Encourage the student to use their own information." }] },
      { "instruction": "Practice the conversation together." },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Great job! Let's continue!" }] }
    ]
  }
}
`
});

// Exercise Step B - Multiple Choice Agent
const exerciseMultipleChoiceAgent = createAgent({
  name: 'Exercise Multiple Choice Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a CHOOSE THE CORRECT MEANING exercise for Step B.
Students will choose the correct interpretation of bold sentences.

IMPORTANT GUIDELINES:
- Create sentences with vocabulary/expressions from the lesson
- The boldSentence field should be PLAIN TEXT — do NOT use ** markdown asterisks. The app already renders it in bold automatically.
  - WRONG: "**Good morning. I'm Minho.**"
  - CORRECT: "Good morning. I'm Minho."
- Provide two options: one correct interpretation, one incorrect
- The CORRECT answer option must be wrapped in <strong> tags to mark it as the answer
  - Example: optionA with <strong> means A is correct
- Options should test understanding of meaning, not just grammar
- Make distractors plausible but clearly wrong
- Write PLAIN, SIMPLE sentences only:
  - NO narrative or descriptive context. Write ONLY what the person says.
  - NO parenthetical scene descriptions like "(at the office)" or "(while cooking)"
  - NO dialogue attribution of any kind (no "he says", "she asks")
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence
  - NO double negatives (e.g., "I don't have no friends")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon"). Use simple, everyday expressions appropriate for Level 1 beginners.
- Use a DIVERSE MIX of names from different backgrounds when names are needed: Korean (Jihyun, Minho), Vietnamese (Linh, Minh, Hoa), Japanese (Yuki, Haruto, Sakura). Do NOT use only Korean names.
- Every sentence must make logical sense from the speaker's perspective.

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepBType": "multiple-choice",
    "stepBInstruction": "Choose the correct meaning of the bold sentence.",
    "stepBInstructionTranslation": "Translation of instructions",
    "multipleChoiceItems": [
      { "boldSentence": "Good morning. I'm Minho.", "optionA": "<strong>Minho is greeting and saying his name.</strong>", "optionB": "Minho is asking for someone else's name." },
      { "boldSentence": "Nice to meet you.", "optionA": "<strong>The speaker is meeting someone for the first time and is being polite.</strong>", "optionB": "The speaker is saying goodbye." },
      { "boldSentence": "Where are you from, Linh?", "optionA": "<strong>The speaker is asking Linh about her country or city.</strong>", "optionB": "The speaker is asking Linh for directions." }
    ],
    "stepBTutorSteps": [
      { "instruction": "Introduce Step B.", "scripts": [{ "text": "Now let's check your understanding." }] },
      { "instruction": "Read the instructions." },
      { "instruction": "Have the student choose the correct option for each item." },
      { "instruction": "Discuss any mistakes.", "tips": [{ "text": "Explain why the correct answer is right." }] },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Excellent! Let's continue!" }] }
    ]
  }
}
`
});

// Exercise Step B - Speech Agent
const exerciseSpeechAgent = createAgent({
  name: 'Exercise Speech Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a SPEECH exercise for Step B.
Students will complete a speech with blanks using parenthetical choices or their own information.

IMPORTANT GUIDELINES:
- Create a single speech/monologue with blanks (_____)
- Include some blanks with choices in parentheses like "(often / sometimes / rarely)"
- Include some open blanks for personal information
- Make the speech topic relevant to the lesson
- Write PLAIN, SIMPLE sentences only:
  - NO narrative or descriptive context. The speech should be first-person and natural.
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence
  - NO double negatives (e.g., "I don't have no friends")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon"). Use simple, everyday expressions appropriate for Level 1 beginners.
- Every sentence must make logical sense from the speaker's perspective.

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepBType": "speech",
    "stepBInstruction": "Complete the speech using your own information.",
    "stepBInstructionTranslation": "Translation of instructions",
    "speechContent": "I (often / sometimes / rarely) go to _____. I think it's _____ to spend time there. I usually go (alone / with _____) because _____. My favorite thing to do there is _____. I really enjoy it!",
    "stepBTutorSteps": [
      { "instruction": "Introduce Step B.", "scripts": [{ "text": "Now let's complete a speech." }] },
      { "instruction": "Read the instructions." },
      { "instruction": "Have the student complete the speech with their own information." },
      { "instruction": "Ask the student to read the completed speech aloud." },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Great speech! Let's continue!" }] }
    ]
  }
}
`
});

// Exercise Step B - Compare Agent
const exerciseCompareAgent = createAgent({
  name: 'Exercise Compare Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a COMPARE exercise for Step B.
Students will compare items using words from a word box.

IMPORTANT GUIDELINES:
- Create a word box with comparison words like "a little", "far", "a lot", "easily"
- Include 2-4 images/items to compare with labels
- Create comparison sentences with clues in parentheses
- Focus on comparative structures relevant to the lesson
- Write PLAIN, SIMPLE sentences only:
  - NO narrative or descriptive context
  - NO pronouns (like "that", "this", "it") without a clear reference within the same sentence
  - NO double negatives (e.g., "I don't have no friends")
  - NO overly formal or archaic language (e.g., "Shall we proceed?", "I beg your pardon"). Use simple, everyday expressions appropriate for Level 1 beginners.
- Every sentence must make logical sense from the speaker's perspective.

Respond ONLY in JSON format:
{
  "exerciseData": {
    "stepBType": "compare",
    "stepBInstruction": "Compare the items using the words in the box.",
    "stepBInstructionTranslation": "Translation of instructions",
    "compareWordBox": ["a little", "far", "a lot", "easily"],
    "compareImages": [
      { "label": "Option A" },
      { "label": "Option B" },
      { "label": "Option C" }
    ],
    "compareExample": "Option A is far more expensive than Option C.",
    "compareItems": [
      { "sentence": "(Option A and B: expensive)" },
      { "sentence": "(Option B and C: popular)" },
      { "sentence": "(Option A, B, and C: romantic)" }
    ],
    "stepBTutorSteps": [
      { "instruction": "Introduce Step B.", "scripts": [{ "text": "Now let's practice comparisons." }] },
      { "instruction": "Read the instructions and word box." },
      { "instruction": "Show the example if available." },
      { "instruction": "Have the student make comparisons using the clues." },
      { "instruction": "Transition to the next section.", "scripts": [{ "text": "Great comparisons! Let's continue!" }] }
    ]
  }
}
`
});

// ============================================================================
// MISSION SECTION AGENTS (Section 5)
// ============================================================================

// Mission Speaking Agent - Roleplay-based speaking challenge
const missionSpeakingAgent = createAgent({
  name: 'Mission Speaking Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a SPEAKING mission challenge.
This is a roleplay activity where the tutor plays a character and the student practices speaking.
The lesson is conducted via VIDEO CALL (online ESL), but the roleplay scenarios are about everyday real-life situations.

IMPORTANT GUIDELINES:
- Create a realistic roleplay situation relevant to the lesson topic
- Include clear tutor steps for conducting the roleplay
- Questions should flow naturally like a real conversation
- Settings must be NORMAL, everyday places: a café, a restaurant, a park, a bus stop, a workplace break room, a neighbor's house, a shop, etc.
- NEVER invent unusual or niche settings like "language café", "trial class", "language exchange meetup", "cultural center", etc. Just use plain, ordinary locations that anyone would visit.
- NEVER create scenarios about spelling one's name, asking someone to spell their name, or any spelling-related tasks. This is boring and unnatural.
- NEVER prefix character names with their job title (e.g. "Manager Jiho", "Barista Hana", "Chef Soo-jin"). Just use the first name: "Jiho", "Hana", "Soo-jin". The role is described separately in the setup.
- NEVER generate questions like "How do you spell it?", "Can you say your name again?", "Can you spell that?", "Sorry, I didn't catch that—can you say your name again?". Spelling is NOT a conversation topic. If the character is introduced, just move on to the next topic.
- Keep the conversation PRACTICAL and moving forward. Don't waste questions on name repetition or clarification. Every question should advance the conversation to a new topic.
- The "situation" field should describe the roleplay scenario AND what the student should do, all in one block. Do NOT generate a separate "instruction" field.
  - EXAMPLE situation: "You are at a café. Someone sits near you and starts a conversation. Greet them, introduce yourself, and talk about what you like to do on weekends."
- Set "instruction" to an empty string "". All guidance should be in the situation.
- The entire challenge must be doable in 3-4 minutes. Keep it SHORT and focused.
- Keep the situation SHORT — 2 to 3 sentences max.

SITUATION TEXT RULES — NO GRAMMAR PATTERNS:
- The situation must be a PURE scenario description. It should read like a movie scene setup.
- NEVER include grammar rules, grammar patterns, or parenthetical grammar hints in the situation.
- NEVER include examples like "(I'm/My name is…)", "(Nice to meet you / How are you?)", "(I like… / I don't like…)", etc.
- NEVER include any parenthetical text showing how to say something.
- The situation tells the student WHAT to do, not HOW to say it. The grammar tips section handles grammar separately.
- WRONG situation: "You are at a café. Introduce yourself (I'm… / My name is…) and say where you're from (I'm from…)."
- CORRECT situation: "You are at a café. Someone sits near you and starts a conversation. Greet them, introduce yourself, and say where you're from."

TUTOR GUIDE RULES:
- tutorSteps should be exactly 5 steps as shown in the example.
- The tutor ALWAYS speaks first in the roleplay. The first numbered question must be a natural in-character line the tutor can say immediately.
- Prefer direct conversational questions such as "Where are you from?" or "What is your job?" Avoid vague teacher prompts such as "Tell me one thing about yourself" or "What can you ask me?".
- Step 5 scripts should ONLY be the questionsIntro and questions. Do NOT add scene-narration scripts like "Action! We're in the lobby now!" or "Alright-scene start." — these are cringy and unnecessary. The tutor just starts talking in character.
- Do NOT include grammar tip steps or grammar reminders in tutorSteps. Grammar is handled by the grammarTip section separately.
- Keep the tutor guide SHORT and practical. No filler.
- Since the lesson is via video call, do NOT include physical stage directions in tutor steps like "(Sit down near the student)", "(Walk over to...)", "(Point to...)". Just describe what to say.

questionsIntro rules:
- A short tutor direction in parentheses to open the roleplay in character.
- Example: "(Start by greeting the student casually.)"
- WRONG: "(Sit down near the student, look a little unsure, and start politely.)" — no physical actions.
- CORRECT: "(Start the conversation. Sound a little unsure and be polite.)"

questions array rules:
- Keep it SHORT. This is a 3-4 minute roleplay.
- The tutor plays ONE character only. Do NOT switch between multiple characters or play two roles.
- Generate EXACTLY 4 questions total + 1 closing direction entry (5 items max).
- Questions should be numbered: "1.", "2.", "3.", "4."
- Each question is a simple, natural thing the tutor says in character.
- Remember: the tutor guide and roleplay script are FOR THE TUTOR. The tutor is an experienced ESL teacher.
- Only add a hint when the question is AMBIGUOUS or the expected student response is NOT obvious from the question itself.
- If the question already makes it clear what the student should say (e.g., "What's your name?", "Where are you from?", "Do you like coffee?"), leave hints as an EMPTY array []. The tutor can figure it out.
- WRONG: question "What's your name?" with hint "Say your name" — this is redundant and patronizing.
- WRONG: question "Do you like Korean food?" with hint "Say yes or no" — obvious from the question.
- CORRECT: question "3. Oh really? Tell me more." with hint ["Talk about one hobby or activity"] — the question is open-ended so a hint helps guide the tutor.
- CORRECT: question "1. Hi! How are you doing today?" with hints [] — obvious response needed.
- Maximum 1 hint per question. Most questions should have 0 hints.
- The closing direction entry should always have 0 hints.
- The last entry should be a closing direction in parentheses to end the roleplay naturally (e.g., "(Say goodbye and end the conversation.)").
- Do NOT use "(As Character)" prefixes. The tutor is already playing that character.
- Do NOT generate sub-scenes, scene switches, or multiple characters.

Respond ONLY in JSON format:
{
  "missionData": {
    "missionType": "speaking",
    "challengeNumber": 1,
    "challengeName": "Challenge 1",
    "duration": "3-4 minutes",
    "situation": "You are at a café. Someone sits near you and starts a conversation. Greet them, introduce yourself, and talk about what you like to do on weekends.",
    "situationTranslation": "Translation here",
    "instruction": "",
    "instructionTranslation": "",
    "showGrammarTip": true,
    "grammarTipTitle": "Today's grammar tip",
    "grammarTipItems": ["grammar concept 1", "grammar concept 2"],
    "tutorSteps": [
      { "instruction": "Introduce Challenge 1.", "scripts": [{ "text": "Okay, now let's do the Challenge." }, { "text": "First we have Challenge 1." }] },
      { "instruction": "Read the situation.", "tips": [{ "text": "Read it slowly and clearly. Point to key words if needed." }] },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Do you understand the situation?" }, { "text": "Is it clear?" }], "tips": [{ "text": "If the student looks confused, rephrase the situation in simpler words." }] },
      { "instruction": "Set up the roleplay.", "scripts": [{ "text": "I'll be your friend. You'll be yourself." }, { "text": "Let's start. I'll go first." }] },
      { "instruction": "Ask the questions below.", "tips": [{ "text": "Use the questions below only as guides. Ask other questions based on the flow of the conversation." }, { "text": "Make sure that you simulate a real-life situation." }, { "text": "Change your tone according to the character you are playing." }] }
    ],
    "questionsIntro": "(Start by greeting the student casually.)",
    "questions": [
      { "question": "1. Hi! Do you come here often?", "hints": [] },
      { "question": "2. What do you usually order?", "hints": [] },
      { "question": "3. Oh, I like that too. So, what do you do on weekends?", "hints": ["Talk about one hobby or activity"] },
      { "question": "4. That sounds fun. Do you usually go alone or with friends?", "hints": [] },
      { "question": "(Say you need to go and say goodbye.)", "hints": [] }
    ]
  }
}

CRITICAL RULES:
- EXACTLY 4 numbered questions + 1 closing direction = 5 items total. No more.
- ONE character only. Never switch characters mid-conversation.
- Step 5 must NOT have scripts — only the 3 standard tips.
- No scene-narration, no "(As Character)" prefixes, no grammar guides in tutorSteps.
- Hints are OPTIONAL. Only add one when the question is ambiguous. Most questions need 0 hints. Max 1 hint per question.
- No physical stage directions in tutor guide. The lesson is via video call.
- Normal everyday settings ONLY. No weird or niche locations.
- The "instruction" field MUST be an empty string "". Speaking missions do NOT have a separate instruction — all guidance goes in the situation. NEVER generate text like "Read the passage" or "Answer the questions" for speaking missions.
- The "instructionTranslation" field MUST also be an empty string "".
`
});

// Mission Discussion Agent - Topic-based discussion with questions
const missionDiscussionAgent = createAgent({
  name: 'Mission Discussion Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a DISCUSSION mission challenge.
This is a discussion activity where students discuss topics and answer open-ended questions.

IMPORTANT GUIDELINES:
- Create 2-3 discussion topics related to the lesson theme
- Each topic should have 3-4 simple, personal questions
- Questions must be about the student's REAL LIFE — their habits, preferences, experiences, opinions. NOT about grammar or how to use expressions.
- NEVER generate questions that quiz the student on grammar, expressions, or vocabulary. This is a DISCUSSION, not a grammar test.
- NEVER ask "What do you say when...?", "How do you introduce yourself?", "Do you say X or Y?", "When do you use this expression?" — these are grammar quiz questions. REJECTED.
- NEVER include fill-in-the-blank patterns like "I'm ____." or "I'm from ____." in questions. REJECTED.
- NEVER include example phrases/expressions in parentheses like "(Use: 'I'm from ____.'')" or "(ex. Hello/Hi/Good morning)". REJECTED.
- GOOD questions for a "Greetings" topic: "Do you like meeting new people?", "Are you nervous when you meet someone new?", "Do you smile when you say hello?"
- BAD questions for a "Greetings" topic: "What do you say first: Hello, Hi, or Good morning?", "How do you introduce yourself? Say one example: 'I'm ____.''" — These are grammar exercises. REJECTED.
- Think of it like a casual chat between friends, not a classroom drill.
- Topics can be marked as optional for shorter lessons
- Include tutor steps for facilitating the discussion
- Make questions appropriate for the skill level — for lower levels, use simple yes/no or short-answer questions

SITUATION RULES:
- The "situation" field should be EMPTY ("") for discussion type. Discussion challenges do NOT need a scenario or roleplay setup.
- The "instruction" field is the ONLY text shown. It should simply say: "Talk about the topics below. Answer the questions with your real experiences and opinions. Try to speak simply and clearly."
- Do NOT invent a café scene, a meeting, or any scenario. This is just a topic discussion.

Respond ONLY in JSON format:
{
  "missionData": {
    "missionType": "discussion",
    "challengeNumber": 1,
    "challengeName": "Challenge 1",
    "duration": "5-6 minutes",
    "situation": "",
    "situationTranslation": "",
    "instruction": "Talk about the topics below. Answer the questions with your real experiences and opinions. Try to speak simply and clearly.",
    "instructionTranslation": "Translation of instruction",
    "showGrammarTip": false,
    "grammarTipTitle": "",
    "grammarTipItems": [],
    "isOptional": false,
    "tutorSteps": [
      { "instruction": "Introduce the discussion.", "scripts": [{ "text": "Now let's have a discussion." }] },
      { "instruction": "Present the first topic." },
      { "instruction": "Ask the discussion questions and encourage elaboration." },
      { "instruction": "Move to the next topic if time allows." },
      { "instruction": "Wrap up the discussion.", "scripts": [{ "text": "Great discussion! Let's continue." }] }
    ],
    "topics": [
      {
        "title": "MORNING ROUTINE",
        "questions": [
          "Do you wake up early?",
          "Do you always eat breakfast?",
          "Do you exercise in the morning?",
          "Do you have the same morning routine every day?"
        ]
      },
      {
        "title": "ROUTINE ACTIVITIES",
        "questions": [
          "What do you usually eat for breakfast (ex. bread, rice)?",
          "What do you usually drink in the morning (ex. tea, coffee)?",
          "Do you take a shower or a bath?",
          "What's your night routine?"
        ]
      }
    ],
    "questions": []
  }
}
`
});

// Mission Reading Agent - Reading + roleplay challenge
const missionReadingAgent = createAgent({
  name: 'Mission Reading Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a READING mission challenge.
This is a reading + roleplay activity. The student first reads a practical real-world text (a restaurant review, a brochure, a menu, a flyer, a schedule, a poster, an online post, etc.), and then has a roleplay conversation with the tutor about what they read — similar to a speaking mission.

THE FLOW:
1. Student reads a short practical text (a review, menu, price list, flyer, product listing, event poster, etc.)
2. Tutor checks pronunciation and corrects mistakes
3. Tutor and student do a roleplay conversation where the student uses the information from the reading

READING PASSAGE RULES:
- The passage should be a PRACTICAL, real-world text — NOT a story, essay, or academic article.
- NEVER create scenarios about spelling names or any spelling-related tasks.
- NEVER prefix character names with their job title (e.g. "Manager Jiho", "Barista Hana"). Just use first names.
- Perfect examples: restaurant review comparing places, karaoke price list, hotel brochure, event schedule, travel guide excerpt, product comparison, online forum post, job listing, apartment listing, etc.
- The passage is a DOCUMENT that exists in the real world. It should read like something you'd find posted on a wall, printed on paper, or published online.
- The text should contain USEFUL information (prices, times, locations, features, names, descriptions) that the student can reference during the roleplay.
- NEVER put instructions, prompts, or scripts in the reading passage. No "Say:", "Share:", "Tell:", "Ask:", "Introduce yourself", "Greet them", etc. These belong in tutorSteps, NOT in the passage.
- The passage is NOT a lesson plan or activity guide. It is a real-world document the student reads for information.
  - WRONG: "• Say: Hello / Hi / Good evening\n• Say: Nice to meet you\n• Share: your name" — this is a script/prompt, NOT a reading passage.
  - CORRECT: "TODAY: New Friends Coffee Meet-up\nTime: 5:30-6:30 p.m.\nPlace: Cafe Haneul, 2F\n\nSpecial menu:\n• Iced Americano 3,000 won\n• Hot Latte 3,500 won" — this is real information.
- Use <b> tags to bold section headings, restaurant/place names, prices, and key vocabulary in the passage block text. Example: "<b>Food Hub</b> is a good place to hang out. Main courses start at <b>$12</b>." Only use <b> — do NOT use <br>, <i>, <u>, or any other HTML tags.
- Use SEPARATE blocks for each section/paragraph of the passage. Each block is one paragraph or section.
- For structured content (menus, price lists), put each section in its own block. Use bullet points with the • symbol and line breaks with \n for lists.
- Keep it 100-200 words for lower levels, 200-350 for higher levels.
- The content should naturally connect to the lesson topic and feel like something you'd actually read in real life.
- Include a "closingQuestion" — a fun prompt at the end of the passage (like a blog comment prompt or question to the reader).

SITUATION AND INSTRUCTION:
- "situation" describes the scenario setup — what the student will read AND what they'll do after.
  - Example: "You want to invite a coworker to dinner. Read a review of some new restaurants in your area. Then, talk to your coworker and decide which restaurant to go to."
- "instruction" should tell the student what to do with the reading: "Read the review below. Then answer the questions using the information from the text."
- Both situation and instruction should be filled in for reading type.

TUTOR GUIDE (tutorSteps):
- The tutorSteps should follow this standard 8-step structure:
  1. Introduce Challenge (scripts: intro lines)
  2. Read the situation (no scripts needed)
  3. Confirm student's understanding (scripts: "Is it clear?")
  4. Set up the reading (scripts: "Let's read the article/review/menu.")
  5. Have the student read aloud
  6. After reading, correct pronunciation (tips about limiting corrections)
  7. Set up the roleplay (scripts: character setup + "I'll start")
  8. Ask the questions below (tips: the 3 standard roleplay tips)

QUESTIONS RULES (same as speaking type):
- The tutor plays ONE character and has a conversation about the reading material.
- questionsIntro: A parenthetical direction for the tutor to start the roleplay.
- Generate 4-7 numbered questions + 1 closing direction.
- Questions should reference information FROM the reading passage.
  - GOOD: "Which restaurant is the cheapest?" (references the review)
  - GOOD: "How much is the big room for 3 hours?" (references the price list)
- The LAST entry should be a closing direction in parentheses.
- Only add hints when the question is ambiguous. Most need 0 hints.
- Max 1 hint per question.

Respond ONLY in JSON format:
{
  "missionData": {
    "missionType": "reading",
    "challengeNumber": 1,
    "challengeName": "Challenge 1",
    "duration": "5-7 minutes",
    "situation": "You want to invite a coworker to dinner. Read a review of some new restaurants in your area. Then, talk to your coworker and decide which restaurant to go to.",
    "situationTranslation": "Translation here",
    "instruction": "Read the review below. Then answer the questions about the restaurants.",
    "instructionTranslation": "Translation here",
    "showGrammarTip": true,
    "grammarTipTitle": "Today's grammar tip",
    "grammarTipItems": ["grammar concept 1", "grammar concept 2"],
    "tutorSteps": [
      { "instruction": "Introduce Challenge 1.", "scripts": [{ "text": "Okay, now let's do the Challenge." }, { "text": "First we have Challenge 1." }] },
      { "instruction": "Read the situation.", "tips": [{ "text": "Read it slowly and clearly. Point to key words if needed." }] },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Do you understand the situation?" }, { "text": "Is it clear?" }], "tips": [{ "text": "If the student looks confused, rephrase the situation in simpler words." }] },
      { "instruction": "Set up the reading.", "scripts": [{ "text": "Let's read the online article." }] },
      { "instruction": "Have the student read the reading text aloud." },
      { "instruction": "After they finish reading, correct their pronunciation mistakes.", "tips": [{ "text": "Limit this to 2-3 corrections." }, { "text": "If the student made a lot of mistakes, focus on the biggest ones." }] },
      { "instruction": "Set up the roleplay.", "scripts": [{ "text": "Now, I'll be your coworker." }, { "text": "Please talk to me about which restaurant to go to." }, { "text": "Remember to use today's grammar tip." }, { "text": "Is it clear?" }, { "text": "I'll start." }] },
      { "instruction": "Ask the questions below.", "tips": [{ "text": "Use the questions below only as guides. Ask other questions based on the flow of the conversation." }, { "text": "Make sure that you simulate a real-life situation." }, { "text": "Change your tone according to the character you are playing." }] }
    ],
    "readingPassage": {
      "title": "Crazy for Foodie",
      "author": "Nicole Khallie",
      "blocks": [
        { "type": "paragraph", "text": "Three new restaurants opened this month, and of course, we went to try them!" },
        { "type": "paragraph", "text": "<b>Food Hub</b> is a good place to just hang out. It is easily the most affordable of the three restaurants. Try their <b>steak and fries</b> or <b>lamb chop</b> for your main course." },
        { "type": "paragraph", "text": "<b>Rare Basil</b> is slightly classier than Food Hub and is great for a girls' night out. They serve amazing pasta. All pasta dishes come with a side of fish fillet, steak, or chicken." },
        { "type": "paragraph", "text": "<b>Palate Palace</b> is easily the classiest restaurant we visited. The food here is a little cheaper than at Rare Basil. They serve unique dishes like <b>chicken with white chocolate sauce</b>." }
      ],
      "closingQuestion": "Have you visited these restaurants? Share your favorite dish in the comments section below!"
    },
    "questionsIntro": "(Talk about your day first.)",
    "questions": [
      { "question": "1. I'm tired and hungry! How about you?", "hints": [] },
      { "question": "2. Do you know any new restaurants we can try?", "hints": [] },
      { "question": "3. What kind of food do they serve at (restaurant name)?", "hints": ["Ask about the other restaurants too"] },
      { "question": "4. Which is the most affordable?", "hints": [] },
      { "question": "5. I can't decide... Which one do you want to go to?", "hints": [] },
      { "question": "(Thank the student for suggesting new restaurants.)", "hints": [] }
    ]
  }
}

CRITICAL RULES:
- The reading passage must be a PRACTICAL text (review, menu, brochure, list, poster, flyer), NOT a story or essay.
- The passage must contain concrete info (prices, names, features, times) the student can reference in the roleplay.
- The roleplay questions should require the student to USE information from the passage.
- ONE roleplay character only. The tutor plays one person having a natural conversation.
- tutorSteps must follow the exact 8-step structure shown above.
- 4-7 numbered roleplay questions + 1 closing direction.
- Hints are OPTIONAL. Only add when the question is ambiguous.
- Normal everyday settings ONLY.
- Keep the readingPassage blocks as "paragraph" type. Use <b> tags for headings and key info. Do NOT use "images" type.
- Each block text should be a separate paragraph or section of the passage. Use \n for line breaks within a block.
- NEVER put instructions, scripts, or prompts (like "Say:", "Share:", "Tell:", "Greet") inside the reading passage. The passage is a DOCUMENT, not a lesson script.
`
});

// Mission Listening Agent - Listening comprehension challenge
const missionListeningAgent = createAgent({
  name: 'Mission Listening Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an ESL lesson content generator. Generate a LISTENING mission challenge.
This is an ONLINE listening comprehension activity where the tutor reads a script and students respond via video call.

IMPORTANT GUIDELINES:
- Create a listening script that the tutor will read to the student
- The listening script must be a DIRECT MONOLOGUE — the speaker talks DIRECTLY TO the listener. NOT a story. NOT a retelling. NOT narration.
- NEVER retell or narrate conversations. No "She asked, 'Where are you from?' I said, 'I'm from Busan.'" — this is narration/storytelling, NOT a monologue. REJECTED.
- NEVER use "he said", "she asked", "I told her", "she smiled and said" — these are all narration patterns. REJECTED.
- The script should sound like ONE person talking TO the listener: a friend recommending a place, a coworker sharing news, a neighbor giving directions, an announcement, a text message, etc.
- The speaker must NEVER coach or instruct the listener. No "say Hello", "please say...", "you should say...", "when you see her, say..." — nobody talks like this. REJECTED.
- Do NOT write a generic self-introduction listing random facts. Give the speaker a REASON to talk — inviting someone, sharing news, asking for help, giving directions, etc. The message must have a clear PURPOSE.
- You do NOT need to include every target expression. Only use 2-3 that fit naturally. Better to use fewer expressions naturally than force all of them in awkwardly.
- NEVER include content about spelling someone's name, asking how to spell a name, or any spelling-related activities.
- NEVER prefix character names with their job title (e.g. "Manager Jiho", "Barista Hana", "Chef Soo-jin"). Just use the first name: "Jiho", "Hana", "Soo-jin". The role is described separately in the setup.
- Include key words/phrases in <u> tags that students should remember
- After listening, students should roleplay using the information they heard
- Include tutor steps for the listening and follow-up roleplay
- Generate questions for the roleplay that test comprehension
- Make the listening script realistic (friend's recommendation, announcement, text message, etc.)
- This is for ONLINE ESL lessons (video call). NEVER include physical/face-to-face stage directions like "(Sit down)", "(Walk over)", "(Point to)", etc.
- Each numbered question must have EXACTLY 1 hint — a single short coaching note. No more than 1 hint per question.

LISTENING SCRIPT LENGTH:
- The listening script should be SHORT and natural — like something a friend would actually say.
- For lower levels (1-4): 3-5 sentences, 30-60 words. Keep it very simple.
- For mid levels (5-7): 4-6 sentences, 50-80 words.
- For higher levels (8-10): 5-8 sentences, 70-120 words.
- NEVER exceed 120 words. The tutor needs to read it aloud — if it's too long, it's boring and hard to follow.
- Focus on USEFUL information (names, prices, times, locations, recommendations) the student can use in the roleplay.

TUTOR STEPS RULES:
- The "Set up the roleplay" step should contain ALL roleplay setup scripts (character intro, student role, "I'll start").
- The "Ask the questions below" step should have NO scripts in it — only tips. The questions are injected separately.
- Do NOT repeat roleplay setup information in both the tutorSteps and questionsIntro. The setup belongs in the "Set up the roleplay" step ONLY.

questionsIntro rules:
- A short parenthetical direction for the tutor to open the roleplay in character.
- Must start and end with parentheses.
- Should NOT repeat the character/role info from "Set up the roleplay" step.
- GOOD: "(Greet the customer warmly.)"
- WRONG: "Start the roleplay: You are a customer at a café and..." — this repeats the setup.

questions array rules:
- The tutor plays ONE character only.
- Generate 4-6 numbered questions + 1 closing direction entry.
- Questions MUST be numbered: "1.", "2.", "3.", etc.
- Each question is a natural thing the tutor says in character.
- The LAST entry should be a closing direction in parentheses, e.g. "(Thank the student and end the conversation.)"
- Only add a hint when the question is ambiguous. If the expected answer is obvious, use an empty hints array [].

Respond ONLY in JSON format:
{
  "missionData": {
    "missionType": "listening",
    "challengeNumber": 1,
    "challengeName": "Challenge 1",
    "duration": "5-6 minutes",
    "situation": "Listen to your friend talk about something, then use that information.",
    "situationTranslation": "Translation of situation",
    "instruction": "",
    "instructionTranslation": "",
    "showGrammarTip": true,
    "grammarTipTitle": "Today's grammar tip",
    "grammarTipItems": ["grammar concept to practice"],
    "tutorSteps": [
      { "instruction": "Introduce Challenge 1.", "scripts": [{ "text": "Okay, now let's do the Challenge." }] },
      { "instruction": "Read the situation." },
      { "instruction": "Confirm the student's understanding.", "scripts": [{ "text": "Is it clear?" }] },
      { "instruction": "Set up the listening.", "scripts": [{ "text": "First, let's listen." }, { "text": "I'll be your friend." }] },
      { "instruction": "Read the listening script below, emphasizing the underlined words.", "listeningScript": "Hey, (student's name)! I found this amazing place. It was so <u>incredible</u>! The <u>atmosphere was cozy</u> and the <u>service was excellent</u>. You should definitely try it!" },
      { "instruction": "Set up the roleplay.", "scripts": [{ "text": "Now, I'll be the barista at the café." }, { "text": "You are a customer who wants to try the place your friend recommended." }, { "text": "Please use the information you heard." }, { "text": "I'll start." }] },
      { "instruction": "Ask the questions below.", "tips": [{ "text": "Use the questions only as guides. Ask other questions based on the flow of the conversation." }, { "text": "Make sure that you simulate a real-life situation." }, { "text": "Change your tone according to the character you are playing." }] }
    ],
    "listeningScript": "Hey, (student's name)! I found this amazing place. It was so <u>incredible</u>! The <u>atmosphere was cozy</u> and the <u>service was excellent</u>. You should definitely try it!",
    "questionsIntro": "(Greet the customer warmly.)",
    "questions": [
      { "question": "1. Hi! Welcome! Is this your first time here?", "hints": ["If yes, ask how they heard about the place"] },
      { "question": "2. What can I get for you today?", "hints": [] },
      { "question": "3. Would you like to try our special drink?", "hints": ["Mention a specific item"] },
      { "question": "4. How is everything? Are you enjoying it?", "hints": [] },
      { "question": "(Thank the customer and invite them to come back.)", "hints": [] }
    ]
  }
}
`
});

export const generateIntroductionContent = async (
  topic: string,
  skillLevel: string,
  skill: string, // speaking, listening, reading
  customPrompt?: string | null,
  currentContent?: any | null,
  baseInstructions?: string | null,
  level?: number | null,
  chapter?: number | null,
  lessonNumber?: number | null,
  generationMode?: 'new' | 'improve' | null,
  includeLessonIssue?: boolean | null,
  lessonGoal?: string | null,
  learnType?: 'vocabulary' | 'expressions' | null, // Optional Step A subtype
  stepBType?: 'speak-your-mind' | 'grammar-tip' | 'pronunciation' | null, // Optional Step B type
  includeTranslation?: boolean | null, // Whether to include translations
  translationLanguage?: 'japanese' | 'korean' | 'vietnamese' | 'chinese' | null, // Translation language
  vocabularyCount?: number | null, // Current vocabulary count in editor (AI will generate this many)
  expressionCount?: number | null, // Current expression count in editor (AI will generate this many)
  applyType?: 'speaking' | 'listening' | 'reading' | null, // Apply activity type
  dialogueLineCount?: number | null, // Current dialogue line count in editor
  generateTrivia?: boolean | null, // Whether to generate standalone trivia content
  exerciseType?: string | null, // Exercise type (rephrase/choose/change or conversation/multiple-choice/speech/compare)
  exerciseStep?: 'stepA' | 'stepB' | null, // Exercise step (A or B)
  exerciseItemCount?: number | null, // Current exercise item count in editor
  missionType?: 'speaking' | 'discussion' | 'reading' | 'listening' | null, // Mission type
  missionQuestionCount?: number | null, // Current mission question count in editor
  isMission2?: boolean | null, // Whether this is mission 2 (challenge 2)
  storyData?: {
    enabled: boolean;
    storyTitle: string;
    characters: Array<{
      id: string;
      name: string;
      koreanName?: string;
      role: 'main' | 'supporting' | 'minor';
      description: string;
      personality?: string;
    }>;
    setting: string;
    previousSummary: string;
    currentPlotPoints: string[];
    storyNotes: string;
  } | null, // Story data for K-Drama style generation
  currentLearnData?: {
    steps?: Array<{
      id: string;
      label: string;
      items?: Array<{
        foreign: string;
        foreignLabel?: string;
        native: string;
        audio?: string;
        image?: string;
      }>;
    }>;
    stepBType?: string | {
      format?: string;
      type?: string;
      items?: Array<{
        foreign: string;
        foreignLabel?: string;
        native: string;
        audio?: string;
        image?: string;
      }>;
    };
    grammarTip?: {
      title?: string;
      content?: string;
      items?: Array<{
        pattern?: string;
        explanation?: string;
        example?: string;
      }>;
    };
  } | null, // Learn section data for cross-section cohesion
  currentApplyData?: {
    activityType: 'speaking' | 'listening' | 'reading';
    situationText?: string;
    dialogueLines?: Array<{ speaker: string; text: string }>;
    readingText?: string;
    tutorSteps?: Array<{ instruction?: string; scripts?: Array<{ text: string }>; listeningScript?: string }>;
  } | null // Apply section data for story continuity in Mission
): Promise<GenerateIntroductionResult> => {
  try {
    // Map lesson level (1-10) to complexity descriptor
    const getComplexityLevel = (level?: number | null): string => {
      if (!level) return 'beginner to intermediate';
      if (level <= 2) return 'very simple and beginner-friendly';
      if (level <= 4) return 'simple beginner level';
      if (level <= 6) return 'intermediate level';
      if (level <= 8) return 'intermediate to advanced level';
      return 'advanced level';
    };

    const complexityDesc = getComplexityLevel(level);
    
    // Generate a variation seed to encourage different responses each time
    const variationSeed = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    
    // Build story context string for K-Drama style generation
    const buildStoryContext = (): string => {
      if (!storyData?.enabled) return '';
      
      const characterList = storyData.characters
        .map(c => `- ${c.name}${c.koreanName ? ` (${c.koreanName})` : ''}: ${c.role} character. ${c.description}${c.personality ? ` Personality: ${c.personality}` : ''}`)
        .join('\n');
      
      const plotPoints = storyData.currentPlotPoints
        .map((p, i) => `${i + 1}. ${p}`)
        .join('\n');
      
      return `
=== K-DRAMA STORY MODE (IMPORTANT!) ===
You are creating content for an immersive K-drama style learning experience.
The student interacts with the story characters but is NOT the protagonist.

Episode Title: "${storyData.storyTitle || 'Untitled Episode'}"
Setting: ${storyData.setting || 'Not specified'}

CHARACTERS:
${characterList || 'No characters defined yet - create appropriate characters based on the topic.'}

PREVIOUS EPISODE SUMMARY:
${storyData.previousSummary || 'This is the beginning of the story.'}

PLOT POINTS FOR THIS EPISODE:
${plotPoints || 'No specific plot points - create an engaging scenario based on the topic.'}

STORY NOTES:
${storyData.storyNotes || 'None'}

INSTRUCTIONS:
1. Use the characters defined above in dialogues and scenarios
2. Continue the story naturally from where the previous episode left off
3. Follow the plot points to create dramatic, engaging content
4. Make dialogues natural and emotionally engaging like a K-drama
5. The student's role is to interact with characters (ordering food, asking questions, etc.)
6. Include dramatic moments, misunderstandings, or emotional beats appropriate to the topic
`;
    };
    
    const storyContext = buildStoryContext();
    
    // Build context from Learn section for cross-section cohesion (Apply, Exercise, Mission)
    const buildLearnContext = (): string => {
      if (!currentLearnData) return '';
      
      const parts: string[] = [];
      
      // Extract vocabulary items from Step A
      if (currentLearnData.steps && currentLearnData.steps.length > 0) {
        const vocabularyItems: string[] = [];
        const expressionItems: string[] = [];
        
        for (const step of currentLearnData.steps) {
          if (step.items && step.items.length > 0) {
            const isVocabulary = step.label.toLowerCase().includes('vocab');
            const isExpression = step.label.toLowerCase().includes('express');
            
            for (const item of step.items) {
              if (isVocabulary) {
                vocabularyItems.push(`- ${item.foreign} (${item.native})`);
              } else if (isExpression) {
                expressionItems.push(`- ${item.foreign} (${item.native})`);
              } else {
                // Default to vocabulary if label doesn't specify
                vocabularyItems.push(`- ${item.foreign} (${item.native})`);
              }
            }
          }
        }
        
        if (vocabularyItems.length > 0) {
          parts.push(`VOCABULARY FROM LEARN SECTION:\n${vocabularyItems.join('\n')}`);
        }
        if (expressionItems.length > 0) {
          parts.push(`EXPRESSIONS FROM LEARN SECTION:\n${expressionItems.join('\n')}`);
        }
      }
      
      // Extract Step B items (Speak Your Mind, Grammar Tip, Pronunciation)
      // stepBType can be a string or an object with items
      if (typeof currentLearnData.stepBType === 'object' && currentLearnData.stepBType?.items && currentLearnData.stepBType.items.length > 0) {
        const stepBItems = currentLearnData.stepBType.items
          .map(item => `- ${item.foreign} (${item.native})`)
          .join('\n');
        const stepBTypeStr = currentLearnData.stepBType.type || '';
        const stepBLabel = stepBTypeStr === 'speak-your-mind' ? 'SPEAK YOUR MIND PHRASES' :
                          stepBTypeStr === 'pronunciation' ? 'PRONUNCIATION FOCUS' :
                          'ADDITIONAL ITEMS';
        parts.push(`${stepBLabel} FROM LEARN SECTION:\n${stepBItems}`);
      }
      
      // Extract Grammar Tip - handle both content string and items array formats
      if (currentLearnData.grammarTip?.title) {
        let grammarContent = '';
        
        if (currentLearnData.grammarTip.content) {
          grammarContent = `Explanation: ${currentLearnData.grammarTip.content}`;
        } else if (currentLearnData.grammarTip.items && currentLearnData.grammarTip.items.length > 0) {
          grammarContent = currentLearnData.grammarTip.items
            .map(item => {
              const parts = [];
              if (item.pattern) parts.push(`Pattern: ${item.pattern}`);
              if (item.explanation) parts.push(`Explanation: ${item.explanation}`);
              if (item.example) parts.push(`Example: ${item.example}`);
              return parts.join('\n');
            })
            .join('\n\n');
        }
        
        if (grammarContent) {
          parts.push(`GRAMMAR RULE FROM LEARN SECTION:
Title: ${currentLearnData.grammarTip.title}
${grammarContent}

IMPORTANT: Create content that allows students to PRACTICE this grammar pattern. The exercises and scenarios should require using this grammar structure.`);
        }
      }
      
      if (parts.length === 0) return '';
      
      return `
=== CROSS-SECTION COHESION (IMPORTANT!) ===
The student has already learned the following vocabulary, expressions, and grammar rules in the LEARN section.
Your generated content should help them PRACTICE and APPLY what they learned.

${parts.join('\n\n')}

INSTRUCTIONS FOR COHESION:
1. Use the vocabulary and expressions from above naturally in dialogues and scenarios
2. If a grammar rule is provided, create sentences/questions that require using that grammar pattern
3. Don't just repeat the items - create realistic situations where students must use them
4. The goal is reinforcement through practice, not repetition of definitions
5. If any expression is about spelling (e.g. "How do you spell that?"), SKIP it entirely - do NOT include spelling in the content
6. NEVER have one character teach or explain an expression to the other character. The expressions should flow naturally as part of normal speech, not be presented as lessons.
7. For LISTENING scripts: you do NOT need to use every expression. Only include 2-3 that fit naturally into the speaker's message. Forcing all expressions into a short monologue makes it sound fake.
`;
    };
    
    const learnContext = buildLearnContext();
    
    // Determine if translations should be included and which language
    const shouldIncludeTranslation = includeTranslation !== false; // Default to true
    const langName = {
      japanese: 'Japanese',
      korean: 'Korean',
      vietnamese: 'Vietnamese',
      chinese: 'Chinese (Simplified)',
    }[translationLanguage || 'japanese'] || 'Japanese';
    
    // If the request is specifically for Learn -> Vocabulary, generate a level-appropriate list
    if (learnType === 'vocabulary') {
      // Use provided vocabulary count if available, otherwise use level-based default
      const defaultVocabCount = (lvl?: number | null) => {
        const n = lvl || 1;
        if (n <= 1) return 6;
        if (n <= 4) return 8;
        return 10;
      };

      // If user has items in editor, use that count; otherwise use level-based default
      const count = vocabularyCount && vocabularyCount > 0 ? vocabularyCount : defaultVocabCount(level);
      const vocabFormat = shouldIncludeTranslation 
        ? '{ "word": "...", "partOfSpeech": "...", "meaning": "...", "translation": "..." }'
        : '{ "word": "...", "partOfSpeech": "...", "meaning": "..." }';
      const translationReq = shouldIncludeTranslation 
        ? `6. Include ${langName} translations for each vocabulary item.`
        : '';
      
      let prompt = `[Variation ID: ${variationSeed}] Generate exactly ${count} USEFUL vocabulary items that students need to LEARN.

=== LESSON CONTEXT ===
Topic: "${topic}"
Lesson Goal: "${lessonGoal || 'General English practice'}"
Level: ${level || 1} (${complexityDesc})

=== CRITICAL: WHAT NOT TO GENERATE ===
DO NOT include basic words everyone already knows:
- ❌ "hello", "hi", "bye", "goodbye", "name", "friend"
- ❌ "yes", "no", "please", "thank you"
- ❌ Single words that are obvious

=== WHAT TO GENERATE ===
Generate COMPLETE PHRASES that teach something useful:
- ✓ Question patterns: "What's your name?", "Where are you from?", "What do you do?"
- ✓ Response patterns: "Nice to meet you too", "I'm from...", "I work as..."
- ✓ Situational phrases: "Let me introduce myself", "Have we met before?"

Every item should make a student think "Oh, THAT'S how you say that in English!"

=== REQUIREMENTS ===
1. Focus on COMPLETE, USEFUL phrases - not single obvious words.
2. Match complexity to Level ${level || 1} (${complexityDesc}).
3. Meanings must be concise (max 10 words).
4. Each item must teach something NEW to the student.
${translationReq}

Return ONLY JSON:
{ "vocabulary": [ ${vocabFormat} ] }`;

      if (customPrompt) prompt += `\n\nAdditional context: ${customPrompt}`;

      const resp = await vocabularyListAgent.generate(prompt);
      const text = resp.text || '';
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
      let parsed: any = { vocabulary: [] };
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e) {
        console.error('Failed to parse vocabulary list response:', text);
        const lines = text.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
        parsed.vocabulary = lines.slice(0, count).map((l: string) => ({ word: l, partOfSpeech: '', meaning: '' }));
      }

      // Slice to the exact count requested to ensure we don't return more items than the editor has
      const vocab = (parsed.vocabulary || []).slice(0, count).map((v: any) => ({
        word: (v.word || '').toString(),
        partOfSpeech: (v.partOfSpeech || v.pos || '').toString(),
        meaning: (v.meaning || v.definition || '').toString(),
        translation: shouldIncludeTranslation ? (v.translation || '').toString() : undefined,
      }));

      return {
        introTexts: [],
        lessonIssue: { title: '', points: [] },
        lessonGoalDuration: '1 minute',
        lessonGoalSteps: [],
        learnVocabulary: vocab,
      };
    }

    // If the request is specifically for Learn -> Expressions, generate expressions list
    if (learnType === 'expressions') {
      // Use provided expression count if available, otherwise use level-based default
      const defaultExprCount = (lvl?: number | null) => {
        const n = lvl || 1;
        if (n <= 2) return 3;
        if (n <= 4) return 4;
        return 5;
      };

      // If user has items in editor, use that count; otherwise use level-based default
      const count = expressionCount && expressionCount > 0 ? expressionCount : defaultExprCount(level);
      const exprFormat = shouldIncludeTranslation 
        ? '{ "expression": "...", "definitionLine": "To <strong>...</strong> means...", "exampleSentence": "<em>...</em>", "translation": "plain text translation of the definition/explanation" }'
        : '{ "expression": "...", "definitionLine": "To <strong>...</strong> means...", "exampleSentence": "<em>...</em>" }';
      const translationReq = shouldIncludeTranslation 
        ? `6. Include ${langName} translations of the DEFINITION/EXPLANATION (NOT the expression itself) in the "translation" field. The translation must be PLAIN TEXT only - NO HTML tags.`
        : '';
      
      let prompt = `[Variation ID: ${variationSeed}] Generate exactly ${count} USEFUL expressions that students need to LEARN.

=== LESSON CONTEXT ===
Topic: "${topic}"
Lesson Goal: "${lessonGoal || 'General English practice'}"
Level: ${level || 1} (${complexityDesc})

=== CRITICAL: WHAT NOT TO GENERATE ===
DO NOT include basic expressions everyone already knows:
- ❌ "nice to meet you", "how are you", "thank you"
- ❌ "good morning", "see you later", "excuse me"
- ❌ Any phrase learned in the first week of English class

=== WHAT TO GENERATE ===
Generate INTERESTING expressions that teach something new:
- ✓ Idioms: "break the ice", "hit it off", "make a good impression"
- ✓ Phrasal verbs: "warm up to", "reach out to", "catch up with"
- ✓ Useful phrases: "I didn't catch your name", "What brings you here?"

Every expression should make a student think "Oh, THAT'S how native speakers say that!"

=== FORMAT REQUIREMENTS ===
1. definitionLine: Explain the expression with it wrapped in <strong> tags
2. exampleSentence: Show real usage in <em> tags with expression in <strong> tags
3. Make examples feel natural - like real conversations
${translationReq}

Return ONLY JSON:
{ "expressions": [ ${exprFormat} ] }`;

      if (customPrompt) prompt += `\n\nAdditional context: ${customPrompt}`;

      const resp = await expressionsListAgent.generate(prompt);
      const text = resp.text || '';
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
      let parsed: any = { expressions: [] };
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e) {
        console.error('Failed to parse expressions list response:', text);
        parsed.expressions = [];
      }

      // Helper to strip HTML tags from translation fields (translations should be plain text)
      const stripHtml = (html: string) => html?.replace(/<[^>]*>/g, '') || '';

      const expressions = (parsed.expressions || []).slice(0, count).map((e: any) => ({
        expression: (e.expression || '').toString(),
        definitionLine: (e.definitionLine || e.definition || '').toString(),
        exampleSentence: (e.exampleSentence || e.example || '').toString(),
        translation: shouldIncludeTranslation ? stripHtml((e.translation || '').toString()) : undefined,
      }));

      return {
        introTexts: [],
        lessonIssue: { title: '', points: [] },
        lessonGoalDuration: '1 minute',
        lessonGoalSteps: [],
        learnExpressions: expressions,
      };
    }

    // If the request is for Step B content, generate based on stepBType
    if (stepBType) {
      const translationLangInstruction = shouldIncludeTranslation 
        ? `\n- Include ${langName} translations where applicable`
        : '\n- Do NOT include translations';
      
      let basePrompt = `Generate Step B content for an ESL lesson.
- Topic: ${topic}
- Lesson Goal: ${lessonGoal || ''}
- Level: ${level || 'unknown'} (complexity: ${complexityDesc})${translationLangInstruction}`;

      if (customPrompt) basePrompt += `\nAdditional instructions: ${customPrompt}`;

      if (stepBType === 'speak-your-mind') {
        const resp = await speakYourMindAgent.generate(basePrompt);
        const text = resp.text || '';
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
        let parsed: any = { speakYourMind: {} };
        try {
          parsed = JSON.parse(jsonContent);
        } catch (e) {
          console.error('Failed to parse speak-your-mind response:', text);
        }

        const sym = parsed.speakYourMind || {};
        return {
          introTexts: [],
          lessonIssue: { title: '', points: [] },
          lessonGoalDuration: '1 minute',
          lessonGoalSteps: [],
          stepB: {
            stepType: 'speak-your-mind',
            speakYourMind: {
              explanation: sym.explanation || '',
              speaker1SpeechBubble: sym.speaker1SpeechBubble || '',
              speaker2SpeechBubble: sym.speaker2SpeechBubble || '',
              question: sym.question || '',
            },
          },
        };
      }

      if (stepBType === 'grammar-tip') {
        // Create a more specific prompt for grammar tips
        const grammarPrompt = `Generate a Grammar Tip for an ESL lesson about "${topic}".

Lesson Goal: ${lessonGoal || 'General English practice'}
Level: ${level || 1} (${complexityDesc})
${shouldIncludeTranslation ? `Include ${langName} translations for rule explanations and examples.` : 'Do NOT include translations.'}

=== REQUIREMENTS ===
1. Generate 2-3 different grammar explanations (NOT just one!)
2. Each explanation needs 2-3 example sentences
3. Example sentences must be SIMPLE STANDALONE sentences - NOT dialogues
4. Do NOT use "A:" or "B:" format in examples - just write clean sentences

Create grammar rules that help students achieve the lesson goal. The grammar should be DIRECTLY USEFUL for the topic.
${customPrompt ? `Additional notes: ${customPrompt}` : ''}`;

        const resp = await grammarTipAgent.generate(grammarPrompt);
        const text = resp.text || '';
        
        // Try to extract JSON - handle both with and without code blocks
        let jsonContent = text;
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch && jsonMatch[1]) {
          jsonContent = jsonMatch[1].trim();
        } else {
          // Try to find raw JSON object
          const rawJsonMatch = text.match(/\{[\s\S]*\}/);
          if (rawJsonMatch) {
            jsonContent = sanitizeAIText(rawJsonMatch[0]);
          }
        }
        
        let parsed: any = { grammarTip: {} };
        try {
          parsed = JSON.parse(jsonContent);
        } catch (e) {
          console.error('Failed to parse grammar-tip response:', text);
          console.error('Attempted to parse:', jsonContent);
        }

        // Helper to strip HTML tags from translation fields
        const stripHtml = (html: string) => html?.replace(/<[^>]*>/g, '') || '';

        const gt = parsed.grammarTip || {};
        return {
          introTexts: [],
          lessonIssue: { title: '', points: [] },
          lessonGoalDuration: '1 minute',
          lessonGoalSteps: [],
          stepB: {
            stepType: 'grammar-tip',
            grammarTip: {
              explanations: (gt.explanations || []).map((exp: any) => ({
                ruleText: exp.ruleText || '', // Keep HTML for rule text (rendered with RichTextInput)
                ruleTranslation: stripHtml(exp.ruleTranslation || ''), // Strip HTML from translation
                examples: (exp.examples || []).map((ex: any) => ({
                  sentence: ex.sentence || '', // Keep HTML for sentence (rendered with RichTextInput)
                  translation: stripHtml(ex.translation || ''), // Strip HTML from translation
                })),
              })),
            },
          },
        };
      }

      if (stepBType === 'pronunciation') {
        const resp = await stepBPronunciationAgent.generate(basePrompt);
        const text = resp.text || '';
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
        let parsed: any = { pronunciation: {} };
        try {
          parsed = JSON.parse(jsonContent);
        } catch (e) {
          console.error('Failed to parse pronunciation response:', text);
        }

        const pron = parsed.pronunciation || {};
        return {
          introTexts: [],
          lessonIssue: { title: '', points: [] },
          lessonGoalDuration: '1 minute',
          lessonGoalSteps: [],
          stepB: {
            stepType: 'pronunciation',
            pronunciation: {
              tip: pron.tip || '',
              phrases: (pron.phrases || []).map((p: any) => ({
                phrase: p.phrase || '',
                pronunciationGuide: p.pronunciationGuide || '',
                exampleSentence: p.exampleSentence || '',
              })),
            },
          },
        };
      }
    }

    // ========================================================================
    // APPLY SECTION GENERATION (Section 3)
    // ========================================================================
    if (applyType) {
      // Determine dialogue line count for speaking activities
      const defaultDialogueCount = (lvl?: number | null) => {
        const n = lvl || 1;
        if (n <= 2) return 6;
        if (n <= 4) return 8;
        if (n <= 6) return 10;
        return 12;
      };

      const dialogueCount = dialogueLineCount && dialogueLineCount > 0 ? dialogueLineCount : defaultDialogueCount(level);

      const translationInstruction = shouldIncludeTranslation
        ? `Include ${langName} translations for situationTranslation field.`
        : 'Do NOT include situationTranslation (leave it empty).';

      let applyPrompt = `[Variation ID: ${variationSeed}] Generate an ${applyType.toUpperCase()} activity for the Apply section.
${storyContext}
${learnContext}
=== LESSON CONTEXT ===
Topic: ${topic}
Lesson Goal: "${lessonGoal || 'General English practice'}"
Level: ${level || 1} (${complexityDesc})
Skill Level: ${skillLevel}

=== REQUIREMENTS ===
1. Create content that helps students APPLY what they learned to achieve the lesson goal.
2. Match complexity to Level ${level || 1} (${complexityDesc}).
3. ${translationInstruction}
4. Use underlined words (<u>word</u>) for key vocabulary from the lesson.
${applyType === 'speaking' ? `5. Create exactly ${dialogueCount} dialogue lines between 2 characters.
6. EVERY line must contain actual spoken dialogue. Do NOT create lines that only contain actions or emotions like "(laughs)" with no spoken words. If you want to show emotion, weave it into the spoken text (e.g. "Ha, that's amazing!").${storyContext ? '\n7. Use the STORY MODE characters and setting for the dialogue scene.' : ''}` : ''}
${applyType === 'listening' ? `5. Create a SHORT listening script that the tutor will read aloud. Follow the LISTENING SCRIPT LENGTH rules in your instructions — for Level ${level || 1}, keep it very short.\n6. Include 2-3 comprehension questions with answers.${storyContext ? '\n7. Incorporate the STORY MODE characters and plot into the listening narrative.' : ''}` : ''}
${applyType === 'reading' ? `5. Create a reading passage (email, letter, or article) appropriate for the level.\n6. Include 2-3 comprehension questions with answers.${storyContext ? '\n7. Make the reading content relate to the STORY MODE characters and plot.' : ''}` : ''}

Return ONLY JSON in the format specified.`;

      if (customPrompt) applyPrompt += `\n\nAdditional instructions: ${customPrompt}`;

      let agent;
      if (applyType === 'speaking') {
        agent = applySpeakingAgent;
      } else if (applyType === 'listening') {
        agent = applyListeningAgent;
      } else {
        agent = applyReadingAgent;
      }

      const resp = await agent.generate(applyPrompt);
      const text = resp.text || '';
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
      let parsed: any = { applyData: {} };
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e) {
        console.error('Failed to parse apply response:', text);
      }

      const apply = parsed.applyData || {};
      
      return {
        introTexts: [],
        lessonIssue: { title: '', points: [] },
        lessonGoalDuration: '1 minute',
        lessonGoalSteps: [],
        applyData: {
          activityType: applyType,
          activityDuration: apply.activityDuration || '3 minutes',
          situationText: stripHtml(apply.situationText || ''),
          situationTranslation: shouldIncludeTranslation ? (apply.situationTranslation || '') : '',
          dialogueLines: (apply.dialogueLines || []).slice(0, dialogueCount).map((line: any) => ({
            speaker: line.speaker || '',
            text: line.text || '',
            isAction: line.isAction || false,
          })),
          readingText: apply.readingText || '',
          tutorSteps: (apply.tutorSteps || []).map((step: any) => ({
            instruction: step.instruction || '',
            scripts: step.scripts || [],
            prompts: step.prompts || [],
            tips: step.tips || [],
            questions: step.questions || [],
            listeningScript: step.listeningScript || '',
          })),
          // Trivia Time content
          triviaEnabled: apply.triviaEnabled !== false, // Default to true
          triviaText: apply.triviaText || '',
          triviaTranslation: shouldIncludeTranslation ? (apply.triviaTranslation || '') : '',
          triviaDuration: apply.triviaDuration || '1 minute',
          triviaTutorSteps: (apply.triviaTutorSteps || []).map((step: any) => ({
            instruction: step.instruction || '',
            scripts: step.scripts || [],
            prompts: step.prompts || [],
            questions: step.questions || [],
          })),
        },
      };
    }

    // ========================================================================
    // STANDALONE TRIVIA GENERATION
    // ========================================================================
    if (generateTrivia) {
      let triviaPrompt = `[Variation ID: ${variationSeed}] Generate a TRIVIA TIME segment for an ESL lesson.

CONTEXT:
- Lesson Topic: ${topic}
- Skill Level: ${skillLevel}
- Lesson Skill: ${skill}
${lessonGoal ? `- Lesson Goal: ${lessonGoal}` : ''}
${level ? `- Level: ${level} (${complexityDesc})` : ''}
${chapter ? `- Chapter: ${chapter}` : ''}
${lessonNumber ? `- Lesson Number: ${lessonNumber}` : ''}

REQUIREMENTS:
1. Create an interesting cultural fact, language tip, or fun fact related to the lesson topic.
2. Make it engaging and memorable - something students will want to share.
3. Keep it educational but fun (2-4 sentences).
4. Include thought-provoking follow-up questions for discussion.
${shouldIncludeTranslation ? `5. Include translation in ${langName}.` : '5. Do NOT include translations.'}

${customPrompt ? `ADDITIONAL NOTES: ${customPrompt}` : ''}
${baseInstructions ? `BASE INSTRUCTIONS: ${baseInstructions}` : ''}`;

      const triviaResponse = await triviaAgent.generate(triviaPrompt);
      const text = typeof triviaResponse.text === 'string' ? triviaResponse.text : '';
      
      // Parse JSON from response
      let parsed: any = {};
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonContent = sanitizeAIText(jsonMatch ? jsonMatch[0] : text);
      
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e) {
        console.error('Failed to parse trivia response:', text);
      }

      const trivia = parsed.triviaData || {};
      
      return {
        introTexts: [],
        lessonIssue: { title: '', points: [] },
        lessonGoalDuration: '1 minute',
        lessonGoalSteps: [],
        triviaData: {
          triviaText: trivia.triviaText || '',
          triviaTranslation: shouldIncludeTranslation ? (trivia.triviaTranslation || '') : '',
          triviaDuration: trivia.triviaDuration || '1 minute',
          triviaTutorSteps: (trivia.triviaTutorSteps || []).map((step: any) => ({
            instruction: step.instruction || '',
            scripts: step.scripts || [],
            prompts: step.prompts || [],
            questions: step.questions || [],
          })),
        },
      };
    }

    // ========================================================================
    // EXERCISE SECTION GENERATION (Section 4)
    // ========================================================================
    if (exerciseType && exerciseStep) {
      const itemCount = exerciseItemCount || 4; // Default to 4 items
      
      let exerciseAgent: AIServiceAgent;
      let exercisePrompt = '';
      
      // Select appropriate agent based on exercise type and step
      if (exerciseStep === 'stepA') {
        if (exerciseType === 'rephrase') {
          exerciseAgent = exerciseRephraseAgent;
        } else if (exerciseType === 'choose') {
          exerciseAgent = exerciseChooseAgent;
        } else {
          exerciseAgent = exerciseChangeAgent;
        }
      } else {
        // Step B
        if (exerciseType === 'conversation') {
          exerciseAgent = exerciseConversationAgent;
        } else if (exerciseType === 'multiple-choice') {
          exerciseAgent = exerciseMultipleChoiceAgent;
        } else if (exerciseType === 'speech') {
          exerciseAgent = exerciseSpeechAgent;
        } else {
          exerciseAgent = exerciseCompareAgent;
        }
      }

      exercisePrompt = `[Variation ID: ${variationSeed}] Generate a ${exerciseType.toUpperCase()} exercise for ${exerciseStep === 'stepA' ? 'Step A' : 'Step B'} of the Exercise section.
${storyContext}
${learnContext}
CONTEXT:
- Lesson Topic: ${topic}
- Skill Level: ${skillLevel}
- Lesson Skill: ${skill}
${lessonGoal ? `- Lesson Goal: ${lessonGoal}` : ''}
${level ? `- Level: ${level} (${complexityDesc})` : ''}
${chapter ? `- Chapter: ${chapter}` : ''}
${lessonNumber ? `- Lesson Number: ${lessonNumber}` : ''}

REQUIREMENTS:
1. Create exactly ${itemCount} exercise items${exerciseStep === 'stepA' ? ' with answer key' : ''}.
2. Content should reinforce vocabulary and grammar from the lesson.
3. Difficulty should match the level (${complexityDesc}).
4. Make exercises practical and relevant to the lesson topic.
${shouldIncludeTranslation ? `5. Include translations in ${langName} for instructions.` : '5. Do NOT include translations.'}
${storyContext ? '6. Use scenarios and dialogues involving the STORY MODE characters.' : ''}

${customPrompt ? `ADDITIONAL NOTES: ${customPrompt}` : ''}
${baseInstructions ? `BASE INSTRUCTIONS: ${baseInstructions}` : ''}`;

      const exerciseResponse = await exerciseAgent.generate(exercisePrompt);
      const text = typeof exerciseResponse.text === 'string' ? exerciseResponse.text : '';
      
      // Parse JSON from response - try code fence extraction first, then raw JSON
      let parsed: any = {};
      const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const rawJsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonContent = sanitizeAIText(
        codeFenceMatch?.[1]?.trim() || (rawJsonMatch ? rawJsonMatch[0] : text)
      );
      
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e) {
        console.error('[EXERCISE DEBUG] Failed to parse exercise response:', text);
        console.error('[EXERCISE DEBUG] Parse error:', e);
      }

      // Handle both wrapped and unwrapped response formats
      const exercise = parsed.exerciseData || parsed || {};
      
      
      // Extract items from AI response - check multiple possible field names
      const extractItems = (data: any, primaryKey: string): any[] => {
        // Check the primary key first
        if (data[primaryKey]?.length > 0) return data[primaryKey];
        // Check common fallback keys
        if (data.items?.length > 0) return data.items;
        if (data.exerciseItems?.length > 0) return data.exerciseItems;
        if (data.chooseItems?.length > 0) return data.chooseItems;
        if (data.changeItems?.length > 0) return data.changeItems;
        if (data.sentences?.length > 0) return data.sentences;
        if (data.questions?.length > 0) return data.questions;
        return [];
      };

      // Get the appropriate items based on exercise type
      const rephraseItems = exerciseType === 'rephrase' ? extractItems(exercise, 'exerciseItems') : [];
      const chooseItemsArr = exerciseType === 'choose' ? extractItems(exercise, 'chooseItems') : [];
      const changeItemsArr = exerciseType === 'change' ? extractItems(exercise, 'changeItems') : [];
      
      
      // Build the answer key from the answers array
      const answersArr = (exercise.answers || []).slice(0, itemCount).map((answer: any) => ({
        text: typeof answer === 'string' ? answer : (answer.text || answer.answer || ''),
      }));
      
      // Build tutor steps and inject answerKey into the appropriate step
      const rawTutorSteps = (exercise.tutorSteps || []).map((step: any) => ({
        instruction: step.instruction || '',
        scripts: step.scripts || [],
        prompts: step.prompts || [],
        tips: step.tips || [],
        // Use undefined (not []) when empty, so the "Add Answer Key" button shows in the editor
        answerKey: step.answerKey?.length > 0 ? step.answerKey : undefined,
      }));
      
      // For Step A exercises, inject the answer key into the tutor steps
      // Find the best step to attach it to (one that mentions answers/corrections/repeat)
      // or add a dedicated answer key step
      if (exerciseStep === 'stepA' && answersArr.length > 0 && rawTutorSteps.length > 0) {
        // Look for a step that mentions checking answers, correcting, or repeating with remaining
        const answerStepIdx = rawTutorSteps.findIndex((s: any) => 
          /repeat|remaining|correct|answer|check|rephrase|choose|change/i.test(s.instruction)
        );
        
        if (answerStepIdx >= 0 && (!rawTutorSteps[answerStepIdx].answerKey || rawTutorSteps[answerStepIdx].answerKey.length === 0)) {
          // Inject into the matching step
          rawTutorSteps[answerStepIdx].answerKey = answersArr;
        } else {
          // No matching step found or it already has answers - insert a dedicated step before the last one (transition step)
          const insertIdx = Math.max(rawTutorSteps.length - 1, 0);
          rawTutorSteps.splice(insertIdx, 0, {
            instruction: 'Check the student\'s answers.',
            scripts: [],
            tips: [{ text: 'Correct any mistakes and explain briefly.' }],
            answerKey: answersArr,
          });
        }
      }
      
      return {
        introTexts: [],
        lessonIssue: { title: '', points: [] },
        lessonGoalDuration: '1 minute',
        lessonGoalSteps: [],
        exerciseData: {
          exerciseStep: exerciseStep,
          exerciseType: exerciseType,
          // Step A common fields
          instructions: exercise.instructions || '',
          instructionsTranslation: shouldIncludeTranslation ? (exercise.instructionsTranslation || '') : '',
          // Step A - Rephrase fields
          showExpressions: exercise.showExpressions || false,
          expressions: exercise.expressions || [],
          showExample: exercise.showExample || false,
          exampleSentence: exercise.exampleSentence || '',
          exampleAnswer: exercise.exampleAnswer || '',
          exerciseItems: rephraseItems.slice(0, itemCount).map((item: any) => ({
            sentence: typeof item === 'string' ? item : (item.sentence || item.text || ''),
          })),
          // Step A - Choose fields
          chooseItems: chooseItemsArr.slice(0, itemCount).map((item: any) => ({
            sentence: typeof item === 'string' ? item : (item.sentence || item.text || ''),
          })),
          // Step A - Change fields
          changeItems: changeItemsArr.slice(0, itemCount).map((item: any) => ({
            sentence: typeof item === 'string' ? item : (item.sentence || item.text || ''),
          })),
          // Answer key
          answers: answersArr,
          // Tutor steps (with answerKey injected)
          tutorSteps: rawTutorSteps,
          // Step B common fields
          stepBInstruction: exercise.stepBInstruction || '',
          stepBInstructionTranslation: shouldIncludeTranslation ? (exercise.stepBInstructionTranslation || '') : '',
          // Step B - Conversation fields
          conversations: (exercise.conversations || []).map((conv: any) => ({
            speechBubble: conv.speechBubble || '',
            position: conv.position || 'left',
          })),
          // Step B - Multiple Choice fields
          multipleChoiceItems: (exercise.multipleChoiceItems || []).map((item: any) => ({
            boldSentence: item.boldSentence || '',
            optionA: item.optionA || '',
            optionB: item.optionB || '',
          })),
          // Step B - Speech fields
          speechContent: exercise.speechContent || '',
          // Step B - Compare fields
          compareWordBox: exercise.compareWordBox || [],
          compareImages: (exercise.compareImages || []).map((img: any) => ({
            label: img.label || '',
          })),
          compareExample: exercise.compareExample || '',
          compareItems: (exercise.compareItems || []).map((item: any) => ({
            sentence: item.sentence || '',
          })),
          // Step B tutor steps
          stepBTutorSteps: (exercise.stepBTutorSteps || []).map((step: any) => ({
            instruction: step.instruction || '',
            scripts: step.scripts || [],
            prompts: step.prompts || [],
            tips: step.tips || [],
          })),
        },
      };
    }

    // ========================================================================
    // MISSION SECTION GENERATION (Section 5)
    // ========================================================================
    if (missionType) {
      const questionCount = missionQuestionCount || 6; // Default to 6 questions
      const challengeNum = isMission2 ? 2 : 1; // Challenge 1 or 2
      
      // Build Apply section context for story continuity
      const buildApplyContext = (): string => {
        if (!storyData?.enabled || !currentApplyData) return '';
        const parts: string[] = [];
        parts.push('\n=== APPLY SECTION CONTENT (for story continuity) ===');
        parts.push(`Activity Type: ${currentApplyData.activityType}`);
        if (currentApplyData.situationText) {
          parts.push(`Situation: ${currentApplyData.situationText}`);
        }
        if (currentApplyData.activityType === 'speaking' && currentApplyData.dialogueLines?.length) {
          parts.push('Dialogue:');
          for (const line of currentApplyData.dialogueLines) {
            parts.push(`  ${line.speaker}: ${line.text}`);
          }
        }
        if (currentApplyData.activityType === 'reading' && currentApplyData.readingText) {
          parts.push(`Reading passage: ${currentApplyData.readingText.replace(/<[^>]*>/g, '').substring(0, 500)}`);
        }
        if (currentApplyData.activityType === 'listening' && currentApplyData.tutorSteps?.length) {
          const script = currentApplyData.tutorSteps.find(s => (s as any).listeningScript)?.listeningScript;
          if (script) parts.push(`Listening script: ${script}`);
        }
        parts.push('Continue the story from where the Apply section left off. Do NOT repeat the same scenario.\n');
        return parts.join('\n');
      };
      const applyContext = buildApplyContext();
      
      let missionAgent: AIServiceAgent;
      
      // Select appropriate agent based on mission type
      if (missionType === 'speaking') {
        missionAgent = missionSpeakingAgent;
      } else if (missionType === 'discussion') {
        missionAgent = missionDiscussionAgent;
      } else if (missionType === 'reading') {
        missionAgent = missionReadingAgent;
      } else {
        missionAgent = missionListeningAgent;
      }

      const missionPrompt = `[Variation ID: ${variationSeed}] Generate a ${missionType.toUpperCase()} mission CHALLENGE ${challengeNum} for Section 5 (Mission).
${storyContext}
${applyContext}
${learnContext}
CONTEXT:
- Lesson Topic: ${topic}
- Skill Level: ${skillLevel}
- Lesson Skill: ${skill}
- Challenge Number: ${challengeNum}
${lessonGoal ? `- Lesson Goal: ${lessonGoal}` : ''}
${level ? `- Level: ${level} (${complexityDesc})` : ''}
${chapter ? `- Chapter: ${chapter}` : ''}
${lessonNumber ? `- Lesson Number: ${lessonNumber}` : ''}

REQUIREMENTS:
1. Create a ${missionType} challenge appropriate for the skill level.
2. ${missionType === 'speaking' ? `Generate EXACTLY 4 numbered roleplay questions + 1 closing direction (5 items total). Only add a hint if the question is ambiguous — most questions need 0 hints.` : missionType === 'listening' ? `Generate exactly ${questionCount} roleplay questions. Only add a hint if the question is ambiguous.` : missionType === 'discussion' ? 'Generate 2-3 discussion topics with 3-4 simple personal questions each. Questions must be about the student\'s real life (habits, preferences, experiences) — NEVER about grammar or how to use expressions.' : `Generate a practical reading passage (review, menu, brochure, price list, etc.) and ${questionCount} roleplay questions that reference the passage content. Follow the 8-step tutor guide structure.`}
3. Content should relate to the lesson topic and help students practice speaking naturally.
4. Difficulty should match the level (${complexityDesc}).
5. Make the scenario realistic and practical — use ordinary everyday settings (café, restaurant, park, office, etc.). NEVER ask the student to spell anything or repeat their name for spelling purposes. NEVER prefix character names with job titles (e.g. "Manager Jiho" — just use "Jiho").
6. This is Challenge ${challengeNum}${isMission2 ? ' - create a DIFFERENT scenario from Challenge 1 with varied content and situations' : ''}.
${shouldIncludeTranslation ? `7. Include translations in ${langName} for situation and instruction.` : '7. Do NOT include translations.'}
${storyContext ? '8. The roleplay scenario should advance the STORY MODE plot and involve the characters.' : ''}

${customPrompt ? `ADDITIONAL NOTES: ${customPrompt}` : ''}
${baseInstructions ? `BASE INSTRUCTIONS: ${baseInstructions}` : ''}`;

      const missionResponse = await missionAgent.generate(missionPrompt);
      const text = typeof missionResponse.text === 'string' ? missionResponse.text : '';
      
      // Parse JSON from response
      let parsed: any = {};
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonContent = sanitizeAIText(jsonMatch ? jsonMatch[0] : text);
      
      try {
        parsed = JSON.parse(jsonContent);
      } catch (e) {
        console.error('Failed to parse mission response:', text);
      }

      const mission = parsed.missionData || {};
      
      return {
        introTexts: [],
        lessonIssue: { title: '', points: [] },
        lessonGoalDuration: '1 minute',
        lessonGoalSteps: [],
        missionData: {
          missionType: missionType,
          sectionNumber: 5,
          sectionTitle: 'MISSION',
          challengeNumber: challengeNum,
          challengeName: mission.challengeName || `Challenge ${challengeNum}`,
          duration: mission.duration || '5-6 minutes',
          situation: stripHtml(mission.situation || ''),
          situationTranslation: shouldIncludeTranslation ? (mission.situationTranslation || '') : '',
          instruction: (missionType === 'speaking' || missionType === 'listening') ? '' : (mission.instruction || ''),
          instructionTranslation: (missionType === 'speaking' || missionType === 'listening') ? '' : (shouldIncludeTranslation ? (mission.instructionTranslation || '') : ''),
          showGrammarTip: mission.showGrammarTip || false,
          grammarTipTitle: mission.grammarTipTitle || "Today's grammar tip",
          grammarTipItems: mission.grammarTipItems || [],
          image: '',
          tutorSteps: (mission.tutorSteps || []).map((step: any) => ({
            instruction: step.instruction || '',
            scripts: step.scripts || [],
            prompts: step.prompts || [],
            tips: step.tips || [],
            listeningScript: step.listeningScript || '',
          })),
          questionsIntro: mission.questionsIntro || '',
          questions: (mission.questions || []).slice(0, questionCount).map((q: any) => ({
            question: q.question || '',
            hints: q.hints || [],
          })),
          // Discussion type specific
          isOptional: mission.isOptional || false,
          topics: (mission.topics || []).map((topic: any) => ({
            title: topic.title || '',
            questions: topic.questions || [],
          })),
          // Reading type specific
          readingPassage: mission.readingPassage ? {
            title: mission.readingPassage.title || '',
            author: mission.readingPassage.author || '',
            blocks: (mission.readingPassage.blocks || []).map((block: any) => ({
              type: block.type || 'paragraph',
              content: (block.text || block.content || ''),
              images: block.images || [],
            })),
            closingQuestion: mission.readingPassage.closingQuestion || '',
          } : undefined,
          // Listening type specific
          listeningScript: mission.listeningScript || '',
        },
      };
    }
    
    // Determine which mode to use (default to 'improve' if current content exists, 'new' otherwise)
    const mode = generationMode || (currentContent ? 'improve' : 'new');

    // GENERATE NEW MODE: Create full introduction content
    if (mode === 'new') {
      // Build translation instructions
      const translationInstruction = shouldIncludeTranslation 
        ? `- INCLUDE TRANSLATIONS: Generate introTexts with BOTH English AND ${langName} translations
  * First object: { "language": "en", "text": "English intro..." }
  * Second object: { "language": "${translationLanguage || 'japanese'}", "text": "${langName} translation..." }`
        : `- Generate introTexts with ONLY English (no translations)
  * Single object: { "language": "en", "text": "English intro..." }`;

      let fullPrompt = `Generate introduction content for an ESL lesson:
- Topic/Lesson Name: ${topic}
- Skill Level: ${skillLevel}
- Primary Skill: ${skill}
- Lesson Level: ${level || 'unknown'} (out of 10)
- Complexity: ${complexityDesc}

REQUIREMENTS:
- Create engaging introduction text (2-3 sentences explaining the topic)
${translationInstruction}
${includeLessonIssue ? '- Create a lesson issue with SHORT title (max 5-7 words) and 3 bullet points (IN ENGLISH ONLY, do not translate)\n' : '- Do NOT create a lesson issue (set lessonIssue to null)\n'}
- Create 5 lesson goal steps with tutor scripts
- Step 4 question must be SHORT (max 15 words) about English learning
- All vocabulary should be appropriate for ${complexityDesc} students
- NO emoji or special characters
- Focus on practical English learning
- IMPORTANT: Base the intro on the lesson GOAL/OBJECTIVE, not just the lesson name
${lessonGoal ? `- Lesson Goal: ${lessonGoal}` : ''}`;

      if (chapter) fullPrompt += `\n- Chapter: ${chapter}`;
      if (lessonNumber) fullPrompt += `\n- Lesson Number: ${lessonNumber}`;
      if (baseInstructions) fullPrompt += `\n\nUser's specific instructions: ${baseInstructions}`;
      if (customPrompt) fullPrompt += `\n\nAdditional custom instructions: ${customPrompt}`;

      const response = await fullIntroductionGeneratorAgent.generate(fullPrompt);
      const content = response.text;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonContent = sanitizeAIText((jsonMatch?.[1] || content).trim());
      const result = JSON.parse(jsonContent);

      // Post-process introTexts to enforce level-based brevity
      if (result.introTexts && Array.isArray(result.introTexts)) {
        const truncateSentences = (text: string, maxSentences: number) => {
          if (!text) return '';
          const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
          return sentences
            .slice(0, maxSentences)
            .join(' ')
            .trim()
            .replace(/\s+/g, ' ');
        };

        const levelNum = level || 0;
        const maxSentences = levelNum === 1 ? 2 : levelNum <= 4 ? 3 : 4;

        result.introTexts = result.introTexts.map((item: any) => ({
          ...item,
          text: truncateSentences(item.text || '', maxSentences),
        }));
      }

      // Post-process lessonIssue to enforce brevity and English-only constraints for low levels
      const containsCJK = (s?: string | null) => !!s && /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(s);
      const cleanPhrase = (s: string) => s
        .replace(/^\s+|\s+$/g, '')
        .replace(/^(Today (you|we) will (learn|practice)\b[,\s:]*)/i, '')
        .replace(/^In this lesson[,\s]*/i, '')
        .replace(/[.?!]$/g, '')
        .replace(/\s+/g, ' ');
      const shortenToWords = (s: string, maxWords: number) => {
        if (!s) return '';
        const words = cleanPhrase(s).split(/\s+/).filter(Boolean);
        if (words.length <= maxWords) return words.join(' ');
        return words.slice(0, maxWords).join(' ');
      };

      if (!includeLessonIssue) {
        result.lessonIssue = null;
      } else if (result.lessonIssue) {
        // Normalize title and points
        const li = result.lessonIssue;
        // If the model returned non-Latin (CJK) or long phrasing, fallback to topic-based short title
        const levelNum = level || 0;

        if (containsCJK(li.title)) {
          // Fallback: derive short title from topic
          li.title = shortenToWords(topic || 'Lesson', Math.max(3, Math.min(4, levelNum <= 2 ? 4 : 7)));
        }

        if (levelNum <= 2) {
          if (levelNum === 1) {
            // Level 1: enforce a single short sentence and remove bullet points
            const source = li.title || (li.points && li.points[0]) || topic || 'Say hello';
            const firstSentence = cleanPhrase(source).split(/[\.\?!]/)[0] || source;
            li.title = shortenToWords(firstSentence, 8); // single short sentence (<= 8 words)
            li.title = li.title.replace(/[\.\?!]$/g, '');
            li.points = [];
          } else {
            // Level 2: very short title + short phrase points
            li.title = shortenToWords(cleanPhrase(li.title || ''), 4);
            li.points = (li.points || []).slice(0, 3).map((p: string) => {
              const short = shortenToWords(p || '', 6);
              return cleanPhrase(short);
            });
          }
        } else if (levelNum <= 4) {
          li.title = shortenToWords(cleanPhrase(li.title || ''), 5);
          li.points = (li.points || []).slice(0, 3).map((p: string) => cleanPhrase(p || ''));
        } else {
          li.title = shortenToWords(cleanPhrase(li.title || ''), 7);
          li.points = (li.points || []).slice(0, 3).map((p: string) => cleanPhrase(p || ''));
        }

        // Ensure English-only (basic guard): if any CJK chars remain, replace with topic-based fallback
        if (containsCJK(li.title) || li.points.some((p: string) => containsCJK(p))) {
          li.title = shortenToWords(topic || 'Lesson', Math.max(2, Math.min(4, levelNum <= 2 ? 4 : 7)));
          // Friendly, generic short points
          li.points = ['Say "Hi"', 'Smile', 'Ask name'];
        }

        // Final cleanup: remove trailing punctuation
        li.title = li.title.replace(/[.?!]$/g, '');
        li.points = li.points.map((p: string) => p.replace(/[.?!]$/g, ''));

        result.lessonIssue = li;
      }

      if (!result.lessonGoalSteps) {
        throw new Error('Invalid response structure - missing lessonGoalSteps');
      }

      // Enforce the house-standard opening: goal first, then situation.
      if (result.lessonGoalSteps && result.lessonGoalSteps.length >= 5) {
        result.lessonGoalSteps[0].instruction = "Introduce today's goal and check understanding.";
        result.lessonGoalSteps[0].script = `Our goal for today is: ${lessonGoal || topic}. Is it clear?`;
        result.lessonGoalSteps[1].instruction = 'Introduce the situation.';
        result.lessonGoalSteps[1].script = `Here's our situation. ${stripHtml(result.introTexts?.find((item: any) => item.language === 'en')?.text || topic)}`;
        result.lessonGoalSteps[2].script = null;
        // Step 4 keeps its generated question script
        result.lessonGoalSteps[4].script = "Thank you, let's go to the next part."; // Step 5: fixed script
      }

      return result;
    }

    // IMPROVE EXISTING MODE: Only update Step 4 question
    let prompt = baseInstructions || `Generate a SHORT, practical opening question about the lesson topic:
- Topic/Lesson Name: ${topic}
- Skill Level: ${skillLevel}
- Primary Skill: ${skill}
- Lesson Level: ${level || 'unknown'} (out of 10)
- Complexity: ${complexityDesc}

CRITICAL REQUIREMENTS:
- Question must be VERY SHORT (1 sentence, max 10-15 words)
- DO NOT mention "English" or "learning" in the question
- Focus on real-world application of the skill, not about learning the language
- Make it practical and relevant to student life
- Use simple vocabulary for ${complexityDesc} students
- NO emoji or special characters
- Direct and easy to understand
- Encourages student response

Example formats by level (focus on the skill, not "English"):
- Level 1-2: "When would you greet someone new?" (practical scenario)
- Level 5-6: "How do you greet people you meet?" (real-world application)
- Level 9-10: "What greeting would you use in different situations?" (contextual use)`;

    // Add lesson context
    prompt += `\n\nLesson Context:
- Topic/Lesson Name: ${topic}
- Skill Level: ${skillLevel}
- Primary Skill: ${skill}
- Lesson Level: ${level || 'unknown'} (on scale of 1-10)
- Target Complexity: ${complexityDesc}`;

    if (chapter) prompt += `\n- Chapter: ${chapter}`;
    if (lessonNumber) prompt += `\n- Lesson Number: ${lessonNumber}`;

    // Add custom instructions if provided
    if (customPrompt) {
      prompt += `\n\nAdditional instructions from user: ${customPrompt}`;
    }

    const response = await introductionGeneratorAgent.generate(prompt);
    const content = response.text;

    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || content).trim());

    const result = JSON.parse(jsonContent);

    // Validate the response has the question field
    if (!result.question) {
      throw new Error('Invalid response structure - missing question field');
    }

    // Return the structure expected by the frontend, with the question as script in Step 4
    // If we have current content, preserve it and only update the Step 4 script
    if (currentContent && currentContent.lessonGoalSteps && currentContent.lessonGoalSteps.length >= 4) {
      return {
        introTexts: currentContent.introTexts || [],
        lessonIssue: currentContent.lessonIssue || { title: '', points: [] },
        lessonGoalDuration: currentContent.lessonGoalDuration || '1 minute',
        lessonGoalSteps: currentContent.lessonGoalSteps.map((step: any, index: number) => 
          index === 3 // Step 4 is at index 3 (0-indexed)
            ? { ...step, script: result.question }
            : step
        ),
      };
    }

    // If no current content, create a minimal structure with the question as script in Step 4
    return {
      introTexts: [],
      lessonIssue: { title: '', points: [] },
      lessonGoalDuration: '1 minute',
      lessonGoalSteps: [
        { instruction: 'Introduce the lesson topic.', script: null, question: null },
        { instruction: 'Read the lesson goal and ask if it\'s clear.', script: null, question: null },
        { instruction: 'Read the Introduce explanation.', script: null, question: null },
        { instruction: 'Ask the question below.', script: result.question, question: null },
        { instruction: 'Transition to the next section.', script: null, question: null },
      ],
    };
  } catch (error) {
    console.error('Failed to generate introduction content:', error);
    throw error;
  }
};

// ============================================================================
// EPISODE SUMMARY AGENT
// ============================================================================

const episodeSummaryAgent = createAgent({
  name: "Episode Summary Generator",
  instructions: `You are a K-drama story writer creating summaries for an immersive language learning experience.
Given story context and mission content from a lesson, create:
1. A CURRENT EPISODE SUMMARY: What happened in this episode (2-3 sentences, past tense, engaging)
2. A NEXT EPISODE HOOK: A teaser for what might happen next (1-2 sentences, intriguing, cliffhanger-style)

The summary should:
- Focus on character interactions and emotional moments
- Reference the actual content from the mission scenarios
- Maintain the K-drama storytelling style
- Be concise but evocative

Return ONLY valid JSON:
{
  "currentEpisodeSummary": "...",
  "nextEpisodeHook": "..."
}`,
  model: "openai/gpt-4.1-mini",
});

// ============================================================================
// GENERATE EPISODE SUMMARY
// ============================================================================

export interface EpisodeSummaryResult {
  currentEpisodeSummary: string;
  nextEpisodeHook: string;
}

export const generateEpisodeSummary = async (
  storyData: {
    storyTitle: string;
    characters: Array<{ name: string; role: string; description: string }>;
    setting: string;
    previousSummary: string;
    currentPlotPoints: string[];
  },
  missionContent: {
    situation: string;
    instruction: string;
    questions?: Array<{ question: string }>;
    topics?: Array<{ title: string; questions: string[] }>;
  },
  lessonTopic: string
): Promise<EpisodeSummaryResult> => {
  try {
    const characterList = storyData.characters
      .map(c => `- ${c.name} (${c.role}): ${c.description}`)
      .join('\n');

    const plotPoints = storyData.currentPlotPoints
      .map((p, i) => `${i + 1}. ${p}`)
      .join('\n');

    const questionsContext = missionContent.questions
      ? missionContent.questions.map(q => `- ${q.question}`).join('\n')
      : missionContent.topics
        ? missionContent.topics.map(t => `${t.title}: ${t.questions.join(', ')}`).join('\n')
        : 'General practice scenarios';

    const prompt = `Create an episode summary for this K-drama style language lesson:

EPISODE TITLE: "${storyData.storyTitle}"
SETTING: ${storyData.setting}
LESSON TOPIC: ${lessonTopic}

CHARACTERS:
${characterList || 'Various characters in typical daily scenarios'}

PREVIOUS EPISODE:
${storyData.previousSummary || 'This is the beginning of the story.'}

PLOT POINTS FOR THIS EPISODE:
${plotPoints || 'General interaction around the lesson topic'}

MISSION SCENARIO:
Situation: ${missionContent.situation || 'Practice scenario'}
Student Task: ${missionContent.instruction || 'Complete the roleplay'}

PRACTICE CONTENT:
${questionsContext}

Now write:
1. A summary of what happened in THIS episode (2-3 sentences)
2. A hook/teaser for the NEXT episode (1-2 sentences)

Make it dramatic and engaging like a K-drama recap!`;

    const response = await episodeSummaryAgent.generate(prompt);
    const text = response.text || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonContent = sanitizeAIText(jsonMatch ? jsonMatch[0] : text);

    let result: EpisodeSummaryResult = {
      currentEpisodeSummary: '',
      nextEpisodeHook: '',
    };

    try {
      const parsed = JSON.parse(jsonContent);
      result.currentEpisodeSummary = parsed.currentEpisodeSummary || '';
      result.nextEpisodeHook = parsed.nextEpisodeHook || '';
    } catch (e) {
      console.error('Failed to parse episode summary response:', text);
      // Fallback - try to extract content
      result.currentEpisodeSummary = `In this episode, the student practiced ${lessonTopic} scenarios in ${storyData.setting || 'various settings'}.`;
      result.nextEpisodeHook = 'What new adventures await in the next lesson?';
    }

    return result;
  } catch (error) {
    console.error('Failed to generate episode summary:', error);
    throw error;
  }
};

// ============================================================================
// DISCUSSION QUESTIONS GENERATOR
// ============================================================================

const discussionQuestionsAgent = createAgent({
  name: 'Discussion Questions Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an expert ESL discussion facilitator and curriculum designer. You generate thoughtful, engaging discussion questions for English language students.

Your questions should:
- Be open-ended (not yes/no answers)
- Encourage students to share opinions, experiences, and ideas
- Be culturally inclusive and appropriate
- Progress from simpler to more complex within a set
- Use vocabulary appropriate for the student's level
- Be relevant to the given topic
- Make students want to talk and share

Always respond ONLY with valid JSON. No markdown, no explanations.`,
});

export interface GenerateDiscussionQuestionsResult {
  questions: string[];
}

/**
 * Generate discussion questions based on level, topic, and count.
 */
export const generateDiscussionQuestions = async (
  topic: string,
  level: number,
  questionCount: number,
  customPrompt?: string | null,
): Promise<GenerateDiscussionQuestionsResult> => {
  const complexityMap: Record<number, string> = {
    1: 'Starter/Beginner - Use simple vocabulary and short sentence structures. Questions should be very accessible, about personal experience ("What is your favorite...?", "Do you like...? Why?").',
    2: 'Elementary - Simple but slightly more varied questions. Students can handle basic comparisons and preferences.',
    3: 'Pre-Intermediate - Students can discuss opinions and reasons. Use moderate vocabulary. Ask "why" and "how" questions.',
    4: 'Intermediate - Students can discuss abstract topics, hypotheticals, and express nuanced opinions. More complex sentence structures are fine.',
    5: 'Upper-Intermediate/Advanced - Students can debate, analyze, and discuss complex social/philosophical topics. Use sophisticated vocabulary and multi-layered questions.',
  };

  const complexityDesc = complexityMap[level] || complexityMap[3];
  const count = Math.max(5, Math.min(30, questionCount));

  let prompt = `Generate exactly ${count} discussion questions for an ESL class.

=== CONTEXT ===
Topic: "${topic}"
Level: ${level} - ${complexityDesc}

=== REQUIREMENTS ===
1. Generate exactly ${count} questions.
2. All questions must be open-ended (no yes/no answers).
3. Questions should feel natural and conversational.
4. Progress from easier to harder within the set.
5. First 2-3 questions should be "warm-up" style (personal, easy to answer).
6. Middle questions should go deeper into the topic.
7. Last 2-3 questions should be thought-provoking or hypothetical.
8. Match vocabulary and complexity to Level ${level}.

=== EXAMPLES OF GOOD QUESTIONS (Level 1) ===
- "What is your favorite food? Why do you like it?"
- "What do you usually do on weekends?"

=== EXAMPLES OF GOOD QUESTIONS (Level 5) ===
- "To what extent do you think social media has altered the way we form meaningful relationships?"
- "If you could redesign the education system from scratch, what would you change and why?"

Return ONLY JSON:
{ "questions": ["Question 1?", "Question 2?", ...] }`;

  if (customPrompt) {
    prompt += `\n\nAdditional instructions from the editor: ${customPrompt}`;
  }

  const resp = await discussionQuestionsAgent.generate(prompt);
  const text = resp.text || '';
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());

  let parsed: any = { questions: [] };
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e) {
    console.error('Failed to parse discussion questions response:', text);
    // Fallback: try to extract lines that look like questions
    const lines = text.split(/\n+/).map((l: string) => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter((l: string) => l.endsWith('?'));
    parsed.questions = lines.slice(0, count);
  }

  const questions = (parsed.questions || []).slice(0, count).map((q: any) => (q || '').toString().trim());

  return { questions };
};

// ============================================================================
// AI UNIQUENESS VALIDATOR
// Checks generated content against existing items for semantic similarity
// ============================================================================

const uniquenessValidatorAgent = createAgent({
  name: 'Uniqueness Validator',
  model: 'openai/gpt-5.2',
  instructions: `You are a strict uniqueness checker for an ESL curriculum.

Your ONLY job is to compare a set of NEWLY GENERATED items against a set of EXISTING items and detect semantic duplicates or near-duplicates.

Two items are considered "too similar" if they:
- Mean essentially the same thing (e.g., "Greetings" vs "Saying Hello")
- Cover the same conversational scenario (e.g., "At the Restaurant" vs "Dining Out")  
- Are minor rephrases of each other (e.g., "Making Friends" vs "Befriending People")
- Share the same core concept with trivial word changes (e.g., "Daily Routine" vs "Everyday Routines")

Two items are considered "unique enough" if they:
- Cover genuinely different topics or angles
- Would lead to meaningfully different conversations
- Address distinct skills or scenarios

Respond ONLY in this JSON format:
{
  "hasDuplicates": true/false,
  "duplicates": [
    {
      "newItem": "the generated item that is too similar",
      "existingItem": "the existing item it overlaps with",
      "reason": "brief explanation of why they're too similar"
    }
  ]
}

If no duplicates found, return: { "hasDuplicates": false, "duplicates": [] }
Be strict — when in doubt, flag it as a duplicate. Quality over quantity.`,
});

/**
 * Validate generated items against existing for semantic uniqueness.
 * Returns { valid: true } if all unique, or { valid: false, duplicates: [...] } if not.
 */
async function validateUniqueness(
  newItems: string[],
  existingItems: string[],
  itemType: string
): Promise<{ valid: boolean; duplicates: Array<{ newItem: string; existingItem: string; reason: string }> }> {
  if (existingItems.length === 0) return { valid: true, duplicates: [] };

  const prompt = `Check these NEWLY GENERATED ${itemType} for semantic duplicates against the EXISTING ones.

NEWLY GENERATED:
${newItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}

EXISTING (must not overlap with):
${existingItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Are any of the new items too similar to any existing items?`;

  try {
    const response = await uniquenessValidatorAgent.generate(prompt);
    const text = response.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    const parsed = JSON.parse(jsonContent);

    return {
      valid: !parsed.hasDuplicates,
      duplicates: parsed.duplicates || [],
    };
  } catch (e) {
    console.warn('Uniqueness validation failed, allowing through:', e);
    return { valid: true, duplicates: [] };
  }
}

// ============================================================================
// AI AGENT FOR COURSE STRUCTURE GENERATION
// (Level topic → Chapter themes & names)
// ============================================================================

export interface CourseStructureResult {
  mainTopic: string;
  chapters: Array<{
    chapter: number;
    theme: string;
    name: string;
  }>;
}

const courseStructureAgent = createAgent({
  name: 'Course Structure Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an expert ESL curriculum architect specializing in conversational English programs.

Your job is to design the STRUCTURE of a level within a conversational skills course. Given a level number (1-10) and its proficiency tier, generate:
1. A Main Topic for the level (the overarching theme)
2. Chapter themes and names for all chapters in that level

PROFICIENCY TIERS:
- Level 1-2: STARTER - Very basic, survival English. Topics like greetings, self-introduction, numbers, daily routines
- Level 3-4: BEGINNER - Basic social English. Topics like family, hobbies, food, directions, shopping
- Level 5-6: ELEMENTARY - Functional English. Topics like travel, health, work, opinions, making plans
- Level 7-8: INTERMEDIATE - Expressive English. Topics like culture, news, relationships, debates, storytelling
- Level 9-10: ADVANCED - Sophisticated English. Topics like philosophy, business negotiation, humor, abstract concepts

DESIGN PRINCIPLES:
- The Main Topic should be broad enough to support multiple chapters but specific enough to feel cohesive
- Main Topics must sound NATURAL and SIMPLE — like something a normal person would say, not an academic title
  BAD: "Everyday Survival Chats", "Foundational Social Interactions", "Interpersonal Communication Dynamics"
  GOOD: "Meeting People", "Life at Home", "Fun and Free Time", "Getting Around Town", "Work and Career"
- Chapter Themes are sub-categories under the main topic - they define the focus area
- Chapter Names are catchy, memorable titles for each chapter - student-facing labels
- Chapter Names must also sound natural and easy to understand — write them like a friendly teacher would
  BAD: "Navigating Social Protocols", "Culinary Discourse", "Temporal Expressions"
  GOOD: "Nice to Meet You", "Let's Eat", "What Time Is It?"
- Each chapter should build on the previous one in complexity or expand to related territory
- Content MUST be conversation-worthy - things people actually talk about in real life
- Themes should be practical, engaging, and culturally inclusive
- Avoid overly academic, stiff, or unnatural-sounding language - keep everything simple and relatable
- Use plain everyday English that a student would immediately understand
- NEVER include topics about spelling, alphabet, phonics, writing, reading aloud, pronunciation drills, or any literacy-focused content. This is a CONVERSATION skills course — everything must be about things people TALK about, not about the mechanics of language itself.
  BAD themes/names: "My Name and Spelling", "Spell It Out", "Letters and Sounds", "Reading Practice", "Writing Names"
  GOOD themes/names: "All About Me", "Nice to Meet You", "My Favorite Things", "Weekend Plans"

CRITICAL RULES:
- Level 1 ALWAYS has exactly 1 chapter
- Levels 2-10 have exactly 5 chapters
- Chapter themes MUST be exactly ONE word (e.g., "Greetings", "Family", "Travel", "Negotiation"). Never multi-word themes.
- Chapter names should be short (2-5 words), catchy, and memorable
- Main topic should be a complete, polished phrase (2-6 words)
- NEVER use trailing ellipsis (...) in any name, theme, or topic. Everything must be a complete, finished phrase.
  BAD: "Greetings...", "Making Friends...", "Daily Life and..."
  GOOD: "Greetings", "Making Friends", "Daily Life Essentials"
- NEVER use emoji
- All names must feel polished and final, not truncated or cut off

If the user provides an existing main topic, build the chapters around that topic. If they provide some chapter info already, work around what exists.

Respond ONLY in this JSON format:
{
  "mainTopic": "The overarching topic for this level",
  "chapters": [
    { "chapter": 1, "theme": "OneWord", "name": "Catchy Chapter Name" },
    { "chapter": 2, "theme": "OneWord", "name": "Catchy Chapter Name" }
  ]
}`,
});

/**
 * Generate course structure (level topic + chapter themes/names)
 */
export const generateCourseStructure = async (
  level: number,
  existingTopic?: string | null,
  existingChapters?: Array<{ chapter: number; theme?: string; name?: string }> | null,
  customPrompt?: string | null
): Promise<CourseStructureResult> => {
  const tiers: Record<number, string> = {
    1: 'STARTER', 2: 'STARTER', 3: 'BEGINNER', 4: 'BEGINNER',
    5: 'ELEMENTARY', 6: 'ELEMENTARY', 7: 'INTERMEDIATE', 8: 'INTERMEDIATE',
    9: 'ADVANCED', 10: 'ADVANCED',
  };

  const chapterCount = level === 1 ? 1 : 5;

  // Fetch all existing structure from DB for uniqueness checking
  let existingStructureContext = '';
  let existingTopicsList: string[] = [];
  let existingThemesList: string[] = [];
  let existingNamesList: string[] = [];
  try {
    const course = 'conversational-skills';
    const meta = await lessonMaterialService.getCourseMetadata(course);
    const otherLevels = Object.entries(meta.levels)
      .filter(([lvl]) => Number(lvl) !== level)
      .map(([lvl, data]) => `Level ${lvl}: "${data.mainTopic}"`);
    existingTopicsList = Object.entries(meta.levels)
      .filter(([lvl]) => Number(lvl) !== level && meta.levels[Number(lvl)]?.mainTopic)
      .map(([, data]) => data.mainTopic);
    const otherChapters = Object.entries(meta.chapters)
      .filter(([key]) => !key.startsWith(`${level}-`))
      .map(([key, data]) => {
        const [lvl, ch] = key.split('-');
        return `Level ${lvl} Ch${ch}: Theme="${data.theme}", Name="${data.name}"`;
      });
    existingThemesList = Object.entries(meta.chapters)
      .filter(([key]) => !key.startsWith(`${level}-`) && meta.chapters[key]?.theme)
      .map(([, data]) => data.theme);
    existingNamesList = Object.entries(meta.chapters)
      .filter(([key]) => !key.startsWith(`${level}-`) && meta.chapters[key]?.name)
      .map(([, data]) => data.name);
    const thisLevelChapters = Object.entries(meta.chapters)
      .filter(([key]) => key.startsWith(`${level}-`))
      .map(([key, data]) => {
        const ch = key.split('-')[1];
        return `Chapter ${ch}: Theme="${data.theme}", Name="${data.name}"`;
      });

    if (otherLevels.length > 0 || otherChapters.length > 0) {
      existingStructureContext = '\n\n⚠️ UNIQUENESS REQUIREMENT — The following topics, themes, and names ALREADY EXIST in other levels. You MUST NOT duplicate or closely paraphrase any of them. Generate something distinctly different.';
      if (otherLevels.length > 0) {
        existingStructureContext += `\n\nExisting level topics (DO NOT reuse):\n${otherLevels.join('\n')}`;
      }
      if (otherChapters.length > 0) {
        existingStructureContext += `\n\nExisting chapter themes & names in other levels (DO NOT reuse):\n${otherChapters.join('\n')}`;
      }
    }
    if (thisLevelChapters.length > 0) {
      existingStructureContext += `\n\nThis level already has these chapters set:\n${thisLevelChapters.join('\n')}`;
    }
  } catch (e) {
    console.warn('Could not fetch existing structure for uniqueness check:', e);
  }

  let prompt = `Generate the structure for Level ${level} (${tiers[level]}) of a Conversational Skills course.\nThis level should have exactly ${chapterCount} chapter(s).${existingStructureContext}`;

  if (existingTopic) {
    prompt += `\n\nThe level's main topic has already been set to: "${existingTopic}". Build the chapters around this topic.`;
  }

  if (existingChapters && existingChapters.length > 0) {
    const existing = existingChapters
      .filter(c => c.theme || c.name)
      .map(c => `Chapter ${c.chapter}: Theme="${c.theme || '(not set)'}", Name="${c.name || '(not set)'}"`)
      .join('\n');
    if (existing) {
      prompt += `\n\nSome chapters already have content. Keep those and fill in the rest:\n${existing}`;
    }
  }

  if (customPrompt) {
    prompt += `\n\nAdditional instructions: ${customPrompt}`;
  }

  try {
    const MAX_RETRIES = 3;
    const allExistingItems = [...existingTopicsList, ...existingThemesList, ...existingNamesList];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const currentPrompt = attempt > 1
        ? prompt + `\n\n⚠️ RETRY ATTEMPT ${attempt}: Your previous generation contained items too similar to existing ones. Generate COMPLETELY DIFFERENT topics, themes, and names this time.`
        : prompt;

      const response = await courseStructureAgent.generate(currentPrompt);
      const text = response.text || '';
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());

      const parsed = JSON.parse(jsonContent);

      const result: CourseStructureResult = {
        mainTopic: parsed.mainTopic || existingTopic || '',
        chapters: (parsed.chapters || []).slice(0, chapterCount).map((ch: any, i: number) => ({
          chapter: ch.chapter || i + 1,
          theme: ch.theme || '',
          name: ch.name || '',
        })),
      };

      // Validate uniqueness if there are existing items to check against
      if (allExistingItems.length > 0) {
        const newItems = [
          result.mainTopic,
          ...result.chapters.map(ch => ch.theme),
          ...result.chapters.map(ch => ch.name),
        ].filter(Boolean);

        const validation = await validateUniqueness(newItems, allExistingItems, 'course structure items (level topics, chapter themes, chapter names)');

        if (!validation.valid) {
          console.warn(`Course structure attempt ${attempt}/${MAX_RETRIES} has duplicates:`, validation.duplicates);
          if (attempt < MAX_RETRIES) continue; // retry
          // On last attempt, log but return anyway
          console.warn('Max retries reached — returning result despite potential duplicates');
        }
      }

      return result;
    }

    // Fallback (should not reach here)
    throw new Error('Failed to generate unique course structure after max retries');
  } catch (error) {
    console.error('Failed to generate course structure:', error);
    throw error;
  }
};

// ============================================================================
// AI AGENT FOR LESSON STRUCTURE GENERATION
// (Chapter theme/name -> Lesson names & goals)
// ============================================================================

export interface LessonStructureResult {
  lessons: Array<{
    lessonNumber: number;
    lessonName: string;
    goalTextEn: string;
    goalTextJp: string;
  }>;
}

const lessonStructureAgent = createAgent({
  name: 'Lesson Structure Generator',
  model: 'openai/gpt-5.2',
  instructions: `You are an expert ESL lesson planner specializing in conversational English courses.

Your job is to generate lesson names and goals for all lessons in a chapter. The exact lesson count and course format will be specified in the prompt, and you must follow that format exactly.

Given a level, chapter theme, and chapter name, generate lessons that:
1. Progress logically from simple to complex within the chapter theme
2. Cover different angles/sub-topics of the chapter theme
3. Have conversation-worthy content - things people actually discuss in real life
4. Build from the level topic and chapter theme naturally

LESSON NAMING RULES:
- Lesson names should be short (1-4 words), clear, and descriptive
- They should indicate what the lesson teaches (e.g., "First Impressions", "Asking for Help", "Making Plans")
- Avoid generic names like "Lesson 1", "Practice", "Review"
- Names must sound NATURAL and SIMPLE — like how a normal person would describe the topic, not academic or stiff
  BAD: "Interpersonal Introductions", "Navigating Transactions", "Temporal Discourse"
  GOOD: "Saying Hello", "Buying Things", "What Time Is It?"
- NEVER use trailing ellipsis (...) in lesson names. Every name must be a complete, finished phrase.
- NEVER create lessons about spelling, alphabet, phonics, writing, reading aloud, or language mechanics. This is a CONVERSATION skills course — all lessons must be about topics people actually TALK about in real life.
  BAD: "Spell Your Name", "Letters and Sounds", "Reading Out Loud", "Writing Practice"
  GOOD: "Saying Hello", "My Family", "What Do You Like?", "Weekend Fun"
- All names must feel polished, natural, and easy to understand at a glance
- Use plain everyday English

GOAL RULES:
- English goals should start with "I can" and describe what the student will be able to do
- Japanese goals should be the equivalent in Japanese
- Goals should be specific and measurable (e.g., "I can introduce myself and ask someone's name" not "I can do greetings")
- Keep goals concise (max 15 words)
- Goals should be achievable within a single lesson
- NEVER use trailing ellipsis (...) in goals. Every goal must be a complete sentence.

PROFICIENCY MAPPING:
- Level 1-2 (STARTER): Very simple goals - basic phrases, single exchanges
- Level 3-4 (BEGINNER): Simple goals - short conversations, common situations
- Level 5-6 (ELEMENTARY): Moderate goals - functional conversations, opinions
- Level 7-8 (INTERMEDIATE): Complex goals - nuanced discussions, storytelling
- Level 9-10 (ADVANCED): Sophisticated goals - debates, persuasion, abstract ideas

Respond ONLY in this JSON format:
{
  "lessons": [
    {
      "lessonNumber": 1,
      "lessonName": "Short Name",
      "goalTextEn": "I can do something specific.",
      "goalTextJp": "Equivalent Japanese goal."
    }
  ]
}

Generate exactly the number of lessons requested in the prompt.`,
});

/**
 * Generate lesson names and goals for a chapter
 */
export const generateLessonStructure = async (
  level: number,
  chapter: number,
  levelTopic: string,
  chapterTheme: string,
  chapterName: string,
  customPrompt?: string | null,
  course?: string | null
): Promise<LessonStructureResult> => {
  const tiers: Record<number, string> = {
    1: 'STARTER', 2: 'STARTER', 3: 'BEGINNER', 4: 'BEGINNER',
    5: 'ELEMENTARY', 6: 'ELEMENTARY', 7: 'INTERMEDIATE', 8: 'INTERMEDIATE',
    9: 'ADVANCED', 10: 'ADVANCED',
  };
  const normalizedCourse = course || 'conversational-skills';
  const isBusinessEnglish = normalizedCourse === 'business-english';
  const targetLessonCount = isBusinessEnglish ? 5 : 10;

  // Fetch all existing lesson names from DB for uniqueness checking
  let existingLessonsContext = '';
  let existingLessonNamesList: string[] = [];
  try {
    const allLessons = await lessonMaterialService.listByCourse(normalizedCourse);
    // Collect unique lesson names from other chapters (deduplicate across skills)
    const otherLessonNames = [...new Set(
      allLessons
        .filter(l => !(l.level === level && l.chapter === chapter))
        .map(l => `Level ${l.level} Ch${l.chapter}: "${l.lessonName}"`)
    )];
    existingLessonNamesList = [...new Set(
      allLessons
        .filter(l => !(l.level === level && l.chapter === chapter))
        .map(l => l.lessonName)
    )];
    // Also collect lesson names in THIS chapter (to avoid duplicating within)
    const thisChapterNames = [...new Set(
      allLessons
        .filter(l => l.level === level && l.chapter === chapter)
        .map(l => l.lessonName)
    )];
    existingLessonNamesList.push(...thisChapterNames);

    if (otherLessonNames.length > 0) {
      existingLessonsContext = `\n\n⚠️ UNIQUENESS REQUIREMENT — The following lesson names ALREADY EXIST in other chapters. You MUST NOT duplicate or closely paraphrase any of them. Generate distinctly different lesson names.\n\nExisting lesson names (DO NOT reuse):\n${otherLessonNames.join('\n')}`;
    }
    if (thisChapterNames.length > 0) {
      existingLessonsContext += `\n\nThis chapter already has these lessons (avoid duplicating): ${thisChapterNames.join(', ')}`;
    }
  } catch (e) {
    console.warn('Could not fetch existing lessons for uniqueness check:', e);
  }

  let prompt = `Generate exactly ${targetLessonCount} lesson names and goals for:
- Level ${level} (${tiers[level]})
- Level Main Topic: "${levelTopic}"
- Chapter ${chapter}: Theme = "${chapterTheme}", Name = "${chapterName}"

The lessons should progressively explore different facets of "${chapterTheme}" under the umbrella of "${levelTopic}". All content must be conversation-worthy and appropriate for ${tiers[level]} level students.${existingLessonsContext}`;

  if (isBusinessEnglish) {
    prompt += `

This is for the Business English course. Each chapter has exactly 5 lessons in this fixed order:
1. Listening
2. Reading
3. Speaking
4. Speaking
5. Review

Generate exactly 5 lessons numbered 1 to 5 only.
- Lesson 1 should fit a listening lesson.
- Lesson 2 should fit a reading lesson.
- Lesson 3 should fit a guided speaking lesson.
- Lesson 4 should fit a freer speaking lesson.
- Lesson 5 should clearly work as a review and consolidation of Lessons 1 to 4.
- Do not generate Lesson 6 or beyond.
- Keep the progression practical for workplace English.`;
  }

  if (customPrompt) {
    prompt += `\n\nAdditional instructions: ${customPrompt}`;
  }

  try {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const currentPrompt = attempt > 1
        ? prompt + `\n\n⚠️ RETRY ATTEMPT ${attempt}: Your previous generation contained lesson names too similar to existing ones. Generate COMPLETELY DIFFERENT lesson names and goals this time.`
        : prompt;

      const response = await lessonStructureAgent.generate(currentPrompt);
      const text = response.text || '';
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());

      const parsed = JSON.parse(jsonContent);

      const result: LessonStructureResult = {
        lessons: (parsed.lessons || []).slice(0, targetLessonCount).map((l: any, i: number) => ({
          lessonNumber: l.lessonNumber || i + 1,
          lessonName: l.lessonName || '',
          goalTextEn: l.goalTextEn || '',
          goalTextJp: l.goalTextJp || '',
        })),
      };

      // Validate uniqueness if there are existing lesson names to check against
      if (existingLessonNamesList.length > 0) {
        const newLessonNames = result.lessons.map(l => l.lessonName).filter(Boolean);
        const validation = await validateUniqueness(newLessonNames, existingLessonNamesList, 'lesson names');

        if (!validation.valid) {
          console.warn(`Lesson structure attempt ${attempt}/${MAX_RETRIES} has duplicates:`, validation.duplicates);
          if (attempt < MAX_RETRIES) continue; // retry
          console.warn('Max retries reached — returning result despite potential duplicates');
        }
      }

      return result;
    }

    throw new Error('Failed to generate unique lesson structure after max retries');
  } catch (error) {
    console.error('Failed to generate lesson structure:', error);
    throw error;
  }
};

// ============================================================================
// BUSINESS ENGLISH (PCPP) AI CONTENT GENERATOR
// ============================================================================

/**
 * Business English Agent — generates section content for the PCPP lesson format.
 * Covers: Introduce, Present, Understand, Practice, Challenge, Discussion, Feedback.
 */
const businessEnglishAgent = createAgent({
  name: "Business English Content Generator",
  model: "openai/gpt-5.2",
  instructions: `You are an expert Business English lesson designer for the FluentXVerse PCPP method.

COURSE OVERVIEW:
- Business Conversation is a PREMIUM course for certified tutors.
- PCPP = Present, Comprehend, Practice, Produce (Levels 3-9). Level 10 uses Task-Based.
- Lessons are 25 minutes. Focus: Output and Production.
- All content is bilingual: English + Korean translations.

TOEIC LEVEL MAPPING:
- Level 3 (Beginner): TOEIC 10-220. Simple vocabulary, short sentences. Listening/Speaking/Reading only.
- Level 4-5 (High Beginner): TOEIC 225-545. Building confidence. Listening/Speaking/Reading.
- Level 6-7 (Intermediate): TOEIC 550-780. More complex structures, business idioms. +Writing skill.
- Level 8-9 (High Intermediate): TOEIC 785-940. Sophisticated language, nuanced expression. +Writing skill.
- Level 10 (Advanced): TOEIC 945+. Task-Based approach. Full autonomy.

PCPP SECTION STRUCTURE:
1. INTRODUCE: Lesson goal (EN+KR), Situation (EN+KR), Task description
2. PRESENT: Useful Patterns (EN+KR pairs), Vocabulary (word, pos, translation, definition, pronunciation), Pronunciation drills
3. UNDERSTAND: Comprehension instruction, fill-in-the-blank exercises from patterns
4. PRACTICE: 4 progressive steps - Repeat, Fill Blanks, Dialogue (with roleplay), Complete Dialogue
5. CHALLENGE: Real-life simulation scenario with inline question notes and a roleplay table
   - IMPORTANT: Tutor Notes for CHALLENGE must be a concise step-by-step playbook the tutor can follow without improvising.
   - Tutor Notes must follow the "Teaching Notes" standard: a sequence of short notes where:
     - SCRIPT = exact words the tutor says out loud (MUST be wrapped in quotes)
     - INSTRUCTION = what the tutor should do (NO dialogue)
     - QUESTION = a prompt question the tutor asks during the simulation
     - TIP = reminders / best practices
   - Interleave SCRIPT and INSTRUCTION notes (script, instruction, script, instruction...). Avoid long paragraphs: split into multiple notes.
   - Put prompt questions inside tutorNotes as QUESTION notes so they can be reordered with the rest of the teaching notes.
   - Cover: starting the challenge, setting roles/context, opening the roleplay, guiding with questions, closing, and giving feedback after finishing.
6. DISCUSSION: Category-based discussion questions (3 categories, 3 questions each)
7. FEEDBACK: Goal review, feedback template, next lesson teaser

CRITICAL RULES:
- NEVER use emoji or special symbols in content
- Do not use em dashes or en dashes. Use a normal hyphen '-' or a period instead.
- All Korean translations must be natural, not machine-translated
- Patterns should be practical business expressions students can use immediately
- Vocabulary must include: word, part of speech, Korean translation, English definition, pronunciation guide
- Practice dialogues must feel like real workplace conversations
- Challenge scenarios must be realistic business situations
- Use English names only (e.g., Alex, Emma, David). Avoid Korean/Japanese/Vietnamese names.
- For CHALLENGE tutorNotes: provide a concise scripted flow (not hints). Use 6-10 notes total, mostly SCRIPT + INSTRUCTION, with 2-4 QUESTION notes inline and 1 TIP reminding corrections happen only after the simulation. Each note should be one short sentence.
- Discussion questions should encourage students to share personal work experiences
- Always return ONLY valid JSON — no markdown, no code fences, no explanation text`,
});

export interface BEGenerationResult {
  introduce?: {
    goalEn: string; goalKr: string;
    situationEn: string; situationKr: string;
    taskEn: string; taskKr: string;
    tutorNotes: Array<{ type: string; text: string }>;
  };
  present?: {
    patterns: Array<{ en: string; kr: string }>;
    vocabulary: Array<{ word: string; pos: string; translation: string; definition: string; pronunciation: string }>;
    pronunciation: {
      instruction: string; instructionKr: string;
      left: { symbol: string; words: Array<{ en: string; kr: string }> };
      right: { symbol: string; words: Array<{ en: string; kr: string }> };
    };
    tutorNotes: Array<{ type: string; text: string }>;
  };
  understand?: {
    instruction: string; instructionKr: string;
    patternDrills: Array<{ label: string; labelKr: string; template: string; examples: Array<{ en: string; kr: string }> }>;
    fillRows: Array<{ parts: Array<{ text: string; isBlank: boolean }> }>;
    tutorNotes: Array<{ type: string; text: string }>;
  };
  practice?: {
    steps: Array<{
      title: string; instructionEn: string; instructionKr: string;
      content: string; dialogue?: Array<{ role: string; en: string; kr: string }>;
      tutorNotes: Array<{ type: string; text: string }>;
    }>;
  };
  challenge?: {
    scenarioEn: string; scenarioKr: string;
    guideQuestions: Array<{ text: string }>;
    roleplayTable?: { you: string; coworkers: string[] };
    activityBlocks?: any[];
    tutorNotes: Array<{ type: string; text: string }>;
  };
  discussion?: {
    instructionEn: string; instructionKr: string;
    categories: Array<{ title: string; questions: string[] }>;
    tutorNotes: Array<{ type: string; text: string }>;
  };
  feedback?: {
    goalReviewEn: string; goalReviewKr: string;
    feedbackTemplate: string;
    nextLessonLabel: string; nextLessonName: string;
    tutorNotes: Array<{ type: string; text: string }>;
  };
}

type BESectionType = 'introduce' | 'present' | 'understand' | 'practice' | 'challenge' | 'discussion' | 'feedback';

/**
 * Generate content for a specific section of a Business English PCPP lesson.
 */
export const generateBusinessEnglishContent = async (
  section: BESectionType,
  level: number,
  chapter: number,
  lessonNumber: number,
  lessonName: string,
  goalTextEn: string,
  goalTextJp: string,
  chapterName: string,
  customPrompt?: string | null,
  currentContent?: any | null,
  generationMode?: 'new' | 'improve' | null,
  currentPresentData?: {
    patterns?: Array<{ en: string; kr?: string; jp?: string }>;
    vocabulary?: Array<{ word: string; pos: string; translation: string }>;
  } | null,
): Promise<BEGenerationResult> => {
  const variationSeed = `BE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const skillType = getBusinessEnglishLessonSkill(lessonNumber);
  const referenceContext = await buildBusinessEnglishReferenceContext(level, chapter, lessonNumber);

  const getToeicRange = (lvl: number): string => {
    if (lvl <= 3) return 'TOEIC 10-220 (Beginner)';
    if (lvl <= 5) return 'TOEIC 225-545 (High Beginner)';
    if (lvl <= 7) return 'TOEIC 550-780 (Intermediate)';
    if (lvl <= 9) return 'TOEIC 785-940 (High Intermediate)';
    return 'TOEIC 945+ (Advanced)';
  };

  const getComplexityDesc = (lvl: number): string => {
    if (lvl <= 3) return 'Simple vocabulary, short sentences. Basic workplace greetings and introductions.';
    if (lvl <= 5) return 'Building confidence. Common business phrases and simple discussions.';
    if (lvl <= 7) return 'Intermediate complexity. Business idioms, meetings, presentations.';
    if (lvl <= 9) return 'Sophisticated language. Negotiation, persuasion, nuanced expression.';
    return 'Advanced task-based. Full autonomy in complex business scenarios.';
  };

  const toeicRange = getToeicRange(level);
  const complexityDesc = getComplexityDesc(level);

  const lessonContext = `[Variation ID: ${variationSeed}]
=== LESSON CONTEXT ===
Course: Business English (PCPP Method)
Level: ${level} - ${toeicRange}
Complexity: ${complexityDesc}
Chapter ${chapter}: ${chapterName}
Lesson ${lessonNumber}: ${lessonName}
Lesson Goal (EN): ${goalTextEn}
Lesson Goal (KR): ${goalTextJp}
${referenceContext}`;

  // Build cross-section cohesion context from Present data
  const buildPresentContext = (): string => {
    if (!currentPresentData) return '';
    const parts: string[] = [];
    if (currentPresentData.patterns?.length) {
      parts.push('PATTERNS already taught:\n' + currentPresentData.patterns.map(p => `  - "${p.en}" (${p.kr || p.jp || ''})`).join('\n'));
    }
    if (currentPresentData.vocabulary?.length) {
      parts.push('VOCABULARY already taught:\n' + currentPresentData.vocabulary.map(v => `  - ${v.word} (${v.pos}) - ${v.translation}`).join('\n'));
    }
    if (parts.length === 0) return '';
    return `\n\n=== CROSS-SECTION COHESION ===\nThe student has already learned the following in the PRESENT section. Use these naturally in your generated content.\n${parts.join('\n\n')}`;
  };

  const presentContext = buildPresentContext();

  // ===== INTRODUCE SECTION =====
  if (section === 'introduce') {
    const introNotesRule = level <= 3
      ? `LEVEL 3 TUTOR NOTES RULE:
- Match the concise Warm-Up teaching-note style used in standardized Lessons 1-3.
- Tutor only speaks English. Do NOT instruct reading Korean or Japanese.
- Use a short sequence of SCRIPT and INSTRUCTION notes. Listening lessons may include one TIP at the end.
- Do NOT include extra prompts like "Ask the student who they will introduce..." or "what the visitor needs to know."
- Each note should be one short sentence.`
      : `TUTOR NOTES RULE:
- Keep the notes concise and tutor-friendly.
- Tutor only speaks English. Do NOT instruct reading Korean or Japanese.
- Each note should be one short sentence.`;
    let prompt = `${lessonContext}

Generate the INTRODUCE section for this Business English lesson.

The warm-up must fit the lesson slot type and lead naturally into the lesson skill focus.

REQUIREMENTS:
1. goalEn & goalKr: The lesson goal. Use the provided goal or improve it to be more specific.
2. situationEn & situationKr: A realistic workplace scenario (2-3 sentences) that sets up the lesson context.
3. taskEn & taskKr: What the student needs to do in this situation (1-2 sentences).
4. tutorNotes: 4-6 tutor notes with types "instruction", "script", or "tip".
   - Scripts should be exact words the tutor says (in quotes).
   - Instructions tell the tutor what to do.
   - Tips are helpful reminders.
${introNotesRule}

The situation must feel like a real workplace event relevant to the lesson topic.

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content - keep what works, fix what doesn't:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "introduce": {
    "goalEn": "...", "goalKr": "...",
    "situationEn": "...", "situationKr": "...",
    "taskEn": "...", "taskKr": "...",
    "tutorNotes": [{ "type": "script|instruction|tip", "text": "..." }]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE introduce response:', text); }
    const intro = parsed.introduce || {};
    const normalizedIntroNotes = (intro.tutorNotes || []).map((n: any) => ({
      type: n.type || 'instruction',
      text: n.text || '',
    }));
    const introNotes = (() => {
      const disallowedInstruction = (note: any) => {
        if (note.type !== 'instruction') return false;
        const text = (note.text || '').toLowerCase();
        return text.includes('korean')
          || text.includes('japanese')
          || text.includes('한국어')
          || text.includes('일본어')
          || text.includes('who they will introduce')
          || text.includes('visitor needs')
          || (text.includes('visitor') && text.includes('ask the student'))
          || text.includes('model one simple example');
      };

      const containsKorean = (text: string) => /[가-힣]/.test(text || '');
      const filtered = normalizedIntroNotes.filter((n: any) => !disallowedInstruction(n) && !containsKorean(n.text || ''));
      const goalLine = intro.goalEn || goalTextEn;
      const situationLine = intro.situationEn || '';
      const standardizedNotes = getIntroduceStandardNotes(skillType, goalLine, situationLine);
      if (filtered.length === 0) {
        return standardizedNotes;
      }

      return standardizedNotes;
    })();
    return {
      introduce: {
        goalEn: intro.goalEn || goalTextEn,
        goalKr: intro.goalKr || intro.goalJp || goalTextJp,
        situationEn: intro.situationEn || '',
        situationKr: intro.situationKr || intro.situationJp || '',
        taskEn: intro.taskEn || '',
        taskKr: intro.taskKr || intro.taskJp || '',
        tutorNotes: introNotes,
      },
    };
  }

  // ===== PRESENT SECTION =====
  if (section === 'present') {
    const patternCount = currentContent?.patterns?.length || 3;
    const vocabCount = currentContent?.vocabulary?.length || 3;
    const perPatternNotes = patternCount * 3;
    const levelTutorNotesRule = level <= 3
      ? `LEVEL 3 TUTOR NOTES RULE (MUST FOLLOW):
- Use a concise flow like the reference:
  - Opening SCRIPT: "Let's look at patterns used in this lesson."
  - For EACH pattern: one INSTRUCTION (read pattern + ask repeat) + one SCRIPT (short usage).
  - Closing SCRIPT: "Do you have any questions about the patterns?" + "Let's go to the next page."
- Keep each note to one short sentence. No extra explanations.`
      : `For Levels 4+, keep tutorNotes concise (4-6 short notes) and include a brief usage explanation for each pattern.`;

    let prompt = `${lessonContext}

Generate the PRESENT section for this Business English lesson.

The patterns must fit the lesson slot type and must be different from earlier lessons in the same chapter.
Do not closely repeat earlier expressions, scenarios, or word-bank focus from the reference context above.

REQUIREMENTS:
1. patterns: Exactly ${patternCount} useful English patterns with Korean translations.
   - These are KEY EXPRESSIONS students will use throughout the lesson.
   - Must be practical phrases used in the workplace scenario.
   - Do NOT use blanks like "____". Use proper noun placeholders instead (e.g., Alex, Emma, Apex Corp).
   - Example: { "en": "My name is John.", "kr": "저는 존입니다." }

2. vocabulary: Exactly ${vocabCount} vocabulary items, each with:
   - word: The English word/phrase
   - pos: Part of speech (noun, verb, adjective, adverb, phrase)
   - translation: Korean translation
   - definition: Simple English definition (max 8 words)
   - pronunciation: Phonetic guide in brackets, stressed syllable CAPITALIZED

3. pronunciation: Two columns of minimal pairs or related sounds.
   - instruction & instructionKr: What to practice (e.g., "Let's practice /æ/ and /ʌ/.")
   - left: { symbol: "/sound/", words: [{ en: "word", kr: "한국어" }] } - 5 words
   - right: { symbol: "/sound/", words: [{ en: "word", kr: "한국어" }] } - 5 words
   - Choose sounds that appear in this lesson's vocabulary/patterns.

4. tutorNotes: Concise notes that guide the tutor clearly.
${levelTutorNotesRule}

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "present": {
    "patterns": [{ "en": "...", "kr": "..." }],
    "vocabulary": [{ "word": "...", "pos": "...", "translation": "...", "definition": "...", "pronunciation": "..." }],
    "pronunciation": {
      "instruction": "...", "instructionKr": "...",
      "left": { "symbol": "...", "words": [{ "en": "...", "kr": "..." }] },
      "right": { "symbol": "...", "words": [{ "en": "...", "kr": "..." }] }
    },
    "tutorNotes": [{ "type": "script|instruction|tip", "text": "..." }]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE present response:', text); }
    const present = parsed.present || {};
    const stripTags = (text: string) => (text || '').replace(/<[^>]*>/g, '').trim();
    const replacePatternPlaceholders = (text: string) => {
      let out = text || '';
      const replacements: Array<[RegExp, string]> = [
        [/\(your name\)|\[name\]|\{name\}/gi, 'Alex'],
        [/\(your coworker\)|\(your teammate\)|\(coworker\)|\(teammate\)|\[coworker\]|\[teammate\]/gi, 'Emma'],
        [/\(your manager\)|\(manager\)|\[manager\]/gi, 'Ms. Carter'],
        [/\(your company\)|\(company\)|\(firm\)|\(office\)|\[company\]/gi, 'Apex Corp'],
        [/\(your department\)|\(department\)|\[department\]/gi, 'Sales'],
        [/\(your position\)|\(position\)|\(job\)|\(role\)|\[position\]/gi, 'Marketing Manager'],
        [/\(your email\)|\(email\)|\[email\]/gi, 'alex@apex.com'],
        [/\(your phone\)|\(phone\)|\[phone\]/gi, '555-1234'],
      ];
      replacements.forEach(([pattern, replacement]) => {
        out = out.replace(pattern, replacement);
      });

      if (/_{2,}/.test(out)) {
        const lower = stripTags(out).toLowerCase();
        let fill = 'Alex';
        if (lower.includes('work at') || lower.includes('company') || lower.includes('firm')) fill = 'Apex Corp';
        else if (lower.includes('department') || lower.includes('sales') || lower.includes('marketing')) fill = 'Sales';
        else if (lower.includes('manager')) fill = 'Ms. Carter';
        else if (lower.includes('position') || lower.includes('role') || lower.includes('job')) fill = 'Marketing Manager';
        else if (lower.includes('email')) fill = 'alex@apex.com';
        else if (lower.includes('phone') || lower.includes('call')) fill = '555-1234';
        else if (lower.includes('from')) fill = 'Boston';
        out = out.replace(/_{2,}/g, fill);
      }

      return out;
    };

    const patterns = (present.patterns || []).slice(0, patternCount).map((p: any) => ({
      en: replacePatternPlaceholders(p.en || ''),
      kr: p.kr || p.jp || '',
    }));
    const vocabulary = (present.vocabulary || []).slice(0, vocabCount).map((v: any) => ({
      word: v.word || '', pos: v.pos || '', translation: v.translation || '',
      definition: v.definition || '', pronunciation: v.pronunciation || '',
    }));
    const pronunciation = {
      instruction: present.pronunciation?.instruction || '',
      instructionKr: present.pronunciation?.instructionKr || present.pronunciation?.instructionJp || '',
      left: {
        symbol: present.pronunciation?.left?.symbol || '/æ/',
        words: (present.pronunciation?.left?.words || []).slice(0, 5).map((w: any) => ({ en: w.en || '', kr: w.kr || w.jp || '' })),
      },
      right: {
        symbol: present.pronunciation?.right?.symbol || '/ʌ/',
        words: (present.pronunciation?.right?.words || []).slice(0, 5).map((w: any) => ({ en: w.en || '', kr: w.kr || w.jp || '' })),
      },
    };

    const normalizeNote = (n: any) => ({ type: n.type || 'instruction', text: n.text || '' });
    const ordinal = (index: number) => {
      if (index === 1) return 'first';
      if (index === 2) return 'second';
      if (index === 3) return 'third';
      if (index === 4) return 'fourth';
      if (index === 5) return 'fifth';
      return `${index}th`;
    };
    const usageFromPattern = (patternText: string) => {
      const p = stripTags(patternText).toLowerCase();
      if (p.includes('my name')) return 'say your name';
      if (p.includes('this is') && p.includes('teammate')) return 'introduce a teammate';
      if (p.includes('this is')) return 'introduce someone';
      if (p.includes('we are') || p.includes("we're")) return 'say you work together';
      if (p.includes('works in') || p.includes('work in')) return 'say what department the person works in';
      if (p.includes('is our manager') || p.includes('is my manager')) return 'say the person\'s role or title';
      if (p.includes('i work at')) return 'say where you work';
      if (p.includes("i'm a") || p.includes('i am a')) return 'say your job';
      if (p.includes('i am from')) return 'say where you are from';
      if (p.includes('i have worked') || p.includes("i've worked")) return 'say how long you have worked';
      if (p.includes('sure') || p.includes('i can help')) return 'accept the request';
      if (p.includes('no problem') || p.includes("i can't") || p.includes('cannot')) return 'respond to a request';
      if (p.includes('please') && (p.includes('help') || p.includes('send') || p.includes('check') || p.includes('review'))) return 'make a polite request';
      if (p.includes('can i speak to')) return 'ask to speak to someone';
      if (p.includes('may i speak to')) return 'ask to speak to someone';
      if (p.includes('could you')) return 'make a polite request';
      if (p.includes('can you')) return 'make a request';
      return 'describe the person';
    };

    const tutorNotes = level <= 3
      ? [
          { type: 'script', text: '"Let\'s look at patterns used in this lesson."' },
          ...patterns.flatMap((p: { en: string; kr: string }, i: number) => ([
            { type: 'instruction', text: `Read the ${ordinal(i + 1)} pattern. Ask the student to repeat.` },
            { type: 'script', text: `"Use this to ${usageFromPattern(p.en)}."` },
          ])),
          { type: 'script', text: '"Do you have any questions about the patterns?"' },
          { type: 'script', text: '"Let\'s go to the next page."' },
        ]
      : (present.tutorNotes || []).map(normalizeNote);

    return {
      present: {
        patterns,
        vocabulary,
        pronunciation,
        tutorNotes,
      },
    };
  }

  // ===== UNDERSTAND SECTION =====
  if (section === 'understand') {
    let prompt = `${lessonContext}
${presentContext}

Generate the UNDERSTAND section for this Business English lesson.

This section tests whether the student comprehends the patterns from the PRESENT section.

SKILL-SPECIFIC FOCUS:
- LISTENING: keep the language very short and recognition-based.
- READING: make the tasks clearly support understanding written text from the lesson context.
- SPEAKING: use comprehension tasks that still prepare the student for later speaking.
- REVIEW: recycle earlier chapter content without copying earlier exercises exactly.

REQUIREMENTS:
1. instruction & instructionKr: A clear bilingual instruction explaining the exercise.
   Example: "You can use these patterns to introduce yourself and a coworker."

2. patternDrills: 2-3 drill blocks that practice the patterns.
   - Each block: label, labelKr, template with a blank "___", and exactly 5 examples (en/kr).
   - Examples must be complete sentences (no blanks).
   - Within each drill, vary sentence structure across the 5 examples. Do not repeat the same clause in all five.
     Use at least 3 different structures, e.g., "is on the ___ team", "works in ___", "is in ___",
     "is part of ___", "belongs to ___", "Our ___ is ___".
   - Use English names only in examples.

3. fillRows: 4-6 fill-in-the-blank sentences that test understanding of the patterns.
   Each row has "parts" - an array of objects with "text" and "isBlank".
   - isBlank: true means the student fills it in
   - isBlank: false means it's pre-filled text
   - Each row MUST include at least one blank part.
   - For blank parts, leave text empty so blanks are visible (do not include the answer).
   Example: { "parts": [{ "text": "My name ", "isBlank": false }, { "text": "is", "isBlank": true }, { "text": " John.", "isBlank": false }] }

4. The blanks should test KEY words from the patterns (verbs, key nouns, prepositions).
5. tutorNotes: grouped notes that are easy for the tutor to follow.
   - If you include comprehension, word bank, and sound practice notes, keep them clearly separated in style.
   - Match the concise grouped-note style seen in the reference lessons.

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "understand": {
    "instruction": "...", "instructionKr": "...",
    "patternDrills": [{ "label": "...", "labelKr": "...", "template": "...", "examples": [{ "en": "...", "kr": "..." }] }],
    "fillRows": [{ "parts": [{ "text": "...", "isBlank": true|false }] }],
    "tutorNotes": [{ "type": "script|instruction|tip", "text": "..." }]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE understand response:', text); }
    const und = parsed.understand || {};
    const ensureBlankRow = (parts: Array<{ text: string; isBlank: boolean }>) => {
      const normalized = parts.map(p => ({ text: p.text || '', isBlank: !!p.isBlank }));
      const hasBlank = normalized.some(p => p.isBlank);
      if (hasBlank) {
        return normalized.map(p => (p.isBlank ? { ...p, text: '' } : p));
      }

      const sentence = normalized.map(p => p.text).join('').trim();
      if (!sentence) return [{ text: '', isBlank: true }];

      const deptMatch = sentence.match(/\b([A-Z][a-z]+|HR|IT|Sales|Marketing|Finance|Design|Support)\b/g);
      let target = deptMatch ? deptMatch[deptMatch.length - 1] : '';
      if (!target) {
        const lastWordMatch = sentence.match(/^(.*\b)(\w+)(\W*)$/);
        if (lastWordMatch) {
          const before = lastWordMatch[1];
          const word = lastWordMatch[2];
          const after = lastWordMatch[3];
          return [
            { text: before, isBlank: false },
            { text: '', isBlank: true },
            { text: after, isBlank: false },
          ];
        }
        return [{ text: sentence, isBlank: false }, { text: '', isBlank: true }];
      }

      const idx = sentence.lastIndexOf(target);
      const before = sentence.slice(0, idx);
      const after = sentence.slice(idx + target.length);
      return [
        { text: before, isBlank: false },
        { text: '', isBlank: true },
        { text: after, isBlank: false },
      ];
    };

    const buildFallbackFillRows = () => {
      const rows: Array<{ parts: Array<{ text: string; isBlank: boolean }> }> = [];
      const patterns = (currentPresentData?.patterns || []).slice(0, 4);
      const safePatterns = patterns.length ? patterns : [
        { en: 'This is Alex.', kr: '이쪽은 알렉스예요.' },
        { en: 'She works in Sales.', kr: '그녀는 영업팀에서 일해요.' },
        { en: 'He is our manager.', kr: '그는 우리 매니저예요.' },
        { en: 'We work together.', kr: '우리는 함께 일해요.' },
      ];

      safePatterns.forEach((p) => {
        const text = (p.en || '').replace(/<[^>]*>/g, '').trim();
        if (!text) return;
        const words = text.split(' ');
        if (words.length < 3) return;
        const blankIndex = Math.max(1, Math.min(words.length - 2, 1));
        const before = words.slice(0, blankIndex).join(' ') + ' ';
        const after = words.slice(blankIndex + 1).join(' ');
        rows.push({
          parts: [
            { text: before, isBlank: false },
            { text: '', isBlank: true },
            { text: after ? ` ${after}` : '', isBlank: false },
          ],
        });
      });
      return rows;
    };

    const ensureFiveExamples = (examples: any[]) => {
      const normalized = Array.isArray(examples) ? examples.map((ex: any) => ({
        en: ex.en || '',
        kr: ex.kr || ex.jp || '',
      })) : [];
      const trimmed = normalized.slice(0, 5);
      while (trimmed.length < 5) trimmed.push({ en: '', kr: '' });
      return trimmed;
    };

    const normalizePatternDrills = (drills: any[]) => {
      const list = Array.isArray(drills) ? drills : [];
      return list.slice(0, 3).map((d: any) => ({
        label: d.label || '',
        labelKr: d.labelKr || d.labelJp || '',
        template: d.template || '',
        examples: ensureFiveExamples(d.examples || []),
      }));
    };

    const buildFallbackPatternDrills = () => ([
      {
        label: 'Introducing someone',
        labelKr: '사람 소개하기',
        template: 'This is ___.',
        examples: ensureFiveExamples([
          { en: 'This is Alex.', kr: '이쪽은 알렉스예요.' },
          { en: 'This is Emma.', kr: '이쪽은 엠마예요.' },
          { en: 'This is David.', kr: '이쪽은 데이비드예요.' },
          { en: 'This is Olivia.', kr: '이쪽은 올리비아예요.' },
          { en: 'This is Ryan.', kr: '이쪽은 라이언예요.' },
        ]),
      },
      {
        label: 'Describing someone\'s department',
        labelKr: '부서 말하기',
        template: 'He/She works in the ___ department.',
        examples: ensureFiveExamples([
          { en: 'She is on the marketing team.', kr: '그녀는 마케팅 팀에 있어요.' },
          { en: 'He works in the sales department.', kr: '그는 영업 부서에서 일해요.' },
          { en: 'Alex is in the IT department.', kr: '알렉스는 IT 부서에 있어요.' },
          { en: 'Emma is part of the design team.', kr: '엠마는 디자인 팀 소속이에요.' },
          { en: 'David belongs to the finance team.', kr: '데이비드는 재무 팀 소속이에요.' },
        ]),
      },
      {
        label: 'Describing someone\'s role',
        labelKr: '역할 말하기',
        template: 'He/She is our ___.',
        examples: ensureFiveExamples([
          { en: 'Emma is our manager.', kr: '엠마는 우리 매니저예요.' },
          { en: 'Our manager is Olivia.', kr: '우리 매니저는 올리비아예요.' },
          { en: 'James is our team leader.', kr: '제임스는 우리 팀 리더예요.' },
          { en: 'Sophia is the supervisor.', kr: '소피아는 관리자예요.' },
          { en: 'Ethan is the department head.', kr: '이선은 부서장이에요.' },
        ]),
      },
    ]);

    const ensureInstruction = (text: string) => text && text.trim()
      ? text
      : 'Fill in the blanks with the correct pattern.';

    const mappedPatternDrills = normalizePatternDrills(und.patternDrills || []);
    const fallbackPatternDrills = buildFallbackPatternDrills();
    const finalPatternDrills = mappedPatternDrills.length >= 2
      ? mappedPatternDrills
      : [...mappedPatternDrills, ...fallbackPatternDrills].slice(0, 3);

    const mappedFillRows = (und.fillRows || []).map((row: any) => ({
      parts: ensureBlankRow((row.parts || []).map((p: any) => ({
        text: p.text || '', isBlank: !!p.isBlank,
      }))),
    }));

    return {
      understand: {
        instruction: ensureInstruction(und.instruction || ''),
        instructionKr: und.instructionKr || und.instructionJp || '',
        patternDrills: finalPatternDrills,
        fillRows: mappedFillRows.length > 0 ? mappedFillRows : buildFallbackFillRows(),
        tutorNotes: (und.tutorNotes || []).length > 0
          ? (und.tutorNotes || []).map((n: any) => ({
              type: n.type || 'instruction', text: n.text || '',
            }))
          : [{ type: 'instruction', text: 'Ask the student to complete the blanks.' }],
      },
    };
  }

  // ===== PRACTICE SECTION =====
  if (section === 'practice') {
    const practiceBlueprint = getPracticeBlueprint(skillType, lessonNumber, goalTextEn);
    let prompt = `${lessonContext}
${presentContext}

Generate the PRACTICE section for this Business English lesson.

This section has EXACTLY 4 progressive steps:
${practiceBlueprint.titles.map((title, index) => `${index + 1}. ${title}`).join('\n')}

SKILL-SPECIFIC PRACTICE BLUEPRINT:
${practiceBlueprint.guidance}

REQUIREMENTS FOR EACH STEP:
1. title: Use the exact step titles listed above.
2. instructionEn & instructionKr: Bilingual instructions.
   - instructionKr must fully translate instructionEn. Do not omit details such as "read the sentences", "fill in the blanks", or "with your own information".
3. content: Additional text content if needed (can be empty).
4. dialogue:
   - Include dialogue only when the step naturally needs it.
   - Dialogue must feel natural for the lesson type.
   - If a step is a reading-focused step, the text may appear in content instead of dialogue.
5. tutorNotes: concise practical guidance using the standardized teaching-note style from the reference lessons.
   - Prefer SCRIPT first, then INSTRUCTION.
   - Keep each note short.

The practice must reinforce patterns and vocabulary from the PRESENT section and clearly fit the lesson slot type.
Do not copy the exact practice titles or scenarios from earlier lessons unless the blueprint above requires it.

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "practice": {
    "steps": [
      {
        "title": "${practiceBlueprint.titles[0]}",
        "instructionEn": "...", "instructionKr": "...",
        "content": "",
        "tutorNotes": [{ "type": "...", "text": "..." }]
      },
      {
        "title": "${practiceBlueprint.titles[1]}",
        "instructionEn": "...", "instructionKr": "...",
        "content": "",
        "tutorNotes": [{ "type": "...", "text": "..." }]
      },
      {
        "title": "${practiceBlueprint.titles[2]}",
        "instructionEn": "...", "instructionKr": "...",
        "content": "",
        "dialogue": [{ "role": "tutor|student", "en": "...", "kr": "..." }],
        "tutorNotes": [{ "type": "...", "text": "..." }]
      },
      {
        "title": "${practiceBlueprint.titles[3]}",
        "instructionEn": "...", "instructionKr": "...",
        "content": "",
        "dialogue": [{ "role": "tutor|student", "en": "...", "kr": "..." }],
        "tutorNotes": [{ "type": "...", "text": "..." }]
      }
    ]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE practice response:', text); }
    const practice = parsed.practice || {};
    const normalizePracticeInstructionKr = (instructionEn: string, instructionKr: string, title: string) => {
      const en = (instructionEn || '').toLowerCase();
      const stepTitle = (title || '').toLowerCase();

      if (
        (en.includes('team directory entry') || stepTitle.includes('own profile')) &&
        (en.includes('your own information') || en.includes('fill in the blanks'))
      ) {
        return '패턴을 사용하여 자신의 팀 디렉터리 항목을 완성하세요. 문장을 읽고 자신의 정보로 빈칸을 채우세요.';
      }

      if (en.includes('fill in the blanks') && (!instructionKr || !instructionKr.includes('빈칸'))) {
        return '문장을 읽고 알맞은 표현으로 빈칸을 채우세요.';
      }

      return instructionKr || '';
    };

    return {
      practice: {
        steps: (practice.steps || []).slice(0, 4).map((s: any, i: number) => ({
          title: s.title || practiceBlueprint.titles[i] || `Step ${i + 1}`,
          instructionEn: s.instructionEn || '',
          instructionKr: normalizePracticeInstructionKr(
            s.instructionEn || '',
            s.instructionKr || s.instructionJp || '',
            s.title || `Step ${i + 1}`,
          ),
          content: s.content || '',
          dialogue: s.dialogue ? s.dialogue.map((d: any) => ({
            role: d.role || 'tutor', en: d.en || '', kr: d.kr || d.jp || '',
          })) : undefined,
          tutorNotes: (s.tutorNotes || []).map((n: any) => ({
            type: n.type || 'instruction', text: n.text || '',
          })),
        })),
      },
    };
  }

  // ===== CHALLENGE SECTION =====
  if (section === 'challenge') {
    const standardChallengeNotes = [
      { type: 'script', text: '"Now let\'s do simulation"' },
      { type: 'script', text: '"First please read the Key Expressions. You may use the Key Expressions in the Simulation."' },
      { type: 'instruction', text: 'Read the simulation.' },
      { type: 'script', text: '"Is it clear?" ...Now let\'s start our roleplay!' },
      { type: 'instruction', text: 'Use the prompt questions to guide the roleplay.' },
      { type: 'instruction', text: 'Give feedback after finishing.' },
      { type: 'tip', text: 'This must be a real-life simulation, distinct from Practice. Corrections should only be done after the exercise.' },
    ] as const;
    let prompt = `${lessonContext}
${presentContext}

Generate the CHALLENGE section for this Business English lesson.

This is a real-life SIMULATION where the student applies everything they've learned.

SKILL-SPECIFIC CHALLENGE RULES:
- LISTENING: the tutor can model or say short lines first, but the student still needs to respond in the roleplay.
- READING: you may use a short reading support block before the roleplay. For reading lessons, roleplayTable may be null and activityBlocks may include one readingPassage block instead.
- SPEAKING: prioritize natural back-and-forth. The student should actively produce the target expressions.
- REVIEW: combine material from earlier lessons without copying any earlier simulation exactly.

REQUIREMENTS:
1. scenarioEn & scenarioKr: A detailed workplace scenario (2-3 sentences) that gives the student a clear task.
   The student must use the patterns and vocabulary from the lesson.

2. roleplayTable:
   - For listening and speaking lessons, prefer a roleplayTable when it helps the scenario.
   - For reading lessons, roleplayTable may be null if a reading support block fits better.

3. activityBlocks:
   - Optional.
   - For reading lessons, you may include exactly one { "type": "readingPassage", "id": "...", "title": "...", "titleKr": "...", "passage": "...", "questions": [] } block.
   - For listening and speaking lessons, prefer [] unless the lesson truly needs a support block.

4. tutorNotes: use this fixed teaching-note flow EXACTLY before the question notes:
   - { "type": "script", "text": "\"Now let's do simulation\"" }
   - { "type": "script", "text": "\"First please read the Key Expressions. You may use the Key Expressions in the Simulation.\"" }
   - { "type": "instruction", "text": "Read the simulation." }
   - { "type": "script", "text": "\"Is it clear?\" ...Now let's start our roleplay!" }
   - { "type": "instruction", "text": "Use the prompt questions to guide the roleplay." }
   - { "type": "instruction", "text": "Give feedback after finishing." }
   - { "type": "tip", "text": "This must be a real-life simulation, distinct from Practice. Corrections should only be done after the exercise." }
   - After those notes, add 4-6 QUESTION notes.
   - QUESTION notes may be direct tutor questions OR short tutor reply lines plus a follow-up question, depending on the roleplay.
   - NEVER put spoken dialogue inside an INSTRUCTION note.
   - Do NOT return a separate guideQuestions block. Put every roleplay prompt line inside tutorNotes with type "question".

The challenge must test PRODUCTION - can the student use what they learned in a realistic situation?

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "challenge": {
    "scenarioEn": "...", "scenarioKr": "...",
    "roleplayTable": { "you": "...", "coworkers": ["..."] },
    "activityBlocks": [],
    "tutorNotes": [{ "type": "script|instruction|question|tip", "text": "..." }]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE challenge response:', text); }
    const challenge = parsed.challenge || {};
    const rawTutorNotes = (challenge.tutorNotes || []).map((n: any) => ({
        type: ['instruction', 'script', 'tip', 'question'].includes(n?.type) ? n.type : 'instruction',
        text: n?.text || '',
      }));
    const hasQuestionNotes = rawTutorNotes.some((note: any) => (
      note.type === 'question' && (note.text || '').trim()
    ));
    const legacyQuestionNotes = hasQuestionNotes
      ? []
      : (challenge.guideQuestions || []).map((q: any) => ({
        type: 'question',
        text: q?.text || '',
      }));
    const normalizedNotes = [...rawTutorNotes, ...legacyQuestionNotes];
    const questionNotes = normalizedNotes
      .filter((n: any) => n.type === 'question' && (n.text || '').trim())
      .slice(0, 6)
      .map((n: any) => ({
        type: 'question',
        text: n.text || '',
      }));
    return {
      challenge: {
        scenarioEn: challenge.scenarioEn || '',
        scenarioKr: challenge.scenarioKr || challenge.scenarioJp || '',
        guideQuestions: [],
        roleplayTable: challenge.roleplayTable ? {
          you: challenge.roleplayTable.you || '',
          coworkers: challenge.roleplayTable.coworkers || [],
        } : undefined,
        activityBlocks: Array.isArray(challenge.activityBlocks) ? challenge.activityBlocks : [],
        tutorNotes: [...standardChallengeNotes, ...questionNotes],
      },
    };
  }

  // ===== DISCUSSION SECTION =====
  if (section === 'discussion') {
    const fixedDiscussionInstruction = 'You can ask follow-up questions and have a natural conversation with the student until the time for feedback.';
    let prompt = `${lessonContext}
${presentContext}

Generate the DISCUSSION section for this Business English lesson.

This section encourages the student to share personal experiences related to the topic.

REQUIREMENTS:
1. instructionEn & instructionKr: Clear bilingual instructions.
   Example: "Choose one category, then answer the questions."

2. categories: EXACTLY 3 discussion categories, each with:
   - title: Short category name in UPPERCASE (e.g., "YOUR BOSS", "YOUR TEAMMATE")
   - questions: 3 questions that encourage personal sharing
   
   Categories should relate to the lesson topic but shift focus to the student's real work life.
   Questions should be progressively deeper (factual → descriptive → opinion).

3. tutorNotes: use this fixed teaching-note flow EXACTLY:
   - One short SCRIPT in quotes to open the discussion naturally. It may mention the lesson topic.
   - { "type": "instruction", "text": "Read the instruction." }
   - { "type": "instruction", "text": "Ask the student to choose a category." }
   - { "type": "instruction", "text": "You can ask follow-up questions and have a natural conversation with the student until the time for feedback." }
   - Do NOT add a TIP note for this section.

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "discussion": {
    "instructionEn": "...", "instructionKr": "...",
    "categories": [{ "title": "...", "questions": ["..."] }],
    "tutorNotes": [{ "type": "script|instruction|tip", "text": "..." }]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE discussion response:', text); }
    const disc = parsed.discussion || {};
    const openingScript = (disc.tutorNotes || [])
      .map((n: any) => ({
        type: n.type || 'instruction',
        text: n.text || '',
      }))
      .find((n: any) => n.type === 'script' && (n.text || '').trim())?.text || '"Now, let\'s have a discussion."';
    return {
      discussion: {
        instructionEn: disc.instructionEn || '',
        instructionKr: disc.instructionKr || disc.instructionJp || '',
        categories: (disc.categories || []).slice(0, 3).map((c: any) => ({
          title: c.title || '',
          questions: (c.questions || []).slice(0, 3),
        })),
        tutorNotes: [
          { type: 'script', text: openingScript },
          { type: 'instruction', text: 'Read the instruction.' },
          { type: 'instruction', text: 'Ask the student to choose a category.' },
          { type: 'instruction', text: fixedDiscussionInstruction },
        ],
      },
    };
  }

  // ===== FEEDBACK SECTION =====
  if (section === 'feedback') {
    let prompt = `${lessonContext}

Generate the FEEDBACK section for this Business English lesson.

REQUIREMENTS:
1. goalReviewEn & goalReviewKr: Restate the lesson goal for review.
2. feedbackTemplate: A text template the tutor sends via chat. Format:
   *OVERALL SCORE*
   Overall: (score)
   - comment
   
   *Vocabulary/Phrases*
   Vocabulary:
   - word/phrase
   - word/phrase
   
   *Grammar*
   Grammar:
   incorrect grammar = correct grammar
   
   *Pronunciation*
   Pronunciation:
   - mispronounced word
   - mispronounced word

3. nextLessonLabel: Chapter label (e.g., "CHAPTER 1: WORK INTRODUCTIONS")
4. nextLessonName: Next lesson teaser (e.g., "Lesson 2: All About Me")
5. tutorNotes: 5-6 notes for closing the lesson properly.

${customPrompt ? `Additional instructions: ${customPrompt}` : ''}
${generationMode === 'improve' && currentContent ? `\nIMPROVE the following existing content:\n${JSON.stringify(currentContent)}` : ''}

Return ONLY JSON:
{
  "feedback": {
    "goalReviewEn": "...", "goalReviewKr": "...",
    "feedbackTemplate": "...",
    "nextLessonLabel": "...", "nextLessonName": "...",
    "tutorNotes": [{ "type": "script|instruction|tip", "text": "..." }]
  }
}`;

    const resp = await businessEnglishAgent.generate(prompt);
    const text = resp.text || '';
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonContent = sanitizeAIText((jsonMatch?.[1] || text).trim());
    let parsed: any = {};
    try { parsed = JSON.parse(jsonContent); } catch (e) { console.error('Failed to parse BE feedback response:', text); }
    const fb = parsed.feedback || {};
    return {
      feedback: {
        goalReviewEn: fb.goalReviewEn || goalTextEn,
        goalReviewKr: fb.goalReviewKr || fb.goalReviewJp || goalTextJp,
        feedbackTemplate: fb.feedbackTemplate || '',
        nextLessonLabel: fb.nextLessonLabel || `CHAPTER ${chapter}: ${chapterName.toUpperCase()}`,
        nextLessonName: fb.nextLessonName || `Lesson ${lessonNumber + 1}: Next Topic`,
        tutorNotes: (fb.tutorNotes || []).map((n: any) => ({
          type: n.type || 'instruction', text: n.text || '',
        })),
      },
    };
  }

  throw new Error(`Unknown BE section: ${section}`);
};
