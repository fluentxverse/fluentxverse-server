/**
 * AI Routes - Grammar checking and language assistance
 */
import { Elysia, t } from 'elysia';
import { checkGrammar, getVocabularyDefinition, getPronunciation, generateIntroductionContent, generateDiscussionQuestions, generateCourseStructure, generateLessonStructure, generateBusinessEnglishContent } from '../services/ai.service';
import { createAdminGuard, createTutorGuard } from '../middleware/auth.middleware';

export const aiRoute = new Elysia({ prefix: '/ai' })
  // ============================================================================
  // GRAMMAR CHECK (Tutor only)
  // ============================================================================
  .post(
    '/grammar-check',
    async ({ body, cookie, set }) => {
      // Verify tutor authentication
      const tutorPayload = await createTutorGuard(cookie, set);
      if (!tutorPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await checkGrammar(body.text);
        return {
          success: true,
          corrected: result.corrected,
          simpleExplanation: result.simpleExplanation,
          technicalExplanation: result.technicalExplanation,
          hasErrors: result.hasErrors,
        };
      } catch (error) {
        console.error('Grammar check failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to check grammar. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: 1000 }),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Check grammar and get correction with explanation',
        description: 'Uses OpenAI to check grammar, provide corrections, and explain errors concisely.',
      },
    }
  )
  // ============================================================================
  // VOCABULARY DEFINITION (Tutor only)
  // ============================================================================
  .post(
    '/vocabulary-definition',
    async ({ body, cookie, set }) => {
      // Verify tutor authentication
      const tutorPayload = await createTutorGuard(cookie, set);
      if (!tutorPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await getVocabularyDefinition(body.word);
        return {
          success: true,
          definitions: result.definitions,
        };
      } catch (error) {
        console.error('Vocabulary definition failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to get definition. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        word: t.String({ minLength: 1, maxLength: 200 }),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Get vocabulary definition and translations',
        description: 'Uses OpenAI to provide English definitions and Japanese translations with romaji.',
      },
    }
  )
  // ============================================================================
  // PRONUNCIATION (Tutor only)
  // ============================================================================
  .post(
    '/pronunciation',
    async ({ body, cookie, set }) => {
      // Verify tutor authentication
      const tutorPayload = await createTutorGuard(cookie, set);
      if (!tutorPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await getPronunciation(body.word);
        return {
          success: true,
          word: result.word,
          phonetic: result.phonetic,
        };
      } catch (error) {
        console.error('Pronunciation failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to get pronunciation. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        word: t.String({ minLength: 1, maxLength: 200 }),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Get word pronunciation with phonetic spelling',
        description: 'Uses OpenAI to provide phonetic spelling with stressed syllable capitalized.',
      },
    }
  )
  // ============================================================================
  // GENERATE INTRODUCTION CONTENT (Admin/Teacher only)
  // ============================================================================
  .post(
    '/generate-introduction',
    async ({ body, cookie, set }) => {
      // Verify admin authentication
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await generateIntroductionContent(
          body.topic,
          body.skillLevel,
          body.skill,
          body.customPrompt, // Pass custom prompt
          body.currentContent, // Pass current content for context
          body.baseInstructions, // Pass fixed instructions
          body.level, // Pass lesson level for complexity adjustment
          body.chapter, // Pass chapter for context
          body.lessonNumber, // Pass lesson number for context
          body.generationMode, // Pass generation mode ('new' or 'improve')
          body.includeLessonIssue, // Pass lesson issue toggle flag
          body.lessonGoal, // Pass lesson goal for context-based generation
          body.learnType, // Pass Step A subtype (vocabulary/expressions)
          body.stepBType, // Pass Step B type (speak-your-mind/grammar-tip/pronunciation)
          body.includeTranslation, // Pass translation toggle
          body.translationLanguage, // Pass translation language
          body.vocabularyCount, // Pass current vocabulary count from editor
          body.expressionCount, // Pass current expression count from editor
          body.applyType, // Pass Apply activity type (speaking/listening/reading)
          body.dialogueLineCount, // Pass current dialogue line count from editor
          body.generateTrivia, // Pass trivia generation flag
          body.exerciseType, // Pass exercise type (rephrase/choose/change or conversation/multiple-choice/speech/compare)
          body.exerciseStep, // Pass exercise step (stepA or stepB)
          body.exerciseItemCount, // Pass exercise item count from editor
          body.missionType, // Pass mission type (speaking/discussion/reading/listening)
          body.missionQuestionCount, // Pass mission question count from editor
          body.isMission2, // Pass flag for mission 2 (challenge 2)
          body.storyData, // Pass story data for K-Drama style generation
          body.currentLearnData, // Pass Learn section data for cross-section cohesion
          body.currentApplyData // Pass Apply section data for story continuity in Mission
        );
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error('Failed to generate introduction content:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to generate introduction content. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        topic: t.String({ minLength: 1, maxLength: 200 }),
        skillLevel: t.String(), // e.g., "BEGINNER", "INTERMEDIATE"
        skill: t.Union([t.Literal('speaking'), t.Literal('listening'), t.Literal('reading')]),
        customPrompt: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))), // Optional custom prompt
        currentContent: t.Optional(t.Nullable(t.Any())), // Optional current introduction data
        baseInstructions: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))), // Optional fixed instructions
        level: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 10 }))), // Lesson level (1-10) for complexity
        chapter: t.Optional(t.Nullable(t.Number())), // Chapter number for context
        lessonNumber: t.Optional(t.Nullable(t.Number())), // Lesson number for context
        generationMode: t.Optional(t.Nullable(t.Union([t.Literal('new'), t.Literal('improve')]))), // 'new' or 'improve'
        includeLessonIssue: t.Optional(t.Boolean()), // Whether to generate lesson issue
        lessonGoal: t.String({ maxLength: 500 }), // Lesson goal/objective (REQUIRED)
        includeTranslation: t.Optional(t.Boolean()), // Whether to include translations
        translationLanguage: t.Optional(t.Union([t.Literal('japanese'), t.Literal('korean'), t.Literal('vietnamese'), t.Literal('chinese')])), // Translation language
        learnType: t.Optional(t.Nullable(t.Union([t.Literal('vocabulary'), t.Literal('expressions')]))), // Step A subtype
        stepBType: t.Optional(t.Nullable(t.Union([t.Literal('speak-your-mind'), t.Literal('grammar-tip'), t.Literal('pronunciation')]))), // Step B type
        vocabularyCount: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 20 }))), // Current vocabulary count in editor
        expressionCount: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 20 }))), // Current expression count in editor
        applyType: t.Optional(t.Nullable(t.Union([t.Literal('speaking'), t.Literal('listening'), t.Literal('reading')]))), // Apply activity type
        dialogueLineCount: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 30 }))), // Current dialogue line count in editor
        generateTrivia: t.Optional(t.Boolean()), // Whether to generate standalone trivia content
        exerciseType: t.Optional(t.Nullable(t.String())), // Exercise type (rephrase/choose/change or conversation/multiple-choice/speech/compare)
        exerciseStep: t.Optional(t.Nullable(t.Union([t.Literal('stepA'), t.Literal('stepB')]))), // Exercise step (A or B)
        exerciseItemCount: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 20 }))), // Current exercise item count in editor
        missionType: t.Optional(t.Nullable(t.Union([t.Literal('speaking'), t.Literal('discussion'), t.Literal('reading'), t.Literal('listening')]))), // Mission type
        missionQuestionCount: t.Optional(t.Nullable(t.Number({ minimum: 1, maximum: 20 }))), // Current mission question count in editor
        isMission2: t.Optional(t.Boolean()), // Whether this is mission 2 (challenge 2)
        storyData: t.Optional(t.Object({
          enabled: t.Boolean(),
          storyTitle: t.String(),
          characters: t.Array(t.Object({
            id: t.String(),
            name: t.String(),
            koreanName: t.Optional(t.String()),
            role: t.Union([t.Literal('main'), t.Literal('supporting'), t.Literal('minor')]),
            description: t.String(),
            personality: t.Optional(t.String()),
          })),
          setting: t.String(),
          previousSummary: t.String(),
          currentPlotPoints: t.Array(t.String()),
          storyNotes: t.String(),
        })), // Story data for K-Drama style generation
        currentLearnData: t.Optional(t.Object({
          steps: t.Optional(t.Array(t.Object({
            id: t.String(),
            label: t.String(),
            items: t.Optional(t.Array(t.Object({
              foreign: t.String(),
              foreignLabel: t.Optional(t.String()),
              native: t.String(),
              audio: t.Optional(t.String()),
              image: t.Optional(t.String()),
            }))),
          }))),
          stepBType: t.Optional(t.Union([
            t.String(), // Simple string like 'speak-your-mind', 'grammar-tip', 'pronunciation'
            t.Object({
              format: t.Optional(t.String()),
              type: t.Optional(t.String()),
              items: t.Optional(t.Array(t.Object({
                foreign: t.String(),
                foreignLabel: t.Optional(t.String()),
                native: t.String(),
                audio: t.Optional(t.String()),
                image: t.Optional(t.String()),
              }))),
            }),
          ])),
          grammarTip: t.Optional(t.Object({
            title: t.Optional(t.String()),
            content: t.Optional(t.String()),
            items: t.Optional(t.Array(t.Object({
              pattern: t.Optional(t.String()),
              explanation: t.Optional(t.String()),
              example: t.Optional(t.String()),
            }))),
          })),
        })), // Learn section data for cross-section cohesion
        currentApplyData: t.Optional(t.Object({
          activityType: t.Union([t.Literal('speaking'), t.Literal('listening'), t.Literal('reading')]),
          situationText: t.Optional(t.String()),
          dialogueLines: t.Optional(t.Array(t.Object({
            speaker: t.String(),
            text: t.String(),
          }))),
          readingText: t.Optional(t.String()),
          tutorSteps: t.Optional(t.Array(t.Object({
            instruction: t.Optional(t.String()),
            scripts: t.Optional(t.Array(t.Object({
              text: t.String(),
            }))),
            listeningScript: t.Optional(t.String()),
          }))),
        })), // Apply section data for story continuity in Mission
      }),
      detail: {
        tags: ['AI'],
        summary: 'Generate introduction content for a lesson',
        description: 'Uses AI to generate contextual introduction texts, lesson issues, and tutor steps for a lesson. Adjusts complexity based on lesson level (1-10). Can include custom instructions and current content for context.',
      },
    }
  )
  // ============================================================================
  // GENERATE EPISODE SUMMARY (Admin only)
  // ============================================================================
  .post(
    '/generate-episode-summary',
    async ({ body, cookie, set }) => {
      // Verify admin authentication
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const { generateEpisodeSummary } = await import('../services/ai.service');
        const result = await generateEpisodeSummary(
          body.storyData,
          body.missionContent,
          body.lessonTopic
        );
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        console.error('Episode summary generation failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to generate episode summary. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        storyData: t.Object({
          storyTitle: t.String(),
          characters: t.Array(t.Object({
            name: t.String(),
            role: t.String(),
            description: t.String(),
          })),
          setting: t.String(),
          previousSummary: t.String(),
          currentPlotPoints: t.Array(t.String()),
        }),
        missionContent: t.Object({
          situation: t.String(),
          instruction: t.String(),
          questions: t.Optional(t.Array(t.Object({
            question: t.String(),
          }))),
          topics: t.Optional(t.Array(t.Object({
            title: t.String(),
            questions: t.Array(t.String()),
          }))),
        }),
        lessonTopic: t.String(),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Generate episode summary after Mission content',
        description: 'Creates a summary of the current episode and a hook for the next episode to maintain story continuity.',
      },
    }
  )
  // ============================================================================
  // DISCUSSION QUESTIONS GENERATION (Admin only)
  // ============================================================================
  .post(
    '/generate-discussion-questions',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await generateDiscussionQuestions(
          body.topic,
          body.level,
          body.questionCount,
          body.customPrompt,
        );
        return { success: true, data: result };
      } catch (error) {
        console.error('Discussion questions generation failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to generate discussion questions. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        topic: t.String({ minLength: 1 }),
        level: t.Number({ minimum: 1, maximum: 5 }),
        questionCount: t.Number({ minimum: 5, maximum: 30 }),
        customPrompt: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Generate discussion questions for a topic',
        description: 'Uses AI to generate level-appropriate discussion questions for the given topic.',
      },
    }
  )
  // ============================================================================
  // GENERATE COURSE STRUCTURE (Admin only)
  // Level topic + Chapter themes & names
  // ============================================================================
  .post(
    '/generate-course-structure',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await generateCourseStructure(
          body.level,
          body.existingTopic,
          body.existingChapters,
          body.customPrompt
        );
        return { success: true, data: result };
      } catch (error) {
        console.error('Course structure generation failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to generate course structure. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        level: t.Number({ minimum: 1, maximum: 10 }),
        existingTopic: t.Optional(t.Nullable(t.String())),
        existingChapters: t.Optional(t.Nullable(t.Array(t.Object({
          chapter: t.Number(),
          theme: t.Optional(t.String()),
          name: t.Optional(t.String()),
        })))),
        customPrompt: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Generate course structure for a level',
        description: 'Uses AI to generate level main topic + chapter themes and names.',
      },
    }
  )
  // ============================================================================
  // GENERATE LESSON STRUCTURE (Admin only)
  // Lesson names & goals for a chapter
  // ============================================================================
  .post(
    '/generate-lesson-structure',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await generateLessonStructure(
          body.level,
          body.chapter,
          body.levelTopic,
          body.chapterTheme,
          body.chapterName,
          body.customPrompt,
          body.course
        );
        return { success: true, data: result };
      } catch (error) {
        console.error('Lesson structure generation failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to generate lesson structure. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        level: t.Number({ minimum: 1, maximum: 10 }),
        chapter: t.Number({ minimum: 1, maximum: 5 }),
        levelTopic: t.String(),
        chapterTheme: t.String(),
        chapterName: t.String(),
        customPrompt: t.Optional(t.Nullable(t.String())),
        course: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Generate lesson names and goals for a chapter',
        description: 'Uses AI to generate chapter lesson names and goals. Business English uses a fixed 5-lesson chapter sequence.',
      },
    }
  )
  // ============================================================================
  // GENERATE BUSINESS ENGLISH CONTENT (Admin only)
  // Section-by-section content for PCPP lessons
  // ============================================================================
  .post(
    '/generate-be-content',
    async ({ body, cookie, set }) => {
      const adminPayload = await createAdminGuard(cookie, set);
      if (!adminPayload) {
        return { success: false, error: 'Unauthorized' };
      }

      try {
        const result = await generateBusinessEnglishContent(
          body.section,
          body.level,
          body.chapter,
          body.lessonNumber,
          body.lessonName,
          body.goalTextEn,
          body.goalTextJp,
          body.chapterName,
          body.customPrompt,
          body.currentContent,
          body.generationMode,
          body.currentPresentData
        );
        return { success: true, data: result };
      } catch (error) {
        console.error('BE content generation failed:', error);
        set.status = 500;
        return {
          success: false,
          error: 'Failed to generate Business English content. Please try again.',
        };
      }
    },
    {
      body: t.Object({
        section: t.Union([
          t.Literal('introduce'),
          t.Literal('present'),
          t.Literal('understand'),
          t.Literal('practice'),
          t.Literal('challenge'),
          t.Literal('discussion'),
          t.Literal('feedback'),
        ]),
        level: t.Number({ minimum: 1, maximum: 10 }),
        chapter: t.Number({ minimum: 1, maximum: 10 }),
        lessonNumber: t.Number({ minimum: 1, maximum: 10 }),
        lessonName: t.String({ minLength: 1, maxLength: 500 }),
        goalTextEn: t.String({ maxLength: 500 }),
        goalTextJp: t.String({ maxLength: 500 }),
        chapterName: t.String({ maxLength: 500 }),
        customPrompt: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        currentContent: t.Optional(t.Nullable(t.Any())),
        generationMode: t.Optional(t.Nullable(t.Union([t.Literal('new'), t.Literal('improve')]))),
        currentPresentData: t.Optional(t.Nullable(t.Object({
          patterns: t.Optional(t.Array(t.Union([
            t.Object({ en: t.String(), kr: t.String() }),
            t.Object({ en: t.String(), jp: t.String() }),
          ]))),
          vocabulary: t.Optional(t.Array(t.Object({ word: t.String(), pos: t.String(), translation: t.String() }))),
        }))),
      }),
      detail: {
        tags: ['AI'],
        summary: 'Generate Business English lesson section content',
        description: 'Uses AI to generate content for a specific section of a Business English PCPP lesson.',
      },
    }
  );
