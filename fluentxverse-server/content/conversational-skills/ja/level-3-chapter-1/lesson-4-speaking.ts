import { buildLesson2 } from './lesson-2-listening';
import { buildStepBTutorGuide } from './standardize-tutor-guides';

const objective = 'I can explain an unexpected problem and suggest a practical plan with reasons.';
const objectiveJa = '予想外の問題を説明し、理由を挙げて実行できる計画を提案できる。';
const bullets = (texts: string[]) => texts.map(text => ({ text }));
const roleplayInstruction = 'Start the roleplay. The tutor speaks first; use follow-ups only when the student needs support.';
const readingInstructions = { instruction: 'Read the situation and instructions, then check understanding.', scripts: bullets(['Please read the situation and instructions. Is it clear?']) };

export function buildLesson4(previous: any, apiBase: string, reference?: any) {
  const feedback = structuredClone(previous?.feedbackData || buildLesson2(previous, apiBase).feedbackData);
  const oldTrivia = previous?.applyData;
  return {
    id: 'conversational-skills-L3-C1-4-speaking-ja-v1', skill: 'speaking', levelBadge: 'L3',
    lessonName: 'A Change of Plans', lessonTitle: 'Lesson 4: A Change of Plans',
    goalTextEn: objective, goalTextJp: objectiveJa, backgroundImage: '',
    storyData: {
      enabled: true, storyTitle: 'Life at Kamo House',
      setting: 'Kyoto: a bike-rental shop, the route to the Kamo River, and Kamo House. All characters are adults.',
      characters: [
        { id: 'emma', name: 'Emma', role: 'main', description: 'A graphic designer who recently moved to Kyoto and enjoys photography.' },
        { id: 'claire', name: 'Claire', role: 'supporting', description: 'A Kamo House resident who helps run the cafe downstairs.' },
        { id: 'nao', name: 'Nao', role: 'supporting', description: 'A new resident studying ceramics who has invited the housemates to take photos.' },
      ],
      previousSummary: 'After comparing the services at Riverside Cycle Kyoto in Lesson 3, Emma and Claire rent bikes for two hours, starting at 10 a.m.',
      currentPlotPoints: [
        'The bikes must be returned by noon. Emma and Claire plan to meet Nao by the river at eleven.',
        'Shortly after they set off, Emma receives an urgent request from her manager: revise a design by noon.',
        'Emma and Claire compare returning together with splitting up so Nao is not left waiting alone.',
        'In Challenge 1, the learner negotiates a workable plan without assuming the work deadline can be extended.',
      ],
      currentEpisodeSummary: 'A work deadline interrupts the bike outing. Emma must balance her new job, a promise to Nao, and the rental return time.',
      nextEpisodeHook: 'The next lesson reviews the residents\' introductions, messages, rental choices, and changed plans.',
      storyNotes: 'Apply models a two-person dialogue, not a speech. Challenge 1 is a tutor-first roleplay with room for the learner to explain options. Rental at 10 a.m. for two hours means return by noon; do not confuse this with the full-day 5 p.m. deadline. No images generated.',
    },
    introductionData: {
      introTexts: [
        { language: 'en', text: 'Emma and Claire have chosen their rental bikes and set off to meet Nao for a photography outing. Then Emma\'s phone buzzes: her manager needs a design revision by noon. Nao expects them at eleven, and the bikes are due back at noon. Their relaxing morning suddenly becomes a difficult choice.' },
        { language: 'ja', text: 'エマとクレアはレンタル自転車を選び、写真を撮りに行くためナオとの待ち合わせ場所へ出発します。そこへエマのスマートフォンに通知が届きます。上司から、正午までにデザインを修正してほしいとの連絡です。ナオとの待ち合わせは11時、自転車の返却は正午です。のんびり過ごすはずの朝に、難しい選択を迫られます。' },
      ],
      introImage: '', lessonIssue: null, lessonGoalDuration: '1 minute',
      lessonGoalSteps: [
        { instruction: 'Introduce the lesson objective and check understanding.', script: 'Our lesson objective today is to explain an unexpected problem and suggest a practical plan with reasons. Is it clear?' },
        { instruction: 'Introduce the situation.', script: 'Here is our situation. Emma and Claire have rented bikes for their outing with Nao, but an urgent work request changes their plans.' },
        { instruction: 'Ask the student a warm-up question.', script: 'When your plans change at the last minute, what do you check first?' },
        { instruction: 'Transition to the next section.', script: "Great! Let's go to the next part!" },
      ],
    },
    learnData: { sectionTitle: 'LEARN', steps: [{
      stepType: 'vocabulary', stepName: 'STEP A: VOCABULARY', duration: '4 minutes',
      partLabel: 'I. Go over the vocabulary with your tutor.', partTranslation: '講師と一緒に語彙を確認しましょう。',
      vocabularyItems: [
        { image: '', englishText: "I've just received an urgent request.", highlightedWord: 'an urgent request', translation: 'たった今、急ぎの依頼が来ました。' },
        { image: '', englishText: 'I need to meet the deadline.', highlightedWord: 'meet the deadline', translation: '締め切りに間に合わせる必要があります。' },
        { image: '', englishText: "There's been a change of plans.", highlightedWord: 'a change of plans', translation: '予定が変わりました。' },
        { image: '', englishText: "I'll let Nao know.", highlightedWord: 'let someone know', translation: 'ナオに知らせます。' },
        { image: '', englishText: "Let's work something out.", highlightedWord: 'work something out', translation: '何か解決策を考えましょう。' },
        { image: '', englishText: 'Another option is to meet later.', highlightedWord: 'another option', translation: '別の案として、後で会うこともできます。' },
      ],
      tutorSteps: [
        { instruction: 'Introduce Learn.', script: "Now, let's try Learn. First we have Step A Vocabulary. Let's do Part I." },
        { instruction: 'Read the instructions.', script: 'Please listen and repeat.' },
        { instruction: 'Read the first vocabulary and ask the student to repeat. Correct their pronunciation if necessary.', script: 'Please repeat after me.' },
        { instruction: 'Repeat Step 3 with the remaining vocabulary.' },
        { instruction: 'Transition to the next part.', script: "Great! Let's go to the next part!" },
      ],
      discussionPart: {
        instruction: 'II. When plans change suddenly, what do you check first: the time, the cost, or other people\'s plans? Explain why.',
        instructionTranslation: '急に予定が変わったとき、時間、費用、ほかの人の予定のうち、何を最初に確認しますか。理由も説明しましょう。', images: [],
        tutorSteps: [
          { instruction: 'Introduce Part II.', script: "Okay, now let's do Part II." },
          { instruction: 'Read the instructions and check understanding.', script: 'What would you check first when plans change? Is it clear?' },
          { instruction: 'Have the student give a choice and a reason.', tip: 'Encourage one of the phrases from Part I. Accept personal or invented examples.' },
          { instruction: 'Ask one natural follow-up.', script: 'Who would you need to let know?', tip: 'Keep Part II to about one minute.' },
          { instruction: 'Transition to Part III.', script: "Good! Let's go to the next part!" },
        ],
      },
      pronunciationPart: {
        instruction: 'Listen and repeat the words.', instructionTranslation: '単語を聞いて、繰り返し発音しましょう。',
        leftColumn: { soundSymbol: '/s/', images: [], words: [{ word: 'see', translation: '見る', isHighlighted: true }, { word: 'sip', translation: 'ひと口飲む' }, { word: 'seat', translation: '席' }] },
        rightColumn: { soundSymbol: '/ʃ/', images: [], words: [{ word: 'she', translation: '彼女', isHighlighted: true }, { word: 'ship', translation: '船' }, { word: 'sheet', translation: '一枚の紙' }] },
        tutorSteps: [
          { instruction: 'Introduce Part III and read the instructions.', script: "Now let's practise /s/ and /ʃ/. Listen and repeat." },
          { instruction: 'Model /s/, then read each word on the left and have the student repeat.', tip: 'Keep the tongue close to the ridge behind the upper front teeth without touching it. Let air flow through.' },
          { instruction: 'Model /ʃ/, then read each word on the right and have the student repeat.', tip: 'Move the tongue slightly farther back and gently round the lips.' },
          { instruction: 'Read each pair and have the student repeat.', script: "Now let's compare the words. See, she. Sip, ship. Seat, sheet.", tip: 'Repeat a difficult pair once if needed. Keep this part to about one minute.' },
          { instruction: 'Transition to Step B.', script: "Great! Let's go to Step B Grammar Tip!" },
        ],
      },
    }] },
    stepBData: { stepType: 'grammar-tip', grammarTip: {
      stepName: 'STEP B: GRAMMAR TIP', duration: '2 minutes',
      explanations: [
        { ruleText: 'Use could + the base form of a verb to suggest an option. Add because to explain your reason.', ruleTranslation: 'could ＋ 動詞の原形で案を提案できます。because を使うと、その理由を説明できます。', examplesTitle: 'SUGGEST AN OPTION', examples: [
          { sentence: 'We could return the bikes now because I need to finish some work.', translation: '仕事を終わらせる必要があるので、今自転車を返すのはどうでしょう。' },
          { sentence: 'Another option is to meet Nao later.', translation: '別の案として、後でナオに会うこともできます。' },
        ] },
        { ruleText: 'Use if + present tense, then will + the base form of a verb, for a possible situation and its result.', ruleTranslation: '起こり得る状況とその結果を表すときは、if の後に現在形を使い、その結果を will ＋ 動詞の原形で表します。', examplesTitle: 'MAKE A BACKUP PLAN', examples: [
          { sentence: "If I finish by eleven, I'll join you.", translation: '11時までに終わったら、合流します。' },
          { sentence: "If the work takes longer, I'll send you an update.", translation: '仕事にもっと時間がかかったら、状況を知らせます。' },
        ] },
      ],
      tutorSteps: buildStepBTutorGuide("I have a question. What could we do if a friend can't meet us on time?"),
    } },
    applyData: {
      sectionNumber: 3, sectionTitle: 'APPLY', activityType: 'speaking', activityTitle: 'SPEAKING', activityDuration: '4 minutes',
      situationText: 'Emma and Claire are on their way to meet Nao by the river at eleven. They rented their bikes at ten and must return them by noon. Emma receives an urgent work message. Read their conversation with your tutor.',
      situationTranslation: 'エマとクレアは、11時にナオと会うため川へ向かっています。10時に借りた自転車は、正午までに返す必要があります。そこへエマに急ぎの仕事の連絡が届きます。講師と二人の会話を読みましょう。',
      situationImage: '', readingText: '', readingImage: '', readingImageLabel: '',
      dialogueLines: [
        { speaker: 'Claire', text: "Emma, what's wrong? You stopped riding.", isAction: false },
        { speaker: 'Emma', text: 'My manager just sent an urgent request. I need to change a design by noon.', isAction: false },
        { speaker: 'Claire', text: "But we're meeting Nao at eleven. Can the work wait?", isAction: false },
        { speaker: 'Emma', text: "I'm afraid not. I don't want to miss the deadline.", isAction: false },
        { speaker: 'Claire', text: 'We could return both bikes and go back together.', isAction: false },
        { speaker: 'Emma', text: 'We could, but then Nao would be waiting alone. Another option is for you to meet her while I work at Kamo House.', isAction: false },
        { speaker: 'Claire', text: 'That sounds better. How long will the changes take?', isAction: false },
        { speaker: 'Emma', text: "About half an hour. If I finish by eleven, I'll walk over and join you.", isAction: false },
        { speaker: 'Claire', text: 'What about the bikes? We rented them at ten.', isAction: false },
        { speaker: 'Emma', text: "I'll return mine on the way back. Yours is due at noon.", isAction: false },
        { speaker: 'Claire', text: "All right. I'll let Nao know what's happening and return my bike on time.", isAction: false },
        { speaker: 'Emma', text: "Thanks. If I need more time, I'll send you an update.", isAction: false },
      ],
      tutorSteps: [
        { instruction: 'Set up the dialogue and read it with the student. The tutor speaks first.', scripts: bullets(["I'll be Claire. Please be Emma. Is it clear? I'll start."]), tips: bullets(['Read the situation first. After the dialogue, correct at most two or three important pronunciation errors.']) },
        { instruction: 'Ask the questions below and have the student point to the wording that supports each answer.', questions: [
          { question: 'Why does Emma need to change the plan?', answer: 'Her manager needs a design revision by noon, before their planned bike outing ends.' },
          { question: 'What do Emma and Claire agree to do?', answer: 'Emma will return her bike and work at Kamo House. Claire will meet Nao, explain the change, and return her own bike on time.' },
          { question: 'What will Emma do if she needs more time?', answer: 'She will send Claire an update.' },
        ] },
      ],
      triviaEnabled: oldTrivia?.triviaEnabled ?? true, triviaDuration: oldTrivia?.triviaDuration || '1 minute',
      triviaText: oldTrivia?.triviaText || 'Central Kyoto is relatively flat, and many of its streets form a grid. These features can make a short bike ride easier to plan.',
      triviaTranslation: oldTrivia?.triviaTranslation || '京都の中心部は比較的平坦で、多くの通りが碁盤の目のように並んでいます。そのため、短いサイクリングの計画を立てやすい地域です。',
      triviaImage: '',
      triviaTutorSteps: oldTrivia?.triviaTutorSteps?.length ? structuredClone(oldTrivia.triviaTutorSteps) : [
        { instruction: 'Introduce the trivia.', scripts: bullets(["Let's look at the trivia."]) },
        { instruction: 'Ask the student to read the trivia.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Check understanding and ask the question below.', questions: [{ question: 'What would help you plan a short bike ride in a new city?', answer: "(student's own answer)" }] },
        { instruction: 'Transition to Exercise.', scripts: bullets(["Great. Let's continue."]) },
      ],
    },
    exerciseData: {
      sectionNumber: 4, sectionTitle: 'EXERCISE', duration: '4 minutes', stepAType: 'choose', stepAName: 'STEP A',
      instructions: 'Choose the correct word or phrase in parentheses.', instructionsTranslation: 'かっこ内から正しい語句を選びましょう。',
      showExpressions: false, expressions: [], showExample: false, exampleSentence: '', exampleAnswer: '', exampleImage: '', showInfoBox: false,
      exerciseItems: [], changeItems: [], chooseImage: '',
      chooseItems: [
        { sentence: 'We could (return / returning) the bikes now.' },
        { sentence: "If I (finish / will finish) by eleven, I'll join you." },
        { sentence: "I'll let Nao (know / to know) about the change." },
        { sentence: "If the work (takes / will take) longer, I'll send you a message." },
        { sentence: 'Another option is (to meet / meet) near the cafe.' },
        { sentence: 'We could go back now (because / but) I need my laptop.' },
      ],
      answers: bullets(['return', 'finish', 'know', 'takes', 'to meet', 'because']),
      tutorSteps: [{ instruction: 'Have the student choose each phrase, then read the whole sentence.', scripts: bullets(['Choose the correct word or phrase. Then read the sentence aloud.']), answerKey: bullets(['return', 'finish', 'know', 'takes', 'to meet', 'because']) }],
      hasStepB: true, stepBType: 'multiple-choice', stepBName: 'STEP B',
      stepBInstruction: 'Choose the response that best fits each situation. Explain your choice.', stepBInstructionTranslation: 'それぞれの状況に最も合う返答を選び、理由を説明しましょう。',
      conversations: [], multipleChoiceImage: '', compareWordBox: [], compareImages: [], compareItems: [], speechSpeakerImage: '',
      multipleChoiceItems: [
        { boldSentence: 'The design must be sent by noon. It is 10:30 now.', optionA: 'We could go back now so I have time to finish.', optionB: 'We could start the changes after lunch.' },
        { boldSentence: 'Nao expects you at eleven, but you cannot arrive on time.', optionA: 'We could change the meeting time without telling her.', optionB: 'We could let her know now and suggest a later time.' },
        { boldSentence: 'You are not sure how long the revision will take.', optionA: "If it takes longer, I'll send you an update.", optionB: "I'll promise to arrive at eleven, even if the work isn't finished." },
        { boldSentence: 'You rented a bike at ten for two hours and need to work at home.', optionA: 'I could leave it outside all afternoon and return it tomorrow.', optionB: "I could return it on the way home, so I won't be late." },
      ],
      stepBTutorSteps: [
        { instruction: 'Have the student read each situation and choose an answer.', scripts: bullets(['Choose the response that respects the deadline or the other person. Then explain your choice.']) },
        { instruction: 'Check the answers and explain only missed details.', answerKey: bullets(['1. A - leave time to finish before noon.', '2. B - tell Nao before changing the meeting time.', '3. A - make a backup without promising an uncertain arrival time.', '4. B - return the bike within the two-hour rental.']) },
      ],
    },
    missionData: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'speaking', challengeNumber: 1, challengeName: 'Challenge 1', duration: '6 minutes',
      situation: 'You are Emma. It is 10:30 a.m. Your rental bikes are due back at noon, and Nao expects you and Claire by the river at eleven. Your manager needs a design revision by noon. Your laptop is at Kamo House, fifteen minutes away, and the revision will take about thirty minutes. Claire asks what you should do.',
      situationTranslation: 'あなたはエマ役です。今は午前10時30分です。レンタル自転車は正午までに返す必要があり、ナオとの待ち合わせは川辺で11時です。上司からは正午までにデザインを修正するよう頼まれています。ノートパソコンは15分ほど離れたKamo Houseにあり、修正には約30分かかります。クレアに、どうするか尋ねられます。',
      instruction: 'Explain the problem and suggest two possible plans. Recommend one with a reason. Agree with Claire what to tell Nao, how to return the bikes on time, and what to do if the work takes longer.',
      instructionTranslation: '問題を説明し、実行できそうな案を二つ提案しましょう。一つを選び、その理由を説明します。ナオへの連絡、自転車を時間内に返す方法、仕事が長引いた場合の対応をクレアと相談して決めましょう。',
      showGrammarTip: true, grammarTipTitle: 'Useful language', grammarTipItems: ['We could ... because ...', 'Another option is to ...', "If ..., I'll ...", "I'll let ... know about ..."], image: '', questions: [],
      tutorSteps: [
        structuredClone(readingInstructions),
        { instruction: roleplayInstruction, scripts: bullets([
          "I'll be Claire. Please be Emma. You may use the useful language. I'll start.",
          '1. Emma, you look worried. What happened?',
          '2. Nao expects us at eleven. What are our options, and which plan do you think is best?',
          '3. How can we make sure both bikes get back on time?',
          '4. What should we tell Nao? And what if the work takes longer?',
          "5. All right, let's agree on who will do what first.",
        ]), tips: bullets(['Give the student time to explain each option and its reason. Do not interrupt every sentence or require an exact speaking duration.', 'Use later guide lines only if a key point is missing. Accept different workable plans; do not assume the manager has agreed to extend the deadline.']) },
        { instruction: 'Give specific feedback and retry one part that needs support.', scripts: bullets(["Great job! Let's go to the next part!"]), tips: bullets(['Check that the plan addresses the work deadline, Nao, and both rental bikes. Praise one clear reason and correct one useful form after the roleplay.', 'Do Challenge 2 only if there is time left before Feedback.']) },
      ],
    },
    missionData2: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'discussion', challengeNumber: 2, challengeName: 'Challenge 2', duration: '2 minutes', isOptional: true,
      situation: '', instruction: 'Choose one category. Discuss the questions with your tutor.', instructionTranslation: 'カテゴリーを一つ選び、講師と質問について話しましょう。',
      showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [], questions: [], image: '',
      topics: [
        { title: 'CHANGED PLANS', questions: ['When did you last have to change a plan suddenly?', 'What options did you consider?', 'What would you do differently next time?'] },
        { title: 'WORK AND FREE TIME', questions: ['How do you decide whether a request is urgent?', 'What could you say if you cannot finish something on time?', 'How do you protect time you have promised to someone?'] },
        { title: 'KEEPING PEOPLE UPDATED', questions: ['Would you call or send a message if you were running late? Why?', 'What details would you include in the update?', 'How would you respond if a friend had to change your plans?'] },
      ],
      tutorSteps: [
        { instruction: 'If time remains, let the student choose one of the three general topics. The tutor speaks first.', scripts: bullets(['Please choose a category to discuss.']), tips: bullets(['Skip this optional discussion if Challenge 1 or Feedback needs more time.']) },
        { instruction: 'Use the category questions as a guide. Ask a natural follow-up based on the student\'s answer.', tips: bullets(['This is free talk. Do not bring the story characters into it.']) },
      ],
    },
    feedbackData: {
      ...feedback, goal: objective, goalJp: objectiveJa, rubricTitle: 'LESSON OBJECTIVE ACHIEVEMENT',
      rememberNote: 'Base feedback on Challenge 1: explaining the problem, suggesting options, giving reasons, and agreeing on a workable plan.',
      tutorSteps: reference?.feedbackData?.tutorSteps ? structuredClone(reference.feedbackData.tutorSteps) : [
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
