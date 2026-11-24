import { discussionTopics, type DiscussionTopic } from './topics';

export const discussionLevelBadges = { 1: 'STARTER', 2: 'BEGINNER', 3: 'ELEMENTARY', 4: 'INTERMEDIATE', 5: 'ADVANCED' } as const;
export const discussionSource = 'discussion-questions-direct-en-v1';
export const discussionId = (level: number, number: number) => `discussion-questions-L${level}-C1-${number}-speaking-en-v1`;

const levelSupport: Record<number, string> = {
  1: 'Start with naming and short choices. Accept a word or short phrase, model a simple sentence and invite another attempt. Use an example or gesture before adding a simple follow-up.',
  2: 'Invite a complete simple sentence, then one reason or detail. Offer a short model if needed. Use the later imagined situations for a brief two-person exchange.',
  3: 'Invite a clear answer with a reason and example. Use later situations to compare options. Ask one relevant follow-up and give the student time to formulate an answer.',
  4: 'Invite a position, supporting reason and relevant qualification. Explore another perspective with one follow-up. Let the student compare options before settling on a proposal.',
  5: 'Ask the student to examine assumptions, evidence and trade-offs. Probe one counterargument, then invite a qualified recommendation and conditions for revising it.',
};

export function discussionFeedback(goal: string) {
  return {
    sectionNumber: 2, sectionTitle: 'FEEDBACK', duration: '2 minutes', goal, goalJp: '',
    rubricTitle: 'LESSON GOAL ACHIEVEMENT',
    rubricLevels: [
      { score: 4, label: 'Very Good', description: 'Could complete the task with ease' },
      { score: 3, label: 'Good', description: 'Could complete the task with some clarifications' },
      { score: 2, label: 'Fair', description: 'Could complete the task with additional instructions' },
      { score: 1, label: 'Poor', description: 'Could somehow complete the task with difficulty' },
    ],
    personalizedFeedbackTitle: 'PERSONALIZED FEEDBACK', feedbackGuideTitle: 'PERSONALIZED FEEDBACK GUIDE',
    rememberNote: 'Use only the student’s actual responses today. The examples illustrate feedback; they are not claims about this student. Recognise one strength and offer one manageable next step.',
    tutorSteps: [
      { instruction: 'Introduce Feedback.', scripts: [{ text: 'Okay, now let’s do Feedback.' }] },
      { instruction: 'Have the student read the lesson goal.' },
      { instruction: 'Ask if they achieved the lesson goal.', scripts: [{ text: 'Did you achieve the lesson goal?' }] },
      { instruction: 'Give a goal-achievement score using the rubric.', tips: [{ text: 'Base the score on today’s observed performance and the level-appropriate support provided. Do not invent a score in advance.' }] },
      { instruction: 'Give specific feedback on content, accuracy and interaction.', tips: [{ text: 'Use actual examples. Model a useful improvement and invite a brief retry. Do not treat an opinion or voluntary refusal as a language mistake.' }] },
      { instruction: 'Wrap up the lesson.', scripts: [{ text: 'Thank you for sharing your ideas today. Keep practising the next step we discussed.' }] },
    ],
    categories: [
      { id: 'content', title: 'CONTENT & IDEAS', titleJp: '',
        focusOn: 'clear, relevant ideas with the amount of detail appropriate to the learner’s level',
        exampleFeedbackItems: ['clear response', 'relevant detail or reason', 'development appropriate to the level'],
        examples: [{ youSaid: 'I like parks.', correction: 'I like parks because I can walk there.', correctionLabel: 'More detail:' }] },
      { id: 'accuracy', title: 'ACCURACY', titleJp: '',
        focusOn: 'grammar and word choice that communicate the intended meaning',
        exampleFeedbackItems: ['useful sentence patterns', 'grammar affecting meaning', 'word choice'],
        examples: [{ youSaid: 'She go by bus.', correction: 'She goes by bus.', correctionLabel: 'Correct:' }] },
      { id: 'interaction', title: 'FLUENCY & INTERACTION', titleJp: '',
        focusOn: 'a manageable pace, appropriate thinking time and responsive turns',
        exampleFeedbackItems: ['responding to a question', 'asking for clarification', 'connecting ideas when ready'],
        examples: [{ youSaid: 'I do not understand.', correction: 'Could you explain what you mean by that?', correctionLabel: 'Another useful option:' }] },
    ],
  };
}

export function buildDiscussionMaterial(topic: DiscussionTopic, previous: any = {}) {
  const oldData = previous.discussionQuestionsData || {};
  const feedback = oldData.feedbackData || previous.feedbackData || discussionFeedback(topic.goal);
  return {
    ...previous,
    id: previous.id || discussionId(topic.level, topic.number), course: 'discussion-questions',
    level: topic.level, chapter: 1, chapterName: previous.chapterName || `Level ${topic.level}`,
    lessonNumber: topic.number, lessonName: topic.title, skill: 'speaking',
    goalTextEn: topic.goal, goalTextJp: '', status: previous.status || 'draft',
    backgroundImage: previous.backgroundImage || '', overlayColor: previous.overlayColor || '#0369a1cc',
    supportLanguage: 'en',
    discussionQuestionsData: {
      ...oldData, topicTitle: topic.title, topicDescription: topic.description,
      questions: topic.questions.map((question, i) => ({
        id: oldData.questions?.[i]?.id || `dq-L${topic.level}-T${topic.number}-Q${i + 1}`,
        number: i + 1, question,
      })),
      tutorDuration: '20 minutes',
      tutorSteps: [
        { instruction: 'Introduce the goal, then the topic.', script: `Our lesson goal today is: ${topic.goal} Today we will discuss ${topic.title}.`, tip: 'Read the topic description. Let the student use a real, invented or third-person example. They can skip a question without explaining why.' },
        { instruction: 'Begin with an accessible question. The tutor asks first.', script: topic.questions[0], tip: levelSupport[topic.level] },
        { instruction: 'Select questions to suit the learner and time.', script: null, tip: 'This is a bank of 20 questions, not a requirement to finish all 20. Aim for 6–8 thoughtful exchanges, choosing early questions for support and later ones for application. Let the student finish; respond briefly and invite a follow-up.' },
        { instruction: 'Support communication and record actual language needs.', script: null, tip: 'Rephrase when needed. Save one or two useful examples from the student’s actual answers for feedback. Correct briefly when meaning breaks down; discuss other corrections after the exchange. Accept different opinions and do not request private details.' },
        { instruction: 'Close with a brief summary and transition to Feedback.', script: 'Which idea would you like to remember from our discussion?', tip: 'Accept a short response. Summarise a point the student actually made, then review the lesson goal. Do not require a speech or score the viewpoint itself.' },
      ],
      backgroundImage: oldData.backgroundImage || previous.backgroundImage || undefined,
      overlayColor: oldData.overlayColor || previous.overlayColor || '#0369a1cc',
      feedbackData: feedback,
    },
  };
}

export function discussionMaterialErrors(lesson: any): string[] {
  const errors: string[] = [], d = lesson.discussionQuestionsData;
  if (lesson.course !== 'discussion-questions' || !discussionLevelBadges[lesson.level as keyof typeof discussionLevelBadges]) errors.push('Invalid course or level');
  if (lesson.chapter !== 1 || lesson.lessonNumber < 1 || lesson.lessonNumber > 10 || lesson.skill !== 'speaking') errors.push('Invalid topic slot');
  if (!lesson.goalTextEn?.startsWith('I can ') || !d?.topicDescription || d?.topicTitle !== lesson.lessonName) errors.push('Missing goal or topic details');
  if (d?.questions?.length !== 20) errors.push('Expected twenty questions');
  const seen = new Set<string>();
  for (const [i, q] of (d?.questions || []).entries()) {
    if (!q.id || q.number !== i + 1 || !q.question?.endsWith('?')) errors.push(`Invalid question ${i + 1}`);
    if (seen.has(q.question?.toLowerCase())) errors.push(`Repeated question ${i + 1}`);
    seen.add(q.question?.toLowerCase());
  }
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(JSON.stringify(d))) errors.push('Expected English-only content');
  if (d?.tutorSteps?.length !== 5 || d?.feedbackData?.tutorSteps?.length !== 6) errors.push('Missing tutor or feedback guide');
  return errors;
}
export const buildDiscussionCourse = () => discussionTopics.map(t => buildDiscussionMaterial(t));
