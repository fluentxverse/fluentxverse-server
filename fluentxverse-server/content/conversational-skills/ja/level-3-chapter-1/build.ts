import { specs, type LessonSpec } from './specs';
import { buildArcLesson } from './lessons-6-9';

const bullets = (items: string[]) => items.map(text => ({ text }));
const paragraphs = (text: string) => text.split('\n').map(p => `<p>${p}</p>`).join('');
const questions = (items: [string, string][]) => items.map(([question, answer]) => ({ question, answer }));
export const assetDirectory = '/lessons/conversational-skills/ja/l3-c1/v1';

export function buildChapter(apiBase: string) {
  const image = (name: string) => `${apiBase.replace(/\/$/, '')}/lesson/files${assetDirectory}/${name}.webp`;
  const chapter = specs.map(s => {
    const scene = image(s.asset);
    const stepAType = s.change ? 'change' : s.rephrase ? 'rephrase' : 'choose';
    const exercisePairs = s.change || s.rephrase || s.choose;
    const focusName = { 'grammar-tip': 'GRAMMAR TIP', pronunciation: 'PRONUNCIATION', 'speak-your-mind': 'SPEAK YOUR MIND' }[s.focus];
    const focusCommon = {
      stepName: `STEP B: ${focusName}`, duration: '2 minutes',
      tutorSteps: [
        { instruction: 'Model the focus with the examples. Keep the explanation brief.', script: s.rule[0] },
        { instruction: 'Ask the learner to try it, then give one focused correction.', tip: 'Use the Japanese support only if needed. Return to English for practice.' },
      ],
    };
    const stepBData = s.focus === 'grammar-tip' ? {
      stepType: s.focus,
      grammarTip: { ...focusCommon, explanations: [{ ruleText: s.rule[0], ruleTranslation: s.rule[1], examplesTitle: 'EXAMPLES', examples: s.examples.map(([sentence, translation]) => ({ sentence, translation })) }] },
    } : s.focus === 'pronunciation' ? {
      stepType: s.focus,
      pronunciation: { ...focusCommon, tip: `${s.rule[0]}<br><small lang="ja">${s.rule[1]}</small>`, phrases: s.examples.map(([phrase]) => ({ phrase, pronunciationGuide: '', exampleSentence: phrase })) },
    } : {
      stepType: s.focus,
      speakYourMind: {
        ...focusCommon, explanation: `${s.rule[0]}<br><small lang="ja">${s.rule[1]}</small>`,
        speaker1: { image: scene, speechBubble: s.number === 5 ? 'I like taking photos. How about you?' : s.number === 9 ? 'My name is Aisha.' : "Hi! I'm Ken. Nice to meet you." },
        speaker2: { image: scene, speechBubble: s.number === 5 ? 'Me too. I like walking, too.' : s.number === 9 ? 'Sorry, could you say your name again?' : "Nice to meet you. I'm Yuki. Where are you from?" },
        question: s.number === 5 ? 'What could you say if you have a different interest?' : s.number === 9 ? 'What can you say when you are not sure about a name?' : 'What would you ask next to keep the conversation going?',
      },
    };
    const applyAction = s.skill === 'speaking'
      ? 'Read the conversation with your tutor. Switch roles, then change the details.'
      : s.skill === 'listening'
        ? 'Listen to your tutor. First listen for the main idea, then listen again for details.'
        : 'Read the text silently. Find the main idea, then find the details.';
    const applyJa = s.skill === 'speaking'
      ? '講師と会話を読みましょう。役割を交代し、情報を変えて練習しましょう。'
      : s.skill === 'listening'
        ? '講師の話を聞きましょう。一度目は大まかな内容、二度目は詳しい情報を聞き取りましょう。'
        : 'まず黙読し、大まかな内容をつかみましょう。その後、詳しい情報を探しましょう。';
    const missionSteps = [
      { instruction: 'Set the task and check understanding without giving the answers.', scripts: bullets([s.task[0]]), tips: bullets(['Allow 20 seconds to prepare. Accept simple, clear English.']) },
      ...(s.skill === 'listening' ? [{ instruction: 'Read the complete script once for gist, then again for details.', listeningScript: paragraphs(s.missionText!), tips: bullets(['Use a natural but unhurried pace and distinct voices. Do not display the transcript. Repeat a requested part after the second listen.']) }] : []),
      ...(s.skill === 'reading' ? [{ instruction: 'Allow silent reading. Ask the learner to point to evidence in the text.', tips: bullets(['Do not read the passage aloud before the learner has tried. Give a word meaning only when it blocks understanding.']) }] : []),
      { instruction: s.skill === 'speaking' ? 'Start the roleplay. The tutor always speaks first. Use the remaining prompts only when the learner needs support.' : 'Ask the questions and check the evidence.', scripts: bullets(s.missionQuestions.map(([q], i) => `${i + 1}. ${q}`)), tips: bullets(s.missionQuestions.map(([, a], i) => `${i + 1}. ${a}`)) },
      { instruction: 'Give feedback, then retry one difficult part with less support.', tips: bullets(['Praise a specific success. Correct one important error after the activity, not during every sentence.']) },
    ];
    const lesson = {
      course: 'conversational-skills', level: 3, chapter: 1, lessonNumber: s.number, skill: s.skill,
      chapterName: 'Nice to Meet You', lessonName: s.title, goalTextEn: s.goal[0], goalTextJp: s.goal[1],
      backgroundImage: scene, overlayColor: '#17252bcc', status: 'draft',
      introductionData: {
        introTexts: [{ language: 'en', text: s.intro[0] }, { language: 'ja', text: s.intro[1] }], introImage: scene, lessonIssue: null,
        lessonGoalDuration: '1 minute', lessonGoalSteps: [
          { instruction: 'Introduce today\'s goal and check understanding.', script: `Our goal for today is: ${s.goal[0]} Is it clear?` },
          { instruction: 'Introduce the situation and connect it to the learner.', script: `Here\'s our situation. ${s.intro[0]}`, question: s.discussion[0]![1][0] },
        ],
      },
      learnData: { sectionTitle: 'LEARN', steps: [{
        stepType: s.learn, stepName: `STEP A: ${s.learn.toUpperCase()}`, duration: '4 minutes',
        partLabel: 'Learn the words and expressions. Say the examples, then use your own information.',
        partTranslation: '単語と表現を学びましょう。例文を言ってから、自分の情報で練習しましょう。',
        ...(s.learn === 'vocabulary' ? { vocabularyItems: s.words.map(([word, translation, example]) => ({ image: scene, englishText: example, highlightedWord: word, translation })) }
          : { expressionItems: s.words.map(([word, translation, example]) => ({ image: scene, definitionLine: `<strong>${word}</strong>`, exampleSentence: example, translation, extraText: '' })) }),
        tutorSteps: [
          { instruction: 'Model each item. Ask the learner to repeat and notice the meaning.', script: 'Listen first. Then say it with me.' },
          { instruction: 'Check the meaning of each example before moving to Apply.', question: 'Can you give a different example?', tip: 'The picture supports the setting; do not treat it as an answer key.' },
          { instruction: 'Personalize two examples.', script: 'Now use your own information, or invent an example.', tip: 'Allow invented details if the learner prefers not to share personal information.' },
        ],
      }] },
      stepBData,
      applyData: {
        sectionNumber: 3, sectionTitle: 'APPLY', activityType: s.skill, activityTitle: s.skill.toUpperCase(), activityDuration: '4 minutes',
        situationText: applyAction,
        situationTranslation: applyJa,
        situationImage: scene,
        dialogueLines: s.skill === 'speaking' ? s.apply.split('\n').map(line => { const i = line.indexOf(':'); return { speaker: line.slice(0, i), text: line.slice(i + 1).trim(), isAction: false }; }) : [],
        ...(s.skill === 'reading' ? { readingText: paragraphs(s.apply), readingImage: '', readingImageLabel: '' } : {}),
        tutorSteps: [
          { instruction: s.skill === 'listening' ? 'Read once for the main idea. Read again for details.' : applyAction,
            ...(s.skill === 'listening' ? { listeningScript: paragraphs(s.apply) } : {}),
            tips: bullets([s.skill === 'listening' ? 'Keep the script hidden from the learner. Pause only between speakers. Repeat once more if needed.' : s.skill === 'reading' ? 'Let the learner read silently before asking questions.' : 'Model once, then share the roles. Do not make this a tutor-only reading.']) },
          { instruction: 'Check understanding and ask for evidence.', questions: questions(s.applyQuestions) },
          { instruction: s.skill === 'speaking' ? 'Switch roles and change two details.' : 'Return to the line that supports each answer.', tips: bullets(['Accept equivalent answers. Ask one follow-up question before moving on.']) },
        ], triviaEnabled: false,
      },
      exerciseData: {
        sectionNumber: 4, sectionTitle: 'EXERCISE', duration: '4 minutes', stepAType, stepAName: 'STEP A',
        instructions: stepAType === 'choose' ? 'Choose the correct word. Read the complete sentence.' : stepAType === 'change' ? 'Change the underlined words as directed.' : 'Say each idea using a useful expression from this lesson.',
        instructionsTranslation: stepAType === 'choose' ? '正しい語を選び、文全体を読みましょう。' : stepAType === 'change' ? '指示に従って下線部を書き換えましょう。' : 'このレッスンの表現を使って、それぞれの内容を言いましょう。',
        showExpressions: stepAType === 'rephrase', expressions: stepAType === 'rephrase' ? s.words.map(w => w[0]) : [],
        showExample: false, exampleSentence: '', exampleAnswer: '', showInfoBox: false,
        exerciseItems: (s.rephrase || []).map(([sentence]) => ({ image: scene, sentence })),
        chooseItems: s.choose.map(([sentence]) => ({ sentence })), changeItems: (s.change || []).map(([sentence]) => ({ sentence })),
        answers: exercisePairs.map(([, text]) => ({ text })),
        tutorSteps: [{ instruction: 'Let the learner try independently. Check complete sentences.', answerKey: bullets(exercisePairs.map(([, a], i) => `${i + 1}. ${a}`)), tips: bullets(['For personal answers, the examples are models, not the only correct responses.']) }],
        hasStepB: true, stepBType: s.practice, stepBName: 'STEP B',
        stepBInstruction: s.practice === 'multiple-choice' ? 'Choose the best answer. Explain what detail helped you.' : s.practice === 'speech' ? 'Complete the introduction with your own information or an invented person.' : 'Complete the conversation. Use your own information and take turns.',
        stepBInstructionTranslation: s.practice === 'multiple-choice' ? '最も適切な答えを選び、手がかりとなった情報を伝えましょう。' : s.practice === 'speech' ? '自分の情報や架空の人物の情報を使って紹介を完成させましょう。' : '会話を完成させましょう。自分の情報を使い、交代で話しましょう。',
        conversations: s.practice === 'conversation' ? s.practiceText!.map((speechBubble, i) => ({ speakerImage: scene, speechBubble, position: i % 2 ? 'right' : 'left' })) : [],
        multipleChoiceItems: (s.choices || []).map(([boldSentence, optionA, optionB]) => ({ boldSentence, optionA, optionB })),
        ...(s.practice === 'speech' ? { speechSpeakerImage: scene, speechContent: s.practiceText![0] } : {}),
        compareWordBox: [], compareImages: [], compareItems: [],
        stepBTutorSteps: [{ instruction: s.practice === 'multiple-choice' ? 'Check the answer and its supporting detail.' : 'Listen first. Give feedback, then let the learner try again.',
          answerKey: bullets(s.choices ? s.choices.map((c, i) => `${i + 1}. ${c[3]}: ${c[c[3] === 'A' ? 1 : 2]}`) : ['Answers vary. Check that each blank makes sense and that the learner responds to the partner.']),
          tips: bullets(['Do not demand the model wording if the meaning is clear.']) }],
      },
      missionData: {
        sectionNumber: 5, sectionTitle: 'MISSION', missionType: s.skill, challengeNumber: 1, challengeName: 'Challenge 1', duration: '6 minutes',
        situation: s.mission[0], situationTranslation: s.mission[1], instruction: s.task[0], instructionTranslation: s.task[1],
        showGrammarTip: false, grammarTipTitle: 'Useful language', grammarTipItems: [], image: s.skill === 'reading' ? '' : scene,
        questions: s.missionQuestions.map(([question]) => ({ question, hints: [] })), tutorSteps: missionSteps,
        ...(s.skill === 'listening' ? { listeningScript: paragraphs(s.missionText!) } : {}),
        ...(s.skill === 'reading' ? { readingPassage: { title: s.number === 4 ? 'Meet Ken and Aisha' : 'Breakfast at Maple House', showAuthor: false, headerAlignment: 'left', blocks: s.missionText!.split('\n').map(content => ({ type: 'paragraph', content })), closingQuestion: s.number === 4 ? 'Who can join the morning walk? Why?' : 'What are the final plans?' } } : {}),
      },
      missionData2: s.skill === 'speaking' ? {
        sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'discussion', challengeNumber: 2, challengeName: 'Challenge 2', duration: '2 minutes', isOptional: true,
        situation: 'Connect the lesson to your own life.', situationTranslation: 'レッスンの内容を自分の生活と結び付けましょう。',
        instruction: 'Choose one topic. Answer your tutor and ask one question in return.', instructionTranslation: 'トピックを一つ選びましょう。講師の質問に答え、自分からも一つ質問しましょう。',
        showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [], questions: [],
        topics: s.discussion.map(([title, questions]) => ({ title, questions })),
        tutorSteps: [{ instruction: 'Use one topic if time remains. Ask a natural follow-up and invite the learner to ask you something.', tips: bullets(['Skip this optional task if it would reduce feedback time.']) }],
      } : receptiveExtension(s, scene),
      feedbackData: feedback(s),
      storyData: {
        enabled: true, storyTitle: 'New Friends at Maple House',
        setting: 'A fictional international shared house in London. All characters are adults.',
        characters: [
          { id: 'yuki', name: 'Yuki', role: 'main', description: 'An adult English student from Osaka. Likes walking and photography.' },
          { id: 'maya', name: 'Maya', role: 'supporting', description: 'A teacher from a small town near Bristol. Likes cooking.' },
          { id: 'leo', name: 'Leo', role: 'supporting', description: 'A cook from Bristol. Likes music, gardening, and cooking.' },
          { id: 'sara', name: 'Sara', role: 'supporting', description: 'A nurse from Perth. Likes reading, walking, and photography.' },
          { id: 'aisha', name: 'Aisha', role: 'supporting', description: 'A designer from Leeds. Likes photography and walking.' },
          { id: 'ken', name: 'Ken', role: 'supporting', description: 'An adult student from Kyoto. Likes walking and photography.' },
        ],
        previousSummary: s.number === 1 ? '' : specs[s.number - 2]!.intro[0],
        currentPlotPoints: [s.intro[0], s.mission[0]], currentEpisodeSummary: s.intro[0],
        nextEpisodeHook: specs[s.number]?.intro[0] || 'The residents are ready to explore everyday life together.',
        storyNotes: 'Japanese support edition. Main instruction and tutor guidance are in English. Supporting translations are in Japanese. Lessons can be used independently. Images illustrate situations; they are not identity or listening answer keys.',
      },
    };
    return lesson;
  });
  return chapter.map(lesson => lesson.lessonNumber >= 6 && lesson.lessonNumber <= 9
    ? { ...lesson, ...buildArcLesson(lesson.lessonNumber as 6 | 7 | 8 | 9, lesson, apiBase) }
    : lesson);
}

function receptiveExtension(s: LessonSpec, image: string) {
  const extensions: Record<number, { text: string; task: [string, string]; questions: [string, string][] }> = {
    2: {
      text: "Hi. I'm Aisha. I'm from Leeds. I'm a designer, not a teacher. I work at home.",
      task: ['Listen to one more introduction. What is her name, where is she from, and what is her job?', 'もう一つの自己紹介を聞きましょう。名前、出身地、仕事は何ですか。'],
      questions: [['What is her name?', 'Aisha.'], ['Where is she from?', 'Leeds.'], ['Is she a teacher?', 'No. She is a designer.']],
    },
    4: {
      text: 'Maya is a teacher. She works at a school from Monday to Friday. On Saturday, she is free in the morning. On Sunday morning, she cooks with her friends at Maple House.',
      task: ['Read Maya\'s profile. Which morning is better for a walk: Saturday or Sunday? Give a reason.', 'マヤのプロフィールを読みましょう。散歩に向いているのは土曜日の朝と日曜日の朝のどちらですか。理由も答えましょう。'],
      questions: [['What does Maya do?', 'She is a teacher.'], ['Which morning is better for a walk?', 'Saturday. She is free then; on Sunday morning she cooks with friends.']],
    },
    6: {
      text: "Leo: Let's meet in the kitchen at six.\nYuki: Six in the morning?\nLeo: No, six in the evening, on Friday.\nYuki: Friday evening at six, in the kitchen. Got it.",
      task: ['Listen and correct this plan: Friday morning, at six, in the kitchen. Which detail is wrong?', '聞いて、次の予定を訂正しましょう。「金曜日の朝6時、キッチン」。どの情報が間違っていますか。'],
      questions: [['Which detail is wrong?', 'Morning. It should be evening.'], ['What is the correct plan?', 'Friday evening at six in the kitchen.']],
    },
    8: {
      text: 'Hi Yuki, let\'s meet at the front door on Saturday at two. Please bring your camera. We can take photos in the park. You do not need to bring food. - Aisha',
      task: ['Read the message. Which item do you need: a camera or some food? When and where do you meet?', 'メッセージを読みましょう。必要なのはカメラと食べ物のどちらですか。いつ、どこで会いますか。'],
      questions: [['What do you need to bring?', 'A camera.'], ['When and where do you meet?', 'Saturday at two, at the front door.']],
    },
    9: {
      text: "Ken: I like music, but I don't play the guitar.\nSara: Leo plays the guitar. Ask him.\nKen: Thanks. Do you play an instrument, Sara?\nSara: No. I like reading.",
      task: ['Listen carefully. Who plays the guitar, and who only says they like music?', '注意して聞きましょう。ギターを弾くのは誰ですか。音楽が好きとだけ言っているのは誰ですか。'],
      questions: [['Who plays the guitar?', 'Leo.'], ['Does Ken play the guitar?', 'No. He likes music but does not play the guitar.']],
    },
  };
  const extension = extensions[s.number];
  if (!extension) throw new Error(`Missing optional ${s.skill} challenge for lesson ${s.number}`);
  return {
    sectionNumber: 5, sectionTitle: 'MISSION', missionType: s.skill, challengeNumber: 2, challengeName: 'Challenge 2', duration: '2 minutes', isOptional: true,
    situation: s.skill === 'listening' ? 'Check one more short conversation or introduction.' : 'Use a new message or profile to find the information you need.',
    situationTranslation: s.skill === 'listening' ? 'もう一つの短い会話や自己紹介を聞いて、内容を確認しましょう。' : '新しいメッセージやプロフィールから必要な情報を探しましょう。',
    instruction: extension.task[0], instructionTranslation: extension.task[1], showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [],
    image: s.skill === 'listening' ? image : '', questions: extension.questions.map(([question]) => ({ question, hints: [] })),
    ...(s.skill === 'listening' ? { listeningScript: paragraphs(extension.text) } : { readingPassage: { title: 'One More Detail', showAuthor: false, headerAlignment: 'left', blocks: [{ type: 'paragraph', content: extension.text }] } }),
    tutorSteps: [
      { instruction: 'Use this optional task only if time remains before feedback.', tips: bullets(['Keep it to two minutes.']) },
      { instruction: s.skill === 'listening' ? 'Read once, then repeat if requested.' : 'Allow silent reading before checking the answer.', ...(s.skill === 'listening' ? { listeningScript: paragraphs(extension.text) } : {}) },
      { instruction: 'Check the answer and ask which detail helped.', scripts: bullets(extension.questions.map(([q], i) => `${i + 1}. ${q}`)), tips: bullets(extension.questions.map(([, a], i) => `${i + 1}. ${a}`)) },
    ],
  };
}

function feedback(s: LessonSpec) {
  const receptive = s.skill !== 'speaking';
  return {
    sectionNumber: 6, sectionTitle: 'FEEDBACK', duration: '2 minutes', goal: s.goal[0], goalJp: s.goal[1],
    rubricTitle: 'HOW DID YOU DO?',
    rubricLevels: [
      { score: 3, label: 'Independent', description: receptive ? 'Finds the main idea and most details with little help.' : 'Completes the task and responds with little help.' },
      { score: 2, label: 'With some help', description: receptive ? 'Finds the main idea and some details after a second attempt or a prompt.' : 'Completes most of the task with prompts or a second attempt.' },
      { score: 1, label: 'Keep practicing', description: receptive ? 'Needs guided support to identify the main idea and key details.' : 'Needs a model and guided support to complete the task.' },
    ], personalizedFeedbackTitle: 'YOUR NEXT STEP', feedbackGuideTitle: 'TUTOR FEEDBACK GUIDE',
    rememberNote: 'Name one success and one small next step. A score describes this task, not the learner as a person.',
    tutorSteps: [
      { instruction: 'Return to the goal. Ask the learner how the task felt.', scripts: bullets(['What was easy today? What would you like to practice again?']) },
      { instruction: 'Give one evidence-based success and one actionable next step.', tips: bullets([receptive ? 'Assess understanding first. Do not lower comprehension feedback just because a correct answer is a short phrase.' : 'Notice successful communication before correcting language.']) },
      { instruction: 'Have the learner retry one item and finish with the goal.', scripts: bullets(['Let\'s try that part once more.']) },
    ],
    categories: [
      { id: 'range', title: receptive ? 'MAIN IDEA' : 'RANGE', titleJp: receptive ? '大まかな内容' : '表現の幅', focusOn: receptive ? 'Identifies the situation and purpose.' : 'Uses the target expressions appropriately.', exampleFeedbackItems: [s.goal[0]], vocabularyExample: s.words[0]![0], examples: [] },
      { id: 'accuracy', title: receptive ? 'KEY DETAILS' : 'ACCURACY', titleJp: receptive ? '詳しい情報' : '正確さ', focusOn: receptive ? 'Finds the details needed to complete the task and supports answers with evidence.' : 'Uses clear sentence patterns for the task.', exampleFeedbackItems: s.missionQuestions.slice(0, 2).map(([q]) => q), examples: [] },
      { id: 'fluency', title: receptive ? 'STRATEGY' : 'INTERACTION', titleJp: receptive ? '理解の工夫' : 'やり取り', focusOn: receptive ? (s.skill === 'listening' ? 'Uses a second listen or asks for repetition to check uncertain details.' : 'Rereads relevant lines and notices changed information.') : 'Responds to the partner and keeps the exchange moving.', exampleFeedbackItems: [receptive ? 'Check one uncertain detail again.' : 'Ask one relevant follow-up question.'], examples: [] },
    ],
  };
}
