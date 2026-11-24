const bullets = (texts: string[]) => texts.map(text => ({ text }));
const copy = <T>(value: T): T => structuredClone(value);
const questions = (steps: any[]) => steps.flatMap(step => step.questions || []);
const keys = (steps: any[]) => steps.flatMap(step => step.answerKey || []);
const texts = (steps: any[], key: string) => steps.flatMap(step => step[key] || []).map(item => item.text);
export const guideFields = ['introductionData', 'learnData', 'stepBData', 'applyData', 'exerciseData', 'missionData', 'missionData2', 'feedbackData'] as const;
const guideKeys = new Set(['lessonGoalSteps', 'tutorSteps', 'triviaTutorSteps', 'stepBTutorSteps']);

export function buildStepBTutorGuide(question: string, tip = 'Accept a personal or invented answer. Give one brief correction if needed.') {
  return [
    { instruction: 'Read the grammar tips and ask the student to read the examples.', script: 'Please read the examples. Notice how the forms change the meaning.' },
    { instruction: 'Check understanding with one question.', script: question, tip },
  ];
}

export function withoutTutorGuides(value: any): any {
  if (Array.isArray(value)) return value.map(withoutTutorGuides);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !guideKeys.has(key)).map(([key, item]) => [key, withoutTutorGuides(item)]));
}

export function standardizeTutorGuides(lesson: any, reference: any, number: 1 | 2) {
  const next = copy(lesson);
  const referenceLearn = reference.learnData.steps[0];
  const learn = next.learnData.steps[0];
  const existingIntro = lesson.introductionData.lessonGoalSteps;
  if (!learn.discussionPart || !learn.pronunciationPart || !referenceLearn.discussionPart || !referenceLearn.pronunciationPart) throw Error('Expected all three vocabulary parts.');
  if (reference.feedbackData.tutorSteps.length !== 6) throw Error('Expected the fixed six-step feedback guide.');

  next.introductionData.lessonGoalSteps = reference.introductionData.lessonGoalSteps.map((step: any, index: number) => ({
    instruction: step.instruction,
    script: index === 0
      ? `Our lesson objective today is to ${lesson.goalTextEn.replace(/^I can /, '').replace(/\.$/, '')}. Is it clear?`
      : index === 3 ? step.script : existingIntro[index]?.script,
  }));
  learn.tutorSteps = [
    { instruction: referenceLearn.tutorSteps[0].instruction, script: referenceLearn.tutorSteps[0].script },
    { instruction: 'Read the instructions.', script: 'Please listen and repeat.' },
    { instruction: referenceLearn.tutorSteps[2].instruction, script: 'Please repeat after me.' },
    { instruction: referenceLearn.tutorSteps[3].instruction },
    { instruction: referenceLearn.tutorSteps[4].instruction, script: "Great! Let's go to the next part!" },
  ];
  learn.discussionPart.tutorSteps = [
    copy(referenceLearn.discussionPart.tutorSteps[0]),
    { instruction: 'Read the instructions and check understanding.', script: `${learn.discussionPart.instruction.replace(/^II\.\s*/, '')} Is it clear?` },
    { instruction: 'Have the student answer using the vocabulary from Part I.', tip: number === 1 ? 'Ask the student to choose one picture and give one or two sentences. Accept short answers.' : 'Ask one question for each chosen topic: Where did you grow up? What do you do on weekends? What are you looking forward to? Accept one or two sentences per topic.' },
    { instruction: 'Ask one natural follow-up based on the answer.', tip: 'Accept personal or invented details. Keep Part II to about one minute.' },
    copy(referenceLearn.discussionPart.tutorSteps.at(-1)),
  ];
  const pronunciation = learn.pronunciationPart;
  const left = pronunciation.leftColumn, right = pronunciation.rightColumn;
  const soundTips = number === 1
    ? ['For /m/, keep the lips together and let the sound come through the nose.', 'For /n/, touch the tongue tip to the ridge behind the upper front teeth.']
    : ['For /l/, touch the tongue tip to the ridge behind the upper front teeth.', 'For /r/, the tongue tip does not touch that ridge. Model your natural accent.'];
  pronunciation.tutorSteps = [
    { instruction: referenceLearn.pronunciationPart.tutorSteps[0].instruction, script: `Now let's practise ${left.soundSymbol} and ${right.soundSymbol}. Listen and repeat.` },
    { instruction: `Model ${left.soundSymbol}, then read each word on the left and have the student repeat.`, tip: soundTips[0] },
    { instruction: `Model ${right.soundSymbol}, then read each word on the right and have the student repeat.`, tip: soundTips[1] },
    { instruction: 'Read each pair and have the student repeat.', script: `Now let's compare the words. ${left.words.map((word: any, index: number) => `${word.word}, ${right.words[index].word}.`).join(' ')}`, tip: 'Repeat a difficult pair once if needed. Keep this part to about one minute.' },
    { instruction: 'Transition to Step B.', script: "Great! Let's go to Step B Grammar Tip!" },
  ];

  const oldGrammar = lesson.stepBData.grammarTip.tutorSteps;
  next.stepBData.grammarTip.tutorSteps = buildStepBTutorGuide(oldGrammar.at(-1).script || oldGrammar.at(-1).question);

  const applyQuestions = questions(lesson.applyData.tutorSteps);
  if (number === 1) {
    next.applyData.tutorSteps = [
      { instruction: 'Set up the dialogue and read it with the student. The tutor speaks first.', scripts: bullets(["Let's read Emma and Claire's dialogue.", "I'll be Claire. Please be Emma. Is it clear? I'll start."]), tips: bullets(['Read the situation first. After the dialogue, correct at most two or three important pronunciation errors.']) },
      { instruction: reference.applyData.tutorSteps[1].instruction, questions: applyQuestions },
    ];
  } else {
    const script = lesson.applyData.tutorSteps.find((step: any) => step.listeningScript)?.listeningScript;
    if (!script) throw Error('Missing Leo listening script.');
    next.applyData.tutorSteps = [
      { instruction: 'Set up the listening and read the message once for the main idea.', scripts: bullets(["I'll be Leo. Listen to his message first. Is it clear?"]), listeningScript: script, tips: bullets(['Only the tutor can see the transcript. Read at a natural, unhurried pace.']) },
      { instruction: 'Ask the main-idea question, read the message again, then ask the detail questions.', questions: applyQuestions, tips: bullets(['If a detail is missed, repeat only the relevant sentence and ask again.']) },
    ];
  }
  next.applyData.triviaTutorSteps = [
    copy(reference.applyData.triviaTutorSteps[0]),
    copy(reference.applyData.triviaTutorSteps[1]),
    { instruction: 'Check understanding and ask the question below.', questions: questions(lesson.applyData.triviaTutorSteps) },
    copy(reference.applyData.triviaTutorSteps.at(-1)),
  ];

  next.exerciseData.tutorSteps = [{
    instruction: 'Have the student choose each phrase, then read the whole sentence.',
    scripts: bullets([number === 1 ? 'Choose the correct word or phrase. Then read the sentence aloud.' : 'Choose the correct phrase. Then tell me: past, present, or reason?']),
    answerKey: keys(lesson.exerciseData.tutorSteps),
    ...(number === 2 ? { tips: bullets(['Keep grammar correction brief so there is time for the listening practice.']) } : {}),
  }];
  const exerciseB = lesson.exerciseData.stepBTutorSteps;
  next.exerciseData.stepBTutorSteps = number === 1 ? [
    { instruction: 'Read the instructions and complete the conversation with the student. The tutor speaks first.', scripts: bullets(["I'll be Claire. You're the new resident. You may invent details. Is it clear? I'll start."]), tips: bullets(['Listen for a reason, a duration with for or since, and a natural follow-up question.']) },
    { instruction: 'Check the answers and correct only the parts that need support.', tips: bullets(['Accept different details if they make sense. After a correction, ask the student to say the full line again.']) },
  ] : [
    { instruction: 'Read each short message and have the student choose an answer.', scripts: bullets(texts(exerciseB, 'scripts')), tips: bullets(['These messages are for the tutor only. Pause after each message; repeat if needed.']) },
    { instruction: reference.exerciseData.stepBTutorSteps[1].instruction, answerKey: keys(exerciseB), tips: bullets(['Ask which words helped the student choose each answer.']) },
  ];

  const mission = lesson.missionData;
  const roleplay = mission.tutorSteps.find((step: any) => step.scripts?.some((script: any) => /^1\./.test(script.text)));
  if (!roleplay) throw Error('Expected the authored roleplay lines.');
  const setup = {
    instruction: 'Read the situation and instructions, then check understanding.',
    scripts: bullets(['Please read the situation and instructions. Is it clear?']),
  };
  const start = {
    instruction: 'Start the roleplay. The tutor speaks first; use follow-ups only when the student needs support.',
    scripts: [...bullets([number === 1 ? "I'll be Claire. You're the new resident. You may invent details. You may use the useful language. I'll start." : "I'll be Claire. Please be Emma. You may use the useful language. I'll start."]), ...copy(roleplay.scripts)],
    ...(roleplay.prompts?.length ? { prompts: copy(roleplay.prompts) } : {}),
    tips: bullets(['Let the student finish before correcting. Follow the conversation naturally rather than reading every guide line as a checklist.']),
  };
  const finish = {
    instruction: 'Give specific feedback and retry one part that needs support.',
    scripts: bullets(["Great job! Let's go to the next part!"]),
    tips: bullets([number === 1 ? 'Focus on the self-introduction and relevant follow-up questions.' : 'Score understanding of the message, not minor grammar errors in the retelling.', 'Do Challenge 2 only if there is time left before Feedback.']),
  };
  next.missionData.tutorSteps = [setup];
  if (number === 2) {
    const listening = mission.tutorSteps.find((step: any) => step.listeningScript);
    if (!listening) throw Error('Missing Nao listening script.');
    next.missionData.tutorSteps.push({
      instruction: 'Read the complete message once for the main idea, then again for details.',
      listeningScript: listening.listeningScript,
      tips: bullets(['Only the tutor can see the transcript. Check understanding and repeat the relevant part if needed.']),
    });
  }
  next.missionData.tutorSteps.push(start, finish);
  next.missionData2.tutorSteps = [
    { instruction: reference.missionData2.tutorSteps[0].instruction, scripts: bullets(['Please choose a category to discuss.']), tips: bullets(['Skip the optional discussion if more time is needed for Challenge 1 or Feedback.']) },
    copy(reference.missionData2.tutorSteps[1]),
  ];
  next.feedbackData.tutorSteps = copy(reference.feedbackData.tutorSteps);

  if (JSON.stringify(withoutTutorGuides(next)) !== JSON.stringify(withoutTutorGuides(lesson))) throw Error('Non-guide content changed.');
  return next;
}
