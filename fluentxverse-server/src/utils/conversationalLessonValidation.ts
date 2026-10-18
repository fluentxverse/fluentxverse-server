/** Validate the branch the renderers actually show, rather than inactive editor data. */
export function conversationalLessonErrors(lesson: any): string[] {
  if (lesson.course !== 'conversational-skills' || lesson.level < 3) return [];
  const errors: string[] = [];
  const text = (value: unknown) => typeof value === 'string' && value.replace(/<[^>]*>/g, '').trim().length > 0;
  const requireText = (value: unknown, label: string) => { if (!text(value)) errors.push(`${label} is required.`); };
  const requireItems = (items: any[], label: string, field: string) => {
    if (!Array.isArray(items) || !items.length || items.some(item => !text(item?.[field]))) errors.push(`${label} must contain complete items.`);
  };
  requireText(lesson.goalTextEn, 'English goal');
  requireText(lesson.goalTextJp, 'Translated goal');
  requireItems(lesson.introductionData?.introTexts, 'Introduction', 'text');
  if (!lesson.learnData?.steps?.length) errors.push('Learn needs at least one step.');
  for (const step of lesson.learnData?.steps || []) {
    if (step.stepType === 'vocabulary') requireItems(step.vocabularyItems, 'Vocabulary', 'englishText');
    else if (step.stepType === 'expressions') requireItems(step.expressionItems, 'Expressions', 'definitionLine');
    else errors.push('Select a valid Learn variation.');
  }
  const focus = lesson.stepBData;
  if (focus?.stepType === 'grammar-tip') requireItems(focus.grammarTip?.explanations, 'Grammar explanations', 'ruleText');
  else if (focus?.stepType === 'pronunciation') requireItems(focus.pronunciation?.phrases, 'Pronunciation phrases', 'phrase');
  else if (focus?.stepType === 'speak-your-mind') {
    requireText(focus.speakYourMind?.speaker1?.speechBubble, 'First speaker');
    requireText(focus.speakYourMind?.speaker2?.speechBubble, 'Second speaker');
    requireText(focus.speakYourMind?.question, 'Speak Your Mind question');
  } else errors.push('Select and complete a Step B variation.');
  const apply = lesson.applyData;
  if (['speaking', 'reading', 'listening'].includes(lesson.skill) && apply?.activityType !== lesson.skill) errors.push('Apply activity must match the lesson skill.');
  if (apply?.activityType === 'speaking') requireItems(apply.dialogueLines, 'Apply dialogue', 'text');
  else if (apply?.activityType === 'reading') requireText(apply.readingText, 'Apply reading passage');
  else if (apply?.activityType === 'listening') {
    if (!apply.tutorSteps?.some((s: any) => text(s.listeningScript))) errors.push('Apply listening needs a tutor listening script.');
  } else errors.push('Select a valid Apply activity.');
  if (apply?.triviaEnabled) requireText(apply.triviaText, 'Enabled trivia');
  const exercise = lesson.exerciseData;
  const branchA = { rephrase: 'exerciseItems', choose: 'chooseItems', change: 'changeItems' }[exercise?.stepAType as string];
  if (branchA) requireItems(exercise[branchA], 'Exercise Step A', 'sentence');
  else errors.push('Select a valid Exercise Step A variation.');
  if (exercise?.hasStepB) {
    const branchB = { conversation: ['conversations', 'speechBubble'], 'multiple-choice': ['multipleChoiceItems', 'boldSentence'], compare: ['compareItems', 'sentence'] }[exercise.stepBType as string] as [string, string] | undefined;
    if (branchB) requireItems(exercise[branchB[0]], 'Exercise Step B', branchB[1]);
    else if (exercise.stepBType === 'speech') requireText(exercise.speechContent, 'Exercise speech');
    else errors.push('Select a valid Exercise Step B variation.');
  }
  const mission = lesson.missionData;
  if (['speaking', 'reading', 'listening'].includes(lesson.skill) && mission?.missionType !== lesson.skill) errors.push('Mission activity must match the lesson skill.');
  requireText(mission?.situation, 'Mission situation');
  requireText(mission?.instruction, 'Mission instructions');
  requireItems(mission?.tutorSteps, 'Mission tutor guide', 'instruction');
  if (mission?.missionType === 'reading' && !mission.readingPassage?.blocks?.some((b: any) => b.type === 'paragraph' && text(b.content))) errors.push('Reading Mission needs a passage.');
  if (mission?.missionType === 'listening' && !mission.tutorSteps?.some((s: any) => text(s.listeningScript))) errors.push('Listening Mission needs a script in the tutor guide.');
  const extra = lesson.missionData2;
  if (extra) {
    requireText(extra.instruction, 'Challenge 2 instructions');
    if (['reading', 'listening'].includes(lesson.skill) && ![lesson.skill, 'discussion'].includes(extra.missionType)) errors.push('Challenge 2 must match the receptive lesson skill or be a discussion.');
    if (extra.missionType === 'discussion' && (!Array.isArray(extra.topics) || !extra.topics.length || extra.topics.some((topic: any) => !text(topic?.title) || !Array.isArray(topic?.questions) || !topic.questions.length || topic.questions.some((question: unknown) => !text(question))))) errors.push('Discussion Challenge 2 needs categories with questions.');
    if (extra.missionType === 'reading' && !extra.readingPassage?.blocks?.some((b: any) => b.type === 'paragraph' && text(b.content))) errors.push('Reading Challenge 2 needs a passage.');
    if (extra.missionType === 'listening' && !extra.tutorSteps?.some((s: any) => text(s.listeningScript))) errors.push('Listening Challenge 2 needs a script in the tutor guide.');
  }
  requireText(lesson.feedbackData?.goal, 'Feedback goal');
  return errors;
}
