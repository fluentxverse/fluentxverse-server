import { buildLesson2 } from './lesson-2-listening';

const objective = 'I can give an organized short talk about a plan, explain my choices, and describe a backup plan.';
const objectiveJa = '予定について筋道立てて話し、選んだ理由と代案を説明できる。';
const bullets = (texts: string[]) => texts.map(text => ({ text }));

export function buildLesson4(previous: any, apiBase: string) {
  const base = buildLesson2(previous, apiBase);
  return {
    ...base,
    id: 'conversational-skills-L3-C1-4-speaking-ja-v1',
    skill: 'speaking',
    levelBadge: 'L3',
    lessonName: 'Sharing a Sunday Plan',
    lessonTitle: 'Lesson 4: Sharing a Sunday Plan',
    goalTextEn: objective,
    goalTextJp: objectiveJa,
    backgroundImage: '',
    storyData: {
      enabled: true,
      storyTitle: 'Life at Kamo House',
      setting: 'A fictional international shared house in Kyoto. All characters are adults.',
      characters: [
        { id: 'emma', name: 'Emma', role: 'main', description: 'A graphic designer who recently moved to Kyoto and enjoys photography.' },
        { id: 'claire', name: 'Claire', role: 'supporting', description: 'A Kyoto resident who helps run the cafe downstairs at Kamo House.' },
        { id: 'nao', name: 'Nao', role: 'supporting', description: 'A new resident studying ceramics who enjoys taking photos.' },
      ],
      previousSummary: 'Emma and Claire compared bicycle rental prices, time limits, and extra charges for a Sunday ride.',
      currentPlotPoints: ['Claire models a short, organized Sunday plan.', 'The learner shares a plan with a reason, timing, and a backup if conditions change.'],
      currentEpisodeSummary: 'Residents at Kamo House share ideas for Sunday. The learner practises speaking at length with minimal tutor interruption.',
      nextEpisodeHook: 'The residents compare interests and find an activity they can enjoy together.',
      storyNotes: 'Japanese support edition. Fictional rental prices are only lesson examples. All image fields are intentionally empty until artwork is added.',
    },
    introductionData: {
      introTexts: [
        { language: 'en', text: 'The residents of Kamo House in Kyoto are sharing ideas for Sunday. Claire has a plan for a short bike ride. Notice how she explains the activity, her reason, the order of events, and a backup if the weather changes.' },
        { language: 'ja', text: '京都のシェアハウス「Kamo House」の住人たちが日曜日の予定を話しています。クレアは短いサイクリングを計画しています。何をするか、選んだ理由、行動の順番、天気が変わった場合の代案をどのように伝えるかに注目しましょう。' },
      ],
      introImage: '', lessonIssue: null, lessonGoalDuration: '1 minute',
      lessonGoalSteps: [
        { instruction: 'Introduce the objective first and check understanding.', script: `Our objective for today is: ${objective} Is it clear?` },
        { instruction: 'Introduce the situation, then ask one warm-up question.', script: 'Here is our situation. The residents of Kamo House are sharing Sunday plans.', question: 'When you explain a plan to a friend, what detail do you usually mention first?' },
      ],
    },
    learnData: {
      sectionTitle: 'LEARN',
      steps: [{
        stepType: 'vocabulary', stepName: 'STEP A: VOCABULARY', duration: '4 minutes',
        partLabel: 'Listen and repeat. Use these short phrases to keep a talk moving.',
        partTranslation: '聞いて繰り返しましょう。話をつなげる短い表現です。',
        vocabularyItems: [
          { image: '', englishText: "I'm planning to ride along the river.", highlightedWord: "I'm planning to", translation: '川沿いを自転車で走る予定です。' },
          { image: '', englishText: 'The main reason is the easy route.', highlightedWord: 'The main reason is', translation: '一番の理由は走りやすい道だからです。' },
          { image: '', englishText: "I'll stop to take photos along the way.", highlightedWord: 'along the way', translation: '途中で写真を撮るために立ち寄ります。' },
          { image: '', englishText: "After that, I'll meet Emma for coffee.", highlightedWord: 'After that', translation: 'その後、エマとコーヒーを飲みます。' },
          { image: '', englishText: "If it rains, I'll visit a museum instead.", highlightedWord: 'If it rains', translation: '雨が降ったら、代わりに博物館へ行きます。' },
          { image: '', englishText: 'Overall, it should be a relaxing afternoon.', highlightedWord: 'Overall', translation: '全体として、ゆったりした午後になりそうです。' },
        ],
        tutorSteps: [
          { instruction: 'Model each phrase and have the learner repeat. Focus on natural grouping, not isolated words.', script: 'Listen first, then say each phrase with me.' },
          { instruction: 'Ask the learner to sort the phrases by purpose.', script: 'Which phrase gives a reason? Which phrase introduces a backup plan? Which phrase ends a talk?', tip: 'Reason: The main reason is. Backup: If it rains. Ending: Overall.' },
          { instruction: 'Have the learner link two phrases into one short statement.', script: 'Choose two phrases and use them to describe a simple plan.', tip: 'An imagined plan is fine; do not require personal travel details.' },
        ],
      }],
    },
    stepBData: {
      stepType: 'grammar-tip', grammarTip: {
        stepName: 'STEP B: SPEAKING TIP', duration: '2 minutes',
        explanations: [
          { ruleText: 'Make a longer talk easy to follow: state the plan, give a reason, then describe the sequence.', ruleTranslation: 'まとまった話では、まず予定を述べ、理由を伝え、それから行動の順番を説明すると聞き手に伝わりやすくなります。', examplesTitle: 'PLAN + REASON + ORDER', examples: [
            { sentence: "I'm planning to rent a city bike. I chose it because the ride is short. First, I'll cycle by the river. After that, I'll meet a friend.", translation: 'シティサイクルを借りる予定です。短い距離なのでそれを選びました。まず川沿いを走り、その後友人に会います。' },
          ] },
          { ruleText: 'For a possible change, use if + present tense, followed by will + verb. End with a short summary.', ruleTranslation: '起こり得る変更には if + 現在形、その後に will + 動詞の原形を使います。最後に短くまとめましょう。', examplesTitle: 'BACKUP + ENDING', examples: [
            { sentence: "If it rains, I'll go to a museum instead. Overall, it should be a good afternoon.", translation: '雨が降ったら、代わりに博物館へ行きます。全体として、良い午後になりそうです。' },
          ] },
        ],
        tutorSteps: [
          { instruction: 'Read the two speaking tips and ask the learner to read the examples.', script: 'A clear talk has a plan, a reason, an order, a backup, and an ending.' },
          { instruction: 'Check the if-clause form without turning this into a long grammar drill.', script: 'Which sounds natural: If it rains, I will go inside, or If it will rain, I go inside?', tip: 'Accept the first sentence; briefly explain that if takes the present form here.' },
        ],
      },
    },
    applyData: {
      sectionNumber: 3, sectionTitle: 'APPLY', activityType: 'speaking', activityTitle: 'SPEAKING', activityDuration: '4 minutes',
      situationText: 'Claire shares her Sunday plan at Kamo House. Read her short talk as one continuous message. Then give your own 45-second version with a different activity or destination.',
      situationTranslation: 'クレアがKamo Houseで日曜日の予定を話します。短いスピーチを一つのまとまった話として読みましょう。その後、活動や行き先を変えて、45秒ほど自分の予定を話しましょう。',
      situationImage: '', readingText: '', readingImage: '', readingImageLabel: '',
      dialogueLines: [
        { speaker: 'Claire', text: "On Sunday, I'm planning to rent a city bike for up to three hours. The main reason is that I want a relaxed ride without spending too much. First, I'll ride along the Kamo River and stop to take photos. I plan to return the bike by five. After that, I'll meet Emma for coffee. If it rains, I'll skip the bike and visit a museum instead. Overall, I think either plan will be a nice way to spend the afternoon.", isAction: false },
      ],
      tutorSteps: [
        { instruction: 'Introduce Claire’s talk. Ask the learner to read the whole message without interruption.', scripts: bullets(['Claire has one plan and one backup. Please read her whole talk from beginning to end.']), tips: bullets(['Correct only two or three important pronunciation points after the learner finishes.']) },
        { instruction: 'Check the structure with two brief questions.', questions: [
          { question: 'Why did Claire choose the city bike?', answer: 'She wants a relaxed ride without spending too much.' },
          { question: 'What will she do if it rains?', answer: 'Skip the bike and visit a museum.' },
        ] },
        { instruction: 'Give quiet planning time, then invite a 45-second talk with no interruption.', scripts: bullets(['Choose a different activity or destination. Take 20 seconds to plan, then tell me your whole plan. I will listen until you finish.']), tips: bullets(['Listen for a plan, reason, order, and backup. Give one useful correction after the talk, not during it.']) },
      ],
      triviaEnabled: true, triviaDuration: '1 minute',
      // Kyoto City Official Travel Guide: https://kyoto.travel/en/getting-around/bike/
      triviaText: 'Kyoto’s official travel guide notes that central Kyoto is relatively flat and has a grid of streets, making many routes easy to explore by bicycle. A practical detail like this can make a reason in your plan more convincing.',
      triviaTranslation: '京都市の公式観光ガイドによると、京都の中心部は比較的平坦で、道が碁盤の目のように通っているため、自転車で巡りやすい地域です。このような具体的な情報を理由に加えると、予定の説明に説得力が増します。',
      triviaImage: '',
      triviaTutorSteps: [
        { instruction: 'Introduce the trivia.', scripts: bullets(["Let's look at the trivia."]) },
        { instruction: 'Ask the student to read the trivia.', scripts: bullets(['Please read the trivia.']) },
        { instruction: 'Ask how this fact could support a plan.', questions: [{ question: 'How could this detail help you explain why you chose a bicycle?', answer: 'The central streets are relatively flat and easy to navigate.' }] },
        { instruction: 'Transition to Exercise.', scripts: bullets(["Great. Let's continue."]) },
      ],
    },
    exerciseData: {
      ...base.exerciseData,
      sectionNumber: 4, sectionTitle: 'EXERCISE', duration: '4 minutes',
      stepAType: 'choose', stepAName: 'STEP A',
      instructions: 'Choose the phrase that makes the short talk clear. Read all four sentences as one talk.',
      instructionsTranslation: '話の流れが自然になる表現を選びましょう。四つの文を一つのまとまった話として読みましょう。',
      showExpressions: false, expressions: [], showExample: false, exampleSentence: '', exampleAnswer: '', exampleImage: '', showInfoBox: false,
      exerciseItems: [], changeItems: [], chooseImage: '',
      chooseItems: [
        { sentence: "I'm planning to visit the museum on Sunday. (The main reason is / Overall) that I want to see the new exhibition." },
        { sentence: "(First / If), I'll take the train to the city center." },
        { sentence: "(After that / Because), I'll have lunch near the museum." },
        { sentence: "(If it rains / Overall), I can still enjoy the indoor exhibition." },
      ],
      answers: bullets(['The main reason is', 'First', 'After that', 'If it rains']),
      tutorSteps: [
        { instruction: 'Have the learner choose the phrases, then read the complete four-sentence talk without stopping after each answer.', scripts: bullets(['Choose the phrases first. Then read the whole talk smoothly from beginning to end.']), answerKey: bullets(['The main reason is', 'First', 'After that', 'If it rains']) },
        { instruction: 'Ask which phrase introduces the reason and which introduces the backup.', tips: bullets(['Keep this brief so there is enough time for the sustained speaking task.']) },
      ],
      hasStepB: true, stepBType: 'multiple-choice', stepBName: 'STEP B',
      stepBInstruction: 'Choose the stronger sentence for an organized short talk. Then combine your choices into one message.',
      stepBInstructionTranslation: 'まとまったスピーチにより適した文を選び、選んだ文を一つの話につなげましょう。',
      conversations: [], multipleChoiceImage: '', compareWordBox: [], compareImages: [], compareItems: [], speechSpeakerImage: '',
      multipleChoiceItems: [
        { boldSentence: 'Give the plan.', optionA: "I'm going to explore Kyoto on Sunday.", optionB: 'Kyoto, Sunday, maybe.' },
        { boldSentence: 'Add a reason.', optionA: 'Because bike.', optionB: 'I chose a bike because the route is short.' },
        { boldSentence: 'Explain the order.', optionA: "First, I'll ride by the river. After that, I'll have lunch.", optionB: 'River and lunch and things.' },
        { boldSentence: 'Give a backup.', optionA: 'If it will rain, I go inside.', optionB: "If it rains, I'll visit a museum instead." },
      ],
      stepBTutorSteps: [
        { instruction: 'Have the learner choose the stronger sentence in each pair.', scripts: bullets(['Choose the sentence that would help a listener follow your plan.']) },
        { instruction: 'Check the answers, then have the learner combine the four selected sentences into one uninterrupted talk.', answerKey: bullets(['1. A', '2. B', '3. A', '4. B']), tips: bullets(['Allow a brief pause between ideas, but avoid asking a question after every sentence.']) },
      ],
    },
    missionData: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'speaking', challengeNumber: 1, challengeName: 'Challenge 1', duration: '6 minutes',
      situation: 'At Kamo House, each resident is sharing an idea for a relaxed Sunday in Kyoto. A visiting friend has about two hours and enjoys taking photos. It is your turn to present a plan.',
      situationTranslation: 'Kamo Houseでは、住人が京都で過ごす日曜日の案を紹介しています。訪ねてくる友人には約2時間あり、写真を撮るのが好きです。あなたの番になりました。',
      instruction: 'Give a 90-second talk without tutor interruptions. Recommend an activity, explain two reasons, describe the order and timing, mention one practical detail, and offer a backup if the plan changes. You may choose a bike or another way to travel.',
      instructionTranslation: '講師に途中で質問されずに、90秒ほど続けて話しましょう。活動を勧める理由を二つ、行動の順番と時間、実用的な情報を一つ、予定が変わった場合の代案を伝えます。自転車でも別の移動手段でもかまいません。',
      showGrammarTip: true, grammarTipTitle: 'PLAN YOUR TALK',
      grammarTipItems: ['Activity and two reasons', 'Order and approximate times', 'One practical detail and a backup'],
      image: '', questions: [],
      tutorSteps: [
        { instruction: 'Set the task and give 30 seconds of silent planning time.', scripts: bullets(['You have about 30 seconds to plan. Then tell me your whole Sunday idea in about 90 seconds. I will listen until you finish. Is it clear?']), tips: bullets(['The learner may use their own ideas or the fictional Kyoto setting. Do not demand private information or a perfect 90-second duration.']) },
        { instruction: 'Invite the talk. The tutor speaks first to launch it, then does not interrupt.', scripts: bullets(["It's your turn. What is your Sunday plan? I'm ready to listen."]), tips: bullets(['Do not turn this into a question-and-answer roleplay. Note the plan, two reasons, order and timing, practical detail, and backup while the learner speaks.']) },
        { instruction: 'After the learner finishes, ask at most one natural follow-up question if a key idea is unclear.', prompts: bullets(['What made that option the best choice for your friend?']), tips: bullets(['Skip the follow-up if the talk was already clear. Give feedback only after the learner has finished.']) },
        { instruction: 'Give one specific success and one focused improvement, then invite a short retry of the weakest part.', tips: bullets(['Score Challenge 1 chiefly on whether the learner sustains a coherent talk with reasons and a backup, not on reaching an exact number of seconds.']) },
      ],
    },
    missionData2: {
      sectionNumber: 5, sectionTitle: 'MISSION', missionType: 'discussion', challengeNumber: 2, challengeName: 'Challenge 2', duration: '2 minutes', isOptional: true,
      situation: 'A clear plan can make many everyday choices easier to explain.', situationTranslation: '分かりやすい予定の説明は、日常のさまざまな選択に役立ちます。',
      instruction: 'Choose one topic and give a 45-second talk. Your tutor will listen first and may ask one follow-up after you finish.',
      instructionTranslation: 'トピックを一つ選び、45秒ほど続けて話しましょう。講師は最後まで聞き、必要なら話し終わってから質問を一つします。',
      showGrammarTip: false, grammarTipTitle: '', grammarTipItems: [], questions: [],
      topics: [
        { title: 'A FREE AFTERNOON', questions: ['How would you spend a free afternoon in your town?', 'Why would you choose that activity?', 'What would you do if your first choice was unavailable?'] },
        { title: 'A VISITOR’S DAY', questions: ['Where would you take a visitor for two hours?', 'What order would you visit the places in, and why?', 'How would you change the plan if the weather changed?'] },
        { title: 'A SMALL CELEBRATION', questions: ['How would you plan a small celebration for a friend?', 'What practical detail would you check in advance?', 'What is your backup if someone cannot join?'] },
      ],
      tutorSteps: [
        { instruction: 'If time remains, ask the learner to choose one of the three general topics.', scripts: bullets(['Which topic would you like to speak about: a free afternoon, a visitor’s day, or a small celebration?']), tips: bullets(['Skip this optional challenge if Challenge 1 or feedback needs more time.']) },
        { instruction: 'Invite a 45-second talk and listen without interruption. Ask no more than one follow-up afterward.', scripts: bullets(["Please tell me your whole idea. I'll listen until you finish."]), tips: bullets(['The questions on the chosen topic are planning cues, not a checklist to ask one by one.']) },
      ],
    },
    feedbackData: {
      ...base.feedbackData, goal: objective, goalJp: objectiveJa,
      rubricTitle: 'LESSON OBJECTIVE ACHIEVEMENT',
      rememberNote: 'Give specific feedback based on Challenge 1. Note one success in organizing the sustained talk and one useful next step.',
      tutorSteps: [
        { instruction: 'Introduce Feedback.', scripts: bullets(["Okay, now let's do Feedback."]) },
        { instruction: 'Have the student read the lesson objective.' },
        { instruction: 'Ask if they achieved the lesson objective.', scripts: bullets(['Did you achieve the lesson objective?']) },
        { instruction: 'Give the student a score for their objective achievement using the rubric.', tips: bullets(['Base your score mainly on Challenge 1.']) },
        { instruction: 'Give feedback on the student’s range, accuracy, and fluency using the guide below.', tips: bullets(['Use the student’s actual words and delivery, not the fixed sample examples.']) },
        { instruction: 'Wrap up the lesson.', scripts: bullets(['You did a great job today. Thank you very much!']) },
      ],
    },
  };
}
