import { buildLesson2 } from './lesson-2-listening';

const assetDirectory = '/lessons/conversational-skills/ja/l3-c1/v1';
export const lesson3ImageNames = [
  'lesson3-city-bike', 'lesson3-electric-bike', 'lesson3-per-hour',
  'lesson3-helmet-included', 'lesson3-additional-fee', 'lesson3-return-by',
  'lesson3-apply-rental', 'lesson3-challenge-rental', 'lesson3-bike-parking',
];
const objective = 'I can read and compare a bicycle rental service list, including prices, rental periods, and extra charges.';
const objectiveJa = '自転車レンタルのサービス一覧を読み、料金、利用時間、追加料金を比較できる。';
const bullets = (texts: string[]) => texts.map(text => ({ text }));

// Fictional service lists keep the reading and answer keys internally consistent.
const applyList = [
  '<p><strong>Kamo Cycle Rentals</strong></p>',
  '<p><strong>City bike</strong><br>Up to 3 hours: ¥1,200<br>Full day: ¥1,900</p>',
  '<p><strong>Electric-assist bike</strong><br>Up to 3 hours: ¥1,900<br>Full day: ¥2,900</p>',
  '<p><strong>Extras and conditions</strong><br>Helmet: included<br>Basket: additional ¥200 per rental<br>Late return: ¥500 per hour<br>Full-day bikes must be returned by 6 p.m.<br>All prices include tax.</p>',
].join('');
const challengeBlocks = [
  { type: 'paragraph', content: '<strong>City bike</strong><br>2 hours: ¥900<br>Full day: ¥1,700' },
  { type: 'paragraph', content: '<strong>Electric-assist bike</strong><br>2 hours: ¥1,500<br>Full day: ¥2,600' },
  { type: 'paragraph', content: '<strong>Extras and conditions</strong><br>Helmet: included<br>Basket: ¥300 per rental<br>Late return: ¥400 per hour<br>Return full-day bikes by 5 p.m.<br>All prices include tax.' },
];

export function buildLesson3(previous: any, apiBase: string) {
  const base = buildLesson2(previous, apiBase);
  const image = (name: string) => `${apiBase.replace(/\/$/, '')}/lesson/files${assetDirectory}/${name}.webp`;
  return {
    ...base,
    id: 'conversational-skills-L3-C1-3-reading-ja-v1',
    skill: 'reading',
    levelBadge: 'L3',
    lessonName: 'Choosing a Bike Rental',
    lessonTitle: 'Lesson 3: Choosing a Bike Rental',
    goalTextEn: objective,
    goalTextJp: objectiveJa,
    backgroundImage: image('lesson3-apply-rental'),
    introductionData: {
      introTexts: [
        { language: 'en', text: 'Emma and Claire are planning a Sunday bike ride in Kyoto. They compare rental services before choosing a bike. A useful service list tells you more than the headline price.' },
        { language: 'ja', text: 'エマとクレアは、日曜日に京都でサイクリングをする計画を立てています。自転車を選ぶ前に、レンタルサービスを比較します。サービス一覧には、基本料金以外にも大切な情報があります。' },
      ],
      introImage: image('lesson3-apply-rental'),
      lessonIssue: null,
      lessonGoalDuration: '1 minute',
      lessonGoalSteps: [
        { instruction: 'Introduce the objective first and check understanding.', script: `Our objective for today is: ${objective} Is it clear?` },
        { instruction: 'Introduce the situation, then ask a warm-up question.', script: 'Here is our situation. Emma and Claire want to rent bikes for a ride in Kyoto.', question: 'Besides the price, what would you check before renting a bike?' },
      ],
    },
    learnData: {
      sectionTitle: 'LEARN',
      steps: [{
        stepType: 'vocabulary', stepName: 'STEP A: VOCABULARY', duration: '4 minutes',
        partLabel: 'Listen and repeat. Find these phrases in a service list.',
        partTranslation: '聞いて繰り返しましょう。サービス一覧で使われる表現を確認しましょう。',
        vocabularyItems: [
          { image: image('lesson3-city-bike'), englishText: 'Rent a city bike.', highlightedWord: 'city bike', translation: 'シティサイクルを借りる。' },
          { image: image('lesson3-electric-bike'), englishText: 'Choose an electric-assist bike.', highlightedWord: 'electric-assist bike', translation: '電動アシスト自転車を選ぶ。' },
          { image: image('lesson3-per-hour'), englishText: 'The late fee is charged per hour.', highlightedWord: 'per hour', translation: '延滞料金は1時間ごとにかかります。' },
          { image: image('lesson3-helmet-included'), englishText: 'A helmet is included.', highlightedWord: 'included', translation: 'ヘルメットは料金に含まれています。' },
          { image: image('lesson3-additional-fee'), englishText: 'The basket has an additional fee.', highlightedWord: 'additional fee', translation: 'かごには追加料金がかかります。' },
          { image: image('lesson3-return-by'), englishText: 'Return the bike by 6 p.m.', highlightedWord: 'return by', translation: '午後6時までに自転車を返却してください。' },
        ],
        tutorSteps: [
          { instruction: 'Model each phrase and have the learner repeat. Correct only important pronunciation errors.', script: 'Listen first, then say the phrase with me.' },
          { instruction: 'Check the meaning of included, additional fee, and return by.', script: 'Which phrase means there is no extra charge? Which one tells you a deadline?' },
          { instruction: 'Ask which two details the learner would check on a rental list.', script: 'What would you check first on a rental list?' },
        ],
      }],
    },
    stepBData: {
      stepType: 'grammar-tip', grammarTip: {
        stepName: 'STEP B: READING TIP', duration: '2 minutes',
        explanations: [
          { ruleText: 'Read up to as a maximum and by as a deadline. A price for up to 3 hours does not mean three hours are required.', ruleTranslation: 'up to は「最長」、by は「～までに」という期限を表します。up to 3 hours の料金は、必ず3時間利用しなければならないという意味ではありません。', examplesTitle: 'TIME CONDITIONS', examples: [
            { sentence: 'City bike: up to 3 hours, ¥1,200.', translation: 'シティサイクル：最長3時間、1,200円。' },
            { sentence: 'Return the bike by 6 p.m.', translation: '午後6時までに自転車を返却してください。' },
          ] },
          { ruleText: 'Included means no separate charge. An additional fee or a per-hour fee changes the total.', ruleTranslation: 'included は別料金がかからないことを示します。additional fee（追加料金）や per hour（1時間ごと）の料金は合計額に影響します。', examplesTitle: 'TOTAL COST', examples: [
            { sentence: 'A helmet is included, but a basket costs an additional ¥200.', translation: 'ヘルメットは料金に含まれますが、かごには200円の追加料金がかかります。' },
            { sentence: 'A late return costs ¥500 per hour.', translation: '返却が遅れると1時間ごとに500円かかります。' },
          ] },
        ],
        tutorSteps: [
          { instruction: 'Read the condition words and ask the learner to read the examples.', script: 'Look for small words that change the price or time limit: up to, by, included, additional, and per.' },
          { instruction: 'Check the contrast between an included item and an extra charge.', script: 'If the helmet is included but the basket costs ¥200, which one changes the total?' },
        ],
      },
    },
    applyData: {
      sectionNumber: 3, sectionTitle: 'APPLY', activityType: 'reading', activityTitle: 'READING', activityDuration: '4 minutes',
      situationText: 'Emma and Claire read the service list at a Kyoto bike-rental shop. Read it aloud, then compare the bike options and conditions.',
      situationTranslation: 'エマとクレアは京都の自転車レンタル店でサービス一覧を読みます。声に出して読み、車種と利用条件を比較しましょう。',
      situationImage: image('lesson3-apply-rental'), dialogueLines: [],
      readingText: applyList, readingImage: '', readingImageLabel: '',
      tutorSteps: [
        { instruction: 'Set up the reading and ask the learner to read the service list aloud.', scripts: bullets(['Please read the service list. Notice the rental period, what is included, and any extra charges.']), tips: bullets(['Correct at most two or three important pronunciation errors after the reading.']) },
        { instruction: 'Ask the questions below and have the learner point to the wording that supports each answer.', questions: [
          { question: 'How much is a city bike for up to three hours?', answer: '¥1,200.' },
          { question: 'How much is a full-day electric-assist bike with a basket?', answer: '¥3,100 (¥2,900 + ¥200).' },
          { question: 'Is a helmet an extra charge?', answer: 'No. It is included.' },
          { question: 'By what time must a full-day bike be returned?', answer: 'By 6 p.m.' },
        ] },
      ],
      triviaEnabled: true, triviaDuration: '1 minute',
      // Kyoto City Official Travel Guide: https://kyoto.travel/en/getting-around/bike/
      triviaText: 'Kyoto City’s official travel guide lists authorized rental-bike shops and tells cyclists to use designated bicycle parking areas. When you compare rentals, check where you can park and when you must return the bike.',
      triviaTranslation: '京都市の公式観光ガイドでは、認定レンタサイクル店を紹介し、自転車は指定の駐輪場に停めるよう案内しています。レンタルを比較するときは、返却時間だけでなく、どこに駐輪できるかも確認しましょう。',
      triviaImage: image('lesson3-bike-parking'),
      triviaTutorSteps: [
        { instruction: 'Introduce the trivia.', scripts: bullets(["Let's look at the trivia."]) },
        { instruction: 'Ask the student to read the trivia.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Check understanding and ask a practical question.', questions: [{ question: 'Besides the price, what parking detail should you check when renting a bike?', answer: 'Where designated bicycle parking is available.' }] },
        { instruction: 'Transition to Exercise.', scripts: bullets(["Great. Let's continue."]) },
      ],
    },
    exerciseData: {
      ...base.exerciseData, sectionNumber: 4, sectionTitle: 'EXERCISE', duration: '4 minutes',
      stepAType: 'choose', stepAName: 'STEP A',
      instructions: 'Choose the correct phrase in parentheses using the reading tip.',
      instructionsTranslation: 'リーディングのポイントを使い、カッコの中から正しい表現を選びましょう。',
      showExpressions: false, expressions: [], showExample: false, showInfoBox: false, exerciseItems: [], changeItems: [],
      chooseItems: [
        { sentence: 'A rental for (up to / by) 3 hours can last less than 3 hours.' },
        { sentence: 'Return the bike (by / per) 6 p.m.' },
        { sentence: 'A helmet is (included / additional), so there is no separate charge.' },
        { sentence: 'The late fee is ¥500 (per / by) hour.' },
      ],
      answers: bullets(['up to', 'by', 'included', 'per']),
      tutorSteps: [
        { instruction: 'Have the learner choose each phrase, then read the whole sentence.', scripts: bullets(['Choose the word that makes the condition clear. Then read the sentence aloud.']), answerKey: bullets(['up to', 'by', 'included', 'per']) },
      ],
      hasStepB: true, stepBType: 'multiple-choice', stepBName: 'STEP B',
      stepBInstruction: 'Read each service detail. Choose the correct interpretation.',
      stepBInstructionTranslation: '各サービスの条件を読み、正しい意味を選びましょう。',
      conversations: [], compareWordBox: [], compareImages: [], compareItems: [],
      speechSpeakerImage: '',
      multipleChoiceItems: [
        { boldSentence: 'City bike, up to 3 hours: ¥1,200. Can you return it after two hours?', optionA: 'Yes', optionB: 'No' },
        { boldSentence: 'Helmet: included. What is the helmet charge?', optionA: '¥0 extra', optionB: '¥200 extra' },
        { boldSentence: 'Full-day city bike: ¥1,900. Basket: ¥200 extra. What is the total?', optionA: '¥1,900', optionB: '¥2,100' },
        { boldSentence: 'Full-day bikes: return by 6 p.m. Is 6:30 p.m. on time?', optionA: 'Yes', optionB: 'No' },
      ],
      stepBTutorSteps: [
        { instruction: 'Have the learner read each detail and choose an answer. Ask which condition word helped.', scripts: bullets(['Read the detail, choose an answer, and tell me which words helped you.']) },
        { instruction: 'Check the answers and explain only missed conditions.', answerKey: bullets(['1. A - up to means a maximum.', '2. A - included means no extra charge.', '3. B - ¥1,900 + ¥200 = ¥2,100.', '4. B - by 6 p.m. is a deadline.']) },
      ],
    },
    missionData: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'reading', challengeNumber: 1, challengeName: 'Challenge 1', duration: '6 minutes',
      situation: 'Emma and Claire find another bike-rental shop for their Sunday ride. Your tutor is a friend deciding which bike to rent.',
      situationTranslation: 'エマとクレアは日曜日のサイクリングに向け、別の自転車レンタル店を見つけます。講師はどの自転車を借りるか考えている友人です。',
      instruction: 'Read the new service list. Then explain the prices and conditions to your friend and help them choose an option for a two-hour ride.',
      instructionTranslation: '新しいサービス一覧を読みましょう。その後、2時間のサイクリングに適した選択ができるよう、友人に料金と条件を伝えましょう。',
      showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [], image: image('lesson3-challenge-rental'),
      questions: [
        { question: 'Which bike would you choose for a two-hour ride?', hints: [] },
        { question: 'What would a two-hour electric-assist bike with a basket cost?', hints: [] },
        { question: 'What is included without an extra charge?', hints: [] },
        { question: 'When must a full-day bike be returned?', hints: [] },
      ],
      readingPassage: { title: 'Riverside Cycle Kyoto', showAuthor: false, headerAlignment: 'left', blocks: challengeBlocks, closingQuestion: 'Which option would you recommend for a two-hour ride, and why?' },
      tutorSteps: [
        { instruction: 'Set the situation. Ask the learner to read the list aloud.', scripts: bullets(['Please read the service list first. Then help me choose a bike for a two-hour ride. Is it clear?']), tips: bullets(['Correct no more than two or three pronunciation points after the reading.']) },
        { instruction: 'Start the friend roleplay. The tutor speaks first and follows the learner’s choice.', scripts: bullets(['Hi! I want to rent a bike for two hours. What are my options?']), prompts: bullets(['How much would the electric-assist bike cost with a basket?', 'Is a helmet included?', 'What happens if I return it late?', 'Which bike would you recommend for me, and why?']), tips: bullets(['Two-hour city bike: ¥900. Electric-assist bike with basket: ¥1,800. Helmet is included. Late return: ¥400 per hour. Full-day return deadline: 5 p.m. Follow up naturally; do not read every prompt as a checklist.']) },
        { instruction: 'Give specific feedback and retry one missed condition.', tips: bullets(['Score mainly on whether the learner locates and explains prices, periods, and extra charges accurately.']) },
      ],
    },
    missionData2: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'discussion', challengeNumber: 2, challengeName: 'Challenge 2', duration: '2 minutes', isOptional: true,
      situation: 'Service lists help us make everyday choices.', situationTranslation: 'サービス一覧は、日常の選択に役立ちます。',
      instruction: 'Choose one category. Discuss the questions with your tutor.', instructionTranslation: 'カテゴリーを一つ選び、講師と質問について話しましょう。',
      showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [], questions: [],
      topics: [
        { title: 'COMPARE SERVICES', questions: ['When you compare two services, what do you check besides price?', 'Would you pay more for a flexible return time? Why?', 'What information is often missing from a service list?'] },
        { title: 'EXTRA CHARGES', questions: ['What extra charge has surprised you before?', 'How do you check whether tax or equipment is included?', 'When is an optional add-on worth paying for?'] },
        { title: 'TIME AND PLANS', questions: ['Do you prefer paying by the hour or for a full day? Why?', 'How much extra time do you allow before a return deadline?', 'What would you do if your plans changed after booking a service?'] },
      ],
      tutorSteps: [
        { instruction: 'If time remains, let the learner choose one of the three general topics. The tutor speaks first.', scripts: bullets(['Would you like to discuss comparing services, extra charges, or time and plans?']), tips: bullets(['Skip the optional discussion if more time is needed for Challenge 1 or feedback.']) },
        { instruction: 'Use the category questions as a guide. Ask a natural follow-up based on the learner’s answer.', tips: bullets(['This is free talk. Do not bring the story characters into it.']) },
      ],
    },
    feedbackData: {
      ...base.feedbackData, goal: objective, goalJp: objectiveJa,
      rubricTitle: 'LESSON OBJECTIVE ACHIEVEMENT',
      rememberNote: 'Give evidence-based feedback about the service details read in Challenge 1. Name one success and one useful next reading strategy.',
      tutorSteps: [
        { instruction: 'Introduce Feedback.', scripts: bullets(["Okay, now let's do Feedback."]) },
        { instruction: 'Have the student read the lesson objective.' },
        { instruction: 'Ask if they achieved the lesson objective.', scripts: bullets(['Did you achieve the lesson objective?']) },
        { instruction: 'Give the student a score for their objective achievement using the rubric.', tips: bullets(['Base your score mainly on Challenge 1.']) },
        { instruction: 'Give feedback on the student’s range, accuracy, and fluency using the guide below.', tips: bullets(['Use the student’s actual performance, not the fixed examples, as feedback evidence.']) },
        { instruction: 'Wrap up the lesson.', scripts: bullets(['You did a great job today. Thank you very much!']) },
      ],
    },
  };
}
